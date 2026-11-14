import type { Client, estypes } from '@elastic/elasticsearch';

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
 * orders the whole result, not just one window of it.
 */
export async function searchAll<T>(
  es: Client,
  index: string,
  body: Pick<estypes.SearchRequest, 'query' | '_source'> & { sort?: estypes.SortCombinations[] },
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const { sort = [], ...rest } = body;
  let id = (await es.openPointInTime({ index, keep_alive: '1m' })).id;
  const out: T[] = [];
  try {
    for (let after: estypes.SortResults | undefined; ; ) {
      const res = await es.search<T>({
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
  const first = await es.search<T>({ index, ...body, size: MAX_DOCS, track_total_hits: true });
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
