// Browser proofs for the acceptance criteria in docs/user-stories.md that are about what the
// screen shows (accounts, privacy, solo bills, input messages, saving, layout, appearance).
// Message texts are written out in full on purpose: they are the words the docs promise.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PASSWORD, api, expectNoHorizontalScroll, makeGroup, signUpFast, uniqueName } from './helpers.js';

// ---------- Messages (as written in the docs and shared rules) ----------

const MSG = {
  username: 'Enter a username of 3 to 30 English letters, numbers or underscores, like omar_99',
  passwordShort: 'Password must be at least 8 characters',
  passwordLong: 'Password can be at most 128 characters',
  currency: 'Enter a currency symbol of up to 3 characters, with no digits',
  billName: 'Bill name can be at most 60 characters',
  itemName: 'Item name can be at most 40 characters',
  price: 'Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places',
  taxPercent: 'Tax must be between 0% and 100%, with at most 2 decimal places',
  taxAmount: 'Tax must be between 0.00 and 1,000,000.00, with at most 2 decimal places',
  tipPercent: 'Tip must be between 0% and 100%, with at most 2 decimal places',
  tipAmount: 'Tip must be between 0.00 and 1,000,000.00, with at most 2 decimal places',
  noItems: 'Add at least one item',
  tooMany: 'A bill can have at most 200 items',
  notFound: 'That bill could not be found',
} as const;

// ---------- Small helpers ----------

type Mode = 'percent' | 'amount';
type ChargeLabel = 'Tax' | 'Other charges' | 'Tip';

const GROUP_NAME: Record<ChargeLabel, string> = { Tax: 'Tax', 'Other charges': 'Other charges (optional)', Tip: 'Tip' };

function chargeGroup(page: Page, label: ChargeLabel): Locator {
  return page.getByRole('group', { name: GROUP_NAME[label], exact: true });
}

function chargeBox(page: Page, label: ChargeLabel): Locator {
  return chargeGroup(page, label).getByRole('textbox');
}

async function setCharge(page: Page, label: ChargeLabel, mode: Mode, value: string): Promise<void> {
  const group = chargeGroup(page, label);
  await group.getByRole('radio', { name: mode === 'percent' ? 'Percentage' : 'Amount' }).check();
  await group.getByRole('textbox').fill(value);
}

const calculate = (page: Page) => page.getByRole('button', { name: 'Calculate' }).click();
const saveBill = (page: Page) => page.getByRole('button', { name: 'Save bill' }).click();
/** The results area of the editor: a region named "Results" (under the form, or beside it on a computer). */
const results = (page: Page) => page.getByRole('region', { name: 'Results' });
/** A saved bill's read-only receipt: a region named "Bill". */
const receipt = (page: Page) => page.getByRole('region', { name: 'Bill', exact: true });
const grandTotal = (page: Page) => page.getByTestId('grand-total');

type LineName = 'Subtotal' | 'Tax' | 'Other charges' | 'Tip' | 'Total';

/**
 * One line of the totals: Subtotal, Tax, Other charges, Tip or Total. A % line also carries its
 * rate in its label ("Tax (5%)", "Tip (15% of items + tax)"), so the name is matched with or without one.
 * The totals sit in the editor's "Results" region by default, or in `within` (e.g. a saved bill's receipt).
 */
function totalRow(page: Page, name: LineName, within: Locator = results(page)): Locator {
  return within
    .locator('dl.totals > div')
    .filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}( \\(.+\\))?$`) }) });
}

/** The value cell of one line of the totals. */
const totalLine = (page: Page, name: LineName, within?: Locator) => totalRow(page, name, within).locator('dd');

/** The label cell of one line of the totals. */
const totalLabel = (page: Page, name: LineName, within?: Locator) => totalRow(page, name, within).locator('dt');

/**
 * What a charge's line should read: its name, plus its rate when it is a non-zero % (a tip also says what it
 * is a % of). An amount, and a blank or 0% charge, show no rate (US-26 #10).
 */
function lineLabel(name: ChargeLabel, charge: { mode: Mode; value: string }, tipOn: 'items' | 'items_tax' = 'items'): string {
  if (charge.mode === 'amount' || charge.value.trim() === '' || Number(charge.value) === 0) return name;
  const of = name === 'Tip' ? ` of ${tipOn === 'items_tax' ? 'items + tax' : 'items'}` : '';
  return `${name} (${charge.value}%${of})`;
}

/** Opens a blank solo bill. Browsers may ask about unsaved changes when a test reloads; always agree. */
async function openNewSolo(page: Page): Promise<void> {
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
}

async function newSoloPage(page: Page, info: Parameters<typeof signUpFast>[1]): Promise<string> {
  page.on('dialog', (d) => void d.accept());
  const username = await signUpFast(page, info);
  await openNewSolo(page);
  return username;
}

async function fillPrices(page: Page, prices: string[]): Promise<void> {
  for (let i = 0; i < prices.length; i += 1) {
    if (i > 0) await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByLabel(`Item ${i + 1} price`).fill(prices[i]);
  }
}

async function savedBills(page: Page) {
  return (await api<{ bills: { id: string; name: string; currency: string; totalCents: number }[] }>(page, 'get', '/solo-bills')).bills;
}

/**
 * Types each bad value into `field`, presses `via`, and checks the message sits next to the field,
 * no result is shown, and (for Save) the page did not move on. Then fixes the field with `fix`
 * (its message must go at once, before Calculate) and presses Calculate, so each bad value is
 * proved on its own and not by a leftover message.
 */
async function expectRejected(page: Page, field: Locator, message: string, bad: string[], fix: string, via: 'Calculate' | 'Save bill'): Promise<void> {
  for (const value of bad) {
    await field.fill(value);
    await page.getByRole('button', { name: via }).click();
    await expect(page.getByText(message, { exact: true }), `"${value}" via ${via}`).toBeVisible();
    await expect(field, `"${value}" via ${via}`).toHaveAccessibleDescription(message);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(grandTotal(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/solo\/new$/);
    await field.fill(fix);
    // The message goes as soon as that field is edited, before Calculate is pressed (US-26 #9).
    await expect(page.getByText(message, { exact: true }), `"${value}" fixed, before Calculate`).toHaveCount(0);
    await expect(field).not.toHaveAttribute('aria-invalid', 'true');
    await calculate(page);
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await expect(grandTotal(page)).toBeVisible();
  }
}

// ======================================================================
// Accounts
// ======================================================================

test.describe('US-01 #5 bad usernames', () => {
  const bad: [string, string][] = [
    ['2 characters', 'sa'],
    ['an exclamation mark', 'sana!'],
    ['a space', 'sa na'],
    ['31 characters', 'a'.repeat(31)],
    ['blank', ''],
  ];
  for (const [what, username] of bad) {
    test(`US-01 #5 sign-up refuses a username with ${what}`, async ({ page }) => {
      await page.goto('/signup');
      await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByText(MSG.username, { exact: true })).toBeVisible();
      await expect(page.getByLabel('Username')).toHaveAccessibleDescription(new RegExp(MSG.username));
      // The Dashboard is not reached and no account was created (nobody is logged in).
      await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
      expect((await page.request.get('/api/me')).ok()).toBe(false);
    });
  }
});

test.describe('US-01 #7 bad passwords', () => {
  const bad: [string, string, string, string][] = [
    ['blank', '', MSG.passwordShort, MSG.passwordLong],
    ['7 characters', 'abcdefg', MSG.passwordShort, MSG.passwordLong],
    ['129 characters', 'p'.repeat(129), MSG.passwordLong, MSG.passwordShort],
  ];
  for (const [what, password, message, otherMessage] of bad) {
    test(`US-01 #7 sign-up refuses a password that is ${what}`, async ({ page }, info) => {
      const username = uniqueName('pw', info);
      await page.goto('/signup');
      await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create account' }).click();
      // Too short and too long each get their own message, tied to the box, and the hint stays.
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(page.getByText(otherMessage, { exact: true })).toHaveCount(0);
      await expect(page.getByLabel('Password', { exact: true })).toHaveAccessibleDescription(new RegExp(message));
      await expect(page.getByText('At least 8 characters', { exact: true })).toBeVisible();
      // No account was created: nobody is logged in and the username is still free.
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toHaveCount(0);
      expect((await page.request.get('/api/me')).ok()).toBe(false);
      expect((await page.request.post('/api/auth/signup', { data: { username, password: PASSWORD } })).status()).toBe(201);
    });
  }
});

test.describe('US-01 #8 password limits', () => {
  // Spaces and symbols count like any other character.
  for (const [what, password] of [['8', 'a b!c@d#'], ['128', 'x y!'.repeat(32)]] as const) {
    test(`US-01 #8 a password of exactly ${what} characters is accepted`, async ({ page }, info) => {
      expect(Array.from(password)).toHaveLength(Number(what));
      const username = uniqueName('lim', info);
      await page.goto('/signup');
      await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
      await expect(page.getByText(MSG.passwordShort, { exact: true })).toHaveCount(0);
      await expect(page.getByText(MSG.passwordLong, { exact: true })).toHaveCount(0);
      // The whole password was kept: it logs in again.
      await page.context().clearCookies();
      const login = await page.request.post('/api/auth/login', { data: { username, password } });
      expect(login.ok()).toBe(true);
    });
  }
});

test('US-03 #4 a bad new password is refused and the old password still works', async ({ page }) => {
  const username = uniqueName('rp', test.info());
  const signup = await page.request.post('/api/auth/signup', { data: { username, password: PASSWORD } });
  expect(signup.status()).toBe(201);
  const { recoveryCode } = (await signup.json()) as { recoveryCode: string };
  await page.context().clearCookies();

  for (const [what, newPassword, message, otherMessage] of [
    ['blank', '', MSG.passwordShort, MSG.passwordLong],
    ['7 characters', 'abcdefg', MSG.passwordShort, MSG.passwordLong],
    ['129 characters', 'p'.repeat(129), MSG.passwordLong, MSG.passwordShort],
  ] as const) {
    await page.goto('/reset');
    await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Recovery code').fill(recoveryCode);
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();
    // Too short and too long each get their own message, and only that one.
    await expect(page.getByText(message, { exact: true }), what).toBeVisible();
    await expect(page.getByText(otherMessage, { exact: true }), what).toHaveCount(0);
    // No new recovery code was issued and nobody was logged in.
    await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toHaveCount(0);
    expect((await page.request.get('/api/me')).ok(), what).toBe(false);
  }

  // The old password still logs in (through the page).
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  // ...and the recovery code was not used up by the refused resets.
  await page.context().clearCookies();
  const again = await page.request.post('/api/auth/reset', { data: { username, recoveryCode, newPassword: 'a brand new one' } });
  expect(again.ok()).toBe(true);
});

// ======================================================================
// Privacy
// ======================================================================

test('US-04 #1 logged out, typing a group or solo bill address shows the Log in page and no data', async ({ page }) => {
  const dataResponses: { url: string; status: number }[] = [];
  page.on('response', (r) => {
    if (/\/api\/(groups|solo-bills)/.test(r.url())) dataResponses.push({ url: r.url(), status: r.status() });
  });
  for (const path of ['/groups/123', '/solo/123']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await expect(page.getByText(MSG.notFound)).toHaveCount(0);
    await expect(page.getByText('This group no longer exists')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Solo bills' })).toHaveCount(0);
  }
  // If the page asked the server for anything private, the server refused.
  for (const r of dataResponses) expect(r.status, r.url).toBe(401);
});

test("US-04 #2 another account's solo bill is not shown, on its receipt address or its edit address", async ({ page }, info) => {
  await signUpFast(page, info, 'owner');
  const { bill } = await api<{ bill: { id: string } }>(page, 'post', '/solo-bills', {
    currency: '$',
    bill: {
      name: 'Secret dinner',
      items: [{ name: 'Wagyu', price: '123.45' }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
    },
  });

  // A different account signs up in the same browser and types the address.
  await page.context().clearCookies();
  await signUpFast(page, info, 'other');
  for (const path of [`/solo/${bill.id}`, `/solo/${bill.id}/edit`]) {
    await page.goto(path);
    await expect(page.getByText(MSG.notFound), path).toBeVisible();
    await expect(page.getByText('Secret dinner'), path).toHaveCount(0);
    await expect(page.getByText('Wagyu'), path).toHaveCount(0);
    await expect(page.getByText('123.45'), path).toHaveCount(0);
    await expect(page.getByLabel('Item 1 price'), path).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Edit bill' }), path).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete' }), path).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save bill' }), path).toHaveCount(0);
  }
});

// ======================================================================
// US-05 Total a solo bill (table-driven)
// ======================================================================

interface Charge {
  mode: Mode;
  value: string;
}
interface Totals {
  subtotal: string;
  tax: string;
  other: string;
  tip: string;
  total: string;
}
interface SoloCase {
  title: string;
  prices: string[];
  tax?: Charge;
  other?: Charge;
  tip?: Charge;
  tipOn?: 'items' | 'items_tax';
  expected: Totals;
  /** Criteria that say "no error is shown". */
  noError?: boolean;
}

const pc = (value: string): Charge => ({ mode: 'percent', value });
const am = (value: string): Charge => ({ mode: 'amount', value });

const SOLO_CASES: SoloCase[] = [
  {
    title: 'US-05 #1 items 12.50 + 7.50, tax 10%, other blank, tip 15% on items',
    prices: ['12.50', '7.50'],
    tax: pc('10'),
    tip: pc('15'),
    expected: { subtotal: '$20.00', tax: '$2.00', other: '$0.00', tip: '$3.00', total: '$25.00' },
  },
  {
    title: 'US-05 #2 items 12.50 + 7.50, tax 10%, other charges 5%, tip 15% on items',
    prices: ['12.50', '7.50'],
    tax: pc('10'),
    other: pc('5'),
    tip: pc('15'),
    expected: { subtotal: '$20.00', tax: '$2.00', other: '$1.00', tip: '$3.00', total: '$26.00' },
  },
  {
    title: 'US-05 #3 subtotal 100, tax 10.00 amount, tip 15% on items + tax',
    prices: ['100'],
    tax: am('10.00'),
    tip: pc('15'),
    tipOn: 'items_tax',
    expected: { subtotal: '$100.00', tax: '$10.00', other: '$0.00', tip: '$16.50', total: '$126.50' },
  },
  {
    title: 'US-05 #4 other charges 7.50 amount are not tipped on',
    prices: ['100'],
    tax: am('10.00'),
    other: am('7.50'),
    tip: pc('15'),
    tipOn: 'items_tax',
    expected: { subtotal: '$100.00', tax: '$10.00', other: '$7.50', tip: '$16.50', total: '$134.00' },
  },
  {
    title: 'US-05 #5 other charges 10% is of the items only, not items + tax',
    prices: ['100'],
    tax: pc('10'),
    other: pc('10'),
    expected: { subtotal: '$100.00', tax: '$10.00', other: '$10.00', tip: '$0.00', total: '$120.00' },
  },
  {
    title: 'US-05 #6 other charges 12.5% of 33.33 is 4.17 (half-up)',
    prices: ['33.33'],
    other: pc('12.5'),
    expected: { subtotal: '$33.33', tax: '$0.00', other: '$4.17', tip: '$0.00', total: '$37.50' },
  },
  {
    title: 'US-05 #7 tip 12.5% of 20.00 is 2.50',
    prices: ['20.00'],
    tip: pc('12.5'),
    expected: { subtotal: '$20.00', tax: '$0.00', other: '$0.00', tip: '$2.50', total: '$22.50' },
  },
  {
    title: 'US-05 #7 tax 8.25% of 20.00 is 1.65',
    prices: ['20.00'],
    tax: pc('8.25'),
    expected: { subtotal: '$20.00', tax: '$1.65', other: '$0.00', tip: '$0.00', total: '$21.65' },
  },
  {
    title: 'US-05 #8 other charges 5% of 0.01 is 0.00 with no error',
    prices: ['0.01'],
    other: pc('5'),
    expected: { subtotal: '$0.01', tax: '$0.00', other: '$0.00', tip: '$0.00', total: '$0.01' },
    noError: true,
  },
  {
    title: 'US-05 #9 other charges 0 (amount) means none, with no error',
    prices: ['10'],
    other: am('0'),
    expected: { subtotal: '$10.00', tax: '$0.00', other: '$0.00', tip: '$0.00', total: '$10.00' },
    noError: true,
  },
  {
    title: 'US-05 #9 other charges 0.00 (amount) means none, with no error',
    prices: ['10'],
    other: am('0.00'),
    expected: { subtotal: '$10.00', tax: '$0.00', other: '$0.00', tip: '$0.00', total: '$10.00' },
    noError: true,
  },
  {
    title: 'US-05 #9 other charges 0 (%) means none, with no error',
    prices: ['10'],
    other: pc('0'),
    expected: { subtotal: '$10.00', tax: '$0.00', other: '$0.00', tip: '$0.00', total: '$10.00' },
    noError: true,
  },
  {
    title: 'US-05 #10 tip 0 (%) shows 0.00 with no error',
    prices: ['10'],
    tip: pc('0'),
    expected: { subtotal: '$10.00', tax: '$0.00', other: '$0.00', tip: '$0.00', total: '$10.00' },
    noError: true,
  },
  {
    title: 'US-05 #10 tip 0 (amount) shows 0.00 with no error',
    prices: ['10'],
    tip: am('0'),
    expected: { subtotal: '$10.00', tax: '$0.00', other: '$0.00', tip: '$0.00', total: '$10.00' },
    noError: true,
  },
  {
    title: 'US-05 #12 subtotal 0.01 with other charges 1,000,000.00 totals 1,000,000.01',
    prices: ['0.01'],
    tax: am('0'),
    other: am('1000000.00'),
    tip: am('0'),
    expected: { subtotal: '$0.01', tax: '$0.00', other: '$1,000,000.00', tip: '$0.00', total: '$1,000,000.01' },
  },
];

for (const c of SOLO_CASES) {
  test(c.title, async ({ page }, info) => {
    await newSoloPage(page, info);
    await fillPrices(page, c.prices);
    if (c.tax) await setCharge(page, 'Tax', c.tax.mode, c.tax.value);
    if (c.other) await setCharge(page, 'Other charges', c.other.mode, c.other.value);
    if (c.tip) await setCharge(page, 'Tip', c.tip.mode, c.tip.value);
    if (c.tipOn === 'items_tax') await page.getByRole('radio', { name: 'Items + tax' }).check();
    if (c.tipOn === 'items') await page.getByRole('radio', { name: 'Items only' }).check();
    await calculate(page);

    await expect(totalLine(page, 'Subtotal')).toHaveText(c.expected.subtotal);
    await expect(totalLine(page, 'Tax')).toHaveText(c.expected.tax);
    await expect(totalLine(page, 'Other charges')).toHaveText(c.expected.other);
    await expect(totalLine(page, 'Tip')).toHaveText(c.expected.tip);
    await expect(totalLine(page, 'Total')).toHaveText(c.expected.total);
    await expect(grandTotal(page)).toHaveText(c.expected.total);
    // A % charge's line also says its rate (US-26 #10); an amount's line doesn't.
    if (c.tax) await expect(totalLabel(page, 'Tax')).toHaveText(lineLabel('Tax', c.tax));
    if (c.other) await expect(totalLabel(page, 'Other charges')).toHaveText(lineLabel('Other charges', c.other));
    if (c.tip) await expect(totalLabel(page, 'Tip')).toHaveText(lineLabel('Tip', c.tip, c.tipOn));
    if (c.noError) {
      await expect(page.locator('.field-error')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
  });
}

// ======================================================================
// US-06 Currency
// ======================================================================

test('US-06 #1 the currency picker offers the 13 symbols (PKR in capitals) and Other, nothing else', async ({ page }, info) => {
  await newSoloPage(page, info);
  const options = await page.getByLabel('Currency', { exact: true }).locator('option').allTextContents();
  expect(options).toEqual(['$', '€', '£', '¥', '₹', 'Rs', 'PKR', '₩', '₺', 'R$', 'CHF', 'AED', 'SAR', 'Other']);
  expect(options).toHaveLength(14);
});

test.describe('US-06 #4 a bad "Other" currency symbol is refused on Calculate and on Save', () => {
  for (const [what, symbol] of [['blank', ''], ['abcd', 'abcd'], ['R1', 'R1']] as const) {
    for (const via of ['Calculate', 'Save bill'] as const) {
      test(`US-06 #4 symbol ${what} (${via})`, async ({ page }, info) => {
        await newSoloPage(page, info);
        await page.getByLabel('Currency', { exact: true }).selectOption('other');
        await page.getByLabel('Currency symbol').fill(symbol);
        await page.getByLabel('Item 1 price').fill('5');
        await page.getByRole('button', { name: via }).click();
        await expect(page.getByText(MSG.currency, { exact: true })).toBeVisible();
        await expect(page.getByLabel('Currency symbol')).toHaveAccessibleDescription(MSG.currency);
        await expect(grandTotal(page)).toHaveCount(0);
        await expect(page).toHaveURL(/\/solo\/new$/);
        expect(await savedBills(page)).toEqual([]);
      });
    }
  }
});

// ======================================================================
// US-07 Save a solo bill to my history
// ======================================================================

/** The rows of the history ("Solo bills"), newest first. */
const historyRows = (page: Page) => page.getByRole('main').getByRole('listitem');

test('US-07 #1 saving a bill takes me to my history, where it is at the top (newest first), marked "Saved", with its name, date, currency and total', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Currency', { exact: true }).selectOption('€');
  await page.getByLabel('Bill name').fill('Older lunch');
  await page.getByLabel('Item 1 price').fill('8.00');
  await saveBill(page);
  // Taken to the history, not left on the form or sent to the bill.
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(historyRows(page)).toHaveCount(1);
  await expect(historyRows(page).first()).toContainText('Older lunch');
  await expect(historyRows(page).first().getByText('Saved', { exact: true })).toBeVisible();

  await openNewSolo(page);
  await page.getByLabel('Currency', { exact: true }).selectOption('€');
  await page.getByLabel('Bill name').fill('Pasta night');
  await page.getByLabel('Item 1 price').fill('12.50');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('7.25');
  await saveBill(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);

  const rows = historyRows(page);
  await expect(rows).toHaveCount(2);
  const top = rows.first();
  await expect(top).toContainText('Pasta night');
  await expect(top).toContainText(/\b\d{1,2} [A-Z][a-z]{2,3} \d{4}\b/);
  await expect(top).toContainText('€');
  await expect(top).toContainText('€19.75');
  // Only the bill just saved is marked; the older one is listed below it, unmarked.
  await expect(top.getByText('Saved', { exact: true })).toBeVisible();
  await expect(rows.nth(1)).toContainText('Older lunch');
  await expect(rows.nth(1).getByText('Saved', { exact: true })).toHaveCount(0);

  // The date shown is the bill's own date, in "21 Oct 2026" style.
  const [{ id }] = await savedBills(page);
  const detail = await api<{ bill: { date: string } }>(page, 'get', `/solo-bills/${id}`);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = detail.bill.date.slice(0, 10).split('-').map(Number);
  await expect(top).toContainText(`${d} ${months[m - 1]} ${y}`);
});

test('US-07 #3 a 61-character bill name is refused and nothing is saved', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Bill name').fill('n'.repeat(61));
  await page.getByLabel('Item 1 price').fill('5');
  await saveBill(page);
  await expect(page.getByText(MSG.billName, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Bill name')).toHaveAccessibleDescription(new RegExp(MSG.billName));
  await expect(page).toHaveURL(/\/solo\/new$/);
  await expect(page.getByText('Bill saved')).toHaveCount(0);
  expect(await savedBills(page)).toEqual([]);
});

test('US-07 #3 a bill name of exactly 60 characters is accepted', async ({ page }, info) => {
  await newSoloPage(page, info);
  const name = 'n'.repeat(60);
  await page.getByLabel('Bill name').fill(name);
  await page.getByLabel('Item 1 price').fill('5');
  await saveBill(page);
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByText(MSG.billName)).toHaveCount(0);
  const bills = await savedBills(page);
  expect(bills).toHaveLength(1);
  expect(bills[0].name).toBe(name);
});

test('US-07 #4 an invalid price stops Save: its message is shown and nothing is saved', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Bill name').fill('Never saved');
  await page.getByLabel('Item 1 price').fill('abc');
  await saveBill(page);
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Item 1 price')).toHaveAccessibleDescription(MSG.price);
  await expect(page).toHaveURL(/\/solo\/new$/);
  await expect(page.getByText('Bill saved')).toHaveCount(0);
  expect(await savedBills(page)).toEqual([]);
});

// ======================================================================
// US-08 Open, edit and delete saved solo bills
// ======================================================================

/**
 * Saves the bill used by the US-08 tests (every charge set; the total is 129.28) and returns its id.
 * Saving ends in the history ("Solo bills"), with the bill marked "Saved".
 */
async function saveChargedBill(page: Page): Promise<string> {
  await page.getByLabel('Bill name').fill('Charged dinner');
  await page.getByLabel('Item 1 price').fill('100.00');
  await setCharge(page, 'Tax', 'percent', '8.25');
  await setCharge(page, 'Other charges', 'amount', '7.50');
  await setCharge(page, 'Tip', 'percent', '12.5');
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await calculate(page);
  // 100.00 + tax 8.25 + other 7.50 + tip 12.5% of 108.25 (13.53) = 129.28
  await expect(grandTotal(page)).toHaveText('$129.28');
  await saveBill(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(historyRows(page).first().getByText('Saved', { exact: true })).toBeVisible();
  const [{ id }] = await savedBills(page);
  return id;
}

/** From the history, opens a saved bill: its read-only receipt, titled with the bill's name. */
async function openFromHistory(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/solo\/\d+$/);
}

/** From a saved bill's receipt, presses "Edit bill": the form opens, titled "Edit <name>". */
async function openEditor(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Edit ${name}`, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/solo\/\d+\/edit$/);
}

test('US-08 #2 "Edit bill" opens the form with every input, the % / amount settings, the "tip on" choice and the results as saved, and "Cancel" goes back to the receipt', async ({ page }, info) => {
  await newSoloPage(page, info);
  const id = await saveChargedBill(page);
  await openFromHistory(page, 'Charged dinner');
  await openEditor(page, 'Charged dinner');

  await expect(page.getByLabel('Item 1 price')).toHaveValue('100.00');
  await expect(chargeBox(page, 'Tax')).toHaveValue('8.25');
  await expect(chargeGroup(page, 'Tax').getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(chargeBox(page, 'Other charges')).toHaveValue('7.50');
  await expect(chargeGroup(page, 'Other charges').getByRole('radio', { name: 'Amount' })).toBeChecked();
  await expect(chargeBox(page, 'Tip')).toHaveValue('12.5');
  await expect(chargeGroup(page, 'Tip').getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Items + tax' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Items only' })).not.toBeChecked();
  // And the results as saved.
  await expect(totalLine(page, 'Subtotal')).toHaveText('$100.00');
  await expect(totalLine(page, 'Tax')).toHaveText('$8.25');
  await expect(totalLine(page, 'Other charges')).toHaveText('$7.50');
  await expect(totalLine(page, 'Tip')).toHaveText('$13.53');
  await expect(grandTotal(page)).toHaveText('$129.28');
  // The rates are shown as saved, too: tax and tip are %, other charges is an amount.
  await expect(totalLabel(page, 'Tax')).toHaveText('Tax (8.25%)');
  await expect(totalLabel(page, 'Other charges')).toHaveText('Other charges');
  await expect(totalLabel(page, 'Tip')).toHaveText('Tip (12.5% of items + tax)');

  // The edit page has no Delete (that lives on the receipt), and both ways back lead to the receipt.
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Charged dinner/ })).toHaveAttribute('href', `/solo/${id}`);
  const cancel = page.getByRole('link', { name: 'Cancel' });
  await expect(cancel).toHaveAttribute('href', `/solo/${id}`);
  // "Cancel" goes back to the receipt, which still shows the bill as it was saved.
  await cancel.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Charged dinner', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/solo/${id}$`));
  await expect(page.getByRole('link', { name: 'Edit bill' })).toBeVisible();
  await expect(grandTotal(page)).toHaveText('$129.28');
});

test('US-08 #3 an invalid edit shows the same message as a new bill, and nothing is saved', async ({ page }, info) => {
  await newSoloPage(page, info);
  const id = await saveChargedBill(page);
  await openFromHistory(page, 'Charged dinner');
  await openEditor(page, 'Charged dinner');

  await page.getByLabel('Item 1 price').fill('abc');
  await saveBill(page);
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Item 1 price')).toHaveAccessibleDescription(MSG.price);
  // Still on the form, and the saved bill is exactly as it was.
  await expect(page).toHaveURL(/\/solo\/\d+\/edit$/);
  const detail = await api<{ bill: { totalCents: number } }>(page, 'get', `/solo-bills/${id}`);
  expect(detail.bill.totalCents).toBe(12928);
  const [row] = await savedBills(page);
  expect(row.totalCents).toBe(12928);
});

test('US-08 #4 editing other charges (value and % / amount) and saving recalculates the total', async ({ page }, info) => {
  await newSoloPage(page, info);
  const id = await saveChargedBill(page);
  await openFromHistory(page, 'Charged dinner');
  await openEditor(page, 'Charged dinner');

  // From 7.50 (amount) to 10 (%).
  await setCharge(page, 'Other charges', 'percent', '10');
  await saveBill(page);
  // 100.00 + 8.25 + 10.00 (10% of items) + 13.53 = 131.78
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(historyRows(page).first()).toContainText('$131.78');
  const detail = await api<{ bill: { totalCents: number } }>(page, 'get', `/solo-bills/${id}`);
  expect(detail.bill.totalCents).toBe(13178);

  // The receipt shows the new line and its rate.
  await openFromHistory(page, 'Charged dinner');
  await expect(totalLine(page, 'Other charges', receipt(page))).toHaveText('$10.00');
  await expect(totalLabel(page, 'Other charges', receipt(page))).toHaveText('Other charges (10%)');
  await expect(grandTotal(page)).toHaveText('$131.78');

  // Edited again, even after a reload, the new setting is what is shown.
  await openEditor(page, 'Charged dinner');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Charged dinner', exact: true })).toBeVisible();
  await expect(chargeBox(page, 'Other charges')).toHaveValue('10');
  await expect(chargeGroup(page, 'Other charges').getByRole('radio', { name: 'Percentage' })).toBeChecked();
});

test("US-08 #5 a saved bill's currency can't be changed while editing it: no picker is offered, and saving keeps it", async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Currency', { exact: true }).selectOption('€');
  await page.getByLabel('Bill name').fill('Euro dinner');
  await page.getByLabel('Item 1 price').fill('20');
  await saveBill(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(historyRows(page).first()).toContainText('€20.00');

  await openFromHistory(page, 'Euro dinner');
  await openEditor(page, 'Euro dinner');
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Currency symbol')).toHaveCount(0);
  await expect(page.getByRole('main').locator('select')).toHaveCount(0);
  await page.getByLabel('Item 1 price').fill('30');
  await saveBill(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(historyRows(page).first()).toContainText('€30.00');
  const [bill] = await savedBills(page);
  expect(bill).toMatchObject({ name: 'Euro dinner', currency: '€', totalCents: 3000 });
});

// ======================================================================
// US-25 Clear message for every invalid input
// ======================================================================

for (const via of ['Calculate', 'Save bill'] as const) {
  test(`US-25 #1 item price "abc", "-5", "1.234", "1000000.01" or blank gets the price message on ${via}`, async ({ page }, info) => {
    await newSoloPage(page, info);
    // The line has a name, so a blank price is a mistake on a line that counts. (A line with neither a
    // name nor a price is left out when calculating and saving: that is US-05 #16, proved in round2-bills.spec.ts.)
    await page.getByLabel('Item 1 name').fill('Pasta');
    const price = page.getByLabel('Item 1 price');
    await price.fill('10');
    await expectRejected(page, price, MSG.price, ['abc', '-5', '1.234', '1000000.01', ''], '10', via);
    if (via === 'Save bill') expect(await savedBills(page)).toEqual([]);
  });
}

for (const label of ['Tax', 'Tip'] as const) {
  const percentMsg = label === 'Tax' ? MSG.taxPercent : MSG.tipPercent;
  const amountMsg = label === 'Tax' ? MSG.taxAmount : MSG.tipAmount;

  test(`US-25 #3/#5 ${label} % of -1, 100.01 or 12.345 is refused`, async ({ page }, info) => {
    await newSoloPage(page, info);
    await page.getByLabel('Item 1 price').fill('10');
    await setCharge(page, label, 'percent', '5');
    await expectRejected(page, chargeBox(page, label), percentMsg, ['-1', '100.01', '12.345'], '5', 'Calculate');
    await expectRejected(page, chargeBox(page, label), percentMsg, ['-1', '100.01', '12.345'], '5', 'Save bill');
    expect(await savedBills(page)).toEqual([]);
  });

  test(`US-25 #4 ${label} % of exactly 0 or exactly 100 is accepted`, async ({ page }, info) => {
    await newSoloPage(page, info);
    await page.getByLabel('Item 1 price').fill('10');
    await setCharge(page, label, 'percent', '0');
    await calculate(page);
    await expect(grandTotal(page)).toHaveText('$10.00');
    await expect(page.locator('.field-error')).toHaveCount(0);
    await chargeBox(page, label).fill('100');
    await calculate(page);
    await expect(grandTotal(page)).toHaveText('$20.00');
    await expect(page.locator('.field-error')).toHaveCount(0);
  });

  test(`US-25 #6 ${label} amount of 1000000.01, -1, abc or 1.234 is refused`, async ({ page }, info) => {
    await newSoloPage(page, info);
    await page.getByLabel('Item 1 price').fill('10');
    await setCharge(page, label, 'amount', '5');
    await expectRejected(page, chargeBox(page, label), amountMsg, ['1000000.01', '-1', 'abc', '1.234'], '5', 'Calculate');
    await expectRejected(page, chargeBox(page, label), amountMsg, ['1000000.01', 'abc'], '5', 'Save bill');
    expect(await savedBills(page)).toEqual([]);
  });

  test(`US-25 #6 ${label} amount of exactly 0.00 or exactly 1,000,000.00 is accepted`, async ({ page }, info) => {
    await newSoloPage(page, info);
    await page.getByLabel('Item 1 price').fill('10');
    await setCharge(page, label, 'amount', '0.00');
    await calculate(page);
    await expect(grandTotal(page)).toHaveText('$10.00');
    await chargeBox(page, label).fill('1000000.00');
    await calculate(page);
    await expect(grandTotal(page)).toHaveText('$1,000,010.00');
    await expect(page.locator('.field-error')).toHaveCount(0);
  });
}

test('US-25 #9 other charges of exactly 0.01, 1,000,000.00, 0.01% or 100% are accepted', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Item 1 price').fill('10');
  const cases: [Mode, string, string, string][] = [
    ['amount', '0.01', '$0.01', '$10.01'],
    ['amount', '1000000.00', '$1,000,000.00', '$1,000,010.00'],
    ['percent', '0.01', '$0.00', '$10.00'],
    ['percent', '100', '$10.00', '$20.00'],
  ];
  for (const [mode, value, other, total] of cases) {
    await setCharge(page, 'Other charges', mode, value);
    await calculate(page);
    await expect(totalLine(page, 'Other charges'), `${value} ${mode}`).toHaveText(other);
    await expect(totalLabel(page, 'Other charges'), `${value} ${mode}`).toHaveText(lineLabel('Other charges', { mode, value }));
    await expect(grandTotal(page), `${value} ${mode}`).toHaveText(total);
    await expect(page.locator('.field-error')).toHaveCount(0);
  }
});

/** Opens a new bill page for a group with one friend. */
async function openGroupBill(page: Page, info: Parameters<typeof signUpFast>[1]) {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'No items group', '$', ['Ali']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: /Add bill/ })).toBeVisible();
  const took = page.getByRole('group', { name: 'Who took part' });
  for (const box of await took.getByRole('checkbox').all()) await box.check();
  await page.getByLabel('Who paid').selectOption({ label: username });
  return { username, groupId };
}

for (const split of ['equal', 'itemized'] as const) {
  test(`US-25 #10 a ${split} group bill with no items says "Add at least one item"`, async ({ page }, info) => {
    await openGroupBill(page, info);
    if (split === 'itemized') await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
    else await expect(page.getByRole('radio', { name: 'Equally' })).toBeChecked();
    await page.getByRole('button', { name: /Remove item 1/ }).click();
    await expect(page.locator('ol.items > li')).toHaveCount(0);
    await calculate(page);
    await expect(page.getByText(MSG.noItems, { exact: true })).toBeVisible();
    await expect(grandTotal(page)).toHaveCount(0);
    await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  });
}

test('US-25 #11 with 200 items, "+ Add item" says a bill can have at most 200 items and adds none', async ({ page }, info) => {
  test.setTimeout(120_000);
  await newSoloPage(page, info);
  const rows = page.locator('ol.items > li');
  const add = page.getByRole('button', { name: '+ Add item' });
  // Go from 1 row to 200 quickly: real clicks, one after the other, inside the page.
  await add.evaluate(async (button) => {
    for (let i = 0; i < 199; i += 1) {
      (button as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
  await expect(rows).toHaveCount(200);
  await expect(page.getByText(MSG.tooMany, { exact: true })).toHaveCount(0);

  // 200 lines, but all still empty: "+ Add item" goes to the first empty one instead.
  await add.click();
  await expect(page.getByLabel('Item 1 name', { exact: true })).toBeFocused();
  await expect(page.getByText(MSG.tooMany, { exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(200);

  // A bill with 200 items in use: no more can be added.
  const items = Array.from({ length: 200 }, (_, i) => ({ name: `Thing ${i + 1}`, price: '1' }));
  const { bill } = await api<{ bill: { id: string } }>(page, 'post', '/solo-bills', {
    currency: '$',
    bill: { name: 'Big shop', items, tax: { mode: 'amount', value: '0' }, otherCharges: { mode: 'amount', value: '' }, tip: { mode: 'amount', value: '0' }, tipOn: 'items' },
  });
  await page.goto(`/solo/${bill.id}/edit`);
  await expect(rows).toHaveCount(200);
  await add.click();
  await expect(page.getByText(MSG.tooMany, { exact: true })).toBeVisible();
  await expect(rows).toHaveCount(200);
  await expect(page.getByLabel('Item 201 price')).toHaveCount(0);
});

test('US-25 #14 a blank item name shows "Item N" by position', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByRole('button', { name: '+ Add item' }).click();
  for (const n of [1, 2, 3]) {
    await expect(page.getByLabel(`Item ${n} name`)).toHaveValue('');
    await expect(page.getByLabel(`Item ${n} name`)).toHaveAttribute('placeholder', `Item ${n}`);
  }
  // The number follows the position: remove the first and the old third is now Item 2.
  await page.getByLabel('Item 3 name').fill('Dessert');
  await page.getByRole('button', { name: 'Remove item 1' }).click();
  await expect(page.getByLabel('Item 2 name')).toHaveValue('Dessert');
  await expect(page.getByLabel('Item 1 name')).toHaveAttribute('placeholder', 'Item 1');
  await expect(page.getByLabel('Item 3 name')).toHaveCount(0);
});

test('US-25 #14 an item name of 41 characters is refused, exactly 40 is accepted', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Item 1 price').fill('4');
  const name = page.getByLabel('Item 1 name');
  await expectRejected(page, name, MSG.itemName, ['i'.repeat(41), 'i'.repeat(60)], 'i'.repeat(40), 'Calculate');
  await expectRejected(page, name, MSG.itemName, ['i'.repeat(41)], 'i'.repeat(40), 'Save bill');
  await expect(name).toHaveValue('i'.repeat(40));
  await expect(grandTotal(page)).toHaveText('$4.00');
  expect(await savedBills(page)).toEqual([]);
});

test('US-25 #15 odd input never makes the page show NaN, Infinity or undefined', async ({ page }, info) => {
  test.setTimeout(150_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await newSoloPage(page, info);

  const bad = /NaN|Infinity|undefined/;
  const expectClean = async (when: string) => {
    const text = await page.evaluate(() => document.body.innerText);
    expect(text, when).not.toMatch(bad);
    // Not blank or crashed: the page still has its heading and form.
    await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' }), when).toBeVisible();
    await expect(page.getByRole('button', { name: 'Calculate' }), when).toBeVisible();
  };

  await expectClean('fresh page');
  await calculate(page);
  await expectClean('empty price');

  const odd = ['NaN', 'Infinity', '-Infinity', 'undefined', 'null', '1e999', '1e5', '0x10', '.', '-', '--5', '٣', '9'.repeat(400), '0.'.padEnd(400, '0'), '   ', '1,2,3', '1.000,50'];
  for (const value of odd) {
    await page.getByLabel('Item 1 price').fill(value);
    await setCharge(page, 'Tax', 'percent', value);
    await setCharge(page, 'Other charges', 'percent', value);
    await setCharge(page, 'Tip', 'percent', value);
    await calculate(page);
    await expectClean(`percent boxes "${value.slice(0, 20)}"`);
    await setCharge(page, 'Tax', 'amount', value);
    await setCharge(page, 'Other charges', 'amount', value);
    await setCharge(page, 'Tip', 'amount', value);
    await saveBill(page);
    await expectClean(`amount boxes via Save "${value.slice(0, 20)}"`);
  }

  // The biggest valid bill the form allows shows real numbers, too.
  await page.getByLabel('Item 1 price').fill('1000000');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('1000000');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 3 price').fill('1000000');
  await setCharge(page, 'Tax', 'percent', '100');
  await setCharge(page, 'Other charges', 'percent', '100');
  await setCharge(page, 'Tip', 'percent', '100');
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await calculate(page);
  // 3,000,000 items + 3,000,000 tax + 3,000,000 other + tip 100% of (items + tax) 6,000,000
  await expect(grandTotal(page)).toHaveText('$15,000,000.00');
  await expectClean('largest valid bill');
  expect(await savedBills(page)).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// ======================================================================
// US-26 #6 results in view on a phone
// ======================================================================

test('US-26 #6 at 375 px wide, Calculate brings the results region into view', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await newSoloPage(page, info);
  await fillPrices(page, ['12.50', '7.50', '3.25', '9.00', '4.00', '5.00', '6.00', '7.00', '8.00', '9.00']);
  await setCharge(page, 'Tax', 'percent', '10');
  await setCharge(page, 'Other charges', 'percent', '5');
  await setCharge(page, 'Tip', 'percent', '15');
  // The form is taller than the screen, so back at the top the results are off screen.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(results(page)).not.toBeInViewport();
  // Enter in the bill name is Calculate (Enter in an item's price now moves to the next item). Using it
  // avoids Playwright scrolling the Calculate button into view for us.
  await page.getByLabel('Bill name').focus();
  await page.keyboard.press('Enter');
  await expect(grandTotal(page)).toBeVisible();
  await expect(results(page).getByRole('heading', { name: 'Results' })).toBeInViewport();
  await expect(grandTotal(page)).toBeInViewport();
});

// ======================================================================
// US-27 Saving fails
// ======================================================================

test('US-27 #1 when the server answers 503, the message shows and every input is kept', async ({ page }, info) => {
  await newSoloPage(page, info);
  await page.getByLabel('Bill name').fill('Kept on failure');
  await page.getByLabel('Item 1 price').fill('42.00');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 name').fill('Coffee');
  await page.getByLabel('Item 2 price').fill('3.50');
  await setCharge(page, 'Tax', 'percent', '8.25');
  await setCharge(page, 'Other charges', 'amount', '2.00');
  await setCharge(page, 'Tip', 'percent', '12.5');
  await page.getByRole('radio', { name: 'Items + tax' }).check();

  const down = "Couldn't save — the database isn't reachable. Try again in a moment.";
  await page.route('**/api/solo-bills', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: down, code: 'DB_DOWN' } }) })
      : route.continue(),
  );
  await saveBill(page);
  await expect(page.getByRole('alert')).toHaveText(down);
  await expect(page).toHaveURL(/\/solo\/new$/);
  await expect(page.getByLabel('Bill name')).toHaveValue('Kept on failure');
  await expect(page.getByLabel('Item 1 price')).toHaveValue('42.00');
  await expect(page.getByLabel('Item 2 name')).toHaveValue('Coffee');
  await expect(page.getByLabel('Item 2 price')).toHaveValue('3.50');
  await expect(chargeBox(page, 'Tax')).toHaveValue('8.25');
  await expect(chargeBox(page, 'Other charges')).toHaveValue('2.00');
  await expect(chargeBox(page, 'Tip')).toHaveValue('12.5');
  await expect(page.getByRole('radio', { name: 'Items + tax' })).toBeChecked();
  await page.unroute('**/api/solo-bills');
  expect(await savedBills(page)).toEqual([]);

  // Once the database is back, the same Save works.
  await saveBill(page);
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  expect(await savedBills(page)).toHaveLength(1);
});

// ======================================================================
// US-34 Layout and Settings
// ======================================================================

test('US-34 #3 the log-in, sign-up and reset pages never scroll sideways at 360 px', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const [path, heading] of [
    ['/login', 'Log in'],
    ['/signup', 'Create an account'],
    ['/reset', 'Reset your password'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  // ...also with the messages showing.
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
  await page.getByLabel('Username').fill('x'.repeat(31));
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(MSG.username, { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
  await page.getByLabel('Username').fill(uniqueName('nobody', info));
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Username or password is incorrect');
  await expectNoHorizontalScroll(page);
});

test('US-34 #3 the join page, a settle-up page and the Activity tab never scroll sideways at 360 px', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'A group with a rather long name for phones', 'CHF', ['Somebody with a long name', 'Another very long friend name']);
  await page.setViewportSize({ width: 360, height: 740 });

  // The join page is now "Use an invite code": one box and Continue, which opens /invite/<CODE>.
  const notFound = "That invite link isn't valid. Check the code and try again.";
  await page.goto('/join');
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Enter the invite code you were sent', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  // A code that matches nobody leads to the "not found" page, which fits too.
  await page.getByLabel('Invite code').fill('zzzz2345');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/invite\/ZZZZ2345$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
  await expect(page.getByText(notFound, { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(`/groups/${groupId}?tab=activity`);
  await expect(page.getByRole('heading', { level: 1, name: 'A group with a rather long name for phones' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('activity').first()).toBeVisible();
  expect(await page.getByTestId('activity').count()).toBeGreaterThanOrEqual(3);
  await expectNoHorizontalScroll(page);
});

test('US-34 #3 the Activity tab still fits at 360 px for a 30-character username with no spaces', async ({ page }, info) => {
  // 30 characters is the longest username the docs allow, and it has no place to wrap.
  const longUser = await signUpFast(page, info, 'sana_arshad_and_friends_');
  expect(longUser).toHaveLength(30);
  const { groupId } = await makeGroup(page, 'Long names', '$', ['Ali']);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`/groups/${groupId}?tab=activity`);
  await expect(page.getByRole('heading', { level: 1, name: 'Long names' })).toBeVisible();
  await expect(page.getByTestId('activity').first()).toContainText(longUser);
  await expectNoHorizontalScroll(page);
});

test('US-34 #5 the Settings page shows my username', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Username' }).getByText(username, { exact: true })).toBeVisible();
  // Appearance setting and Log out button are on the same page (US-34 #5).
  await expect(page.getByRole('radio', { name: 'Light' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
});

// ======================================================================
// US-35 Appearance
// ======================================================================

test('US-35 #2 on a dark device, choosing "Light" makes the app light', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signUpFast(page, info);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const darkBg = await bg();

  // What a light device looks like with the default "Device" setting.
  await page.emulateMedia({ colorScheme: 'light' });
  const lightBg = await bg();
  expect(lightBg).not.toBe(darkBg);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe(darkBg);

  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(bg).not.toBe(darkBg);
  await expect.poll(bg).toBe(lightBg);

  // It stays light on other pages, still on a dark device.
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).toBe(lightBg);
});
