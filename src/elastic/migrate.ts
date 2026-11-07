import type { Client } from '@elastic/elasticsearch';
import { INDICES, IndexDefinition, indexName, templateName } from './indices';

export type MigrationAction =
  | { alias: string; action: 'created'; index: string }
  | { alias: string; action: 'up-to-date'; index: string }
  | { alias: string; action: 'mapping-updated'; index: string }
  | { alias: string; action: 'needs-reindex'; index: string; current: string[] };

/**
 * Idempotent. For each index definition: upsert its index template, create the versioned index
 * if it's missing, and point the alias at it if the alias doesn't exist yet. When the alias
 * already points at an older version, it reports `needs-reindex` and leaves the alias alone:
 * reindexing and the alias swap are a deliberate, separate step.
 *
 * Additive changes (new fields) are applied to the live index in place. Anything Elasticsearch
 * can't apply in place (a changed field type) fails here; bump the definition's version instead.
 */
export async function migrate(es: Client, defs: IndexDefinition[] = INDICES): Promise<MigrationAction[]> {
  const results: MigrationAction[] = [];
  for (const def of defs) {
    const index = indexName(def);
    await es.indices.putIndexTemplate({
      name: templateName(def),
      index_patterns: [`${def.alias}-v*`],
      priority: 200,
      version: def.version,
      template: { mappings: def.mappings },
    });

    let created = false;
    if (!(await es.indices.exists({ index }))) {
      await es.indices.create({ index });
      created = true;
    }
    let mappingChanged = false;
    if (!created) {
      const before = (await es.indices.getMapping({ index }))[index].mappings;
      await es.indices.putMapping({ index, ...def.mappings });
      const after = (await es.indices.getMapping({ index }))[index].mappings;
      mappingChanged = JSON.stringify(before) !== JSON.stringify(after);
    }

    const current = (await es.indices.existsAlias({ name: def.alias }))
      ? Object.keys(await es.indices.getAlias({ name: def.alias }))
      : [];

    if (current.length === 0) {
      await es.indices.putAlias({ index, name: def.alias, is_write_index: true });
      results.push({ alias: def.alias, action: 'created', index });
    } else if (current.length === 1 && current[0] === index) {
      results.push({ alias: def.alias, action: mappingChanged ? 'mapping-updated' : 'up-to-date', index });
    } else {
      results.push({ alias: def.alias, action: 'needs-reindex', index, current });
    }
  }
  return results;
}
