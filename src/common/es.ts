import type { Client, estypes } from '@elastic/elasticsearch';

/** `_source` of every hit. */
export const sources = <T>(res: { hits: { hits: { _source?: T }[] } }): T[] =>
  res.hits.hits.map((h) => h._source).filter((s): s is T => s !== undefined);

export const totalHits = (res: { hits: { total?: estypes.SearchTotalHits | number } }): number =>
  typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);

/** Fetches docs by id into a map; ids that don't exist are left out. */
export async function getMany<T>(es: Client, index: string, ids: string[], fields?: string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const res = await es.mget<T>({ index, ids: unique, ...(fields ? { _source: fields } : {}) });
  const out = new Map<string, T>();
  for (const d of res.docs) if ('found' in d && d.found && d._source) out.set(d._id, d._source);
  return out;
}

/** Hard cap on result windows for per-portfolio queries (~200 topics, tens of records each). */
export const MAX_DOCS = 10_000;
