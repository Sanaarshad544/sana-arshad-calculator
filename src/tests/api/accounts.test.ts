import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { PASSWORD, anon, createGroup, newUser, soloBill, testApp, uniqueName } from './helpers.js';

/** Skips the rest of a running wait, as if the time had passed. */
async function endWait(username: string, kind: 'login' | 'reset'): Promise<void> {
  await testApp().pool.query(
    "UPDATE attempt_limits SET next_allowed_at = now() - interval '1 second' WHERE username_key = $1 AND kind = $2",
    [username.toLowerCase(), kind],
  );
}

describe('US-01 create an account', () => {
  it('#1 creates the account, logs in and shows a recovery code', async () => {
    const agent = anon();
    const username = uniqueName('sana');
    const res = await agent.post('/api/auth/signup').send({ username, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.recoveryCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
    expect(res.headers['set-cookie'][0]).toMatch(/sid=.*HttpOnly.*SameSite=Lax/i);
    const me = await agent.get('/api/me');
    expect(me.body.account.username).toBe(username);
  });

  it('#2 the recovery code is never shown again', async () => {
    const { agent, recoveryCode } = await newUser();
    const me = await agent.get('/api/me');
    expect(JSON.stringify(me.body)).not.toContain(recoveryCode);
  });

  it('#3/#4 a taken username, in any letter case, is refused', async () => {
    const { username } = await newUser('Sana');
    for (const variant of [username, username.toLowerCase(), username.toUpperCase()]) {
      const res = await anon().post('/api/auth/signup').send({ username: variant, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(MESSAGES.usernameTaken);
    }
  });

  it('#5 bad usernames are refused', async () => {
    for (const username of ['', 'ab', 'a'.repeat(31), 'sana!', 'sa na']) {
      const res = await anon().post('/api/auth/signup').send({ username, password: PASSWORD });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.username).toBe(MESSAGES.username);
    }
  });

  it('#6/#8 boundary usernames and passwords are accepted', async () => {
    const three = `z${Date.now().toString(36).slice(-2)}`;
    expect((await anon().post('/api/auth/signup').send({ username: three, password: 'a'.repeat(8) })).status).toBe(201);
    const thirty = uniqueName('x').padEnd(30, '_');
    const long = 'p @!'.repeat(32);
    expect((await anon().post('/api/auth/signup').send({ username: thirty, password: long })).status).toBe(201);
    expect((await anon().post('/api/auth/login').send({ username: thirty, password: long })).status).toBe(200);
  });

  it('#7 bad passwords are refused', async () => {
    for (const [password, message] of [
      ['', MESSAGES.passwordShort],
      ['a'.repeat(7), MESSAGES.passwordShort],
      ['a'.repeat(129), MESSAGES.passwordLong],
    ]) {
      const res = await anon().post('/api/auth/signup').send({ username: uniqueName(), password });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.password).toBe(message);
    }
    expect(MESSAGES.passwordShort).toBe('Password must be at least 8 characters');
  });

  it('#10 never asks for an email or phone', async () => {
    const res = await anon().post('/api/auth/signup').send({ username: uniqueName(), password: PASSWORD });
    expect(res.status).toBe(201);
  });

  it('stores passwords and recovery codes only as hashes (US-31 #3)', async () => {
    const { username, recoveryCode } = await newUser();
    const { rows } = await testApp().pool.query('SELECT password_hash, recovery_hash FROM accounts WHERE username = $1', [username]);
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain(PASSWORD);
    expect(rows[0].recovery_hash).not.toContain(recoveryCode.replace(/-/g, ''));
  });
});

describe('US-02 log in and log out', () => {
  it('#1/#5 logs in with any letter case', async () => {
    const { username } = await newUser('Case');
    const agent = anon();
    const res = await agent.post('/api/auth/login').send({ username: username.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/me')).body.account.username).toBe(username);
  });

  it('#2/#3 the same message for a wrong password and an unknown username', async () => {
    const { username } = await newUser();
    const wrong = await anon().post('/api/auth/login').send({ username, password: 'nope nope' });
    const unknown = await anon().post('/api/auth/login').send({ username: uniqueName('ghost'), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(MESSAGES.loginFailed);
    expect(unknown.body.error.message).toBe(MESSAGES.loginFailed);
  });

  it('#6 after 5 wrong passwords the next try must wait 30 seconds, even with the right password', async () => {
    const { username } = await newUser();
    const agent = anon();
    for (let i = 0; i < 5; i += 1) {
      const res = await agent.post('/api/auth/login').send({ username, password: `wrong${i}xxx` });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe(MESSAGES.loginFailed);
    }
    for (const password of ['wrong again', PASSWORD]) {
      const res = await agent.post('/api/auth/login').send({ username, password });
      expect(res.status).toBe(429);
      expect(res.body.error.message).toBe('Too many wrong tries. Wait 30 seconds and try again.');
    }
    await endWait(username, 'login');
    expect((await agent.post('/api/auth/login').send({ username, password: PASSWORD })).status).toBe(200);
  });

  it('#7 log out ends the session at once', async () => {
    const { agent } = await newUser();
    expect((await agent.post('/api/auth/logout').send({})).status).toBe(200);
    expect((await agent.get('/api/me')).status).toBe(401);
    expect((await agent.get('/api/solo-bills')).status).toBe(401);
  });

  it('#8/#9 sessions end after 30 days without use', async () => {
    const { agent, username } = await newUser();
    const { pool } = testApp();
    const accountId = (await pool.query('SELECT id FROM accounts WHERE username = $1', [username])).rows[0].id;
    await pool.query("UPDATE sessions SET last_used_at = now() - interval '29 days' WHERE account_id = $1", [accountId]);
    expect((await agent.get('/api/me')).status).toBe(200);
    await pool.query("UPDATE sessions SET last_used_at = now() - interval '30 days 1 minute' WHERE account_id = $1", [accountId]);
    expect((await agent.get('/api/me')).status).toBe(401);
  });
});

describe('US-03 reset with a recovery code', () => {
  it('#1/#2 resets, shows a new code, and the old code stops working', async () => {
    const { username, recoveryCode } = await newUser();
    const res = await anon().post('/api/auth/reset').send({ username, recoveryCode, newPassword: 'brand new pass' });
    expect(res.status).toBe(200);
    expect(res.body.recoveryCode).not.toBe(recoveryCode);
    expect((await anon().post('/api/auth/login').send({ username, password: 'brand new pass' })).status).toBe(200);
    expect((await anon().post('/api/auth/login').send({ username, password: PASSWORD })).status).toBe(401);
    const again = await anon().post('/api/auth/reset').send({ username, recoveryCode, newPassword: 'another pass 2' });
    expect(again.status).toBe(400);
    // The new code works.
    const third = await anon().post('/api/auth/reset').send({ username, recoveryCode: res.body.recoveryCode, newPassword: 'third pass 3' });
    expect(third.status).toBe(200);
  });

  it('#3 a wrong code or unknown username changes nothing', async () => {
    const { username } = await newUser();
    const bad = await anon().post('/api/auth/reset').send({ username, recoveryCode: 'AAAAA-AAAAA-AAAAA-AAAAA', newPassword: 'brand new pass' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe(MESSAGES.resetFailed);
    const ghost = await anon().post('/api/auth/reset').send({ username: uniqueName('ghost'), recoveryCode: 'X', newPassword: 'brand new pass' });
    expect(ghost.status).toBe(400);
    expect((await anon().post('/api/auth/login').send({ username, password: PASSWORD })).status).toBe(200);
  });

  it('#4 a bad new password changes nothing', async () => {
    const { username, recoveryCode } = await newUser();
    for (const [newPassword, message] of [
      ['', MESSAGES.passwordShort],
      ['short', MESSAGES.passwordShort],
      ['a'.repeat(129), MESSAGES.passwordLong],
    ]) {
      const res = await anon().post('/api/auth/reset').send({ username, recoveryCode, newPassword });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.newPassword).toBe(message);
    }
    expect((await anon().post('/api/auth/login').send({ username, password: PASSWORD })).status).toBe(200);
  });

  it('#5 after 5 wrong codes the next try waits; then the right code works (lower case is fine)', async () => {
    const { username, recoveryCode } = await newUser();
    for (let i = 0; i < 5; i += 1) {
      const res = await anon().post('/api/auth/reset').send({ username, recoveryCode: `WRONG${i}`, newPassword: 'brand new pass' });
      expect(res.body.error.message).toBe(MESSAGES.resetFailed);
    }
    const blocked = await anon().post('/api/auth/reset').send({ username, recoveryCode, newPassword: 'brand new pass' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toBe('Too many wrong tries. Wait 30 seconds and try again.');
    await endWait(username, 'reset');
    const res = await anon().post('/api/auth/reset').send({ username, recoveryCode: recoveryCode.toLowerCase(), newPassword: 'brand new pass' });
    expect(res.status).toBe(200);
  });
});

describe('US-04 privacy', () => {
  it('#1 logged-out requests get no data', async () => {
    const { agent } = await newUser();
    const bill = await agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['5.00']) });
    const { groupId } = await createGroup(agent);
    const a = anon();
    for (const path of ['/api/dashboard', '/api/solo-bills', `/api/solo-bills/${bill.body.bill.id}`, '/api/groups', `/api/groups/${groupId}`, `/api/groups/${groupId}/bills`, `/api/groups/${groupId}/activity`]) {
      const res = await a.get(path);
      expect(res.status, path).toBe(401);
      expect(JSON.stringify(res.body)).not.toContain('Friends');
    }
  });

  it("#2 another account's solo bill can't be read, changed or deleted", async () => {
    const owner = await newUser();
    const other = await newUser();
    const created = await owner.agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['5.00'], { name: 'Secret' }) });
    const id = created.body.bill.id;
    expect((await other.agent.get(`/api/solo-bills/${id}`)).status).toBe(404);
    expect((await other.agent.put(`/api/solo-bills/${id}`).send({ currency: '$', bill: soloBill(['1.00']) })).status).toBe(404);
    expect((await other.agent.delete(`/api/solo-bills/${id}`)).status).toBe(404);
    expect((await other.agent.get('/api/solo-bills')).body.bills).toEqual([]);
    expect((await owner.agent.get(`/api/solo-bills/${id}`)).body.bill.name).toBe('Secret');
  });

  it("#3 a group I'm not in can't be read or changed", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { groupId, meId } = await createGroup(owner.agent, 'Private');
    for (const path of [`/api/groups/${groupId}`, `/api/groups/${groupId}/bills`, `/api/groups/${groupId}/settle-ups`, `/api/groups/${groupId}/activity`]) {
      const res = await other.agent.get(path);
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Private');
    }
    const post = await other.agent.post(`/api/groups/${groupId}/bills`).send({ bill: { ...soloBill(['1.00']), splitMode: 'equal', participantIds: [meId], payerId: meId } });
    expect(post.status).toBe(403);
    expect((await other.agent.post(`/api/groups/${groupId}/members`).send({ name: 'Intruder' })).status).toBe(403);
  });

  it('#4 forged non-JSON requests are refused', async () => {
    const { agent } = await newUser();
    const res = await agent.post('/api/groups').type('form').send('name=x&currency=$');
    expect(res.status).toBe(415);
  });
});

describe('appearance setting (US-35 #3)', () => {
  it('saves the choice with the account', async () => {
    const { agent, username } = await newUser();
    expect((await agent.put('/api/me/theme').send({ theme: 'dark' })).status).toBe(200);
    const again = anon();
    await again.post('/api/auth/login').send({ username, password: PASSWORD });
    expect((await again.get('/api/me')).body.account.theme).toBe('dark');
    expect((await agent.put('/api/me/theme').send({ theme: 'purple' })).status).toBe(400);
  });
});
