import type { Client } from '@elastic/elasticsearch';
import { Logger } from '@nestjs/common';
import type { AuditEvent } from './audit-event';
import { AuditService, MAX_ATTEMPTS, SHUTDOWN_FLUSHES } from './audit.service';

const event = (id: string) => ({ id, at: '2026-11-07T12:00:00.000Z' }) as AuditEvent;
const item = (status: number, type = 'x') => ({ create: { status, ...(status >= 300 ? { error: { type, reason: type } } : {}) } });

describe('AuditService', () => {
  let bulk: jest.Mock;
  let audit: AuditService;
  let logged: string[];

  beforeEach(() => {
    jest.useFakeTimers();
    bulk = jest.fn();
    audit = new AuditService({ bulk } as unknown as Client);
    logged = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: string) => void logged.push(m));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const written = (call: number) =>
    (bulk.mock.calls[call][0] as { operations: object[] }).operations.filter((_, i) => i % 2 === 1) as (AuditEvent & { indexedAt: string })[];

  it('retries items Elasticsearch throttled or failed, and keeps permanent failures in the log', async () => {
    bulk.mockResolvedValueOnce({ errors: true, items: [item(201), item(429, 'es_rejected_execution_exception'), item(400, 'mapper_parsing_exception'), item(409), item(503)] });
    bulk.mockResolvedValueOnce({ errors: false, items: [item(201), item(201)] });
    ['a', 'b', 'c', 'd', 'e'].forEach((id) => audit.record(event(id)));
    await audit.flush();

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^Audit event c not written \(400 mapper_parsing_exception/);
    expect(logged[0]).toContain('"id":"c"');

    await audit.flush();
    expect(written(1).map((e) => e.id)).toEqual(['b', 'e']);
    expect(written(1)[0].indexedAt).toEqual(expect.any(String));
  });

  it('retries a failed request, then gives up after MAX_ATTEMPTS with the event logged', async () => {
    bulk.mockRejectedValue(new Error('connection refused'));
    audit.record(event('a'));
    for (let i = 0; i < MAX_ATTEMPTS; i++) await audit.flush();
    expect(bulk).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(logged.at(-1)).toMatch(/^Audit event a not written \(still failing after 10 attempts\)/);
    await audit.flush();
    expect(bulk).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  /** Shuts down as Nest does, letting the drain's pauses pass. */
  const shutDown = async () => {
    const done = audit.onModuleDestroy();
    await jest.runAllTimersAsync();
    await done;
  };

  it('on shutdown, retries a flush that failed for a moment instead of dropping its events', async () => {
    bulk.mockRejectedValueOnce(new Error('connection reset'));
    bulk.mockResolvedValueOnce({ errors: false, items: [item(201), item(201)] });
    audit.record(event('a'));
    audit.record(event('b'));
    await shutDown();

    expect(bulk).toHaveBeenCalledTimes(2);
    expect(written(1).map((e) => e.id)).toEqual(['a', 'b']);
    expect(bulk.mock.calls[1][1]).toMatchObject({ maxRetries: 0 });
    expect(logged).toEqual(['Audit write failed, will retry: connection reset']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('on shutdown, logs in full whatever still cannot be written, and leaves no retry behind', async () => {
    bulk.mockRejectedValue(new Error('connection refused'));
    audit.record(event('a'));
    await shutDown();

    expect(bulk).toHaveBeenCalledTimes(SHUTDOWN_FLUSHES);
    expect(logged.at(-1)).toMatch(/^Audit event a not written \(still failing at shutdown\); event: \{"id":"a"/);
    expect(jest.getTimerCount()).toBe(0);
  });
});
