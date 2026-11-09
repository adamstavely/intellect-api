import { createHmac, randomUUID } from 'node:crypto';
import type { Person } from '../model/types';

/**
 * One API request, as the audit trail records it. Every request is audited (reads too), including ones refused by
 * auth or validation, so the trail shows what was attempted as well as what happened.
 */
export interface AuditEvent {
  /** Unique; also returned to the caller as `X-Request-Id`, and the receiver's de-duplication key. */
  id: string;
  /** When the request finished, ISO 8601 with milliseconds. */
  at: string;
  /**
   * When this copy was written to Elasticsearch: stamped on each write attempt, so a retried event gets a later time.
   * Forwarding follows this, not `at`, so an event written late is still sent. Absent until stored.
   */
  indexedAt?: string;
  /** When the webhook accepted it; set by forwarding, never sent. */
  forwardedAt?: string;
  actor: {
    /** The person the request ran as, or the id it claimed when auth refused it. */
    id: string | null;
    name: string | null;
    role: string | null;
    /** Whether auth resolved that person. */
    authenticated: boolean;
  };
  /** Method and route pattern, e.g. "PATCH /papers/:id/grade" – what was done, independent of which record. */
  action: string;
  method: string;
  /** The route pattern; null when nothing matched (a 404 for an unknown path). */
  route: string | null;
  /** The path as requested, without the query string. */
  path: string;
  /** Route params, e.g. { id: "p4" } – which records it touched. */
  params: Record<string, string>;
  query: Record<string, unknown>;
  /** The request body, for requests that change data; redacted, and left out above `MAX_BODY_BYTES`. */
  body: unknown;
  bodyTruncated: boolean;
  outcome: { status: number; ok: boolean };
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
}

export const MAX_BODY_BYTES = 4096;
/** Deeper than this, redaction stops and the value is replaced: a pathological body can't exhaust the stack. */
export const MAX_DEPTH = 32;
export const TOO_DEEP = '[too deep]';
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Replaces the values of secret-looking keys with "[redacted]", down to `MAX_DEPTH` levels; anything nested deeper
 * becomes "[too deep]".
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value && typeof value === 'object' && depth >= MAX_DEPTH) return TOO_DEEP;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  }
  return value;
}

export interface AuditInput {
  method: string;
  /** The matched route pattern, or undefined. */
  route: string | undefined;
  path: string;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  user: Person | undefined;
  /** The X-Intellect-User header, for requests auth refused. */
  claimedUser: string | undefined;
  status: number;
  startedAt: number;
  finishedAt: number;
  ip: string | undefined;
  userAgent: string | undefined;
  id?: string;
}

export function toAuditEvent(i: AuditInput): AuditEvent {
  const method = i.method.toUpperCase();
  const route = i.route ?? null;
  let body: unknown = null;
  let bodyTruncated = false;
  if (!READS.has(method) && i.body !== undefined && !(typeof i.body === 'object' && i.body && Object.keys(i.body).length === 0)) {
    const redacted = redact(i.body);
    if (Buffer.byteLength(JSON.stringify(redacted) ?? '', 'utf8') > MAX_BODY_BYTES) bodyTruncated = true;
    else body = redacted;
  }
  return {
    id: i.id ?? randomUUID(),
    at: new Date(i.finishedAt).toISOString(),
    actor: {
      id: i.user?.id ?? i.claimedUser ?? null,
      name: i.user?.name ?? null,
      role: i.user?.role ?? null,
      authenticated: !!i.user,
    },
    action: `${method} ${route ?? i.path}`,
    method,
    route,
    path: i.path,
    params: { ...i.params },
    query: redact(i.query) as Record<string, unknown>,
    body,
    bodyTruncated,
    outcome: { status: i.status, ok: i.status < 400 },
    durationMs: Math.max(0, Math.round(i.finishedAt - i.startedAt)),
    ip: i.ip ?? null,
    userAgent: i.userAgent ?? null,
  };
}

/** The signature header value for a webhook delivery: HMAC-SHA256 over "<timestamp>.<body>", hex. */
export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}
