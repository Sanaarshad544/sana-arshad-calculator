import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD, api, makeGroup, signUpFast } from './helpers.js';

// Changes made after the security and code reviews of QA round 1: who can see an
// invite, when it changes, and smaller fixes found in review. Every person is a
// separate browser context (own cookies).

const NAME_USED = 'That name has already been used in this group';
const INVITE_INVALID = "That invite link isn't valid. Check the code and try again.";

interface MemberInfo {
  id: string;
  name: string;
  inviteCode: string | null;
}

async function memberOf(page: Page, groupId: string, name: string): Promise<MemberInfo> {
  const { group } = await api<{ group: { members: MemberInfo[] } }>(page, 'get', `/groups/${groupId}`);
  const member = group.members.find((m) => m.name === name);
  if (!member) throw new Error(`"${name}" is not a member of group ${groupId}`);
  return member;
}

async function inviteCodeOf(page: Page, groupId: string, name: string): Promise<string> {
  const { inviteCode } = await memberOf(page, groupId, name);
  if (!inviteCode) throw new Error(`"${name}" has no invite code`);
  return inviteCode;
}

async function addFromOtherGroups(page: Page, groupId: string, name: string): Promise<void> {
  const { people } = await api<{ people: { key: string; name: string }[] }>(page, 'get', `/people?groupId=${groupId}`);
  const person = people.find((p) => p.name === name);
  if (!person) throw new Error(`"${name}" is not among the people in my other groups`);
  await api(page, 'post', `/groups/${groupId}/members`, { personKey: person.key });
}

async function openMembers(page: Page, groupId: string, name: string): Promise<void> {
  await page.goto(`/groups/${groupId}?tab=members`);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/** One person's row on the Members tab (not the "Invite <name>" box). */
const memberRow = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Rename ${name}`, exact: true }) });

/** A second person, logged in, in their own browser context. */
async function newPerson(browser: Browser, opened: BrowserContext[], info: TestInfo, prefix: string) {
  const context = await browser.newContext();
  opened.push(context);
  const page = await context.newPage();
  const username = await signUpFast(page, info, prefix);
  return { page, username };
}

async function closeAll(opened: BrowserContext[]): Promise<void> {
  for (const context of opened) await context.close();
}

test("US-11 #6 a member who isn't in all of Omar's groups sees no code for him, only who can send it", async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const dinner = await makeGroup(page, 'Dinner', '$', ['Omar', 'Sara']);
    const trip = await makeGroup(page, 'Trip', '$', []);
    await addFromOtherGroups(page, trip.groupId, 'Omar');
    const sara = await newPerson(browser, opened, info, 'sara');
    await api(sara.page, 'post', `/invites/${await inviteCodeOf(page, dinner.groupId, 'Sara')}/accept`);

    // Sara is in Dinner but not in Trip, so Omar's code would let her into Trip.
    await openMembers(sara.page, dinner.groupId, 'Dinner');
    const row = memberRow(sara.page, 'Omar');
    await expect(row).toContainText("Only someone who's in all of Omar's groups can send their invite.");
    await expect(row).not.toContainText('Invite code');
    await expect(sara.page.getByRole('button', { name: 'Copy link for Omar' })).toHaveCount(0);

    // The owner is in both groups and can send it.
    await openMembers(page, dinner.groupId, 'Dinner');
    await expect(memberRow(page, 'Omar').getByRole('button', { name: 'Copy link for Omar' })).toBeVisible();
    await expect(memberRow(page, 'Omar')).not.toContainText('Only someone');
  } finally {
    await closeAll(opened);
  }
});

test("US-11 #2 when the browser can't copy, Omar's link is shown in a box to copy by hand", async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'No clipboard', '$', ['Omar']);
  const code = await inviteCodeOf(page, groupId, 'Omar');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('not allowed')) }, configurable: true });
  });
  await openMembers(page, groupId, 'No clipboard');
  await page.getByRole('button', { name: 'Copy link for Omar' }).click();
  const box = page.getByRole('textbox', { name: 'Invite link for Omar' });
  await expect(box).toHaveValue(`${new URL(page.url()).origin}/invite/${code}`);
  await expect(box).toHaveAttribute('readonly', '');
  await expect(page.getByText("Copying didn't work here. Select the link and copy it.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link for Omar' })).toHaveText('Copy link for Omar');
});

test('US-11 #7 when someone with an account is removed, the old invite link stops working and a new code is shown', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const { groupId } = await makeGroup(page, 'Flat', '$', ['Omar', 'Sara']);
    const sara = await newPerson(browser, opened, info, 'sara');
    await api(sara.page, 'post', `/invites/${await inviteCodeOf(page, groupId, 'Sara')}/accept`);
    const old = await inviteCodeOf(sara.page, groupId, 'Omar');

    await openMembers(page, groupId, 'Flat');
    await page.getByRole('button', { name: 'Remove Sara' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove member' }).click();
    await expect(page.getByRole('status').getByText('Member removed')).toBeVisible();
    // The page shows Omar's new code once it has reloaded.
    const shown = memberRow(page, 'Omar').getByTestId('invite-code-Omar');
    await expect(shown).not.toHaveText(old);
    const fresh = (await shown.textContent()) ?? '';
    expect(fresh).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    // Sara's copy of the old link no longer opens anything, even from a new account.
    const strangerContext = await browser.newContext();
    opened.push(strangerContext);
    const visitor = await strangerContext.newPage();
    await visitor.goto(`/invite/${old}`);
    await expect(visitor.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
    await expect(visitor.getByRole('alert')).toHaveText(INVITE_INVALID);
    await visitor.goto(`/invite/${fresh}`);
    await expect(visitor.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

test("US-41 #2 adding Omar to a group: the box says whether his link stays the same or changed", async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    // Only the owner could see Zed's code, and the owner is in the new group: it stays the same.
    const club = await makeGroup(page, 'Club', '$', ['Zed']);
    const sent = await inviteCodeOf(page, club.groupId, 'Zed');
    const books = await makeGroup(page, 'Books', '$', []);
    await openMembers(page, books.groupId, 'Books');
    await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Zed (Club)' });
    await page.getByRole('button', { name: 'Add to group' }).click();
    const zedBox = page.getByRole('region', { name: 'Invite Zed' });
    await expect(zedBox).toContainText('Zed was added. Their invite link now covers this group too.');
    await expect(zedBox.getByTestId('invite-code-Zed')).toHaveText(sent);

    // Sara can see Omar's code in Dinner but isn't in Trip: adding Omar to Trip changes it.
    const dinner = await makeGroup(page, 'Dinner', '$', ['Omar', 'Sara']);
    const sara = await newPerson(browser, opened, info, 'sara');
    await api(sara.page, 'post', `/invites/${await inviteCodeOf(page, dinner.groupId, 'Sara')}/accept`);
    const old = await inviteCodeOf(sara.page, dinner.groupId, 'Omar');
    const trip = await makeGroup(page, 'Trip', '$', []);
    await openMembers(page, trip.groupId, 'Trip');
    await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Omar (Dinner)' });
    await page.getByRole('button', { name: 'Add to group' }).click();
    const omarBox = page.getByRole('region', { name: 'Invite Omar' });
    await expect(omarBox).toContainText("Omar was added. Their invite link has changed, so send them this new one. It links every group they're in at once.");
    const fresh = (await omarBox.getByTestId('invite-code-Omar').textContent()) ?? '';
    expect(fresh).not.toBe(old);
    expect(await inviteCodeOf(page, dinner.groupId, 'Omar')).toBe(fresh);
  } finally {
    await closeAll(opened);
  }
});

test('US-41 #4 when their name is taken here, a "Name in this group" box lets me add them under another name', async ({ page }, info) => {
  await signUpFast(page, info);
  const flat = await makeGroup(page, 'Flat', '$', ['Omar']);
  const club = await makeGroup(page, 'Club', '$', ['Omar']);
  await openMembers(page, club.groupId, 'Club');
  await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Omar (Flat)' });
  await page.getByRole('button', { name: 'Add to group' }).click();

  const name = page.getByRole('textbox', { name: 'Name in this group' });
  await expect(name).toHaveValue('Omar');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(NAME_USED)).toBeVisible();
  await name.fill('Omar F');
  await expect(page.getByText(NAME_USED)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to group' }).click();
  await expect(page.getByRole('status').getByText('Member added')).toBeVisible();
  await expect(memberRow(page, 'Omar F')).toBeVisible();
  // The same person: one code in both groups.
  expect(await inviteCodeOf(page, club.groupId, 'Omar F')).toBe(await inviteCodeOf(page, flat.groupId, 'Omar'));
  await expect(page.getByRole('textbox', { name: 'Name in this group' })).toHaveCount(0);
});

test('US-40 #6 the rename box closes with Esc, Cancel or Save name, and the cursor goes back to Rename', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Names', '$', ['omar']);
  await openMembers(page, groupId, 'Names');

  await page.getByRole('button', { name: 'Rename omar' }).click();
  const box = page.getByRole('textbox', { name: 'New name for omar' });
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rename omar' })).toBeFocused();

  await page.getByRole('button', { name: 'Rename omar' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Rename omar' })).toBeFocused();

  await page.getByRole('button', { name: 'Rename omar' }).click();
  await page.getByRole('textbox', { name: 'New name for omar' }).fill('Omar');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').getByText('Name changed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Omar', exact: true })).toBeFocused();
});

test('US-12 #8 "Use an invite code" takes the code with spaces or dashes, or the whole pasted link, and explains bad characters', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const { groupId } = await makeGroup(page, 'Codes', '$', ['Omar']);
    const code = await inviteCodeOf(page, groupId, 'Omar');
    const friend = await newPerson(browser, opened, info, 'fr');
    const heading = friend.page.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" });

    await friend.page.goto('/join');
    await friend.page.getByLabel('Invite code').fill(`${new URL(friend.page.url()).origin}/invite/${code.toLowerCase()}`);
    await friend.page.getByRole('button', { name: 'Continue' }).click();
    await expect(heading).toBeVisible();

    await friend.page.goto('/join');
    await friend.page.getByLabel('Invite code').fill(`${code.slice(0, 4)}-${code.slice(4, 8)} ${code.slice(8)}`);
    await friend.page.getByRole('button', { name: 'Continue' }).click();
    await expect(heading).toBeVisible();

    await friend.page.goto('/join');
    const field = friend.page.getByLabel('Invite code');
    await field.fill('abc/def?');
    await friend.page.getByRole('button', { name: 'Continue' }).click();
    await expect(friend.page.getByText('Invite codes have only letters and numbers. Check the code and try again.')).toBeVisible();
    await expect(friend.page).toHaveURL(/\/join$/);
    await field.fill(code);
    await expect(friend.page.getByText('Invite codes have only letters and numbers.')).toHaveCount(0);
  } finally {
    await closeAll(opened);
  }
});

test('US-12 #7 a group skipped because I was already in it shows the invited name as "already here as" me', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, 'Omar');
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const result = await api<{ result: { joined: string[]; alreadyIn: string[] } }>(
      pat.page,
      'post',
      `/invites/${await inviteCodeOf(page, groupA.groupId, 'Omar')}/accept`,
    );
    expect(result.result).toMatchObject({ joined: ['Group B'], alreadyIn: ['Group A'] });

    await openMembers(page, groupA.groupId, 'Group A');
    await expect(memberRow(page, 'Omar')).toContainText('already here as Pat');
    await expect(memberRow(page, 'Omar')).not.toContainText('Invite code');
    await expect(memberRow(page, 'Omar')).not.toContainText('not joined yet');
  } finally {
    await closeAll(opened);
  }
});

test('US-26 #11 when the server rejects a field on Save, the message shows above Save and the cursor moves to that field', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await page.getByLabel('Item 1 price').fill('10');
  await page.route('**/api/solo-bills', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Please fix the highlighted fields', fields: { 'items.0.price': 'Price must be between 0.01 and 1,000,000.00' } } }),
    }),
  );
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByLabel('Item 1 price')).toBeFocused();
  await expect(page.getByText('Price must be between 0.01 and 1,000,000.00')).toBeVisible();
  const alert = page.locator('.save-bar').getByRole('alert');
  await expect(alert).toHaveText('Please fix the highlighted fields');
});

test('US-26 #11 on a group bill, when the server rejects who shared an item on Save, the message shows under that item\'s chips, the page message sits above Save, and the cursor moves to its first chip', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Rejected', '$', ['Ali']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Rejected' })).toBeVisible();
  await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
  await page.getByLabel('Item 1 price').fill('10');
  const chips = page.getByRole('group', { name: 'Who shared item 1', exact: true });
  await chips.getByRole('checkbox', { name: 'Ali', exact: true }).check();
  await page.route('**/api/groups/*/bills', (route) =>
    route.request().method() !== 'POST'
      ? route.continue()
      : route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Please fix the highlighted fields', fields: { 'items.0.sharers': 'Choose who shared this item' } } }),
        }),
  );
  await page.getByRole('button', { name: 'Save bill' }).click();

  // The field's message is under its chips, and the cursor is on the first of them.
  await expect(chips.getByText('Choose who shared this item')).toBeVisible();
  await expect(chips.getByRole('checkbox').first()).toBeFocused();
  for (const box of await chips.getByRole('checkbox').all()) await expect(box).toHaveAttribute('aria-invalid', 'true');
  // The page's message sits just above the Save button.
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Please fix the highlighted fields');
  const [alertEdges, saveEdges] = await edgesOf(page, [alert, page.getByRole('button', { name: 'Save bill' })]);
  expect(alertEdges.bottom).toBeLessThan(saveEdges.top + 1);
  // Nothing was saved, and the form is still there.
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/bills/new$`));
  await page.unroute('**/api/groups/*/bills');
  const { bills } = await api<{ bills: unknown[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(bills).toEqual([]);
});

/** A saved bill that `member` paid for, after they were removed (their balance was 0.00, so they could be). */
async function billOfRemovedMember(page: Page, groupName: string, member = 'Omar'): Promise<{ groupId: string; billId: string; memberId: string }> {
  const { groupId, ids } = await makeGroup(page, groupName, '$', [member]);
  // They pay for only themselves, so their balance is 0.00.
  const { billId } = await api<{ billId: string }>(page, 'post', `/groups/${groupId}/bills`, {
    bill: {
      name: `${member} snack`.slice(0, 60),
      items: [{ name: '', price: '5' }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds: [ids[member]],
      payerId: ids[member],
    },
  });
  await api(page, 'post', `/groups/${groupId}/members/${ids[member]}/remove`);
  return { groupId, billId, memberId: ids[member] };
}

/** The top and bottom edge of each element, measured in the same instant so a scroll can't skew them. */
async function edgesOf(page: Page, targets: Locator[]): Promise<{ top: number; bottom: number }[]> {
  const handles = await Promise.all(targets.map((target) => target.elementHandle()));
  try {
    return await page.evaluate(
      (elements) =>
        elements.map((el) => {
          if (!el) throw new Error('element not found on the page');
          const box = el.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom };
        }),
      handles,
    );
  } finally {
    await Promise.all(handles.map((handle) => handle?.dispose()));
  }
}

test('US-18 #5 the "Restore Omar to change this bill" message for Delete shows at the top, next to Delete', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, billId } = await billOfRemovedMember(page, 'Locked');
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Omar snack' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Restore Omar to change this bill' });
  await expect(alert).toBeVisible();
  // Straight under the Delete button, before anything of the bill itself: its summary line, then the receipt.
  const summary = page.getByText(/^Omar \(removed\) paid on /);
  const receipt = page.getByRole('region', { name: 'Bill', exact: true });
  const [alertEdges, summaryEdges, receiptEdges, deleteEdges] = await edgesOf(page, [alert, summary, receipt, page.getByRole('button', { name: 'Delete', exact: true })]);
  expect(alertEdges.top).toBeGreaterThan(deleteEdges.bottom - 1);
  expect(alertEdges.bottom).toBeLessThan(summaryEdges.top + 1);
  expect(summaryEdges.bottom).toBeLessThan(receiptEdges.top + 1);
});

test('US-18 #5 a bill with a removed member has no "Edit bill" button, its edit address shows the bill read-only, and Delete changes nothing', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, billId, memberId: omarId } = await billOfRemovedMember(page, 'View only');

  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Omar snack' })).toBeVisible();
  await expect(page.getByText('Omar was removed from the group, so this bill is view only. Restore Omar on the Members tab to change it.')).toBeVisible();
  await expect(page.getByText(/^Omar \(removed\) paid on /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit bill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  // Typing the edit address does not open the form: it shows the read-only bill again.
  await page.goto(`/groups/${groupId}/bills/${billId}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Omar snack', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/bills/${billId}$`));
  await expect(page.getByRole('main').getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save bill' })).toHaveCount(0);

  // Delete only explains what to do. Nothing is asked, deleted or changed.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Restore Omar to change this bill');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const { bills } = await api<{ bills: { id: string; name: string; totalCents: number }[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(bills.map((b) => [b.id, b.name, b.totalCents])).toEqual([[billId, 'Omar snack', 500]]);

  // The same bill is back to normal once Omar is restored.
  await api(page, 'post', `/groups/${groupId}/members/${omarId}/restore`);
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(page.getByRole('link', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByText('so this bill is view only')).toHaveCount(0);
});

test('US-34 #3 on a phone 360 px wide, the view-only bill of a removed member with the longest name (30 characters, no spaces) and its "Restore … to change this bill" message do not scroll sideways', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.setViewportSize({ width: 360, height: 780 });
  const longName = 'W'.repeat(30);
  const { groupId, billId } = await billOfRemovedMember(page, 'Locked and long', longName);
  const fits = async (where: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  };

  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(page.getByRole('heading', { level: 1, name: `${longName} snack` })).toBeVisible();
  await expect(page.getByText(`${longName} was removed from the group, so this bill is view only.`)).toBeVisible();
  await fits('the view-only bill');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(`Restore ${longName} to change this bill`);
  await fits('the view-only bill with its Delete message');
});

/** A payment from Omar to me, after Omar was removed (it cleared what he owed me, so his balance was 0.00). */
async function paymentOfRemovedOmar(page: Page, groupName: string): Promise<{ groupId: string; settleId: string }> {
  const { groupId, meId, ids } = await makeGroup(page, groupName, '$', ['Omar']);
  await api(page, 'post', `/groups/${groupId}/bills`, {
    bill: {
      name: 'Snack',
      items: [{ name: '', price: '10' }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds: [meId, ids.Omar],
      payerId: meId,
    },
  });
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: ids.Omar, toId: meId, amount: '5' });
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  const { settleUps } = await api<{ settleUps: { id: string }[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  return { groupId, settleId: settleUps[0].id };
}

test('US-18 #5 a payment with a removed member is view only too: Delete and "Save payment" show "Restore Omar to change this bill" near the top and change nothing', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, settleId } = await paymentOfRemovedOmar(page, 'Locked payment');
  await page.goto(`/groups/${groupId}/settle-ups/${settleId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Payment' })).toBeVisible();
  await expect(page.getByText('Omar was removed from the group, so this payment is view only. Restore Omar on the Members tab to change it.')).toBeVisible();
  for (const field of ['Who paid', 'Who received it', 'Amount ($)']) await expect(page.getByLabel(field), field).toBeDisabled();

  // Delete explains what to do, under the Delete button and above the fields, and asks nothing.
  const deleteButton = page.getByRole('button', { name: 'Delete', exact: true });
  await deleteButton.click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Restore Omar to change this bill');
  const [alertEdges, deleteEdges, firstFieldEdges] = await edgesOf(page, [alert, deleteButton, page.getByLabel('Who paid')]);
  expect(alertEdges.top).toBeGreaterThan(deleteEdges.bottom - 1);
  expect(alertEdges.bottom).toBeLessThan(firstFieldEdges.top + 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Trying to save says the same. Nothing is deleted or changed.
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(alert).toHaveText('Restore Omar to change this bill');
  const { settleUps } = await api<{ settleUps: { id: string; amountCents: number }[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  expect(settleUps.map((payment) => [payment.id, payment.amountCents])).toEqual([[settleId, 500]]);
});

test('US-25 #19 on sign up and reset, editing a field removes its own message and leaves the others', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  const usernameRule = page.getByText('Enter a username of 3 to 30 English letters, numbers or underscores, like omar_99');
  const passwordRule = page.getByText('Password must be at least 8 characters');
  await expect(usernameRule).toBeVisible();
  await expect(passwordRule).toBeVisible();
  await page.getByLabel('Username').fill('s');
  await expect(usernameRule).toHaveCount(0);
  await expect(passwordRule).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('x');
  await expect(passwordRule).toHaveCount(0);

  await page.goto('/reset');
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Username').fill('someone');
  await page.getByLabel('Recovery code').fill('AAAAA-BBBBB-CCCCC-DDDDD');
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(passwordRule).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await expect(passwordRule).toHaveCount(0);
});

test('US-12 #9 a friend already in one of the groups is warned, and Cancel in "Join as Omar?" changes nothing', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, 'Omar');
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const code = await inviteCodeOf(page, groupA.groupId, 'Omar');

    await pat.page.goto(`/invite/${code}`);
    await expect(pat.page.getByText("You're already in Group A. If you're not Omar, don't join: send them this link instead.")).toBeVisible();
    await pat.page.getByRole('button', { name: 'Join these groups' }).click();
    const dialog = pat.page.getByRole('dialog', { name: 'Join as Omar?' });
    await expect(dialog).toContainText(`${pat.username} is already in Group A.`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Nothing changed: the invite is still unused and Pat isn't in Group B.
    expect(await inviteCodeOf(page, groupA.groupId, 'Omar')).toBe(code);
    const { groups } = await api<{ groups: { name: string }[] }>(pat.page, 'get', '/groups');
    expect(groups.map((g) => g.name)).toEqual(['Group A']);
    // Logging in from the link as someone who can't use it still logs in, and says why.
    const ctx = await browser.newContext();
    opened.push(ctx);
    const owner2 = await ctx.newPage();
    const ownerName = (await api<{ account: { username: string } }>(page, 'get', '/me')).account.username;
    await owner2.goto(`/invite/${code}`);
    await owner2.getByRole('radio', { name: 'I have an account' }).check();
    await owner2.getByLabel('Username').fill(ownerName);
    await owner2.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await owner2.getByRole('button', { name: 'Log in and join' }).click();
    await expect(owner2.getByRole('status').filter({ hasText: 'This invite is for Omar' })).toBeVisible();
    await expect(owner2.getByText(`You're logged in as`)).toHaveCount(0);
  } finally {
    await closeAll(opened);
  }
});

test('US-34 #3 at 360 px the "Join as <name>?" dialog fits the longest name (30 characters, no spaces) in its title, text and button', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  const longName = 'W'.repeat(30);
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', [longName, 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, longName);
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const code = await inviteCodeOf(page, groupA.groupId, longName);

    await pat.page.setViewportSize({ width: 360, height: 740 });
    await pat.page.goto(`/invite/${code}`);
    await pat.page.getByRole('button', { name: 'Join these groups' }).click();
    const dialog = pat.page.getByRole('dialog', { name: `Join as ${longName}?` });
    await expect(dialog).toBeVisible();
    const fit = await dialog.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const parts = [...el.querySelectorAll('h2, p, button')].map((p) => p.getBoundingClientRect());
      return { sideways: el.scrollWidth - el.clientWidth, outside: parts.filter((r) => r.right > box.right + 0.5 || r.left < box.left - 0.5).length };
    });
    expect(fit.sideways, 'the dialog does not scroll sideways').toBeLessThanOrEqual(0);
    expect(fit.outside, 'nothing sticks out of the dialog').toBe(0);
    await expect(dialog.getByRole('button', { name: `Join as ${longName}` })).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

test('US-12 #9 logging in from the link while already in one of the groups asks "Join as Omar?" before joining anything', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, 'Omar');
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const code = await inviteCodeOf(page, groupA.groupId, 'Omar');

    // On another device, logged out, Pat opens Omar's link and logs in.
    const context = await browser.newContext();
    opened.push(context);
    const device = await context.newPage();
    await device.goto(`/invite/${code}`);
    await device.getByRole('radio', { name: 'I have an account' }).check();
    await device.getByLabel('Username').fill(pat.username);
    await device.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await device.getByRole('button', { name: 'Log in and join' }).click();

    // Logged in, but nothing joined yet: the warning and the confirmation come first,
    // and the cursor is on the page's heading, just above the warning.
    await expect(device.getByText("You're already in Group A. If you're not Omar, don't join: send them this link instead.")).toBeVisible();
    await expect(device.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeFocused();
    expect(await inviteCodeOf(page, groupA.groupId, 'Omar')).toBe(code);
    await device.getByRole('button', { name: 'Join these groups' }).click();
    await device.getByRole('dialog', { name: 'Join as Omar?' }).getByRole('button', { name: 'Join as Omar' }).click();
    await expect(device.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(device.getByRole('status').getByText('You joined 1 group. You were already in Group A, so it was skipped.')).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

test('US-41 after adding someone from my other groups, the cursor moves to their "Invite" box, ready to copy the link', async ({ page, browserName }, info) => {
  await signUpFast(page, info);
  await makeGroup(page, 'Flat', '$', ['Omar']);
  const club = await makeGroup(page, 'Club', '$', []);
  await openMembers(page, club.groupId, 'Club');
  await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Omar (Flat)' });
  await page.getByRole('button', { name: 'Add to group' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Invite Omar' })).toBeFocused();
  // Safari moves between buttons with Alt+Tab.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('region', { name: 'Invite Omar' }).getByRole('button', { name: 'Copy link for Omar' })).toBeFocused();
});

test('US-01 #5 and US-09 #3 the Username and Group name hints say the rule in plain words', async ({ page }, info) => {
  await page.goto('/signup');
  await expect(page.getByLabel('Username')).toHaveAccessibleDescription('3 to 30 English letters, numbers or underscores, like omar_99');
  await expect(page.getByText(/–|letters, numbers and _/)).toHaveCount(0);
  await signUpFast(page, info);
  await page.goto('/groups/new');
  await expect(page.getByLabel('Group name')).toHaveAccessibleDescription('Up to 50 characters');
});
