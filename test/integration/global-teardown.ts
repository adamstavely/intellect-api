import type { StartedTestContainer } from 'testcontainers';

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __ES_CONTAINER__?: StartedTestContainer }).__ES_CONTAINER__?.stop();
}
