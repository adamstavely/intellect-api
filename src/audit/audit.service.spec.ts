import type { Client } from '@elastic/elasticsearch';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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
    const done = audit.onApplicationShutdown();
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

  it('logs in full an event recorded after the drain, rather than writing to a closed client', async () => {
    await shutDown();
    audit.record(event('late'));
    await jest.runAllTimersAsync();

    expect(bulk).not.toHaveBeenCalled();
    expect(logged).toEqual([expect.stringMatching(/^Audit event late not written \(recorded after the shutdown drain\); event: \{"id":"late"/)]);
  });

  it('drains once, however often shutdown asks', async () => {
    bulk.mockResolvedValue({ errors: false, items: [item(201)] });
    audit.record(event('a'));
    const done = Promise.all([audit.drain(), audit.onApplicationShutdown()]);
    await jest.runAllTimersAsync();
    await done;
    expect(bulk).toHaveBeenCalledTimes(1);
  });
});

describe('AuditService shutdown deadline', () => {
  let logged: string[];
  beforeEach(() => {
    logged = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: string) => void logged.push(m));
  });
  afterEach(() => jest.restoreAllMocks());

  const withConfig = (bulk: jest.Mock, audit: object) => new AuditService({ bulk } as unknown as Client, undefined, { get: () => audit } as unknown as ConfigService);
  /** Ids of the events logged in full as not written, in log order. */
  const loggedIds = () => logged.map((m) => /^Audit event (\S+) not written/.exec(m)?.[1]).filter((id): id is string => !!id);

  it('gives up on a stalled write and its queued batches at the deadline, logging every unwritten event exactly once', async () => {
    const signals: AbortSignal[] = [];
    // Never answers; only an abort ends it, as the Elasticsearch client does with a signal.
    const bulk = jest.fn(
      (_: unknown, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new Error('Request aborted')));
        }),
    );
    const audit = withConfig(bulk, { shutdownTimeoutMs: 300, maxQueue: 10_000 });
    const ids = Array.from({ length: 2000 }, (_, i) => `e${i}`);
    // Ten full batches: the first starts writing (and stalls) before shutdown; the rest wait their turn behind it.
    ids.forEach((id) => audit.record(event(id)));
    await new Promise((r) => setImmediate(r));
    expect(bulk).toHaveBeenCalledTimes(1);

    const started = performance.now();
    await audit.drain();
    const took = performance.now() - started;

    expect(took).toBeLessThan(300);
    expect(signals[0].aborted).toBe(true);
    // Nothing queued behind the stalled write was sent after the deadline.
    await new Promise((r) => setTimeout(r, 50));
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(loggedIds().sort()).toEqual([...ids].sort());
    expect(new Set(loggedIds()).size).toBe(2000);
    expect(logged.find((m) => m.startsWith('Audit event e0 '))).toMatch(/within the 300ms shutdown deadline\); event: \{"id":"e0"/);
  });

  it('keeps the backlog bounded: past maxQueue, events go to the log instead of memory', async () => {
    const bulk = jest.fn(() => new Promise(() => undefined));
    const audit = withConfig(bulk, { shutdownTimeoutMs: 100, maxQueue: 250 });
    // 200 go out in a (stalled) write and 50 more queue; the rest don't fit.
    for (let i = 0; i < 300; i++) audit.record(event(`e${i}`));
    expect(loggedIds()).toEqual(Array.from({ length: 50 }, (_, i) => `e${250 + i}`));
    expect(logged[0]).toMatch(/^Audit event e250 not written \(audit backlog full, 250 events waiting\)/);

    await audit.drain();
    expect(loggedIds()).toHaveLength(300);
    expect(new Set(loggedIds()).size).toBe(300);
  });
});
