import { createHmac } from 'node:crypto';
import type { Person } from '../model/types';
import { MAX_BODY_BYTES, MAX_DEPTH, redact, sign, TOO_DEEP, toAuditEvent } from './audit-event';
import { auditOptions } from '../config/configuration';

const base = {
  method: 'PATCH',
  route: '/papers/:id/grade',
  path: '/papers/p4/grade',
  params: { id: 'p4' },
  query: {},
  body: { grade: 'excellent' },
  user: { id: 'hv', name: 'Helena Vance', role: 'chief' } as Person,
  claimedUser: 'hv',
  status: 200,
  startedAt: Date.parse('2026-11-07T12:00:00.000Z'),
  finishedAt: Date.parse('2026-11-07T12:00:00.042Z'),
  ip: '10.0.0.5',
  userAgent: 'test',
  id: 'evt-1',
};

describe('audit events', () => {
  it('records who did what to which record, and how it went', () => {
    expect(toAuditEvent(base)).toEqual({
      id: 'evt-1',
      at: '2026-11-07T12:00:00.042Z',
      actor: { id: 'hv', name: 'Helena Vance', role: 'chief', authenticated: true },
      action: 'PATCH /papers/:id/grade',
      method: 'PATCH',
      route: '/papers/:id/grade',
      path: '/papers/p4/grade',
      params: { id: 'p4' },
      query: {},
      body: { grade: 'excellent' },
      bodyTruncated: false,
      outcome: { status: 200, ok: true },
      durationMs: 42,
      ip: '10.0.0.5',
      userAgent: 'test',
    });
  });

  it('keeps the claimed id when auth refused the request, and no body for reads', () => {
    const e = toAuditEvent({ ...base, method: 'get', user: undefined, claimedUser: 'nobody', status: 401, body: { x: 1 } });
    expect(e.actor).toEqual({ id: 'nobody', name: null, role: null, authenticated: false });
    expect(e.action).toBe('GET /papers/:id/grade');
    expect(e.body).toBeNull();
    expect(e.outcome).toEqual({ status: 401, ok: false });
  });

  it('names unmatched paths by path', () => {
    expect(toAuditEvent({ ...base, method: 'GET', route: undefined, path: '/nope', status: 404 }).action).toBe('GET /nope');
  });

  it('redacts secret-looking keys at any depth, and drops oversized bodies', () => {
    expect(redact({ name: 'x', apiKey: 'k', nested: [{ password: 'p', ok: 1 }] })).toEqual({
      name: 'x',
      apiKey: '[redacted]',
      nested: [{ password: '[redacted]', ok: 1 }],
    });
    const big = toAuditEvent({ ...base, method: 'POST', body: { text: 'x'.repeat(MAX_BODY_BYTES + 1) } });
    expect(big).toMatchObject({ body: null, bodyTruncated: true });
  });

  it('stops redacting past MAX_DEPTH instead of overflowing the stack', () => {
    let deep: unknown = { password: 'p' };
    for (let i = 0; i < 100_000; i++) deep = { a: [deep] };
    const e = toAuditEvent({ ...base, method: 'POST', body: deep });
    expect(e.bodyTruncated).toBe(false);
    let node: unknown = e.body;
    let depth = 0;
    while (node && typeof node === 'object') {
      node = Array.isArray(node) ? (node as unknown[])[0] : (node as { a: unknown[] }).a;
      depth++;
    }
    expect(node).toBe(TOO_DEEP);
    expect(depth).toBe(MAX_DEPTH);
  });

  it('signs "<timestamp>.<body>" with HMAC-SHA256', () => {
    const expected = createHmac('sha256', 's3cret').update('1700000000.{"events":[]}').digest('hex');
    expect(sign('s3cret', '1700000000', '{"events":[]}')).toBe(`sha256=${expected}`);
  });
});

describe('audit config', () => {
  it('keeps events in Elasticsearch only without a webhook', () => {
    expect(auditOptions({})).toEqual({ webhookUrl: undefined, webhookSecret: undefined, intervalMs: 5000, batchSize: 200, timeoutMs: 10_000, settleMs: 30_000 });
  });

  it('takes https anywhere, http only on localhost', () => {
    expect(auditOptions({ AUDIT_WEBHOOK_URL: 'https://siem.example.com/hook' }).webhookUrl).toBe('https://siem.example.com/hook');
    expect(auditOptions({ AUDIT_WEBHOOK_URL: 'http://localhost:9999/hook' }).webhookUrl).toBe('http://localhost:9999/hook');
    expect(() => auditOptions({ AUDIT_WEBHOOK_URL: 'http://siem.example.com/hook' })).toThrow(/must be https/);
  });
});
