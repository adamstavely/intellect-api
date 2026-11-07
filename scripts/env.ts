import { existsSync } from 'node:fs';

/** Loads `.env` into process.env for CLI scripts, as @nestjs/config does for the app. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
