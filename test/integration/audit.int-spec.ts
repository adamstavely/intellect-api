import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Client } from '@elastic/elasticsearch';
import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { AuditForwarder } from '../../src/audit/audit-forwarder.service';
import { AuditEvent, sign } from '../../src/audit/audit-event';
import { AuditService } from '../../src/audit/audit.service';
import { migrate } from '../../src/elastic/migrate';
import { seed } from '../../src/seed/seed';
import { resetCluster, testClient } from './es';

type Delivery = { headers: IncomingMessage['headers']; body: string };

describe('audit trail', () => {
  let es: Client;
  let app: INestApplication<App>;
  let hook: Server;
  const deliveries: Delivery[] = [];
  let hookStatus = 200;

  const call = (method: 'get' | 'patch', path: string, user?: string, body?: object) => {
    let req = request(app.getHttpServer())[method](path);
    if (user) req = req.set('X-Intellect-User', user);
    return body ? req.send(body) : req;
  };
  /** A copy of a stored event under a new id, as if never forwarded. */
  const copy = ({ forwardedAt: _sent, ...e }: AuditEvent, id: string): AuditEvent => ({ ...e, id });
  const audited = async (): Promise<AuditEvent[]> => {
    await app.get(AuditService).flush();
    await es.indices.refresh({ index: 'audit' });
    const res = await es.search<AuditEvent>({ index: 'audit', size: 100, sort: [{ at: 'asc' }, { id: 'asc' }] });
    return res.hits.hits.map((h) => h._source!);
  };

  beforeAll(async () => {
    hook = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        deliveries.push({ headers: req.headers, body });
        res.writeHead(hookStatus).end();
      });
    });
    await new Promise<void>((r) => hook.listen(0, '127.0.0.1', r));
    process.env.AUDIT_WEBHOOK_URL = `http://localhost:${(hook.address() as AddressInfo).port}/audit`;
    process.env.AUDIT_WEBHOOK_SECRET = 's3cret';
    // Long enough that the timer never fires mid-test: the tests drive forward() themselves.
    process.env.AUDIT_FORWARD_INTERVAL_MS = '3600000';
    // Send events as soon as they're stored; the tests refresh before forwarding.
    process.env.AUDIT_FORWARD_SETTLE_MS = '0';

    es = testClient();
    await resetCluster(es);
    await migrate(es);
    await seed(es, '2026-11-06');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await es.close();
    await new Promise((r) => hook.close(r));
    delete process.env.AUDIT_WEBHOOK_URL;
    delete process.env.AUDIT_WEBHOOK_SECRET;
    delete process.env.AUDIT_FORWARD_INTERVAL_MS;
    delete process.env.AUDIT_FORWARD_SETTLE_MS;
  });

  it('records every request: reads, refused writes and unknown users, with the request id', async () => {
    const read = await call('get', '/topics/t-neuro', 'hv').expect(200);
    await call('patch', '/papers/p4/grade', 'mo', { grade: 'excellent' }).expect(403);
    await call('get', '/topics', 'nobody').expect(401);
    await call('get', '/health').expect((r) => expect(r.status).toBeLessThan(500));

    const events = await audited();
    expect(events.map((e) => e.action)).toEqual(['GET /topics/:id', 'PATCH /papers/:id/grade', 'GET /topics']);
    const [view, grade, refused] = events;
    expect(view).toMatchObject({
      id: read.headers['x-request-id'],
      actor: { id: 'hv', role: 'chief', authenticated: true },
      params: { id: 't-neuro' },
      body: null,
      outcome: { status: 200, ok: true },
    });
    expect(grade).toMatchObject({ actor: { id: 'mo', role: 'pi' }, params: { id: 'p4' }, body: { grade: 'excellent' }, outcome: { status: 403, ok: false } });
    expect(refused).toMatchObject({ actor: { id: 'nobody', authenticated: false }, outcome: { status: 401 } });
  });

  it('forwards events to the webhook, signed, and moves the cursor only on success', async () => {
    const forwarder = app.get(AuditForwarder);
    deliveries.length = 0;

    expect(await forwarder.forward()).toBe(3);
    expect(deliveries).toHaveLength(1);
    const [d] = deliveries;
    expect(d.headers['x-intellect-signature']).toBe(sign('s3cret', String(d.headers['x-intellect-timestamp']), d.body));
    expect((JSON.parse(d.body) as { events: AuditEvent[] }).events.map((e) => e.action)).toEqual([
      'GET /topics/:id',
      'PATCH /papers/:id/grade',
      'GET /topics',
    ]);

    // Nothing new: nothing sent.
    expect(await forwarder.forward()).toBe(0);

    // A new event while the webhook is down: delivery fails and the cursor stays put…
    await call('get', '/me', 'hv').expect(200);
    await audited();
    hookStatus = 503;
    await expect(forwarder.forward()).rejects.toThrow('webhook answered 503');
    // …so the event goes out once it's back up.
    hookStatus = 200;
    deliveries.length = 0;
    expect(await forwarder.forward()).toBe(1);
    expect((JSON.parse(deliveries[0].body) as { events: AuditEvent[] }).events[0]).toMatchObject({ action: 'GET /me' });
  });

  it('still forwards an event stored after the cursor passed its request time', async () => {
    const forwarder = app.get(AuditForwarder);
    await forwarder.forward();
    // Finished an hour ago, but only written now (a retried write, or a replica slow to flush).
    const late = { ...copy((await audited())[0], 'late-1'), at: new Date(Date.now() - 3_600_000).toISOString(), indexedAt: new Date().toISOString() };
    await es.index({ index: 'audit', id: late.id, document: late, refresh: true });
    deliveries.length = 0;
    expect(await forwarder.forward()).toBe(1);
    expect((JSON.parse(deliveries[0].body) as { events: AuditEvent[] }).events[0].id).toBe('late-1');
  });

  it('still forwards a write stamped before the cursor but stored after it, and only once', async () => {
    const forwarder = app.get(AuditForwarder);
    await forwarder.forward();
    // Stamped a minute ago, but its request took that long: it only becomes visible after the cursor has passed it.
    const stampedAt = Date.now() - 60_000;
    const slow = { ...copy((await audited()).at(-1)!, 'slow-1'), at: new Date(stampedAt - 1000).toISOString(), indexedAt: new Date(stampedAt).toISOString() };
    await es.index({ index: 'audit', id: slow.id, document: slow, refresh: true });
    deliveries.length = 0;
    expect(await forwarder.forward()).toBe(1);
    expect((JSON.parse(deliveries[0].body) as { events: AuditEvent[] }).events.map((e) => e.id)).toEqual(['slow-1']);
    expect(await forwarder.forward()).toBe(0);
  });

  it('carries delivery over from the cursor kept before indexedAt', async () => {
    const forwarder = app.get(AuditForwarder);
    // Back to how it was: events without indexedAt or forwardedAt, and the old cursor after the second of them by `at`.
    await es.updateByQuery({
      index: 'audit',
      script: { source: "ctx._source.remove('indexedAt'); ctx._source.remove('forwardedAt')" },
      query: { match_all: {} },
      refresh: true,
    });
    await es.delete({ index: 'audit-cursor', id: 'webhook-v2', refresh: true });
    const old = await es.search<AuditEvent>({ index: 'audit', size: 2, sort: [{ at: 'asc' }, { id: 'asc' }] });
    await es.index({ index: 'audit-cursor', id: 'webhook', document: { sort: old.hits.hits[1].sort, updatedAt: new Date().toISOString() }, refresh: true });
    const total = (await es.count({ index: 'audit' })).count;

    deliveries.length = 0;
    // The first (late-1) finished an hour before the rest, beyond the overlap; the second (slow-1) is within it, so
    // it's sent again (at-least-once), as it had no forwarded marker yet.
    expect(await forwarder.forward()).toBe(total - 1);
    const sent = (JSON.parse(deliveries[0].body) as { events: AuditEvent[] }).events;
    expect(sent.map((e) => e.id)).not.toContain(old.hits.hits[0]._source!.id);
    expect(sent.map((e) => e.id)).toContain(old.hits.hits[1]._source!.id);
    expect(sent.every((e) => e.indexedAt === e.at)).toBe(true);
  });
});
