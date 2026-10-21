import { expect, test, type Locator, type Page } from '@playwright/test';
import { PASSWORD, api, expectNoHorizontalScroll, makeGroup, signUpFast, uniqueName } from './helpers.js';

test('US-05 #11 / US-26 #3/#4 switching % or amount, or the tip base, hides the result; repeats agree', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await expect(page.getByRole('radio', { name: 'Items only' })).toBeChecked();
  await page.getByLabel('Item 1 price').fill('20');
  const tax = page.getByRole('group', { name: 'Tax' });
  await tax.getByRole('textbox').fill('10');
  const calc = page.getByRole('button', { name: 'Calculate' });
  await calc.click();
  await expect(page.getByTestId('grand-total')).toHaveText('$22.00');
  await calc.click();
  await calc.click();
  await expect(page.getByTestId('grand-total')).toHaveText('$22.00');

  await tax.getByRole('radio', { name: 'Amount' }).check();
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  await calc.click();
  await expect(page.getByTestId('grand-total')).toHaveText('$30.00');

  const tip = page.getByRole('group', { name: 'Tip' });
  await tip.getByRole('textbox').fill('10');
  await calc.click();
  await expect(page.getByTestId('grand-total')).toHaveText('$32.00');
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  await calc.click();
  await expect(page.getByTestId('grand-total')).toHaveText('$33.00');

  // The tip base only shows for a % tip.
  await tip.getByRole('radio', { name: 'Amount' }).check();
  await expect(page.getByRole('radio', { name: 'Items + tax' })).toHaveCount(0);
});

test('US-36 #3 errors are tied to their field; results and messages are announced', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').fill('abc');
  await page.getByRole('button', { name: 'Calculate' }).click();
  const price = page.getByLabel('Item 1 price');
  await expect(price).toHaveAttribute('aria-invalid', 'true');
  await expect(price).toHaveAccessibleDescription('Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places');
  await price.fill('5');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: 'Results ready. Total $5.00.' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.locator('[role="status"][aria-live="polite"]').getByText('Bill saved')).toBeVisible();
  // The corner message goes away after 5 seconds.
  await expect(page.getByText('Bill saved')).toBeHidden({ timeout: 8000 });
});

test('US-37 #4/#5 loading placeholders and empty lists that say what to do next', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.route('**/api/solo-bills', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.getByRole('link', { name: 'Solo bills' }).first().click();
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  await expect(page.getByText('No solo bills yet. Total your first bill to keep a record of it.')).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.unroute('**/api/solo-bills');

  const { groupId } = await makeGroup(page, 'Empty', '$', []);
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByText('No bills yet. Add the first bill you shared.')).toBeVisible();
  await page.getByRole('tab', { name: 'Settle-ups' }).click();
  await expect(page.getByText('No settle-ups yet.')).toBeVisible();
});

test('US-38 #4 closing the tab with unsaved changes gets the browser prompt', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').fill('3');
  // Browsers only ask after the person has interacted with the page, which fill() did.
  const dialog = new Promise<string>((resolve) => page.once('dialog', (d) => { resolve(d.type()); void d.dismiss(); }));
  await page.close({ runBeforeUnload: true });
  expect(await dialog).toBe('beforeunload');
});

test('US-36 #4 usable at 200% zoom (half the width in CSS pixels)', async ({ page }, info) => {
  await page.setViewportSize({ width: 640, height: 400 });
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Zoomed in', '$', ['Ali']);
  for (const path of ['/', '/solo/new', `/groups/${groupId}`, `/groups/${groupId}/bills/new`, '/account']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').fill('8');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('$8.00');
});

test('US-14 #10-#12 item dropdowns list only people on the bill and follow unticking', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Picky', '$', ['Ali', 'Sara', 'Omar']);
  await page.goto(`/groups/${groupId}/bills/new`);
  const took = page.getByRole('group', { name: 'Who took part' });
  await took.getByRole('checkbox', { name: 'Omar' }).uncheck();
  await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
  const picker = page.getByRole('button', { name: /Who shared item 1/ });
  await picker.click();
  const panel = page.locator('.picker-panel');
  await expect(panel.getByRole('checkbox')).toHaveCount(3);
  await expect(panel.getByRole('checkbox', { name: 'Omar' })).toHaveCount(0);
  await panel.getByRole('checkbox', { name: 'Ali' }).check();
  await panel.getByRole('checkbox', { name: 'Sara' }).check();
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toContainText('Ali, Sara');

  // Unticking Sara from the bill takes her out of every item.
  await took.getByRole('checkbox', { name: 'Sara' }).uncheck();
  await expect(picker).toContainText('Ali');
  await expect(picker).not.toContainText('Sara');
  await took.getByRole('checkbox', { name: 'Ali' }).uncheck();
  await page.getByLabel('Item 1 price').fill('10');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Choose who shared this item').last()).toBeVisible();
});

test('US-16 #8 owed is green with + and words; owes is red with − and words', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Colours', '$', ['Ali']);
  await api(page, 'post', `/groups/${groupId}/settle-ups`, { fromId: meId, toId: ids.Ali, amount: '4' });
  await page.goto(`/groups/${groupId}`);
  const owed = page.locator('.amount-owed').first();
  const owes = page.locator('.amount-owes').first();
  await expect(owed).toHaveText('+$4.00 is owed');
  await expect(owes).toHaveText('−$4.00 owes');
  const colour = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);
  const [g, r] = [await colour(owed), await colour(owes)];
  expect(g).not.toBe(r);
  const rgb = (c: string) => c.match(/\d+/g)!.map(Number);
  expect(rgb(g)[1]).toBeGreaterThan(rgb(g)[0]); // green-ish
  expect(rgb(r)[0]).toBeGreaterThan(rgb(r)[1]); // red-ish
});

test('US-33 #5/#8 latest solo bills and "owe nothing" when everything is settled', async ({ page }, info) => {
  await signUpFast(page, info);
  await makeGroup(page, 'Settled', '$', ['Ali']);
  for (const name of ['First', 'Second']) {
    await api(page, 'post', '/solo-bills', {
      currency: '£',
      bill: { name, items: [{ name: '', price: '2' }], tax: { mode: 'amount', value: '0' }, otherCharges: { mode: 'amount', value: '' }, tip: { mode: 'amount', value: '0' }, tipOn: 'items' },
    });
  }
  await page.reload();
  await expect(page.getByText('You owe nothing and are owed nothing.')).toBeVisible();
  const solo = page.getByRole('region', { name: 'Latest solo bills' }).getByRole('link');
  await expect(solo.nth(0)).toContainText('Second');
  await expect(solo.nth(1)).toContainText('First');
  await expect(solo.nth(0)).toContainText('£2.00');
});

// ---------- Keyboard only (US-36 #1) ----------

/** Presses Tab (or Shift+Tab if it's above) until `target` has focus, proving it can be reached by keyboard. */
async function tabTo(page: Page, target: Locator, key: string, max = 80): Promise<void> {
  await target.waitFor();
  const before = await target.evaluate((el) => {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return Boolean(el.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  const press = before ? `Shift+${key}` : key;
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      // A visible focus outline at every step.
      const outline = await target.evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(outline).not.toBe('none');
      return;
    }
    await page.keyboard.press(press);
  }
  throw new Error(`Could not reach ${target} with ${key}`);
}

/** After moving to another page, focus goes to its heading. */
async function headingFocused(page: Page, name: string | RegExp): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name })).toBeFocused();
}

test('US-36 #1 the whole journey works with only the keyboard', async ({ page, browserName }, info) => {
  test.setTimeout(120_000);
  const key = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const username = uniqueName('kb', info);

  // Sign up.
  await page.goto('/signup');
  await tabTo(page, page.getByLabel('Username'), key);
  await page.keyboard.type(username);
  await page.keyboard.press(key);
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  const go = page.getByRole('button', { name: "I've saved it, continue" });
  await tabTo(page, go, key);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // Create a group.
  await tabTo(page, page.getByRole('link', { name: 'Groups' }).first(), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Groups');
  await tabTo(page, page.getByRole('link', { name: 'Create group' }).first(), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Create group');
  await tabTo(page, page.getByLabel('Group name'), key);
  await page.keyboard.type('Keys');
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Keys');

  // Add a member (tabs: arrow keys move between them).
  await tabTo(page, page.getByRole('tab', { name: 'Bills' }), key);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Members' })).toBeFocused();
  await tabTo(page, page.getByLabel('Add a friend by name'), key);
  await page.keyboard.type('Ali');
  await page.keyboard.press('Enter');
  await expect(page.getByText('has an account').or(page.getByText('name only')).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Ali' })).toBeVisible();

  // An itemized bill, choosing people in the dropdown by keyboard.
  await tabTo(page, page.getByRole('link', { name: 'Add bill' }).first(), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, /Add bill/);
  await tabTo(page, page.getByRole('radio', { name: 'Equally' }), key);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: /By items/ })).toBeChecked();
  await tabTo(page, page.getByLabel('Item 1 price'), key);
  await page.keyboard.type('30');
  await tabTo(page, page.getByRole('button', { name: /Who shared item 1/ }), key);
  await page.keyboard.press('Enter');
  await expect(page.locator('.picker-panel input').first()).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Who shared item 1/ })).toContainText(`${username}, Ali`);
  await tabTo(page, page.getByRole('button', { name: 'Calculate' }), key);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grand-total')).toHaveText('$30.00');
  await tabTo(page, page.getByRole('button', { name: 'Save bill' }), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Keys');

  // Record the suggested settle-up.
  await tabTo(page, page.getByRole('link', { name: 'Record this payment' }), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Record a payment');
  await tabTo(page, page.getByRole('button', { name: 'Record payment' }), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Keys');
  await expect(page.getByText('Everyone is settled up.')).toBeVisible();

  // Log out.
  await tabTo(page, page.getByRole('link', { name: 'Account' }).first(), key);
  await page.keyboard.press('Enter');
  await headingFocused(page, 'Account');
  await tabTo(page, page.getByRole('button', { name: 'Log out' }), key);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
