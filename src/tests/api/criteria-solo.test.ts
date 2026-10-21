// Server-side proofs for criteria in docs/user-stories.md about requests sent straight to the server.
import { describe, expect, it } from 'vitest';
import { addMembers, createGroup, groupBill, newUser, soloBill, testApp, type Agent } from './helpers.js';

describe("US-04 #2/#4 another account's solo bill", () => {
  it('cannot be read, changed or deleted by someone else, and stays as it was', async () => {
    const owner = await newUser('own');
    const other = await newUser('oth');
    const created = await owner.agent.post('/api/solo-bills').send({ currency: '$', bill: soloBill(['123.45'], { name: 'Secret dinner' }) });
    expect(created.status).toBe(201);
    const id = created.body.bill.id as string;

    const read = await other.agent.get(`/api/solo-bills/${id}`);
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toMatch(/Secret dinner|123\.45/);
    expect((await other.agent.put(`/api/solo-bills/${id}`).send({ bill: soloBill(['1.00'], { name: 'Hacked' }) })).status).toBe(404);
    expect((await other.agent.delete(`/api/solo-bills/${id}`)).status).toBe(404);
    expect((await other.agent.get('/api/solo-bills')).body.bills).toEqual([]);

    const still = await owner.agent.get(`/api/solo-bills/${id}`);
    expect(still.status).toBe(200);
    expect(still.body.bill).toMatchObject({ name: 'Secret dinner', totalCents: 12345 });
  });
});

/**
 * Makes inserts into `table` fail for one group only, so a save that gets partway
 * (bill and items written, then this table) has to be rolled back. The trigger is
 * removed again afterwards.
 */
async function withFailingInserts<T>(table: 'group_bill_shares' | 'activity', groupId: string, run: () => Promise<T>): Promise<T> {
  if (!/^\d+$/.test(groupId)) throw new Error('group id must be a number');
  const { pool } = testApp();
  const fn = `fail_${table}_${groupId}`;
  const groupOfRow =
    table === 'group_bill_shares' ? `(SELECT group_id FROM group_bills WHERE id = NEW.bill_id)` : `NEW.group_id`;
  await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${groupOfRow} = ${groupId} THEN
        RAISE EXCEPTION 'simulated failure';
      END IF;
      RETURN NEW;
    END $$`);
  await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  try {
    return await run();
  } finally {
    await pool.query(`DROP TRIGGER ${fn} ON ${table}; DROP FUNCTION ${fn}()`);
  }
}

async function activityMessages(agent: Agent, groupId: string): Promise<string[]> {
  return (await agent.get(`/api/groups/${groupId}/activity`)).body.activity.map((a: { message: string }) => a.message);
}

async function counts(groupId: string) {
  const { pool } = testApp();
  const one = async (sql: string) => Number((await pool.query(sql, [groupId])).rows[0].n);
  return {
    bills: await one('SELECT count(*) AS n FROM group_bills WHERE group_id = $1'),
    items: await one('SELECT count(*) AS n FROM group_bill_items i JOIN group_bills b ON b.id = i.bill_id WHERE b.group_id = $1'),
    shares: await one('SELECT count(*) AS n FROM group_bill_shares s JOIN members m ON m.id = s.member_id WHERE m.group_id = $1'),
    activity: await one('SELECT count(*) AS n FROM activity WHERE group_id = $1'),
  };
}

describe('US-27 #4 a group bill save that fails partway stores nothing', () => {
  for (const failingTable of ['group_bill_shares', 'activity'] as const) {
    it(`fails at the ${failingTable} step: no bill, no items, no shares, no activity row, balances unchanged`, async () => {
      const { agent } = await newUser();
      const { groupId, meId } = await createGroup(agent, 'Partway', '$');
      const ids = await addMembers(agent, groupId, ['Ali']);
      const before = await counts(groupId);
      const messagesBefore = await activityMessages(agent, groupId);
      const bill = groupBill([meId, ids.Ali], meId, ['30.00', '10.00'], { name: 'Pizza night' });

      const failed = await withFailingInserts(failingTable, groupId, () => agent.post(`/api/groups/${groupId}/bills`).send({ bill }));
      expect(failed.status).toBe(500);

      expect(await counts(groupId)).toEqual(before);
      expect(before).toMatchObject({ bills: 0, items: 0, shares: 0 });
      expect(await activityMessages(agent, groupId)).toEqual(messagesBefore);
      expect((await agent.get(`/api/groups/${groupId}/bills`)).body.bills).toEqual([]);
      const detail = (await agent.get(`/api/groups/${groupId}`)).body.group;
      for (const m of detail.members) expect(m.balanceCents).toBe(0);

      // Not vacuous: the very same request succeeds once the failure is gone,
      // and then the bill, its parts and its activity row all exist together.
      const ok = await agent.post(`/api/groups/${groupId}/bills`).send({ bill });
      expect(ok.status).toBe(201);
      const after = await counts(groupId);
      expect(after).toMatchObject({ bills: 1, items: 2, shares: 2 });
      expect(after.activity).toBe(before.activity + 1);
      expect((await activityMessages(agent, groupId)).some((m) => m.includes('Pizza night'))).toBe(true);
    });
  }
});
