import type { ClientOptions } from '@elastic/elasticsearch';

export interface AppConfig {
  port: number;
  elasticsearch: ClientOptions;
  audit: AuditConfig;
}

export interface AuditConfig {
  /** Where audit events are forwarded; unset keeps them in Elasticsearch only. */
  webhookUrl: string | undefined;
  /** Signs each delivery (X-Intellect-Signature); strongly recommended whenever a URL is set. */
  webhookSecret: string | undefined;
  /** How often to look for new events, in ms. */
  intervalMs: number;
  /** Most events per POST. */
  batchSize: number;
  /** How long to wait for the webhook, in ms. */
  timeoutMs: number;
  /** How old (by indexedAt) an event must be before it's forwarded, in ms: above write latency plus clock skew. */
  settleMs: number;
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

/**
 * Reads the audit forwarding settings. The webhook must be https, except on localhost for development, so the
 * trail never crosses a network in the clear.
 */
export function auditOptions(env: NodeJS.ProcessEnv = process.env): AuditConfig {
  const raw = env.AUDIT_WEBHOOK_URL?.trim();
  let webhookUrl: string | undefined;
  if (raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL.test(url.hostname))) {
      throw new Error(`AUDIT_WEBHOOK_URL must be https (got ${url.protocol}//${url.hostname})`);
    }
    webhookUrl = url.toString();
  }
  const int = (v: string | undefined, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : fallback;
  };
  return {
    webhookUrl,
    webhookSecret: env.AUDIT_WEBHOOK_SECRET?.trim() || undefined,
    intervalMs: int(env.AUDIT_FORWARD_INTERVAL_MS, 5000, 100, 3_600_000),
    batchSize: int(env.AUDIT_FORWARD_BATCH, 200, 1, 5000),
    timeoutMs: int(env.AUDIT_WEBHOOK_TIMEOUT_MS, 10_000, 100, 120_000),
    settleMs: int(env.AUDIT_FORWARD_SETTLE_MS, 30_000, 0, 3_600_000),
  };
}

/**
 * Builds Elasticsearch client options from the environment. Local dev uses `ES_NODE` with no
 * auth; Elastic Cloud uses `ES_CLOUD_ID` (or `ES_NODE`) plus `ES_API_KEY`.
 */
export function elasticsearchOptions(env: NodeJS.ProcessEnv = process.env): ClientOptions {
  const cloudId = env.ES_CLOUD_ID?.trim();
  const node = env.ES_NODE?.trim() || (cloudId ? undefined : 'http://localhost:9200');
  const apiKey = env.ES_API_KEY?.trim();
  const username = env.ES_USERNAME?.trim();
  const password = env.ES_PASSWORD?.trim();

  return {
    ...(cloudId ? { cloud: { id: cloudId } } : {}),
    ...(node ? { node } : {}),
    ...(apiKey ? { auth: { apiKey } } : username && password ? { auth: { username, password } } : {}),
  };
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  elasticsearch: elasticsearchOptions(),
  audit: auditOptions(),
});
