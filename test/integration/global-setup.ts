import { GenericContainer, Wait } from 'testcontainers';

const IMAGE = 'docker.elastic.co/elasticsearch/elasticsearch:8.19.2';

/** One single-node Elasticsearch for the whole integration run, configured like docker-compose. */
export default async function globalSetup(): Promise<void> {
  const container = await new GenericContainer(IMAGE)
    .withEnvironment({
      'discovery.type': 'single-node',
      'xpack.security.enabled': 'false',
      ES_JAVA_OPTS: '-Xms512m -Xmx512m',
    })
    .withExposedPorts(9200)
    .withWaitStrategy(Wait.forHttp('/_cluster/health?wait_for_status=yellow', 9200).forStatusCode(200))
    .withStartupTimeout(180_000)
    .start();

  process.env.ES_NODE = `http://${container.getHost()}:${container.getMappedPort(9200)}`;
  (globalThis as { __ES_CONTAINER__?: unknown }).__ES_CONTAINER__ = container;
}
