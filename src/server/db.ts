import pg from 'pg';
import { migrations } from './migrations.js';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type Queryable = Pool | Client;

export const DB_DOWN_MESSAGE = "Can't reach the database. Start it with: docker compose up -d";

// BIGINT columns come back as strings by default. Every BIGINT we store is
// well within JavaScript's exact integer range (the largest is 10^11 cents),
// so read them as numbers. The API turns ids into strings with String().
pg.types.setTypeParser(20, (value: string) => Number(value));
// DATE columns stay as "YYYY-MM-DD" text, so time zones can't shift them.
pg.types.setTypeParser(1082, (value: string) => value);

export function createPool(connectionString: string): Pool {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  // An idle client losing its connection (e.g. the database restarts) must not crash the app.
  pool.on('error', () => {});
  return pool;
}

/** True when the error means the database can't be reached (not a bad query). */
export function isConnectionError(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  const codes = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08003', '08006'];
  if (e?.code && codes.includes(e.code)) return true;
  return /Connection terminated|connect ECONNREFUSED|timeout exceeded when trying to connect/i.test(e?.message ?? '');
}

export async function canConnect(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Runs `fn` in one transaction: everything is saved, or nothing is. */
export async function transaction<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Applies any migrations not yet recorded in schema_migrations. Existing data is kept. */
export async function migrate(pool: Pool): Promise<string[]> {
  return transaction(pool, async (client) => {
    // Only one server at a time may migrate.
    await client.query('SELECT pg_advisory_xact_lock(81726354)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version),
    );
    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
      applied.push(m.version);
    }
    return applied;
  });
}
