// The growing wait after wrong tries (US-02 #6, #10, #11 and US-03 #5).
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { PASSWORD, anon, newUser, testApp, uniqueName } from './helpers.js';

async function endWait(username: string, kind: 'login' | 'reset'): Promise<void> {
  await testApp().pool.query(
    "UPDATE attempt_limits SET next_allowed_at = now() - interval '1 second' WHERE username_key = $1 AND kind = $2",
    [username.toLowerCase(), kind],
  );
}

const wrongLogin = (username: string) => anon().post('/api/auth/login').send({ username, password: 'not the password' });

describe('US-02 #10 the waits grow, then stay at 15 minutes', () => {
  it('30 seconds, 1, 2, 5 minutes, then 15 minutes for every try after that', async () => {
    const { username } = await newUser();
    for (let i = 0; i < 4; i += 1) expect((await wrongLogin(username)).status).toBe(401);
    const expected = ['30 seconds', '1 minute', '2 minutes', '5 minutes', '15 minutes', '15 minutes', '15 minutes'];
    for (const wait of expected) {
      expect((await wrongLogin(username)).status).toBe(401);
      const blocked = await wrongLogin(username);
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.message).toBe(`Too many wrong tries. Wait ${wait} and try again.`);
      await endWait(username, 'login');
    }
    // Never locked out: after the wait, the right password works and the count starts again.
    expect((await anon().post('/api/auth/login').send({ username, password: PASSWORD })).status).toBe(200);
    for (let i = 0; i < 5; i += 1) expect((await wrongLogin(username)).status).toBe(401);
  });
});

describe('US-02 #11 what the count covers', () => {
  it('one username waiting does not slow down another', async () => {
    const a = await newUser();
    const b = await newUser();
    for (let i = 0; i < 5; i += 1) await wrongLogin(a.username);
    expect((await wrongLogin(a.username)).status).toBe(429);
    expect((await anon().post('/api/auth/login').send({ username: b.username, password: PASSWORD })).status).toBe(200);
  });

  it('the username is counted in any letter case', async () => {
    const { username } = await newUser('Case');
    for (const name of [username, username.toUpperCase(), username.toLowerCase(), username, username.toUpperCase()]) await wrongLogin(name);
    expect((await wrongLogin(username.toLowerCase())).status).toBe(429);
  });

  it('usernames that do not exist get the same wait, so it reveals nothing', async () => {
    const ghost = uniqueName('ghost');
    for (let i = 0; i < 5; i += 1) {
      const res = await wrongLogin(ghost);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe(MESSAGES.loginFailed);
    }
    expect((await wrongLogin(ghost)).body.error.message).toBe('Too many wrong tries. Wait 30 seconds and try again.');
  });

  it('passwords and recovery codes are counted separately; a reset clears both', async () => {
    const { username, recoveryCode } = await newUser();
    for (let i = 0; i < 5; i += 1) await wrongLogin(username);
    expect((await wrongLogin(username)).status).toBe(429);
    // Recovery codes still work while logins are waiting.
    const reset = await anon().post('/api/auth/reset').send({ username, recoveryCode, newPassword: 'fresh password 9' });
    expect(reset.status).toBe(200);
    // The new password works at once: the reset cleared the login wait.
    expect((await anon().post('/api/auth/login').send({ username, password: 'fresh password 9' })).status).toBe(200);
  });

  it('a day without tries starts the count again', async () => {
    const { username } = await newUser();
    for (let i = 0; i < 5; i += 1) await wrongLogin(username);
    await testApp().pool.query(
      "UPDATE attempt_limits SET next_allowed_at = now() - interval '1 second', updated_at = now() - interval '25 hours' WHERE username_key = $1",
      [username.toLowerCase()],
    );
    for (let i = 0; i < 5; i += 1) expect((await wrongLogin(username)).status).toBe(401);
  });

  it('many tries sent at the same moment cannot slip past the count', async () => {
    const { username } = await newUser();
    const results = await Promise.all(Array.from({ length: 12 }, () => wrongLogin(username)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(7);
  });
});
