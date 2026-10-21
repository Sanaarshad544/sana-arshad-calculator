import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { addMembers, amt, balances, createGroup, groupBill, inviteCodeOf, newUser, type Agent } from './helpers.js';

interface MemberView {
  id: string;
  name: string;
  status: 'current' | 'removed';
  balanceCents: number;
}

async function groupDetail(agent: Agent, groupId: string) {
  const res = await agent.get(`/api/groups/${groupId}`);
  return res.body.group as { members: MemberView[]; suggestions: { fromId: string; toId: string; amountCents: number }[] };
}

/** A second account that took over the name `name` in the owner's group. */
async function claimAs(owner: Agent, groupId: string, memberId: string) {
  const second = await newUser('second');
  const memberName = (await owner.get(`/api/groups/${groupId}`)).body.group.members.find((m: { id: string }) => m.id === memberId).name;
  const code = await inviteCodeOf(owner, groupId, memberName);
  const claim = await second.agent.post(`/api/invites/${code}/accept`).send({});
  expect(claim.status).toBe(200);
  return second;
}

describe('US-16 #5 a removed member is not a balance holder or part of any suggestion', () => {
  it('returns the removed member only with status "removed", and suggestions never mention them', async () => {
    const { agent, username } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Omar', 'Ali', 'Sara']);

    // Omar takes part in a bill and then pays back exactly his share, so his balance is 0.00 and he can be removed.
    await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Omar], meId, ['20.00']) });
    await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Omar, toId: meId, amount: '10.00' });
    expect((await agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({})).status).toBe(200);

    // Other people still owe money, so there are suggestions to check.
    await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([ids.Ali, ids.Sara], ids.Ali, ['30.00']) });

    const g = await groupDetail(agent, groupId);
    const omarEntries = g.members.filter((m) => m.name === 'Omar');
    expect(omarEntries).toHaveLength(1);
    expect(omarEntries[0].status).toBe('removed');
    expect(omarEntries[0].id).toBe(ids.Omar);
    expect(g.members.filter((m) => m.status === 'current').map((m) => m.name)).toEqual([username, 'Ali', 'Sara']);

    expect(g.suggestions).toEqual([{ fromId: ids.Sara, toId: ids.Ali, amountCents: 1500 }]);
    for (const s of g.suggestions) {
      expect(s.fromId).not.toBe(ids.Omar);
      expect(s.toId).not.toBe(ids.Omar);
    }
    expect(JSON.stringify(g.suggestions)).not.toContain(ids.Omar);
  });
});

describe('US-18 #1 any current member edits and deletes bills and settle-ups made by someone else', () => {
  it("a second account that claimed a member edits and deletes the first account's bill and settle-up", async () => {
    const owner = await newUser();
    const { groupId, meId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const second = await claimAs(owner.agent, groupId, ids.Omar);

    const created = await owner.agent
      .post(`/api/groups/${groupId}/bills`)
      .send({ bill: groupBill([meId, ids.Omar], meId, ['20.00'], { name: 'Pizza night' }) });
    expect(created.status).toBe(201);
    const billId = created.body.billId as string;
    expect((await owner.agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Omar, toId: meId, amount: '4.00' })).status).toBe(201);
    const settleId = (await owner.agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps[0].id as string;

    // The second account edits the owner's bill.
    const edit = await second.agent
      .put(`/api/groups/${groupId}/bills/${billId}`)
      .send({ bill: groupBill([meId, ids.Omar], meId, ['30.00'], { name: 'Pizza night' }) });
    expect(edit.status).toBe(200);
    const detail = (await owner.agent.get(`/api/groups/${groupId}/bills/${billId}`)).body.bill;
    expect(detail.totals.totalCents).toBe(3000);
    // Omar owes 15.00, has paid 4.00 back.
    expect((await balances(owner.agent, groupId)).Omar).toBe(-1100);

    // ... and the owner's settle-up.
    const editSettle = await second.agent.put(`/api/groups/${groupId}/settle-ups/${settleId}`).send({ fromId: ids.Omar, toId: meId, amount: '6.00' });
    expect(editSettle.status).toBe(200);
    const settleUps = (await owner.agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps;
    expect(settleUps[0]).toMatchObject({ id: settleId, amountCents: 600 });
    expect((await balances(owner.agent, groupId)).Omar).toBe(-900);

    // The second account deletes both.
    expect((await second.agent.delete(`/api/groups/${groupId}/settle-ups/${settleId}`)).status).toBe(200);
    expect((await owner.agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps).toEqual([]);
    expect((await second.agent.delete(`/api/groups/${groupId}/bills/${billId}`)).status).toBe(200);
    expect((await owner.agent.get(`/api/groups/${groupId}/bills`)).body.bills).toEqual([]);
    expect(await balances(owner.agent, groupId)).toMatchObject({ Omar: 0 });
  });
});

describe('US-18 #2 saving an edited settle-up is checked with the same rules as a new one', () => {
  it('rejects an invalid settle-up edit with its message and leaves the settle-up and balances unchanged', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Ali']);
    expect((await agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId: ids.Ali, toId: meId, amount: '7.00' })).status).toBe(201);
    const settleId = (await agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps[0].id as string;
    const balancesBefore = await balances(agent, groupId);

    for (const amount of ['0', 'abc', '1.234', '', '-1', '1000000.01']) {
      const res = await agent.put(`/api/groups/${groupId}/settle-ups/${settleId}`).send({ fromId: ids.Ali, toId: meId, amount });
      expect(res.status, `amount "${amount}"`).toBe(400);
      expect(res.body.error.fields.amount, `amount "${amount}"`).toBe(MESSAGES.settleAmount);
    }
    const same = await agent.put(`/api/groups/${groupId}/settle-ups/${settleId}`).send({ fromId: ids.Ali, toId: ids.Ali, amount: '7.00' });
    expect(same.status).toBe(400);
    expect(same.body.error.fields.people).toBe(MESSAGES.settleSamePerson);

    const after = (await agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: settleId, fromId: ids.Ali, toId: meId, amountCents: 700 });
    expect(await balances(agent, groupId)).toEqual(balancesBefore);

    // A valid edit still goes through, so the rejections above were about the values.
    expect((await agent.put(`/api/groups/${groupId}/settle-ups/${settleId}`).send({ fromId: ids.Ali, toId: meId, amount: '8.00' })).status).toBe(200);
    expect((await agent.get(`/api/groups/${groupId}/settle-ups`)).body.settleUps[0].amountCents).toBe(800);
  });

  it('rejects an invalid group bill edit the same way a new bill is rejected, and keeps the saved bill', async () => {
    const { agent } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Ali']);
    const created = await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.Ali], meId, ['10.00'], { name: 'Lunch' }) });
    const billId = created.body.billId as string;
    const bad = await agent
      .put(`/api/groups/${groupId}/bills/${billId}`)
      .send({ bill: groupBill([meId, ids.Ali], meId, ['10.00'], { name: 'Lunch', otherCharges: amt('0.001') }) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.otherCharges).toBe(MESSAGES.otherAmount);
    const detail = (await agent.get(`/api/groups/${groupId}/bills/${billId}`)).body.bill;
    expect(detail.totals.totalCents).toBe(1000);
  });
});
