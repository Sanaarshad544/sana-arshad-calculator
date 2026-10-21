import { Router } from 'express';
import { GROUP_FULL_REJOIN, MAX_GROUP_MEMBERS, MESSAGES } from '../shared/rules.js';
import type { DashboardDto, JoinResult } from '../shared/api.js';
import { currentAccount, requireAuth } from './auth.js';
import { transaction, type Pool, type Queryable } from './db.js';
import { HttpError, badRequest } from './http.js';
import { countCurrent, listMyGroups, logActivity, normalizeInviteCode, type GroupRow, type MemberRow } from './groups.js';

async function findGroupByCode(db: Queryable, code: unknown, lock = false): Promise<GroupRow> {
  const normalized = normalizeInviteCode(code);
  const { rows } = await db.query<GroupRow>(
    `SELECT id, name, currency, invite_code FROM groups WHERE invite_code = $1${lock ? ' FOR UPDATE' : ''}`,
    [normalized],
  );
  if (!normalized || !rows[0]) throw new HttpError(404, MESSAGES.inviteInvalid, { code: MESSAGES.inviteInvalid });
  return rows[0];
}

/**
 * Entering an invite code:
 * - already a current member: "You're already in this group"
 * - removed member with this account: restored automatically ("rejoined")
 * - otherwise: choose an unclaimed name (current or removed) to claim
 */
export function joinRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.post('/', async (req, res) => {
    const account = currentAccount(res);
    const result = await transaction(pool, async (client): Promise<JoinResult> => {
      const group = await findGroupByCode(client, req.body?.code, true);
      const mine = await client.query<MemberRow>(
        'SELECT id, name, account_id, status FROM members WHERE group_id = $1 AND account_id = $2',
        [group.id, account.id],
      );
      const me = mine.rows[0];
      if (me?.status === 'current') throw new HttpError(409, MESSAGES.alreadyInGroup, undefined, 'ALREADY_IN');
      if (me) {
        if ((await countCurrent(client, group.id)) >= MAX_GROUP_MEMBERS) throw badRequest(GROUP_FULL_REJOIN);
        await client.query("UPDATE members SET status = 'current' WHERE id = $1", [me.id]);
        await logActivity(client, group.id, me.name, `${me.name} rejoined with the invite code`);
        return { status: 'rejoined', groupId: String(group.id) };
      }
      const { rows } = await client.query<MemberRow>(
        'SELECT id, name, account_id, status FROM members WHERE group_id = $1 AND account_id IS NULL ORDER BY id',
        [group.id],
      );
      return {
        status: 'choose',
        groupId: String(group.id),
        groupName: group.name,
        choices: rows.map((r) => ({ memberId: String(r.id), name: r.name, removed: r.status === 'removed' })),
      };
    });
    res.json(result);
  });

  router.post('/claim', async (req, res) => {
    const account = currentAccount(res);
    const memberId = /^\d{1,15}$/.test(String(req.body?.memberId ?? '')) ? Number(req.body.memberId) : -1;
    const groupId = await transaction(pool, async (client) => {
      const group = await findGroupByCode(client, req.body?.code, true);
      const mine = await client.query<MemberRow>(
        'SELECT id, status FROM members WHERE group_id = $1 AND account_id = $2',
        [group.id, account.id],
      );
      if (mine.rows[0]) throw new HttpError(409, MESSAGES.alreadyInGroup, undefined, 'ALREADY_IN');
      const { rows } = await client.query<MemberRow>(
        'SELECT id, name, account_id, status FROM members WHERE id = $1 AND group_id = $2',
        [memberId, group.id],
      );
      const target = rows[0];
      if (!target) throw badRequest('Choose a name from the list');
      if (target.account_id !== null) throw new HttpError(409, 'That name has already been claimed');
      if (target.status === 'removed' && (await countCurrent(client, group.id)) >= MAX_GROUP_MEMBERS) {
        throw badRequest(GROUP_FULL_REJOIN);
      }
      await client.query("UPDATE members SET account_id = $2, status = 'current' WHERE id = $1", [target.id, account.id]);
      await logActivity(client, group.id, target.name, `${target.name} claimed the name ${target.name}`);
      if (target.status === 'removed') {
        await logActivity(client, group.id, target.name, `${target.name} rejoined with the invite code`);
      }
      return group.id;
    });
    res.json({ groupId: String(groupId) });
  });

  return router;
}

export function dashboardRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (_req, res) => {
    const account = currentAccount(res);
    const groups = await listMyGroups(pool, account.id);
    const owe = new Map<string, number>();
    const owed = new Map<string, number>();
    for (const g of groups) {
      if (g.myBalanceCents < 0) owe.set(g.currency, (owe.get(g.currency) ?? 0) - g.myBalanceCents);
      if (g.myBalanceCents > 0) owed.set(g.currency, (owed.get(g.currency) ?? 0) + g.myBalanceCents);
    }
    const solo = await pool.query<{ id: number; name: string; bill_date: string; currency: string; total_cents: number }>(
      'SELECT id, name, bill_date, currency, total_cents FROM solo_bills WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 5',
      [account.id],
    );
    const dto: DashboardDto = {
      owe: [...owe].map(([currency, cents]) => ({ currency, cents })),
      owed: [...owed].map(([currency, cents]) => ({ currency, cents })),
      groups,
      soloBills: solo.rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        date: r.bill_date,
        currency: r.currency,
        totalCents: r.total_cents,
      })),
    };
    res.json(dto);
  });

  return router;
}
