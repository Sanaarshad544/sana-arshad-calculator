import { expect, test } from '@playwright/test';
import { PASSWORD, api, expectNoA11yViolations, expectNoHorizontalScroll, makeGroup, signUpFast } from './helpers.js';

test('US-33 the Dashboard sums up money per currency', async ({ page }, info) => {
  await signUpFast(page, info);
  await expect(page.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'New solo bill' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'New group bill' })).toBeVisible();

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
  await page.reload();
  await expect(page.getByRole('region', { name: "You're owed" })).toContainText('+$15.00');
  await expect(page.getByRole('region', { name: 'You owe' })).toContainText('−Rs 400.00');
  await page.getByRole('link', { name: /Dollars/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dollars' })).toBeVisible();
});

test('US-34 sidebar on a wide screen, menu on a phone, no sideways scrolling', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await signUpFast(page, info);
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toBeVisible();
  for (const name of ['Dashboard', 'Solo bills', 'Groups', 'Account']) {
    await expect(sidebar.getByRole('link', { name })).toBeVisible();
  }
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');

  await page.setViewportSize({ width: 375, height: 800 });
  await expect(sidebar).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('#mobile-nav').getByRole('link', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();

  const { groupId } = await makeGroup(page, 'A group with a rather long name for phones', 'CHF', ['Somebody with a long name']);
  await page.setViewportSize({ width: 360, height: 740 });
  for (const path of ['/', '/solo', '/solo/new', '/groups', `/groups/${groupId}`, `/groups/${groupId}/bills/new`, '/account']) {
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
  await page.goto('/account');
  await page.getByText('Dark', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe(dark);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(bg).toBe(dark);
});

test('US-36 a keyboard-only flow, with focus kept inside dialogs', async ({ page, browserName }, info) => {
  // Safari on a Mac moves between buttons with Option+Tab.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').focus();
  await page.keyboard.type('12.50');
  await page.keyboard.press('Enter'); // the form's Enter is Calculate
  await expect(page.getByTestId('grand-total')).toHaveText('$12.50');
  await page.getByRole('button', { name: 'Save bill' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
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
    await expectNoA11yViolations(page, 'solo bill with errors');
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
    await page.getByText('By items (each pays for what they had)').click();
    await page.getByRole('button', { name: /Who shared item 1/ }).click();
    await expectNoA11yViolations(page, 'itemized bill with dropdown open');
    await page.goto('/account');
    await expectNoA11yViolations(page, 'account');
  });
}
