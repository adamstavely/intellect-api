import type { Client } from '@elastic/elasticsearch';
import type { Clock } from '../../src/common/clock';
import { ALIASES, INDICES } from '../../src/elastic/indices';
import { migrate } from '../../src/elastic/migrate';
import type { Person } from '../../src/model/types';
import { PapersService } from '../../src/papers/papers.service';
import { ScopeService } from '../../src/scope/scope.service';
import type { TopicRollupService } from '../../src/topic-health/topic-rollup.service';
import { resetCluster, testClient } from './es';

/** A disposable paper-metrics index with two primary shards, put behind the alias for this suite and deleted after. */
const TWO_SHARDS = 'paper-metrics-two-shards';
const chief = { id: 'hv', role: 'chief' } as Person;

describe('paper metrics over two primary shards', () => {
  let es: Client;
  let papers: PapersService;

  /** Routing values that put a document on shard 0 and on shard 1 of the two-shard index. */
  async function routingPerShard(): Promise<[string, string]> {
    const byShard = new Map<number, string>();
    for (let i = 0; byShard.size < 2; i++) {
      const { shards } = await es.searchShards({ index: TWO_SHARDS, routing: `r${i}` });
      byShard.set(shards[0][0].shard, byShard.get(shards[0][0].shard) ?? `r${i}`);
    }
    return [byShard.get(0)!, byShard.get(1)!];
  }

  const month = (paperId: string, m: string, views: number, altmetric = 0) => ({
    paperId,
    topicId: 't-1',
    month: m,
    views,
    downloads: 0,
    citations: 0,
    altmetric,
    mentions: { news: 0, policy: 0, social: 0, patents: 0 },
  });

  beforeAll(async () => {
    es = testClient();
    await resetCluster(es);
    await migrate(es);
    const def = INDICES.find((d) => d.alias === ALIASES.paperMetrics)!;
    await es.indices.create({ index: TWO_SHARDS, settings: { number_of_shards: 2, number_of_replicas: 0 }, mappings: def.mappings });
    const migrated = Object.keys(await es.indices.getAlias({ name: ALIASES.paperMetrics }));
    await es.indices.updateAliases({
      actions: [...migrated.map((index) => ({ remove: { index, alias: ALIASES.paperMetrics } })), { add: { index: TWO_SHARDS, alias: ALIASES.paperMetrics } }],
    });
    const [onFirst, onSecond] = await routingPerShard();

    // The review's case: p-split is read 90 times on each shard (180 in all); p-one 100 times, all on the first,
    // behind which eleven papers read 95 times crowd p-split out of that shard's leaders.
    const fillers = Array.from({ length: 11 }, (_, i) => `p-f${String(i).padStart(2, '0')}`);
    const docs: [string, object][] = [
      [onFirst, month('p-split', '2026-10', 90)],
      [onSecond, month('p-split', '2026-11', 90)],
      [onFirst, month('p-one', '2026-10', 100)],
      ...fillers.map((id): [string, object] => [onFirst, month(id, '2026-10', 95)]),
      // Attention that falls, and one corrected to zero, their months on different shards.
      [onFirst, month('p-down', '2026-10', 1, 100)],
      [onSecond, month('p-down', '2026-11', 1, 40)],
      [onSecond, month('p-zero', '2026-09', 1, 70)],
      [onFirst, month('p-zero', '2026-10', 1, 0)],
    ];
    await es.bulk({
      refresh: true,
      operations: docs.flatMap(([routing, doc]) => [{ index: { _index: TWO_SHARDS, routing } }, doc]),
    });
    const ids = ['p-split', 'p-one', 'p-down', 'p-zero', ...fillers];
    await es.bulk({
      refresh: true,
      operations: ids.flatMap((id) => [
        { index: { _index: ALIASES.papers, _id: id } },
        { id, topicId: 't-1', title: id, venue: 'arXiv', published: '2026-06-01', authorIds: [], partners: [] },
      ]),
    });
    // Both shards really hold some of each split paper: the setup the ranking must see through.
    const perShard = await Promise.all(
      ['_shards:0', '_shards:1'].map((preference) => es.count({ index: TWO_SHARDS, preference, query: { term: { paperId: 'p-split' } } })),
    );
    expect(perShard.map((c) => c.count)).toEqual([1, 1]);

    papers = new PapersService(es, new ScopeService(es), { today: () => '2026-11-15' } satisfies Clock, {} as TopicRollupService);
  });

  afterAll(async () => {
    await es.indices.delete({ index: TWO_SHARDS }, { ignore: [404] });
    await es.close();
  });

  it('ranks the most-read paper first though its reads are split over both shards', async () => {
    const [top] = await papers.top(chief, { period: 'FY27', limit: 1 });
    expect([top.id, top.periodTotals.views]).toEqual(['p-split', 180]);
    expect((await papers.top(chief, { period: 'FY27', limit: 3 })).map((p) => [p.id, p.periodTotals.views])).toEqual([
      ['p-split', 180],
      ['p-one', 100],
      ['p-f00', 95],
    ]);
  });

  it('gives the latest month’s attention score, not the highest, when it falls or is corrected to zero', async () => {
    const list = new Map((await papers.list(chief, {})).map((p) => [p.id, p]));
    expect(list.get('p-down')!.totals.altmetric).toBe(40);
    expect(list.get('p-zero')!.totals.altmetric).toBe(0);
    const october = new Map((await papers.list(chief, { period: '2026-10' })).map((p) => [p.id, p]));
    expect(october.get('p-down')!.periodTotals!.altmetric).toBe(100);
    expect(october.get('p-zero')!.periodTotals!.altmetric).toBe(0);
    const top = new Map((await papers.top(chief, { period: 'FY27', limit: 20 })).map((p) => [p.id, p]));
    expect(top.get('p-down')).toMatchObject({ totals: { altmetric: 40 }, periodTotals: { altmetric: 40 } });
    expect(top.get('p-zero')!.totals.altmetric).toBe(0);
  });
});
