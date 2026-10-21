// Before the API tests: wipe the separate test database and rebuild its tables.
import { testDatabaseUrl } from '../test-env.js';
import { DB_DOWN_MESSAGE, canConnect, createPool, migrate } from '../../server/db.js';

export default async function setup(): Promise<void> {
  const pool = createPool(testDatabaseUrl());
  try {
    if (!(await canConnect(pool))) throw new Error(DB_DOWN_MESSAGE);
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
