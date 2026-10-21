// Fixes from the architecture review: each test pins one of them down.
import { describe, expect, it } from 'vitest';
import { PASSWORD, addMembers, anon, createGroup, groupBill, newUser, testApp } from './helpers.js';

describe('cookies from other sites never break the app', () => {
  it('a malformed unrelated cookie is ignored, logged out or in', async () => {
    const { app } = testApp();
    const request = (await import('supertest')).default;
    const loggedOut = await request(app).get('/api/me').set('Cookie', 'other=100%; theme=%E0%A4%A');
    expect(loggedOut.status).toBe(401);

    const { agent } = await newUser();
    const login = await agent.get('/api/me').set('Cookie', 'other=100%');
    // The agent's own sid cookie is replaced by the header above, so it's simply logged out, not a crash.
    expect([200, 401]).toContain(login.status);
    const sid = (await agent.post('/api/auth/logout').send({})).status;
    expect(sid).toBe(200);
  });

  it('a garbled session cookie is treated as logged out', async () => {
    const { app } = testApp();
    const request = (await import('supertest')).default;
    for (const value of ['%', '%E0%A4%A', 'a b', 'x'.repeat(500)]) {
      expect((await request(app).get('/api/me').set('Cookie', `sid=${value}`)).status).toBe(401);
    }
  });
});

describe('leftover cents follow the member order, not the click order (US-13 #2, US-14 #4)', () => {
  it('participants sent in any order are stored in member order', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Ali', 'Sara']);
    // Ticked in reverse order: Sara, Ali, me.
    const created = await agent
      .post(`/api/groups/${groupId}/bills`)
      .send({ bill: groupBill([ids.Sara, ids.Ali, meId], meId, ['100.00']) });
    expect(created.status).toBe(201);
    const detail = (await agent.get(`/api/groups/${groupId}/bills/${created.body.billId}`)).body.bill;
    expect(detail.input.participantIds).toEqual([meId, ids.Ali, ids.Sara]);
    expect(detail.shares.map((s: { memberId: string; totalCents: number }) => [s.memberId, s.totalCents])).toEqual([
      [meId, 3334],
      [ids.Ali, 3333],
      [ids.Sara, 3333],
    ]);
  });

  it('an item shared by everyone gives its extra cent to the first member listed', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Ali', 'Sara']);
    const bill = {
      ...groupBill([ids.Sara, ids.Ali, meId], meId, []),
      splitMode: 'itemized',
      items: [{ name: '', price: '10.00', sharerIds: [ids.Sara, ids.Ali, meId] }],
    };
    const created = await agent.post(`/api/groups/${groupId}/bills`).send({ bill });
    const detail = (await agent.get(`/api/groups/${groupId}/bills/${created.body.billId}`)).body.bill;
    expect(detail.shares.map((s: { itemsCents: number }) => s.itemsCents)).toEqual([334, 333, 333]);
  });
});

describe('malformed requests get a clear 400, never a 500 (US-25 #16)', () => {
  it('itemized bill with items that are not a list', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    for (const items of ['nonsense', { a: 1 }, 42, null]) {
      const res = await agent
        .post(`/api/groups/${groupId}/bills`)
        .send({ bill: { ...groupBill([meId], meId, []), splitMode: 'itemized', items } });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.items).toBe('Add at least one item');
    }
  });
});

describe('sessions', () => {
  it('logging in again replaces the old session instead of piling them up', async () => {
    const { agent, username } = await newUser();
    const { pool } = testApp();
    const count = async () =>
      (await pool.query('SELECT count(*)::int AS n FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.username = $1', [username])).rows[0].n;
    expect(await count()).toBe(1);
    await agent.post('/api/auth/login').send({ username, password: PASSWORD });
    await agent.post('/api/auth/login').send({ username, password: PASSWORD });
    expect(await count()).toBe(1);
    expect((await agent.get('/api/me')).status).toBe(200);
  });

  it('sessions that ended through 30 days without use are tidied up at the next login', async () => {
    const { username } = await newUser();
    const { pool } = testApp();
    await pool.query("UPDATE sessions SET last_used_at = now() - interval '31 days' FROM accounts a WHERE a.id = sessions.account_id AND a.username = $1", [username]);
    await anon().post('/api/auth/login').send({ username, password: PASSWORD });
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.username = $1 AND s.last_used_at < now() - interval '30 days'",
      [username],
    );
    expect(rows[0].n).toBe(0);
  });

  it('sign-up stores the account and its session together, or neither', async () => {
    const { pool } = testApp();
    const username = `atomic${Date.now().toString(36)}`;
    await pool.query(`CREATE FUNCTION fail_session_${username}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF (SELECT username FROM accounts WHERE id = NEW.account_id) = '${username}' THEN RAISE EXCEPTION 'simulated failure'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`CREATE TRIGGER fail_session_${username} BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION fail_session_${username}()`);
    try {
      const res = await anon().post('/api/auth/signup').send({ username, password: PASSWORD });
      expect(res.status).toBe(500);
      expect((await pool.query('SELECT count(*)::int AS n FROM accounts WHERE username = $1', [username])).rows[0].n).toBe(0);
    } finally {
      await pool.query(`DROP TRIGGER fail_session_${username} ON sessions; DROP FUNCTION fail_session_${username}()`);
    }
    // With the failure gone, the same username can sign up normally.
    expect((await anon().post('/api/auth/signup').send({ username, password: PASSWORD })).status).toBe(201);
  });
});
