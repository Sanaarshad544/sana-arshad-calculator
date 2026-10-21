// First step of `npm test`: stop at once with a clear message if the test
// database can't be reached, instead of a wall of failing tests.
import { testDatabaseUrl } from './test-env.js';
import { DB_DOWN_MESSAGE, canConnect, createPool } from '../server/db.js';

const pool = createPool(testDatabaseUrl());
const ok = await canConnect(pool);
await pool.end().catch(() => {});
if (!ok) {
  console.error(DB_DOWN_MESSAGE);
  process.exit(1);
}
