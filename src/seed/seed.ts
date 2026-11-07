import type { Client } from '@elastic/elasticsearch';
import { SeedMetricsSource } from '../metrics/seed-metrics-source';
import { loadSeed } from './bulk';
import { loadPrototype } from './prototype';
import { SeedResult, transformPrototype } from './transform';

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Builds the seed documents from seed/data.js, computing health as of `asOf`. */
export function buildSeed(asOf: string = today(), prototypePath?: string): Promise<SeedResult> {
  const data = loadPrototype(prototypePath);
  return transformPrototype(data, new SeedMetricsSource(data.papers), asOf);
}

export async function seed(es: Client, asOf: string = today()) {
  const result = await buildSeed(asOf);
  const counts = await loadSeed(es, result.docs);
  return { counts, warnings: result.warnings };
}
