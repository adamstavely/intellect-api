import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { AuditEvent } from './audit-event';

const FLUSH_MS = 1000;
const MAX_BATCH = 200;

/**
 * Writes audit events to the append-only `audit` index. Requests don't wait on it: events queue in memory and are
 * bulk-written every second (sooner when the queue fills), and the queue is flushed on shutdown.
 */
@Injectable()
export class AuditService implements OnModuleDestroy {
  readonly #log = new Logger('Audit');
  #queue: AuditEvent[] = [];
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
    this.#flushing = this.#flushing.then(async () => {
      try {
        const res = await this.es.bulk({ operations: batch.flatMap((e) => [{ create: { _index: ALIASES.audit, _id: e.id } }, e]) });
        if (res.errors) {
          const failed = res.items.filter((i) => i.create?.error && i.create.status !== 409);
          if (failed.length) this.#log.error(`${failed.length} audit events not written: ${failed[0].create?.error?.reason ?? ''}`);
        }
      } catch (err) {
        // Put them back for the next flush rather than lose them.
        this.#queue.unshift(...batch);
        this.#log.error(`Audit write failed, will retry: ${(err as Error).message}`);
        this.#timer ??= setTimeout(() => void this.flush(), FLUSH_MS * 5);
      }
    });
    return this.#flushing;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
