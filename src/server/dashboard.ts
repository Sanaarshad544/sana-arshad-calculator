import { Router } from 'express';
import { suggestPayments } from '../shared/balances.js';
import type { DashboardDto, MyDebt } from '../shared/api.js';
import { currentAccount, requireAuth } from './auth.js';
import type { Pool } from './db.js';
import { listMyGroups, loadBalances, loadMembers } from './groups.js';

/** The home screen: totals per currency, who I owe or who owes me, my groups, latest solo bills. */
export function dashboardRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (_req, res) => {
    const account = currentAccount(res);
    const groups = await listMyGroups(pool, account.id);
    const owe = new Map<string, number>();
    const owed = new Map<string, number>();
    const debts: MyDebt[] = [];
    for (const g of groups) {
      if (g.myBalanceCents < 0) owe.set(g.currency, (owe.get(g.currency) ?? 0) - g.myBalanceCents);
      if (g.myBalanceCents > 0) owed.set(g.currency, (owed.get(g.currency) ?? 0) + g.myBalanceCents);
      if (g.myBalanceCents === 0) continue;
      // The same suggested payments the group page shows, keeping the ones that involve me.
      const members = (await loadMembers(pool, Number(g.id))).filter((m) => m.status === 'current');
      const balances = await loadBalances(pool, Number(g.id));
      const me = members.find((m) => m.account_id === account.id);
      const names = new Map(members.map((m) => [String(m.id), m.name]));
      const payments = suggestPayments(members.map((m) => ({ memberId: String(m.id), cents: balances.get(m.id) ?? 0 })));
      for (const p of payments) {
        if (p.fromId !== String(me?.id) && p.toId !== String(me?.id)) continue;
        const direction = p.fromId === String(me?.id) ? 'owe' : 'owed';
        debts.push({
          groupId: g.id,
          groupName: g.name,
          currency: g.currency,
          otherName: names.get(direction === 'owe' ? p.toId : p.fromId) ?? 'Someone',
          cents: p.amountCents,
          direction,
        });
      }
    }
    const solo = await pool.query<{ id: number; name: string; bill_date: string; currency: string; total_cents: number }>(
      'SELECT id, name, bill_date, currency, total_cents FROM solo_bills WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT 5',
      [account.id],
    );
    const dto: DashboardDto = {
      owe: [...owe].map(([currency, cents]) => ({ currency, cents })),
      owed: [...owed].map(([currency, cents]) => ({ currency, cents })),
      debts,
      groups,
      soloBills: solo.rows.map((r) => ({ id: String(r.id), name: r.name, date: r.bill_date, currency: r.currency, totalCents: r.total_cents })),
    };
    res.json(dto);
  });

  return router;
}
