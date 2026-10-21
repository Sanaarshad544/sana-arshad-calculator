// People and personal invites.
//
// Everyone added to a group by name is a "person", and the same person can be
// in several groups. Each person without an account has their own invite code;
// using it links every group they're in to one account at once.
//
// An invite opens all of that person's groups, so only members who are already
// in every one of those groups can see it. The code changes whenever someone who
// could see it might lose that right: when the person is added to a group some of
// those members aren't in, or when someone with an account leaves (or is removed
// from) one of the person's groups. Old links then stop working.

import { randomInt } from 'node:crypto';
import { MESSAGES, normalizeInviteCode } from '../shared/rules.js';
import type { InviteInfo, InviteResult, PersonOption } from '../shared/api.js';
import { logActivity } from './activity.js';
import type { Client, Pool, Queryable } from './db.js';
import { HttpError } from './http.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** 12 characters from 32: about 10^18 codes, far too many to guess. */
const CODE_LENGTH = 12;

function newInviteCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/**
 * SQL condition: `viewer` is a current member of every group `person` has been
 * added to (removed or not). Its own table aliases start with "all_" so they
 * can't hide a caller's alias.
 */
function inAllGroupsOf(person: string, viewer: string): string {
  return `NOT EXISTS (
    SELECT 1 FROM members all_pm WHERE all_pm.person_id = ${person}
       AND NOT EXISTS (SELECT 1 FROM members all_v
                        WHERE all_v.group_id = all_pm.group_id AND all_v.account_id = ${viewer} AND all_v.status = 'current'))`;
}

const invalidInvite = () => new HttpError(404, MESSAGES.inviteInvalid, { inviteCode: MESSAGES.inviteInvalid }, 'INVITE_INVALID');

/**
 * Invites of the listed people who haven't joined yet, as the viewer may see
 * them: the code when the viewer is in every group the person is in, otherwise
 * null. People who already joined are left out. Codes are made when first needed.
 */
export async function visibleInvites(pool: Pool, viewerId: number, personIds: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (personIds.length === 0) return out;
  const { rows } = await pool.query<{ id: number; invite_code: string | null; can_see: boolean }>(
    `SELECT p.id, p.invite_code, ${inAllGroupsOf('p.id', '$2')} AS can_see
       FROM persons p WHERE p.id = ANY($1::bigint[]) AND p.account_id IS NULL`,
    [personIds, viewerId],
  );
  for (const row of rows) {
    if (!row.can_see) {
      out.set(row.id, null);
      continue;
    }
    out.set(row.id, row.invite_code ?? (await giveCode(pool, row.id, viewerId)));
  }
  return out;
}

/**
 * Gives someone who hasn't joined a code, if the viewer may still see it. Null
 * if they joined meanwhile, or the viewer just lost the right to see it.
 */
async function giveCode(pool: Pool, personId: number, viewerId: number): Promise<string | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const { rows } = await pool.query<{ invite_code: string }>(
        `UPDATE persons SET invite_code = COALESCE(invite_code, $2)
          WHERE id = $1 AND account_id IS NULL AND ${inAllGroupsOf('$1', '$3')}
          RETURNING invite_code`,
        [personId, newInviteCode(), viewerId],
      );
      return rows[0]?.invite_code ?? null;
    } catch (error) {
      // Someone else already has that code (practically never): try another.
      if ((error as { code?: string }).code !== '23505') throw error;
    }
  }
  throw new Error('Could not make a unique invite code');
}

/** Someone with an account is leaving this group: invites they could see get new codes. */
export async function renewInvitesIn(db: Queryable, groupId: number): Promise<void> {
  await db.query(
    `UPDATE persons SET invite_code = NULL
      WHERE account_id IS NULL AND invite_code IS NOT NULL
        AND id IN (SELECT person_id FROM members WHERE group_id = $1 AND person_id IS NOT NULL)`,
    [groupId],
  );
}

/**
 * Call before adding someone who hasn't joined to another group. If anyone who
 * can see their invite isn't a current member of that group, the invite gets a
 * new code, so the old one can't open the new group. True when it changed.
 */
export async function renewInviteBeforeAdd(db: Queryable, personId: number, groupId: number): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE persons SET invite_code = NULL
      WHERE id = $1 AND account_id IS NULL AND invite_code IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM members cand
           WHERE cand.status = 'current' AND cand.account_id IS NOT NULL
             AND cand.group_id = (SELECT group_id FROM members WHERE person_id = $1 ORDER BY id LIMIT 1)
             AND ${inAllGroupsOf('$1', 'cand.account_id')}
             AND NOT EXISTS (SELECT 1 FROM members h WHERE h.group_id = $2 AND h.account_id = cand.account_id AND h.status = 'current'))
      RETURNING id`,
    [personId, groupId],
  );
  return rows.length > 0;
}

/**
 * People I can add to `groupId`: the current members of my current groups (but
 * me), once each, who aren't already in that group. Someone who hasn't joined is
 * offered only when I'm in all of their groups, so I can send them their invite,
 * and goes by the name on their invite. Someone who has joined is keyed by their
 * account, whichever group row we saw, and goes by their latest name in a group.
 */
export async function myPeople(db: Queryable, accountId: number, groupId?: number): Promise<PersonOption[]> {
  const { rows } = await db.query<{ key: string; name: string; has_account: boolean; groups: string[] }>(
    `WITH seen AS (
       SELECT CASE WHEN COALESCE(m.account_id, p.account_id) IS NOT NULL
                   THEN 'a:' || COALESCE(m.account_id, p.account_id) ELSE 'p:' || m.person_id END AS key,
              m.id AS member_id, m.name, p.name AS person_name, g.id AS group_id, g.name AS group_name,
              COALESCE(m.account_id, p.account_id) IS NOT NULL AS has_account
         FROM members m
         JOIN groups g ON g.id = m.group_id
         LEFT JOIN persons p ON p.id = m.person_id
        WHERE m.group_id IN (SELECT group_id FROM members WHERE account_id = $1 AND status = 'current')
          AND m.status = 'current'
          AND (m.account_id IS NOT NULL OR m.person_id IS NOT NULL)
          AND COALESCE(m.account_id, p.account_id, 0) <> $1
          AND (COALESCE(m.account_id, p.account_id) IS NOT NULL OR ${inAllGroupsOf('m.person_id', '$1')})
     ),
     taken AS (
       SELECT CASE WHEN COALESCE(t.account_id, tp.account_id) IS NOT NULL
                   THEN 'a:' || COALESCE(t.account_id, tp.account_id) ELSE 'p:' || t.person_id END AS key
         FROM members t LEFT JOIN persons tp ON tp.id = t.person_id
        WHERE t.group_id = $2
     ),
     people AS (
       SELECT key,
              CASE WHEN bool_or(has_account) THEN (array_agg(name ORDER BY member_id DESC))[1] ELSE min(person_name) END AS name,
              bool_or(has_account) AS has_account
         FROM seen
        WHERE NOT EXISTS (SELECT 1 FROM taken WHERE taken.key = seen.key)
        GROUP BY key
     )
     SELECT people.key, people.name, people.has_account,
            ARRAY(SELECT DISTINCT ON (s.group_id) s.group_name FROM seen s WHERE s.key = people.key ORDER BY s.group_id) AS groups
       FROM people
      ORDER BY lower(people.name), people.key`,
    [accountId, groupId ?? null],
  );
  return rows.map((r) => ({
    key: r.key,
    name: r.name,
    hasAccount: r.has_account,
    groups: [...r.groups].sort((a, b) => a.localeCompare(b)),
  }));
}

/**
 * Uses an invite: links every group the person is in to `accountId`. Groups the
 * account is already in are skipped; removed memberships are linked but stay
 * removed until someone restores them.
 */
export async function redeemInvite(client: Client, rawCode: unknown, accountId: number): Promise<InviteResult> {
  const code = normalizeInviteCode(rawCode);
  const found = (await client.query<{ id: number }>('SELECT id FROM persons WHERE invite_code = $1', [code])).rows[0];
  if (!code || !found) throw invalidInvite();
  // Lock the person's groups first, in id order, the same order every change to a group uses.
  const lockGroups = (ids: number[]) =>
    client.query('SELECT id FROM groups WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids]);
  const first = await client.query<{ group_id: number }>('SELECT DISTINCT group_id FROM members WHERE person_id = $1', [found.id]);
  const locked = new Set(first.rows.map((r) => r.group_id));
  await lockGroups([...locked]);
  const person = (
    await client.query<{ id: number; account_id: number | null; invite_code: string | null }>(
      'SELECT id, account_id, invite_code FROM persons WHERE id = $1 FOR UPDATE',
      [found.id],
    )
  ).rows[0];
  // The code may have changed while we waited.
  if (!person || person.invite_code !== code) throw invalidInvite();
  if (person.account_id !== null) throw new HttpError(409, MESSAGES.inviteUsed, { inviteCode: MESSAGES.inviteUsed }, 'INVITE_USED');

  const { rows } = await client.query<{ id: number; group_id: number; name: string; status: 'current' | 'removed'; group_name: string }>(
    `SELECT m.id, m.group_id, m.name, m.status, g.name AS group_name
       FROM members m JOIN groups g ON g.id = m.group_id
      WHERE m.person_id = $1 ORDER BY lower(g.name), g.id FOR UPDATE OF m`,
    [person.id],
  );
  // Nothing to join once the person isn't a current member of any group.
  if (!rows.some((m) => m.status === 'current')) throw invalidInvite();
  // Added to another group while we waited: lock that one too. (Out of order, but
  // a deadlock here is detected and the whole transaction runs again.)
  const late = [...new Set(rows.map((m) => m.group_id))].filter((id) => !locked.has(id));
  if (late.length > 0) await lockGroups(late);
  const mine = await client.query<{ group_id: number }>('SELECT group_id FROM members WHERE account_id = $1', [accountId]);
  const myGroups = new Set(mine.rows.map((r) => r.group_id));
  // Someone already in all of these groups is almost certainly a friend testing
  // the link, not the invited person: refuse, so the code stays usable.
  if (rows.every((m) => myGroups.has(m.group_id))) {
    throw new HttpError(409, MESSAGES.inviteForSomeoneElse, undefined, 'INVITE_NOT_FOR_YOU');
  }
  const result: InviteResult = { joined: [], removed: [], alreadyIn: [] };
  for (const m of rows) {
    if (myGroups.has(m.group_id)) {
      result.alreadyIn.push(m.group_name);
      continue;
    }
    await client.query('UPDATE members SET account_id = $2 WHERE id = $1', [m.id, accountId]);
    if (m.status === 'current') {
      await logActivity(client, m.group_id, m.name, `${m.name} joined with their invite`);
      result.joined.push(m.group_name);
    } else {
      await logActivity(client, m.group_id, m.name, `${m.name} linked their account (still removed)`);
      result.removed.push(m.group_name);
    }
  }
  await client.query('UPDATE persons SET account_id = $2 WHERE id = $1', [person.id, accountId]);
  return result;
}

/**
 * Public: what an invite is for. Logged-out people need this before signing up.
 * A used invite says only that it was used.
 */
export async function inviteInfo(db: Queryable, rawCode: unknown, viewerId?: number): Promise<InviteInfo> {
  const code = normalizeInviteCode(rawCode);
  const person = (
    await db.query<{ id: number; name: string; account_id: number | null }>('SELECT id, name, account_id FROM persons WHERE invite_code = $1', [
      code,
    ])
  ).rows[0];
  if (!code || !person) throw invalidInvite();
  if (person.account_id !== null) return { used: true, name: '', groups: [], viewerAlreadyIn: false, viewerGroups: [] };
  const { rows } = await db.query<{ group_name: string; status: 'current' | 'removed'; viewer_in: boolean }>(
    `SELECT g.name AS group_name, m.status,
            EXISTS (SELECT 1 FROM members v WHERE v.group_id = m.group_id AND v.account_id = $2) AS viewer_in
       FROM members m JOIN groups g ON g.id = m.group_id
      WHERE m.person_id = $1 ORDER BY lower(g.name), g.id`,
    [person.id, viewerId ?? null],
  );
  const current = rows.filter((r) => r.status === 'current');
  if (current.length === 0) throw invalidInvite();
  return {
    used: false,
    name: person.name,
    groups: current.map((r) => r.group_name),
    // The same test the server uses when the invite is used.
    viewerAlreadyIn: viewerId !== undefined && rows.every((r) => r.viewer_in),
    viewerGroups: current.filter((r) => r.viewer_in).map((r) => r.group_name),
  };
}
