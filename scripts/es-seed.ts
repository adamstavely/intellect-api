import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadDotEnv } from './env';
import { createScriptClient } from '../src/elastic/client';
import { toNdjson } from '../src/seed/bulk';
import { buildSeed, seed, today } from '../src/seed/seed';

/**
 * npm run es:seed                       load seed/data.js into Elasticsearch (replaces existing docs)
 * npm run es:seed -- --as-of 2026-06-30 compute health/overdue/history as of that date
 * npm run es:seed -- --ndjson out.ndjson write the bulk NDJSON instead of loading it
 */
async function main() {
  loadDotEnv();
  const { values } = parseArgs({ options: { 'as-of': { type: 'string' }, ndjson: { type: 'string' } } });
  const asOf = values['as-of'] ?? (process.env.SEED_AS_OF?.trim() || today());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);

  if (values.ndjson) {
    const { docs, warnings } = await buildSeed(asOf);
    warnings.forEach((w) => console.warn(`warning: ${w}`));
    writeFileSync(values.ndjson, toNdjson(docs));
    console.log(`Wrote ${values.ndjson} (as of ${asOf})`);
    return;
  }

  const es = createScriptClient();
  try {
    const { counts, warnings } = await seed(es, asOf);
    warnings.forEach((w) => console.warn(`warning: ${w}`));
    console.log(`Seeded as of ${asOf}:`);
    for (const [index, n] of Object.entries(counts)) console.log(`  ${index.padEnd(22)} ${n}`);
  } finally {
    await es.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
