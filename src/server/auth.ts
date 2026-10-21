import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler, type Response } from 'express';
import { MESSAGES, checkPassword, checkUsername } from '../shared/rules.js';
import type { Account, Theme } from '../shared/api.js';
import { transaction, type Pool, type Queryable } from './db.js';
import { HttpError, badRequest } from './http.js';
import { clearAttempts, passwordChecks, recordAttempt } from './limits.js';

const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
export const COOKIE_NAME = 'sid';

// ---------- Hashing (Node's built-in scrypt) ----------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Every password and code check goes through the shared cap (see limits.ts). */
function scryptAsync(secret: string, salt: Buffer): Promise<Buffer> {
  return passwordChecks(
    () =>
      new Promise<Buffer>((resolve, reject) =>
        scrypt(secret, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
          err ? reject(err) : resolve(key),
        ),
      ),
  );
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [kind, saltB64, keyB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(secret, Buffer.from(saltB64, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash to compare against when the username doesn't exist, so a wrong
// username takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashSecret('not-a-real-password'));

// ---------- Recovery codes ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryCode(): string {
  const chars = Array.from({ length: 20 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

/** Codes are compared without spaces or dashes and in capitals. */
export function normalizeRecoveryCode(code: string): string {
  return String(code ?? '').toUpperCase().replace(/[\s-]/g, '');
}

// ---------- Sessions ----------

export interface AuthContext {
  pool: Pool;
  secret: string;
  production: boolean;
}

function tokenHash(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * The session token from the Cookie header. Other cookies (possibly set by other
 * sites on the same host) are ignored, and odd values never cause an error.
 * Tokens are base64url, so they need no decoding.
 */
function readSessionToken(header: string | undefined): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{20,100}$/.test(value) ? value : undefined;
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string, production: boolean): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    maxAge: SESSION_MS,
    path: '/',
  });
}

function clearSessionCookie(res: Response, production: boolean): void {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: production, path: '/' });
}

/**
 * Stores a new session inside the caller's transaction and returns its token.
 * The caller sets the cookie only after the transaction commits.
 */
async function createSession(ctx: AuthContext, db: Queryable, accountId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  // Tidy up sessions that ended through 30 days without use.
  await db.query("DELETE FROM sessions WHERE account_id = $1 AND last_used_at < now() - interval '30 days'", [accountId]);
  await db.query('INSERT INTO sessions (token_hash, account_id) VALUES ($1, $2)', [tokenHash(ctx.secret, token), accountId]);
  return token;
}

export interface SessionAccount {
  id: number;
  username: string;
  theme: Theme;
}

/** The logged-in account for this request, set by `loadSession`. */
export function currentAccount(res: Response): SessionAccount {
  const account = res.locals.account as SessionAccount | undefined;
  if (!account) throw new HttpError(401, 'Please log in');
  return account;
}

/** Reads the session cookie. Sessions end after 30 days without use. */
export function loadSession(ctx: AuthContext): RequestHandler {
  return async (req, res, next) => {
    const token = readSessionToken(req.headers.cookie);
    if (!token) return next();
    const hash = tokenHash(ctx.secret, token);
    const { rows } = await ctx.pool.query<{ id: number; username: string; theme: Theme; idle_ms: number }>(
      `SELECT a.id, a.username, a.theme,
              (EXTRACT(EPOCH FROM (now() - s.last_used_at)) * 1000)::bigint AS idle_ms
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1`,
      [hash],
    );
    const row = rows[0];
    if (!row || row.idle_ms > SESSION_MS) {
      if (row) await ctx.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash]);
      clearSessionCookie(res, ctx.production);
      return next();
    }
    if (row.idle_ms > 60_000) {
      await ctx.pool.query('UPDATE sessions SET last_used_at = now() WHERE token_hash = $1', [hash]);
      setSessionCookie(res, token, ctx.production);
    }
    res.locals.account = { id: row.id, username: row.username, theme: row.theme } satisfies SessionAccount;
    res.locals.sessionHash = hash;
    next();
  };
}

export const requireAuth: RequestHandler = (_req, res, next) => {
  if (!res.locals.account) {
    res.status(401).json({ error: { message: 'Please log in', code: 'NOT_LOGGED_IN' } });
    return;
  }
  next();
};

// ---------- Routes ----------

const toAccount = (a: SessionAccount): Account => ({ username: a.username, theme: a.theme });

export function authRouter(ctx: AuthContext): Router {
  const router = Router();

  router.post('/signup', async (req, res) => {
    const username = checkUsername(String(req.body?.username ?? ''));
    const password = checkPassword(String(req.body?.password ?? ''));
    const fields: Record<string, string> = {};
    if (!username.ok) fields.username = username.message;
    if (!password.ok) fields.password = password.message;
    if (!username.ok || !password.ok) throw badRequest(Object.values(fields)[0], fields);

    const recoveryCode = newRecoveryCode();
    const [passwordHash, recoveryHash] = await Promise.all([
      hashSecret(password.value),
      hashSecret(normalizeRecoveryCode(recoveryCode)),
    ]);
    // The account and its first session are saved together, or not at all.
    const token = await transaction(ctx.pool, async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO accounts (username, username_key, password_hash, recovery_hash)
         VALUES ($1, $2, $3, $4) ON CONFLICT (username_key) DO NOTHING RETURNING id`,
        [username.value, username.value.toLowerCase(), passwordHash, recoveryHash],
      );
      if (!rows[0]) throw new HttpError(409, MESSAGES.usernameTaken, { username: MESSAGES.usernameTaken });
      return createSession(ctx, client, rows[0].id);
    });
    setSessionCookie(res, token, ctx.production);
    res.status(201).json({ account: { username: username.value, theme: 'device' }, recoveryCode });
  });

  router.post('/login', async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const key = username.toLowerCase();
    // Unknown usernames are counted too, so the wait can't reveal which usernames exist.
    await recordAttempt(ctx.pool, key, 'login');
    const { rows } = await ctx.pool.query<{ id: number; username: string; theme: Theme; password_hash: string }>(
      'SELECT id, username, theme, password_hash FROM accounts WHERE username_key = $1',
      [key],
    );
    const row = rows[0];
    const ok = await verifySecret(password, row ? row.password_hash : await getDummyHash());
    if (!row || !ok) throw new HttpError(401, MESSAGES.loginFailed);
    await clearAttempts(ctx.pool, key, ['login']);
    // Logging in again replaces the session this browser already had.
    if (res.locals.sessionHash) await ctx.pool.query('DELETE FROM sessions WHERE token_hash = $1', [res.locals.sessionHash]);
    setSessionCookie(res, await createSession(ctx, ctx.pool, row.id), ctx.production);
    res.json({ account: toAccount(row) });
  });

  router.post('/logout', async (_req, res) => {
    if (res.locals.sessionHash) {
      await ctx.pool.query('DELETE FROM sessions WHERE token_hash = $1', [res.locals.sessionHash]);
    }
    clearSessionCookie(res, ctx.production);
    res.json({ ok: true });
  });

  router.post('/reset', async (req, res) => {
    const username = String(req.body?.username ?? '').trim();
    const code = normalizeRecoveryCode(String(req.body?.recoveryCode ?? ''));
    const password = checkPassword(String(req.body?.newPassword ?? ''));
    if (!password.ok) throw badRequest(password.message, { newPassword: password.message });
    const key = username.toLowerCase();
    await recordAttempt(ctx.pool, key, 'reset');
    const { rows } = await ctx.pool.query<{ id: number; username: string; theme: Theme; recovery_hash: string }>(
      'SELECT id, username, theme, recovery_hash FROM accounts WHERE username_key = $1',
      [key],
    );
    const row = rows[0];
    const ok = await verifySecret(code, row ? row.recovery_hash : await getDummyHash());
    if (!row || !ok) throw new HttpError(400, MESSAGES.resetFailed);

    const recoveryCode = newRecoveryCode();
    const [passwordHash, recoveryHash] = await Promise.all([
      hashSecret(password.value),
      hashSecret(normalizeRecoveryCode(recoveryCode)),
    ]);
    // The new password, new recovery code and new session are saved together, or not at all.
    const token = await transaction(ctx.pool, async (client) => {
      // Only change it if the code hasn't been used by a parallel reset meanwhile.
      const updated = await client.query(
        'UPDATE accounts SET password_hash = $1, recovery_hash = $2 WHERE id = $3 AND recovery_hash = $4',
        [passwordHash, recoveryHash, row.id, row.recovery_hash],
      );
      if (updated.rowCount !== 1) throw new HttpError(400, MESSAGES.resetFailed);
      // A password reset logs out every other session and starts both counts again.
      await client.query('DELETE FROM sessions WHERE account_id = $1', [row.id]);
      await clearAttempts(client, key, ['login', 'reset']);
      return createSession(ctx, client, row.id);
    });
    setSessionCookie(res, token, ctx.production);
    res.json({ account: toAccount(row), recoveryCode });
  });

  return router;
}

export function meRouter(ctx: AuthContext): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', (_req, res) => {
    res.json({ account: toAccount(currentAccount(res)) });
  });

  router.put('/theme', async (req, res) => {
    const theme = req.body?.theme;
    if (!['device', 'light', 'dark'].includes(theme)) throw badRequest('Choose Device, Light or Dark');
    const account = currentAccount(res);
    await ctx.pool.query('UPDATE accounts SET theme = $1 WHERE id = $2', [theme, account.id]);
    res.json({ account: { username: account.username, theme } });
  });

  return router;
}
