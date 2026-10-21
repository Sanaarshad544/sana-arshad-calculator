// Personal invites, adding people from my other groups, renaming (QA round 1).
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../shared/rules.js';
import { PASSWORD, addMembers, anon, createGroup, groupBill, inviteCodeOf, newUser, testApp, uniqueName, type Agent } from './helpers.js';

async function activity(agent: Agent, groupId: string): Promise<string[]> {
  return (await agent.get(`/api/groups/${groupId}/activity`)).body.activity.map((a: { message: string }) => a.message);
}

async function members(agent: Agent, groupId: string) {
  return (await agent.get(`/api/groups/${groupId}`)).body.group.members as {
    id: string;
    name: string;
    status: string;
    hasAccount: boolean;
    inviteCode: string | null;
    inviteNote: 'elsewhere' | 'joined' | null;
    alsoHereAs: string | null;
  }[];
}

async function member(agent: Agent, groupId: string, name: string) {
  const found = (await members(agent, groupId)).find((m) => m.name === name);
  if (!found) throw new Error(`${name} is not in the group`);
  return found;
}

/** Signs up a new account with someone's invite (the code they were sent). */
async function joinAs(code: string, prefix = 'j') {
  const agent = anon();
  const username = uniqueName(prefix);
  const res = await agent.post('/api/auth/signup').send({ username, password: PASSWORD, inviteCode: code });
  return { agent, username, res };
}

async function people(agent: Agent, groupId: string) {
  const res = await agent.get(`/api/people?groupId=${groupId}`);
  return res.body.people as { key: string; name: string; hasAccount: boolean; groups: string[] }[];
}

/** Ghania added by name to "Dinner", then picked from "my people" into "Trip". */
async function ghaniaInTwoGroups() {
  const owner = await newUser('own');
  const dinner = await createGroup(owner.agent, 'Dinner');
  const trip = await createGroup(owner.agent, 'Trip');
  await addMembers(owner.agent, dinner.groupId, ['Ghania']);
  const option = (await people(owner.agent, trip.groupId)).find((p) => p.name === 'Ghania');
  expect(option).toMatchObject({ hasAccount: false, groups: ['Dinner'] });
  const added = await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: option?.key });
  expect(added.status).toBe(201);
  return { owner, dinner, trip };
}

describe('US-11 every person added by name has their own invite', () => {
  it('each not-yet-joined person has a code; people with accounts do not', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    await addMembers(agent, groupId, ['Ghania', 'Rutaba']);
    const list = await members(agent, groupId);
    const codes = list.filter((m) => !m.hasAccount).map((m) => m.inviteCode);
    expect(codes).toHaveLength(2);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(new Set(codes).size).toBe(2);
    expect(list.find((m) => m.hasAccount)?.inviteCode).toBeNull();
    // The code doesn't change between page loads.
    expect((await members(agent, groupId)).map((m) => m.inviteCode)).toEqual(list.map((m) => m.inviteCode));
  });

  it('the same person in two of my groups has one code', async () => {
    const { owner, dinner, trip } = await ghaniaInTwoGroups();
    expect(await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania')).toBe(await inviteCodeOf(owner.agent, trip.groupId, 'Ghania'));
  });

  it('any member of the group can see the code of someone who is only in that group', async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania', 'Sara']);
    const sara = await newUser('sara');
    await sara.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Sara')}/accept`).send({});
    expect(await inviteCodeOf(sara.agent, dinner.groupId, 'Ghania')).toBe(await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania'));
  });

  it("a member who isn't in all of the person's groups sees no code, so it can't open the others", async () => {
    const { owner, dinner, trip } = await ghaniaInTwoGroups();
    await addMembers(owner.agent, dinner.groupId, ['Sara']);
    const sara = await newUser('sara');
    await sara.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Sara')}/accept`).send({});
    // Sara is in Dinner but not Trip: Ghania's code would let her into Trip, so she doesn't get it.
    expect(await member(sara.agent, dinner.groupId, 'Ghania')).toMatchObject({ inviteCode: null, inviteNote: 'elsewhere' });
    expect(await member(owner.agent, trip.groupId, 'Ghania')).toMatchObject({ inviteNote: null });
    expect((await member(owner.agent, trip.groupId, 'Ghania')).inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    // Nor can she add Ghania elsewhere, since she couldn't send her the invite.
    const saras = await createGroup(sara.agent, 'Saras');
    expect((await people(sara.agent, saras.groupId)).map((p) => p.name)).toEqual([owner.username]);
  });

  it("adding the person to a group that someone who could see the code isn't in gives them a new code", async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania', 'Sara']);
    const sara = await newUser('sara');
    await sara.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Sara')}/accept`).send({});
    const old = await inviteCodeOf(sara.agent, dinner.groupId, 'Ghania');

    const trip = await createGroup(owner.agent, 'Trip');
    const key = (await people(owner.agent, trip.groupId)).find((p) => p.name === 'Ghania')?.key;
    const added = await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: key });
    expect(added.status).toBe(201);
    expect(added.body.inviteChanged).toBe(true);
    // Sara's copy of the old code no longer opens anything.
    expect((await anon().get(`/api/invites/${old}`)).status).toBe(404);
    expect((await joinAs(old)).res.status).toBe(404);
    const fresh = await inviteCodeOf(owner.agent, trip.groupId, 'Ghania');
    expect(fresh).not.toBe(old);
    expect(await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania')).toBe(fresh);
  });

  it('when everyone who could see the code is in the new group too, the code stays the same', async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania']);
    const sent = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const trip = await createGroup(owner.agent, 'Trip');
    const key = (await people(owner.agent, trip.groupId)).find((p) => p.name === 'Ghania')?.key;
    const added = await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: key });
    expect(added.body.inviteChanged).toBe(false);
    // The link already sent now opens both groups.
    expect((await anon().get(`/api/invites/${sent}`)).body.invite.groups).toEqual(['Dinner', 'Trip']);
  });

  it("after a change, adding the person to a group that everyone who can see the code is in keeps the code", async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania', 'Sara']);
    const sara = await newUser('sara');
    await sara.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Sara')}/accept`).send({});
    // Sara isn't in Trip, so adding Ghania there changes the code; now only the owner can see it.
    const trip = await createGroup(owner.agent, 'Trip');
    const key = (await people(owner.agent, trip.groupId)).find((p) => p.name === 'Ghania')?.key;
    expect((await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: key })).body.inviteChanged).toBe(true);
    const sent = await inviteCodeOf(owner.agent, trip.groupId, 'Ghania');
    expect(await member(sara.agent, dinner.groupId, 'Ghania')).toMatchObject({ inviteCode: null, inviteNote: 'elsewhere' });
    // The owner, the only one who can see it, is in Club: the link already sent keeps working.
    const club = await createGroup(owner.agent, 'Club');
    const clubKey = (await people(owner.agent, club.groupId)).find((p) => p.name === 'Ghania')?.key;
    expect((await owner.agent.post(`/api/groups/${club.groupId}/members`).send({ personKey: clubKey })).body.inviteChanged).toBe(false);
    expect(await inviteCodeOf(owner.agent, club.groupId, 'Ghania')).toBe(sent);
    expect((await anon().get(`/api/invites/${sent}`)).body.invite.groups).toEqual(['Club', 'Dinner', 'Trip']);
  });

  it('when someone with an account leaves or is removed, invites in that group get new codes', async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania', 'Sara', 'Rutaba', 'Omar']);
    const sara = await newUser('sara');
    await sara.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Sara')}/accept`).send({});
    const first = await inviteCodeOf(sara.agent, dinner.groupId, 'Ghania');

    // Removing someone without an account changes nothing.
    await owner.agent.post(`/api/groups/${dinner.groupId}/members/${(await member(owner.agent, dinner.groupId, 'Rutaba')).id}/remove`).send({});
    expect(await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania')).toBe(first);

    // Removing Sara does: her copy can't bring her back under Ghania's name.
    await owner.agent.post(`/api/groups/${dinner.groupId}/members/${(await member(owner.agent, dinner.groupId, 'Sara')).id}/remove`).send({});
    expect((await joinAs(first)).res.status).toBe(404);
    const second = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    expect(second).not.toBe(first);

    // Leaving does too.
    const omar = await newUser('omar');
    await omar.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Omar')}/accept`).send({});
    expect(await inviteCodeOf(omar.agent, dinner.groupId, 'Ghania')).toBe(second);
    expect((await omar.agent.post(`/api/groups/${dinner.groupId}/leave`).send({})).body.outcome).toBe('left');
    expect((await anon().get(`/api/invites/${second}`)).status).toBe(404);
    expect(await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania')).not.toBe(second);
  });
});

describe('US-12 joining with a personal invite links every group at once', () => {
  it('the invite page shows whose invite it is and their groups, to anyone with the code', async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const info = await anon().get(`/api/invites/${code.toLowerCase()}`);
    expect(info.body.invite).toEqual({ name: 'Ghania', groups: ['Dinner', 'Trip'], used: false, viewerAlreadyIn: false, viewerGroups: [] });
  });

  it('shows which of the groups a logged-in viewer is already in', async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    await addMembers(owner.agent, dinner.groupId, ['Sara']);
    const sara = await newUser('sara');
    await sara.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Sara')}/accept`).send({});
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const info = (await sara.agent.get(`/api/invites/${code}`)).body.invite;
    expect(info).toMatchObject({ viewerAlreadyIn: false, viewerGroups: ['Dinner'] });
  });

  it('a used invite tells nothing about the person or their groups', async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    await (await newUser()).agent.post(`/api/invites/${code}/accept`).send({});
    expect((await anon().get(`/api/invites/${code}`)).body.invite).toEqual({
      used: true,
      name: '',
      groups: [],
      viewerAlreadyIn: false,
      viewerGroups: [],
    });
  });

  it('an invite for someone removed from all their groups is not valid', async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania']);
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const ghaniaId = (await member(owner.agent, dinner.groupId, 'Ghania')).id;
    await owner.agent.post(`/api/groups/${dinner.groupId}/members/${ghaniaId}/remove`).send({});
    expect((await anon().get(`/api/invites/${code}`)).body.error.message).toBe(MESSAGES.inviteInvalid);
    expect((await joinAs(code)).res.status).toBe(404);
    // Restored, the same invite works again.
    await owner.agent.post(`/api/groups/${dinner.groupId}/members/${ghaniaId}/restore`).send({});
    expect((await joinAs(code)).res.status).toBe(201);
  });

  it('signing up with the code links both groups; no names to pick', async () => {
    const { owner, dinner, trip } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const ghania = anon();
    const signup = await ghania.post('/api/auth/signup').send({ username: uniqueName('ghania'), password: PASSWORD, inviteCode: code });
    expect(signup.status).toBe(201);
    expect(signup.body.invite).toEqual({ joined: ['Dinner', 'Trip'], removed: [], alreadyIn: [] });
    const mine = (await ghania.get('/api/groups')).body.groups.map((g: { name: string }) => g.name);
    expect(mine).toEqual(['Dinner', 'Trip']);
    for (const g of [dinner, trip]) {
      expect(await activity(owner.agent, g.groupId)).toContain('Ghania joined with their invite');
      const row = (await members(owner.agent, g.groupId)).find((m) => m.name === 'Ghania');
      expect(row).toMatchObject({ hasAccount: true, inviteCode: null });
    }
  });

  it('logging in with the code links the groups to an existing account', async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const existing = await newUser('gh');
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const login = await anon().post('/api/auth/login').send({ username: existing.username, password: PASSWORD, inviteCode: code });
    expect(login.status).toBe(200);
    expect(login.body.invite.joined).toEqual(['Dinner', 'Trip']);
    expect(login.body.inviteError).toBeNull();
  });

  it('logging in from the link while already in some of the groups joins nothing until confirmed', async () => {
    const owner = await newUser('own');
    const flat = await createGroup(owner.agent, 'Flat');
    await addMembers(owner.agent, flat.groupId, ['Omar', 'Pat']);
    const trip = await createGroup(owner.agent, 'Trip');
    const key = (await people(owner.agent, trip.groupId)).find((p) => p.name === 'Omar')?.key;
    await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: key });
    const pat = await newUser('pat');
    await pat.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, flat.groupId, 'Pat')}/accept`).send({});
    const code = await inviteCodeOf(owner.agent, flat.groupId, 'Omar');
    const browser = anon();
    const login = await browser.post('/api/auth/login').send({ username: pat.username, password: PASSWORD, inviteCode: code });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ invite: null, inviteError: null, inviteConfirm: true });
    expect((await browser.get(`/api/invites/${code}`)).body.invite).toMatchObject({ used: false, viewerGroups: ['Flat'] });
    expect((await browser.get(`/api/groups/${trip.groupId}`)).status).toBe(403);
    // Confirming on the page joins the rest.
    expect((await browser.post(`/api/invites/${code}/accept`).send({})).body.result).toEqual({ joined: ['Trip'], removed: [], alreadyIn: ['Flat'] });
  });

  it("logging in with an invite that can't be used still logs in, and says why the invite didn't work", async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    // The owner is in all of Ghania's groups, so it's not their invite.
    const browser = anon();
    const login = await browser.post('/api/auth/login').send({ username: owner.username, password: PASSWORD, inviteCode: code });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ invite: null, inviteError: MESSAGES.inviteForSomeoneElse });
    expect((await browser.get('/api/me')).status).toBe(200);
    // A used invite: the same.
    await (await newUser()).agent.post(`/api/invites/${code}/accept`).send({});
    const again = await anon().post('/api/auth/login').send({ username: owner.username, password: PASSWORD, inviteCode: code });
    expect(again.body).toMatchObject({ invite: null, inviteError: MESSAGES.inviteUsed });
  });

  it('a code works once', async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const first = await newUser();
    expect((await first.agent.post(`/api/invites/${code}/accept`).send({})).status).toBe(200);
    const second = await newUser();
    const again = await second.agent.post(`/api/invites/${code}/accept`).send({});
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe(MESSAGES.inviteUsed);
    expect((await anon().get(`/api/invites/${code}`)).body.invite.used).toBe(true);
    // Signing up with a used code creates nothing.
    const name = uniqueName('late');
    const late = await anon().post('/api/auth/signup').send({ username: name, password: PASSWORD, inviteCode: code });
    expect(late.status).toBe(409);
    expect((await anon().post('/api/auth/login').send({ username: name, password: PASSWORD })).status).toBe(401);
  });

  it('a wrong code is refused clearly', async () => {
    const user = await newUser();
    for (const code of ['NOPE2345', '', 'x']) {
      const res = await user.agent.post(`/api/invites/${code || 'none'}/accept`).send({});
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe(MESSAGES.inviteInvalid);
    }
    expect((await anon().get('/api/invites/NOPE2345')).body.error.message).toBe(MESSAGES.inviteInvalid);
  });

  it("a member testing a friend's link can't use it up", async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    expect((await owner.agent.get(`/api/invites/${code}`)).body.invite.viewerAlreadyIn).toBe(true);
    const res = await owner.agent.post(`/api/invites/${code}/accept`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(MESSAGES.inviteForSomeoneElse);
    // Still usable by Ghania.
    expect((await (await newUser()).agent.post(`/api/invites/${code}/accept`).send({})).status).toBe(200);
  });

  it('a group the account is already in is skipped; a removed membership stays removed', async () => {
    const { owner, dinner, trip } = await ghaniaInTwoGroups();
    const code = await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania');
    const ghaniaId = (await members(owner.agent, trip.groupId)).find((m) => m.name === 'Ghania')?.id;
    await owner.agent.post(`/api/groups/${trip.groupId}/members/${ghaniaId}/remove`).send({});
    const ghania = await newUser('g');
    const result = (await ghania.agent.post(`/api/invites/${code}/accept`).send({})).body.result;
    expect(result).toEqual({ joined: ['Dinner'], removed: ['Trip'], alreadyIn: [] });
    expect(await activity(owner.agent, trip.groupId)).toContain('Ghania linked their account (still removed)');
    expect((await ghania.agent.get(`/api/groups/${trip.groupId}`)).status).toBe(403);
    await owner.agent.post(`/api/groups/${trip.groupId}/members/${ghaniaId}/restore`).send({});
    expect((await ghania.agent.get(`/api/groups/${trip.groupId}`)).status).toBe(200);
  });

  it("an entry skipped because the account was already in that group shows who it is, and isn't offered twice", async () => {
    const owner = await newUser('own');
    const flat = await createGroup(owner.agent, 'Flat');
    await addMembers(owner.agent, flat.groupId, ['Omar', 'Pat']);
    const trip = await createGroup(owner.agent, 'Trip');
    const omarKey = (await people(owner.agent, trip.groupId)).find((p) => p.name === 'Omar')?.key;
    await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: omarKey });
    // One account is Pat in Flat, then uses Omar's invite: Flat is skipped, Trip is linked.
    const pat = await newUser('pat');
    await pat.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, flat.groupId, 'Pat')}/accept`).send({});
    const result = (await pat.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, flat.groupId, 'Omar')}/accept`).send({})).body.result;
    expect(result).toEqual({ joined: ['Trip'], removed: [], alreadyIn: ['Flat'] });
    expect(await member(owner.agent, flat.groupId, 'Omar')).toMatchObject({ hasAccount: false, inviteCode: null, inviteNote: 'joined', alsoHereAs: 'Pat' });
    // Offered once, as the account, and adding them somewhere new works.
    const club = await createGroup(owner.agent, 'Club');
    const offered = (await people(owner.agent, club.groupId)).filter((p) => p.groups.includes('Flat') && p.hasAccount);
    expect(offered.map((p) => p.groups)).toEqual([['Flat', 'Trip']]);
    expect((await owner.agent.post(`/api/groups/${club.groupId}/members`).send({ personKey: offered[0].key, name: 'Pat' })).status).toBe(201);
    expect((await pat.agent.get(`/api/groups/${club.groupId}`)).status).toBe(200);
  });

  it('the old group-wide code and name-claiming are gone', async () => {
    const user = await newUser();
    expect((await user.agent.post('/api/join').send({ code: 'ABCDEFGH' })).status).toBe(404);
    expect((await user.agent.post('/api/join/claim').send({ code: 'ABCDEFGH', memberId: '1' })).status).toBe(404);
  });
});

describe('adding someone from my other groups', () => {
  it('lists only people from my current groups, once each, not already in the target group', async () => {
    const { owner, dinner, trip } = await ghaniaInTwoGroups();
    await addMembers(owner.agent, dinner.groupId, ['Sara']);
    expect((await people(owner.agent, trip.groupId)).map((p) => p.name)).toEqual(['Sara']);
    const fresh = await createGroup(owner.agent, 'Fresh');
    expect((await people(owner.agent, fresh.groupId)).map((p) => [p.name, p.groups])).toEqual([
      ['Ghania', ['Dinner', 'Trip']],
      ['Sara', ['Dinner']],
    ]);
    // A stranger sees none of them and can't add them.
    const stranger = await newUser();
    const theirs = await createGroup(stranger.agent);
    expect(await people(stranger.agent, theirs.groupId)).toEqual([]);
    const key = (await people(owner.agent, fresh.groupId)).find((p) => p.name === 'Sara')?.key;
    const res = await stranger.agent.post(`/api/groups/${theirs.groupId}/members`).send({ personKey: key });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.person).toBe(MESSAGES.notYourPerson);
  });

  it("can't be asked about a group I'm not in", async () => {
    const { owner, dinner } = await ghaniaInTwoGroups();
    const stranger = await newUser();
    expect((await stranger.agent.get(`/api/people?groupId=${dinner.groupId}`)).status).toBe(403);
    expect((await owner.agent.get('/api/people?groupId=abc')).status).toBe(404);
    // Nor without saying which group.
    expect((await owner.agent.get('/api/people')).status).toBe(404);
  });

  it("doesn't offer people who were removed from my groups", async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    const ids = await addMembers(owner.agent, dinner.groupId, ['Ghania', 'Sara']);
    await owner.agent.post(`/api/groups/${dinner.groupId}/members/${ids.Sara}/remove`).send({});
    const trip = await createGroup(owner.agent, 'Trip');
    expect((await people(owner.agent, trip.groupId)).map((p) => p.name)).toEqual(['Ghania']);
  });

  it('adding someone who has an account gives them access at once', async () => {
    const owner = await newUser('own');
    const dinner = await createGroup(owner.agent, 'Dinner');
    await addMembers(owner.agent, dinner.groupId, ['Ghania']);
    const ghania = await newUser('gh');
    await ghania.agent.post(`/api/invites/${await inviteCodeOf(owner.agent, dinner.groupId, 'Ghania')}/accept`).send({});
    const trip = await createGroup(owner.agent, 'Trip');
    const option = (await people(owner.agent, trip.groupId)).find((p) => p.hasAccount);
    // Their name in the group, never their username.
    expect(option?.name).toBe('Ghania');
    expect(JSON.stringify(await people(owner.agent, trip.groupId))).not.toContain(ghania.username);
    await owner.agent.post(`/api/groups/${trip.groupId}/members`).send({ personKey: option?.key, name: 'Ghania' });
    expect((await ghania.agent.get(`/api/groups/${trip.groupId}`)).status).toBe(200);
  });

  it('a typed name can be used instead of the usual one; clashes are refused', async () => {
    const { owner, trip } = await ghaniaInTwoGroups();
    await addMembers(owner.agent, trip.groupId, ['Sara']);
    const other = await createGroup(owner.agent, 'Other');
    const dinnerSara = (await people(owner.agent, other.groupId)).find((p) => p.name === 'Sara');
    await addMembers(owner.agent, other.groupId, ['Sara']);
    // "Sara" from Trip can't be added to Other under the same name as Other's own Sara.
    const clash = await owner.agent.post(`/api/groups/${other.groupId}/members`).send({ personKey: dinnerSara?.key });
    expect(clash.status).toBe(409);
    const named = await owner.agent.post(`/api/groups/${other.groupId}/members`).send({ personKey: dinnerSara?.key, name: 'Sara K' });
    expect(named.status).toBe(201);
  });
});

describe('renaming members', () => {
  it('any member renames anyone; the old name becomes free; it is logged', async () => {
    const { agent, username } = await newUser();
    const { groupId, meId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['ghania', 'Sara']);
    await agent.post(`/api/groups/${groupId}/bills`).send({ bill: groupBill([meId, ids.ghania], ids.ghania, ['10.00']) });
    const res = await agent.put(`/api/groups/${groupId}/members/${ids.ghania}`).send({ name: 'Ghania' });
    expect(res.status).toBe(200);
    expect((await members(agent, groupId)).find((m) => m.id === ids.ghania)?.name).toBe('Ghania');
    expect(await activity(agent, groupId)).toContain(`${username} renamed ghania to Ghania`);
    // Their invite and other groups' lists use the new name.
    const code = await inviteCodeOf(agent, groupId, 'Ghania');
    expect((await anon().get(`/api/invites/${code}`)).body.invite.name).toBe('Ghania');
    const other = await createGroup(agent, 'Other');
    expect((await people(agent, other.groupId)).map((p) => p.name)).toContain('Ghania');
    // Clashing with someone else is refused, in any letter case.
    const clash = await agent.put(`/api/groups/${groupId}/members/${ids.ghania}`).send({ name: 'SARA' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toBe(MESSAGES.nameUsed);
    // The old spelling is free again.
    await agent.put(`/api/groups/${groupId}/members/${ids.ghania}`).send({ name: 'Ghania B' });
    expect((await agent.post(`/api/groups/${groupId}/members`).send({ name: 'ghania' })).status).toBe(201);
    // Bad names are refused.
    for (const name of ['', 'x'.repeat(31)]) {
      expect((await agent.put(`/api/groups/${groupId}/members/${ids.Sara}`).send({ name })).body.error.fields.name).toBe(MESSAGES.memberName);
    }
  });

  it('only current members can rename', async () => {
    const { agent } = await newUser();
    const { groupId } = await createGroup(agent);
    const ids = await addMembers(agent, groupId, ['Ghania']);
    const stranger = await newUser();
    expect((await stranger.agent.put(`/api/groups/${groupId}/members/${ids.Ghania}`).send({ name: 'X' })).status).toBe(403);
  });
});

describe('PKR (migration 005)', () => {
  it('is a listed symbol written in capitals, however it is typed', async () => {
    const { agent } = await newUser();
    expect((await agent.post('/api/groups').send({ name: 'Lahore', currency: 'PKR' })).status).toBe(201);
    const typed = await agent.post('/api/groups').send({ name: 'Karachi', currency: 'pkr' });
    expect((await agent.get(`/api/groups/${typed.body.groupId}`)).body.group.currency).toBe('PKR');
    const { rows } = await testApp().pool.query("SELECT count(*)::int AS n FROM groups WHERE currency = 'PKR'");
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
