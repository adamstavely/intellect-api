import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Client } from '@elastic/elasticsearch';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { Clock } from '../../src/common/clock';
import { ES_CLIENT } from '../../src/elastic/elastic.module';
import { INDICES } from '../../src/elastic/indices';
import { migrate } from '../../src/elastic/migrate';
import type { Paper, Question, Topic, Work } from '../../src/model/types';
import { seed } from '../../src/seed/seed';
import { reconcile } from '../../src/topic-health/reconcile';
import { resetCluster, testClient } from './es';

const TODAY = '2026-11-06';

describe('writes, brief and reconcile', () => {
  let es: Client;
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());

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

  describe('PATCH /papers/:id/grade', () => {
    const grade = (user: string, id: string, body: unknown) => http().patch(`/papers/${id}/grade`).set('X-Intellect-User', user).send(body as object);

    it('is Chief only', async () => {
      await grade('mo', 'p1', { grade: 'excellent' }).expect(403);
    });

    it('validates the grade', async () => {
      await grade('hv', 'p1', { grade: 'great' }).expect(400);
      await grade('hv', 'p1', {}).expect(400);
      await grade('hv', 'nope', { grade: 'excellent' }).expect(404);
    });

    it('sets the grade, records who and when, and rolls it up to the topic', async () => {
      const res = await grade('hv', 'p1', { grade: 'outstanding' }).expect(200);
      expect(res.body).toMatchObject({ id: 'p1', grade: 'outstanding', gradedBy: 'hv' });
      expect(Date.parse(res.body.gradedAt)).not.toBeNaN();
      const topic = (await es.get<Topic>({ index: 'topics', id: 't-neuro' }))._source!;
      expect(topic.stats.grades).toEqual({ outstanding: 1, excellent: 0, satisfactory: 0, dissatisfactory: 0, ungraded: 1 });
    });

    it('clears the grade with null', async () => {
      const res = await grade('hv', 'p1', { grade: null }).expect(200);
      expect(res.body).toMatchObject({ grade: null, gradedBy: null, gradedAt: null });
      expect((await es.get<Topic>({ index: 'topics', id: 't-neuro' }))._source!.stats.grades.ungraded).toBe(2);
    });
  });

  describe('POST /topics', () => {
    const create = (user: string, body: object) => http().post('/topics').set('X-Intellect-User', user).send(body);
    const base = { name: 'Neuromorphic Sensing', bin: 3, teamId: 'team-cognitive-systems', leadId: 'mo' };

    it('lets a PI create a topic they lead, with opening questions', async () => {
      const res = await create('mo', { ...base, tags: ['edge', ' edge '], questions: ['Can event cameras run at 1 mW?'], budget: { allocated: 0.4 }, plannedFte: 2.5 }).expect(201);
      expect(res.body).toMatchObject({
        id: 't-neuromorphic-sensing',
        priorityLabel: 'Core',
        priorityType: 'internal',
        teamId: 'team-cognitive-systems',
        centerId: 'c-cci',
        tags: ['edge'],
        budget: { allocated: 0.4, spent: 0, fy: 'FY27' },
        plannedFte: 2.5,
        health: 'healthy',
        stats: { questions: 1, gaps: 0, coverage: 1 },
        lead: { id: 'mo' },
      });
      const spine = await http().get('/topics/t-neuromorphic-sensing/spine').set('X-Intellect-User', 'mo').expect(200);
      expect(spine.body.questions).toEqual([expect.objectContaining({ text: 'Can event cameras run at 1 mW?', status: 'open', ownerId: 'mo' })]);
      const me = await http().get('/me').set('X-Intellect-User', 'mo').expect(200);
      expect(me.body.scope.topicIds).toContain('t-neuromorphic-sensing');
    });

    it('gives a clashing name a suffixed id', async () => {
      const res = await create('hv', base).expect(201);
      expect(res.body.id).toBe('t-neuromorphic-sensing-2');
      expect(res.body.plannedFte).toBe(0);
      const national = await create('hv', { ...base, priorityType: 'national' }).expect(201);
      expect(national.body.priorityType).toBe('national');
      await create('hv', { ...base, priorityType: 'regional' }).expect(400);
    });

    it('rejects a PI naming someone else as lead, and non-PI staff', async () => {
      await create('mo', { ...base, leadId: 'sa' }).expect(403);
      await create('jt', { ...base, leadId: 'jt' }).expect(403);
    });

    it('validates the body and references', async () => {
      await create('hv', { ...base, bin: 7 }).expect(400);
      await create('hv', { ...base, name: '' }).expect(400);
      await create('hv', { ...base, health: 'healthy' }).expect(400);
      await create('hv', { ...base, teamId: 'c-cci' }).expect(400);
      await create('hv', { ...base, leadId: 'nobody' }).expect(400);
      await create('hv', { ...base, plannedFte: 25 }).expect(400);
      await create('hv', { ...base, plannedFte: 1.25 }).expect(400);
    });

    it('trims before validating, so blank names, tags and questions fail', async () => {
      await create('hv', { ...base, name: '   ' }).expect(400);
      await create('hv', { ...base, tags: [' '] }).expect(400);
      await create('hv', { ...base, questions: ['\t'] }).expect(400);
    });

    describe('when the opening questions fail', () => {
      const appEs = () => app.get<Client>(ES_CLIENT);
      const keyed = (key: string, body: object) => create('hv', body).set('Idempotency-Key', key);
      const questionsOf = async (topicId: string) => {
        await es.indices.refresh({ index: 'questions' });
        const res = await es.search<Question>({ index: 'questions', query: { term: { topicId } } });
        return res.hits.hits.map((h) => h._source!.text).sort();
      };
      const exists = (id: string) => es.exists({ index: 'topics', id });
      /** Fails the next questions bulk write; other bulk writes (the audit trail's) go through. */
      const failQuestionsOnce = () => {
        const client = appEs();
        const bulk = client.bulk.bind(client);
        let failed = false;
        jest.spyOn(client, 'bulk').mockImplementation(((params: { operations?: { create?: { _index?: string } }[] }) => {
          if (!failed && params.operations?.[0]?.create?._index === 'questions') {
            failed = true;
            return Promise.reject(new Error('connection reset'));
          }
          return bulk(params);
        }) as never);
      };
      afterEach(() => jest.restoreAllMocks());

      it('removes the topic when the bulk request itself fails', async () => {
        failQuestionsOnce();
        const res = await create('hv', { ...base, name: 'Thermal Imaging', questions: ['Q1'] }).expect(500);
        expect(res.body.message).toBe('Could not save the opening questions; the topic was not created');
        expect(await exists('t-thermal-imaging')).toBe(false);
      });

      const requestStatus = async (key: string) => {
        const res = await es.search<{ key: string; status?: string }>({ index: 'topic-requests', query: { term: { key: `hv:${key}` } } });
        return res.hits.hits[0]?._source?.status;
      };

      it('keeps a keyed topic when its questions fail, and finishes it on a retry with the same Idempotency-Key', async () => {
        const body = { ...base, name: 'Lidar Fusion', questions: ['Q1', 'Q2'] };
        failQuestionsOnce();
        const deleteByQuery = jest.spyOn(appEs(), 'deleteByQuery');
        const failed = await keyed('k-lidar-1', body).expect(500);
        expect(failed.body.message).toMatch(/t-lidar-fusion; retry with the same Idempotency-Key/);
        // Another attempt under the key may have finished it, so nothing is removed.
        expect(deleteByQuery).not.toHaveBeenCalled();
        expect(await exists('t-lidar-fusion')).toBe(true);
        expect(await requestStatus('k-lidar-1')).toBe('pending');
        jest.restoreAllMocks();

        const retried = await keyed('k-lidar-1', body).expect(201);
        expect(retried.body).toMatchObject({ id: 't-lidar-fusion', stats: { questions: 2 } });
        expect(retried.body).not.toHaveProperty('idempotencyKey');
        expect(await requestStatus('k-lidar-1')).toBe('completed');
        // A repeat after success returns the same topic and writes nothing new.
        expect((await keyed('k-lidar-1', body).expect(201)).body.id).toBe('t-lidar-fusion');
        expect(await questionsOf('t-lidar-fusion')).toEqual(['Q1', 'Q2']);
        expect(await exists('t-lidar-fusion-2')).toBe(false);
      });

      it('finishes the same topic on a retry when the questions were written but the response timed out', async () => {
        const body = { ...base, name: 'Sonar Array', questions: ['Q1', 'Q2'] };
        const client = appEs();
        const bulk = client.bulk.bind(client);
        let timedOut = false;
        jest.spyOn(client, 'bulk').mockImplementation(((params: { operations?: { create?: { _index?: string } }[] }) => {
          if (!timedOut && params.operations?.[0]?.create?._index === 'questions') {
            timedOut = true;
            return bulk(params as never).then(() => Promise.reject(new Error('Request timed out')));
          }
          return bulk(params);
        }) as never);
        await keyed('k-sonar', body).expect(500);
        expect(await requestStatus('k-sonar')).toBe('pending');
        expect(await questionsOf('t-sonar-array')).toEqual(['Q1', 'Q2']);
        jest.restoreAllMocks();

        const retried = await keyed('k-sonar', body).expect(201);
        expect(retried.body).toMatchObject({ id: 't-sonar-array', stats: { questions: 2 } });
        expect(await requestStatus('k-sonar')).toBe('completed');
        expect(await questionsOf('t-sonar-array')).toEqual(['Q1', 'Q2']);
        expect(await exists('t-sonar-array-2')).toBe(false);
      });

      it('refuses a key reused for a different topic or with different details, and keeps keys per user', async () => {
        await keyed('k-lidar-1', { ...base, name: 'Something Else' }).expect(409);
        await keyed('k-lidar-1', { ...base, name: 'Lidar Fusion', questions: ['Q1', 'Q2'], priorityType: 'national' }).expect(409);
        await keyed('k-lidar-1', { ...base, name: 'Lidar Fusion', questions: ['Q1', 'Q2', 'Q3'] }).expect(409);
        const mo = await create('mo', { ...base, name: 'Lidar Fusion' }).set('Idempotency-Key', 'k-lidar-1').expect(201);
        expect(mo.body.id).toBe('t-lidar-fusion-2');
        await keyed('not a key!', base).expect(400);
      });
    });

    it('makes one topic when requests with the same Idempotency-Key race', async () => {
      const body = { ...base, name: 'Radar Mesh', questions: ['Q1'] };
      const results = await Promise.all([1, 2, 3, 4].map(() => create('hv', body).set('Idempotency-Key', 'k-radar')));
      expect(results.map((r) => [r.status, r.body.id])).toEqual(Array(4).fill([201, 't-radar-mesh']));
      await es.indices.refresh({ index: 'topics' });
      const named = await es.search<Topic>({ index: 'topics', query: { prefix: { id: 't-radar-mesh' } } });
      expect(named.hits.hits.map((h) => h._id)).toEqual(['t-radar-mesh']);
      // And the key is spent on that request: a different one under it is refused even when racing.
      const racing = await Promise.all([create('hv', { ...body, name: 'Radar Mesh 2' }).set('Idempotency-Key', 'k-radar-2'), create('hv', { ...body, name: 'Other' }).set('Idempotency-Key', 'k-radar-2')]);
      expect(racing.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  describe('GET /search by tag', () => {
    it('finds a tag whatever its case', async () => {
      await http().post('/topics').set('X-Intellect-User', 'hv').send({ name: 'Hypersonic Flow', bin: 2, teamId: 'team-cognitive-systems', leadId: 'mo', tags: ['DARPA'] }).expect(201);
      for (const q of ['DARPA', 'darpa']) {
        const res = await http().get(`/search?q=${q}`).set('X-Intellect-User', 'hv').expect(200);
        expect(res.body.topics.map((t: { id: string }) => t.id)).toContain('t-hypersonic-flow');
      }
    });
  });

  describe('GET /brief', () => {
    it('builds every section for the Chief', async () => {
      const res = await http().get('/brief?period=FY26-Q2').set('X-Intellect-User', 'hv').expect(200);
      const b = res.body;
      expect(b.period).toEqual({ label: 'FY26-Q2', from: '2026-01-01', to: '2026-03-31' });
      expect(b.preparedFor).toMatchObject({ id: 'hv' });
      expect(b.executiveSummary.length).toBeGreaterThanOrEqual(3);
      expect(b.centers).toHaveLength(11);
      expect(b.exposure.map((g: { severity: string }) => g.severity)).toEqual(expect.arrayContaining(['critical', 'high']));
      expect(b.investment.map((i: { bin: number }) => i.bin)).toEqual([1, 2, 3, 4]);
      expect(b.impact.length).toBeGreaterThan(0);
      expect(b.decisions).toEqual(
        expect.arrayContaining([expect.objectContaining({ tag: 'Operations', topicId: 't-neuro' }), expect.objectContaining({ lead: "Rebalance Arjun Mehta's allocation." })]),
      );
    });

    it('is scoped for a PI', async () => {
      const res = await http().get('/brief').set('X-Intellect-User', 'sa').expect(200);
      expect(res.body.atAGlance.topics).toBe(2);
      expect(res.body.centers.map((c: { id: string }) => c.id)).toEqual(['c-nemc']);
      expect(res.body.exposure.every((g: { topicId: string }) => ['t-carbon', 't-grid'].includes(g.topicId))).toBe(true);
    });

    it('counts every exposed gap, past the first hundred', async () => {
      const exposed = async () => (await http().get('/brief').set('X-Intellect-User', 'hv').expect(200)).body.exposure.length as number;
      const before = await exposed();
      const gaps = Array.from({ length: 101 }, (_, i) => ({ id: `g-bulk-${i}`, topicId: 't-neuro', text: `Bulk gap ${i}`, severity: 'critical', status: 'open', ownerId: 'mo', questionIds: [] }));
      await es.bulk({ refresh: true, operations: gaps.flatMap((g) => [{ create: { _index: 'gaps', _id: g.id } }, g]) });
      try {
        expect(await exposed()).toBe(before + 101);
      } finally {
        await es.deleteByQuery({ index: 'gaps', query: { prefix: { id: 'g-bulk-' } }, refresh: true });
      }
    });
  });

  describe('reconcile', () => {
    it('reports and repairs drifted rollups and snapshots the month', async () => {
      await es.update({ index: 'topics', id: 't-carbon', doc: { healthScore: 99, stats: { openGaps: 42 } }, refresh: 'wait_for' });
      await es.delete({ index: 'topic-health-history', id: 't-carbon:2026-11', refresh: 'wait_for' });

      const report = await reconcile(es, TODAY);
      expect(report.month).toBe('2026-11');
      expect(report.drift).toEqual([{ topicId: 't-carbon', fields: ['stats', 'healthScore'] }]);

      const topic = (await es.get<Topic>({ index: 'topics', id: 't-carbon' }))._source!;
      expect(topic).toMatchObject({ healthScore: 15, stats: { openGaps: 3 } });
      const snap = await es.get({ index: 'topic-health-history', id: 't-carbon:2026-11' });
      expect(snap._source).toMatchObject({ healthScore: 15 });

      expect((await reconcile(es, TODAY)).drift).toEqual([]);
    });
  });

  describe('topic rollups past a thousand records', () => {
    it('count every gap, so an uncovered critical one past the thousandth still sets the health', async () => {
      const topic = async () => (await es.get<Topic>({ index: 'topics', id: 't-swarm' }))._source!;
      const before = await topic();
      expect(before.health).toBe('healthy');
      const gaps = Array.from({ length: 1200 }, (_, i) => ({
        id: `g-many-${String(i).padStart(4, '0')}`,
        topicId: 't-swarm',
        text: `Gap ${i}`,
        // The one that matters is written last.
        severity: i === 1199 ? 'critical' : 'medium',
        status: i === 1199 ? 'open' : 'closed',
        ownerId: 'mo',
        questionIds: [],
      }));
      await es.bulk({ refresh: true, operations: gaps.flatMap((g) => [{ create: { _index: 'gaps', _id: g.id } }, g]) });
      try {
        const report = await reconcile(es, TODAY);
        expect(report.drift).toEqual([expect.objectContaining({ topicId: 't-swarm' })]);
        const after = await topic();
        expect(after.stats).toMatchObject({ gaps: before.stats.gaps + 1200, openGaps: before.stats.openGaps + 1 });
        expect(after.stats.coverage).toBeLessThan(before.stats.coverage);
        expect(after.healthScore).toBeLessThanOrEqual(before.healthScore - 15);
      } finally {
        await es.deleteByQuery({ index: 'gaps', query: { prefix: { id: 'g-many-' } }, refresh: true });
        await reconcile(es, TODAY);
      }
    });
  });

  describe('GET /people for someone also on a topic outside the caller’s scope', () => {
    it('shows a PI only the shared topic’s allocation, the rest as one total, and the Chief everything', async () => {
      const jt = (await es.get<{ allocations: { topicId: string; fte: number }[] }>({ index: 'people', id: 'jt' }))._source!;
      await es.update({ index: 'people', id: 'jt', doc: { allocations: [...jt.allocations, { topicId: 't-carbon', fte: 0.2 }] }, refresh: 'wait_for' });
      try {
        const people = (user: string) => http().get('/people').set('X-Intellect-User', user).expect(200);
        const detail = (user: string) => http().get('/people/jt').set('X-Intellect-User', user).expect(200);

        const listed = (await people('mo')).body.find((p: { id: string }) => p.id === 'jt');
        const shown = (await detail('mo')).body;
        for (const p of [listed, shown]) {
          expect(p.allocations.map((a: { topicId: string }) => a.topicId)).toEqual(['t-neuro', 't-advml']);
          expect(p).toMatchObject({ load: 1.2, otherFte: 0.2, overCapacity: true });
          expect(JSON.stringify(p)).not.toContain('t-carbon');
        }
        expect(shown.topics.map((t: { topic: { id: string } }) => t.topic.id)).toEqual(['t-neuro', 't-advml']);

        const chiefListed = (await people('hv')).body.find((p: { id: string }) => p.id === 'jt');
        const chiefShown = (await detail('hv')).body;
        for (const p of [chiefListed, chiefShown]) {
          expect(p.allocations.map((a: { topicId: string }) => a.topicId)).toEqual(['t-neuro', 't-advml', 't-carbon']);
          expect(p).toMatchObject({ load: 1.2, otherFte: 0 });
        }
      } finally {
        await es.update({ index: 'people', id: 'jt', doc: { allocations: jt.allocations }, refresh: 'wait_for' });
      }
    });
  });

  describe('reads past one result window', () => {
    const bulkCreate = async (index: string, docs: { id: string }[]) => {
      const res = await es.bulk({ refresh: true, operations: docs.flatMap((d) => [{ create: { _index: index, _id: d.id } }, d]) });
      expect(res.errors).toBe(false);
    };

    it('counts a critical gap covered by the 10,001st work item in flight as covered', async () => {
      const attention = await http().get('/gaps?attention=true&severity=critical&limit=1').set('X-Intellect-User', 'hv').expect(200);
      const gap = attention.body[0] as { id: string; topicId: string };
      expect(gap).toBeDefined();
      const sample = (await es.search<Work>({ index: 'work', size: 1 })).hits.hits[0]._source!;
      // 10,000 items in flight on other gaps, then the one that covers it.
      const work = Array.from({ length: 10_001 }, (_, i) => ({
        ...sample,
        id: `w-many-${String(i).padStart(5, '0')}`,
        topicId: gap.topicId,
        gapIds: i === 10_000 ? [gap.id] : [`g-elsewhere-${i}`],
        status: i === 10_000 ? ('active' as const) : ('blocked' as const),
      }));
      await bulkCreate('work', work);
      try {
        const res = await http().get('/gaps?attention=true&limit=10000').set('X-Intellect-User', 'hv').expect(200);
        expect(res.body.map((g: { id: string }) => g.id)).not.toContain(gap.id);
        expect(Number(res.headers['x-total-count'])).toBe(res.body.length);
        const detail = await http().get(`/gaps?topicId=${gap.topicId}&limit=10000`).set('X-Intellect-User', 'hv').expect(200);
        expect(detail.body.find((g: { id: string }) => g.id === gap.id)).toMatchObject({ covered: true, activeWork: 1 });
      } finally {
        await es.deleteByQuery({ index: 'work', query: { prefix: { id: 'w-many-' } }, refresh: true });
      }
    });

    it('ranks papers by reads over all of them, past the newest 10,000', async () => {
      const before = (await http().get('/papers?sort=reads').set('X-Intellect-User', 'hv').expect(200)).body as { id: string; published: string }[];
      const mostRead = before[0];
      const sample = (await es.get<Paper>({ index: 'papers', id: mostRead.id }))._source!;
      const newer = Array.from({ length: 10_001 }, (_, i) => ({ ...sample, id: `p-many-${String(i).padStart(5, '0')}`, published: '2026-11-01', partners: [], initiatedBy: null }));
      await bulkCreate('papers', newer);
      try {
        const after = (await http().get('/papers?sort=reads').set('X-Intellect-User', 'hv').expect(200)).body as { id: string }[];
        expect(after).toHaveLength(before.length + 10_001);
        expect(after[0].id).toBe(mostRead.id);
      } finally {
        await es.deleteByQuery({ index: 'papers', query: { prefix: { id: 'p-many-' } }, refresh: true });
      }
    });
  });

  describe('migrate', () => {
    it('applies additive mapping changes in place', async () => {
      const def = INDICES.find((d) => d.alias === 'citations')!;
      const extended = { ...def, mappings: { ...def.mappings, properties: { ...def.mappings.properties, doi: { type: 'keyword' as const } } } };
      const [result] = await migrate(es, [extended]);
      expect(result).toEqual({ alias: 'citations', action: 'mapping-updated', index: 'citations-v1' });
      const mapping = await es.indices.getMapping({ index: 'citations' });
      expect(mapping['citations-v1'].mappings.properties?.doi).toEqual({ type: 'keyword' });
      expect((await migrate(es, [extended]))[0].action).toBe('up-to-date');
    });
  });
});
