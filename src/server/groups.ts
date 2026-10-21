import { Router, type Response } from 'express';
import { checkGroupBill, computeGroupBill, type GroupBill, type GroupBillInput } from '../shared/bill.js';
import { suggestPayments } from '../shared/balances.js';
import { MAX_FIELD_CENTS, formatCents, parseHundredths } from '../shared/money.js';
import {
  MAX_GROUP_MEMBERS,
  MESSAGES,
  checkCurrency,
  checkGroupName,
  checkMemberName,
  defaultBillName,
  groupFullRestore,
  nameKey,
  restoreToChange,
} from '../shared/rules.js';
import type {
  ActivityDto,
  GroupBillDetail,
  GroupBillSummary,
  GroupDetail,
  GroupSummary,
  MemberDto,
  SettleUpDto,
} from '../shared/api.js';
import { currentAccount, requireAuth } from './auth.js';
import { transaction, type Client, type Pool, type Queryable } from './db.js';
import { HttpError, badRequest, fieldError } from './http.js';
import { chargeValues, dateString, rowToInput, rowTotals, today, totalsValues, type ChargeColumns, type TotalsColumns } from './billRows.js';
import { parseId } from './solo.js';
import { logActivity } from './activity.js';
import { myPeople, renewInviteBeforeAdd, renewInvitesIn, visibleInvites } from './people.js';

// ---------- Rows and helpers ----------

export interface GroupRow {
  id: number;
  name: string;
  currency: string;
}

export interface MemberRow {
  id: number;
  name: string;
  account_id: number | null;
  person_id: number | null;
  status: 'current' | 'removed';
}

interface BillRow extends ChargeColumns, TotalsColumns {
  id: number;
  name: string;
  bill_date: string;
  split_mode: 'equal' | 'itemized';
  payer_member_id: number;
}

interface SettleRow {
  id: number;
  from_member_id: number;
  to_member_id: number;
  amount_cents: number;
  created_at: Date;
}

export async function loadMembers(db: Queryable, groupId: number): Promise<MemberRow[]> {
  const { rows } = await db.query<MemberRow>(
    'SELECT id, name, account_id, person_id, status FROM members WHERE group_id = $1 ORDER BY id',
    [groupId],
  );
  return rows;
}

export async function countCurrent(db: Queryable, groupId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM members WHERE group_id = $1 AND status = 'current'",
    [groupId],
  );
  return rows[0].n;
}

/** Net balance of every member: paid − own shares + settle-ups paid − settle-ups received. */
export async function loadBalances(db: Queryable, groupId: number): Promise<Map<number, number>> {
  const { rows } = await db.query<{ id: number; balance: number }>(
    `SELECT m.id,
       (COALESCE((SELECT SUM(b.total_cents) FROM group_bills b WHERE b.payer_member_id = m.id), 0)
      - COALESCE((SELECT SUM(s.total_cents) FROM group_bill_shares s WHERE s.member_id = m.id), 0)
      + COALESCE((SELECT SUM(u.amount_cents) FROM settle_ups u WHERE u.from_member_id = m.id), 0)
      - COALESCE((SELECT SUM(u.amount_cents) FROM settle_ups u WHERE u.to_member_id = m.id), 0))::bigint AS balance
     FROM members m WHERE m.group_id = $1`,
    [groupId],
  );
  return new Map(rows.map((r) => [r.id, r.balance]));
}

export interface Membership {
  group: GroupRow;
  me: MemberRow;
}

/**
 * Checks that the logged-in account is a current member of the group.
 * With `lock`, the group row is locked so changes to one group happen one at a time.
 */
export async function loadMembership(db: Queryable, groupId: number, accountId: number, lock = false): Promise<Membership> {
  const { rows } = await db.query<GroupRow>(
    `SELECT id, name, currency FROM groups WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [groupId],
  );
  const group = rows[0];
  if (!group) throw new HttpError(404, MESSAGES.groupGone, undefined, 'GROUP_GONE');
  const me = await db.query<MemberRow>(
    'SELECT id, name, account_id, person_id, status FROM members WHERE group_id = $1 AND account_id = $2',
    [groupId, accountId],
  );
  if (!me.rows[0]) throw new HttpError(403, MESSAGES.noAccess, undefined, 'NO_ACCESS');
  if (me.rows[0].status !== 'current') throw new HttpError(403, MESSAGES.noLongerAccess, undefined, 'NO_ACCESS');
  return { group, me: me.rows[0] };
}

function groupIdParam(res: Response, raw: string | undefined): { accountId: number; groupId: number } {
  const groupId = /^\d{1,15}$/.test(raw ?? '') ? Number(raw) : -1;
  if (groupId < 0) throw new HttpError(404, MESSAGES.groupGone, undefined, 'GROUP_GONE');
  return { accountId: currentAccount(res).id, groupId };
}

/** Runs a change to one group in a transaction, with the group locked and membership checked. */
async function withGroup<T>(
  pool: Pool,
  res: Response,
  rawId: string | undefined,
  fn: (client: Client, m: Membership) => Promise<T>,
): Promise<T> {
  const { accountId, groupId } = groupIdParam(res, rawId);
  return transaction(pool, async (client) => fn(client, await loadMembership(client, groupId, accountId, true)));
}

async function readGroup(pool: Pool, res: Response, rawId: string | undefined): Promise<Membership> {
  const { accountId, groupId } = groupIdParam(res, rawId);
  return loadMembership(pool, groupId, accountId);
}

function nameOf(members: MemberRow[], id: number): string {
  return members.find((m) => m.id === id)?.name ?? 'Someone';
}

/** The first removed member among `ids`, if any (that makes a record view-only). */
function removedAmong(members: MemberRow[], ids: number[]): MemberRow | undefined {
  return members.find((m) => m.status === 'removed' && ids.includes(m.id));
}

// ---------- Group detail ----------

export async function buildGroupDetail(pool: Pool, m: Membership): Promise<GroupDetail> {
  const members = await loadMembers(pool, m.group.id);
  const balances = await loadBalances(pool, m.group.id);
  // Current members who haven't joined each have their own invite. I see a code
  // only when I'm in every group that person is in.
  const waiting = members.filter((row) => row.status === 'current' && row.account_id === null && row.person_id !== null);
  const invites = await visibleInvites(pool, m.me.account_id as number, waiting.map((row) => row.person_id as number));
  // A person who already joined, but whose entry here was skipped because their account was already in this group.
  const joined = await pool.query<{ id: number; account_id: number }>(
    'SELECT id, account_id FROM persons WHERE id = ANY($1::bigint[]) AND account_id IS NOT NULL',
    [waiting.map((row) => row.person_id as number)],
  );
  const joinedAccount = new Map(joined.rows.map((r) => [r.id, r.account_id]));
  const inviteOf = (row: MemberRow): Pick<MemberDto, 'inviteCode' | 'inviteNote' | 'alsoHereAs'> => {
    const none = { inviteCode: null, inviteNote: null, alsoHereAs: null };
    if (!waiting.includes(row)) return none;
    const personId = row.person_id as number;
    const account = joinedAccount.get(personId);
    if (account !== undefined) {
      return { ...none, alsoHereAs: members.find((x) => x.account_id === account)?.name ?? null, inviteNote: 'joined' };
    }
    const code = invites.get(personId);
    if (code === undefined) return none;
    return code ? { ...none, inviteCode: code } : { ...none, inviteNote: 'elsewhere' };
  };
  const dto: MemberDto[] = members
    .map((row) => ({
      id: String(row.id),
      name: row.name,
      status: row.status,
      hasAccount: row.account_id !== null,
      isMe: row.id === m.me.id,
      balanceCents: balances.get(row.id) ?? 0,
      ...inviteOf(row),
    }))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'current' ? -1 : 1));
  const current = dto.filter((d) => d.status === 'current');
  const accountHolders = current.filter((d) => d.hasAccount);
  return {
    id: String(m.group.id),
    name: m.group.name,
    currency: m.group.currency,
    meId: String(m.me.id),
    members: dto,
    suggestions: suggestPayments(current.map((d) => ({ memberId: d.id, cents: d.balanceCents }))),
    iAmLastAccount: accountHolders.length === 1 && accountHolders[0].isMe,
  };
}

// ---------- Group bills ----------

function billSummary(row: BillRow, participantIds: number[], members: MemberRow[]): GroupBillSummary {
  return {
    id: String(row.id),
    name: row.name,
    date: dateString(row.bill_date),
    splitMode: row.split_mode,
    payerId: String(row.payer_member_id),
    participantIds: participantIds.map(String),
    totalCents: row.total_cents,
    lockedBy: removedAmong(members, [row.payer_member_id, ...participantIds])?.name ?? null,
  };
}

async function loadParticipants(db: Queryable, billIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (billIds.length === 0) return map;
  const { rows } = await db.query<{ bill_id: number; member_id: number }>(
    'SELECT bill_id, member_id FROM group_bill_shares WHERE bill_id = ANY($1::bigint[]) ORDER BY bill_id, position',
    [billIds],
  );
  for (const r of rows) map.set(r.bill_id, [...(map.get(r.bill_id) ?? []), r.member_id]);
  return map;
}

async function loadBill(db: Queryable, groupId: number, billId: number, lock = false): Promise<BillRow> {
  const { rows } = await db.query<BillRow>(
    `SELECT * FROM group_bills WHERE id = $1 AND group_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [billId, groupId],
  );
  if (!rows[0]) throw new HttpError(404, 'That bill could not be found');
  return rows[0];
}

/** Checks a bill against the group's current members and works out its shares. */
function checkBillForGroup(body: unknown, members: MemberRow[]): { bill: GroupBill; result: ReturnType<typeof computeGroupBill> } {
  const input = ((body as { bill?: GroupBillInput })?.bill ?? {}) as GroupBillInput;
  const currentIds = members.filter((m) => m.status === 'current').map((m) => String(m.id));
  const ids = Array.isArray(input.participantIds) ? input.participantIds.map(String) : [];
  if (ids.some((id) => !currentIds.includes(id))) {
    throw fieldError({ participants: 'Only current members of this group can be on a bill' });
  }
  // People are kept in the group's member order, whatever order they were ticked in,
  // so who pays a leftover cent never depends on click history.
  const ordered = currentIds.filter((id) => ids.includes(id));
  const checked = checkGroupBill({ ...input, participantIds: ordered });
  if (!checked.ok) throw fieldError(checked.errors);
  return { bill: checked.value, result: computeGroupBill(checked.value) };
}

async function writeBillParts(client: Client, billId: number, bill: GroupBill, result: ReturnType<typeof computeGroupBill>) {
  await client.query('DELETE FROM group_bill_items WHERE bill_id = $1', [billId]);
  await client.query('DELETE FROM group_bill_shares WHERE bill_id = $1', [billId]);
  await client.query(
    `INSERT INTO group_bill_items (bill_id, position, name, price_cents, sharer_ids)
     SELECT $1, p, n, c, string_to_array(s, ',')::bigint[]
       FROM unnest($2::int[], $3::text[], $4::bigint[], $5::text[]) AS t(p, n, c, s)`,
    [
      billId,
      bill.items.map((_, i) => i),
      bill.items.map((it) => it.name),
      bill.items.map((it) => it.priceCents),
      bill.items.map((it) => it.sharerIds.join(',')),
    ],
  );
  const shares = result.shares;
  await client.query(
    `INSERT INTO group_bill_shares (bill_id, member_id, position, items_cents, tax_cents, other_cents, tip_cents, total_cents, extra_cents)
     SELECT $1, m, p, f, t, o, i, tot, e
       FROM unnest($2::bigint[], $3::int[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[], $8::bigint[], $9::int[])
         AS x(m, p, f, t, o, i, tot, e)`,
    [
      billId,
      shares.map((s) => Number(s.memberId)),
      shares.map((_, i) => i),
      shares.map((s) => s.itemsCents),
      shares.map((s) => s.taxCents),
      shares.map((s) => s.otherCents),
      shares.map((s) => s.tipCents),
      shares.map((s) => s.totalCents),
      shares.map((s) => s.extraCents),
    ],
  );
}

function settleDto(row: SettleRow, members: MemberRow[]): SettleUpDto {
  return {
    id: String(row.id),
    fromId: String(row.from_member_id),
    toId: String(row.to_member_id),
    amountCents: row.amount_cents,
    date: row.created_at.toISOString(),
    lockedBy: removedAmong(members, [row.from_member_id, row.to_member_id])?.name ?? null,
  };
}

function checkSettleUp(body: unknown, members: MemberRow[]): { fromId: number; toId: number; amountCents: number } {
  const b = (body ?? {}) as { fromId?: unknown; toId?: unknown; amount?: unknown };
  const fields: Record<string, string> = {};
  const current = members.filter((m) => m.status === 'current').map((m) => String(m.id));
  const fromId = String(b.fromId ?? '');
  const toId = String(b.toId ?? '');
  if (!current.includes(fromId) || !current.includes(toId)) fields.people = MESSAGES.settlePeople;
  else if (fromId === toId) fields.people = MESSAGES.settleSamePerson;
  const amount = parseHundredths(String(b.amount ?? ''));
  if (amount === null || amount < 1 || amount > MAX_FIELD_CENTS) fields.amount = MESSAGES.settleAmount;
  if (Object.keys(fields).length > 0) throw fieldError(fields);
  return { fromId: Number(fromId), toId: Number(toId), amountCents: amount as number };
}

const paymentText = (members: MemberRow[], fromId: number, toId: number, cents: number) =>
  `${nameOf(members, fromId)} paid ${nameOf(members, toId)} ${formatCents(cents)}`;

// ---------- Router ----------

export function groupsRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (_req, res) => {
    const account = currentAccount(res);
    res.json({ groups: await listMyGroups(pool, account.id) });
  });

  router.post('/', async (req, res) => {
    const account = currentAccount(res);
    const name = checkGroupName(String(req.body?.name ?? ''));
    const currency = checkCurrency(String(req.body?.currency ?? ''));
    const fields: Record<string, string> = {};
    if (!name.ok) fields.name = name.message;
    if (!currency.ok) fields.currency = currency.message;
    if (!name.ok || !currency.ok) throw fieldError(fields);

    const groupId = await transaction(pool, async (client) => {
      const { rows } = await client.query<{ id: number }>('INSERT INTO groups (name, currency) VALUES ($1, $2) RETURNING id', [
        name.value,
        currency.value,
      ]);
      const id = rows[0].id;
      // The creator joins under their username.
      await client.query(
        'INSERT INTO members (group_id, name, name_key, account_id) VALUES ($1, $2, $3, $4)',
        [id, account.username, nameKey(account.username), account.id],
      );
      await logActivity(client, id, account.username, `${account.username} created the group`);
      return id;
    });
    res.status(201).json({ groupId: String(groupId) });
  });

  router.get('/:id', async (req, res) => {
    const m = await readGroup(pool, res, req.params.id);
    res.json({ group: await buildGroupDetail(pool, m) });
  });

  // Rename the group or change its currency. Changing the currency only
  // relabels amounts; nothing is converted.
  router.put('/:id', async (req, res) => {
    const name = checkGroupName(String(req.body?.name ?? ''));
    const currency = checkCurrency(String(req.body?.currency ?? ''));
    const fields: Record<string, string> = {};
    if (!name.ok) fields.name = name.message;
    if (!currency.ok) fields.currency = currency.message;
    if (!name.ok || !currency.ok) throw fieldError(fields);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      await client.query('UPDATE groups SET name = $2, currency = $3 WHERE id = $1', [m.group.id, name.value, currency.value]);
      if (name.value !== m.group.name) {
        await logActivity(client, m.group.id, m.me.name, `${m.me.name} renamed the group from '${m.group.name}' to '${name.value}'`);
      }
      if (currency.value !== m.group.currency) {
        await logActivity(client, m.group.id, m.me.name, `${m.me.name} changed the currency from ${m.group.currency} to ${currency.value}`);
      }
    });
    res.json({ ok: true });
  });

  // ----- Members -----

  // Add someone: a new name, or someone from my other groups ("p:<person>" / "a:<account>").
  router.post('/:id/members', async (req, res) => {
    const account = currentAccount(res);
    const personKey = req.body?.personKey == null ? null : String(req.body.personKey);
    const typed = String(req.body?.name ?? '');
    const added = await withGroup(pool, res, req.params.id, async (client, m) => {
      if ((await countCurrent(client, m.group.id)) >= MAX_GROUP_MEMBERS) throw badRequest(MESSAGES.groupFull, { name: MESSAGES.groupFull });
      let personId: number | null = null;
      let accountId: number | null = null;
      let defaultName = typed;
      if (personKey) {
        const option = (await myPeople(client, account.id, m.group.id)).find((p) => p.key === personKey);
        if (!option) throw fieldError({ person: MESSAGES.notYourPerson });
        defaultName = option.name;
        if (personKey.startsWith('a:')) {
          accountId = Number(personKey.slice(2));
        } else {
          personId = Number(personKey.slice(2));
          // Locked, so an invite being used at this moment finishes first.
          const linked = await client.query<{ account_id: number | null }>('SELECT account_id FROM persons WHERE id = $1 FOR UPDATE', [
            personId,
          ]);
          accountId = linked.rows[0]?.account_id ?? null;
        }
      }
      const name = checkMemberName(typed.trim() ? typed : defaultName);
      if (!name.ok) throw fieldError({ name: name.message });
      if (accountId !== null) {
        const already = await client.query('SELECT 1 FROM members WHERE group_id = $1 AND account_id = $2', [m.group.id, accountId]);
        if (already.rows[0]) throw new HttpError(409, MESSAGES.alreadyMember, { person: MESSAGES.alreadyMember });
      }
      // Must run before the new entry exists: it compares the person's current groups with this one.
      const inviteChanged = personKey !== null && personId !== null && accountId === null && (await renewInviteBeforeAdd(client, personId, m.group.id));
      if (!personKey) {
        const created = await client.query<{ id: number }>('INSERT INTO persons (name, created_by) VALUES ($1, $2) RETURNING id', [
          name.value,
          account.id,
        ]);
        personId = created.rows[0].id;
      }
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO members (group_id, name, name_key, account_id, person_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (group_id, name_key) DO NOTHING RETURNING id`,
        [m.group.id, name.value, nameKey(name.value), accountId, personId],
      );
      if (!rows[0]) throw new HttpError(409, MESSAGES.nameUsed, { name: MESSAGES.nameUsed });
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} added ${name.value}`);
      return { memberId: rows[0].id, inviteChanged };
    });
    res.status(201).json({ memberId: String(added.memberId), inviteChanged: added.inviteChanged });
  });

  // Rename a member. The old name becomes free for someone else.
  router.put('/:id/members/:memberId', async (req, res) => {
    const memberId = parseId(req.params.memberId);
    const name = checkMemberName(String(req.body?.name ?? ''));
    if (!name.ok) throw fieldError({ name: name.message });
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const target = (await loadMembers(client, m.group.id)).find((x) => x.id === memberId);
      if (!target) throw new HttpError(404, 'That member could not be found');
      if (target.name === name.value) return;
      const clash = await client.query('SELECT 1 FROM members WHERE group_id = $1 AND name_key = $2 AND id <> $3', [
        m.group.id,
        nameKey(name.value),
        memberId,
      ]);
      if (clash.rows[0]) throw new HttpError(409, MESSAGES.nameUsed, { name: MESSAGES.nameUsed });
      await client.query('UPDATE members SET name = $2, name_key = $3 WHERE id = $1', [memberId, name.value, nameKey(name.value)]);
      // Someone who hasn't joined keeps their latest name on their invite.
      if (target.account_id === null && target.person_id !== null) {
        await client.query('UPDATE persons SET name = $2 WHERE id = $1 AND account_id IS NULL', [target.person_id, name.value]);
      }
      const actor = target.id === m.me.id ? name.value : m.me.name;
      await logActivity(client, m.group.id, actor, `${actor} renamed ${target.name} to ${name.value}`);
    });
    res.json({ ok: true });
  });

  router.post('/:id/members/:memberId/remove', async (req, res) => {
    const memberId = parseId(req.params.memberId);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const members = await loadMembers(client, m.group.id);
      const target = members.find((x) => x.id === memberId);
      if (!target || target.status !== 'current') throw new HttpError(404, 'That member could not be found');
      if (target.id === m.me.id) throw badRequest('To remove yourself, use Leave group');
      const balance = (await loadBalances(client, m.group.id)).get(target.id) ?? 0;
      if (balance !== 0) throw badRequest(MESSAGES.settleBeforeRemove);
      await client.query("UPDATE members SET status = 'removed' WHERE id = $1", [target.id]);
      // They may have seen invites here; new codes stop them using one to get back in.
      if (target.account_id !== null) await renewInvitesIn(client, m.group.id);
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} removed ${target.name}`);
    });
    res.json({ ok: true });
  });

  router.post('/:id/members/:memberId/restore', async (req, res) => {
    const memberId = parseId(req.params.memberId);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const members = await loadMembers(client, m.group.id);
      const target = members.find((x) => x.id === memberId);
      if (!target || target.status !== 'removed') throw new HttpError(404, 'That member could not be found');
      if (members.filter((x) => x.status === 'current').length >= MAX_GROUP_MEMBERS) {
        throw badRequest(groupFullRestore(target.name));
      }
      await client.query("UPDATE members SET status = 'current' WHERE id = $1", [target.id]);
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} restored ${target.name}`);
    });
    res.json({ ok: true });
  });

  router.post('/:id/leave', async (req, res) => {
    const confirmDelete = req.body?.confirmDelete === true;
    const outcome = await withGroup(pool, res, req.params.id, async (client, m) => {
      const members = await loadMembers(client, m.group.id);
      const holders = members.filter((x) => x.status === 'current' && x.account_id !== null);
      if (holders.length === 1 && holders[0].id === m.me.id) {
        if (!confirmDelete) throw new HttpError(409, MESSAGES.lastAccountWarning, undefined, 'LAST_ACCOUNT');
        // Bills and payments point at members, so they go first.
        await client.query('DELETE FROM group_bills WHERE group_id = $1', [m.group.id]);
        await client.query('DELETE FROM settle_ups WHERE group_id = $1', [m.group.id]);
        await client.query('DELETE FROM groups WHERE id = $1', [m.group.id]);
        return 'deleted' as const;
      }
      const balance = (await loadBalances(client, m.group.id)).get(m.me.id) ?? 0;
      if (balance !== 0) throw badRequest(MESSAGES.settleBeforeLeave);
      await client.query("UPDATE members SET status = 'removed' WHERE id = $1", [m.me.id]);
      await renewInvitesIn(client, m.group.id);
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} left`);
      return 'left' as const;
    });
    res.json({ outcome });
  });

  // ----- Bills -----

  router.get('/:id/bills', async (req, res) => {
    const m = await readGroup(pool, res, req.params.id);
    const members = await loadMembers(pool, m.group.id);
    const { rows } = await pool.query<BillRow>(
      'SELECT * FROM group_bills WHERE group_id = $1 ORDER BY created_at DESC, id DESC',
      [m.group.id],
    );
    const participants = await loadParticipants(pool, rows.map((r) => r.id));
    res.json({ bills: rows.map((r) => billSummary(r, participants.get(r.id) ?? [], members)) });
  });

  router.get('/:id/bills/:billId', async (req, res) => {
    const m = await readGroup(pool, res, req.params.id);
    const row = await loadBill(pool, m.group.id, parseId(req.params.billId));
    const members = await loadMembers(pool, m.group.id);
    const items = await pool.query('SELECT name, price_cents, sharer_ids FROM group_bill_items WHERE bill_id = $1 ORDER BY position', [row.id]);
    const shares = await pool.query<{
      member_id: number; items_cents: number | null; tax_cents: number | null; other_cents: number | null;
      tip_cents: number | null; total_cents: number; extra_cents: number;
    }>('SELECT * FROM group_bill_shares WHERE bill_id = $1 ORDER BY position', [row.id]);
    const participantIds = shares.rows.map((s) => s.member_id);
    const base = rowToInput(row, items.rows);
    const detail: GroupBillDetail = {
      ...billSummary(row, participantIds, members),
      input: {
        ...base,
        splitMode: row.split_mode,
        participantIds: participantIds.map(String),
        payerId: String(row.payer_member_id),
      },
      totals: rowTotals(row),
      shares: shares.rows.map((s) => ({
        memberId: String(s.member_id),
        itemsCents: s.items_cents,
        taxCents: s.tax_cents,
        otherCents: s.other_cents,
        tipCents: s.tip_cents,
        totalCents: s.total_cents,
        extraCents: s.extra_cents,
      })),
    };
    res.json({ bill: detail });
  });

  router.post('/:id/bills', async (req, res) => {
    const billId = await withGroup(pool, res, req.params.id, async (client, m) => {
      const members = await loadMembers(client, m.group.id);
      const { bill, result } = checkBillForGroup(req.body, members);
      const date = today();
      const name = bill.name || defaultBillName(date);
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO group_bills (group_id, name, bill_date, split_mode, payer_member_id,
           tax_mode, tax_value, other_mode, other_value, tip_mode, tip_value, tip_on,
           items_cents, tax_cents, other_cents, tip_cents, total_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [m.group.id, name, date, bill.splitMode, Number(bill.payerId), ...chargeValues(bill), ...totalsValues(result.totals)],
      );
      await writeBillParts(client, rows[0].id, bill, result);
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} added '${name}' (${formatCents(result.totals.totalCents)})`);
      return rows[0].id;
    });
    res.status(201).json({ billId: String(billId) });
  });

  router.put('/:id/bills/:billId', async (req, res) => {
    const billId = parseId(req.params.billId);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const old = await loadBill(client, m.group.id, billId, true);
      const members = await loadMembers(client, m.group.id);
      const oldParticipants = (await loadParticipants(client, [billId])).get(billId) ?? [];
      const locked = removedAmong(members, [old.payer_member_id, ...oldParticipants]);
      if (locked) throw badRequest(restoreToChange(locked.name));
      const { bill, result } = checkBillForGroup(req.body, members);
      const name = bill.name || defaultBillName(dateString(old.bill_date));
      await client.query(
        `UPDATE group_bills SET name = $2, split_mode = $3, payer_member_id = $4,
           tax_mode = $5, tax_value = $6, other_mode = $7, other_value = $8, tip_mode = $9, tip_value = $10, tip_on = $11,
           items_cents = $12, tax_cents = $13, other_cents = $14, tip_cents = $15, total_cents = $16, updated_at = now()
         WHERE id = $1`,
        [billId, name, bill.splitMode, Number(bill.payerId), ...chargeValues(bill), ...totalsValues(result.totals)],
      );
      await writeBillParts(client, billId, bill, result);
      const change =
        old.total_cents !== result.totals.totalCents
          ? `: ${formatCents(old.total_cents)} → ${formatCents(result.totals.totalCents)}`
          : '';
      const renamed = old.name !== name ? ` (renamed from '${old.name}')` : '';
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} edited '${name}'${renamed}${change}`);
    });
    res.json({ ok: true });
  });

  router.delete('/:id/bills/:billId', async (req, res) => {
    const billId = parseId(req.params.billId);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const old = await loadBill(client, m.group.id, billId, true);
      const members = await loadMembers(client, m.group.id);
      const participants = (await loadParticipants(client, [billId])).get(billId) ?? [];
      const locked = removedAmong(members, [old.payer_member_id, ...participants]);
      if (locked) throw badRequest(restoreToChange(locked.name));
      await client.query('DELETE FROM group_bills WHERE id = $1', [billId]);
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} deleted '${old.name}' (${formatCents(old.total_cents)})`);
    });
    res.json({ ok: true });
  });

  // ----- Settle-ups -----

  router.get('/:id/settle-ups', async (req, res) => {
    const m = await readGroup(pool, res, req.params.id);
    const members = await loadMembers(pool, m.group.id);
    const { rows } = await pool.query<SettleRow>(
      'SELECT * FROM settle_ups WHERE group_id = $1 ORDER BY created_at DESC, id DESC',
      [m.group.id],
    );
    res.json({ settleUps: rows.map((r) => settleDto(r, members)) });
  });

  router.post('/:id/settle-ups', async (req, res) => {
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const members = await loadMembers(client, m.group.id);
      const s = checkSettleUp(req.body, members);
      await client.query(
        'INSERT INTO settle_ups (group_id, from_member_id, to_member_id, amount_cents) VALUES ($1, $2, $3, $4)',
        [m.group.id, s.fromId, s.toId, s.amountCents],
      );
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} recorded a payment: ${paymentText(members, s.fromId, s.toId, s.amountCents)}`);
    });
    res.status(201).json({ ok: true });
  });

  router.put('/:id/settle-ups/:settleId', async (req, res) => {
    const settleId = parseId(req.params.settleId);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const old = await loadSettleUp(client, m.group.id, settleId);
      const members = await loadMembers(client, m.group.id);
      const locked = removedAmong(members, [old.from_member_id, old.to_member_id]);
      if (locked) throw badRequest(restoreToChange(locked.name));
      const s = checkSettleUp(req.body, members);
      await client.query(
        'UPDATE settle_ups SET from_member_id = $2, to_member_id = $3, amount_cents = $4, updated_at = now() WHERE id = $1',
        [settleId, s.fromId, s.toId, s.amountCents],
      );
      await logActivity(
        client,
        m.group.id,
        m.me.name,
        `${m.me.name} edited a payment: ${paymentText(members, old.from_member_id, old.to_member_id, old.amount_cents)} → ${paymentText(members, s.fromId, s.toId, s.amountCents)}`,
      );
    });
    res.json({ ok: true });
  });

  router.delete('/:id/settle-ups/:settleId', async (req, res) => {
    const settleId = parseId(req.params.settleId);
    await withGroup(pool, res, req.params.id, async (client, m) => {
      const old = await loadSettleUp(client, m.group.id, settleId);
      const members = await loadMembers(client, m.group.id);
      const locked = removedAmong(members, [old.from_member_id, old.to_member_id]);
      if (locked) throw badRequest(restoreToChange(locked.name));
      await client.query('DELETE FROM settle_ups WHERE id = $1', [settleId]);
      await logActivity(client, m.group.id, m.me.name, `${m.me.name} deleted a payment: ${paymentText(members, old.from_member_id, old.to_member_id, old.amount_cents)}`);
    });
    res.json({ ok: true });
  });

  // ----- Activity -----

  router.get('/:id/activity', async (req, res) => {
    const m = await readGroup(pool, res, req.params.id);
    const { rows } = await pool.query<{ id: number; actor_name: string; message: string; created_at: Date }>(
      'SELECT id, actor_name, message, created_at FROM activity WHERE group_id = $1 ORDER BY id DESC',
      [m.group.id],
    );
    const activity: ActivityDto[] = rows.map((r) => ({
      id: String(r.id),
      actorName: r.actor_name,
      message: r.message,
      at: r.created_at.toISOString(),
    }));
    res.json({ activity });
  });

  return router;
}

async function loadSettleUp(db: Queryable, groupId: number, id: number): Promise<SettleRow> {
  const { rows } = await db.query<SettleRow>('SELECT * FROM settle_ups WHERE id = $1 AND group_id = $2 FOR UPDATE', [id, groupId]);
  if (!rows[0]) throw new HttpError(404, 'That payment could not be found');
  return rows[0];
}

/** My current groups, each with my own balance. */
export async function listMyGroups(db: Queryable, accountId: number): Promise<GroupSummary[]> {
  const { rows } = await db.query<GroupRow & { member_id: number }>(
    `SELECT g.id, g.name, g.currency, m.id AS member_id
       FROM members m JOIN groups g ON g.id = m.group_id
      WHERE m.account_id = $1 AND m.status = 'current'
      ORDER BY g.name, g.id`,
    [accountId],
  );
  const out: GroupSummary[] = [];
  for (const g of rows) {
    const balances = await loadBalances(db, g.id);
    out.push({ id: String(g.id), name: g.name, currency: g.currency, myBalanceCents: balances.get(g.member_id) ?? 0 });
  }
  return out;
}
