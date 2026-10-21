import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { api, makeGroup, signUpFast } from './helpers.js';

// Acceptance-criteria tests for the group stories (docs/user-stories.md).
// Each test name says which story and criterion numbers it proves.
//
// Joining works through personal invites: every person added by name has their own
// invite code and link (/invite/<code>); there is no group-wide code and no name list.

// ---------- helpers ----------

type Charge = { mode: 'percent' | 'amount'; value: string };
const amountCharge = (value: string): Charge => ({ mode: 'amount', value });

/** The JSON the server expects for a group bill. */
function billBody(participantIds: string[], payerId: string, prices: string[], over: Record<string, unknown> = {}) {
  return {
    name: '',
    items: prices.map((price) => ({ name: '', price })),
    tax: amountCharge('0'),
    otherCharges: amountCharge(''),
    tip: amountCharge('0'),
    tipOn: 'items',
    splitMode: 'equal',
    participantIds,
    payerId,
    ...over,
  };
}

async function postBill(page: Page, groupId: string, bill: Record<string, unknown>): Promise<string> {
  const r = await api<{ billId: string }>(page, 'post', `/groups/${groupId}/bills`, { bill });
  return r.billId;
}

/** Ali paid 65.00; Ali's share is 52.00 and Sara's 13.00 (the docs example). */
async function postAliSaraBill(page: Page, groupId: string, ids: Record<string, string>): Promise<void> {
  await postBill(
    page,
    groupId,
    billBody([ids.Ali, ids.Sara], ids.Ali, [], {
      splitMode: 'itemized',
      items: [
        { name: 'Steak', price: '40.00', sharerIds: [ids.Ali] },
        { name: 'Salad', price: '10.00', sharerIds: [ids.Sara] },
      ],
      tax: amountCharge('5.00'),
      tip: amountCharge('10.00'),
    }),
  );
}

async function openNewBill(page: Page, groupId: string): Promise<void> {
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: /^Add bill to / })).toBeVisible();
}

async function openGroup(page: Page, groupId: string, name: string, tab?: string): Promise<void> {
  await page.goto(`/groups/${groupId}${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

const tookPart = (page: Page) => page.getByRole('group', { name: 'Who took part' });
const calculate = (page: Page) => page.getByRole('button', { name: 'Calculate' }).click();
// A row's text starts with the person's initial (their avatar), then their name.
const balanceRow = (page: Page, name: string) => page.getByTestId('balance-row').filter({ hasText: new RegExp(`^\\S${name}(?![A-Za-z0-9_])`) });
const fieldError = (page: Page, text: string) => page.locator('p.field-error', { hasText: text });
const shareAmounts = (page: Page) => page.locator('[data-testid="share"] .share-amount');
const shareNames = (page: Page) => page.locator('[data-testid="share"] .share-name');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The amount on one results line. The label is the whole line, rate included: "Tax (5%)", "Tip (15% of items)". */
const totalsRow = (page: Page, label: string) =>
  page.locator('dl.totals > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${escapeRegExp(label)}$`) }) }).locator('dd');
/** Top and bottom edges measured from the top of the page, so scrolling never changes them. */
const pageEdges = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
  });

async function setCharge(page: Page, label: 'Tax' | 'Other charges (optional)' | 'Tip', mode: 'Percentage' | 'Amount', value: string): Promise<void> {
  const group = page.getByRole('group', { name: label, exact: true });
  await group.getByRole('radio', { name: mode }).check();
  await group.getByRole('textbox').fill(value);
}

const pickerButton = (page: Page, n: number) => page.getByRole('button', { name: new RegExp(`^Who shared item ${n}:`) });

/** Fills item rows (adding rows as needed) and ticks who shared each one in its dropdown. */
async function fillItems(page: Page, items: { price: string; people?: string[] }[]): Promise<void> {
  for (let i = 0; i < items.length; i += 1) {
    const n = i + 1;
    if (i > 0) await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByLabel(`Item ${n} price`).fill(items[i].price);
    const people = items[i].people;
    if (people) {
      await pickerButton(page, n).click();
      const panel = page.locator('.picker-panel');
      for (const p of people) await panel.getByRole('checkbox', { name: p, exact: true }).check();
      await panel.getByRole('button', { name: 'Done' }).click();
      await expect(panel).toHaveCount(0);
    }
  }
}

async function chooseItemized(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
}

/** "Items $40.00 · Tax $4.00 · Other charges $0.00 · Tip $8.00" for the nth person. */
function breakdown(items: string, tax: string, other: string, tip: string): string {
  return `Items ${items} · Tax ${tax} · Other charges ${other} · Tip ${tip}`;
}

const toCents = (text: string): number => Math.round(Number(text.replace(/[$,]/g, '')) * 100);

async function shareParts(page: Page): Promise<{ items: number; tax: number; other: number; tip: number }[]> {
  const texts = await page.locator('[data-testid="share"] .share-parts').allTextContents();
  return texts.map((t) => {
    const m = /Items (\$[\d,.]+) · Tax (\$[\d,.]+) · Other charges (\$[\d,.]+) · Tip (\$[\d,.]+)/.exec(t.replace(/\s+/g, ' '));
    if (!m) throw new Error(`Unexpected breakdown line: ${t}`);
    return { items: toCents(m[1]), tax: toCents(m[2]), other: toCents(m[3]), tip: toCents(m[4]) };
  });
}

/** Two signed-in browser contexts: the group owner (also API-only helper) and a second account. */
async function twoAccounts(browser: Browser, info: TestInfo) {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const ownerName = await signUpFast(owner, info, 'own');
  const otherCtx = await browser.newContext();
  const other = await otherCtx.newPage();
  const otherName = await signUpFast(other, info, 'oth');
  return {
    owner,
    other,
    ownerName,
    otherName,
    close: async () => {
      await ownerCtx.close();
      await otherCtx.close();
    },
  };
}

/** A browser where nobody is logged in. */
async function loggedOutVisitor(browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext();
  return { page: await context.newPage(), context };
}

// ---------- invites ----------

/** A personal invite code is 12 characters and never contains 0, O, 1 or I. */
const INVITE_CODE = /^[A-HJ-NP-Z2-9]{12}$/;

interface MemberInfo {
  id: string;
  name: string;
  status: 'current' | 'removed';
  hasAccount: boolean;
  isMe: boolean;
  inviteCode: string | null;
}

async function memberInfo(page: Page, groupId: string, name: string): Promise<MemberInfo> {
  const { group } = await api<{ group: { members: MemberInfo[] } }>(page, 'get', `/groups/${groupId}`);
  const member = group.members.find((m) => m.name === name);
  if (!member) throw new Error(`"${name}" is not a member of group ${groupId}`);
  return member;
}

/** A person's own invite code, as the group's details give it to a member. */
async function inviteCodeOf(page: Page, groupId: string, name: string): Promise<string> {
  const { inviteCode } = await memberInfo(page, groupId, name);
  if (!inviteCode) throw new Error(`"${name}" has no invite code`);
  return inviteCode;
}

/** Adds someone from "my other groups" (the same person, so the same invite code). */
async function addFromOtherGroups(page: Page, groupId: string, name: string): Promise<void> {
  const { people } = await api<{ people: { key: string; name: string }[] }>(page, 'get', `/people?groupId=${groupId}`);
  const person = people.find((p) => p.name === name);
  if (!person) throw new Error(`"${name}" is not among the people in my other groups`);
  await api(page, 'post', `/groups/${groupId}/members`, { personKey: person.key });
}

/** Types a code on "Use an invite code" and presses Continue. */
async function enterInviteCode(page: Page, code: string): Promise<void> {
  await page.goto('/join');
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await page.getByLabel('Invite code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Opens /invite/<code> (logged in or out) and waits for the page's heading. */
async function openInvite(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/invite/${code}`);
  await expect(page.getByRole('heading', { level: 1, name: `${name}, join your friends' groups` })).toBeVisible();
}

/** One person's row on the Members tab (not the "was added" box). Every row has a "Rename" button. */
const memberRow = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Rename ${name}`, exact: true }) });

// ---------- US-09 create a group ----------

test('US-09 #2 pick one of the 13 listed currencies (PKR after Rs) or "Other" and type "zł"; a note says it can be changed later and amounts are not converted', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/groups/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();
  await expect(page.getByText("You can change it later; amounts aren't converted.")).toBeVisible();
  await expect(page.getByText("can't be changed")).toHaveCount(0);

  const select = page.getByLabel('Currency', { exact: true });
  expect(await select.locator('option').allTextContents()).toEqual(['$', '€', '£', '¥', '₹', 'Rs', 'PKR', '₩', '₺', 'R$', 'CHF', 'AED', 'SAR', 'Other']);

  await page.getByLabel('Group name').fill('Warsaw trip');
  await select.selectOption({ label: 'Other' });
  await page.getByLabel('Currency symbol').fill('zł');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Warsaw trip' })).toBeVisible();
  await expect(page.getByText('Currency: zł')).toBeVisible();
  const { groups } = await api<{ groups: { name: string; currency: string }[] }>(page, 'get', '/groups');
  expect(groups.map((g) => [g.name, g.currency])).toEqual([['Warsaw trip', 'zł']]);
});

test('US-09 #3 a blank or 51-character group name shows "Group name must be 1–50 characters" and no group is created', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/groups/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();
  const message = 'Group name must be 1–50 characters';

  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(fieldError(page, message)).toBeVisible();

  await page.getByLabel('Group name').fill('x'.repeat(51));
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(fieldError(page, message)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();

  const { groups } = await api<{ groups: unknown[] }>(page, 'get', '/groups');
  expect(groups).toEqual([]);
});

test('US-09 #3 group names of exactly 1 and exactly 50 characters are accepted', async ({ page }, info) => {
  await signUpFast(page, info);
  const fifty = 'g'.repeat(50);
  for (const name of ['a', fifty]) {
    await page.goto('/groups/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();
    await page.getByLabel('Group name').fill(name);
    await page.getByRole('button', { name: 'Create group' }).click();
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  }
  const { groups } = await api<{ groups: { name: string }[] }>(page, 'get', '/groups');
  expect(groups.map((g) => g.name).sort()).toEqual(['a', fifty].sort());
});

// ---------- US-10 add friends ----------

test('US-10 #1 a newly added member is ticked on a new bill and can be chosen as payer', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Added', '$', []);
  await openGroup(page, groupId, 'Added', 'members');
  await page.getByLabel('Add a friend by name').fill('Omar');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status').getByText('Member added')).toBeVisible();

  await page.getByRole('link', { name: 'Add bill' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: /^Add bill to / })).toBeVisible();
  await expect(tookPart(page).getByRole('checkbox', { name: 'Omar', exact: true })).toBeChecked();
  await page.getByLabel('Who paid').selectOption({ label: 'Omar' });
  await page.getByLabel('Item 1 price').fill('12.00');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();

  const { group } = await api<{ group: { members: { id: string; name: string }[] } }>(page, 'get', `/groups/${groupId}`);
  const omarId = group.members.find((m) => m.name === 'Omar')?.id;
  const { bills } = await api<{ bills: { payerId: string; participantIds: string[] }[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(bills).toHaveLength(1);
  expect(bills[0].payerId).toBe(omarId);
  expect(bills[0].participantIds).toContain(omarId);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity').filter({ hasText: `${username} added Omar` })).toHaveCount(1);
});

test('US-10 #2 with 50 current members, adding another shows "A group can have at most 50 members" and adds nobody', async ({ page }, info) => {
  test.setTimeout(90_000);
  await signUpFast(page, info);
  const names = Array.from({ length: 49 }, (_, i) => `M${i + 1}`);
  const { groupId } = await makeGroup(page, 'Full house', '$', names);
  await openGroup(page, groupId, 'Full house', 'members');
  await expect(page.getByRole('heading', { name: 'Members (50)' })).toBeVisible();

  await page.getByLabel('Add a friend by name').fill('Extra');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(fieldError(page, 'A group can have at most 50 members')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members (50)' })).toBeVisible();
  await expect(page.getByText('Extra', { exact: true })).toHaveCount(0);
  const { group } = await api<{ group: { members: { name: string }[] } }>(page, 'get', `/groups/${groupId}`);
  expect(group.members).toHaveLength(50);
  expect(group.members.map((m) => m.name)).not.toContain('Extra');
});

// ---------- US-11 see and copy a person's own invite ----------

test('US-11 #1 each person who has not joined shows their own invite code and a "Copy link" button; people with an account show none', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Invites', '$', ['Omar', 'Sara']);
  await openGroup(page, groupId, 'Invites', 'members');

  const omarCode = page.getByTestId('invite-code-Omar');
  const saraCode = page.getByTestId('invite-code-Sara');
  await expect(omarCode).toHaveText(INVITE_CODE);
  await expect(saraCode).toHaveText(INVITE_CODE);
  expect(await omarCode.textContent()).not.toBe(await saraCode.textContent());
  await expect(memberRow(page, 'Omar')).toContainText(`Invite code ${await omarCode.textContent()}`);
  await expect(memberRow(page, 'Omar').getByRole('button', { name: 'Copy link for Omar' })).toBeVisible();
  await expect(memberRow(page, 'Sara').getByRole('button', { name: 'Copy link for Sara' })).toBeVisible();

  // I have an account, so there is nothing to send me, and the group has no code of its own any more.
  await expect(memberRow(page, username)).toBeVisible();
  await expect(memberRow(page, username)).not.toContainText('Invite code');
  await expect(page.getByRole('button', { name: /^Copy link for / })).toHaveCount(2);
  await expect(page.getByTestId('invite-code')).toHaveCount(0);
  const { group } = await api<{ group: Record<string, unknown> & { members: { name: string; inviteCode: string | null }[] } }>(
    page,
    'get',
    `/groups/${groupId}`,
  );
  expect(group).not.toHaveProperty('inviteCode');
  expect(group.members.map((m) => [m.name, m.inviteCode !== null])).toEqual([[username, false], ['Omar', true], ['Sara', true]]);
});

test('US-11 #1 right after adding Omar, a box offers his own invite link with the same code and a "Copy link" button', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Fresh add', '$', []);
  await openGroup(page, groupId, 'Fresh add', 'members');
  await page.getByLabel('Add a friend by name').fill('Omar');
  await page.getByRole('button', { name: 'Add member' }).click();

  const box = page.getByRole('region', { name: 'Invite Omar' });
  await expect(box).toBeVisible();
  await expect(box).toContainText('Omar was added. Send them their own invite link');
  const code = await inviteCodeOf(page, groupId, 'Omar');
  await expect(box.getByTestId('invite-code-Omar')).toHaveText(code);
  await expect(box.getByRole('button', { name: 'Copy link for Omar' })).toBeVisible();
  await expect(memberRow(page, 'Omar').getByTestId('invite-code-Omar')).toHaveText(code);
});

test('US-11 #1 where the device can share, each person also has a "Share invite for <name>" button that shares their link', async ({ page }, info) => {
  await page.addInitScript(() => {
    type Shared = { title?: string; text?: string; url?: string };
    const w = window as unknown as { __shared: Shared[] };
    w.__shared = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data: Shared) => {
        w.__shared.push(data);
        return Promise.resolve();
      },
    });
  });
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Sharing', '$', ['Omar', 'Sara']);
  const code = await inviteCodeOf(page, groupId, 'Omar');
  await openGroup(page, groupId, 'Sharing', 'members');
  await expect(page.getByRole('button', { name: /^Share invite for / })).toHaveCount(2);

  await memberRow(page, 'Omar').getByRole('button', { name: 'Share invite for Omar' }).click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: { text?: string; url?: string }[] }).__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].url).toBe(`${new URL(page.url()).origin}/invite/${code}`);
  expect(shared[0].text).toContain('Omar');
});

test('US-11 #1 where the device cannot share, there is no Share button, only the code and "Copy link"', async ({ page }, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'No sharing', '$', ['Omar']);
  await openGroup(page, groupId, 'No sharing', 'members');
  await expect(page.getByTestId('invite-code-Omar')).toHaveText(INVITE_CODE);
  await expect(page.getByRole('button', { name: 'Copy link for Omar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Share invite for / })).toHaveCount(0);
});

test("US-11 #2 \"Copy link\" copies Omar's link, ready to paste", async ({ page, context, browserName }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Copying', '$', ['Omar']);
  const code = await inviteCodeOf(page, groupId, 'Omar');
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openGroup(page, groupId, 'Copying', 'members');
  await page.getByRole('button', { name: 'Copy link for Omar' }).click();
  await expect(page.getByRole('button', { name: 'Copied for Omar' })).toBeVisible();
  // Only Chromium lets a test read the clipboard back.
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/invite/${code}`);
  }
});

test("US-11 #3 there is no way to regenerate or change a person's invite code: it stays the same", async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Stable', '$', ['Omar']);
  await openGroup(page, groupId, 'Stable', 'members');
  const shown = (await page.getByTestId('invite-code-Omar').textContent()) ?? '';
  expect(shown).toMatch(INVITE_CODE);
  await expect(page.getByRole('button', { name: /regenerate|new code|change code|reset code/i })).toHaveCount(0);

  // The same code after a reload, and after Omar is renamed.
  await page.reload();
  await expect(page.getByTestId('invite-code-Omar')).toHaveText(shown);
  await api(page, 'put', `/groups/${groupId}/members/${ids.Omar}`, { name: 'Omar K' });
  expect(await inviteCodeOf(page, groupId, 'Omar K')).toBe(shown);
});

// ---------- US-12 join with a personal invite ----------

test('US-12 #1 a signed-in friend opens their own invite and one click links the group, with its full history', async ({ browser }, info) => {
  const { owner, other, close } = await twoAccounts(browser, info);
  try {
    const { groupId, meId, ids } = await makeGroup(owner, 'Joiners', '$', ['Omar']);
    await postBill(owner, groupId, billBody([meId, ids.Omar], meId, ['20.00'], { name: 'Pizza night' }));

    await openInvite(other, await inviteCodeOf(owner, groupId, 'Omar'), 'Omar');
    await other.getByRole('button', { name: 'Join these groups' }).click();
    await expect(other.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(other.getByRole('status').getByText('You joined 1 group')).toBeVisible();

    // The group is in their list, under the name their friends used, with everything that happened so far.
    await other.goto('/groups');
    await expect(other.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
    await other.getByRole('link', { name: /Joiners/ }).click();
    await expect(other.getByRole('heading', { level: 1, name: 'Joiners', exact: true })).toBeVisible();
    await expect(balanceRow(other, 'Omar')).toContainText('(you)');
    await expect(other.getByRole('link', { name: /Pizza night/ })).toBeVisible();
    await other.getByRole('tab', { name: 'Activity' }).click();
    await expect(other.getByTestId('activity').first()).toHaveText(/^Omar joined with their invite/);
    await expect(other.getByTestId('activity')).toHaveCount(4);
  } finally {
    await close();
  }
});

test("US-12 #2 the invite page greets the person by name and lists only the groups they are in, never other names", async ({ browser }, info) => {
  const { owner, ownerName, close } = await twoAccounts(browser, info);
  const visitor = await loggedOutVisitor(browser);
  try {
    const beach = await makeGroup(owner, 'Beach trip', '$', ['Omar']);
    const flat = await makeGroup(owner, 'Flat share', '$', ['Sara']);
    await addFromOtherGroups(owner, flat.groupId, 'Omar');
    await makeGroup(owner, 'Not his', '$', ['Sara']);

    await openInvite(visitor.page, await inviteCodeOf(owner, beach.groupId, 'Omar'), 'Omar');
    await expect(visitor.page.getByText("You're in:")).toBeVisible();
    await expect(visitor.page.getByRole('listitem')).toHaveText(['Beach trip', 'Flat share']);
    // No other names: not the owner's, not Sara's, and no names to pick from.
    await expect(visitor.page.getByText('Sara')).toHaveCount(0);
    await expect(visitor.page.getByText(ownerName)).toHaveCount(0);
    await expect(visitor.page.getByText('Not his')).toHaveCount(0);
  } finally {
    await close();
    await visitor.context.close();
  }
});

test('US-12 #3 once used, the invite says "This invite has already been used" to everyone, and nobody else can take that place', async ({ browser }, info) => {
  const { owner, other, close } = await twoAccounts(browser, info);
  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  const visitor = await loggedOutVisitor(browser);
  try {
    await signUpFast(stranger, info, 'str');
    const { groupId } = await makeGroup(owner, 'Taken', '$', ['Omar']);
    const code = await inviteCodeOf(owner, groupId, 'Omar');
    await api(other, 'post', `/invites/${code}/accept`);

    for (const page of [stranger, visitor.page, owner]) {
      await page.goto(`/invite/${code}`);
      await expect(page.getByRole('alert')).toHaveText('This invite has already been used');
      await expect(page.getByRole('button', { name: /join/i })).toHaveCount(0);
    }
    // The stranger got nothing from it, not even by asking the server directly.
    await expect(api(stranger, 'post', `/invites/${code}/accept`)).rejects.toThrow('409');
    await expect(api(stranger, 'get', `/groups/${groupId}`)).rejects.toThrow('403');
    const { groups } = await api<{ groups: unknown[] }>(stranger, 'get', '/groups');
    expect(groups).toEqual([]);
  } finally {
    await close();
    await strangerCtx.close();
    await visitor.context.close();
  }
});

test("US-12 #4 an account already in one of the person's groups still joins the others, and that one group is skipped", async ({ browser }, info) => {
  const { owner, other, close } = await twoAccounts(browser, info);
  try {
    const groupA = await makeGroup(owner, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(owner, 'Group B', '$', []);
    await addFromOtherGroups(owner, groupB.groupId, 'Omar');
    // The second account is already in Group A, as Pat.
    await api(other, 'post', `/invites/${await inviteCodeOf(owner, groupA.groupId, 'Pat')}/accept`);

    await openInvite(other, await inviteCodeOf(owner, groupA.groupId, 'Omar'), 'Omar');
    // Not all of the groups are theirs yet, so this may be their invite: they can join, after
    // a warning that they're already in Group A, and a confirmation.
    await expect(other.getByText("You're already in Group A. If you're not Omar, don't join: send them this link instead.")).toBeVisible();
    await other.getByRole('button', { name: 'Join these groups' }).click();
    const confirm = other.getByRole('dialog', { name: 'Join as Omar?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Join as Omar' }).click();
    await expect(other.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    // The skipped group is reported.
    await expect(other.getByRole('status').getByText('You joined 1 group. You were already in Group A, so it was skipped.')).toBeVisible();

    // Group B is linked; in Group A they stay Pat.
    await openGroup(other, groupB.groupId, 'Group B');
    await expect(balanceRow(other, 'Omar')).toContainText('(you)');
    await openGroup(other, groupA.groupId, 'Group A');
    await expect(balanceRow(other, 'Pat')).toContainText('(you)');
    await expect(other.getByTestId('balance-row').filter({ hasText: '(you)' })).toHaveCount(1);
  } finally {
    await close();
  }
});

test('US-12 #5 the invite page has no list of names to pick from and no way to type a new name', async ({ browser }, info) => {
  const { owner, other, close } = await twoAccounts(browser, info);
  const visitor = await loggedOutVisitor(browser);
  try {
    const { groupId } = await makeGroup(owner, 'Closed list', '$', ['Omar', 'Sara']);
    const code = await inviteCodeOf(owner, groupId, 'Omar');

    // Logged out: only the two ways in, and a username and password for the account.
    await openInvite(visitor.page, code, 'Omar');
    await expect(visitor.page.getByRole('radio')).toHaveCount(2);
    await expect(visitor.page.getByRole('radio', { name: "I'm new here" })).toBeVisible();
    await expect(visitor.page.getByRole('radio', { name: 'I have an account' })).toBeVisible();
    await expect(visitor.page.getByRole('textbox')).toHaveCount(2);
    await expect(visitor.page.getByRole('textbox', { name: 'Username' })).toHaveCount(1);
    await expect(visitor.page.getByRole('textbox', { name: 'Password', exact: true })).toHaveCount(1);
    await expect(visitor.page.getByText(/Which name is you/)).toHaveCount(0);
    await expect(visitor.page.getByRole('radio', { name: /^I'm (Omar|Sara)/ })).toHaveCount(0);
    await expect(visitor.page.getByRole('button', { name: /add (me|myself|name)/i })).toHaveCount(0);

    // Logged in: a single button, nothing to pick or type.
    await openInvite(other, code, 'Omar');
    await expect(other.getByRole('button')).toHaveText(['Join these groups']);
    await expect(other.getByRole('textbox')).toHaveCount(0);
    await expect(other.getByRole('radio')).toHaveCount(0);
  } finally {
    await close();
    await visitor.context.close();
  }
});

test('US-12 #6 an invite also links a group the person was removed from, but they stay removed there until someone restores them', async ({ browser }, info) => {
  const { owner, other, close } = await twoAccounts(browser, info);
  try {
    const stillIn = await makeGroup(owner, 'Still in', '$', ['Omar']);
    const left = await makeGroup(owner, 'Left earlier', '$', []);
    await addFromOtherGroups(owner, left.groupId, 'Omar');
    const omarInLeft = await memberInfo(owner, left.groupId, 'Omar');
    await api(owner, 'post', `/groups/${left.groupId}/members/${omarInLeft.id}/remove`);

    // The invite lists only the group Omar is in now; joining links the other one quietly.
    await openInvite(other, await inviteCodeOf(owner, stillIn.groupId, 'Omar'), 'Omar');
    await expect(other.getByRole('listitem')).toHaveText(['Still in']);
    await other.getByRole('button', { name: 'Join these groups' }).click();
    await expect(other.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(other.getByRole('status').getByText('You joined 1 group')).toBeVisible();

    await other.goto(`/groups/${left.groupId}`);
    await expect(other.getByRole('alert')).toHaveText('You no longer have access to this group');
    await openGroup(other, stillIn.groupId, 'Still in');

    // Only Restore brings Omar back.
    await openGroup(owner, left.groupId, 'Left earlier', 'members');
    await expect(owner.getByText('Omar (removed)')).toBeVisible();
    await owner.getByRole('button', { name: 'Restore Omar' }).click();
    await expect(owner.getByRole('status').getByText('Member restored')).toBeVisible();
    await openGroup(other, left.groupId, 'Left earlier');
    await expect(balanceRow(other, 'Omar')).toContainText('(you)');
  } finally {
    await close();
  }
});

test('US-12 #7 a wrong code shows "Invite not found" with a clear message and joins nothing', async ({ page }, info) => {
  await signUpFast(page, info);
  await enterInviteCode(page, 'WRONGCODE');
  await expect(page.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText("That invite link isn't valid. Check the code and try again.");
  await expect(page.getByRole('button', { name: /join/i })).toHaveCount(0);
  const { groups } = await api<{ groups: unknown[] }>(page, 'get', '/groups');
  expect(groups).toEqual([]);
  await page.getByRole('link', { name: 'Go to Bill Splitter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('US-12 #8 a current member opening a friend\'s invite sees "This invite is for Omar" and no Join button, and nothing changes', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Already in', '$', ['Omar']);
  const code = await inviteCodeOf(page, groupId, 'Omar');
  const before = await api<{ group: { members: unknown[] } }>(page, 'get', `/groups/${groupId}`);

  await enterInviteCode(page, code);
  await expect(page.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeVisible();
  const note = page.getByRole('status').filter({ hasText: 'This invite is for Omar' });
  await expect(note).toHaveText(`You're already in this group as ${username}. This invite is for Omar: send them the link so they can join.`);
  await expect(page.getByRole('button', { name: 'Join these groups' })).toHaveCount(0);

  const after = await api<{ group: { members: unknown[] } }>(page, 'get', `/groups/${groupId}`);
  expect(after.group.members).toEqual(before.group.members);
  const { activity } = await api<{ activity: { message: string }[] }>(page, 'get', `/groups/${groupId}/activity`);
  expect(activity.filter((a) => /joined/.test(a.message))).toEqual([]);
  // The server refuses it as well, and the code is still Omar's.
  await expect(api(page, 'post', `/invites/${code}/accept`)).rejects.toThrow('409');
  expect(await inviteCodeOf(page, groupId, 'Omar')).toBe(code);
});

test('US-12 #9 after a wrong code, entering the right one works without reloading the page', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Second try', '$', ['Omar']);
  const code = await inviteCodeOf(page, groupId, 'Omar');
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
  // A marker that only survives while the page is not reloaded.
  await page.evaluate(() => {
    (window as unknown as { __kept: boolean }).__kept = true;
  });

  await page.getByRole('link', { name: 'Use an invite code' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await page.getByLabel('Invite code').fill('WRONGCODE');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();

  await page.getByRole('link', { name: 'Go to Bill Splitter' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await page.getByRole('link', { name: 'Use an invite code' }).click();
  await page.getByLabel('Invite code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
});

// ---------- US-13 equal-split bills ----------

test('US-13 #3 items 90.00 + 10% other charges between 3 people: "Other charges (10%)" $9.00, total $99.00, each $33.00', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Three', '$', ['Ali', 'Sara']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('90.00');
  await setCharge(page, 'Other charges (optional)', 'Percentage', '10');
  await calculate(page);
  await expect(totalsRow(page, 'Other charges (10%)')).toHaveText('$9.00');
  await expect(page.getByTestId('grand-total')).toHaveText('$99.00');
  await expect(shareAmounts(page)).toHaveText(['$33.00', '$33.00', '$33.00']);
});

test('US-13 #3 each results line shows the rate behind it: "Tax (5%)", "Other charges (10%)", "Tip (15% of items)", and "of items + tax" when chosen', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Rates', '$', ['Ali']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('100.00');
  await setCharge(page, 'Tax', 'Percentage', '5');
  await setCharge(page, 'Other charges (optional)', 'Percentage', '10');
  await setCharge(page, 'Tip', 'Percentage', '15');
  await calculate(page);
  await expect(totalsRow(page, 'Subtotal')).toHaveText('$100.00');
  await expect(totalsRow(page, 'Tax (5%)')).toHaveText('$5.00');
  await expect(totalsRow(page, 'Other charges (10%)')).toHaveText('$10.00');
  await expect(totalsRow(page, 'Tip (15% of items)')).toHaveText('$15.00');
  await expect(page.getByTestId('grand-total')).toHaveText('$130.00');

  // Tip on items + tax: 15% of 105.00 is 15.75.
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await calculate(page);
  await expect(totalsRow(page, 'Tip (15% of items + tax)')).toHaveText('$15.75');
  await expect(page.getByTestId('grand-total')).toHaveText('$130.75');
});

test('US-13 #3 charges entered as amounts show no rate on their results lines', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Plain amounts', '$', ['Ali']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('100.00');
  await setCharge(page, 'Tax', 'Amount', '5.00');
  await setCharge(page, 'Other charges (optional)', 'Amount', '10.00');
  await setCharge(page, 'Tip', 'Amount', '15.00');
  await calculate(page);
  await expect(totalsRow(page, 'Tax')).toHaveText('$5.00');
  await expect(totalsRow(page, 'Other charges')).toHaveText('$10.00');
  await expect(totalsRow(page, 'Tip')).toHaveText('$15.00');
  await expect(page.locator('dl.totals .rate')).toHaveCount(0);
  await expect(page.getByTestId('grand-total')).toHaveText('$130.00');
});

test('US-13 the tax, other-charges and tip boxes start empty and blank counts as 0; typing 5 shows "5", not "05"', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Blank boxes', '$', ['Ali']);
  await openNewBill(page, groupId);
  const box = (label: 'Tax' | 'Other charges (optional)' | 'Tip') => page.getByRole('group', { name: label, exact: true }).getByRole('textbox');
  for (const label of ['Tax', 'Other charges (optional)', 'Tip'] as const) await expect(box(label)).toHaveValue('');
  await expect(box('Tax')).toHaveAttribute('placeholder', '0');
  await expect(box('Tip')).toHaveAttribute('placeholder', '0');

  await box('Tax').pressSequentially('5');
  await expect(box('Tax')).toHaveValue('5');
  await box('Tax').fill('');

  // Left blank, they count as 0.
  await page.getByLabel('Item 1 price').fill('40.00');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$40.00');
  await expect(totalsRow(page, 'Subtotal')).toHaveText('$40.00');
  await expect(shareAmounts(page)).toHaveText(['$20.00', '$20.00']);
});

test('US-13 the "Save bill" button sits below the results, both before and after Calculate', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Save bar', '$', ['Ali']);
  await openNewBill(page, groupId);
  const results = page.getByRole('region', { name: 'Results' });
  const save = page.getByRole('button', { name: 'Save bill' });
  await expect(results).toContainText('Press Calculate to see results');
  expect((await pageEdges(save)).top).toBeGreaterThanOrEqual((await pageEdges(results)).bottom);

  await page.getByLabel('Item 1 price').fill('12.00');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$12.00');
  expect((await pageEdges(save)).top).toBeGreaterThanOrEqual((await pageEdges(results)).bottom);
});

test('US-13 #4 items 10.00 + 0.01 other charges between 2 people: total $10.01, shares $5.01 and $5.00', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Two', '$', ['Ali']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('10.00');
  await setCharge(page, 'Other charges (optional)', 'Amount', '0.01');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$10.01');
  await expect(shareAmounts(page)).toHaveText(['$5.01', '$5.00']);
});

test('US-13 #5 a grand total of 0.01 between 2 people gives shares $0.01 and $0.00', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Penny', '$', ['Ali']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('0.01');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$0.01');
  await expect(shareAmounts(page)).toHaveText(['$0.01', '$0.00']);
});

test('US-13 #6 items 1,000,000.00 + 100% tip between 50 people: "Tip (100% of items)", total $2,000,000.00, each share $40,000.00', async ({ page }, info) => {
  test.setTimeout(90_000);
  await signUpFast(page, info);
  const { groupId } = await makeGroup(
    page,
    'Fifty',
    '$',
    Array.from({ length: 49 }, (_, i) => `M${i + 1}`),
  );
  await openNewBill(page, groupId);
  await expect(tookPart(page).getByRole('checkbox')).toHaveCount(50);
  await page.getByLabel('Item 1 price').fill('1000000');
  await setCharge(page, 'Tip', 'Percentage', '100');
  await calculate(page);
  await expect(totalsRow(page, 'Subtotal')).toHaveText('$1,000,000.00');
  await expect(totalsRow(page, 'Tip (100% of items)')).toHaveText('$1,000,000.00');
  await expect(page.getByTestId('grand-total')).toHaveText('$2,000,000.00');
  await expect(shareAmounts(page)).toHaveText(Array<string>(50).fill('$40,000.00'));
});

test('US-13 #7 items 1,000,000.00 + 1,000,000.00 other charges between 3 people: shares $666,666.67 / $666,666.67 / $666,666.66', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Big three', '$', ['Ali', 'Sara']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('1000000');
  await setCharge(page, 'Other charges (optional)', 'Amount', '1000000');
  await calculate(page);
  await expect(totalsRow(page, 'Other charges')).toHaveText('$1,000,000.00');
  await expect(page.getByTestId('grand-total')).toHaveText('$2,000,000.00');
  await expect(shareAmounts(page)).toHaveText(['$666,666.67', '$666,666.67', '$666,666.66']);
});

test('US-13 #8 with nobody ticked, Calculate shows "Choose who took part" and no result', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Nobody', '$', ['Ali']);
  await openNewBill(page, groupId);
  await page.getByLabel('Item 1 price').fill('10');
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await tookPart(page).getByRole('checkbox', { name: 'Ali', exact: true }).uncheck();
  await expect(tookPart(page).getByRole('checkbox', { checked: true })).toHaveCount(0);
  await calculate(page);
  await expect(fieldError(page, 'Choose who took part')).toBeVisible();
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveCount(0);
  await expect(page.getByTestId('share')).toHaveCount(0);
});

// ---------- US-14 itemized bills ----------

test('US-14 #1 steak 40.00 (Ali) and salad 10.00 (Sara), tax 5.00, tip 10.00: Ali $52.00 and Sara $13.00 with their breakdown', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Dinner', '$', ['Ali', 'Sara']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await chooseItemized(page);
  await fillItems(page, [
    { price: '40.00', people: ['Ali'] },
    { price: '10.00', people: ['Sara'] },
  ]);
  await setCharge(page, 'Tax', 'Amount', '5.00');
  await setCharge(page, 'Tip', 'Amount', '10.00');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$65.00');
  await expect(shareNames(page)).toHaveText(['Ali', 'Sara']);
  await expect(shareAmounts(page)).toHaveText(['$52.00', '$13.00']);
  const shares = page.getByTestId('share');
  await expect(shares.nth(0)).toContainText(breakdown('$40.00', '$4.00', '$0.00', '$8.00'));
  await expect(shares.nth(1)).toContainText(breakdown('$10.00', '$1.00', '$0.00', '$2.00'));
});

test('US-14 #3 12.00 nachos ticked for Ali, Sara and Omar charges each $4.00 for the nachos', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Nachos', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await chooseItemized(page);
  await fillItems(page, [{ price: '12.00', people: ['Ali', 'Sara', 'Omar'] }]);
  await calculate(page);
  await expect(shareNames(page)).toHaveText(['Ali', 'Sara', 'Omar']);
  await expect(shareAmounts(page)).toHaveText(['$4.00', '$4.00', '$4.00']);
  const shares = page.getByTestId('share');
  for (let i = 0; i < 3; i += 1) await expect(shares.nth(i)).toContainText(breakdown('$4.00', '$0.00', '$0.00', '$0.00'));
});

test('US-14 #4 a 10.00 item shared by 3 people splits 3.34 / 3.33 / 3.33, extra cent to the first ticked person', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Shared dish', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await chooseItemized(page);
  await fillItems(page, [{ price: '10.00', people: ['Ali', 'Sara', 'Omar'] }]);
  await calculate(page);
  await expect(shareNames(page)).toHaveText(['Ali', 'Sara', 'Omar']);
  await expect(shareAmounts(page)).toHaveText(['$3.34', '$3.33', '$3.33']);
  const shares = page.getByTestId('share');
  await expect(shares.nth(0)).toContainText(breakdown('$3.34', '$0.00', '$0.00', '$0.00'));
  await expect(shares.nth(1)).toContainText(breakdown('$3.33', '$0.00', '$0.00', '$0.00'));
  await expect(shares.nth(2)).toContainText(breakdown('$3.33', '$0.00', '$0.00', '$0.00'));
});

test('US-14 #5 three people with 10.00 of items each and 0.10 other charges: other-charges parts 0.04 / 0.03 / 0.03', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Tie', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await chooseItemized(page);
  await fillItems(page, [
    { price: '10.00', people: ['Ali'] },
    { price: '10.00', people: ['Sara'] },
    { price: '10.00', people: ['Omar'] },
  ]);
  await setCharge(page, 'Other charges (optional)', 'Amount', '0.10');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$30.10');
  const shares = page.getByTestId('share');
  await expect(shares.nth(0)).toContainText(breakdown('$10.00', '$0.00', '$0.04', '$0.00'));
  await expect(shares.nth(1)).toContainText(breakdown('$10.00', '$0.00', '$0.03', '$0.00'));
  await expect(shares.nth(2)).toContainText(breakdown('$10.00', '$0.00', '$0.03', '$0.00'));
  await expect(shareAmounts(page)).toHaveText(['$10.04', '$10.03', '$10.03']);
});

test('US-14 #6 tax, other charges and tip are each split in proportion to items, leftover cents by largest remainder, and add up', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Proportions', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await chooseItemized(page);
  // Items 30.00 / 20.00 / 10.00 = 60.00, so the proportions are 1/2, 1/3 and 1/6.
  await fillItems(page, [
    { price: '30.00', people: ['Ali'] },
    { price: '20.00', people: ['Sara'] },
    { price: '10.00', people: ['Omar'] },
  ]);
  await setCharge(page, 'Tax', 'Amount', '0.10');
  await setCharge(page, 'Other charges (optional)', 'Amount', '0.07');
  await setCharge(page, 'Tip', 'Amount', '0.11');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$60.28');

  const shares = page.getByTestId('share');
  // Tax 10 cents -> 5 / 3 / 2 (Omar has the largest remainder); other charges 7 -> 4 / 2 / 1 (Ali); tip 11 -> 5 / 4 / 2.
  await expect(shares.nth(0)).toContainText(breakdown('$30.00', '$0.05', '$0.04', '$0.05'));
  await expect(shares.nth(1)).toContainText(breakdown('$20.00', '$0.03', '$0.02', '$0.04'));
  await expect(shares.nth(2)).toContainText(breakdown('$10.00', '$0.02', '$0.01', '$0.02'));
  const parts = await shareParts(page);
  const sum = (key: 'items' | 'tax' | 'other' | 'tip') => parts.reduce((s, p) => s + p[key], 0);
  expect([sum('items'), sum('tax'), sum('other'), sum('tip')]).toEqual([6000, 10, 7, 11]);
  await expect(shareAmounts(page)).toHaveText(['$30.14', '$20.09', '$10.05']);
});

test('US-14 #7 a person with no items owes $0.00 in every part even when the bill has 5.00 other charges', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'No items', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await chooseItemized(page);
  await fillItems(page, [
    { price: '10.00', people: ['Ali'] },
    { price: '10.00', people: ['Sara'] },
  ]);
  await setCharge(page, 'Tax', 'Amount', '2.00');
  await setCharge(page, 'Other charges (optional)', 'Amount', '5.00');
  await setCharge(page, 'Tip', 'Amount', '2.00');
  await calculate(page);
  await expect(page.getByTestId('grand-total')).toHaveText('$29.00');
  await expect(shareNames(page)).toHaveText(['Ali', 'Sara', 'Omar']);
  const omar = page.getByTestId('share').nth(2);
  await expect(omar).toContainText(breakdown('$0.00', '$0.00', '$0.00', '$0.00'));
  await expect(omar.locator('.share-amount')).toHaveText('$0.00');
  await expect(shareAmounts(page)).toHaveText(['$14.50', '$14.50', '$0.00']);
});

test('US-14 #8 an item with nobody ticked shows the error "Choose who shared this item" next to it after Calculate, and no result', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Nobody shared', '$', ['Ali']);
  await openNewBill(page, groupId);
  await chooseItemized(page);
  await page.getByLabel('Item 1 price').fill('10.00');

  // Before Calculate the dropdown button shows the same words as a placeholder, but there is no error text yet.
  await expect(pickerButton(page, 1)).toContainText('Choose who shared this item');
  await expect(fieldError(page, 'Choose who shared this item')).toHaveCount(0);

  await calculate(page);
  const row = page.locator('ol.items > li').first();
  await expect(row.locator('p.field-error')).toHaveText('Choose who shared this item');
  await expect(fieldError(page, 'Choose who shared this item')).toHaveCount(1);
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveCount(0);
});

test("US-14 #10 an item's dropdown lists exactly this bill's ticked people (including me) with tick boxes, and I can tick one or several", async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Dropdown', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await tookPart(page).getByRole('checkbox', { name: 'Omar', exact: true }).uncheck();
  await chooseItemized(page);
  await pickerButton(page, 1).click();
  const panel = page.locator('.picker-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('checkbox')).toHaveCount(3);
  expect(await panel.locator('label').allTextContents()).toEqual([username, 'Ali', 'Sara']);
  await expect(panel.getByRole('checkbox', { name: 'Omar' })).toHaveCount(0);
  await expect(panel.getByRole('checkbox', { checked: true })).toHaveCount(0);

  await panel.getByRole('checkbox', { name: 'Ali', exact: true }).check();
  await expect(panel.getByRole('checkbox', { checked: true })).toHaveCount(1);
  await panel.getByRole('checkbox', { name: 'Sara', exact: true }).check();
  await expect(panel.getByRole('checkbox', { checked: true })).toHaveCount(2);
});

test('US-14 #11 ticking Ali, Sara and Omar shows "Ali, Sara, Omar" on the closed dropdown button', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Names shown', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  await chooseItemized(page);
  await pickerButton(page, 1).click();
  const panel = page.locator('.picker-panel');
  for (const name of ['Ali', 'Sara', 'Omar']) await panel.getByRole('checkbox', { name, exact: true }).check();
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel).toHaveCount(0);
  await expect(pickerButton(page, 1)).toContainText('Ali, Sara, Omar');
  await expect(pickerButton(page, 1)).not.toContainText(username);
  await expect(pickerButton(page, 1)).not.toContainText('Choose who shared this item');
});

// ---------- US-15 who paid ----------

test('US-15 #1 "Who paid" offers only the ticked participants', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Payers', '$', ['Ali', 'Sara', 'Omar']);
  await openNewBill(page, groupId);
  const payer = page.getByLabel('Who paid');
  const offered = async () => (await payer.locator('option').allTextContents()).filter((t) => t !== 'Choose who paid');
  expect(await offered()).toEqual([username, 'Ali', 'Sara', 'Omar']);

  await tookPart(page).getByRole('checkbox', { name: username, exact: true }).uncheck();
  await tookPart(page).getByRole('checkbox', { name: 'Omar', exact: true }).uncheck();
  expect(await offered()).toEqual(['Ali', 'Sara']);

  await tookPart(page).getByRole('checkbox', { name: 'Omar', exact: true }).check();
  expect(await offered()).toEqual(['Ali', 'Sara', 'Omar']);
});

test('US-15 #5 a member removed through the API is not offered in "Who took part" or "Who paid" on a new bill', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Removed', '$', ['Omar', 'Ali']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await openNewBill(page, groupId);
  await expect(tookPart(page).getByRole('checkbox')).toHaveCount(2);
  await expect(tookPart(page).getByRole('checkbox', { name: 'Omar' })).toHaveCount(0);
  const offered = (await page.getByLabel('Who paid').locator('option').allTextContents()).filter((t) => t !== 'Choose who paid');
  expect(offered).toEqual([username, 'Ali']);
  await expect(page.getByText('Omar')).toHaveCount(0);
});

// ---------- US-16 balances and suggestions ----------

test('US-16 #4 when every balance is 0.00 no suggestions are shown', async ({ page }, info) => {
  await signUpFast(page, info);
  const fresh = await makeGroup(page, 'Fresh', '$', ['Ali']);
  await openGroup(page, fresh.groupId, 'Fresh');
  await expect(page.getByText('Everyone is settled up.')).toBeVisible();
  await expect(page.getByTestId('suggestion')).toHaveCount(0);

  // Also after money moved: a bill and an exact settle-up leave everything at zero.
  const { groupId, ids } = await makeGroup(page, 'Squared', '$', ['Ali', 'Sara']);
  await postAliSaraBill(page, groupId, ids);
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Sara, toId: ids.Ali, amount: '13.00' });
  await openGroup(page, groupId, 'Squared');
  await expect(page.getByText('Everyone is settled up.')).toBeVisible();
  await expect(page.getByTestId('suggestion')).toHaveCount(0);
  await expect(page.getByTestId('balance-row')).toHaveCount(3);
  for (const row of await page.getByTestId('balance-row').all()) {
    await expect(row).toContainText('$0.00');
    await expect(row).not.toContainText('owes');
    await expect(row).not.toContainText('is owed');
  }
});

test('US-16 #5 a removed member is absent from the balance rows and the suggestions (page)', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Leavers', '$', ['Omar', 'Ali', 'Sara']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await postAliSaraBill(page, groupId, ids);
  await openGroup(page, groupId, 'Leavers');

  const rows = page.getByTestId('balance-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Omar' })).toHaveCount(0);
  await expect(rows.filter({ hasText: username })).toHaveCount(1);
  await expect(balanceRow(page, 'Ali')).toContainText('+$13.00 is owed');
  await expect(balanceRow(page, 'Sara')).toContainText('−$13.00 owes');
  await expect(page.getByTestId('suggestion')).toHaveCount(1);
  await expect(page.getByTestId('suggestion')).toContainText('Sara pays Ali $13.00');
  await expect(page.getByTestId('suggestion')).not.toContainText('Omar');
  await expect(page.getByRole('region', { name: 'Balances' })).not.toContainText('Omar');
  await expect(page.getByRole('region', { name: 'Suggested payments' })).not.toContainText('Omar');

  // He is still listed, but only under Removed members.
  await page.getByRole('tab', { name: 'Members' }).click();
  await expect(page.getByText('Omar (removed)')).toBeVisible();
});

test('US-16 #6 balances and suggestions at the top, "Add bill" and "Edit group" visible, then the tabs Bills, Settle-ups, Members, Activity; invite codes and Removed members are on Members', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Layout', '$', ['Ali']);
  await openGroup(page, groupId, 'Layout');

  const balances = page.getByRole('region', { name: 'Balances' });
  const suggested = page.getByRole('region', { name: 'Suggested payments' });
  const addBill = page.getByRole('link', { name: 'Add bill' }).first();
  const editGroup = page.getByRole('link', { name: 'Edit group' });
  const tabList = page.getByRole('tablist', { name: 'Group sections' });
  await expect(balances).toBeInViewport();
  await expect(suggested).toBeInViewport();
  await expect(addBill).toBeVisible();
  await expect(addBill).toBeInViewport();
  await expect(editGroup).toBeVisible();
  await expect(editGroup).toBeInViewport();

  const box = async (l: Locator) => {
    const b = await l.boundingBox();
    if (!b) throw new Error('element has no box');
    return b;
  };
  const [bal, sug, add, edit, tabs] = [await box(balances), await box(suggested), await box(addBill), await box(editGroup), await box(tabList)];
  expect(bal.y + bal.height).toBeLessThanOrEqual(tabs.y);
  expect(sug.y + sug.height).toBeLessThanOrEqual(tabs.y);
  expect(add.y + add.height).toBeLessThanOrEqual(tabs.y);
  expect(edit.y + edit.height).toBeLessThanOrEqual(tabs.y);

  const tabNodes = page.getByRole('tab');
  expect(await tabNodes.allTextContents()).toEqual(['Bills', 'Settle-ups', 'Members', 'Activity']);
  let lastX = -1;
  for (const tab of await tabNodes.all()) {
    const b = await box(tab);
    expect(b.y).toBeGreaterThanOrEqual(bal.y + bal.height);
    expect(b.x).toBeGreaterThan(lastX);
    lastX = b.x;
  }

  // The invite codes and Removed members are not on the page until the Members tab is opened.
  await expect(page.getByTestId('invite-code-Ali')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Removed members' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Members' }).click();
  await expect(page.getByTestId('invite-code-Ali')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Removed members' })).toBeVisible();
});

test('US-16 #7 "Record this payment" opens Sara -> Ali, 13.00 pre-filled and saves nothing until "Record payment"', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Prefill', '$', ['Ali', 'Sara']);
  await postAliSaraBill(page, groupId, ids);
  await openGroup(page, groupId, 'Prefill');
  await expect(page.getByTestId('suggestion')).toContainText('Sara pays Ali $13.00');
  await page.getByRole('link', { name: 'Record this payment' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();

  await expect(page.getByLabel('Who paid').locator('option:checked')).toHaveText('Sara');
  await expect(page.getByLabel('Who received it').locator('option:checked')).toHaveText('Ali');
  await expect(page.getByLabel('Amount ($)')).toHaveValue('13.00');

  // Nothing is saved yet.
  const before = await api<{ settleUps: unknown[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  expect(before.settleUps).toHaveLength(0);
  const detail = await api<{ group: { members: { name: string; balanceCents: number }[] } }>(page, 'get', `/groups/${groupId}`);
  expect(detail.group.members.find((m) => m.name === 'Sara')?.balanceCents).toBe(-1300);

  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status').getByText('Payment recorded')).toBeVisible();
  const after = await api<{ settleUps: { amountCents: number }[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  expect(after.settleUps.map((s) => s.amountCents)).toEqual([1300]);
});

// ---------- US-17 settle-ups ----------

async function openSettleForm(page: Page, groupId: string): Promise<void> {
  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
}

test('US-17 #1 "Sara paid Ali 13.00" clears both balances and the suggestion disappears', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Clear', '$', ['Ali', 'Sara']);
  await postAliSaraBill(page, groupId, ids);
  await openGroup(page, groupId, 'Clear');
  await expect(page.getByTestId('suggestion')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Settle-ups' }).click();
  await page.getByRole('link', { name: 'Record a payment' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  await page.getByLabel('Who paid').selectOption({ label: 'Sara' });
  await page.getByLabel('Who received it').selectOption({ label: 'Ali' });
  await page.getByLabel('Amount ($)').fill('13.00');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status').getByText('Payment recorded')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Clear', exact: true })).toBeVisible();

  await expect(balanceRow(page, 'Ali')).toContainText('$0.00');
  await expect(balanceRow(page, 'Sara')).toContainText('$0.00');
  await expect(balanceRow(page, 'Ali')).not.toContainText('is owed');
  await expect(balanceRow(page, 'Sara')).not.toContainText('owes');
  await expect(page.getByTestId('suggestion')).toHaveCount(0);
  await expect(page.getByText('Everyone is settled up.')).toBeVisible();
});

test('US-17 #3 a settle-up from a member to themselves shows "Choose two different people" and saves nothing', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Same', '$', ['Ali', 'Sara']);
  await openSettleForm(page, groupId);
  await page.getByLabel('Who paid').selectOption({ label: 'Sara' });
  await page.getByLabel('Who received it').selectOption({ label: 'Sara' });
  await page.getByLabel('Amount ($)').fill('5');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(fieldError(page, 'Choose two different people')).toBeVisible();
  const { settleUps } = await api<{ settleUps: unknown[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  expect(settleUps).toEqual([]);
});

test('US-17 #4 amounts "0", "abc", "1.234" and blank show the amount message and save nothing', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Bad amounts', '$', ['Ali', 'Sara']);
  const message = 'Amount must be between 0.01 and 1,000,000.00, with at most 2 decimal places';
  for (const amount of ['0', 'abc', '1.234', '']) {
    // A fresh form each time, so the message is proved for this value alone.
    await openSettleForm(page, groupId);
    await page.getByLabel('Who paid').selectOption({ label: 'Sara' });
    await page.getByLabel('Who received it').selectOption({ label: 'Ali' });
    await page.getByLabel('Amount ($)').fill(amount);
    await expect(fieldError(page, message)).toHaveCount(0);
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(fieldError(page, message), `amount "${amount}"`).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  }
  const { settleUps } = await api<{ settleUps: unknown[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  expect(settleUps).toEqual([]);
});

test('US-17 #5 a removed member is not offered as either person in a new settle-up', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Gone', '$', ['Omar', 'Ali']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await openSettleForm(page, groupId);
  for (const label of ['Who paid', 'Who received it']) {
    const offered = (await page.getByLabel(label).locator('option').allTextContents()).filter((t) => t !== 'Choose a member');
    expect(offered, label).toEqual([username, 'Ali']);
  }
});

// ---------- US-18 editing and deleting ----------

test('US-18 #3 a saved bill with 10% other charges reopens as 10 with "Percentage" checked; changing it to 20% updates the balances', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Edits', '$', ['Ali']);
  await postBill(
    page,
    groupId,
    billBody([meId, ids.Ali], meId, ['100.00'], { name: 'Lunch', otherCharges: { mode: 'percent', value: '10' } }),
  );
  await openGroup(page, groupId, 'Edits');
  await expect(balanceRow(page, 'Ali')).toContainText('−$55.00 owes');

  await page.getByRole('link', { name: /Lunch/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Lunch' })).toBeVisible();
  const other = page.getByRole('group', { name: 'Other charges (optional)', exact: true });
  await expect(other.getByRole('textbox')).toHaveValue('10');
  await expect(other.getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(other.getByRole('radio', { name: 'Amount' })).not.toBeChecked();

  await other.getByRole('textbox').fill('20');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Edits', exact: true })).toBeVisible();
  await expect(balanceRow(page, 'Ali')).toContainText('−$60.00 owes');

  // Reopened again it shows the new saved value.
  await page.getByRole('link', { name: /Lunch/ }).click();
  await expect(page.getByRole('group', { name: 'Other charges (optional)', exact: true }).getByRole('textbox')).toHaveValue('20');
  await expect(page.getByRole('group', { name: 'Other charges (optional)', exact: true }).getByRole('radio', { name: 'Percentage' })).toBeChecked();
});

test('US-18 #4 Delete on a group bill asks first; Cancel keeps it; "Delete bill" removes it and updates the balances', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Deletes', '$', ['Ali']);
  const billId = await postBill(page, groupId, billBody([meId, ids.Ali], meId, ['40.00'], { name: 'Dinner' }));
  await openGroup(page, groupId, 'Deletes');
  await expect(balanceRow(page, 'Ali')).toContainText('−$20.00 owes');

  await page.getByRole('link', { name: /Dinner/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Delete this bill?' });
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeVisible();

  // Cancel keeps the bill.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
  const kept = await api<{ bills: { id: string }[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(kept.bills.map((b) => b.id)).toEqual([billId]);

  // Confirm removes it and updates the balances.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete bill' }).click();
  await expect(page.getByRole('status').getByText('Bill deleted')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Deletes', exact: true })).toBeVisible();
  await expect(page.getByText('No bills yet. Add the first bill you shared.')).toBeVisible();
  await expect(balanceRow(page, 'Ali')).toContainText('$0.00');
  await expect(balanceRow(page, 'Ali')).not.toContainText('owes');
  const gone = await api<{ bills: unknown[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(gone.bills).toEqual([]);
});

// ---------- US-19 activity log ----------

test('US-19 #4 every activity entry shows who made the change and a time', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Log', '$', ['Omar']);
  await postBill(page, groupId, billBody([meId, ids.Omar], meId, ['20.00'], { name: 'Pizza night' }));
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Omar, toId: meId, amount: '10.00' });
  await openGroup(page, groupId, 'Log', 'activity');

  const entries = page.getByTestId('activity');
  await expect(entries).toHaveCount(4);
  for (const entry of await entries.all()) {
    await expect(entry).toContainText(username);
    const time = entry.locator('time');
    await expect(time).toHaveCount(1);
    await expect(time).toHaveText(/\d{4}/);
    const stamp = await time.getAttribute('datetime');
    expect(Number.isNaN(Date.parse(stamp ?? ''))).toBe(false);
  }
  await expect(entries).toContainText([
    `${username} recorded a payment: Omar paid ${username} 10.00`,
    `${username} added 'Pizza night' (20.00)`,
    `${username} added Omar`,
    `${username} created the group`,
  ]);
});

test('US-19 #5 a member who joined with their personal invite can open the Activity tab and sees every entry, including "X created the group"', async ({ browser }, info) => {
  const { owner, other, ownerName, close } = await twoAccounts(browser, info);
  try {
    const { groupId, meId, ids } = await makeGroup(owner, 'Shared log', '$', ['Omar']);
    await postBill(owner, groupId, billBody([meId, ids.Omar], meId, ['20.00'], { name: 'Pizza night' }));

    await openInvite(other, await inviteCodeOf(owner, groupId, 'Omar'), 'Omar');
    await other.getByRole('button', { name: 'Join these groups' }).click();
    await expect(other.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    await openGroup(other, groupId, 'Shared log', 'activity');
    const entries = other.getByTestId('activity');
    await expect(entries).toHaveCount(4);
    await expect(entries).toContainText([
      'Omar joined with their invite',
      `${ownerName} added 'Pizza night' (20.00)`,
      `${ownerName} added Omar`,
      `${ownerName} created the group`,
    ]);
    await expect(entries.locator('time')).toHaveCount(4);
  } finally {
    await close();
  }
});
