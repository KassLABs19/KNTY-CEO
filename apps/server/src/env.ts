import { existsSync } from 'node:fs';

/** Loads apps/server/.env (or ./.env) into process.env when the file exists. */
export function loadEnvFile(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
