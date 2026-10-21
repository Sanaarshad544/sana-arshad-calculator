import { describe, expect, it } from 'vitest';
import { addMembers, createGroup, groupBill, newUser, type Agent } from './helpers.js';

interface MemberRow {
  id: string;
  name: string;
  status: 'current' | 'removed';
  balanceCents: number;
}

/** Every member the group has ever had (current and removed), by id. */
async function allMembers(agent: Agent, groupId: string): Promise<MemberRow[]> {
  const res = await agent.get(`/api/groups/${groupId}`);
  expect(res.status).toBe(200);
  return res.body.group.members as MemberRow[];
}

const balanceById = (members: MemberRow[]) => Object.fromEntries(members.map((m) => [m.id, m.balanceCents]));

describe('US-20 #4 removing a member changes nobody\'s balance', () => {
  it('US-20 #4 every member\'s balance is identical before and after the removal, and the bill is unchanged', async () => {
    const owner = await newUser('own');
    const { groupId, meId } = await createGroup(owner.agent, 'Pizza club');
    const ids = await addMembers(owner.agent, groupId, ['Omar', 'Sara']);

    // Pizza night: Omar paid 30.00 for the three of them (10.00 each).
    const pizza = await owner.agent
      .post(`/api/groups/${groupId}/bills`)
      .send({ bill: groupBill([meId, ids.Omar, ids.Sara], ids.Omar, ['30.00'], { name: 'Pizza night' }) });
    expect(pizza.status).toBe(201);
    // Owner paid 20.00 for themself and Sara, so Sara and the owner end up with real, non-zero balances.
    const second = await owner.agent
      .post(`/api/groups/${groupId}/bills`)
      .send({ bill: groupBill([meId, ids.Sara], meId, ['20.00'], { name: 'Drinks' }) });
    expect(second.status).toBe(201);
    // Settle Omar up to exactly 0.00: he is owed 20.00, the owner and Sara each pay him 10.00.
    for (const fromId of [meId, ids.Sara]) {
      const settle = await owner.agent.post(`/api/groups/${groupId}/settle-ups`).send({ fromId, toId: ids.Omar, amount: '10.00' });
      expect(settle.status).toBe(201);
    }

    const before = await allMembers(owner.agent, groupId);
    expect(before.find((m) => m.id === ids.Omar)).toMatchObject({ status: 'current', balanceCents: 0 });
    // The scenario is meaningful: somebody other than Omar has a non-zero balance.
    expect(before.filter((m) => m.id !== ids.Omar).some((m) => m.balanceCents !== 0)).toBe(true);
    const billBefore = (await owner.agent.get(`/api/groups/${groupId}/bills/${pizza.body.billId}`)).body.bill;

    const removed = await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({});
    expect(removed.status).toBe(200);

    const after = await allMembers(owner.agent, groupId);
    expect(after.find((m) => m.id === ids.Omar)).toMatchObject({ status: 'removed' });
    // Every member (Omar included), compared by id, has exactly the same balance.
    expect(after).toHaveLength(before.length);
    expect(balanceById(after)).toEqual(balanceById(before));

    const billAfter = (await owner.agent.get(`/api/groups/${groupId}/bills/${pizza.body.billId}`)).body.bill;
    expect(billAfter.lockedBy).toBe('Omar');
    expect(billAfter.totals).toEqual(billBefore.totals);
    expect(billAfter.shares).toEqual(billBefore.shares);
    expect(billAfter.payerId).toBe(ids.Omar);
    expect(billAfter.input.participantIds).toEqual(billBefore.input.participantIds);
  });
});

describe('US-24 #2 rejoining a full group', () => {
  it('US-24 #2 says "This group already has 50 members, so you can\'t rejoin right now" and Omar stays removed', async () => {
    const owner = await newUser('own');
    const { groupId } = await createGroup(owner.agent);
    const ids = await addMembers(owner.agent, groupId, ['Omar']);
    const omar = await newUser('omar');
    const code = (await owner.agent.get(`/api/groups/${groupId}`)).body.group.inviteCode as string;
    const claim = await omar.agent.post('/api/join/claim').send({ code, memberId: ids.Omar });
    expect(claim.status).toBe(200);
    expect((await owner.agent.post(`/api/groups/${groupId}/members/${ids.Omar}/remove`).send({})).status).toBe(200);

    // The owner plus 49 friends make 50 current members.
    await addMembers(owner.agent, groupId, Array.from({ length: 49 }, (_, i) => `F${i}`));
    const members = await allMembers(owner.agent, groupId);
    expect(members.filter((m) => m.status === 'current')).toHaveLength(50);

    const rejoin = await omar.agent.post('/api/join').send({ code });
    expect(rejoin.status).toBe(400);
    expect(rejoin.body.error.message).toBe("This group already has 50 members, so you can't rejoin right now");

    // He stays removed: still no access, still listed as removed, still 50 current members.
    expect((await omar.agent.get(`/api/groups/${groupId}`)).status).toBe(403);
    const afterwards = await allMembers(owner.agent, groupId);
    expect(afterwards.find((m) => m.id === ids.Omar)?.status).toBe('removed');
    expect(afterwards.filter((m) => m.status === 'current')).toHaveLength(50);
  });
});
