import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { Test } from '@nestjs/testing';
import type { Client } from '@elastic/elasticsearch';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { migrate } from '../../src/elastic/migrate';
import type { Person } from '../../src/model/types';
import { ScopeService } from '../../src/scope/scope.service';
import { seed } from '../../src/seed/seed';
import { resetCluster, testClient } from './es';

describe('scope filter and /me', () => {
  let es: Client;
  let app: INestApplication<App>;
  let scope: ScopeService;

  const person = async (id: string) => (await es.get<Person>({ index: 'people', id }))._source!;
  const topicIdsVisibleTo = async (id: string) => {
    const res = await es.search<{ id: string }>({
      index: 'topics',
      size: 100,
      query: { bool: { filter: [await scope.filter(await person(id), 'id')] } },
    });
    return res.hits.hits.map((h) => h._source!.id).sort();
  };

  beforeAll(async () => {
    es = testClient();
    await resetCluster(es);
    await migrate(es);
    await seed(es, '2026-11-06');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await app.init();
    scope = app.get(ScopeService);
  });

  afterAll(async () => {
    await app?.close();
    await es.close();
  });

  it('lets the Chief see every topic', async () => {
    expect(await topicIdsVisibleTo('hv')).toHaveLength(12);
  });

  it('limits a PI to topics they lead or have FTE on', async () => {
    expect(await topicIdsVisibleTo('mo')).toEqual(['t-advml', 't-neuro']);
  });

  it('includes topics a PI leads even without FTE on them', async () => {
    await es.update({ index: 'topics', id: 't-wildfire', doc: { leadId: 'mo' }, refresh: 'wait_for' });
    expect(await topicIdsVisibleTo('mo')).toEqual(['t-advml', 't-neuro', 't-wildfire']);
    await es.update({ index: 'topics', id: 't-wildfire', doc: { leadId: 'am' }, refresh: 'wait_for' });
  });

  it('limits staff to topics they have FTE on, across child indices', async () => {
    const filter = await scope.filter(await person('ec'));
    const res = await es.search({ index: 'gaps', size: 100, query: { bool: { filter: [filter] } } });
    expect(new Set(res.hits.hits.map((h) => (h._source as { topicId: string }).topicId))).toEqual(new Set(['t-neuro']));
  });

  it('GET /me returns the user and their scope', async () => {
    const res = await request(app.getHttpServer()).get('/me').set('X-Intellect-User', 'pr').expect(200);
    expect(res.body).toMatchObject({ id: 'pr', role: 'pi', scope: { all: false, topicIds: ['t-privacy', 't-quantum'] } });
  });

  it('GET /me rejects missing or unknown users', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
    await request(app.getHttpServer()).get('/me').set('X-Intellect-User', 'nobody').expect(401);
  });

  it('GET /health is public and reports Elasticsearch', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({ details: { elasticsearch: { status: 'up' } } });
  });
});
