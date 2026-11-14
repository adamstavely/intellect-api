import { ServiceUnavailableException } from '@nestjs/common';
import { errors, type Client, type estypes } from '@elastic/elasticsearch';

/**
 * Elasticsearch couldn't give a complete answer: a search timed out, some shards failed, or the cluster was
 * unavailable or overloaded. Retriable, and never mistaken for a smaller result: the API answers 503, and nothing
 * computed from the read (analytics, rollups) is returned or stored.
 */
export class SearchUnavailableError extends ServiceUnavailableException {
  constructor(detail: string, options?: { cause?: unknown }) {
    super(`Search temporarily unavailable, try again: ${detail}`, options);
  }
}

type Shards = Pick<estypes.ShardStatistics, 'total' | 'failed' | 'failures'>;

/** Throws `SearchUnavailableError` unless a search, count or aggregation response covers every shard in time. */
export function assertComplete(res: { timed_out?: boolean; _shards?: Shards }, what = 'search'): void {
  if (res.timed_out) throw new SearchUnavailableError(`${what} timed out`);
  const failed = res._shards?.failed ?? 0;
  if (failed > 0) {
    const reason = res._shards?.failures?.[0]?.reason;
    throw new SearchUnavailableError(`${what} failed on ${failed} of ${res._shards?.total ?? '?'} shards${reason ? ` (${reason.type}: ${reason.reason ?? ''})` : ''}`);
  }
}

/**
 * Whether an Elasticsearch error status means "not now" rather than "never": overload, unavailability, or – with
 * partial results refused – a shard failure, which comes back as a search_phase_execution_exception.
 */
const retriable = (status: number, type: string | undefined) =>
  status === 429 || status === 502 || status === 503 || status === 504 || (type === 'search_phase_execution_exception' && status >= 500);

/** `SearchUnavailableError` for errors worth a retry (see `retriable`, plus timeouts and lost connections); others as they are. */
function unavailable(err: unknown, what: string): unknown {
  if (err instanceof errors.ResponseError) {
    const status = err.statusCode ?? 0;
    if (retriable(status, (err.body as { error?: { type?: string } } | undefined)?.error?.type)) {
      return new SearchUnavailableError(`${what} failed with ${status}`, { cause: err });
    }
  } else if (err instanceof errors.ConnectionError || err instanceof errors.TimeoutError || err instanceof errors.NoLivingConnectionsError) {
    return new SearchUnavailableError(`${what} could not reach Elasticsearch`, { cause: err });
  }
  return err;
}

/**
 * The one way to search here: partial results are refused (`allow_partial_search_results: false`), and a response
 * that timed out or skipped failed shards anyway is rejected, so a failed shard never reads as "no matches".
 */
export async function search<TDoc = unknown, TAggs = Record<string, estypes.AggregationsAggregate>>(
  es: Client,
  req: estypes.SearchRequest,
): Promise<estypes.SearchResponse<TDoc, TAggs>> {
  let res: estypes.SearchResponse<TDoc, TAggs>;
  try {
    res = await es.search<TDoc, TAggs>({ allow_partial_search_results: false, ...req });
  } catch (err) {
    throw unavailable(err, 'search');
  }
  assertComplete(res);
  return res;
}

/** A count, checked like `search`: a count that missed failed shards would be an undercount. */
export async function count(es: Client, req: estypes.CountRequest): Promise<estypes.CountResponse> {
  let res: estypes.CountResponse;
  try {
    res = await es.count(req);
  } catch (err) {
    throw unavailable(err, 'count');
  }
  assertComplete(res, 'count');
  return res;
}

/** A multi-search, each search checked like `search`; one that failed outright throws too. */
export async function msearch<TDoc = unknown>(es: Client, req: estypes.MsearchRequest): Promise<estypes.SearchResponseBody<TDoc>[]> {
  const searches = req.searches?.map((s, i) => (i % 2 === 0 ? { allow_partial_search_results: false, ...s } : s));
  let res: estypes.MsearchResponse<TDoc>;
  try {
    res = await es.msearch<TDoc>({ ...req, ...(searches ? { searches } : {}) });
  } catch (err) {
    throw unavailable(err, 'msearch');
  }
  return res.responses.map((r, i) => {
    if ('error' in r) {
      const detail = `search ${i} failed with ${r.status}: ${r.error.type}: ${r.error.reason ?? ''}`;
      throw retriable(r.status, r.error.type) ? new SearchUnavailableError(detail) : new Error(detail);
    }
    assertComplete(r, `search ${i}`);
    return r;
  });
}

/** `_source` of every hit. */
export const sources = <T>(res: { hits: { hits: { _source?: T }[] } }): T[] =>
  res.hits.hits.map((h) => h._source).filter((s): s is T => s !== undefined);

export const totalHits = (res: { hits: { total?: estypes.SearchTotalHits | number } }): number =>
  typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);

/**
 * Fetches docs by id into a map; ids that don't exist are left out. A doc Elasticsearch failed to read (a shard
 * unavailable, say) throws instead, so callers never mistake a failed read for a missing record.
 */
export async function getMany<T>(es: Client, index: string, ids: string[], fields?: string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const res = await es.mget<T>({ index, ids: unique, ...(fields ? { _source: fields } : {}) });
  const out = new Map<string, T>();
  for (const d of res.docs) {
    if ('error' in d) throw new Error(`Could not read ${index}/${d._id}: ${d.error.type}: ${d.error.reason ?? ''}`);
    if (d.found && d._source) out.set(d._id, d._source);
  }
  return out;
}

/** Page size for `searchAll`: Elasticsearch's default result window allows up to 10,000. */
export const PAGE_SIZE = 1000;

/**
 * Every hit of a query, read a page at a time through a point in time (search_after, with `_shard_doc` breaking ties),
 * so nothing is cut off at a result window and the pages are one consistent snapshot. With a `sort`, Elasticsearch
 * orders the whole result, not just one window of it. Every page is checked (see `search`): a partial page throws
 * rather than ending the read early.
 */
export async function searchAll<T>(
  es: Client,
  index: string,
  body: Pick<estypes.SearchRequest, 'query' | '_source'> & { sort?: estypes.SortCombinations[] },
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const { sort = [], ...rest } = body;
  let pit: estypes.OpenPointInTimeResponse;
  try {
    pit = await es.openPointInTime({ index, keep_alive: '1m' });
  } catch (err) {
    throw unavailable(err, 'open point in time');
  }
  assertComplete(pit, 'open point in time');
  let id = pit.id;
  const out: T[] = [];
  try {
    for (let after: estypes.SortResults | undefined; ; ) {
      const res = await search<T>(es, {
        ...rest,
        pit: { id, keep_alive: '1m' },
        size: pageSize,
        sort: [...sort, { _shard_doc: 'asc' }],
        track_total_hits: false,
        ...(after ? { search_after: after } : {}),
      });
      id = res.pit_id ?? id;
      out.push(...sources(res));
      const hits = res.hits.hits;
      if (hits.length < pageSize) return out;
      after = hits[hits.length - 1].sort;
    }
  } finally {
    // It expires on its own if this fails.
    await es.closePointInTime({ id }).catch(() => undefined);
  }
}

/**
 * Every hit of a query, like `searchAll`, for reads on the request path: one ordinary search first, counting every
 * match; only when that leaves some out (more than one result window matched) is the whole result read through
 * `searchAll`. Most reads fit in the first, so they cost no point in time; none is ever cut off.
 */
export async function readAll<T>(
  es: Client,
  index: string,
  body: Pick<estypes.SearchRequest, 'query' | '_source'> & { sort?: estypes.SortCombinations[] },
): Promise<T[]> {
  const first = await search<T>(es, { index, ...body, size: MAX_DOCS, track_total_hits: true });
  const total = first.hits.total;
  const complete = typeof total === 'object' && total.relation === 'gte' ? false : first.hits.hits.length >= totalHits(first);
  return complete ? sources(first) : searchAll<T>(es, index, body);
}

/** Elasticsearch's default result window, and the most buckets one terms aggregation is asked for here. */
export const MAX_DOCS = 10_000;

/** `xs` in consecutive slices of at most `size` – for terms queries and aggregations over more ids than one request should carry. */
export function chunks<T>(xs: T[], size = MAX_DOCS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
