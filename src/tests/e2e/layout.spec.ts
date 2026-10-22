import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, api, expectNoA11yViolations, expectNoHorizontalScroll, makeGroup, signUpFast } from './helpers.js';

/** A $ group where Ali owes me 15.00, and an Rs group where I owe Sara 400.00. */
async function twoCurrencyGroups(page: Page): Promise<void> {
  const usd = await makeGroup(page, 'Dollars', '$', ['Ali']);
  const rs = await makeGroup(page, 'Rupees', 'Rs', ['Sara']);
  const bill = (participants: string[], payer: string, price: string) => ({
    bill: {
      name: '',
      items: [{ name: '', price }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds: participants,
      payerId: payer,
    },
  });
  await api(page, 'post', `/groups/${usd.groupId}/bills`, bill([usd.meId, usd.ids.Ali], usd.meId, '30'));
  await api(page, 'post', `/groups/${rs.groupId}/bills`, bill([rs.meId, rs.ids.Sara], rs.ids.Sara, '800'));
}

test('US-33 the Dashboard sums up money per currency', async ({ page }, info) => {
  await signUpFast(page, info);
  await expect(page.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'New solo bill' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'New group bill' })).toBeVisible();

  await twoCurrencyGroups(page);
  await page.reload();
  await expect(page.getByRole('region', { name: "You're owed" })).toContainText('+$15.00');
  await expect(page.getByRole('region', { name: 'You owe' })).toContainText('−Rs 400.00');
  // The group's name is also shown under "You owe" / "You're owed" now, so pick the one in "Your groups".
  await page.getByRole('region', { name: 'Your groups' }).getByRole('link', { name: /Dollars/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dollars' })).toBeVisible();
});

test("US-33 #9 under You owe and You're owed the Dashboard says who, and the group's name opens that group", async ({ page }, info) => {
  await signUpFast(page, info);
  await twoCurrencyGroups(page);
  await page.reload();

  // One line per person under each total: who, how much, and which group.
  const oweRow = page.getByRole('region', { name: 'You owe' }).locator('.debt-row');
  await expect(oweRow).toHaveCount(1);
  await expect(oweRow).toContainText('To Sara');
  await expect(oweRow).toContainText('Rs 400.00');
  const owedRow = page.getByRole('region', { name: "You're owed" }).locator('.debt-row');
  await expect(owedRow).toHaveCount(1);
  await expect(owedRow).toContainText('Ali');
  await expect(owedRow).toContainText('$15.00');
  await expect(owedRow.getByRole('link', { name: 'Dollars' })).toBeVisible();

  // The group's name opens that group.
  await oweRow.getByRole('link', { name: 'Rupees' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Rupees' })).toBeVisible();
});

test('US-34 sidebar on a wide screen, menu on a phone, no sideways scrolling', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpFast(page, info);
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toBeVisible();
  for (const name of ['Dashboard', 'Solo bills', 'Groups', 'Settings']) {
    await expect(sidebar.getByRole('link', { name })).toBeVisible();
  }
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('#mobile-nav').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  const { groupId } = await makeGroup(page, 'A group with a rather long name for phones', 'CHF', ['Somebody with a long name']);
  await page.setViewportSize({ width: 360, height: 740 });
  for (const path of ['/', '/solo', '/solo/new', '/groups', `/groups/${groupId}`, `/groups/${groupId}/bills/new`, '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('US-35 appearance follows the device, and the choice is saved with the account', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  const username = await signUpFast(page, info);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await bg();
  // "Device" (the default) follows the device when it switches.
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await bg();
  expect(dark).not.toBe(light);

  // Choosing Dark wins over a light device, and is saved with the account.
  await page.goto('/settings');
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe(dark);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe(dark);
});

test('US-36 #1/#2 a keyboard-only flow, with focus kept inside dialogs', async ({ page, browserName }, info) => {
  // Safari on a Mac moves between buttons with Option+Tab.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').focus();
  await page.keyboard.type('12.50');
  await page.getByLabel('Bill name').focus();
  await page.keyboard.type('Keyboard lunch');
  // Enter in the bill name is Calculate (Enter in an item's price moves on to the next item instead).
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grand-total')).toHaveText('$12.50');
  await page.getByRole('button', { name: 'Save bill' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  // Saving leads to the history. A saved bill opens as a read-only receipt, and that is where Delete is.
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await page.getByRole('link', { name: /Keyboard lunch/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Keyboard lunch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(dialog.getByRole('button', { name: 'Delete bill' })).toBeFocused();
  // Focus stays inside the dialog: Tab wraps back to the first button.
  await page.keyboard.press(tab);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press(`Shift+${tab}`);
  await expect(dialog.getByRole('button', { name: 'Delete bill' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`US-36 #6 no WCAG 2.2 AA problems (${scheme})`, async ({ page }, info) => {
    // Many pages are scanned one after the other.
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
    await expectNoA11yViolations(page, 'login');
    await page.goto('/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expectNoA11yViolations(page, 'signup with errors');

    await signUpFast(page, info);
    await expectNoA11yViolations(page, 'dashboard');

    await page.goto('/solo/new');
    await page.getByRole('button', { name: 'Calculate' }).click();
    // The only line is empty, so it is left out and there is nothing to total.
    await expect(page.getByText('Add at least one item')).toBeVisible();
    await expectNoA11yViolations(page, 'solo bill with no items');
    await page.getByLabel('Item 1 price').fill('abc');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByText('Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places')).toBeVisible();
    await expectNoA11yViolations(page, 'solo bill with a price error');
    await page.getByLabel('Item 1 price').fill('10');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByTestId('grand-total')).toBeVisible();
    await expectNoA11yViolations(page, 'solo bill with results');

    const { groupId } = await makeGroup(page, 'Axe', '$', ['Ali', 'Sara']);
    await page.goto(`/groups/${groupId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Axe' })).toBeVisible();
    await expectNoA11yViolations(page, 'group bills tab');
    await page.getByRole('tab', { name: 'Members' }).click();
    await expectNoA11yViolations(page, 'group members tab');
    await page.getByRole('button', { name: 'Leave group' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoA11yViolations(page, 'leave dialog');
    await page.keyboard.press('Escape');

    await page.goto(`/groups/${groupId}/bills/new`);
    await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Axe' })).toBeVisible();
    await expectNoA11yViolations(page, 'group bill split equally');
    await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
    const sharedBy = page.getByRole('group', { name: 'Who shared item 1' });
    await sharedBy.getByRole('checkbox', { name: 'Ali' }).check();
    await expectNoA11yViolations(page, 'itemized bill with a name chip ticked');
    // With the message about an item nobody shared showing as well.
    await sharedBy.getByRole('checkbox', { name: 'Ali' }).uncheck();
    await page.getByLabel('Item 1 price').fill('10');
    await page.getByRole('button', { name: 'Calculate' }).click();
    await expect(page.getByText('Choose who shared this item')).toBeVisible();
    await expectNoA11yViolations(page, 'itemized bill with an item nobody shared');
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expectNoA11yViolations(page, 'settings');
  });

  test(`US-36 #6 no WCAG 2.2 AA problems on the invite-code page, Edit group and an invite link (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await signUpFast(page, info);
    const { groupId } = await makeGroup(page, 'Axe invite', '$', ['Ali']);

    await page.goto('/join');
    await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
    await expectNoA11yViolations(page, 'use an invite code');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Enter the invite code you were sent', { exact: true })).toBeVisible();
    await expectNoA11yViolations(page, 'use an invite code with an error');

    await page.goto(`/groups/${groupId}/edit`);
    await expect(page.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
    await expectNoA11yViolations(page, 'edit group');

    // Ali's own invite link, opened by somebody who is logged out (it has a password box with an eye button).
    const { group } = await api<{ group: { members: { name: string; inviteCode: string | null }[] } }>(page, 'get', `/groups/${groupId}`);
    const code = group.members.find((m) => m.name === 'Ali')?.inviteCode;
    expect(code).toBeTruthy();
    await page.context().clearCookies();
    await page.goto(`/invite/${code}`);
    await expect(page.getByRole('heading', { level: 1, name: "Ali, join your friends' groups" })).toBeVisible();
    await expectNoA11yViolations(page, 'invite link');
    await page.getByRole('button', { name: 'Create account and join' }).click();
    await expect(page.getByText('Enter a username of 3 to 30', { exact: false })).toBeVisible();
    await expectNoA11yViolations(page, 'invite link with errors');
  });
}

test('US-36 #6 the loading placeholder has no WCAG 2.2 AA problems and says "Loading…" to screen readers', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Slow', '$', ['Ali']);
  // Hold the group's data so the page stays on its placeholder.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/groups/${groupId}`, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/groups/${groupId}`);
  const loading = page.getByRole('status').filter({ hasText: 'Loading…' });
  await expect(loading).toBeAttached();
  await expect(loading).toHaveAttribute('aria-busy', 'true');
  await expectNoA11yViolations(page, 'loading placeholder');
  release();
  await expect(page.getByRole('heading', { level: 1, name: 'Slow' })).toBeVisible();
  await expect(loading).toHaveCount(0);
});
