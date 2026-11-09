import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientOptions, errors } from '@elastic/elasticsearch';
import { randomUUID } from 'node:crypto';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import { AuditConfig, maxWriteDelayMs } from '../config/configuration';
import { AuditEvent, sign } from './audit-event';

/** The cursor over [indexedAt, at, id]. */
const CURSOR_ID = 'webhook-v2';
/** The cursor from before indexedAt, over [at, id]; read once, to carry delivery over. */
const LEGACY_CURSOR_ID = 'webhook';
const MAX_BACKOFF_MS = 5 * 60_000;

type Cursor = { sort: (number | string)[] | null; updatedAt: string };
type Sort = (number | string)[];

/** Whether sort values `a` come after `b`. */
const after = (a: Sort, b: Sort): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/**
 * Sends audit events on to an external HTTPS webhook, in order of when they were stored, in batches. Delivery is
 * driven by a cursor stored in Elasticsearch: a batch is the events after the cursor; the cursor moves only when the
 * webhook answers 2xx. So a webhook outage, or a restart, loses nothing – delivery picks up where it left off.
 *
 * The order is `indexedAt` (stamped on each write attempt), not `at` (when the request finished), so an event written
 * late – after a retry, or by a replica whose queue was slow to flush – still lands after the cursor. Events are only
 * sent once they're `settleMs` old, which covers the usual gap between stamping and becoming searchable, and clock
 * skew between replicas; keep it above both.
 *
 * A write can be slower than that: indexedAt is stamped before the request, which the client may keep retrying for
 * `requestTimeout × (maxRetries + 1)`. So each scan reaches back that far (plus `settleMs`) behind the cursor, and an
 * event is marked `forwardedAt` once the webhook accepts it; the scan skips marked events, so the overlap doesn't
 * resend them. Event content never changes, only that marker.
 *
 * It's at-least-once: a batch can be sent twice (a timeout after the receiver accepted it, or two replicas racing –
 * the cursor update is guarded, so only one advances), and receivers should de-duplicate on each event's `id`.
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
  /** How far behind the cursor each scan starts, in ms. */
  readonly #overlapMs: number;

  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    config: ConfigService,
  ) {
    this.#config = config.getOrThrow<AuditConfig>('audit');
    this.#overlapMs = this.#config.settleMs + maxWriteDelayMs(config.get<ClientOptions>('elasticsearch') ?? {});
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

  /** Sends the next batch of unsent events from just behind the cursor, and advances it. Returns how many events went. */
  async forward(): Promise<number> {
    let cursorDoc = await this.es.get<Cursor>({ index: ALIASES.auditCursor, id: CURSOR_ID }, { ignore: [404] });
    if (!cursorDoc.found) {
      await this.#upgrade();
      cursorDoc = await this.es.get<Cursor>({ index: ALIASES.auditCursor, id: CURSOR_ID }, { ignore: [404] });
    }
    const cursor = cursorDoc.found ? (cursorDoc._source?.sort ?? null) : null;
    const from = cursor ? new Date(Number(cursor[0]) - this.#overlapMs).toISOString() : undefined;
    const res = await this.es.search<AuditEvent>({
      index: ALIASES.audit,
      size: this.#config.batchSize,
      query: {
        bool: {
          // Elasticsearch's clock, so replicas agree on the cut-off; date math counts whole seconds.
          filter: [{ range: { indexedAt: { lte: `now-${Math.ceil(this.#config.settleMs / 1000)}s`, ...(from ? { gte: from } : {}) } } }],
          must_not: [{ exists: { field: 'forwardedAt' } }],
        },
      },
      // Events written together share indexedAt; within them, request order.
      sort: [{ indexedAt: 'asc' }, { at: 'asc' }, { id: 'asc' }],
    });
    const hits = res.hits.hits;
    if (!hits.length) return 0;

    await this.#post(hits.map((h) => h._source!));
    await this.#markForwarded(hits);

    // A late event from the overlap can sort before the cursor; it never moves back.
    const last = hits[hits.length - 1].sort as Sort;
    if (cursor && !after(last, cursor)) return hits.length;
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

  /** Marks events the webhook accepted, so a later scan over the overlap doesn't send them again. */
  async #markForwarded(hits: { _index: string; _id?: string }[]): Promise<void> {
    const forwardedAt = new Date().toISOString();
    const res = await this.es.bulk({
      refresh: 'wait_for',
      operations: hits.flatMap((h) => [{ update: { _index: h._index, _id: h._id! } }, { doc: { forwardedAt } }]),
    });
    // Unmarked events are sent again by the next scan (receivers de-duplicate); say so rather than carry on quietly.
    const failed = res.items.filter((i) => i.update?.error);
    if (failed.length) throw new Error(`${failed.length} forwarded events not marked: ${failed[0].update?.error?.reason ?? ''}`);
  }

  /**
   * First run on the indexedAt cursor. Events stored before indexedAt existed get indexedAt = at, so the old cursor
   * [at, id] marks the same place as [at, at, id] over [indexedAt, at, id], and delivery carries on from it.
   */
  async #upgrade(): Promise<void> {
    await this.es.updateByQuery({
      index: ALIASES.audit,
      query: { bool: { must_not: [{ exists: { field: 'indexedAt' } }] } },
      script: { source: 'ctx._source.indexedAt = ctx._source.at', lang: 'painless' },
      conflicts: 'proceed',
      refresh: true,
    });
    const legacy = await this.es.get<Cursor>({ index: ALIASES.auditCursor, id: LEGACY_CURSOR_ID }, { ignore: [404] });
    const old = legacy.found ? legacy._source?.sort : null;
    const doc: Cursor = { sort: old ? [old[0], old[0], old[1]] : null, updatedAt: new Date().toISOString() };
    try {
      await this.es.index({ index: ALIASES.auditCursor, id: CURSOR_ID, document: doc, op_type: 'create', refresh: 'wait_for' });
    } catch (err) {
      // Another replica upgraded first.
      if (!(err instanceof errors.ResponseError && err.statusCode === 409)) throw err;
    }
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
