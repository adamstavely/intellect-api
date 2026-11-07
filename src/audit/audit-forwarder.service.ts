import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, errors } from '@elastic/elasticsearch';
import { randomUUID } from 'node:crypto';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { AuditConfig } from '../config/configuration';
import { AuditEvent, sign } from './audit-event';

const CURSOR_ID = 'webhook';
const MAX_BACKOFF_MS = 5 * 60_000;

type Cursor = { sort: [number, string] | null; updatedAt: string };

/**
 * Sends audit events on to an external HTTPS webhook, in order, in batches. Delivery is driven by a cursor stored in
 * Elasticsearch: a batch is the events after the cursor; the cursor moves only when the webhook answers 2xx. So a
 * webhook outage, or a restart, loses nothing – delivery picks up where it left off. It's at-least-once: a batch can
 * be sent twice (a timeout after the receiver accepted it, or two replicas racing – the cursor update is guarded, so
 * only one advances), and receivers should de-duplicate on each event's `id`.
 *
 * Each POST carries `{ events: [...] }` with headers:
 *   X-Intellect-Delivery   a unique id for this attempt
 *   X-Intellect-Timestamp  epoch seconds
 *   X-Intellect-Signature  sha256=HMAC-SHA256(secret, "<timestamp>.<body>"), hex
 */
@Injectable()
export class AuditForwarder implements OnApplicationBootstrap, OnModuleDestroy {
  readonly #log = new Logger('AuditForwarder');
  readonly #config: AuditConfig;
  #timer: NodeJS.Timeout | undefined;
  #backoff = 0;
  #stopped = false;
  #running: Promise<void> = Promise.resolve();

  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    config: ConfigService,
  ) {
    this.#config = config.getOrThrow<AuditConfig>('audit');
  }

  get enabled(): boolean {
    return !!this.#config.webhookUrl;
  }

  onApplicationBootstrap(): void {
    if (!this.enabled) {
      this.#log.log('No AUDIT_WEBHOOK_URL: audit events are kept in Elasticsearch only');
      return;
    }
    this.#log.log(`Forwarding audit events to ${new URL(this.#config.webhookUrl!).origin}`);
    this.#schedule(this.#config.intervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#running;
  }

  #schedule(ms: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#running = this.forward()
        .then((sent) => {
          this.#backoff = 0;
          // A full batch means more are waiting: go again straight away.
          this.#schedule(sent >= this.#config.batchSize ? 0 : this.#config.intervalMs);
        })
        .catch((err: Error) => {
          this.#backoff = Math.min(MAX_BACKOFF_MS, this.#backoff ? this.#backoff * 2 : this.#config.intervalMs * 2);
          this.#log.warn(`Audit forwarding failed, retrying in ${Math.round(this.#backoff / 1000)}s: ${err.message}`);
          this.#schedule(this.#backoff);
        });
    }, ms);
  }

  /** Sends the next batch after the cursor and advances it. Returns how many events went. */
  async forward(): Promise<number> {
    const cursorDoc = await this.es.get<Cursor>({ index: ALIASES.auditCursor, id: CURSOR_ID }, { ignore: [404] });
    const cursor = cursorDoc.found ? (cursorDoc._source?.sort ?? null) : null;
    const res = await this.es.search<AuditEvent>({
      index: ALIASES.audit,
      size: this.#config.batchSize,
      sort: [{ at: 'asc' }, { id: 'asc' }],
      ...(cursor ? { search_after: cursor } : {}),
    });
    const hits = res.hits.hits;
    if (!hits.length) return 0;

    await this.#post(hits.map((h) => h._source!));

    const last = hits[hits.length - 1].sort as [number, string];
    const doc: Cursor = { sort: last, updatedAt: new Date().toISOString() };
    try {
      await this.es.index({
        index: ALIASES.auditCursor,
        id: CURSOR_ID,
        document: doc,
        refresh: 'wait_for',
        ...(cursorDoc.found ? { if_seq_no: cursorDoc._seq_no, if_primary_term: cursorDoc._primary_term } : { op_type: 'create' as const }),
      });
    } catch (err) {
      // Another replica moved the cursor first; its batch overlapped ours, which receivers de-duplicate.
      if (!(err instanceof errors.ResponseError && err.statusCode === 409)) throw err;
    }
    return hits.length;
  }

  async #post(events: AuditEvent[]): Promise<void> {
    const body = JSON.stringify({ events });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'intellect-api-audit/1',
      'x-intellect-delivery': randomUUID(),
      'x-intellect-timestamp': timestamp,
    };
    if (this.#config.webhookSecret) headers['x-intellect-signature'] = sign(this.#config.webhookSecret, timestamp, body);
    const res = await fetch(this.#config.webhookUrl!, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.#config.timeoutMs),
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
  }
}
