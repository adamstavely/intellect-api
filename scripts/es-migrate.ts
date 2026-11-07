import { loadDotEnv } from './env';
import { createScriptClient } from '../src/elastic/client';
import { migrate } from '../src/elastic/migrate';

async function main() {
  loadDotEnv();
  const es = createScriptClient();
  try {
    const results = await migrate(es);
    for (const r of results) {
      const extra = r.action === 'needs-reindex' ? ` (alias points at ${r.current.join(', ')}; reindex then swap the alias)` : '';
      console.log(`${r.alias.padEnd(22)} ${r.action.padEnd(14)} ${r.index}${extra}`);
    }
    if (results.some((r) => r.action === 'needs-reindex')) process.exitCode = 2;
  } finally {
    await es.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
