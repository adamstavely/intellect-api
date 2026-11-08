import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { AuditEvent } from './audit-event';

const FLUSH_MS = 1000;
const RETRY_MS = FLUSH_MS * 5;
const MAX_BATCH = 200;
/** Write attempts per event before it's given up on and logged in full instead. */
export const MAX_ATTEMPTS = 10;

/** Item statuses worth another try: throttling and server-side failures. Anything else won't succeed on a retry. */
const retryable = (status: number) => status === 429 || status >= 500;

/**
 * Writes audit events to the append-only `audit` index. Requests don't wait on it: events queue in memory and are
 * bulk-written every second (sooner when the queue fills), and the queue is flushed on shutdown.
 *
 * A failed write is retried, whether the whole request failed or only some items in it (429s, 5xx). An event that
 * can't be written – a permanent rejection, or `MAX_ATTEMPTS` failures – is logged in full at error level, so it's
 * preserved for investigation rather than dropped silently.
 */
@Injectable()
export class AuditService implements OnModuleDestroy {
  readonly #log = new Logger('Audit');
  #queue: AuditEvent[] = [];
  readonly #attempts = new Map<string, number>();
  #timer: NodeJS.Timeout | undefined;
  #flushing: Promise<void> = Promise.resolve();

  constructor(@Inject(ES_CLIENT) private readonly es: Client) {}

  record(event: AuditEvent): void {
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
    this.#flushing = this.#flushing.then(() => this.#write(batch));
    return this.#flushing;
  }

  async #write(batch: AuditEvent[]): Promise<void> {
    // Stamped per attempt: forwarding follows indexedAt, so a retried event still lands after the cursor.
    const indexedAt = new Date().toISOString();
    let retry: AuditEvent[] = [];
    try {
      const res = await this.es.bulk({
        operations: batch.flatMap((e) => [{ create: { _index: ALIASES.audit, _id: e.id } }, { ...e, indexedAt }]),
      });
      if (res.errors) {
        res.items.forEach((item, i) => {
          const r = item.create;
          // 409: an earlier attempt already wrote it.
          if (!r?.error || r.status === 409) return;
          if (retryable(r.status)) retry.push(batch[i]);
          else this.#giveUp(batch[i], `${r.status} ${r.error.type}: ${r.error.reason ?? ''}`);
        });
      }
    } catch (err) {
      this.#log.error(`Audit write failed, will retry: ${(err as Error).message}`);
      retry = batch;
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
      this.#timer ??= setTimeout(() => void this.flush(), RETRY_MS);
    }
  }

  #giveUp(event: AuditEvent, why: string): void {
    this.#attempts.delete(event.id);
    this.#log.error(`Audit event ${event.id} not written (${why}); event: ${JSON.stringify(event)}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
