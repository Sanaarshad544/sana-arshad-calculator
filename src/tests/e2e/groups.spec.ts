import { expect, test, type Page } from '@playwright/test';
import { api, makeGroup, signUpFast } from './helpers.js';

// Joining works through personal invites: every person added by name has their own code and link (/invite/<code>).

/** A personal invite code is 12 characters and never contains 0, O, 1 or I. */
const INVITE_CODE = /^[A-HJ-NP-Z2-9]{12}$/;

/** A person's own invite code, as the group's details give it to a member. */
async function inviteCodeOf(page: Page, groupId: string, name: string): Promise<string> {
  const { group } = await api<{ group: { members: { name: string; inviteCode: string | null }[] } }>(page, 'get', `/groups/${groupId}`);
  const code = group.members.find((m) => m.name === name)?.inviteCode;
  if (!code) throw new Error(`"${name}" has no invite code`);
  return code;
}

/** One person's row on the Members tab (not the "was added" box). Every row has a "Rename" button. */
const memberRow = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Rename ${name}`, exact: true }) });

test("US-09/US-10/US-11 create a group, add friends, see and copy each person's own invite", async ({ page, context, browserName }, info) => {
  await signUpFast(page, info);
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
  await page.getByRole('link', { name: 'Create group' }).first().click();
  await expect(page.getByText("You can change it later; amounts aren't converted.")).toBeVisible();
  await page.getByLabel('Group name').fill('Trip');
  await page.getByLabel('Currency', { exact: true }).selectOption('€');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Trip' })).toBeVisible();

  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByLabel('Add a friend by name').fill('Omar');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status').getByText('Member added')).toBeVisible();
  // Right after adding, a box offers Omar's own invite link.
  const box = page.getByRole('region', { name: 'Invite Omar' });
  await expect(box).toContainText('Omar was added. Send them their own invite link');
  await page.getByLabel('Add a friend by name').fill('OMAR');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('That name has already been used in this group')).toBeVisible();

  const row = memberRow(page, 'Omar');
  const code = (await row.getByTestId('invite-code-Omar').textContent())?.trim() ?? '';
  expect(code).toMatch(INVITE_CODE);
  await expect(box.getByTestId('invite-code-Omar')).toHaveText(code);
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await row.getByRole('button', { name: 'Copy link for Omar' }).click();
  await expect(row.getByRole('button', { name: 'Copied for Omar' })).toBeVisible();
  // Only Chromium lets a test read the clipboard back.
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/invite/${code}`);
  }
  await expect(page.getByRole('button', { name: /regenerate/i })).toHaveCount(0);
});

test('US-14/US-15/US-16/US-17 itemized bill with name chips, balances, record a payment', async ({ page, browserName }, info) => {
  // Safari moves between form controls with Alt+Tab.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Dinner club', '$', ['Ali', 'Sara']);
  await page.goto(`/groups/${groupId}`);
  await page.getByRole('link', { name: 'Add bill' }).first().click();

  // Only Ali and Sara took part; Ali paid.
  const me = page.getByRole('group', { name: 'Who took part' });
  await me.getByRole('checkbox').first().uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();

  // Each item has its own "Shared by" chips: tap Ali on the steak.
  const sharedBy = (n: number) => page.getByRole('group', { name: `Who shared item ${n}`, exact: true });
  const person = (n: number, name: string) => sharedBy(n).getByRole('checkbox', { name, exact: true });
  await page.getByLabel('Item 1 name').fill('Steak');
  await page.getByLabel('Item 1 price').fill('40.00');
  await person(1, 'Ali').check();
  await expect(sharedBy(1).getByRole('checkbox', { checked: true })).toHaveCount(1);

  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 name').fill('Salad');
  await page.getByLabel('Item 2 price').fill('10.00');
  // Item 2 left with nobody: a clear message under its chips.
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(sharedBy(2).getByText('Choose who shared this item')).toBeVisible();
  // Focus jumps to the first field with a problem: the first chip of item 2.
  await expect(person(2, 'Ali')).toBeFocused();

  // Keyboard: move on to Sara's chip and tick it with Space. The message goes at once.
  await page.keyboard.press(tab);
  await expect(person(2, 'Sara')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(person(2, 'Sara')).toBeChecked();
  await expect(sharedBy(2).getByText('Choose who shared this item')).toHaveCount(0);

  const taxGroup = page.getByRole('group', { name: 'Tax', exact: true });
  await taxGroup.getByRole('radio', { name: 'Amount' }).check();
  await taxGroup.getByRole('textbox').fill('5.00');
  const other = page.getByRole('group', { name: /Other charges/ });
  await other.getByRole('textbox').fill('2.50');
  const tip = page.getByRole('group', { name: 'Tip', exact: true });
  await tip.getByRole('radio', { name: 'Amount' }).check();
  await tip.getByRole('textbox').fill('10.00');
  await page.getByRole('button', { name: 'Calculate' }).click();

  await expect(page.getByTestId('grand-total')).toHaveText('$67.50');
  const shares = page.getByTestId('share');
  await expect(shares.nth(0)).toContainText('Ali');
  await expect(shares.nth(0)).toContainText('$54.00');
  await expect(shares.nth(1)).toContainText('Sara');
  await expect(shares.nth(1)).toContainText('$13.50');

  // Saving goes to the group's bills, with the new bill marked "Saved".
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Dinner club' })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // Balances first, with sign and words as well as colour.
  const rows = page.getByTestId('balance-row');
  await expect(rows.filter({ hasText: 'Ali' })).toContainText('+$13.50 is owed');
  await expect(rows.filter({ hasText: 'Sara' })).toContainText('−$13.50 owes');
  await expect(page.getByTestId('suggestion')).toHaveText(/Sara pays Ali \$13\.50/);

  // Record this payment: pre-filled, nothing saved until confirmed.
  await page.getByRole('link', { name: 'Record this payment' }).click();
  await expect(page.getByLabel('Who paid')).toHaveValue(/\d+/);
  await expect(page.getByLabel(/Amount/)).toHaveValue('13.50');
  const { settleUps } = await api<{ settleUps: unknown[] }>(page, 'get', `/groups/${groupId}/settle-ups`);
  expect(settleUps).toHaveLength(0);
  await page.getByLabel(/Amount/).fill('20');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('status').getByText('Payment recorded')).toBeVisible();
  // Overpaying flips the debt.
  await expect(page.getByTestId('suggestion')).toHaveText(/Ali pays Sara \$6\.50/);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity').first()).toContainText('recorded a payment: Sara paid Ali 20.00');
});

test('US-13 equal split marks who pays the extra cent', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Three', '$', ['Ali', 'Sara']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await page.getByLabel('Item 1 price').fill('100');
  await page.getByRole('button', { name: 'Calculate' }).click();
  const shares = page.getByTestId('share');
  await expect(shares).toHaveCount(3);
  await expect(shares.nth(0)).toContainText('$33.34');
  await expect(shares.nth(0)).toContainText('+1 cent');
  await expect(shares.nth(1)).toContainText('$33.33');

  // US-15 #2: untick the payer.
  await page.getByLabel('Who paid').selectOption({ label: 'Sara' });
  await page.getByRole('group', { name: 'Who took part' }).getByRole('checkbox', { name: 'Sara' }).uncheck();
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('The payer must be one of the people on this bill')).toBeVisible();
});

test('US-20/US-23/US-22 remove, restore, and close out a group', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Closing', '$', ['Omar']);
  await api(page, 'post', `/groups/${groupId}/bills`, {
    bill: {
      name: 'Pizza night',
      items: [{ name: '', price: '20' }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds: [meId, ids.Omar],
      payerId: ids.Omar,
    },
  });
  await page.goto(`/groups/${groupId}?tab=members`);
  await page.getByRole('button', { name: 'Remove Omar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByRole('alert')).toHaveText("Settle this member's balance before removing them");

  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: meId, toId: ids.Omar, amount: '10' });
  await page.reload();
  await page.getByRole('button', { name: 'Remove Omar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove member' }).click();
  await expect(page.getByRole('status').getByText('Member removed')).toBeVisible();
  await expect(page.getByText('Omar (removed)')).toBeVisible();

  // Old bill is view only and shows "(removed)".
  await page.getByRole('tab', { name: 'Bills' }).click();
  await page.getByText('Pizza night').click();
  await expect(page.getByText('so this bill is view only')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alert')).toHaveText('Restore Omar to change this bill');

  // Restore.
  await page.goto(`/groups/${groupId}?tab=members`);
  await page.getByRole('button', { name: 'Restore Omar' }).click();
  await expect(page.getByRole('status').getByText('Member restored')).toBeVisible();

  // Last member with an account: warning, Cancel, then Leave deletes the group.
  await page.getByRole('button', { name: 'Leave group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave and delete this group?' });
  await expect(dialog).toContainText(
    "You're the last member with an account. If you leave, this group and all its bills, settle-ups and history will be permanently deleted. Unsettled balances will be lost.",
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Leave group' }).click();
  await dialog.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole('alert')).toHaveText('This group no longer exists');
});

test('US-12/US-20/US-23 join with a personal invite, then come back only through Restore', async ({ browser }, info) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpFast(owner, info, 'own');
  const { groupId, ids } = await makeGroup(owner, 'Joiners', '$', ['Omar']);
  const code = await inviteCodeOf(owner, groupId, 'Omar');

  const omarCtx = await browser.newContext();
  const omar = await omarCtx.newPage();
  await signUpFast(omar, info, 'omar');
  try {
    // A wrong code shows a clear message; going back, the right one (typed in lower case) shows Omar's invite.
    await omar.goto('/join');
    await expect(omar.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
    await omar.getByLabel('Invite code').fill('WRONGCODE');
    await omar.getByRole('button', { name: 'Continue' }).click();
    await expect(omar.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
    await expect(omar.getByRole('alert')).toHaveText("That invite link isn't valid. Check the code and try again.");
    await omar.goBack();
    await expect(omar.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
    await omar.getByLabel('Invite code').fill(code.toLowerCase());
    await omar.getByRole('button', { name: 'Continue' }).click();
    await expect(omar.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeVisible();
    await omar.getByRole('button', { name: 'Join these groups' }).click();
    await expect(omar.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(omar.getByRole('status').getByText('You joined 1 group')).toBeVisible();
    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('heading', { level: 1, name: 'Joiners' })).toBeVisible();

    // Once removed, the used invite does not bring him back.
    await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
    await omar.reload();
    await expect(omar.getByRole('alert')).toHaveText('You no longer have access to this group');
    await omar.goto(`/invite/${code}`);
    await expect(omar.getByRole('alert')).toHaveText('This invite has already been used');
    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('alert')).toHaveText('You no longer have access to this group');

    // Restore does.
    await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/restore`);
    await omar.reload();
    await expect(omar.getByRole('heading', { level: 1, name: 'Joiners' })).toBeVisible();
  } finally {
    await ownerCtx.close();
    await omarCtx.close();
  }
});

test('US-20/US-23 leaving a group asks "Leave this group?" with "Any member can restore you later."; a restore brings you back', async ({ browser }, info) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpFast(owner, info, 'own');
  const { groupId } = await makeGroup(owner, 'Leavers', '$', ['Omar']);
  const omarCtx = await browser.newContext();
  const omar = await omarCtx.newPage();
  await signUpFast(omar, info, 'omar');
  try {
    await api(omar, 'post', `/invites/${await inviteCodeOf(owner, groupId, 'Omar')}/accept`);

    await omar.goto(`/groups/${groupId}?tab=members`);
    await expect(omar.getByRole('heading', { level: 1, name: 'Leavers' })).toBeVisible();
    await omar.getByRole('button', { name: 'Leave group' }).click();
    const dialog = omar.getByRole('dialog', { name: 'Leave this group?' });
    await expect(dialog).toContainText('Any member can restore you later.');
    // "Stay" keeps him in.
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(dialog).toBeHidden();
    await expect(omar.getByRole('heading', { level: 1, name: 'Leavers' })).toBeVisible();

    await omar.getByRole('button', { name: 'Leave group' }).click();
    await dialog.getByRole('button', { name: 'Leave group' }).click();
    await expect(omar.getByRole('status').getByText('You left the group')).toBeVisible();
    await expect(omar.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('alert')).toHaveText('You no longer have access to this group');

    // Any member can restore him; the used invite cannot.
    await owner.goto(`/groups/${groupId}?tab=members`);
    await expect(owner.getByText('Omar (removed)')).toBeVisible();
    await owner.getByRole('button', { name: 'Restore Omar' }).click();
    await expect(owner.getByRole('status').getByText('Member restored')).toBeVisible();
    await omar.reload();
    await expect(omar.getByRole('heading', { level: 1, name: 'Leavers' })).toBeVisible();
  } finally {
    await ownerCtx.close();
    await omarCtx.close();
  }
});
