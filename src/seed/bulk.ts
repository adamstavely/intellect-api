import type { Client } from '@elastic/elasticsearch';
import type { SeedDocuments } from './transform';

/** Bulk NDJSON body (action line + source line per document) for every index in `docs`. */
export function toBulkOperations(docs: SeedDocuments): object[] {
  return Object.entries(docs).flatMap(([index, items]: [string, { id: string; doc: object }[]]) =>
    items.flatMap(({ id, doc }) => [{ index: { _index: index, _id: id } }, doc]),
  );
}

export const toNdjson = (docs: SeedDocuments): string =>
  toBulkOperations(docs).map((line) => JSON.stringify(line)).join('\n') + '\n';

/**
 * Replaces the contents of every seeded index with `docs`. Dev/test only: it deletes whatever is
 * in those indices first so removed prototype records don't linger.
 */
export async function loadSeed(es: Client, docs: SeedDocuments): Promise<Record<string, number>> {
  const indices = Object.keys(docs);
  await es.deleteByQuery({ index: indices, query: { match_all: {} }, refresh: true, conflicts: 'proceed' });

  const res = await es.bulk({ operations: toBulkOperations(docs), refresh: 'wait_for' });
  if (res.errors) {
    const failures = res.items
      .map((item) => item.index)
      .filter((i) => i?.error)
      .slice(0, 5)
      .map((i) => `${i!._index}/${i!._id}: ${i!.error!.type} ${i!.error!.reason ?? ''}`);
    throw new Error(`Bulk seed failed:\n${failures.join('\n')}`);
  }
  return Object.fromEntries(Object.entries(docs).map(([index, items]: [string, unknown[]]) => [index, items.length]));
}
