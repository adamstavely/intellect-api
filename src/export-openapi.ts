import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi } from './openapi';

/**
 * Writes openapi.json (the frontend contract) without starting a server or touching Elasticsearch.
 * Runs from the compiled build (`npm run openapi:export`) so the Swagger CLI plugin's metadata is
 * in place; under ts-node the DTO schemas would be empty.
 */
async function main() {
  const out = process.argv[2] ?? 'openapi.json';
  const app = await NestFactory.create(AppModule, { logger: false });
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
