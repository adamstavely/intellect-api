import { Client } from '@elastic/elasticsearch';
import { INDICES, templateName } from '../../src/elastic/indices';

export const testClient = (): Client => new Client({ node: process.env.ES_NODE! });

/** Drops every Intellect index, alias and template so each suite starts from an empty cluster. */
export async function resetCluster(es: Client): Promise<void> {
  // Deletes need concrete names (action.destructive_requires_name), so resolve the wildcards first.
  const existing = await es.indices.get({ index: INDICES.map((d) => `${d.alias}-v*`), allow_no_indices: true });
  const names = Object.keys(existing);
  if (names.length > 0) await es.indices.delete({ index: names });
  for (const def of INDICES) {
    await es.indices.deleteIndexTemplate({ name: templateName(def) }, { ignore: [404] });
  }
}
