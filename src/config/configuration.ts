import type { ClientOptions } from '@elastic/elasticsearch';

export interface AppConfig {
  port: number;
  elasticsearch: ClientOptions;
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
});
