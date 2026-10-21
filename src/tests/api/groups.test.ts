import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { addMembers, amt, balances, createGroup, groupBill, newUser, pct, testApp, type Agent } from './helpers.js';

async function activity(agent: Agent, groupId: string): Promise<string[]> {
  const res = await agent.get(`/api/groups/${groupId}/activity`);
  return res.body.activity.map((a: { message: string }) => a.message);
}

async function joinWithCode(agent: Agent, groupId: string, owner: Agent) {
  const code = (await owner.get(`/api/groups/${groupId}`)).body.group.inviteCode;
  return { code, res: await agent.post('/api/join').send({ code }) };
}

describe('US-09 create a group', () => {
  it('#1 creator is the only member, an invite code exists, and it is logged', async () => {
    const { agent, username } = await newUser();
    const { groupId } = await createGroup(agent, 'Flatmates', 'CHF');
    const g = (await agent.get(`/api/groups/${groupId}`)).body.group;
    expect(g).toMatchObject({ name: 'Flatmates', currency: 'CHF', iAmLastAccount: true });
    expect(g.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(g.members).toHaveLength(1);
    expect(g.members[0]).toMatchObject({ name: username, isMe: true, hasAccount: true, balanceCents: 0 });
    expect(await activity(agent, groupId)).toEqual([`${username} created the group`]);
  });

  it('#2/#3 checks the currency and the name', async () => {
    const { agent } = await newUser();
    for (const name of ['', '   ', 'x'.repeat(51)]) {
      const res = await agent.post('/api/groups').send({ name, currency: '$' });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.name).toBe(MESSAGES.groupName);
    }
    expect((await agent.post('/api/groups').send({ name: 'x', currency: '$' })).status).toBe(201);
    expect((await agent.post('/api/groups').send({ name: 'x'.repeat(50), currency: 'zł' })).status).toBe(201);
    const bad = await agent.post('/api/groups').send({ name: 'ok', currency: 'R1' });
    expect(bad.body.error.fields.currency).toBe(MESSAGES.currency);
  });

  it('#4 there is no way to change the currency', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    expect((await agent.put(`/api/groups/${groupId}`).send({ currency: '€' })).status).toBe(404);
    expect((await agent.patch(`/api/groups/${groupId}`).send({ currency: '€' })).status).toBe(404);
    expect((await agent.get(`/api/groups/${groupId}`)).body.group.currency).toBe('$');
  });
});

describe('US-10 add friends by name', () => {
  it('#1 a name-only member can take part and pay, and it is logged', async () => {
    const { agent, username } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Omar']);
    const res = await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], ids.Omar, ['10.00']) });
    expect(res.status).toBe(201);
    expect(await activity(agent, groupId)).toContain(`${username} added Omar`);
  });

  it('#2/#6 at most 50 current members; removed members do not count', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    const names = Array.from({ length: 49 }, (_, i) => `M${i}`);
    const ids = await addMembers(agent, groupId, names);
    const full = await agent.post(`/api/groups/${groupId}/members`).send({ name: 'Extra' });
    expect(full.status).toBe(400);
    expect(full.body.error.message).toBe(MESSAGES.groupFull);
    await agent.post(`/api/groups/${groupId}/members/${ids.M0}/remove`).send({});
    expect((await agent.post(`/api/groups/${groupId}/members`).send({ name: 'Extra' })).status).toBe(201);
  });

  it('#3 name length 1-30', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    for (const name of ['', ' ', 'x'.repeat(31)]) {
      const res = await agent.post(`/api/groups/${groupId}/members`).send({ name });
      expect(res.body.error.fields.name).toBe(MESSAGES.memberName);
    }
    expect((await agent.post(`/api/groups/${groupId}/members`).send({ name: 'x' })).status).toBe(201);
    expect((await agent.post(`/api/groups/${groupId}/members`).send({ name: 'y'.repeat(30) })).status).toBe(201);
  });

  it('#4/#5 names are never reused, in any letter case, even after removal', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Omar']);
    for (const name of ['Omar', 'omar', ' OMAR ']) {
      const res = await agent.post(`/api/groups/${groupId}/members`).send({ name });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe(MESSAGES.nameUsed);
    }
    await agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({});
    expect((await agent.post(`/api/groups/${groupId}/members`).send({ name: 'oMaR' })).body.error.message).toBe(MESSAGES.nameUsed);
  });
});

describe('US-11/US-12 invite code and claiming a name', () => {
  it('US-11 the code never changes and there is no way to regenerate it', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    const a = (await agent.get(`/api/groups/${groupId}`)).body.group.inviteCode;
    await addMembers(agent, groupId, ['X']);
    expect((await agent.get(`/api/groups/${groupId}`)).body.group.inviteCode).toBe(a);
    expect((await agent.post(`/api/groups/${groupId}/invite-code`).send({})).status).toBe(404);
  });

  it('#1-#5 a new account claims a name and sees the full history', async () => {
    const owner = await newUser();
    const { groupId, meId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar', 'Sara']);
    await owner.agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], meId, ['10.00'], { name: 'Pizza night' }) });

    const omar = await newUser('omar');
    const { code, res } = await joinWithCode(omar.agent, groupId, owner.agent);
    expect(res.body.status).toBe('choose');
    expect(res.body.choices.map((c: { name: string }) => c.name)).toEqual(['Omar', 'Sara']);

    // Lower case and spaces in the code are fine.
    const claim = await omar.agent.post('/api/join/claim').send({ code: ` ${code.toLowerCase()} `, memberId: ids.Omar });
    expect(claim.status).toBe(200);
    expect(claim.body.groupId).toBe(groupId);
    const seen = (await omar.agent.get(`/api/groups/${groupId}/bills`)).body.bills;
    expect(seen.map((b: { name: string }) => b.name)).toEqual(['Pizza night']);
    expect((await omar.agent.get('/api/groups')).body.groups.map((g: { id: string }) => g.id)).toEqual([groupId]);
    expect(await activity(owner.agent, groupId)).toContain('Omar claimed the name Omar');

    // #3 a claimed name isn't offered and can't be claimed by anyone else.
    const third = await newUser();
    const again = await third.agent.post('/api/join').send({ code });
    expect(again.body.choices.map((c: { name: string }) => c.name)).toEqual(['Sara']);
    expect((await third.agent.post('/api/join/claim').send({ code, memberId: ids.Omar })).status).toBe(409);

    // #4 one account can't claim a second name in the same group.
    expect((await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Sara })).status).toBe(409);
  });

  it('#6 claiming a removed, unclaimed name restores it', async () => {
    const owner = await newUser();
    const { groupId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({});
    const omar = await newUser();
    const { code, res } = await joinWithCode(omar.agent, groupId, owner.agent);
    expect(res.body.choices).toEqual([{ memberId: ids.Omar, name: 'Omar', removed: true }]);
    await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar });
    const member = (await owner.agent.get(`/api/groups/${groupId}`)).body.group.members.find((m: { name: string }) => m.name === 'Omar');
    expect(member).toMatchObject({ status: 'current', hasAccount: true });
  });

  it('#7/#8/#9 wrong code, already in the group, then the right code', async () => {
    const owner = await newUser();
    const { groupId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const wrong = await owner.agent.post('/api/join').send({ code: 'NOPE1234' });
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.message).toBe(MESSAGES.inviteInvalid);
    const { res } = await joinWithCode(owner.agent, groupId, owner.agent);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(MESSAGES.alreadyInGroup);
    const omar = await newUser();
    await omar.agent.post('/api/join').send({ code: 'WRONG' });
    const { code } = await joinWithCode(omar.agent, groupId, owner.agent);
    expect((await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar })).status).toBe(200);
  });
});

describe('US-13/US-14/US-15 group bills and the payer', () => {
  it('US-13 #1 only participants are charged', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    const five = [meId, ids.A, ids.B, ids.C, ids.D];
    await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill(five, meId, ['50.00']) });
    const b = await balances(agent, groupId);
    expect([b.E, b.F, b.G, b.H, b.I]).toEqual([0, 0, 0, 0, 0]);
    expect([b.A, b.B, b.C, b.D]).toEqual([-1000, -1000, -1000, -1000]);
  });

  it('US-14 itemized shares are stored and shown', async () => {
    const { agent, username } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Sara']);
    const bill = {
      ...groupBill([meId, ids.Sara], meId, []),
      splitMode: 'itemized',
      items: [
        { name: 'Steak', price: '40.00', sharerIds: [meId] },
        { name: 'Salad', price: '10.00', sharerIds: [ids.Sara] },
      ],
      tax: amt('5.00'),
      otherCharges: amt('2.50'),
      tip: amt('10.00'),
    };
    const created = await agent.post(`/api/groups/${groupId}/bills`).send({ bill });
    const detail = (await agent.get(`/api/groups/${groupId}/bills/${created.body.billId}`)).body.bill;
    expect(detail.shares.map((s: { totalCents: number }) => s.totalCents)).toEqual([5400, 1350]);
    expect(detail.input.items[0]).toEqual({ name: 'Steak', price: '40.00', sharerIds: [meId] });
    expect(detail.totals.totalCents).toBe(6750);
    const b = await balances(agent, groupId);
    expect(b[username]).toBe(1350);
    expect(b.Sara).toBe(-1350);
  });

  it('US-15 #2 the payer must be on the bill; nothing is saved otherwise', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Omar', 'Sara']);
    const res = await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Sara], ids.Omar, ['10']) });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.payer).toBe(MESSAGES.payerNotParticipant);
    expect((await agent.get(`/api/groups/${groupId}/bills`)).body.bills).toEqual([]);
  });

  it('US-13 #8 no participants', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const res = await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([], meId, ['10']) });
    expect(res.body.error.fields.participants).toBe(MESSAGES.noParticipants);
  });

  it('rejects participants who are not current members of this group', async () => {
    const a = await newUser();
    const b = await newUser();
    const g1 = await createGroup(a.agent);
    const g2 = await createGroup(b.agent);
    const res = await a.agent.post(`/api/groups/${g1.groupId}/bills`).send({ bill: groupBill([g1.meId, g2.meId], g1.meId, ['10']) });
    expect(res.status).toBe(400);
  });
});

describe('US-16/US-17 balances, suggestions and settle-ups', () => {
  async function pizzaNight() {
    const user = await newUser();
    const { groupId, meId } = await createGroup(user.agent);
    const ids = await addMembers(user.agent, groupId, ['Ali', 'Sara']);
    // Ali paid 65.00: Ali 52.00 and Sara 13.00.
    const bill = {
      ...groupBill([ids.Ali, ids.Sara], ids.Ali, []),
      splitMode: 'itemized',
      items: [
        { name: 'Steak', price: '40.00', sharerIds: [ids.Ali] },
        { name: 'Salad', price: '10.00', sharerIds: [ids.Sara] },
      ],
      tax: amt('5.00'),
      tip: amt('10.00'),
    };
    await user.agent.post(`/api/groups/${groupId}/bills`).send({ bill });
    return { ...user, groupId, meId, ids };
  }

  it('US-16 #1/#2 +13.00 / −13.00 and "Sara pays Ali 13.00"; balances sum to 0', async () => {
    const { agent, groupId, ids } = await pizzaNight();
    const g = (await agent.get(`/api/groups/${groupId}`)).body.group;
    const b = await balances(agent, groupId);
    expect(b.Ali).toBe(1300);
    expect(b.Sara).toBe(-1300);
    expect(Object.values(b).reduce((s, x) => s + x, 0)).toBe(0);
    expect(g.suggestions).toEqual([{ fromId: ids.Sara, toId: ids.Ali, amountCents: 1300 }]);
  });

  it('US-17 #1 paying back exactly clears both balances', async () => {
    const { agent, groupId, ids } = await pizzaNight();
    expect((await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Sara, toId: ids.Ali, amount: '13.00' })).status).toBe(201);
    const b = await balances(agent, groupId);
    expect([b.Ali, b.Sara]).toEqual([0, 0]);
    expect((await agent.get(`/api/groups/${groupId}`)).body.group.suggestions).toEqual([]);
  });

  it('US-17 #2 overpaying flips the debt', async () => {
    const { agent, groupId, ids } = await pizzaNight();
    await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Sara, toId: ids.Ali, amount: '20.00' });
    const b = await balances(agent, groupId);
    expect([b.Sara, b.Ali]).toEqual([700, -700]);
    expect((await agent.get(`/api/groups/${groupId}`)).body.group.suggestions).toEqual([{ fromId: ids.Ali, toId: ids.Sara, amountCents: 700 }]);
  });

  it('US-17 #3/#4 same person or bad amounts are refused', async () => {
    const { agent, groupId, ids } = await pizzaNight();
    const same = await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Ali, toId: ids.Ali, amount: '1' });
    expect(same.body.error.fields.people).toBe(MESSAGES.settleSamePerson);
    for (const amount of ['0', '0.001', '1000000.01', 'abc', '', '-1']) {
      const res = await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Sara, toId: ids.Ali, amount });
      expect(res.body.error.fields.amount).toBe(MESSAGES.settleAmount);
    }
    expect((await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Sara, toId: ids.Ali, amount: '1,000,000.00' })).status).toBe(201);
    expect((await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Sara, toId: ids.Ali, amount: '0.01' })).status).toBe(201);
  });

  it('US-18/US-19 any member edits and deletes; everything is logged', async () => {
    const { agent, groupId, ids, username } = await pizzaNight();
    const bills = (await agent.get(`/api/groups/${groupId}/bills`)).body.bills;
    const billId = bills[0].id;
    const detail = (await agent.get(`/api/groups/${groupId}/bills/${billId}`)).body.bill;
    const edited = { ...detail.input, tip: amt('25.00'), name: 'Pizza night' };
    expect((await agent.put(`/api/groups/${groupId}/bills/${billId}`).send({ bill: edited })).status).toBe(200);
    const bad = await agent.put(`/api/groups/${groupId}/bills/${billId}`).send({ bill: { ...edited, tip: amt('abc') } });
    expect(bad.status).toBe(400);
    await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Sara, toId: ids.Ali, amount: '5.00' });
    const settleId = (await agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps[0].id;
    await agent.put(`/api/groups/${groupId}/settle-ups/${settleId}`).send({ fromId: ids.Sara, toId: ids.Ali, amount: '6.00' });
    await agent.delete(`/api/groups/${groupId}/settle-ups/${settleId}`);
    expect((await agent.delete(`/api/groups/${groupId}/bills/${billId}`)).status).toBe(200);
    expect(await balances(agent, groupId)).toMatchObject({ Ali: 0, Sara: 0 });
    const log = await activity(agent, groupId);
    expect(log).toEqual(
      expect.arrayContaining([
        `${username} added 'Bill – ${detail.date.slice(8, 10).replace(/^0/, '')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(detail.date.slice(5, 7)) - 1]} ${detail.date.slice(0, 4)}' (65.00)`,
        `${username} edited 'Pizza night' (renamed from '${detail.name}'): 65.00 → 80.00`,
        `${username} recorded a payment: Sara paid Ali 5.00`,
        `${username} edited a payment: Sara paid Ali 5.00 → Sara paid Ali 6.00`,
        `${username} deleted a payment: Sara paid Ali 6.00`,
        `${username} deleted 'Pizza night' (80.00)`,
      ]),
    );
  });

  it('US-19 #1 the docs example message', async () => {
    const { agent, groupId, meId, username } = await pizzaNight();
    const created = await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId], meId, ['60.00'], { name: 'Pizza night' }) });
    const id = created.body.billId;
    await agent.put(`/api/groups/${groupId}/bills/${id}`).send({ bill: groupBill([meId], meId, ['65.00'], { name: 'Pizza night' }) });
    expect(await activity(agent, groupId)).toContain(`${username} edited 'Pizza night': 60.00 → 65.00`);
  });
});

describe('US-20..US-24 members leaving and coming back', () => {
  it('US-20 removal needs a 0.00 balance; old bills keep the member; access ends', async () => {
    const owner = await newUser();
    const { groupId, meId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const omar = await newUser('omar');
    const { code } = await joinWithCode(omar.agent, groupId, owner.agent);
    await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar });

    const bill = await owner.agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], ids.Omar, ['20.00'], { name: 'Pizza night' }) });
    const blocked = await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({});
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.message).toBe(MESSAGES.settleBeforeRemove);

    await owner.agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: meId, toId: ids.Omar, amount: '10.00' });
    const before = await balances(owner.agent, groupId);
    expect((await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({})).status).toBe(200);

    const g = (await owner.agent.get(`/api/groups/${groupId}`)).body.group;
    expect(g.members.find((m: { id: string }) => m.id === ids.Omar).status).toBe('removed');
    const detail = (await owner.agent.get(`/api/groups/${groupId}/bills/${bill.body.billId}`)).body.bill;
    expect(detail.lockedBy).toBe('Omar');
    expect(detail.totals.totalCents).toBe(2000);
    expect((await balances(owner.agent, groupId))[Object.keys(before)[0]]).toBe(before[Object.keys(before)[0]]);
    expect(g.suggestions).toEqual([]);

    // Not offered on new bills or settle-ups.
    const newBill = await owner.agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], meId, ['1']) });
    expect(newBill.status).toBe(400);
    const newSettle = await owner.agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: meId, toId: ids.Omar, amount: '1' });
    expect(newSettle.status).toBe(400);

    // US-18 #5 / US-20 #6 view-only.
    const edit = await owner.agent.put(`/api/groups/${groupId}/bills/${bill.body.billId}`).send({ bill: groupBill([meId], meId, ['1']) });
    expect(edit.body.error.message).toBe('Restore Omar to change this bill');
    const del = await owner.agent.delete(`/api/groups/${groupId}/bills/${bill.body.billId}`);
    expect(del.body.error.message).toBe('Restore Omar to change this bill');
    const settleId = (await owner.agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps[0].id;
    expect((await owner.agent.delete(`/api/groups/${groupId}/settle-ups/${settleId}`)).body.error.message).toBe('Restore Omar to change this bill');

    // #7 Omar loses access; his account is fine.
    expect((await omar.agent.get('/api/groups')).body.groups).toEqual([]);
    const denied = await omar.agent.get(`/api/groups/${groupId}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error.message).toBe(MESSAGES.noLongerAccess);
    expect((await omar.agent.get('/api/me')).status).toBe(200);
    expect(await activity(owner.agent, groupId)).toContain(`${owner.username} removed Omar`);
  });

  it('US-21 leaving needs a 0.00 balance and is logged', async () => {
    const owner = await newUser();
    const { groupId, meId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const omar = await newUser();
    const { code } = await joinWithCode(omar.agent, groupId, owner.agent);
    await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar });
    await owner.agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], meId, ['10.00']) });
    const blocked = await omar.agent.post(`/api/groups/${groupId}/leave`).send({});
    expect(blocked.body.error.message).toBe(MESSAGES.settleBeforeLeave);
    await owner.agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Omar, toId: meId, amount: '5.00' });
    expect((await omar.agent.post(`/api/groups/${groupId}/leave`).send({})).body.outcome).toBe('left');
    expect(await activity(owner.agent, groupId)).toContain('Omar left');
    expect((await omar.agent.get('/api/groups')).body.groups).toEqual([]);
  });

  it('US-22 the last account holder gets the warning, then the group is deleted', async () => {
    const owner = await newUser();
    const { groupId, meId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const code = (await owner.agent.get(`/api/groups/${groupId}`)).body.group.inviteCode;
    await owner.agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], meId, ['10.00']) });
    const warn = await owner.agent.post(`/api/groups/${groupId}/leave`).send({});
    expect(warn.status).toBe(409);
    expect(warn.body.error.message).toBe(MESSAGES.lastAccountWarning);
    expect((await owner.agent.get(`/api/groups/${groupId}`)).status).toBe(200);
    // Unsettled balance doesn't block it.
    expect((await owner.agent.post(`/api/groups/${groupId}/leave`).send({ confirmDelete: true })).body.outcome).toBe('deleted');
    const gone = await owner.agent.get(`/api/groups/${groupId}`);
    expect(gone.status).toBe(404);
    expect(gone.body.error.message).toBe(MESSAGES.groupGone);
    expect((await owner.agent.post('/api/join').send({ code })).body.error.message).toBe(MESSAGES.inviteInvalid);
    const { pool } = testApp();
    for (const table of ['members', 'group_bills', 'settle_ups', 'activity']) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE group_id = $1`, [groupId])).rows[0].n).toBe(0);
    }
    expect((await owner.agent.get('/api/me')).status).toBe(200);
  });

  it('US-23 any member restores; full limit is respected', async () => {
    const owner = await newUser();
    const { groupId } = await createGroup(owner.agent);
    const names = Array.from({ length: 49 }, (_, i) => `M${i}`);
    const ids = await addMembers(owner.agent, groupId, names);
    await owner.agent.post(`/api/groups/${groupId}/members/${ids.M0}/remove`).send({});
    await owner.agent.post(`/api/groups/${groupId}/members`).send({ name: 'Newcomer' });
    const full = await owner.agent.post(`/api/groups/${groupId}/members/${ids.M0}/restore`).send({});
    expect(full.status).toBe(400);
    expect(full.body.error.message).toBe("This group already has 50 members, so M0 can't be restored");
    const newcomer = (await owner.agent.get(`/api/groups/${groupId}`)).body.group.members.find((m: { name: string }) => m.name === 'Newcomer');
    await owner.agent.post(`/api/groups/${groupId}/members/${newcomer.id}/remove`).send({});
    expect((await owner.agent.post(`/api/groups/${groupId}/members/${ids.M0}/restore`).send({})).status).toBe(200);
    expect(await activity(owner.agent, groupId)).toContain(`${owner.username} restored M0`);
    const m0 = (await owner.agent.get(`/api/groups/${groupId}`)).body.group.members.find((m: { id: string }) => m.id === ids.M0);
    expect(m0).toMatchObject({ name: 'M0', status: 'current' });
  });

  it('US-23 #4 / US-24 rejoining with the code restores access and editing', async () => {
    const owner = await newUser();
    const { groupId, meId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const omar = await newUser();
    const { code } = await joinWithCode(omar.agent, groupId, owner.agent);
    await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar });
    const bill = await owner.agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], meId, ['10.00']) });
    await owner.agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Omar, toId: meId, amount: '5.00' });
    await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({});

    const rejoin = await omar.agent.post('/api/join').send({ code });
    expect(rejoin.body).toEqual({ status: 'rejoined', groupId });
    expect(await activity(owner.agent, groupId)).toContain('Omar rejoined with the invite code');
    expect((await omar.agent.get(`/api/groups/${groupId}/bills`)).body.bills).toHaveLength(1);
    const edit = await owner.agent.put(`/api/groups/${groupId}/bills/${bill.body.billId}`).send({ bill: groupBill([meId, ids.Omar], meId, ['12.00']) });
    expect(edit.status).toBe(200);
  });

  it('US-24 #2 a full group refuses a rejoin', async () => {
    const owner = await newUser();
    const { groupId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const omar = await newUser();
    const { code } = await joinWithCode(omar.agent, groupId, owner.agent);
    await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar });
    await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({});
    await addMembers(owner.agent, groupId, Array.from({ length: 49 }, (_, i) => `F${i}`));
    const res = await omar.agent.post('/api/join').send({ code });
    expect(res.status).toBe(400);
    expect((await omar.agent.get(`/api/groups/${groupId}`)).status).toBe(403);
  });
});

describe('US-33 dashboard', () => {
  it('shows per-currency totals, groups with my balance, latest solo bills', async () => {
    const me = await newUser();
    const empty = (await me.agent.get('/api/dashboard')).body;
    expect(empty).toEqual({ owe: [], owed: [], groups: [], soloBills: [] });

    const usd = await createGroup(me.agent, 'Dollars', '$');
    const rs = await createGroup(me.agent, 'Rupees', 'Rs');
    const usdIds = await addMembers(me.agent, usd.groupId, ['Ali']);
    const rsIds = await addMembers(me.agent, rs.groupId, ['Sara']);
    await me.agent.post(`/api/groups/${usd.groupId}/bills`).send({ bill: groupBill([usd.meId, usdIds.Ali], usd.meId, ['30.00']) });
    await me.agent.post(`/api/groups/${rs.groupId}/bills`).send({ bill: groupBill([rs.meId, rsIds.Sara], rsIds.Sara, ['800.00']) });
    await me.agent.post('/api/solo-bills').send({ currency: '$', bill: { name: 'Solo', items: [{ name: '', price: '3' }], tax: amt('0'), otherCharges: amt(''), tip: pct('0'), tipOn: 'items' } });
    const d = (await me.agent.get('/api/dashboard')).body;
    expect(d.owed).toEqual([{ currency: '$', cents: 1500 }]);
    expect(d.owe).toEqual([{ currency: 'Rs', cents: 40000 }]);
    expect(d.groups.map((g: { name: string; myBalanceCents: number }) => [g.name, g.myBalanceCents])).toEqual([
      ['Dollars', 1500],
      ['Rupees', -40000],
    ]);
    expect(d.soloBills.map((b: { name: string }) => b.name)).toEqual(['Solo']);
  });
});
