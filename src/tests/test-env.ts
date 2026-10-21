import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

const FALLBACK = 'postgres://bill_splitter:local_dev_password@127.0.0.1:5432/bill_splitter_test';

/** The separate test database. Refuses anything that isn't clearly a test database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL || FALLBACK;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`TEST_DATABASE_URL must point at a database whose name ends in "_test" (got "${dbName}"), so tests never touch real data.`);
  }
  return url;
}

export const TEST_SESSION_SECRET = 'test-session-secret';
/** Port for the browser tests' own server. Override with E2E_PORT to run two suites side by side. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
