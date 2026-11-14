import { Inject, Injectable, Logger, OnApplicationShutdown, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import type { AuditConfig } from '../config/configuration';
import { ES_CLIENT, ElasticShutdown } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { AuditEvent } from './audit-event';

const FLUSH_MS = 1000;
const RETRY_MS = FLUSH_MS * 5;
const MAX_BATCH = 200;
/** Write attempts per event before it's given up on and logged in full instead. */
export const MAX_ATTEMPTS = 10;
/** On shutdown: flushes to try, the pause before the first retry (doubling), and the most time each request may take. */
export const SHUTDOWN_FLUSHES = 4;
const SHUTDOWN_BACKOFF_MS = 250;
const SHUTDOWN_REQUEST_MS = 2000;
/** Defaults for `AUDIT_SHUTDOWN_TIMEOUT_MS` and `AUDIT_MAX_QUEUE` (see AuditConfig). */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_QUEUE = 10_000;

/** Item statuses worth another try: throttling and server-side failures. Anything else won't succeed on a retry. */
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * Writes audit events to the append-only `audit` index. Requests don't wait on it: events queue in memory and are
 * bulk-written every second (sooner when the queue fills), and the queue is drained on shutdown – after the HTTP
 * server has finished its last requests, and before the Elasticsearch client closes.
 *
 * A failed write is retried, whether the whole request failed or only some items in it (429s, 5xx). An event that
 * can't be written – a permanent rejection, `MAX_ATTEMPTS` failures, a full backlog (`maxQueue` events waiting), or
 * the shutdown deadline – is logged in full at error level, so it's preserved for investigation rather than dropped
 * silently. That log is the fallback: every event ends up either confirmed written or logged there.
 */
@Injectable()
export class AuditService implements OnApplicationShutdown {
  readonly #log = new Logger('Audit');
  #queue: AuditEvent[] = [];
  /** Taken off the queue for a write that hasn't confirmed them yet: the one in flight, or one waiting its turn. */
  readonly #pending = new Set<AuditEvent>();
  readonly #attempts = new Map<string, number>();
  readonly #shutdownMs: number;
  readonly #maxQueue: number;
  #timer: NodeJS.Timeout | undefined;
  #flushing: Promise<void> = Promise.resolve();
  /** Cancels the write in flight, so shutdown never waits on it past the deadline. */
  #inFlight: AbortController | undefined;
  #deadline = Infinity;
  #stopping = false;
  #drained = false;
  #draining: Promise<void> | undefined;

  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    @Optional() shutdown?: ElasticShutdown,
    @Optional() config?: ConfigService,
  ) {
    const audit = config?.get<Partial<AuditConfig>>('audit');
    this.#shutdownMs = audit?.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#maxQueue = audit?.maxQueue ?? DEFAULT_MAX_QUEUE;
    shutdown?.beforeClose(() => this.drain());
  }

  record(event: AuditEvent): void {
    // Too late to write: Elasticsearch may already be closed. Kept in the log instead, like any event given up on.
    if (this.#drained) {
      this.#giveUp(event, 'recorded after the shutdown drain');
      return;
    }
    // Elasticsearch is falling behind: memory stays bounded, and the event goes to the log instead.
    if (this.#queue.length + this.#pending.size >= this.#maxQueue) {
      this.#giveUp(event, `audit backlog full, ${this.#maxQueue} events waiting`);
      return;
    }
    this.#queue.push(event);
    if (this.#queue.length >= MAX_BATCH) void this.flush();
    else this.#timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  /** Writes whatever is queued. Events are created, never updated, so a replayed id fails rather than overwrites. */
  flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const batch = this.#queue.splice(0, this.#queue.length);
    if (!batch.length) return this.#flushing;
    for (const e of batch) this.#pending.add(e);
    this.#flushing = this.#flushing.then(() => this.#write(batch));
    return this.#flushing;
  }

  async #write(batch: AuditEvent[]): Promise<void> {
    // The shutdown deadline passed while this waited its turn: its events are in the log already.
    if (this.#drained) return;
    // Stamped per attempt: forwarding follows indexedAt, so a retried event still lands after the cursor.
    const indexedAt = new Date().toISOString();
    const abort = (this.#inFlight = new AbortController());
    let res: Awaited<ReturnType<Client['bulk']>> | undefined;
    let failure: Error | undefined;
    try {
      res = await this.es.bulk(
        { operations: batch.flatMap((e) => [{ create: { _index: ALIASES.audit, _id: e.id } }, { ...e, indexedAt }]) },
        // Shutting down, each attempt is kept short and within the deadline, so the drain stays bounded.
        this.#stopping
          ? { requestTimeout: Math.max(1, Math.min(SHUTDOWN_REQUEST_MS, this.#deadline - performance.now())), maxRetries: 0, signal: abort.signal }
          : { signal: abort.signal },
      );
    } catch (err) {
      failure = err as Error;
    } finally {
      if (this.#inFlight === abort) this.#inFlight = undefined;
    }
    // Shutdown stopped waiting for this write and logged its events then; whatever came of it, they're accounted for.
    if (this.#drained) return;
    for (const e of batch) this.#pending.delete(e);

    let retry: AuditEvent[] = [];
    if (failure) {
      this.#log.error(`Audit write failed, will retry: ${failure.message}`);
      retry = batch;
    } else if (res?.errors) {
      res.items.forEach((item, i) => {
        const r = item.create;
        // 409: an earlier attempt already wrote it.
        if (!r?.error || r.status === 409) return;
        if (retryable(r.status)) retry.push(batch[i]);
        else this.#giveUp(batch[i], `${r.status} ${r.error.type}: ${r.error.reason ?? ''}`);
      });
    }
    const failed = new Set(retry);
    for (const e of batch) if (!failed.has(e)) this.#attempts.delete(e.id);
    retry = retry.filter((e) => {
      const n = (this.#attempts.get(e.id) ?? 0) + 1;
      if (n >= MAX_ATTEMPTS) {
        this.#giveUp(e, `still failing after ${MAX_ATTEMPTS} attempts`);
        return false;
      }
      this.#attempts.set(e.id, n);
      return true;
    });
    if (retry.length) {
      // Put them back, ahead of newer events, for a later flush.
      this.#queue.unshift(...retry);
      if (!this.#stopping) this.#timer ??= setTimeout(() => void this.flush(), RETRY_MS);
    }
  }

  #giveUp(event: AuditEvent, why: string): void {
    this.#attempts.delete(event.id);
    this.#log.error(`Audit event ${event.id} not written (${why}); event: ${JSON.stringify(event)}`);
  }

  /** Nest's last shutdown phase, after the HTTP server has closed: no request can record an event any more. */
  onApplicationShutdown(): Promise<void> {
    return this.drain();
  }

  /**
   * Drains the queue before Elasticsearch is closed, within one deadline (`AUDIT_SHUTDOWN_TIMEOUT_MS`) covering the
   * write already in flight, every queued batch and the retries: a few flushes with short pauses, since a transient
   * failure puts events back on the queue. At the deadline the write in flight is aborted and every event not
   * confirmed written – in flight, waiting its turn or queued – is logged in full, like any event given up on, as is
   * anything recorded afterwards. (An aborted write may still have landed; nothing confirmed it, so its events are
   * logged too.) Runs once, however often it's called.
   */
  drain(): Promise<void> {
    return (this.#draining ??= this.#drain());
  }

  async #drain(): Promise<void> {
    this.#stopping = true;
    // A little of the budget is kept back for logging what's left, so all of it is done by the deadline.
    const budget = this.#shutdownMs - Math.min(250, this.#shutdownMs / 10);
    this.#deadline = performance.now() + budget;
    let expire: NodeJS.Timeout | undefined;
    const expired = new Promise<'expired'>((r) => (expire = setTimeout(() => r('expired'), budget)));
    const result = await Promise.race([this.#flushAll().then(() => 'flushed' as const), expired]);
    clearTimeout(expire);

    this.#drained = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#inFlight?.abort();
    const why = result === 'expired' ? `not confirmed written within the ${this.#shutdownMs}ms shutdown deadline` : 'still failing at shutdown';
    const left = [...this.#pending, ...this.#queue.splice(0)];
    this.#pending.clear();
    for (const e of left) this.#giveUp(e, why);
    this.#attempts.clear();
  }

  /** Flushes until the queue is empty, `SHUTDOWN_FLUSHES` tries have been made, or the drain has given up. */
  async #flushAll(): Promise<void> {
    for (let i = 0; i < SHUTDOWN_FLUSHES && !this.#drained; i++) {
      if (i) {
        const pause = Math.min(SHUTDOWN_BACKOFF_MS * 2 ** (i - 1), Math.max(0, this.#deadline - performance.now()));
        await new Promise((r) => setTimeout(r, pause).unref());
        if (this.#drained) return;
      }
      await this.flush();
      if (!this.#queue.length) return;
    }
  }
}
