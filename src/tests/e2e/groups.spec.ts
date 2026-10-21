import { expect, test } from '@playwright/test';
import { api, makeGroup, signUpFast } from './helpers.js';

test('US-09/US-10/US-11 create a group, add friends, see and copy the invite code', async ({ page, context, browserName }, info) => {
  await signUpFast(page, info);
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
  await page.getByRole('link', { name: 'Create group' }).first().click();
  await expect(page.getByText("It can't be changed after the group is created.")).toBeVisible();
  await page.getByLabel('Group name').fill('Trip');
  await page.getByLabel('Currency', { exact: true }).selectOption('€');
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Trip' })).toBeVisible();

  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByLabel('Add a friend by name').fill('Omar');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status').getByText('Member added')).toBeVisible();
  await page.getByLabel('Add a friend by name').fill('OMAR');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('That name has already been used in this group')).toBeVisible();

  const code = (await page.getByTestId('invite-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy' }).click();
  if (browserName === 'chromium') {
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  }
  await expect(page.getByRole('button', { name: /regenerate/i })).toHaveCount(0);
});

test('US-14/US-15/US-16/US-17 itemized bill with the people dropdown, balances, record a payment', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Dinner club', '$', ['Ali', 'Sara']);
  await page.goto(`/groups/${groupId}`);
  await page.getByRole('link', { name: 'Add bill' }).first().click();

  // Only Ali and Sara took part; Ali paid.
  const me = page.getByRole('group', { name: 'Who took part' });
  await me.getByRole('checkbox').first().uncheck();
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await page.getByText('By items (each pays for what they had)').click();

  await page.getByLabel('Item 1 name').fill('Steak');
  await page.getByLabel('Item 1 price').fill('40.00');
  await page.getByRole('button', { name: /Who shared item 1/ }).click();
  await page.getByRole('checkbox', { name: 'Ali' }).last().check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /Who shared item 1/ })).toContainText('Ali');

  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 name').fill('Salad');
  await page.getByLabel('Item 2 price').fill('10.00');
  // Item 2 left with nobody: a clear message.
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Choose who shared this item').last()).toBeVisible();
  // Focus jumps to the first field with a problem.
  await expect(page.getByRole('button', { name: /Who shared item 2/ })).toBeFocused();

  // Keyboard: open the dropdown, arrow down to Sara, tick with Space, Esc closes.
  await page.keyboard.press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Ali' }).last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('checkbox', { name: 'Sara' }).last()).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Who shared item 2/ })).toContainText('Sara');

  const tax = page.getByRole('group', { name: 'Tax' });
  await tax.getByRole('radio', { name: 'Amount' }).check();
  await tax.getByRole('textbox').fill('5.00');
  const other = page.getByRole('group', { name: /Other charges/ });
  await other.getByRole('textbox').fill('2.50');
  const tip = page.getByRole('group', { name: 'Tip' });
  await tip.getByRole('radio', { name: 'Amount' }).check();
  await tip.getByRole('textbox').fill('10.00');
  await page.getByRole('button', { name: 'Calculate' }).click();

  await expect(page.getByTestId('grand-total')).toHaveText('$67.50');
  const shares = page.getByTestId('share');
  await expect(shares.nth(0)).toContainText('Ali');
  await expect(shares.nth(0)).toContainText('$54.00');
  await expect(shares.nth(1)).toContainText('Sara');
  await expect(shares.nth(1)).toContainText('$13.50');

  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Dinner club' })).toBeVisible();

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

test('US-12/US-24 join by claiming a name, then rejoin after removal', async ({ browser }, info) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await signUpFast(owner, info, 'own');
  const { groupId, ids } = await makeGroup(owner, 'Joiners', '$', ['Omar']);
  const { group } = await api<{ group: { inviteCode: string } }>(owner, 'get', `/groups/${groupId}`);

  const omarCtx = await browser.newContext();
  const omar = await omarCtx.newPage();
  await signUpFast(omar, info, 'omar');
  await omar.goto('/join');
  await omar.getByLabel('Invite code').fill('WRONGCODE');
  await omar.getByRole('button', { name: 'Continue' }).click();
  await expect(omar.getByRole('alert')).toHaveText("That invite code isn't valid");
  await omar.getByLabel('Invite code').fill(group.inviteCode.toLowerCase());
  await omar.getByRole('button', { name: 'Continue' }).click();
  await omar.getByText("I'm Omar").click();
  await omar.getByRole('button', { name: 'Join group' }).click();
  await expect(omar.getByRole('heading', { level: 1, name: 'Joiners' })).toBeVisible();

  await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await omar.reload();
  await expect(omar.getByRole('alert')).toHaveText('You no longer have access to this group');

  await omar.goto('/join');
  await omar.getByLabel('Invite code').fill(group.inviteCode);
  await omar.getByRole('button', { name: 'Continue' }).click();
  await expect(omar.getByRole('heading', { level: 1, name: 'Joiners' })).toBeVisible();
  await ownerCtx.close();
  await omarCtx.close();
});
