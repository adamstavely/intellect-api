import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Client } from '@elastic/elasticsearch';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { migrate } from '../../src/elastic/migrate';
import { buildSeed, seed } from '../../src/seed/seed';
import { resetCluster, testClient } from './es';

const TODAY = '2026-11-06';

type Body = Record<string, any>;

describe('read endpoints', () => {
  let es: Client;
  let app: INestApplication<App>;

  const get = async (path: string, user = 'hv', status = 200): Promise<Body> => {
    const res = await request(app.getHttpServer()).get(path).set('X-Intellect-User', user).expect(status);
    return res.body as Body;
  };
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  beforeAll(async () => {
    es = testClient();
    await resetCluster(es);
    await migrate(es);
    await seed(es, TODAY);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue({ today: () => TODAY })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await es.close();
  });

  describe('GET /portfolio/summary', () => {
    it('aggregates the whole portfolio for the Chief', async () => {
      const { docs } = await buildSeed(TODAY);
      const viewsYtd = docs['paper-metrics'].filter((m) => m.doc.month >= '2026-01').reduce((s, m) => s + m.doc.views, 0);
      const body = await get('/portfolio/summary');
      expect(body).toMatchObject({
        period: { label: 'ytd', from: '2026-01-01', to: TODAY },
        topics: 12,
        activeQuestions: 7,
        openGaps: 11,
        workInFlight: 8,
        healthMix: { healthy: 9, watch: 0, atRisk: 3 },
        binMix: [
          { bin: 1, topics: 2, atRisk: 2 },
          { bin: 2, topics: 4, atRisk: 1 },
          { bin: 3, topics: 3, atRisk: 0 },
          { bin: 4, topics: 3, atRisk: 0 },
        ],
        papersInPeriod: 2,
        collaborationInPeriod: { unilateral: 1, joint: 1 },
        readsInPeriod: viewsYtd,
      });
      expect(body.gapsCovered).toBeCloseTo(4 / 11, 2);
      expect(body.readTrend).toHaveLength(12);
      expect(body.readTrend[11].month).toBe('2026-11');
    });

    it('is scoped for a PI', async () => {
      expect(await get('/portfolio/summary?period=FY26', 'mo')).toMatchObject({ period: { from: '2025-10-01', to: '2026-09-30' }, topics: 2, openGaps: 5 });
    });

    it('rejects an unknown period', async () => {
      await get('/portfolio/summary?period=soon', 'hv', 400);
    });
  });

  describe('GET /topics', () => {
    it('sorts by risk and includes the lead', async () => {
      const body = (await get('/topics?sort=risk')) as unknown as Body[];
      expect(body).toHaveLength(12);
      expect(body.slice(0, 3).map((t) => t.health)).toEqual(['at-risk', 'at-risk', 'at-risk']);
      expect(body[2]).toMatchObject({ id: 't-carbon', healthScore: 15, lead: { id: 'sa', name: 'Sofia Almeida' } });
    });

    it('filters by bin and health, within scope', async () => {
      expect(ids((await get('/topics?bin=1&sort=name')) as never)).toEqual(['t-carbon', 't-neuro']);
      expect(ids((await get('/topics?health=healthy', 'mo')) as never)).toEqual(['t-advml']);
    });

    it('validates query params', async () => {
      await get('/topics?sort=bogus', 'hv', 400);
      await get('/topics?bin=5', 'hv', 400);
      await get('/topics?nope=1', 'hv', 400);
    });
  });

  describe('GET /topics/:id', () => {
    it('returns the header and resourcing strip', async () => {
      expect(await get('/topics/t-carbon', 'sa')).toMatchObject({
        id: 't-carbon',
        team: { id: 'team-energy-and-materials', name: 'Energy & Materials' },
        center: { id: 'sl-energy' },
        stats: { papers: 1, collaboration: { unilateral: 0, joint: 1 } },
        people: [
          { person: { id: 'rb' }, fte: 0.6 },
          { person: { id: 'sa' }, fte: 0.5 },
        ],
      });
    });

    it('404s outside scope and for unknown topics', async () => {
      await get('/topics/t-carbon', 'mo', 404);
      await get('/topics/t-missing', 'hv', 404);
    });
  });

  describe('GET /topics/:id/spine', () => {
    it('returns every stage and the edges between them', async () => {
      const body = await get('/topics/t-neuro/spine');
      expect([body.questions, body.gaps, body.work, body.papers, body.citations].map((x: unknown[]) => x.length)).toEqual([4, 5, 4, 2, 5]);
      expect(body.edges).toEqual(
        expect.arrayContaining([
          { from: 'q1', to: 'g2', kind: 'question-gap' },
          { from: 'g5', to: 'w4', kind: 'gap-work' },
          { from: 'w3', to: 'p4', kind: 'work-paper' },
          { from: 'g1', to: 'p1', kind: 'gap-paper' },
          { from: 'p1', to: 'c3', kind: 'paper-citation' },
        ]),
      );
    });

    it('404s outside scope', async () => {
      await get('/topics/t-climate/spine', 'mo', 404);
    });
  });

  describe('GET /gaps', () => {
    it('lists uncovered open gaps by severity, then topic health', async () => {
      const body = (await get('/gaps?attention=true&limit=5')) as unknown as Body[];
      expect(ids(body as never)).toEqual(['g10', 'g2', 'g9', 'g3', 'g8']);
      expect(body.every((g) => g.covered === false)).toBe(true);
      expect(body[0]).toMatchObject({ topic: { id: 't-climate', health: 'at-risk' }, owner: { id: 'am' } });
    });

    it('is scoped and filterable', async () => {
      const body = (await get('/gaps?topicId=t-neuro')) as unknown as Body[];
      expect(body).toHaveLength(5);
      expect(body.filter((g) => g.covered).map((g) => g.id).sort()).toEqual(['g1', 'g5']);
      expect(await get('/gaps?topicId=t-climate', 'mo')).toEqual([]);
      await get('/gaps?limit=0', 'hv', 400);
    });
  });

  describe('GET /papers', () => {
    it('lists papers with lifetime totals, authors and topic', async () => {
      const body = (await get('/papers?sort=reads')) as unknown as Body[];
      expect(ids(body as never)).toEqual(['p1', 'p5', 'p4']);
      expect(body[0]).toMatchObject({
        topic: { id: 't-neuro', name: 'Neuromorphic Computing' },
        authors: [{ id: 'mo' }, { id: 'ec' }, { id: 'jt' }],
        totals: { downloads: 18420, views: 46100, citations: 73, altmetric: 284, mentions: { social: 128 } },
      });
      expect(await get('/papers?grade=ungraded')).toHaveLength(3);
      expect(await get('/papers?grade=outstanding')).toHaveLength(0);
    });

    it('ranks the top papers by views in the period', async () => {
      const body = (await get('/papers/top?limit=2&period=FY26')) as unknown as Body[];
      expect(body).toHaveLength(2);
      expect(body[0].periodTotals.views).toBeGreaterThanOrEqual(body[1].periodTotals.views);
      expect(ids((await get('/papers/top', 'sa')) as never)).toEqual(['p5']);
    });

    it('returns detail with monthly metrics and citations', async () => {
      const body = await get('/papers/p1');
      expect(body.metrics).toHaveLength(12);
      expect(body.citations).toHaveLength(3);
      expect(body.audience).toEqual({ academic: 54, industry: 23, government: 14, nonprofit: 9 });
      expect(body.geo[0]).toEqual({ country: 'United States', share: 38 });
    });

    it('404s outside scope', async () => {
      await get('/papers/p5', 'mo', 404);
      await get('/papers/nope', 'hv', 404);
    });
  });

  describe('GET /org', () => {
    it('nests centers → teams → topics with roll-ups', async () => {
      const body = await get('/org');
      expect(body.centers).toHaveLength(3);
      const intel = (body.centers as Body[]).find((c) => c.id === 'sl-intel')!;
      expect(intel.teams.map((t: Body) => t.id).sort()).toEqual(['team-autonomy', 'team-cognitive-systems']);
      expect(intel.rollup).toMatchObject({ topics: 4, healthMix: { healthy: 3, atRisk: 1 }, papers: 2, collaboration: { unilateral: 1, joint: 1 } });
      expect(body.otherTeams).toEqual([]);
    });

    it('shows a PI only units with their topics', async () => {
      const body = await get('/org', 'mo');
      expect(ids(body.centers as never)).toEqual(['sl-intel']);
      expect(body.centers[0].teams).toHaveLength(1);
      expect(ids(body.centers[0].teams[0].topics as never)).toEqual(['t-neuro', 't-advml']);
    });
  });

  describe('GET /search', () => {
    it('searches topics, gaps, papers and people by prefix', async () => {
      const body = await get('/search?q=carb');
      expect(ids(body.topics as never)).toEqual(['t-carbon']);
      expect(ids((await get('/search?q=mineraliz')).papers as never)).toEqual(['p5']);
      expect(ids((await get('/search?q=helena')).people as never)).toEqual(['hv']);
    });

    it('is scoped', async () => {
      const body = await get('/search?q=carb', 'mo');
      expect(body.topics).toEqual([]);
      expect(body.papers).toEqual([]);
    });

    it('requires q', async () => {
      await get('/search', 'hv', 400);
    });
  });

  describe('recent papers', () => {
    // Two papers last month and one this month on t-neuro, one last month on t-carbon; removed afterwards.
    const extra = [
      { id: 'px-1', topicId: 't-neuro', published: '2026-10-03' },
      { id: 'px-2', topicId: 't-neuro', published: '2026-10-31' },
      { id: 'px-3', topicId: 't-neuro', published: '2026-11-02' },
      { id: 'px-4', topicId: 't-carbon', published: '2026-10-15' },
      { id: 'px-5', topicId: 't-neuro', published: '2026-09-30' },
    ];
    beforeAll(async () => {
      await es.bulk({
        refresh: 'wait_for',
        operations: extra.flatMap((p) => [{ index: { _index: 'papers', _id: p.id } }, { ...p, title: p.id, partners: [] }]),
      });
    });
    afterAll(async () => {
      await es.bulk({ refresh: 'wait_for', operations: extra.map((p) => ({ delete: { _index: 'papers', _id: p.id } })) });
    });

    it('counts last month and this month per topic', async () => {
      const topics = (await get('/topics')) as unknown as Body[];
      expect(topics.find((t) => t.id === 't-neuro')!.recentPapers).toEqual({ lastMonth: 2, thisMonth: 1 });
      expect(topics.find((t) => t.id === 't-carbon')!.recentPapers).toEqual({ lastMonth: 1, thisMonth: 0 });
      expect(topics.find((t) => t.id === 't-grid')!.recentPapers).toEqual({ lastMonth: 0, thisMonth: 0 });
      expect((await get('/topics/t-neuro')).recentPapers).toEqual({ lastMonth: 2, thisMonth: 1 });
    });

    it('sums them per center and team, with work and mean health trend', async () => {
      const body = await get('/org');
      const intel = (body.centers as Body[]).find((c) => c.id === 'sl-intel')!;
      expect(intel.rollup.recentPapers).toEqual({ lastMonth: 2, thisMonth: 1 });
      expect(intel.rollup.trend).toHaveLength(12);
      expect(typeof intel.rollup.momentum).toBe('number');
      expect(intel.rollup.work).toBeGreaterThan(0);
      const energy = (body.centers as Body[]).find((c) => c.id === 'sl-energy')!;
      expect(energy.rollup.recentPapers).toEqual({ lastMonth: 1, thisMonth: 0 });
    });
  });

  describe('GET /people', () => {
    it('lists everyone for the Chief, with load', async () => {
      const body = (await get('/people')) as unknown as Body[];
      expect(body).toHaveLength(11);
      expect(body.find((p) => p.id === 'am')).toMatchObject({ load: 1.2, overCapacity: true });
    });

    it('limits a PI to themselves and people on their topics', async () => {
      expect(ids((await get('/people', 'mo')) as never)).toEqual(['ec', 'jt', 'mo']);
      expect(await get('/people/jt', 'mo')).toMatchObject({ topics: [{ topic: { id: 't-neuro' } }, { topic: { id: 't-advml' } }] });
      await get('/people/sa', 'mo', 404);
    });
  });
});
