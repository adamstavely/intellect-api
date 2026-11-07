import { parseArgs } from 'node:util';
import { loadDotEnv } from './env';
import { createScriptClient } from '../src/elastic/client';
import { today } from '../src/seed/seed';
import { reconcile } from '../src/topic-health/reconcile';

/**
 * Nightly reconcile (an EKS CronJob in production):
 *   npm run es:reconcile [-- --as-of YYYY-MM-DD]
 * Prints one JSON line per drifting topic, then a summary line.
 */
async function main() {
  loadDotEnv();
  const { values } = parseArgs({ options: { 'as-of': { type: 'string' } } });
  const asOf = values['as-of'] ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`--as-of must be YYYY-MM-DD, got ${asOf}`);

  const es = createScriptClient();
  try {
    const report = await reconcile(es, asOf);
    for (const d of report.drift) console.log(JSON.stringify({ level: 'warn', msg: 'topic rollup drift', ...d }));
    console.log(JSON.stringify({ level: 'info', msg: 'reconcile complete', asOf, month: report.month, topics: report.topics, drifted: report.drift.length }));
  } finally {
    await es.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
