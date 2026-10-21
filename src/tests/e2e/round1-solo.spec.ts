// Browser proofs for the QA round 1 changes that show on the solo bill form, the password boxes
// and the names of things (see .omc/autopilot/spec.md and docs/user-stories.md):
//   - tax and tip start empty, a field's error goes as soon as it is edited, % lines show their rate
//   - "Save bill" sits under the results, and a failed save shows its alert just above it
//   - every password box has an eye button, with the hint "At least 8 characters"
//   - the Account page is now Settings, the app is called "Bill Splitter", PKR is in the list
// Message texts are written out in full on purpose: they are the words the docs promise.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { api, makeGroup, signUpFast } from './helpers.js';

const MSG = {
  price: 'Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places',
  taxPercent: 'Tax must be between 0% and 100%, with at most 2 decimal places',
  offline: "Couldn't save — check your connection",
} as const;

// ---------- Small helpers ----------

type ChargeName = 'Tax' | 'Other charges (optional)' | 'Tip';
type LineName = 'Subtotal' | 'Tax' | 'Other charges' | 'Tip' | 'Total';

const results = (page: Page) => page.getByRole('region', { name: 'Results' });
const grandTotal = (page: Page) => page.getByTestId('grand-total');
const calculate = (page: Page) => page.getByRole('button', { name: 'Calculate' }).click();
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save bill' });
const chargeGroup = (page: Page, name: ChargeName) => page.getByRole('group', { name, exact: true });
const chargeBox = (page: Page, name: ChargeName) => chargeGroup(page, name).getByRole('textbox');

async function setCharge(page: Page, name: ChargeName, mode: 'Percentage' | 'Amount', value: string): Promise<void> {
  await chargeGroup(page, name).getByRole('radio', { name: mode }).check();
  await chargeBox(page, name).fill(value);
}

/** The labels or the amounts of all five lines of the totals, top to bottom. */
const totalLabels = (page: Page) => results(page).locator('dl.totals dt');
const totalAmounts = (page: Page) => results(page).locator('dl.totals dd');

/** The value cell of one line of the totals. A % line carries its rate in its label ("Tax (5%)"). */
const totalLine = (page: Page, name: LineName) =>
  results(page)
    .locator('dl.totals > div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}( \\(.+\\))?$`) }) })
    .locator('dd');

/** Signs up and opens a blank solo bill. */
async function openNewSolo(page: Page, info: TestInfo): Promise<void> {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
}

/**
 * How far `lower` starts below the end of `upper`, in pixels (negative when they overlap or are the
 * wrong way round). Both are measured in the same instant, so scrolling can't skew the answer.
 */
async function gapBelow(upper: Locator, lower: Locator): Promise<number> {
  const lowerElement = await lower.elementHandle();
  try {
    return await upper.evaluate((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().bottom, lowerElement);
  } finally {
    await lowerElement.dispose();
  }
}

// ======================================================================
// Tax and tip start empty (US-05 #15)
// ======================================================================

test('US-05 #15 typing 5 in the empty tax box shows 5, and Calculate uses 5%', async ({ page }, info) => {
  await openNewSolo(page, info);
  const tax = chargeBox(page, 'Tax');
  await expect(tax).toHaveValue('');
  await expect(tax).toHaveAttribute('placeholder', '0');
  await page.getByLabel('Item 1 price').fill('100');

  // Left blank, the tax counts as 0.
  await calculate(page);
  await expect(totalLine(page, 'Tax')).toHaveText('$0.00');
  await expect(grandTotal(page)).toHaveText('$100.00');
  await expect(page.locator('.field-error')).toHaveCount(0);

  // Typing 5 gives "5", not "05", and the tax is 5% of the items.
  await tax.pressSequentially('5');
  await expect(tax).toHaveValue('5');
  await calculate(page);
  await expect(totalLine(page, 'Tax')).toHaveText('$5.00');
  await expect(grandTotal(page)).toHaveText('$105.00');
});

test('US-05 #15 typing 10 in the empty tip box shows 10, and Calculate uses 10% of the items', async ({ page }, info) => {
  await openNewSolo(page, info);
  const tip = chargeBox(page, 'Tip');
  await expect(tip).toHaveValue('');
  await expect(tip).toHaveAttribute('placeholder', '0');
  await page.getByLabel('Item 1 price').fill('100');

  // Left blank, the tip counts as 0.
  await calculate(page);
  await expect(totalLine(page, 'Tip')).toHaveText('$0.00');
  await expect(grandTotal(page)).toHaveText('$100.00');

  await tip.pressSequentially('10');
  await expect(tip).toHaveValue('10');
  await calculate(page);
  await expect(totalLine(page, 'Tip')).toHaveText('$10.00');
  await expect(grandTotal(page)).toHaveText('$110.00');
});

// ======================================================================
// A field's error goes as soon as that field is edited (US-26 #9)
// ======================================================================

for (const via of ['Calculate', 'Save bill'] as const) {
  test(`US-26 #9 a price error from ${via} disappears as soon as the price is edited, before pressing ${via} again`, async ({ page }, info) => {
    await openNewSolo(page, info);
    const price = page.getByLabel('Item 1 price');
    await price.fill('abc');
    await page.getByRole('button', { name: via }).click();
    await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
    await expect(price).toHaveAttribute('aria-invalid', 'true');
    await expect(price).toHaveAccessibleDescription(MSG.price);

    // One keystroke in that box is enough: nothing else is pressed.
    await price.pressSequentially('1');
    await expect(page.getByText(MSG.price, { exact: true })).toHaveCount(0);
    await expect(price).not.toHaveAttribute('aria-invalid', 'true');
    await expect(price).not.toHaveAttribute('aria-describedby', /.+/);
    // Nothing was worked out meanwhile.
    await expect(grandTotal(page)).toHaveCount(0);
    await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  });
}

test('US-26 #9 a price that is still wrong gets its message back on the next Calculate', async ({ page }, info) => {
  await openNewSolo(page, info);
  const price = page.getByLabel('Item 1 price');
  await price.fill('abc');
  await calculate(page);
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();

  await price.pressSequentially('1');
  await expect(page.getByText(MSG.price, { exact: true })).toHaveCount(0);
  await calculate(page);
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
  await expect(grandTotal(page)).toHaveCount(0);

  // Fixing it clears the message straight away, and Calculate then gives the total.
  await price.fill('12.50');
  await expect(page.getByText(MSG.price, { exact: true })).toHaveCount(0);
  await calculate(page);
  await expect(grandTotal(page)).toHaveText('$12.50');
});

test("US-26 #9 editing one field leaves another field's message in place", async ({ page }, info) => {
  await openNewSolo(page, info);
  const price = page.getByLabel('Item 1 price');
  await price.fill('abc');
  await setCharge(page, 'Tax', 'Percentage', '-1');
  await calculate(page);
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
  await expect(page.getByText(MSG.taxPercent, { exact: true })).toBeVisible();

  await price.fill('12.50');
  await expect(page.getByText(MSG.price, { exact: true })).toHaveCount(0);
  await expect(page.getByText(MSG.taxPercent, { exact: true })).toBeVisible();
  await expect(chargeBox(page, 'Tax')).toHaveAttribute('aria-invalid', 'true');

  await chargeBox(page, 'Tax').fill('5');
  await expect(page.getByText(MSG.taxPercent, { exact: true })).toHaveCount(0);
  await expect(page.locator('.field-error')).toHaveCount(0);
  await calculate(page);
  await expect(grandTotal(page)).toHaveText('$13.13');
});

/** One kind of box whose message must go as soon as the box is edited. */
interface EditCase {
  what: string;
  /** Gets the form ready (picks % or Amount, or "Other") and returns the box to type in. */
  box: (page: Page) => Promise<Locator>;
  bad: string;
  fix: string;
  message: string;
}

const pickMode = async (page: Page, name: ChargeName, mode: 'Percentage' | 'Amount'): Promise<Locator> => {
  await chargeGroup(page, name).getByRole('radio', { name: mode }).check();
  return chargeBox(page, name);
};

const EDIT_CASES: EditCase[] = [
  {
    what: 'the bill name',
    box: async (page) => page.getByLabel('Bill name'),
    bad: 'n'.repeat(61),
    fix: 'Lunch',
    message: 'Bill name can be at most 60 characters',
  },
  {
    what: 'an item name',
    box: async (page) => page.getByLabel('Item 1 name'),
    bad: 'i'.repeat(41),
    fix: 'Pasta',
    message: 'Item name can be at most 40 characters',
  },
  {
    what: 'other charges as an amount',
    box: (page) => pickMode(page, 'Other charges (optional)', 'Amount'),
    bad: 'abc',
    fix: '2',
    message: 'Other charges must be between 0.01 and 1,000,000.00, or left empty',
  },
  {
    what: 'other charges as a %',
    box: (page) => pickMode(page, 'Other charges (optional)', 'Percentage'),
    bad: '100.01',
    fix: '5',
    message: 'Other charges must be between 0.01% and 100%, or left empty',
  },
  {
    what: 'the tip as a %',
    box: (page) => pickMode(page, 'Tip', 'Percentage'),
    bad: '100.01',
    fix: '10',
    message: 'Tip must be between 0% and 100%, with at most 2 decimal places',
  },
  {
    what: 'the tip as an amount',
    box: (page) => pickMode(page, 'Tip', 'Amount'),
    bad: 'abc',
    fix: '3',
    message: 'Tip must be between 0.00 and 1,000,000.00, with at most 2 decimal places',
  },
  {
    what: 'the "Other" currency symbol',
    box: async (page) => {
      await page.getByLabel('Currency', { exact: true }).selectOption('other');
      return page.getByLabel('Currency symbol');
    },
    bad: 'abcd',
    fix: 'kr',
    message: 'Enter a currency symbol of up to 3 characters, with no digits',
  },
];

for (const c of EDIT_CASES) {
  test(`US-26 #9 the message for ${c.what} disappears as soon as that box is edited`, async ({ page }, info) => {
    await openNewSolo(page, info);
    await page.getByLabel('Item 1 price').fill('10');
    const box = await c.box(page);
    await box.fill(c.bad);
    await calculate(page);
    await expect(page.getByText(c.message, { exact: true })).toBeVisible();
    await expect(box).toHaveAttribute('aria-invalid', 'true');

    await box.fill(c.fix);
    await expect(page.getByText(c.message, { exact: true })).toHaveCount(0);
    await expect(box).not.toHaveAttribute('aria-invalid', 'true');
  });
}

// ======================================================================
// "Save bill" sits under the results (US-26 #11)
// ======================================================================

test.describe('US-26 #11 Save bill is below the results', () => {
  test('on a new bill on a computer, Calculate is above the results and Save bill below them', async ({ page }, info) => {
    await openNewSolo(page, info);
    const calculateButton = page.getByRole('button', { name: 'Calculate' });
    await page.getByLabel('Item 1 price').fill('20');
    // Before Calculate the results area only says "Press Calculate to see results", and Save is still under it.
    await expect(page.getByText('Press Calculate to see results')).toBeVisible();
    expect(await gapBelow(calculateButton, results(page)), 'results under Calculate (before)').toBeGreaterThanOrEqual(0);
    expect(await gapBelow(results(page), saveButton(page)), 'Save under the results (before)').toBeGreaterThanOrEqual(0);

    await calculate(page);
    await expect(grandTotal(page)).toHaveText('$20.00');
    expect(await gapBelow(calculateButton, results(page)), 'results under Calculate (after)').toBeGreaterThanOrEqual(0);
    expect(await gapBelow(results(page), saveButton(page)), 'Save under the results (after)').toBeGreaterThanOrEqual(0);
  });

  test('on a new bill on a phone, Save bill is below the results', async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openNewSolo(page, info);
    await page.getByLabel('Item 1 price').fill('20');
    await calculate(page);
    await expect(grandTotal(page)).toHaveText('$20.00');
    expect(await gapBelow(results(page), saveButton(page))).toBeGreaterThanOrEqual(0);
  });

  test('on a saved bill, Save bill is still below the results', async ({ page }, info) => {
    await openNewSolo(page, info);
    await page.getByLabel('Bill name').fill('Saved under the receipt');
    await page.getByLabel('Item 1 price').fill('20');
    await saveButton(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Saved under the receipt' })).toBeVisible();
    await expect(page).toHaveURL(/\/solo\/\d+$/);
    await expect(grandTotal(page)).toHaveText('$20.00');
    expect(await gapBelow(results(page), saveButton(page))).toBeGreaterThanOrEqual(0);
  });
});

// ======================================================================
// Results show the rate of each % line (US-26 #10)
// ======================================================================

test('US-26 #10 a % tax and a % tip on items + tax show "Tax (5%)" and "Tip (15% of items + tax)"', async ({ page }, info) => {
  await openNewSolo(page, info);
  await page.getByLabel('Item 1 price').fill('100');
  await setCharge(page, 'Tax', 'Percentage', '5');
  await setCharge(page, 'Tip', 'Percentage', '15');
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await calculate(page);

  // Subtotal and Total are as before, and the amounts themselves carry no rate.
  await expect(totalLabels(page)).toHaveText(['Subtotal', 'Tax (5%)', 'Other charges', 'Tip (15% of items + tax)', 'Total']);
  await expect(totalAmounts(page)).toHaveText(['$100.00', '$5.00', '$0.00', '$15.75', '$120.75']);
});

test('US-26 #10 other charges of 10% and a tip of 15% on items show "Other charges (10%)" and "Tip (15% of items)"', async ({ page }, info) => {
  await openNewSolo(page, info);
  await page.getByLabel('Item 1 price').fill('100');
  await setCharge(page, 'Tax', 'Amount', '2');
  await setCharge(page, 'Other charges (optional)', 'Percentage', '10');
  await setCharge(page, 'Tip', 'Percentage', '15');
  await calculate(page);

  await expect(totalLabels(page)).toHaveText(['Subtotal', 'Tax', 'Other charges (10%)', 'Tip (15% of items)', 'Total']);
  await expect(totalAmounts(page)).toHaveText(['$100.00', '$2.00', '$10.00', '$15.00', '$127.00']);
});

test('US-26 #10 charges entered as amounts have no rate on their lines', async ({ page }, info) => {
  await openNewSolo(page, info);
  await page.getByLabel('Item 1 price').fill('100');
  await setCharge(page, 'Tax', 'Amount', '5');
  await setCharge(page, 'Other charges (optional)', 'Amount', '2');
  await setCharge(page, 'Tip', 'Amount', '3');
  await calculate(page);

  await expect(totalLabels(page)).toHaveText(['Subtotal', 'Tax', 'Other charges', 'Tip', 'Total']);
  await expect(totalAmounts(page)).toHaveText(['$100.00', '$5.00', '$2.00', '$3.00', '$110.00']);
});

// ======================================================================
// Passwords: eye button and hint (US-01 #7, #11)
// ======================================================================

const PASSWORD_PAGES = [
  { path: '/login', heading: 'Log in', box: 'Password' },
  { path: '/signup', heading: 'Create an account', box: 'Password' },
  { path: '/reset', heading: 'Reset your password', box: 'New password' },
] as const;

for (const { path, heading, box } of PASSWORD_PAGES) {
  test(`US-01 #11 the eye button on the "${heading}" page shows and hides the password`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    const input = page.getByLabel(box, { exact: true });
    await input.fill('open sesame 1');

    // Hidden to begin with.
    const show = page.getByRole('button', { name: 'Show password', exact: true });
    await expect(input).toHaveAttribute('type', 'password');
    // The label says what the button does next; there's no separate pressed state.
    await expect(show).not.toHaveAttribute('aria-pressed');
    await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveCount(0);

    // Shown: what was typed can be read, and the button now offers to hide it.
    await show.click();
    const hide = page.getByRole('button', { name: 'Hide password', exact: true });
    await expect(hide).not.toHaveAttribute('aria-pressed');
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toHaveValue('open sesame 1');
    await expect(page.getByRole('button', { name: 'Show password', exact: true })).toHaveCount(0);

    // Hidden again.
    await hide.click();
    await expect(input).toHaveAttribute('type', 'password');
    await expect(page.getByRole('button', { name: 'Show password', exact: true })).toBeVisible();
    await expect(input).toHaveValue('open sesame 1');
    // The eye only toggles: it never submits the form.
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  });
}

test('US-01 #11 the eye button can be reached and used with the keyboard', async ({ page, browserName }) => {
  // Safari on a Mac moves between buttons with Option+Tab.
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  const input = page.getByLabel('Password', { exact: true });
  await input.fill('open sesame 1');
  await input.focus();
  await page.keyboard.press(tab);
  const eye = page.getByRole('button', { name: 'Show password', exact: true });
  await expect(eye).toBeFocused();
  await expect.poll(() => eye.evaluate((el) => getComputedStyle(el).outlineStyle), { message: 'visible focus outline' }).not.toBe('none');

  await page.keyboard.press('Enter');
  await expect(input).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Show password', exact: true })).toBeFocused();
});

test('US-01 #7 the hint under the sign-up password box reads "At least 8 characters"', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
  await expect(page.getByText('At least 8 characters', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAccessibleDescription('At least 8 characters');
  // The old wording is gone.
  await expect(page.getByText('8–128', { exact: false })).toHaveCount(0);
});

test('US-03 #4 the hint under the new-password box on the reset page also reads "At least 8 characters"', async ({ page }) => {
  await page.goto('/reset');
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
  await expect(page.getByText('At least 8 characters', { exact: true })).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveAccessibleDescription('At least 8 characters');
  await expect(page.getByText('8–128', { exact: false })).toHaveCount(0);
});

// ======================================================================
// The Account page is now Settings (US-34 #1, #5)
// ======================================================================

test('US-34 #1 the navigation says Settings, and no link says Account', async ({ page }, info) => {
  await signUpFast(page, info);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Account' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Account' })).toHaveCount(0);

  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveTitle('Settings · Bill Splitter');
});

test('US-34 #5 the old /account address goes to /settings', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});

// ======================================================================
// The app is called "Bill Splitter" everywhere (US-34 #6)
// ======================================================================

test('US-34 #6 tab titles end with "· Bill Splitter" and nothing says "Bill Splitting Calculator" (logged out)', async ({ page }) => {
  for (const [path, title] of [
    ['/login', 'Log in'],
    ['/signup', 'Create an account'],
    ['/reset', 'Reset your password'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page, path).toHaveTitle(`${title} · Bill Splitter`);
    await expect(page.getByText(/Bill Splitting Calculator/i), path).toHaveCount(0);
  }
  // The brand on the log-in page.
  await page.goto('/login');
  await expect(page.getByText('Bill Splitter', { exact: true })).toBeVisible();
});

test('US-34 #6 tab titles end with "· Bill Splitter" and nothing says "Bill Splitting Calculator" (logged in)', async ({ page }, info) => {
  await signUpFast(page, info);
  for (const [path, title] of [
    ['/', 'Dashboard'],
    ['/solo', 'Solo bills'],
    ['/solo/new', 'New solo bill'],
    ['/groups', 'Groups'],
    ['/groups/new', 'Create group'],
    ['/join', 'Use an invite code'],
    ['/settings', 'Settings'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page, path).toHaveTitle(`${title} · Bill Splitter`);
    await expect(page.getByText(/Bill Splitting Calculator/i), path).toHaveCount(0);
  }
  // The brand in the sidebar.
  await expect(page.locator('.sidebar').getByText('Bill Splitter', { exact: true })).toBeVisible();
});

test("US-34 #6 an invite link's tab title and brand say Bill Splitter too", async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Branded', '$', ['Ali']);
  const { group } = await api<{ group: { members: { name: string; inviteCode: string | null }[] } }>(page, 'get', `/groups/${groupId}`);
  const code = group.members.find((m) => m.name === 'Ali')?.inviteCode;
  expect(code).toBeTruthy();

  await page.context().clearCookies();
  await page.goto(`/invite/${code}`);
  await expect(page.getByRole('heading', { level: 1, name: "Ali, join your friends' groups" })).toBeVisible();
  await expect(page).toHaveTitle('Invite for Ali · Bill Splitter');
  await expect(page.getByText('Bill Splitter', { exact: true })).toBeVisible();
  await expect(page.getByText(/Bill Splitting Calculator/i)).toHaveCount(0);
});

// ======================================================================
// PKR is in the currency list (US-06 #1, #2)
// ======================================================================

test('US-06 #2 PKR is in the currency picker, and a solo bill in PKR shows amounts as "PKR 12.50"', async ({ page }, info) => {
  await openNewSolo(page, info);
  const currency = page.getByLabel('Currency', { exact: true });
  // "PKR" in capitals, listed after Rs.
  const options = await currency.locator('option').allTextContents();
  expect(options).toContain('PKR');
  expect(options).not.toContain('Pkr');
  expect(options.indexOf('PKR')).toBe(options.indexOf('Rs') + 1);

  await currency.selectOption('PKR');
  await page.getByLabel('Bill name').fill('Karachi lunch');
  await page.getByLabel('Item 1 price').fill('12.50');
  await calculate(page);
  await expect(totalLine(page, 'Subtotal')).toHaveText('PKR 12.50');
  await expect(grandTotal(page)).toHaveText('PKR 12.50');

  // Saved, it is kept in PKR and shown that way in the history.
  await saveButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Karachi lunch' })).toBeVisible();
  await expect(grandTotal(page)).toHaveText('PKR 12.50');
  await page.getByRole('link', { name: 'Solo bills' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  const row = page.getByRole('link', { name: /Karachi lunch/ });
  await expect(row).toContainText('PKR 12.50');
  const { bills } = await api<{ bills: { currency: string; totalCents: number }[] }>(page, 'get', '/solo-bills');
  expect(bills).toEqual([expect.objectContaining({ currency: 'PKR', totalCents: 1250 })]);
});

// ======================================================================
// A failed save shows its alert just above "Save bill" (US-27 #1)
// ======================================================================

test('US-27 #1 when the server cannot be reached, the alert sits just above the Save bill button and the inputs stay', async ({ page }, info) => {
  await openNewSolo(page, info);
  await page.getByLabel('Item 1 price').fill('12.50');
  await calculate(page);
  await expect(grandTotal(page)).toHaveText('$12.50');

  await page.route('**/api/solo-bills', (route) => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()));
  await saveButton(page).click();
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText(MSG.offline);
  await expect(page).toHaveURL(/\/solo\/new$/);
  await expect(page.getByLabel('Item 1 price')).toHaveValue('12.50');

  // Under the receipt, with the alert right on top of the button it belongs to.
  expect(await gapBelow(results(page), alert), 'alert under the results').toBeGreaterThanOrEqual(0);
  const gap = await gapBelow(alert, saveButton(page));
  expect(gap, 'Save bill under the alert').toBeGreaterThanOrEqual(0);
  expect(gap, 'Save bill right under the alert').toBeLessThan(40);
});
