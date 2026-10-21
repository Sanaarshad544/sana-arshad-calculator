import { Router } from 'express';
import { MESSAGES } from '../shared/rules.js';
import { currentAccount, requireAuth } from './auth.js';
import { transaction, type Pool } from './db.js';
import { loadMembership } from './groups.js';
import { HttpError } from './http.js';
import { inviteInfo, myPeople, redeemInvite } from './people.js';

/** /api/invites: what an invite is for (public), and using it while logged in. */
export function invitesRouter(pool: Pool): Router {
  const router = Router();

  router.get('/:code', async (req, res) => {
    const viewer = res.locals.account as { id: number } | undefined;
    res.json({ invite: await inviteInfo(pool, req.params.code, viewer?.id) });
  });

  router.post('/:code/accept', requireAuth, async (req, res) => {
    const account = currentAccount(res);
    res.json({ result: await transaction(pool, (client) => redeemInvite(client, req.params.code, account.id)) });
  });

  return router;
}

/** /api/people?groupId=: who I can add to one of my groups from my other groups (groupId is required). */
export function peopleRouter(pool: Pool): Router {
  const router = Router();
  router.use(requireAuth);
  router.get('/', async (req, res) => {
    const accountId = currentAccount(res).id;
    const raw = String(req.query.groupId ?? '');
    if (!/^\d{1,15}$/.test(raw)) throw new HttpError(404, MESSAGES.groupGone, undefined, 'GROUP_GONE');
    const groupId = Number(raw);
    // Only for a group I'm in, so the list can't hint at who is in other groups.
    await loadMembership(pool, groupId, accountId);
    res.json({ people: await myPeople(pool, accountId, groupId) });
  });
  return router;
}
