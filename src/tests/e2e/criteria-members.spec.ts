import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD, api, expectNoA11yViolations, makeGroup, signUpFast, uniqueName } from './helpers.js';

// ---------- Local helpers ----------

interface MemberDto {
  id: string;
  name: string;
  status: 'current' | 'removed';
  balanceCents: number;
  /** The person's own invite code while they have no account; null once they have one. */
  inviteCode: string | null;
}

/** A group bill paid by `payerId`, split equally between `participantIds`. */
function groupBillBody(participantIds: string[], payerId: string, price: string, name: string) {
  return {
    bill: {
      name,
      items: [{ name: '', price }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds,
      payerId,
    },
  };
}

function soloBillBody(name: string, price: string) {
  return {
    currency: '$',
    bill: {
      name,
      items: [{ name: '', price }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
    },
  };
}

async function members(page: Page, groupId: string): Promise<MemberDto[]> {
  const { group } = await api<{ group: { members: MemberDto[] } }>(page, 'get', `/groups/${groupId}`);
  return group.members;
}

/** A not-yet-joined person's own invite code, as any member of the group sees it. */
async function inviteCodeOf(page: Page, groupId: string, memberName: string): Promise<string> {
  const code = (await members(page, groupId)).find((m) => m.name === memberName)?.inviteCode;
  if (!code) throw new Error(`${memberName} has no invite code`);
  return code;
}

const inviteHeading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name: `${name}, join your friends' groups` });

interface Pair {
  owner: Page;
  omar: Page;
  groupId: string;
  meId: string;
  ids: Record<string, string>;
  ownerName: string;
  contexts: BrowserContext[];
}

/**
 * Two accounts in one group (the two-context pattern from groups.spec.ts):
 * the owner, and a second account that joined as "Omar" with Omar's own invite code.
 */
async function twoAccountGroup(browser: Browser, info: TestInfo, groupName: string, otherNames: string[] = []): Promise<Pair> {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const omarCtx = await browser.newContext();
  const contexts = [ownerCtx, omarCtx];
  try {
    const ownerName = await signUpFast(owner, info, 'own');
    const g = await makeGroup(owner, groupName, '$', ['Omar', ...otherNames]);
    const code = await inviteCodeOf(owner, g.groupId, 'Omar');

    const omar = await omarCtx.newPage();
    await signUpFast(omar, info, 'omar');
    await api(omar, 'post', `/invites/${code}/accept`);
    return { owner, omar, groupId: g.groupId, meId: g.meId, ids: g.ids, ownerName, contexts };
  } catch (error) {
    await closeAll(contexts);
    throw error;
  }
}

async function closeAll(contexts: BrowserContext[]): Promise<void> {
  for (const c of contexts) await c.close();
}

async function openMembersTab(page: Page, groupId: string, groupName: string): Promise<void> {
  // "Or add someone from your other groups" appears above the buttons once its list loads,
  // moving them down: wait for it, so a click never lands while they move.
  const people = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/people');
  await page.goto(`/groups/${groupId}?tab=members`);
  await expect(page.getByRole('heading', { level: 1, name: groupName })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /^Members \(/ })).toBeVisible();
  await people;
}

/** The computed background colour of the --danger variable, in the same format as getComputedStyle. */
async function dangerColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--danger)';
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
}

const backgroundOf = (button: Locator) => button.evaluate((el) => getComputedStyle(el).backgroundColor);

/** The danger button is red (--danger) and the safe button is focused first. */
async function expectSafeDialog(page: Page, dialog: Locator, safeName: string, dangerName: string): Promise<void> {
  await expect(dialog).toBeVisible();
  const safe = dialog.getByRole('button', { name: safeName, exact: true });
  const danger = dialog.getByRole('button', { name: dangerName, exact: true });
  await expect(safe).toBeFocused();
  await expect(danger).toHaveClass(/btn-danger/);
  await page.mouse.move(0, 0); // no hover colour
  const expected = await dangerColour(page);
  expect(expected).not.toBe('rgba(0, 0, 0, 0)');
  await expect.poll(() => backgroundOf(danger)).toBe(expected);
  expect(await backgroundOf(safe)).not.toBe(expected);
}

// ---------- US-20 ----------

test('US-20 #4 an old bill shows "Omar (removed)" as payer and participant, with the same totals and balances', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Pizza club', '$', ['Omar', 'Ali']);
  await api(page, 'post', `/groups/${groupId}/bills`, groupBillBody([meId, ids.Omar], ids.Omar, '20', 'Pizza night'));
  await api(page, 'post', `/groups/${groupId}/bills`, groupBillBody([meId, ids.Ali], meId, '12', 'Coffee'));
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: meId, toId: ids.Omar, amount: '10' });
  const { bills } = await api<{ bills: { id: string; name: string }[] }>(page, 'get', `/groups/${groupId}/bills`);
  const pizzaId = bills.find((b) => b.name === 'Pizza night')!.id;

  // Before: the bill's total, and the other members' balances on the group page.
  await page.goto(`/groups/${groupId}/bills/${pizzaId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Pizza night' })).toBeVisible();
  const totalBefore = await page.getByTestId('grand-total').textContent();
  expect(totalBefore).toBe('$20.00');
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Pizza club' })).toBeVisible();
  const myRow = page.getByTestId('balance-row').filter({ hasText: '(you)' });
  const aliRow = page.getByTestId('balance-row').filter({ hasText: 'Ali' });
  await expect(aliRow).toContainText('−$6.00 owes');
  const mineBefore = await myRow.textContent();
  const aliBefore = await aliRow.textContent();

  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);

  await page.goto(`/groups/${groupId}/bills/${pizzaId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Pizza night' })).toBeVisible();
  await expect(page.getByText('so this bill is view only')).toBeVisible();
  // A saved bill is a read-only receipt: nothing to tick or choose, so the names are read off the receipt.
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Who paid', { exact: true })).toHaveCount(0);
  // Payer: the summary sentence and the receipt's "paid" line both name him.
  await expect(page.getByText(/^Omar \(removed\) paid on \d{1,2} [A-Z][a-z]{2} \d{4}\. Split equally between 2 people\.$/)).toBeVisible();
  const receipt = page.getByRole('region', { name: 'Bill', exact: true });
  await expect(receipt.getByText('Omar (removed) paid $20.00.')).toBeVisible();
  // Participant: one of the two shares on the receipt, with his $10.00.
  await expect(receipt.getByTestId('share')).toHaveCount(2);
  await expect(receipt.getByTestId('share').filter({ hasText: 'Omar (removed)' })).toContainText('$10.00');
  await expect(receipt.getByTestId('share').filter({ hasText: 'Omar (removed)' })).toHaveCount(1);
  // The totals are exactly as before.
  await expect(page.getByTestId('grand-total')).toHaveText(totalBefore!);

  // Everyone else's balance on the group page is exactly as before.
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Pizza club' })).toBeVisible();
  await expect(myRow).toHaveText(mineBefore!);
  await expect(aliRow).toHaveText(aliBefore!);
});

test('US-20 #5 a removed member is not offered on a new bill or a settle-up, nor in the balances', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Without Omar', '$', ['Omar', 'Ali']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);

  // New bill: neither "Who took part" nor "Who paid" offers Omar.
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Without Omar' })).toBeVisible();
  const took = page.getByRole('group', { name: 'Who took part' });
  await expect(took.getByRole('checkbox')).toHaveCount(2);
  await expect(took.getByRole('checkbox', { name: /Omar/ })).toHaveCount(0);
  await expect(took.getByRole('checkbox', { name: 'Ali' })).toBeVisible();
  await expect(page.getByLabel('Who paid', { exact: true }).locator('option')).toHaveText(['Choose who paid', username, 'Ali']);

  // New settle-up: neither person list offers Omar.
  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  await expect(page.getByLabel('Who paid', { exact: true }).locator('option')).toHaveText(['Choose a member', username, 'Ali']);
  await expect(page.getByLabel('Who received it', { exact: true }).locator('option')).toHaveText(['Choose a member', username, 'Ali']);

  // Not in the balance list either.
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Without Omar' })).toBeVisible();
  await expect(page.getByTestId('balance-row')).toHaveCount(2);
  await expect(page.getByTestId('balance-row').filter({ hasText: 'Omar' })).toHaveCount(0);
});

// ---------- US-21 ----------

test('US-21 #1-#4 a member with a balance must settle first; at 0.00 they leave and the history keeps them as "(removed)"', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const pair = await twoAccountGroup(browser, info, 'Leavers', ['Sara']);
  const { owner, omar, groupId, meId, ids } = pair;
  try {
    // Dinner: the owner paid 30.00 for three (10.00 each), so Omar owes 10.00 and Sara owes 10.00.
    await api(owner, 'post', `/groups/${groupId}/bills`, groupBillBody([meId, ids.Omar, ids.Sara], meId, '30', 'Dinner'));
    // Omar has a solo bill of his own.
    await api(omar, 'post', '/solo-bills', soloBillBody('Omar lunch', '8'));
    const soloBefore = await api<{ bills: unknown[] }>(omar, 'get', '/solo-bills');
    expect(soloBefore.bills).toHaveLength(1);

    // #1: with a balance he can't leave, sees the message, and is still in the group.
    await openMembersTab(omar, groupId, 'Leavers');
    await omar.getByRole('button', { name: 'Leave group' }).click();
    const dialog = omar.getByRole('dialog', { name: 'Leave this group?' });
    await dialog.getByRole('button', { name: 'Leave group' }).click();
    await expect(omar.getByRole('alert')).toHaveText('Settle your balance before leaving');
    await expect(omar.getByRole('heading', { level: 1, name: 'Leavers' })).toBeVisible();
    await expect(dialog).toBeHidden();
    await omar.goto('/groups');
    await expect(omar.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(omar.getByRole('link', { name: /Leavers/ })).toBeVisible();

    // He settles up to 0.00. Before he leaves, note the owner's view of the group.
    await api(omar, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Omar, toId: meId, amount: '10' });
    const balancesBefore = Object.fromEntries((await members(owner, groupId)).map((m) => [m.id, m.balanceCents]));
    expect(balancesBefore[ids.Omar]).toBe(0);
    expect(balancesBefore[ids.Sara]).not.toBe(0);
    await owner.goto(`/groups/${groupId}`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Leavers' })).toBeVisible();
    const myRow = owner.getByTestId('balance-row').filter({ hasText: '(you)' });
    const saraRow = owner.getByTestId('balance-row').filter({ hasText: 'Sara' });
    const mineBefore = await myRow.textContent();
    const saraBefore = await saraRow.textContent();
    const dinnerId = (await api<{ bills: { id: string; name: string }[] }>(owner, 'get', `/groups/${groupId}/bills`)).bills[0].id;
    await owner.goto(`/groups/${groupId}/bills/${dinnerId}`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
    await expect(owner.getByTestId('grand-total')).toHaveText('$30.00');

    // #2: at 0.00, he confirms and the group is gone from his list.
    await openMembersTab(omar, groupId, 'Leavers');
    await omar.getByRole('button', { name: 'Leave group' }).click();
    await expect(dialog).toBeVisible();
    // Coming back is by Restore only: the dialog says so, and no longer mentions a code to rejoin with.
    await expect(dialog).toContainText('Any member can restore you later.');
    await expect(dialog).not.toContainText(/code/i);
    await dialog.getByRole('button', { name: 'Leave group' }).click();
    await expect(omar.getByRole('status').getByText('You left the group')).toBeVisible();
    await expect(omar.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(omar.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
    await expect(omar.getByRole('link', { name: /Leavers/ })).toHaveCount(0);

    // The owner sees him under "Removed members" and "Omar left" in the log.
    await openMembersTab(owner, groupId, 'Leavers');
    await expect(owner.getByText('Omar (removed)')).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Restore Omar' })).toBeVisible();
    await owner.getByRole('tab', { name: 'Activity' }).click();
    await expect(owner.getByTestId('activity').filter({ hasText: 'Omar left' })).toHaveCount(1);

    // #3: old bills keep him as "Name (removed)" and every total and balance is the same.
    await owner.goto(`/groups/${groupId}/bills/${dinnerId}`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
    // The saved bill is a read-only receipt: he is still one of the three shares, as "Omar (removed)".
    const receipt = owner.getByRole('region', { name: 'Bill', exact: true });
    await expect(owner.getByText(/Split equally between 3 people\.$/)).toBeVisible();
    await expect(receipt.getByTestId('share')).toHaveCount(3);
    await expect(receipt.getByTestId('share').filter({ hasText: 'Omar (removed)' })).toHaveCount(1);
    await expect(receipt.getByTestId('share').filter({ hasText: 'Omar (removed)' })).toContainText('$10.00');
    await expect(receipt.getByTestId('share').filter({ hasText: 'Sara' })).toContainText('$10.00');
    await expect(owner.getByTestId('grand-total')).toHaveText('$30.00');
    await owner.goto(`/groups/${groupId}`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Leavers' })).toBeVisible();
    await expect(myRow).toHaveText(mineBefore!);
    await expect(saraRow).toHaveText(saraBefore!);
    const after = await members(owner, groupId);
    expect(Object.fromEntries(after.map((m) => [m.id, m.balanceCents]))).toEqual(balancesBefore);
    expect(after.find((m) => m.id === ids.Omar)?.status).toBe('removed');

    // #4: his account and solo bills are unchanged.
    await omar.goto('/solo');
    await expect(omar.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
    await expect(omar.getByRole('link', { name: /Omar lunch/ })).toBeVisible();
    const soloAfter = await api<{ bills: unknown[] }>(omar, 'get', '/solo-bills');
    expect(soloAfter).toEqual(soloBefore);
  } finally {
    await closeAll(pair.contexts);
  }
});

// ---------- US-22 ----------

test('US-22 #5 after the last account holder closes a group, their solo bills and another group are still there', async ({ page }, info) => {
  await signUpFast(page, info);
  await api(page, 'post', '/solo-bills', soloBillBody('My solo dinner', '15'));
  const closing = await makeGroup(page, 'To close', '$', ['Omar']);
  await makeGroup(page, 'Stays open', '$', ['Ali']);

  await openMembersTab(page, closing.groupId, 'To close');
  await page.getByRole('button', { name: 'Leave group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave and delete this group?' });
  await dialog.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('link', { name: /To close/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Stays open/ })).toBeVisible();

  await page.getByRole('link', { name: /Stays open/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Stays open' })).toBeVisible();
  await page.goto('/solo');
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page.getByRole('link', { name: /My solo dinner/ })).toBeVisible();
});

test('US-22 #6 there is no "Delete group" button on the group page or any of its tabs', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'No delete', '$', ['Omar', 'Ali']);
  await api(page, 'post', `/groups/${groupId}/bills`, groupBillBody([meId, ids.Ali], meId, '10', 'Lunch'));
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Ali, toId: meId, amount: '2' });
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);

  for (const [tab, readyText] of [
    ['bills', 'Lunch'],
    ['settle-ups', 'Record a payment'],
    ['members', 'Leave group'],
    ['activity', 'created the group'],
  ] as const) {
    await page.goto(`/groups/${groupId}?tab=${tab}`);
    await expect(page.getByRole('heading', { level: 1, name: 'No delete' })).toBeVisible();
    await expect(page.getByRole('tabpanel').getByText(readyText).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /delete/i }), `buttons on the ${tab} tab`).toHaveCount(0);
    await expect(page.getByRole('link', { name: /delete/i }), `links on the ${tab} tab`).toHaveCount(0);
    await expect(page.getByText(/delete group/i), `text on the ${tab} tab`).toHaveCount(0);
  }
  // The only way out of a group is "Leave group".
  await page.goto(`/groups/${groupId}?tab=members`);
  await expect(page.getByRole('button', { name: 'Leave group' })).toBeVisible();
});

// ---------- US-23 ----------

test('US-23 #3 a restored member with an account gets the group back on their next page load', async ({ browser }, info) => {
  const pair = await twoAccountGroup(browser, info, 'Come back');
  const { owner, omar, groupId, ids } = pair;
  try {
    await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('alert')).toHaveText('You no longer have access to this group');

    await openMembersTab(owner, groupId, 'Come back');
    await owner.getByRole('button', { name: 'Restore Omar' }).click();
    await expect(owner.getByRole('status').getByText('Member restored')).toBeVisible();
    await expect(owner.getByText('Omar (removed)')).toHaveCount(0);

    await omar.reload();
    await expect(omar.getByRole('heading', { level: 1, name: 'Come back' })).toBeVisible();
    await omar.goto('/groups');
    await expect(omar.getByRole('link', { name: /Come back/ })).toBeVisible();
  } finally {
    await closeAll(pair.contexts);
  }
});

// ---------- US-22 #4 / US-24 retired ----------
// Rejoining with a group code (US-24) is gone: a removed member comes back by Restore only (US-23, round1-members.spec.ts).
// What is left of "the code of a deleted group stops working" is the person's own invite.

test("US-22 #4 a person's invite stops working once the only group they were in is deleted", async ({ browser }, info) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const visitorCtx = await browser.newContext();
  const visitor = await visitorCtx.newPage();
  try {
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Short lived', '$', ['Omar']);
    const code = await inviteCodeOf(owner, groupId, 'Omar');

    // The code works while the group exists...
    await signUpFast(visitor, info, 'vis');
    await visitor.goto('/join');
    await expect(visitor.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
    await visitor.getByLabel('Invite code').fill(code);
    await visitor.getByRole('button', { name: 'Continue' }).click();
    await expect(inviteHeading(visitor, 'Omar')).toBeVisible();
    await expect(visitor.getByText('Short lived')).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'Join these groups' })).toBeVisible();

    // ...and stops working once the last account holder has deleted the group.
    await openMembersTab(owner, groupId, 'Short lived');
    await owner.getByRole('button', { name: 'Leave group' }).click();
    await owner.getByRole('dialog', { name: 'Leave and delete this group?' }).getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(owner.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();

    await visitor.goto('/join');
    await expect(visitor.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
    await visitor.getByLabel('Invite code').fill(code);
    await visitor.getByRole('button', { name: 'Continue' }).click();
    await expect(visitor.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
    await expect(visitor.getByRole('alert')).toHaveText("That invite link isn't valid. Check the code and try again.");
    await expect(visitor.getByRole('button', { name: 'Join these groups' })).toHaveCount(0);
    await expect(inviteHeading(visitor, 'Omar')).toHaveCount(0);

    // Nothing was joined by looking.
    await visitor.goto('/groups');
    await expect(visitor.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(visitor.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
  } finally {
    await closeAll([ownerCtx, visitorCtx]);
  }
});

// ---------- US-33 ----------

test('US-33 #7 a brand-new account sees what to do next in both Dashboard sections', async ({ page }, info) => {
  await signUpFast(page, info);
  const groups = page.getByRole('region', { name: 'Your groups' });
  await expect(groups.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
  const createGroup = groups.getByRole('link', { name: 'Create group' });
  await expect(createGroup).toBeVisible();
  await expect(createGroup).toHaveClass(/btn/);
  const solo = page.getByRole('region', { name: 'Latest solo bills' });
  await expect(solo.getByText('No solo bills yet. Total your first bill to keep a record of it.')).toBeVisible();
  const newSolo = solo.getByRole('link', { name: 'New solo bill' });
  await expect(newSolo).toBeVisible();
  await expect(newSolo).toHaveClass(/btn/);

  // The buttons take the person to the next step.
  await createGroup.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('region', { name: 'Latest solo bills' }).getByRole('link', { name: 'New solo bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
});

// ---------- US-36 #5 touch and click targets ----------

const TARGETS = 'button, a[href], select, input[type="checkbox"], input[type="radio"]';

/**
 * Every visible control matched by `targets` is at least 24x24 px, and at least `minimum` of them
 * were really measured (so a control that moved or went missing can't pass by not being looked at).
 * A tick box or radio sits inside its <label>, which is part of the clickable area, so the
 * label's box counts for it.
 */
async function expectTargetsBigEnough(targets: Locator, label: string, minimum = 1): Promise<void> {
  const tooSmall: string[] = [];
  let checked = 0;
  for (const el of await targets.all()) {
    if (!(await el.isVisible())) continue;
    let box = await el.boundingBox();
    const isInput = await el.evaluate((n) => n instanceof HTMLInputElement);
    if (isInput) {
      const wrapper = el.locator('xpath=ancestor::label[1]');
      const wrapperBox = (await wrapper.count()) ? await wrapper.boundingBox() : null;
      if (wrapperBox && (!box || wrapperBox.width * wrapperBox.height > box.width * box.height)) box = wrapperBox;
    }
    checked += 1;
    if (!box || box.width < 24 || box.height < 24) {
      const what = await el.evaluate((n) => `${n.tagName.toLowerCase()} "${(n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 40)}"`);
      tooSmall.push(`${what} is ${box ? `${box.width.toFixed(1)}x${box.height.toFixed(1)}` : 'not measurable'}`);
    }
  }
  expect(checked, `${label}: found at least ${minimum} to measure`).toBeGreaterThanOrEqual(minimum);
  expect(tooSmall, `${label}: targets under 24x24 px`).toEqual([]);
}

/** Every visible button, link, select and tick box inside `scope` is at least 24x24 px. */
const expectBigTargets = (scope: Locator, label: string) => expectTargetsBigEnough(scope.locator(TARGETS), label);

/** axe's own target-size rule (WCAG 2.5.8), which exempts links inside a sentence. */
async function expectTargetSizeRulePasses(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules(['target-size']).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((nd) => nd.target.join(' ')).join(', ')}`);
  expect(summary, `axe target-size on ${label}`).toEqual([]);
}

test('US-36 #5 every button, link and tick box on the bill form, group page and dialogs is at least 24x24 px', async ({ page }, info) => {
  test.setTimeout(120_000);
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Targets', '$', ['Ali', 'Sara']);
  await api(page, 'post', `/groups/${groupId}/bills`, groupBillBody([meId, ids.Ali, ids.Sara], meId, '30', 'Lunch'));
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Ali, toId: meId, amount: '4' });
  const { bills } = await api<{ bills: { id: string }[] }>(page, 'get', `/groups/${groupId}/bills`);
  const body = page.locator('body');

  // Bill form, equal split: the name chips, "Everyone", the "Remove item N" buttons, the % / currency
  // switch segments and the currency info button, each measured by name (and then the whole page).
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Targets' })).toBeVisible();
  await page.getByRole('button', { name: '+ Add item' }).click(); // two rows, so two remove buttons
  await expect(page.getByRole('radio', { name: 'Items + tax' })).toBeVisible(); // a % tip shows the "Tip is a % of" options
  const took = page.getByRole('group', { name: 'Who took part' });
  await expectTargetsBigEnough(took.getByRole('checkbox'), 'name chips under "Who took part"', 3);
  await expectTargetsBigEnough(took.getByRole('button', { name: 'Everyone' }), '"Everyone" under "Who took part"');
  await expectTargetsBigEnough(page.getByRole('button', { name: /^Remove item \d+$/ }), 'the "Remove item N" buttons', 2);
  await expectTargetsBigEnough(
    page.getByRole('radiogroup', { name: /^(Tax|Other charges|Tip) as$/ }).getByRole('radio'),
    'the % / currency switch segments',
    6,
  );
  await expectTargetsBigEnough(page.getByRole('group', { name: 'Tip is a % of' }).getByRole('radio'), 'the "Tip is a % of" options', 2);
  await expectTargetsBigEnough(page.getByRole('radio', { name: /^(Equally|By items)/ }), 'the "How to split" switch', 2);
  await expectTargetsBigEnough(page.getByRole('button', { name: 'About the currency' }), 'the "About the currency" info button');
  await expectBigTargets(body, 'bill form (equal split)');
  await expectTargetSizeRulePasses(page, 'bill form (equal split)');

  // Bill form, by items: each item has its own name chips and "Everyone" (no dropdown to open).
  await page.getByRole('radio', { name: /By items/ }).check();
  await page.getByLabel('Item 1 price').fill('10');
  const shared = page.getByRole('group', { name: 'Who shared item 1' });
  await expectTargetsBigEnough(shared.getByRole('checkbox'), 'name chips under "Who shared item 1"', 3);
  await expectTargetsBigEnough(shared.getByRole('button', { name: 'Everyone' }), '"Everyone" under "Who shared item 1"');
  await shared.getByRole('button', { name: 'Everyone' }).click();
  await expect(shared.getByRole('checkbox', { name: 'Ali' })).toBeChecked();
  await expectBigTargets(body, 'bill form (by items, item shared by everyone)');
  await expectTargetSizeRulePasses(page, 'bill form (by items, item shared by everyone)');

  // Saved bill: a read-only receipt with its "Edit bill" link and Delete button, and the delete dialog.
  await page.goto(`/groups/${groupId}/bills/${bills[0].id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Lunch' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit bill' })).toBeVisible();
  await expectBigTargets(body, 'saved bill');
  await expectTargetSizeRulePasses(page, 'saved bill');
  await page.getByRole('button', { name: 'Delete' }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete this bill?' });
  await expect(deleteDialog).toBeVisible();
  await expectBigTargets(deleteDialog, 'delete bill dialog');
  await expectTargetSizeRulePasses(page, 'delete bill dialog');
  await page.keyboard.press('Escape');

  // The same bill being edited, with its Cancel link.
  await page.goto(`/groups/${groupId}/bills/${bills[0].id}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Lunch' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancel' })).toBeVisible();
  await expectBigTargets(body, 'bill edit page');
  await expectTargetSizeRulePasses(page, 'bill edit page');

  // Settle-up form.
  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  await expectBigTargets(body, 'settle-up form');
  await expectTargetSizeRulePasses(page, 'settle-up form');

  // Group page: every tab.
  for (const [tab, readyText] of [
    ['bills', 'Lunch'],
    ['settle-ups', 'Record a payment'],
    ['members', 'Leave group'],
    ['activity', 'created the group'],
  ] as const) {
    await page.goto(`/groups/${groupId}?tab=${tab}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Targets' })).toBeVisible();
    await expect(page.getByRole('tabpanel').getByText(readyText).first()).toBeVisible();
    await expectTargetsBigEnough(page.getByRole('button', { name: 'About the currency' }), `the "About the currency" info button, ${tab} tab`);
    await expectBigTargets(body, `group page, ${tab} tab`);
    await expectTargetSizeRulePasses(page, `group page, ${tab} tab`);
  }

  // The currency info button opened: the note it shows has no small targets either.
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Targets' })).toBeVisible();
  await page.getByRole('button', { name: 'About the currency' }).click();
  await expect(page.getByRole('button', { name: 'About the currency' })).toHaveAttribute('aria-expanded', 'true');
  await expectBigTargets(body, 'group page, currency note open');
  await expectTargetSizeRulePasses(page, 'group page, currency note open');

  // Members tab dialogs and the removed-members list.
  await page.goto(`/groups/${groupId}?tab=members`);
  await expect(page.getByRole('heading', { level: 2, name: /^Members \(/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Sara' }).click();
  const removeDialog = page.getByRole('dialog', { name: 'Remove Sara?' });
  await expect(removeDialog).toBeVisible();
  await expectBigTargets(removeDialog, 'remove member dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Leave group' }).click();
  const leaveDialog = page.getByRole('dialog', { name: 'Leave and delete this group?' });
  await expect(leaveDialog).toBeVisible();
  await expectBigTargets(leaveDialog, 'leave dialog');
  await page.keyboard.press('Escape');

  // Round 1: a friend just added (their invite box with Copy link / Share), the rename form, and the Edit group and invite-code pages.
  await page.getByLabel('Add a friend by name').fill('Newcomer');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('Send them their own invite link')).toBeVisible();
  await expectBigTargets(body, 'members tab, friend just added');
  await expectTargetSizeRulePasses(page, 'members tab, friend just added');
  await page.getByRole('button', { name: 'Rename Ali' }).click();
  await expect(page.getByLabel('New name for Ali')).toBeVisible();
  await expectBigTargets(body, 'members tab, rename form');
  await expectTargetSizeRulePasses(page, 'members tab, rename form');
  for (const [path, heading] of [
    [`/groups/${groupId}/edit`, 'Edit group'],
    ['/join', 'Use an invite code'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectBigTargets(body, heading);
    await expectTargetSizeRulePasses(page, heading);
  }

  // Solo bill form: the currency picker, the % / currency switch segments and "Remove item 1".
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await expectTargetsBigEnough(page.getByLabel('Currency', { exact: true }), 'the currency picker (solo)');
  await expectTargetsBigEnough(page.getByRole('button', { name: 'Remove item 1' }), '"Remove item 1" (solo)');
  await expectTargetsBigEnough(
    page.getByRole('radiogroup', { name: /^(Tax|Other charges|Tip) as$/ }).getByRole('radio'),
    'the % / currency switch segments (solo)',
    6,
  );
  await expectBigTargets(body, 'solo bill form');
  await expectTargetSizeRulePasses(page, 'solo bill form');

  await page.getByLabel('Item 1 price').fill('5');
  await page.getByRole('link', { name: 'Groups' }).first().click();
  const unsaved = page.getByRole('dialog', { name: 'You have unsaved changes. Leave without saving?' });
  await expect(unsaved).toBeVisible();
  await expectBigTargets(unsaved, 'unsaved changes dialog');
  await expectTargetSizeRulePasses(page, 'unsaved changes dialog');
});

// ---------- US-36 #6 accessibility scans of the remaining pages ----------

for (const scheme of ['light', 'dark'] as const) {
  test(`US-36 #6 no WCAG 2.2 AA problems on the remaining pages (${scheme})`, async ({ browser }, info) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ colorScheme: scheme });
    const joinerCtx = await browser.newContext({ colorScheme: scheme });
    const guestCtx = await browser.newContext({ colorScheme: scheme });
    try {
      const page = await ctx.newPage();

      // Reset password (logged out).
      await page.goto('/login');
      await page.getByRole('link', { name: 'Forgot your password?' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
      await expectNoA11yViolations(page, 'reset password');
      await page.getByRole('button', { name: 'Reset password' }).click();
      await expect(page.getByText('Password must be at least 8 characters', { exact: true })).toBeVisible();
      await expectNoA11yViolations(page, 'reset password with a field error');
      // A fresh name each run: wrong codes for one username count towards its wait (US-03 #5).
      await page.getByLabel('Username').fill(uniqueName('nobody', info));
      await page.getByLabel('Recovery code').fill('WRONG-CODE');
      await page.getByLabel('New password').fill('a new password');
      await page.getByRole('button', { name: 'Reset password' }).click();
      await expect(page.getByRole('alert')).toHaveText('Username or recovery code is incorrect');
      await expectNoA11yViolations(page, 'reset password with a wrong code');

      // The recovery-code screen right after signing up.
      const username = uniqueName('ax', info);
      await page.goto('/signup');
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Save your recovery code' })).toBeVisible();
      await expect(page.getByTestId('recovery-code')).toBeVisible();
      await expectNoA11yViolations(page, 'recovery code screen');
      await page.getByRole('button', { name: "I've saved it, continue" }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      // Groups list: empty, then Create group.
      await page.goto('/groups');
      await expect(page.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
      await expectNoA11yViolations(page, 'groups list (empty)');
      await page.getByRole('link', { name: 'Create group' }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();
      await expectNoA11yViolations(page, 'create group');
      await page.getByRole('button', { name: 'Create group' }).click();
      await expect(page.getByText('Enter a group name of up to 50 characters')).toBeVisible();
      await expectNoA11yViolations(page, 'create group with errors');

      // A group with a bill and a payment.
      const { groupId, meId, ids } = await makeGroup(page, 'Scanned', '$', ['Omar', 'Ali']);
      await api(page, 'post', `/groups/${groupId}/bills`, groupBillBody([meId, ids.Omar, ids.Ali], meId, '30', 'Lunch'));
      await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Ali, toId: meId, amount: '4' });
      await page.goto('/groups');
      await expect(page.getByRole('link', { name: /Scanned/ })).toBeVisible();
      await expectNoA11yViolations(page, 'groups list');

      await page.goto(`/groups/${groupId}?tab=settle-ups`);
      await expect(page.getByRole('heading', { level: 1, name: 'Scanned' })).toBeVisible();
      await expect(page.getByRole('tabpanel').getByText('Ali paid').first()).toBeVisible();
      await expectNoA11yViolations(page, 'group settle-ups tab');
      await page.goto(`/groups/${groupId}?tab=activity`);
      await expect(page.getByTestId('activity').first()).toBeVisible();
      await expectNoA11yViolations(page, 'group activity tab');

      await page.goto(`/groups/${groupId}/settle-ups/new`);
      await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
      await expectNoA11yViolations(page, 'settle-up form');
      await page.getByRole('button', { name: 'Record payment' }).click();
      await expect(page.getByText('Choose who paid and who received the payment')).toBeVisible();
      await expectNoA11yViolations(page, 'settle-up form with errors');

      // The unsaved-changes dialog.
      await page.goto('/solo/new');
      await page.getByLabel('Item 1 price').fill('9');
      await page.getByRole('link', { name: 'Groups' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'You have unsaved changes. Leave without saving?' });
      await expect(dialog).toBeVisible();
      await expectNoA11yViolations(page, 'unsaved changes dialog');
      await dialog.getByRole('button', { name: 'Stay' }).click();

      // "Use an invite code" and the invite page, as a second (logged-in) account.
      const code = await inviteCodeOf(page, groupId, 'Omar');
      const joiner = await joinerCtx.newPage();
      await signUpFast(joiner, info, 'jn');
      await joiner.goto('/join');
      await expect(joiner.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
      await expectNoA11yViolations(joiner, 'use an invite code');
      await joiner.getByRole('button', { name: 'Continue' }).click();
      await expect(joiner.getByText('Enter the invite code you were sent', { exact: true })).toBeVisible();
      await expectNoA11yViolations(joiner, 'use an invite code with a field error');
      await joiner.getByLabel('Invite code').fill('WRONGCODE');
      await joiner.getByRole('button', { name: 'Continue' }).click();
      await expect(joiner.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
      await expect(joiner.getByRole('alert')).toHaveText("That invite link isn't valid. Check the code and try again.");
      await expectNoA11yViolations(joiner, 'invite not found');
      await joiner.goto('/join');
      await expect(joiner.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
      await joiner.getByLabel('Invite code').fill(code);
      await joiner.getByRole('button', { name: 'Continue' }).click();
      await expect(inviteHeading(joiner, 'Omar')).toBeVisible();
      await expect(joiner.getByRole('button', { name: 'Join these groups' })).toBeVisible();
      await expectNoA11yViolations(joiner, 'invite page (logged in)');

      // The same invite page for someone with no account yet: create one, or log in.
      const guest = await guestCtx.newPage();
      await guest.goto(`/invite/${code}`);
      await expect(inviteHeading(guest, 'Omar')).toBeVisible();
      await expect(guest.getByRole('button', { name: 'Create account and join' })).toBeVisible();
      await expectNoA11yViolations(guest, 'invite page (create an account)');
      await guest.getByRole('button', { name: 'Create account and join' }).click();
      await expect(guest.getByText('Password must be at least 8 characters', { exact: true })).toBeVisible();
      await expectNoA11yViolations(guest, 'invite page with field errors');
      await guest.getByRole('radio', { name: 'I have an account' }).check();
      await expect(guest.getByRole('button', { name: 'Log in and join' })).toBeVisible();
      await expectNoA11yViolations(guest, 'invite page (log in)');

      // Once used, the link says so.
      await joiner.getByRole('button', { name: 'Join these groups' }).click();
      await expect(joiner.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await guest.reload();
      // A used invite no longer shows whose it was.
      await expect(guest.getByRole('heading', { level: 1, name: 'Invite already used' })).toBeVisible();
      await expect(guest.getByText('Omar')).toHaveCount(0);
      await expect(guest.getByRole('alert')).toHaveText('This invite has already been used');
      await expectNoA11yViolations(guest, 'invite page (already used)');
    } finally {
      await closeAll([ctx, joinerCtx, guestCtx]);
    }
  });
}

// ---------- US-37 ----------

/** The corner message shows up, is still there after 3 s, and has gone about 5 s after the action. */
async function expectToastForAboutFiveSeconds(page: Page, text: string, act: () => Promise<void>): Promise<void> {
  const toast = page.getByRole('status').getByText(text);
  const started = Date.now();
  await act();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(toast).toBeVisible();
  await expect(toast).toBeHidden({ timeout: 6000 });
  const lasted = Date.now() - started;
  expect(lasted).toBeGreaterThanOrEqual(4900);
  expect(lasted).toBeLessThan(8000);
}

test('US-37 #1 the "Payment recorded" message appears and disappears after about 5 seconds', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Toast pay', '$', ['Ali']);
  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  await page.getByLabel('Who paid', { exact: true }).selectOption({ label: 'Ali' });
  await page.getByLabel('Who received it', { exact: true }).selectOption({ label: username });
  await page.getByLabel(/Amount/).fill('5');
  await expectToastForAboutFiveSeconds(page, 'Payment recorded', () => page.getByRole('button', { name: 'Record payment' }).click());
  await expect(page.getByRole('heading', { level: 1, name: 'Toast pay' })).toBeVisible();
});

test('US-37 #1 the "Member removed" message appears and disappears after about 5 seconds', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Toast remove', '$', ['Ali']);
  await openMembersTab(page, groupId, 'Toast remove');
  await page.getByRole('button', { name: 'Remove Ali' }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Ali?' });
  await expect(dialog).toBeVisible();
  await expectToastForAboutFiveSeconds(page, 'Member removed', () => dialog.getByRole('button', { name: 'Remove member' }).click());
  await expect(page.getByText('Ali (removed)')).toBeVisible();
});

test('US-37 #2 while a solo bill is being saved the button reads "Saving…" and is disabled, and the bill is saved once', async ({ page }, info) => {
  await signUpFast(page, info);
  let posts = 0;
  await page.route('**/api/solo-bills', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts += 1;
    await new Promise((resolve) => setTimeout(resolve, 2500)); // long enough for a slow machine to see "Saving…"
    return route.continue();
  });
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await page.getByLabel('Bill name').fill('Held bill');
  await page.getByLabel('Item 1 price').fill('12');
  await page.getByRole('button', { name: 'Save bill' }).click();

  const saving = page.getByRole('button', { name: 'Saving…' });
  await expect(saving).toBeVisible();
  await expect(saving).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save bill' })).toHaveCount(0);
  await page.waitForTimeout(700); // still held
  await expect(saving).toBeDisabled();
  await expect(page).toHaveURL(/\/solo\/new$/); // nothing has moved on while the save is running
  // A second press while it saves does nothing (force: skip Playwright's own "is it enabled" wait).
  await saving.click({ force: true });
  expect(posts).toBe(1);

  // Once the save finishes the app leaves the form for the history: no "Saving…" button is left anywhere.
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saving…' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Held bill/ })).toHaveCount(1);
  expect(posts).toBe(1);
  const { bills } = await api<{ bills: { name: string }[] }>(page, 'get', '/solo-bills');
  expect(bills.map((b) => b.name)).toEqual(['Held bill']);
});

test('US-37 #5 a new group says what to do next on its Bills and Settle-ups tabs (and its log is never empty)', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Fresh', '$', []);
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Fresh' })).toBeVisible();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByText('No bills yet. Add the first bill you shared.')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Add bill' })).toBeVisible();
  await page.getByRole('tab', { name: 'Settle-ups' }).click();
  await expect(panel.getByText('No settle-ups yet. When someone pays another member back, record it here so balances stay right.')).toBeVisible();
  // An empty Activity can't happen: "created the group" is always logged.
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity').filter({ hasText: 'created the group' })).toHaveCount(1);
  await expect(panel.getByText(/No activity yet/)).toHaveCount(0);
});

test('US-37 #6 the Remove member dialog has a red danger button and focuses Cancel', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Danger remove', '$', ['Ali']);
  await openMembersTab(page, groupId, 'Danger remove');
  await page.getByRole('button', { name: 'Remove Ali' }).click();
  await expectSafeDialog(page, page.getByRole('dialog', { name: 'Remove Ali?' }), 'Cancel', 'Remove member');
});

test('US-37 #6 the last-account Leave dialog has a red Leave button and focuses Cancel', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Danger close', '$', ['Ali']);
  await openMembersTab(page, groupId, 'Danger close');
  await page.getByRole('button', { name: 'Leave group' }).click();
  await expectSafeDialog(page, page.getByRole('dialog', { name: 'Leave and delete this group?' }), 'Cancel', 'Leave');
});

test('US-37 #6 the normal Leave dialog has a red Leave group button and focuses Stay', async ({ browser }, info) => {
  const pair = await twoAccountGroup(browser, info, 'Danger leave');
  try {
    await openMembersTab(pair.omar, pair.groupId, 'Danger leave');
    await pair.omar.getByRole('button', { name: 'Leave group' }).click();
    await expectSafeDialog(pair.omar, pair.omar.getByRole('dialog', { name: 'Leave this group?' }), 'Stay', 'Leave group');
  } finally {
    await closeAll(pair.contexts);
  }
});

// ---------- US-38 ----------

const UNSAVED = 'You have unsaved changes. Leave without saving?';

/** Opens a new solo bill from the Dashboard (so there is a page to go back to) and types a price. */
async function startDirtySoloBill(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'New solo bill' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await page.getByLabel('Item 1 price').fill('42');
}

test('US-38 #1 pressing the browser back button with unsaved changes asks before leaving', async ({ page }, info) => {
  await signUpFast(page, info);
  await startDirtySoloBill(page);

  await page.goBack();
  const dialog = page.getByRole('dialog', { name: UNSAVED });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Stay' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Leave' })).toBeVisible();
  // Nothing has moved yet.
  await expect(page).toHaveURL(/\/solo\/new$/);
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Item 1 price')).toHaveValue('42');
  await expect(page).toHaveURL(/\/solo\/new$/);

  // Leaving really goes back to the Dashboard.
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('US-38 #1 clicking an in-page link ("← Solo bills") or a sidebar link with unsaved changes asks before leaving', async ({ page }, info) => {
  await signUpFast(page, info);
  await startDirtySoloBill(page);

  await page.getByRole('link', { name: '← Solo bills' }).click();
  const dialog = page.getByRole('dialog', { name: UNSAVED });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/solo\/new$/);
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Item 1 price')).toHaveValue('42');

  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
});

test('US-38 #5 right after a successful Save of a new solo bill, leaving shows no warning', async ({ page }, info) => {
  await signUpFast(page, info);
  await startDirtySoloBill(page);
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  // Saving takes me to the history, not to the bill, and no question stops me.
  await expect(page).toHaveURL(/\/solo$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = page.getByRole('link', { name: /Bill – / });
  await expect(saved).toHaveCount(1);
  await expect(saved.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('US-38 #5 right after a successful Save of an edited solo bill, leaving shows no warning', async ({ page }, info) => {
  await signUpFast(page, info);
  await startDirtySoloBill(page);
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);

  // Open the saved bill (a read-only receipt) and press "Edit bill".
  await page.getByRole('link', { name: /Bill – / }).click();
  await expect(page).toHaveURL(/\/solo\/\d+$/);
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page).toHaveURL(/\/solo\/\d+\/edit$/);

  // Edit the saved bill: leaving now would warn...
  const price = page.getByLabel('Item 1 price');
  await expect(price).toHaveValue('42.00');
  await price.fill('50');
  await page.getByRole('link', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog', { name: UNSAVED });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/solo\/\d+\/edit$/);
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toBeHidden();
  await expect(price).toHaveValue('50');
  // ...but right after saving the edit it does not: the app goes to the history with the bill marked "Saved".
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Bill – / }).getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /Bill – / })).toContainText('$50.00');
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('US-38 #5 leaving a bill form nobody changed shows no warning', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.getByRole('link', { name: 'New solo bill' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
