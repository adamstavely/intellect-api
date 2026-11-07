import type { Client } from '@elastic/elasticsearch';
import { INDICES, indexName } from '../../src/elastic/indices';
import { migrate } from '../../src/elastic/migrate';
import { resetCluster, testClient } from './es';

describe('es:migrate', () => {
  let es: Client;

  beforeAll(async () => {
    es = testClient();
    await resetCluster(es);
  });
  afterAll(() => es.close());

  it('creates a versioned index and alias for every index in plan §1', async () => {
    const results = await migrate(es);
    expect(results.map((r) => r.action)).toEqual(INDICES.map(() => 'created'));
    expect(INDICES.map((d) => d.alias).sort()).toEqual(
      ['audit', 'audit-cursor', 'citations', 'gaps', 'org-units', 'paper-metrics', 'papers', 'people', 'questions', 'topic-health-history', 'topics', 'work'].sort(),
    );

    for (const def of INDICES) {
      const alias = await es.indices.getAlias({ name: def.alias });
      expect(Object.keys(alias)).toEqual([indexName(def)]);
      const mapping = await es.indices.getMapping({ index: def.alias });
      const m = mapping[indexName(def)].mappings;
      expect(m.dynamic).toBe('strict');
      // The audit cursor is a single settings document with no id field of its own.
      if (def.alias === 'audit-cursor') continue;
      const idField = def.alias === 'paper-metrics' ? 'paperId' : def.alias === 'topic-health-history' ? 'topicId' : 'id';
      expect(m.properties?.[idField]).toEqual({ type: 'keyword' });
    }
  });

  it('is idempotent', async () => {
    const results = await migrate(es);
    expect(results.every((r) => r.action === 'up-to-date')).toBe(true);
  });

  it('rejects fields that are not in the mapping', async () => {
    await expect(
      es.index({ index: 'topics', id: 'x', document: { id: 'x', notAField: 1 } }),
    ).rejects.toMatchObject({ meta: { body: { error: { type: 'strict_dynamic_mapping_exception' } } } });
  });

  it('reports needs-reindex when a definition moves to a new version', async () => {
    const bumped = INDICES.filter((d) => d.alias === 'citations').map((d) => ({ ...d, version: 2 }));
    const [result] = await migrate(es, bumped);
    expect(result).toEqual({ alias: 'citations', action: 'needs-reindex', index: 'citations-v2', current: ['citations-v1'] });
    // The alias is left on v1 until someone reindexes and swaps it.
    expect(Object.keys(await es.indices.getAlias({ name: 'citations' }))).toEqual(['citations-v1']);
    await es.indices.delete({ index: 'citations-v2' });
  });
});
