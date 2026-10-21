// Protection for password and recovery-code checks.
//
// A. At most a few checks run at once, so a flood of logins can't make the
//    app slow for everyone. Normal users never notice.
// B. After 5 wrong tries for one username, each next try must wait:
//    30 s, 1 min, 2 min, 5 min, then 15 min for every try after that.
//    The right password always works once the wait is over (no lockout).
//    Passwords and recovery codes are counted separately.

import { MESSAGES, tooManyTries } from '../shared/rules.js';
import type { Queryable } from './db.js';
import { HttpError } from './http.js';

// ---------- A. Concurrency cap ----------

/** Runs at most `max` tasks at once; up to `maxWaiting` more wait their turn, the rest are turned away. */
export function createLimiter(max: number, maxWaiting: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (running >= max) {
      if (waiting.length >= maxWaiting) throw new HttpError(503, MESSAGES.busy, undefined, 'BUSY');
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  };
}

/** Node checks passwords on 4 background threads, so 4 at once keeps them all busy and no more. */
export const passwordChecks = createLimiter(4, 100);

// ---------- B. Growing wait after wrong tries ----------

export const FREE_TRIES = 5;
const WAITS_SECONDS = [30, 60, 120, 300, 900];

/** Seconds to wait after `failures` wrong tries in a row (0 = no wait). */
export function waitAfter(failures: number): number {
  if (failures < FREE_TRIES) return 0;
  return WAITS_SECONDS[Math.min(failures - FREE_TRIES, WAITS_SECONDS.length - 1)];
}

export type AttemptKind = 'login' | 'reset';

const USERNAME_KEY = /^[a-z0-9_]{3,30}$/;

/**
 * Records a try before the secret is checked. Each try counts as wrong until
 * `succeeded` clears the count, so many tries sent at once can't slip past it.
 * Throws "Too many wrong tries…" (429) while a wait is running, without checking anything.
 * Usernames that can't exist aren't tracked; they always fail anyway.
 */
export async function recordAttempt(db: Queryable, usernameKey: string, kind: AttemptKind): Promise<void> {
  if (!USERNAME_KEY.test(usernameKey)) return;
  // A day without tries starts the count again.
  await db.query(
    "DELETE FROM attempt_limits WHERE username_key = $1 AND kind = $2 AND updated_at < now() - interval '1 day'",
    [usernameKey, kind],
  );
  await db.query('INSERT INTO attempt_limits (username_key, kind) VALUES ($1, $2) ON CONFLICT DO NOTHING', [usernameKey, kind]);
  const { rows } = await db.query<{ failures: number }>(
    `UPDATE attempt_limits
        SET failures = failures + 1,
            -- Wait list [0, 30, 60, 120, 300, 900]: tries 1-4 wait 0, the 5th 30 s, ... the 9th and later 900 s.
            next_allowed_at = now() + make_interval(secs => ($3::int[])[LEAST(GREATEST(failures + 1 - $4 + 2, 1), cardinality($3::int[]))]),
            updated_at = now()
      WHERE username_key = $1 AND kind = $2 AND next_allowed_at <= now()
      RETURNING failures`,
    [usernameKey, kind, [0, ...WAITS_SECONDS], FREE_TRIES],
  );
  if (rows[0]) return;
  const blocked = await db.query<{ seconds: number }>(
    'SELECT CEIL(EXTRACT(EPOCH FROM (next_allowed_at - now())))::int AS seconds FROM attempt_limits WHERE username_key = $1 AND kind = $2',
    [usernameKey, kind],
  );
  throw new HttpError(429, tooManyTries(Math.max(1, blocked.rows[0]?.seconds ?? 1)), undefined, 'TOO_MANY_TRIES');
}

/** The right password or code: the count starts again. A new password also clears the login count. */
export async function clearAttempts(db: Queryable, usernameKey: string, kinds: AttemptKind[]): Promise<void> {
  await db.query('DELETE FROM attempt_limits WHERE username_key = $1 AND kind = ANY($2::text[])', [usernameKey, kinds]);
}

/** Forgets counts nobody has touched for a day. */
export async function tidyAttempts(db: Queryable): Promise<void> {
  await db.query("DELETE FROM attempt_limits WHERE updated_at < now() - interval '1 day'");
}
