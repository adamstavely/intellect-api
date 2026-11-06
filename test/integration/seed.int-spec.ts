import type { Client } from '@elastic/elasticsearch';
import { migrate } from '../../src/elastic/migrate';
import type { Topic } from '../../src/model/types';
import { seed } from '../../src/seed/seed';
import { TopicRollupService } from '../../src/topic-health/topic-rollup.service';
import { resetCluster, testClient } from './es';

const AS_OF = '2026-11-06';

describe('es:seed', () => {
  let es: Client;

  beforeAll(async () => {
    es = testClient();
    await resetCluster(es);
    await migrate(es);
  });
  afterAll(() => es.close());

  it('loads every index', async () => {
    const { counts, warnings } = await seed(es, AS_OF);
    expect(warnings).toEqual([]);
    expect(counts).toMatchObject({ topics: 12, people: 11, 'org-units': 9, 'topic-health-history': 144 });
    for (const [index, n] of Object.entries(counts)) {
      expect((await es.count({ index })).count).toBe(n);
    }
  });

  it('is repeatable: re-seeding replaces rather than duplicates', async () => {
    const { counts } = await seed(es, AS_OF);
    expect((await es.count({ index: 'topics' })).count).toBe(counts.topics);
    expect((await es.count({ index: 'paper-metrics' })).count).toBe(counts['paper-metrics']);
  });

  it('loads a topic spine with one msearch filtered on topicId', async () => {
    const byTopic = { query: { term: { topicId: 't-neuro' } }, size: 100 };
    const { responses } = await es.msearch({
      searches: ['questions', 'gaps', 'work', 'papers', 'citations'].flatMap((index) => [{ index }, byTopic]),
    });
    const counts = responses.map((r) => ('hits' in r ? r.hits.hits.length : -1));
    expect(counts).toEqual([4, 5, 4, 2, 5]);
  });

  it('supports reverse lookups with a terms query on the child link', async () => {
    const res = await es.search({ index: 'work', query: { terms: { gapIds: ['g5'] } } });
    expect(res.hits.hits.map((h) => h._id).sort()).toEqual(['w3', 'w4']);
  });

  it('stores rollups that match a fresh recompute from the records', async () => {
    const rollup = new TopicRollupService(es);
    const { _source: seeded } = await es.get<Topic>({ index: 'topics', id: 't-carbon' });
    const recomputed = await rollup.recompute('t-carbon', AS_OF);
    expect(recomputed.stats).toEqual(seeded!.stats);
    expect(recomputed.healthScore).toBe(seeded!.healthScore);
    expect(recomputed.trend).toEqual(seeded!.trend);
    expect(recomputed.momentum).toBe(seeded!.momentum);
  });

  it('recompute picks up record changes and survives a concurrent topic write', async () => {
    // Activate w6 (review → active): g7 becomes covered.
    await es.update({ index: 'work', id: 'w6', doc: { status: 'active' }, refresh: 'wait_for' });
    const rollup = new TopicRollupService(es);
    const [a, b] = await Promise.all([rollup.recompute('t-carbon', AS_OF), rollup.recompute('t-carbon', AS_OF)]);
    expect(a.stats.coverage).toBeCloseTo(0.667, 3);
    expect(b.stats.coverage).toBeCloseTo(0.667, 3);
    const { _source } = await es.get<Topic>({ index: 'topics', id: 't-carbon' });
    expect(_source!.stats.coverage).toBeCloseTo(0.667, 3);
  });
});
