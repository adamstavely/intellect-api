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
 * Every hit of a query, read a page at a time through a point in time (search_after on `_shard_doc`), so nothing is
 * cut off at a result window and the pages are one consistent snapshot.
 */
export async function searchAll<T>(
  es: Client,
  index: string,
  body: Pick<estypes.SearchRequest, 'query' | '_source'>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  let id = (await es.openPointInTime({ index, keep_alive: '1m' })).id;
  const out: T[] = [];
  try {
    for (let after: estypes.SortResults | undefined; ; ) {
      const res = await es.search<T>({
        ...body,
        pit: { id, keep_alive: '1m' },
        size: pageSize,
        sort: [{ _shard_doc: 'asc' }],
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

/** Hard cap on result windows for per-portfolio queries (~200 topics, tens of records each). */
export const MAX_DOCS = 10_000;
