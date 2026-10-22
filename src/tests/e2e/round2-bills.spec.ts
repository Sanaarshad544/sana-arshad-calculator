import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { api, expectNoA11yViolations, expectNoHorizontalScroll, makeGroup, signUpFast } from './helpers.js';

// Round 2 of the bill screens. A saved bill opens as a read-only receipt (with "Edit bill" and
// "Delete"); editing has its own page (…/edit) with Calculate, Results and "Save bill" in a side
// column; items are typed with Enter; tax, other charges and tip have a "%" / currency switch;
// group bills use name chips; and the currency has an info button. Every test name starts with
// the story and criterion it proves in docs/user-stories.md.

// ---------- Messages (as written in the docs) ----------

const MSG = {
  price: 'Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places',
  taxPercent: 'Tax must be between 0% and 100%, with at most 2 decimal places',
  noItems: 'Add at least one item',
  noParticipants: 'Choose who took part',
  noSharers: 'Choose who shared this item',
  fixedCurrency: 'A saved bill keeps its currency. To use a different one, delete this bill and add it again with the right currency.',
  equalHint: 'Everyone who took part pays the same share.',
  itemizedHint: 'Each person pays for the items they had, plus their part of tax, other charges and tip.',
  pressCalculate: 'Press Calculate to see results',
} as const;

// ---------- Bills made through the API ----------

type Mode = 'percent' | 'amount';
interface Charge {
  mode: Mode;
  value: string;
}
const pct = (value: string): Charge => ({ mode: 'percent', value });
const amt = (value: string): Charge => ({ mode: 'amount', value });

interface SoloSpec {
  name?: string;
  currency?: string;
  items: { name?: string; price: string }[];
  tax?: Charge;
  other?: Charge;
  tip?: Charge;
  tipOn?: 'items' | 'items_tax';
}

/** Saves a solo bill through the API and returns its id. */
async function makeSoloBill(page: Page, spec: SoloSpec): Promise<string> {
  const { bill } = await api<{ bill: { id: string } }>(page, 'post', '/solo-bills', {
    currency: spec.currency ?? '$',
    bill: {
      name: spec.name ?? '',
      items: spec.items.map((it) => ({ name: it.name ?? '', price: it.price })),
      tax: spec.tax ?? amt('0'),
      otherCharges: spec.other ?? amt(''),
      tip: spec.tip ?? amt('0'),
      tipOn: spec.tipOn ?? 'items',
    },
  });
  return bill.id;
}

interface GroupSpec {
  name: string;
  items: { name?: string; price: string; sharerIds?: string[] }[];
  tax?: Charge;
  other?: Charge;
  tip?: Charge;
  tipOn?: 'items' | 'items_tax';
  splitMode?: 'equal' | 'itemized';
  participantIds: string[];
  payerId: string;
}

/** Saves a group bill through the API and returns its id. */
async function makeGroupBill(page: Page, groupId: string, spec: GroupSpec): Promise<string> {
  const { billId } = await api<{ billId: string }>(page, 'post', `/groups/${groupId}/bills`, {
    bill: {
      name: spec.name,
      items: spec.items.map((it) => ({ name: it.name ?? '', price: it.price, ...(it.sharerIds ? { sharerIds: it.sharerIds } : {}) })),
      tax: spec.tax ?? amt('0'),
      otherCharges: spec.other ?? amt(''),
      tip: spec.tip ?? amt('0'),
      tipOn: spec.tipOn ?? 'items',
      splitMode: spec.splitMode ?? 'equal',
      participantIds: spec.participantIds,
      payerId: spec.payerId,
    },
  });
  return billId;
}

/** A solo bill with every kind of charge: a % tax, an amount of other charges and a % tip on items + tax. */
const CHARGED: SoloSpec = {
  name: 'Charged dinner',
  currency: 'Rs',
  items: [{ name: 'Steak', price: '100' }, { price: '12.5' }],
  tax: pct('8.25'),
  other: amt('7.50'),
  tip: pct('12.5'),
  tipOn: 'items_tax',
};

/** What CHARGED adds up to: Rs 112.50 + 9.28 + 7.50 + 15.22. */
const CHARGED_TOTALS: [string, string][] = [
  ['Subtotal', 'Rs 112.50'],
  ['Tax (8.25%)', 'Rs 9.28'],
  ['Other charges', 'Rs 7.50'],
  ['Tip (12.5% of items + tax)', 'Rs 15.22'],
  ['Total', 'Rs 144.50'],
];

interface Trip {
  me: string;
  groupId: string;
  meId: string;
  ids: Record<string, string>;
}

/** A logged-in account with a group "Trip" (in Rs) of me, Ali and Sara. */
async function startTrip(page: Page, info: TestInfo, currency = 'Rs'): Promise<Trip> {
  const me = await signUpFast(page, info);
  const g = await makeGroup(page, 'Trip', currency, ['Ali', 'Sara']);
  return { me, ...g };
}

/** Itemized: Ali's steak 40.00, nachos 12.00 for all three; tax 5.00, other charges 5%, tip 10% on items + tax. Total 65.30, paid by me. */
function itemizedDinner(t: Trip): GroupSpec {
  return {
    name: 'Itemized dinner',
    items: [
      { name: 'Steak', price: '40', sharerIds: [t.ids.Ali] },
      { name: 'Nachos', price: '12', sharerIds: [t.meId, t.ids.Ali, t.ids.Sara] },
    ],
    tax: amt('5'),
    other: pct('5'),
    tip: pct('10'),
    tipOn: 'items_tax',
    splitMode: 'itemized',
    participantIds: [t.meId, t.ids.Ali, t.ids.Sara],
    payerId: t.meId,
  };
}

/** Equal: Pizza 30.00 and one unnamed item 10.00, tax 10%, paid by Ali, split between all three. Total 44.00. */
function equalDinner(t: Trip): GroupSpec {
  return {
    name: 'Equal dinner',
    items: [{ name: 'Pizza', price: '30' }, { price: '10' }],
    tax: pct('10'),
    participantIds: [t.meId, t.ids.Ali, t.ids.Sara],
    payerId: t.ids.Ali,
  };
}

// ---------- Reading the screen ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22 Oct 2026" from the "2026-10-22" the server keeps. */
function niceDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** The date of a saved bill, as the screens write it. */
async function dateOf(page: Page, path: string): Promise<string> {
  const { bill } = await api<{ bill: { date: string } }>(page, 'get', path);
  return niceDate(bill.date);
}

/** The region named "Bill": a saved bill's receipt. */
const receipt = (page: Page) => page.getByRole('region', { name: 'Bill', exact: true });
/** The region named "Results": the receipt beside or under the form. */
const resultsRegion = (page: Page) => page.getByRole('region', { name: 'Results', exact: true });
const grandTotal = (page: Page) => page.getByTestId('grand-total');
const heading1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name, exact: true });

/** The lines of the totals, in order: [label, amount]. A % line carries its rate in the label. */
async function totalLines(scope: Locator): Promise<[string, string][]> {
  return scope.locator('dl.totals > div').evaluateAll((rows) =>
    rows.map((row): [string, string] => [row.querySelector('dt')?.textContent?.trim() ?? '', row.querySelector('dd')?.textContent?.trim() ?? '']),
  );
}

/** The item lines of a receipt: [name, price, "Shared by …" or ""]. */
async function itemLines(scope: Locator): Promise<string[][]> {
  return scope
    .getByRole('list', { name: 'Items' })
    .getByRole('listitem')
    .evaluateAll((lis) =>
      lis.map((li) => [
        li.querySelector('.receipt-item-name')?.textContent?.trim() ?? '',
        li.querySelector('.receipt-amount')?.textContent?.trim() ?? '',
        li.querySelector('p')?.textContent?.trim() ?? '',
      ]),
    );
}

/** The people's shares on a group receipt: [name, amount, "Items … · Tax … " or ""]. */
async function shareLines(scope: Locator): Promise<string[][]> {
  return scope.getByTestId('share').evaluateAll((lis) =>
    lis.map((li) => [
      li.querySelector('.share-name')?.textContent?.trim() ?? '',
      li.querySelector('.share-amount')?.textContent?.trim() ?? '',
      li.querySelector('.share-parts')?.textContent?.trim() ?? '',
    ]),
  );
}

/** Nothing on the page can be typed into, ticked or chosen: the only button is Delete. */
async function expectReadOnly(page: Page): Promise<void> {
  const main = page.getByRole('main');
  for (const role of ['textbox', 'checkbox', 'radio', 'combobox', 'spinbutton'] as const) {
    await expect(main.getByRole(role), `a ${role} on a read-only bill`).toHaveCount(0);
  }
  await expect(main.getByRole('button')).toHaveText(['Delete']);
  await expect(page.getByRole('button', { name: 'Calculate' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save bill' })).toHaveCount(0);
}

// ---------- Forms ----------

type ChargeLabel = 'Tax' | 'Other charges' | 'Tip';
const CHARGE_LABELS: ChargeLabel[] = ['Tax', 'Other charges', 'Tip'];

function chargeGroup(page: Page, label: ChargeLabel): Locator {
  return page.getByRole('group', { name: label === 'Other charges' ? 'Other charges (optional)' : label, exact: true });
}

/** What is written on each segment of a charge's "%" / currency switch (not the screen-reader-only words). */
const SEGMENT_TEXT = '.seg > span:not(.visually-hidden)';

async function setCharge(page: Page, label: ChargeLabel, mode: Mode, value: string): Promise<void> {
  const group = chargeGroup(page, label);
  await group.getByRole('radio', { name: mode === 'percent' ? 'Percentage' : 'Amount' }).check();
  await group.getByRole('textbox').fill(value);
}

const itemName = (page: Page, n: number) => page.getByLabel(`Item ${n} name`, { exact: true });
const itemPrice = (page: Page, n: number) => page.getByLabel(`Item ${n} price`, { exact: true });
const removeButtons = (page: Page) => page.getByRole('button', { name: /^Remove item \d+$/ });
const calculateButton = (page: Page) => page.getByRole('button', { name: 'Calculate' });
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save bill' });
const addItem = (page: Page) => page.getByRole('button', { name: '+ Add item' });
const tookPart = (page: Page) => page.getByRole('group', { name: 'Who took part', exact: true });
const whoPaid = (page: Page) => page.getByLabel('Who paid', { exact: true });
const sharedBy = (page: Page, n: number) => page.getByRole('group', { name: `Who shared item ${n}`, exact: true });
const toast = (page: Page, text: string) => page.getByRole('status').getByText(text);

async function openNewSolo(page: Page): Promise<void> {
  await page.goto('/solo/new');
  await expect(heading1(page, 'New solo bill')).toBeVisible();
}

async function openNewGroupBill(page: Page, groupId: string, groupName = 'Trip'): Promise<void> {
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(heading1(page, `Add bill to ${groupName}`)).toBeVisible();
}

/** The page really is drawn in the scheme asked for (so a "dark" scan is of the dark theme). */
async function expectScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  const seen = await page.evaluate(() => {
    const [r, g, b] = (getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).map(Number);
    return { prefersDark: matchMedia('(prefers-color-scheme: dark)').matches, brightness: (r * 299 + g * 587 + b * 114) / 1000 };
  });
  expect(seen.prefersDark, `the browser asks for the ${scheme} scheme`).toBe(scheme === 'dark');
  if (scheme === 'dark') expect(seen.brightness, 'the page background is dark').toBeLessThan(80);
  else expect(seen.brightness, 'the page background is light').toBeGreaterThan(180);
}

/** The checkboxes of a chip group, as [name, ticked] pairs. */
async function chipStates(group: Locator): Promise<[string, boolean][]> {
  return group.getByRole('checkbox').evaluateAll((boxes) =>
    boxes.map((box): [string, boolean] => {
      const input = box as HTMLInputElement;
      return [input.labels?.[0]?.textContent?.trim() ?? '', input.checked];
    }),
  );
}

// ======================================================================
// US-05 #16 Typing items with the keyboard
// ======================================================================

test('US-05 #16 a whole bill can be typed with the keyboard: Enter goes from a name to its price, and from a price to the next item', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await expect(removeButtons(page)).toHaveCount(1);

  await itemName(page, 1).focus();
  await page.keyboard.type('Coffee');
  await page.keyboard.press('Enter');
  await expect(itemPrice(page, 1)).toBeFocused(); // a name's Enter: its price
  await page.keyboard.type('3.50');
  await page.keyboard.press('Enter');
  await expect(removeButtons(page)).toHaveCount(2); // after the last price: a new line...
  await expect(itemName(page, 2)).toBeFocused(); // ...with the cursor in its name
  await page.keyboard.type('Cake');
  await page.keyboard.press('Enter');
  await expect(itemPrice(page, 2)).toBeFocused();
  await page.keyboard.type('4');
  await page.keyboard.press('Enter');
  await expect(removeButtons(page)).toHaveCount(3);
  await expect(itemName(page, 3)).toBeFocused();

  // Everything typed is there, and none of those Enter presses calculated anything.
  await expect(itemName(page, 1)).toHaveValue('Coffee');
  await expect(itemPrice(page, 1)).toHaveValue('3.50');
  await expect(itemName(page, 2)).toHaveValue('Cake');
  await expect(itemPrice(page, 2)).toHaveValue('4');
  await expect(grandTotal(page)).toHaveCount(0);
  await expect(resultsRegion(page)).toContainText(MSG.pressCalculate);
});

test('US-05 #16 Enter in a price that has a next item moves to that item and adds no new line', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await addItem(page).click();
  await addItem(page).click();
  await expect(removeButtons(page)).toHaveCount(3);

  await itemPrice(page, 1).fill('5');
  await page.keyboard.press('Enter');
  await expect(itemName(page, 2)).toBeFocused();
  await expect(removeButtons(page)).toHaveCount(3);

  await itemPrice(page, 2).fill('6');
  await page.keyboard.press('Enter');
  await expect(itemName(page, 3)).toBeFocused();
  await expect(removeButtons(page)).toHaveCount(3);

  // Only after the last one does Enter add a line.
  await itemPrice(page, 3).fill('7');
  await page.keyboard.press('Enter');
  await expect(removeButtons(page)).toHaveCount(4);
  await expect(itemName(page, 4)).toBeFocused();
});

test('US-05 #16 "+ Add item" puts the cursor in the new line', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await itemPrice(page, 1).fill('5');

  await addItem(page).click();
  await expect(removeButtons(page)).toHaveCount(2);
  await expect(itemName(page, 2)).toBeFocused();
  // Again, even though the line before it is still empty.
  await addItem(page).click();
  await expect(removeButtons(page)).toHaveCount(3);
  await expect(itemName(page, 3)).toBeFocused();
  // And what is typed goes into that line.
  await page.keyboard.type('Tea');
  await expect(itemName(page, 3)).toHaveValue('Tea');
});

test('US-05 #16 "Remove item N" takes that line out, the lines after it are renumbered, and the bill adds up without it', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await itemName(page, 1).fill('Soup');
  await itemPrice(page, 1).fill('4');
  await addItem(page).click();
  await itemName(page, 2).fill('Steak');
  await itemPrice(page, 2).fill('30');
  await addItem(page).click();
  await itemName(page, 3).fill('Tea');
  await itemPrice(page, 3).fill('2');
  await expect(removeButtons(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Remove item 2', exact: true }).click();
  await expect(removeButtons(page)).toHaveCount(2);
  await expect(itemName(page, 2)).toHaveValue('Tea');
  await expect(itemPrice(page, 2)).toHaveValue('2');
  await expect(itemName(page, 3)).toHaveCount(0);
  await expect(itemName(page, 1)).toHaveValue('Soup');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('$6.00');

  // Taking out every line leaves a bill with no items, which Calculate says; "+ Add item" starts again.
  await page.getByRole('button', { name: 'Remove item 2', exact: true }).click();
  await page.getByRole('button', { name: 'Remove item 1', exact: true }).click();
  await expect(removeButtons(page)).toHaveCount(0);
  await expect(grandTotal(page)).toHaveCount(0);
  await calculateButton(page).click();
  await expect(page.getByText(MSG.noItems, { exact: true })).toBeVisible();
  await addItem(page).click();
  await expect(removeButtons(page)).toHaveCount(1);
  await expect(itemName(page, 1)).toBeFocused();
});

test('US-05 #16 an empty line (no name and no price) is left out when calculating and saving', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await page.getByLabel('Bill name').fill('Gaps');
  await itemPrice(page, 1).fill('10');
  await addItem(page).click(); // item 2 stays empty
  await addItem(page).click();
  await itemName(page, 3).fill('Tea');
  await itemPrice(page, 3).fill('5');
  await expect(removeButtons(page)).toHaveCount(3);

  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('$15.00');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(MSG.price)).toHaveCount(0);

  // Saved, the empty line is not a line of the bill: two items, not three.
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  const { bills } = await api<{ bills: { id: string }[] }>(page, 'get', '/solo-bills');
  expect(bills).toHaveLength(1);
  const { bill } = await api<{ bill: { input: { items: { name: string; price: string }[] } } }>(page, 'get', `/solo-bills/${bills[0].id}`);
  expect(bill.input.items.map(({ name, price }) => ({ name, price }))).toEqual([
    { name: '', price: '10.00' },
    { name: 'Tea', price: '5.00' },
  ]);
  await page.goto(`/solo/${bills[0].id}`);
  await expect(heading1(page, 'Gaps')).toBeVisible();
  await expect.poll(() => itemLines(receipt(page))).toEqual([
    ['Item 1', '$10.00', ''],
    ['Tea', '$5.00', ''],
  ]);
});

test('US-05 #16 a form with nothing but an empty line gets "Add at least one item" on Calculate', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await addItem(page).click(); // two empty lines
  await calculateButton(page).click();
  await expect(page.getByText(MSG.noItems, { exact: true })).toBeVisible();
  await expect(grandTotal(page)).toHaveCount(0);
});

test('US-05 #16 Enter in a price only moves on, while Enter in the bill name, tax, other charges or tip calculates', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await itemPrice(page, 1).fill('20');

  await itemPrice(page, 1).press('Enter');
  await expect(itemName(page, 2)).toBeFocused();
  await expect(grandTotal(page)).toHaveCount(0);

  // Each of these Enter presses is Calculate. Typing in a box first hides the result of the one before.
  await page.getByLabel('Bill name').press('Enter');
  await expect(grandTotal(page)).toHaveText('$20.00');

  await chargeGroup(page, 'Tax').getByRole('textbox').fill('10');
  await expect(grandTotal(page)).toHaveCount(0);
  await chargeGroup(page, 'Tax').getByRole('textbox').press('Enter');
  await expect(grandTotal(page)).toHaveText('$22.00');

  await setCharge(page, 'Other charges', 'amount', '1');
  await expect(grandTotal(page)).toHaveCount(0);
  await chargeGroup(page, 'Other charges').getByRole('textbox').press('Enter');
  await expect(grandTotal(page)).toHaveText('$23.00');

  await chargeGroup(page, 'Tip').getByRole('textbox').fill('10');
  await expect(grandTotal(page)).toHaveCount(0);
  await chargeGroup(page, 'Tip').getByRole('textbox').press('Enter');
  await expect(grandTotal(page)).toHaveText('$25.00');
});

test('US-05 #16 on a group bill split by items, Enter in a price still moves to the next item, and a new line comes with its own "Who shared" chips', async ({ page }, info) => {
  const t = await startTrip(page, info);
  await openNewGroupBill(page, t.groupId);
  await page.getByRole('radio', { name: /^By items/ }).check();
  await expect(sharedBy(page, 1)).toBeVisible();

  await itemName(page, 1).focus();
  await page.keyboard.type('Pizza');
  await page.keyboard.press('Enter');
  await expect(itemPrice(page, 1)).toBeFocused();
  await page.keyboard.type('12');
  await page.keyboard.press('Enter');
  await expect(removeButtons(page)).toHaveCount(2);
  await expect(itemName(page, 2)).toBeFocused();
  await expect(sharedBy(page, 2)).toBeVisible();
  await expect(grandTotal(page)).toHaveCount(0);
});

// ======================================================================
// US-05 #17 One box and a "%" / currency switch for tax, other charges and tip
// ======================================================================

test('US-05 #17 tax, other charges and tip each have one box and a switch between "%" and the currency symbol', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  const currency = page.getByLabel('Currency', { exact: true });
  await currency.selectOption('Rs');

  for (const label of CHARGE_LABELS) {
    const group = chargeGroup(page, label);
    await expect(group.getByRole('textbox'), `${label}: one box`).toHaveCount(1);
    await expect(group.getByRole('textbox'), `${label}: starts empty`).toHaveValue('');
    const switcher = group.getByRole('radiogroup', { name: `${label} as`, exact: true });
    await expect(switcher.getByRole('radio'), `${label}: a two-way switch`).toHaveCount(2);
    await expect(switcher.getByRole('radio').first()).toHaveAccessibleName('Percentage');
    await expect(switcher.getByRole('radio').last()).toHaveAccessibleName('Rs amount');
    // What is written on the two segments.
    await expect(switcher.locator(SEGMENT_TEXT), `${label}: segments`).toHaveText(['%', 'Rs']);
  }

  // The second segment follows the bill's currency.
  await currency.selectOption('€');
  for (const label of CHARGE_LABELS) {
    await expect(chargeGroup(page, label).getByRole('radiogroup').locator(SEGMENT_TEXT)).toHaveText(['%', '€']);
    await expect(chargeGroup(page, label).getByRole('radiogroup', { name: `${label} as`, exact: true }).getByRole('radio').last()).toHaveAccessibleName('€ amount');
  }
  await currency.selectOption('other');
  await page.getByLabel('Currency symbol').fill('kr');
  for (const label of CHARGE_LABELS) {
    await expect(chargeGroup(page, label).getByRole('radiogroup').locator(SEGMENT_TEXT)).toHaveText(['%', 'kr']);
  }
});

test('US-05 #17 tapping the switch also puts the cursor in the box, ready to type', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  for (const label of CHARGE_LABELS) {
    const group = chargeGroup(page, label);
    const box = group.getByRole('textbox');
    const elsewhere = page.getByLabel('Bill name');

    await elsewhere.focus();
    await group.getByRole('radio', { name: 'Amount' }).click();
    await expect(group.getByRole('radio', { name: 'Amount' }), `${label}: switched`).toBeChecked();
    await expect(box, `${label}: cursor after tapping the currency segment`).toBeFocused();
    await page.keyboard.type('5'); // ready to type
    await expect(box).toHaveValue('5');

    await elsewhere.focus();
    await group.getByRole('radio', { name: 'Percentage' }).click();
    await expect(group.getByRole('radio', { name: 'Percentage' })).toBeChecked();
    await expect(box, `${label}: cursor after tapping the % segment`).toBeFocused();

    // Tapping the segment that is already on does the same.
    await elsewhere.focus();
    await group.getByRole('radio', { name: 'Percentage' }).click();
    await expect(box, `${label}: cursor after tapping the segment that is already on`).toBeFocused();
  }
});

test('US-05 #17 moving along the switch with the arrow keys keeps the cursor on the switch', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  const tax = chargeGroup(page, 'Tax');
  await tax.getByRole('radio', { name: 'Percentage' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tax.getByRole('radio', { name: 'Amount' })).toBeChecked();
  await expect(tax.getByRole('radio', { name: 'Amount' })).toBeFocused();
  await expect(tax.getByRole('textbox')).not.toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tax.getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(tax.getByRole('radio', { name: 'Percentage' })).toBeFocused();
});

// ======================================================================
// US-06 #7 A saved bill's currency is fixed
// ======================================================================

test('US-06 #7 editing a saved bill shows its currency as fixed, with the reason, and saving keeps it', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, { name: 'Rupee lunch', currency: 'Rs', items: [{ name: 'Biryani', price: '450' }] });

  await page.goto(`/solo/${id}/edit`);
  await expect(heading1(page, 'Edit Rupee lunch')).toBeVisible();
  // No picker to choose from: the symbol is just shown, with the reason.
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox')).toHaveCount(0);
  await expect(page.locator('.currency-fixed')).toHaveText('Rs');
  await expect(page.getByText(MSG.fixedCurrency, { exact: true })).toBeVisible();
  // The charges still use it.
  await expect(chargeGroup(page, 'Tax').getByRole('radiogroup').locator(SEGMENT_TEXT)).toHaveText(['%', 'Rs']);

  // Saving an edit leaves the currency alone.
  await itemPrice(page, 1).fill('500');
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  const row = page.getByRole('link', { name: /Rupee lunch/ });
  await expect(row).toContainText('Rs 500.00');
  const { bills } = await api<{ bills: { currency: string }[] }>(page, 'get', '/solo-bills');
  expect(bills.map((b) => b.currency)).toEqual(['Rs']);

  // A new bill, by contrast, still has the picker and not this sentence.
  await openNewSolo(page);
  await expect(page.getByLabel('Currency', { exact: true })).toBeVisible();
  await expect(page.getByText(MSG.fixedCurrency)).toHaveCount(0);
});

test('US-06 #7 a bill saved with an "Other" symbol shows that symbol as fixed when edited, and keeps it', async ({ page }, info) => {
  await signUpFast(page, info);
  // Made through the form: "Other", typed with spaces around it (saved as "kr").
  await openNewSolo(page);
  await page.getByLabel('Currency', { exact: true }).selectOption('other');
  await page.getByLabel('Currency symbol').fill(' kr ');
  await page.getByLabel('Bill name').fill('Kroner lunch');
  await itemPrice(page, 1).fill('80');
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();

  await page.getByRole('link', { name: /Kroner lunch/ }).click();
  await expect(page.getByText(/^Bill from .+\. Amounts in kr\.$/)).toBeVisible();
  await expect(grandTotal(page)).toHaveText('kr 80.00');
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(heading1(page, 'Edit Kroner lunch')).toBeVisible();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await expect(page.locator('.currency-fixed')).toHaveText('kr');
  await expect(page.getByText(MSG.fixedCurrency, { exact: true })).toBeVisible();

  await itemPrice(page, 1).fill('90');
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await expect(page.getByRole('link', { name: /Kroner lunch/ })).toContainText('kr 90.00');
  const { bills } = await api<{ bills: { currency: string }[] }>(page, 'get', '/solo-bills');
  expect(bills.map((b) => b.currency)).toEqual(['kr']);
});

// ======================================================================
// US-07 #1 Saving takes me to the history
// ======================================================================

test('US-07 #1 saving takes me to my history, where the new bill is first and marked "Saved", with its name, date, currency and total', async ({ page }, info) => {
  await signUpFast(page, info);
  await makeSoloBill(page, { name: 'Older lunch', currency: '€', items: [{ price: '8' }] });

  await openNewSolo(page);
  await page.getByLabel('Currency', { exact: true }).selectOption('€');
  await page.getByLabel('Bill name').fill('Pasta night');
  await itemPrice(page, 1).fill('12.50');
  await addItem(page).click();
  await itemPrice(page, 2).fill('7.25');
  await saveButton(page).click();

  // The history, not the bill.
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);
  await expect(toast(page, 'Bill saved')).toBeVisible();

  const rows = page.getByRole('list').filter({ has: page.getByRole('link', { name: /Pasta night/ }) }).getByRole('link');
  await expect(rows).toHaveCount(2);
  const top = rows.first();
  await expect(top).toContainText('Pasta night');
  await expect(top.getByText('Saved', { exact: true })).toBeVisible();
  await expect(top).toContainText('€');
  await expect(top).toContainText('€19.75');
  const [{ id }] = (await api<{ bills: { id: string }[] }>(page, 'get', '/solo-bills')).bills;
  await expect(top).toContainText(await dateOf(page, `/solo-bills/${id}`));
  // Newest first, and only the one just saved is marked and highlighted.
  await expect(rows.nth(1)).toContainText('Older lunch');
  await expect(rows.nth(1).getByText('Saved', { exact: true })).toHaveCount(0);
  const background = (row: Locator) => row.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await background(top), 'the saved row is highlighted').not.toBe(await background(rows.nth(1)));
});

// ======================================================================
// US-08 Open, edit and delete saved solo bills
// ======================================================================

test('US-08 #1 a saved solo bill opens read-only as a receipt: items, subtotal, tax, other charges and tip with their rates, and the total', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, CHARGED);

  // From the history, one click.
  await page.goto('/solo');
  await page.getByRole('link', { name: /Charged dinner/ }).click();
  await expect(heading1(page, 'Charged dinner')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/solo/${id}$`));

  const date = await dateOf(page, `/solo-bills/${id}`);
  await expect(page.getByText(`Bill from ${date}. Amounts in Rs.`, { exact: true })).toBeVisible();
  await expect.poll(() => itemLines(receipt(page))).toEqual([
    ['Steak', 'Rs 100.00', ''],
    ['Item 2', 'Rs 12.50', ''],
  ]);
  await expect.poll(() => totalLines(receipt(page))).toEqual(CHARGED_TOTALS);
  await expect(grandTotal(page)).toHaveText('Rs 144.50');

  // "Edit bill" and "Delete", and nothing else can be touched.
  await expect(page.getByRole('link', { name: 'Edit bill' })).toHaveAttribute('href', `/solo/${id}/edit`);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expectReadOnly(page);
});

test('US-08 #1 a % of 0 or a blank one shows no rate on the receipt', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, { name: 'Plain', items: [{ price: '20' }], tax: pct('0'), other: pct(''), tip: pct('0'), tipOn: 'items_tax' });
  await page.goto(`/solo/${id}`);
  await expect(heading1(page, 'Plain')).toBeVisible();
  await expect.poll(() => totalLines(receipt(page))).toEqual([
    ['Subtotal', '$20.00'],
    ['Tax', '$0.00'],
    ['Other charges', '$0.00'],
    ['Tip', '$0.00'],
    ['Total', '$20.00'],
  ]);
});

test('US-08 #2 "Edit bill" opens the form with every input and result exactly as saved, and "Cancel" goes back to the receipt', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, CHARGED);
  await page.goto(`/solo/${id}`);
  await expect(heading1(page, 'Charged dinner')).toBeVisible();

  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page).toHaveURL(new RegExp(`/solo/${id}/edit$`));
  await expect(heading1(page, 'Edit Charged dinner')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', `/solo/${id}`);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0); // deleting is done from the receipt

  // Every input as saved.
  await expect(page.getByLabel('Bill name')).toHaveValue('Charged dinner');
  await expect(itemName(page, 1)).toHaveValue('Steak');
  await expect(itemPrice(page, 1)).toHaveValue('100.00');
  await expect(itemName(page, 2)).toHaveValue('');
  await expect(itemPrice(page, 2)).toHaveValue('12.50');
  await expect(chargeGroup(page, 'Tax').getByRole('textbox')).toHaveValue('8.25');
  await expect(chargeGroup(page, 'Tax').getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(chargeGroup(page, 'Other charges').getByRole('textbox')).toHaveValue('7.50');
  await expect(chargeGroup(page, 'Other charges').getByRole('radio', { name: 'Amount' })).toBeChecked();
  await expect(chargeGroup(page, 'Tip').getByRole('textbox')).toHaveValue('12.5');
  await expect(chargeGroup(page, 'Tip').getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Items + tax' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Items only' })).not.toBeChecked();
  // And the result as saved, already showing.
  await expect.poll(() => totalLines(resultsRegion(page))).toEqual(CHARGED_TOTALS);
  await expect(grandTotal(page)).toHaveText('Rs 144.50');

  // Cancel: back to the receipt, nothing changed.
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`/solo/${id}$`));
  await expect(heading1(page, 'Charged dinner')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('US-08 #3 changing an amount and saving recalculates the total and takes me to my history, with the bill marked "Saved"', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, CHARGED);
  await page.goto(`/solo/${id}/edit`);
  await expect(heading1(page, 'Edit Charged dinner')).toBeVisible();

  await itemPrice(page, 1).fill('120');
  // The old result is hidden until Calculate, as on a new bill.
  await expect(grandTotal(page)).toHaveCount(0);
  await expect(resultsRegion(page)).toContainText(MSG.pressCalculate);
  await saveButton(page).click();

  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await expect(page).toHaveURL(/\/solo$/);
  await expect(toast(page, 'Bill saved')).toBeVisible();
  const row = page.getByRole('link', { name: /Charged dinner/ });
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  // 132.50 + tax 10.93 + other 7.50 + tip 12.5% of 143.43 (17.93)
  await expect(row).toContainText('Rs 168.86');
  const { bill } = await api<{ bill: { totalCents: number } }>(page, 'get', `/solo-bills/${id}`);
  expect(bill.totalCents).toBe(16886);

  await row.click();
  await expect(grandTotal(page)).toHaveText('Rs 168.86');
  await expect.poll(() => totalLines(receipt(page))).toEqual([
    ['Subtotal', 'Rs 132.50'],
    ['Tax (8.25%)', 'Rs 10.93'],
    ['Other charges', 'Rs 7.50'],
    ['Tip (12.5% of items + tax)', 'Rs 17.93'],
    ['Total', 'Rs 168.86'],
  ]);
});

test('US-08 #3 an invalid edit shows the same messages as a new bill and is not saved', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, CHARGED);
  await page.goto(`/solo/${id}/edit`);
  await expect(heading1(page, 'Edit Charged dinner')).toBeVisible();

  await itemPrice(page, 1).fill('abc');
  await saveButton(page).click();
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
  await expect(itemPrice(page, 1)).toHaveAccessibleDescription(MSG.price);
  await expect(page).toHaveURL(new RegExp(`/solo/${id}/edit$`));
  await expect(toast(page, 'Bill saved')).toHaveCount(0);

  await itemPrice(page, 1).fill('100');
  await chargeGroup(page, 'Tax').getByRole('textbox').fill('101');
  await calculateButton(page).click();
  await expect(page.getByText(MSG.taxPercent, { exact: true })).toBeVisible();
  await expect(grandTotal(page)).toHaveCount(0);
  await saveButton(page).click();
  await expect(page.getByText(MSG.taxPercent, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/solo/${id}/edit$`));

  // Nothing was saved: the bill is as it was.
  const { bill } = await api<{ bill: { totalCents: number } }>(page, 'get', `/solo-bills/${id}`);
  expect(bill.totalCents).toBe(14450);
});

test('US-08 #6 Delete asks first: Cancel keeps the bill, and Delete bill removes it from my history', async ({ page }, info) => {
  await signUpFast(page, info);
  const id = await makeSoloBill(page, CHARGED);
  await page.goto(`/solo/${id}`);
  await expect(heading1(page, 'Charged dinner')).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this bill?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(heading1(page, 'Charged dinner')).toBeVisible();
  await expect(grandTotal(page)).toHaveText('Rs 144.50');
  expect((await api<{ bills: unknown[] }>(page, 'get', '/solo-bills')).bills).toHaveLength(1);

  // Esc is Cancel as well.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await api<{ bills: unknown[] }>(page, 'get', '/solo-bills')).bills).toHaveLength(1);

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete bill' }).click();
  await expect(toast(page, 'Bill deleted')).toBeVisible();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await expect(page.getByRole('link', { name: /Charged dinner/ })).toHaveCount(0);
  await expect(page.getByText('No solo bills yet. Total your first bill to keep a record of it.')).toBeVisible();
  expect((await api<{ bills: unknown[] }>(page, 'get', '/solo-bills')).bills).toEqual([]);
  expect((await page.request.get(`/api/solo-bills/${id}`)).status()).toBe(404);
});

// ======================================================================
// US-13 #11, #12 The group bill form: who took part, who paid, how to split
// ======================================================================

test('US-13 #11 a new group bill starts with every current member ticked as a name chip and me as the payer', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Chips', '$', ['Ali', 'Sara', 'Omar', 'Gone']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Gone}/remove`);
  await openNewGroupBill(page, groupId, 'Chips');

  // One chip per current member, all ticked; a removed member is not offered.
  const took = tookPart(page);
  await expect.poll(() => chipStates(took)).toEqual([
    [me, true],
    ['Ali', true],
    ['Sara', true],
    ['Omar', true],
  ]);
  // Drawn as chips: each name sits in a bordered, rounded pill.
  const pills = await took.getByRole('checkbox').evaluateAll((boxes) =>
    boxes.map((box) => {
      const label = (box as HTMLInputElement).labels?.[0];
      const style = label ? getComputedStyle(label) : null;
      return { radius: parseFloat(style?.borderTopLeftRadius ?? '0'), border: parseFloat(style?.borderTopWidth ?? '0') };
    }),
  );
  expect(pills).toHaveLength(4);
  for (const pill of pills) {
    expect(pill.radius).toBeGreaterThanOrEqual(16);
    expect(pill.border).toBeGreaterThanOrEqual(1);
  }

  // I start as the payer, and only ticked people can be.
  await expect(whoPaid(page)).toHaveValue(meId);
  await expect(whoPaid(page).locator('option:checked')).toHaveText(me);
  await expect(whoPaid(page).locator('option')).toHaveText(['Choose who paid', me, 'Ali', 'Sara', 'Omar']);
});

test('US-13 #11 "Everyone" ticks or unticks all the chips at once', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Chips', '$', ['Ali', 'Sara', 'Omar']);
  await openNewGroupBill(page, groupId, 'Chips');
  const took = tookPart(page);
  const everyone = took.getByRole('button', { name: 'Everyone', exact: true });
  const ticked = took.getByRole('checkbox', { checked: true });

  await expect(everyone).toHaveAttribute('aria-pressed', 'true');
  await expect(ticked).toHaveCount(4);
  await everyone.click(); // all ticked: untick them all
  await expect(ticked).toHaveCount(0);
  await expect(everyone).toHaveAttribute('aria-pressed', 'false');
  await expect(whoPaid(page).locator('option')).toHaveText(['Choose who paid']); // only ticked people can pay
  await everyone.click(); // none ticked: tick them all
  await expect(ticked).toHaveCount(4);
  await expect(everyone).toHaveAttribute('aria-pressed', 'true');
  await expect(whoPaid(page).locator('option:checked')).toHaveText(me);

  // Unticking one person means "Everyone" is no longer on, and they can't be the payer.
  await took.getByRole('checkbox', { name: 'Omar', exact: true }).uncheck();
  await expect(everyone).toHaveAttribute('aria-pressed', 'false');
  await expect(ticked).toHaveCount(3);
  await expect(whoPaid(page).locator('option')).toHaveText(['Choose who paid', me, 'Ali', 'Sara']);
  await everyone.click(); // some ticked: tick the rest
  await expect(ticked).toHaveCount(4);
});

test('US-13 #12 "How to split" is a two-way switch, "Equally" or "By items", with a line underneath saying what the chosen way means', async ({ page }, info) => {
  const t = await startTrip(page, info);
  await openNewGroupBill(page, t.groupId);
  const split = page.getByRole('group', { name: 'How to split', exact: true });
  const radios = split.getByRole('radio');

  await expect(radios).toHaveCount(2);
  await expect(radios.first()).toHaveAccessibleName('Equally');
  await expect(radios.last()).toHaveAccessibleName('By items (each pays for what they had)');
  await expect(split.getByText('Equally', { exact: true })).toBeVisible();
  await expect(split.getByText('By items', { exact: true })).toBeVisible();

  // Equally to start with, and its line.
  await expect(radios.first()).toBeChecked();
  const equalHint = split.getByText(MSG.equalHint, { exact: true });
  await expect(equalHint).toBeVisible();
  await expect(split.getByText(MSG.itemizedHint, { exact: true })).toHaveCount(0);

  // The line is underneath the switch.
  const [switchBottom, hintTop] = await Promise.all([
    radios.evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().bottom))),
    equalHint.evaluate((el) => el.getBoundingClientRect().top),
  ]);
  expect(hintTop).toBeGreaterThanOrEqual(switchBottom - 1);

  await radios.last().check();
  await expect(split.getByText(MSG.itemizedHint, { exact: true })).toBeVisible();
  await expect(split.getByText(MSG.equalHint, { exact: true })).toHaveCount(0);
  await expect(radios.first()).not.toBeChecked();

  await radios.first().check();
  await expect(split.getByText(MSG.equalHint, { exact: true })).toBeVisible();
  await expect(split.getByText(MSG.itemizedHint, { exact: true })).toHaveCount(0);
});

// ======================================================================
// US-14 #10-#12 Split by items: "Shared by" name chips on every item
// ======================================================================

test('US-14 #10 by items, each item shows "Shared by" with a name chip for each of this bill\'s people plus "Everyone", and no dropdown to open', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Chips', '$', ['Ali', 'Sara', 'Omar']);
  await openNewGroupBill(page, groupId, 'Chips');
  await page.getByRole('radio', { name: /^By items/ }).check();
  await itemPrice(page, 1).fill('12');
  await addItem(page).click();
  await itemPrice(page, 2).fill('8');

  for (const n of [1, 2]) {
    const group = sharedBy(page, n);
    await expect(group).toBeVisible();
    await expect(group.getByText('Shared by', { exact: true })).toBeVisible();
    await expect(group.getByRole('button', { name: 'Everyone', exact: true })).toBeVisible();
    // The chips are there at once: one per person on the bill, none ticked yet.
    await expect.poll(() => chipStates(group), { message: `item ${n}` }).toEqual([
      [me, false],
      ['Ali', false],
      ['Sara', false],
      ['Omar', false],
    ]);
    // Nothing to open: no dropdown button, popup or list box.
    await expect(group.locator('[aria-haspopup], [aria-expanded]')).toHaveCount(0);
    await expect(group.getByRole('listbox')).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: /^Who shared item/ })).toHaveCount(0);

  // Tapping a chip ticks it, and several can be ticked, with no "Done" to press.
  const first = sharedBy(page, 1);
  await first.getByRole('checkbox', { name: 'Ali', exact: true }).check();
  await first.getByRole('checkbox', { name: 'Sara', exact: true }).check();
  await expect.poll(() => chipStates(first)).toEqual([
    [me, false],
    ['Ali', true],
    ['Sara', true],
    ['Omar', false],
  ]);
  await first.getByRole('checkbox', { name: 'Ali', exact: true }).uncheck();
  await expect.poll(() => chipStates(first)).toEqual([
    [me, false],
    ['Ali', false],
    ['Sara', true],
    ['Omar', false],
  ]);
  // Item 2 is its own: nothing ticked there.
  await expect(sharedBy(page, 2).getByRole('checkbox', { checked: true })).toHaveCount(0);
});

test('US-14 #10 an item\'s chips are exactly the people ticked under "Who took part"', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Chips', '$', ['Ali', 'Sara', 'Omar']);
  await openNewGroupBill(page, groupId, 'Chips');
  await tookPart(page).getByRole('checkbox', { name: 'Omar', exact: true }).uncheck();
  await page.getByRole('radio', { name: /^By items/ }).check();
  await expect.poll(async () => (await chipStates(sharedBy(page, 1))).map(([name]) => name)).toEqual([me, 'Ali', 'Sara']);
});

test('US-14 #11 tapping "Everyone" on an item ticks all the bill\'s people for it, and tapping it again unticks them all', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Chips', '$', ['Ali', 'Sara']);
  await openNewGroupBill(page, groupId, 'Chips');
  await page.getByRole('radio', { name: /^By items/ }).check();
  await itemPrice(page, 1).fill('12');
  await addItem(page).click();
  await itemPrice(page, 2).fill('8');
  const first = sharedBy(page, 1);
  const everyone = first.getByRole('button', { name: 'Everyone', exact: true });

  await expect(everyone).toHaveAttribute('aria-pressed', 'false');
  await everyone.click();
  await expect.poll(() => chipStates(first)).toEqual([
    [me, true],
    ['Ali', true],
    ['Sara', true],
  ]);
  await expect(everyone).toHaveAttribute('aria-pressed', 'true');
  await everyone.click();
  await expect.poll(() => chipStates(first)).toEqual([
    [me, false],
    ['Ali', false],
    ['Sara', false],
  ]);
  await expect(everyone).toHaveAttribute('aria-pressed', 'false');

  // It acts on that item only; ticking everyone by hand presses it too.
  await everyone.click();
  await expect(sharedBy(page, 2).getByRole('checkbox', { checked: true })).toHaveCount(0);
  await first.getByRole('checkbox', { name: 'Sara', exact: true }).uncheck();
  await expect(everyone).toHaveAttribute('aria-pressed', 'false');
  await first.getByRole('checkbox', { name: 'Sara', exact: true }).check();
  await expect(everyone).toHaveAttribute('aria-pressed', 'true');
});

test('US-14 #12 unticking a person from the bill removes their chip from every item, and an item left with nobody asks who shared it', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Chips', '$', ['Ali', 'Omar']);
  await openNewGroupBill(page, groupId, 'Chips');
  await page.getByRole('radio', { name: /^By items/ }).check();
  await itemPrice(page, 1).fill('12');
  await addItem(page).click();
  await itemPrice(page, 2).fill('8');
  await sharedBy(page, 1).getByRole('checkbox', { name: 'Omar', exact: true }).check(); // item 1: only Omar
  await sharedBy(page, 2).getByRole('button', { name: 'Everyone', exact: true }).click(); // item 2: all three

  await tookPart(page).getByRole('checkbox', { name: 'Omar', exact: true }).uncheck();
  for (const n of [1, 2]) {
    await expect.poll(async () => (await chipStates(sharedBy(page, n))).map(([name]) => name), { message: `item ${n}` }).toEqual([me, 'Ali']);
  }
  // Omar no longer shares item 2 either; item 1 has nobody left.
  await expect.poll(() => chipStates(sharedBy(page, 2))).toEqual([
    [me, true],
    ['Ali', true],
  ]);
  await calculateButton(page).click();
  await expect(sharedBy(page, 1).getByText(MSG.noSharers, { exact: true })).toBeVisible();
  await expect(sharedBy(page, 2).getByText(MSG.noSharers)).toHaveCount(0);
  await expect(grandTotal(page)).toHaveCount(0);
});

// ======================================================================
// US-18 #2, #3, #5 Group bills: saving, the receipt, editing, view-only bills
// ======================================================================

test('US-18 #2 saving a new group bill takes me to the group\'s bill list with it marked "Saved", and the balances update', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Flat', '$', ['Ali']);
  await openNewGroupBill(page, groupId, 'Flat');
  await page.getByLabel('Bill name').fill('Groceries');
  await itemPrice(page, 1).fill('30');
  await saveButton(page).click();

  await expect(heading1(page, 'Flat')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(toast(page, 'Bill saved')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Bills', selected: true })).toBeVisible();
  const row = page.getByRole('tabpanel').getByRole('link', { name: /Groceries/ });
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  await expect(row).toContainText('$30.00');
  await expect(page.getByTestId('balance-row').filter({ hasText: me })).toContainText('+$15.00 is owed');
  await expect(page.getByTestId('balance-row').filter({ hasText: 'Ali' })).toContainText('−$15.00 owes');
});

test('US-18 #2 saving an edited group bill takes me to the bill list with it marked "Saved", and the balances follow', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Flat', '$', ['Ali']);
  const billId = await makeGroupBill(page, groupId, { name: 'Groceries', items: [{ price: '30' }], participantIds: [meId, ids.Ali], payerId: meId });

  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(heading1(page, 'Groceries')).toBeVisible();
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(heading1(page, 'Edit Groceries')).toBeVisible();
  await itemPrice(page, 1).fill('50');
  await saveButton(page).click();

  await expect(heading1(page, 'Flat')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(toast(page, 'Bill saved')).toBeVisible();
  const row = page.getByRole('tabpanel').getByRole('link', { name: /Groceries/ });
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  await expect(row).toContainText('$50.00');
  await expect(page.getByTestId('balance-row').filter({ hasText: me })).toContainText('+$25.00 is owed');
  await expect(page.getByTestId('balance-row').filter({ hasText: 'Ali' })).toContainText('−$25.00 owes');
});

test('US-18 #2 an edited group bill is checked with the same rules as a new one, and an invalid edit is not saved', async ({ page }, info) => {
  const me = await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Flat', '$', ['Ali']);
  const billId = await makeGroupBill(page, groupId, { name: 'Groceries', items: [{ price: '30' }], participantIds: [meId, ids.Ali], payerId: meId });
  await page.goto(`/groups/${groupId}/bills/${billId}/edit`);
  await expect(heading1(page, 'Edit Groceries')).toBeVisible();

  await tookPart(page).getByRole('button', { name: 'Everyone', exact: true }).click(); // untick them all
  await saveButton(page).click();
  await expect(page.getByText(MSG.noParticipants, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/bills/${billId}/edit$`));
  await expect(toast(page, 'Bill saved')).toHaveCount(0);

  // Nothing changed: the bill and the balances are as they were.
  const { bill } = await api<{ bill: { totalCents: number; participantIds: string[] } }>(page, 'get', `/groups/${groupId}/bills/${billId}`);
  expect(bill.totalCents).toBe(3000);
  expect(bill.participantIds).toHaveLength(2);
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByTestId('balance-row').filter({ hasText: me })).toContainText('+$15.00 is owed');
});

test('US-18 #3 a saved equal-split group bill opens read-only as a receipt: items, totals, who paid and each person\'s share', async ({ page }, info) => {
  const t = await startTrip(page, info);
  const billId = await makeGroupBill(page, t.groupId, equalDinner(t));

  await page.goto(`/groups/${t.groupId}?tab=bills`);
  await page.getByRole('tabpanel').getByRole('link', { name: /Equal dinner/ }).click();
  await expect(heading1(page, 'Equal dinner')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${t.groupId}/bills/${billId}$`));

  const date = await dateOf(page, `/groups/${t.groupId}/bills/${billId}`);
  await expect(page.getByText(`Ali paid on ${date}. Split equally between 3 people.`, { exact: true })).toBeVisible();
  await expect.poll(() => itemLines(receipt(page))).toEqual([
    ['Pizza', 'Rs 30.00', ''],
    ['Item 2', 'Rs 10.00', ''],
  ]);
  await expect.poll(() => totalLines(receipt(page))).toEqual([
    ['Subtotal', 'Rs 40.00'],
    ['Tax (10%)', 'Rs 4.00'],
    ['Other charges', 'Rs 0.00'],
    ['Tip', 'Rs 0.00'],
    ['Total', 'Rs 44.00'],
  ]);
  await expect(receipt(page).getByText('Ali paid Rs 44.00.', { exact: true })).toBeVisible();
  await expect(receipt(page).getByRole('heading', { level: 3, name: "Each person's share" })).toBeVisible();
  // 44.00 between three: the first two (in list order) pay the extra cent.
  await expect.poll(() => shareLines(receipt(page))).toEqual([
    [t.me, 'Rs 14.67', ''],
    ['Ali', 'Rs 14.67', ''],
    ['Sara', 'Rs 14.66', ''],
  ]);
  await expect(page.getByRole('link', { name: 'Edit bill' })).toHaveAttribute('href', `/groups/${t.groupId}/bills/${billId}/edit`);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expectReadOnly(page);
});

test('US-18 #3 a saved bill split by items shows who shared each item and each person\'s parts', async ({ page }, info) => {
  const t = await startTrip(page, info);
  const billId = await makeGroupBill(page, t.groupId, itemizedDinner(t));
  await page.goto(`/groups/${t.groupId}/bills/${billId}`);
  await expect(heading1(page, 'Itemized dinner')).toBeVisible();

  const date = await dateOf(page, `/groups/${t.groupId}/bills/${billId}`);
  await expect(page.getByText(`${t.me} paid on ${date}. Split by items.`, { exact: true })).toBeVisible();
  await expect.poll(() => itemLines(receipt(page))).toEqual([
    ['Steak', 'Rs 40.00', 'Shared by Ali'],
    ['Nachos', 'Rs 12.00', `Shared by ${t.me}, Ali, Sara`],
  ]);
  await expect.poll(() => totalLines(receipt(page))).toEqual([
    ['Subtotal', 'Rs 52.00'],
    ['Tax', 'Rs 5.00'],
    ['Other charges (5%)', 'Rs 2.60'],
    ['Tip (10% of items + tax)', 'Rs 5.70'],
    ['Total', 'Rs 65.30'],
  ]);
  await expect(receipt(page).getByText(`${t.me} paid Rs 65.30.`, { exact: true })).toBeVisible();
  await expect.poll(() => shareLines(receipt(page))).toEqual([
    [t.me, 'Rs 5.03', 'Items Rs 4.00 · Tax Rs 0.39 · Other charges Rs 0.20 · Tip Rs 0.44'],
    ['Ali', 'Rs 55.25', 'Items Rs 44.00 · Tax Rs 4.23 · Other charges Rs 2.20 · Tip Rs 4.82'],
    ['Sara', 'Rs 5.02', 'Items Rs 4.00 · Tax Rs 0.38 · Other charges Rs 0.20 · Tip Rs 0.44'],
  ]);
  await expectReadOnly(page);
});

test('US-18 #3 "Edit bill" shows every input exactly as saved, and changing other charges from 5% to 20% recalculates the bill and the balances', async ({ page }, info) => {
  const t = await startTrip(page, info);
  const billId = await makeGroupBill(page, t.groupId, itemizedDinner(t));
  const mine = page.getByTestId('balance-row').filter({ hasText: '(you)' });
  const ali = page.getByTestId('balance-row').filter({ hasText: 'Ali' });
  const sara = page.getByTestId('balance-row').filter({ hasText: 'Sara' });

  // Before: I paid 65.30 and my share is 5.03.
  await page.goto(`/groups/${t.groupId}`);
  await expect(heading1(page, 'Trip')).toBeVisible();
  await expect(mine).toContainText('+Rs 60.27 is owed');
  await expect(ali).toContainText('−Rs 55.25 owes');
  await expect(sara).toContainText('−Rs 5.02 owes');

  await page.goto(`/groups/${t.groupId}/bills/${billId}`);
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${t.groupId}/bills/${billId}/edit$`));
  await expect(heading1(page, 'Edit Itemized dinner')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', `/groups/${t.groupId}/bills/${billId}`);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

  // Every input as saved.
  await expect(page.getByLabel('Bill name')).toHaveValue('Itemized dinner');
  await expect.poll(() => chipStates(tookPart(page))).toEqual([
    [t.me, true],
    ['Ali', true],
    ['Sara', true],
  ]);
  await expect(whoPaid(page).locator('option:checked')).toHaveText(t.me);
  await expect(page.getByRole('radio', { name: /^By items/ })).toBeChecked();
  await expect(itemName(page, 1)).toHaveValue('Steak');
  await expect(itemPrice(page, 1)).toHaveValue('40.00');
  await expect.poll(() => chipStates(sharedBy(page, 1))).toEqual([
    [t.me, false],
    ['Ali', true],
    ['Sara', false],
  ]);
  await expect(itemName(page, 2)).toHaveValue('Nachos');
  await expect(itemPrice(page, 2)).toHaveValue('12.00');
  await expect.poll(() => chipStates(sharedBy(page, 2))).toEqual([
    [t.me, true],
    ['Ali', true],
    ['Sara', true],
  ]);
  await expect(chargeGroup(page, 'Tax').getByRole('textbox')).toHaveValue('5.00');
  await expect(chargeGroup(page, 'Tax').getByRole('radio', { name: 'Amount' })).toBeChecked();
  await expect(chargeGroup(page, 'Other charges').getByRole('textbox')).toHaveValue('5');
  await expect(chargeGroup(page, 'Other charges').getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(chargeGroup(page, 'Tip').getByRole('textbox')).toHaveValue('10');
  await expect(chargeGroup(page, 'Tip').getByRole('radio', { name: 'Percentage' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Items + tax' })).toBeChecked();
  await expect(grandTotal(page)).toHaveText('Rs 65.30'); // the result as saved

  // Other charges 5% -> 20%: the result goes until Calculate, then the bill is recalculated.
  await chargeGroup(page, 'Other charges').getByRole('textbox').fill('20');
  await expect(grandTotal(page)).toHaveCount(0);
  await calculateButton(page).click();
  await expect.poll(() => totalLines(resultsRegion(page))).toEqual([
    ['Subtotal', 'Rs 52.00'],
    ['Tax', 'Rs 5.00'],
    ['Other charges (20%)', 'Rs 10.40'],
    ['Tip (10% of items + tax)', 'Rs 5.70'],
    ['Total', 'Rs 73.10'],
  ]);
  await saveButton(page).click();

  await expect(heading1(page, 'Trip')).toBeVisible();
  const row = page.getByRole('tabpanel').getByRole('link', { name: /Itemized dinner/ });
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  await expect(row).toContainText('Rs 73.10');
  await expect(mine).toContainText('+Rs 67.47 is owed');
  await expect(ali).toContainText('−Rs 61.85 owes');
  await expect(sara).toContainText('−Rs 5.62 owes');
});

test('US-18 #3 Delete on a group bill asks first: Cancel keeps it, and Delete bill removes it and updates the balances', async ({ page }, info) => {
  const t = await startTrip(page, info);
  const billId = await makeGroupBill(page, t.groupId, equalDinner(t));
  await page.goto(`/groups/${t.groupId}/bills/${billId}`);
  await expect(heading1(page, 'Equal dinner')).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this bill?' });
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(grandTotal(page)).toHaveText('Rs 44.00');

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete bill' }).click();
  await expect(toast(page, 'Bill deleted')).toBeVisible();
  await expect(heading1(page, 'Trip')).toBeVisible();
  await expect(page.getByText('No bills yet. Add the first bill you shared.')).toBeVisible();
  await expect(page.getByText('Everyone is settled up.')).toBeVisible();
});

test('US-18 #5 a bill with a removed member is view only: no "Edit bill", and its /edit address shows the receipt instead', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Locked', '$', ['Omar']);
  // Omar pays for only himself, so his balance is 0.00 and he can be removed.
  const billId = await makeGroupBill(page, groupId, { name: 'Omar snack', items: [{ price: '5' }], participantIds: [ids.Omar], payerId: ids.Omar });
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);

  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(heading1(page, 'Omar snack')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Omar was removed from the group, so this bill is view only. Restore Omar on the Members tab to change it.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit bill' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
  await expect(page.getByText(/^Omar \(removed\) paid on .+\. Split equally between 1 person\.$/)).toBeVisible();
  await expectReadOnly(page);

  // Typing the edit address does not open the form: it lands on the receipt.
  await page.goto(`/groups/${groupId}/bills/${billId}/edit`);
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/bills/${billId}$`));
  await expect(heading1(page, 'Omar snack')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: /^Edit / })).toHaveCount(0);
  await expect(calculateButton(page)).toHaveCount(0);
  await expect(saveButton(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit bill' })).toHaveCount(0);
});

test('US-18 #5 Delete on a bill with a removed member shows "Restore Omar to change this bill" next to Delete, and changes nothing', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Locked', '$', ['Omar']);
  const billId = await makeGroupBill(page, groupId, { name: 'Omar snack', items: [{ price: '5' }], participantIds: [ids.Omar], payerId: ids.Omar });
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(heading1(page, 'Omar snack')).toBeVisible();

  const del = page.getByRole('button', { name: 'Delete', exact: true });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await del.click();
  const alert = page.getByRole('alert').filter({ hasText: 'Restore Omar to change this bill' });
  await expect(alert).toBeVisible();
  await expect(alert).toHaveText('Restore Omar to change this bill');
  await expect(page.getByRole('dialog')).toHaveCount(0); // no "Delete this bill?" question

  // At the top of the page, right under the Delete button, above the receipt, and on screen with it.
  const [alertTop, deleteBottom, receiptTop] = await page.evaluate(() => {
    const a = [...document.querySelectorAll('[role="alert"]')].find((el) => el.textContent?.includes('Restore Omar'));
    const d = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'Delete');
    const r = [...document.querySelectorAll('h2')].find((el) => el.textContent?.trim() === 'Bill');
    return [a?.getBoundingClientRect().top ?? -1, d?.getBoundingClientRect().bottom ?? -1, r?.getBoundingClientRect().top ?? -1];
  });
  expect(alertTop).toBeGreaterThanOrEqual(deleteBottom - 1);
  expect(alertTop - deleteBottom).toBeLessThanOrEqual(64);
  expect(alertTop).toBeLessThan(receiptTop);
  await expect(alert).toBeInViewport();
  await expect(del).toBeInViewport();

  // Nothing changed: the bill is still there, with its totals.
  await expect(grandTotal(page)).toHaveText('$5.00');
  const { bills } = await api<{ bills: { id: string }[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(bills.map((b) => b.id)).toEqual([billId]);
});

test("US-04 #3 a group bill's receipt, edit and new-bill addresses show nothing to someone who is not a current member", async ({ browser }, info) => {
  const contexts = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
  try {
    const [owner, omar, stranger] = await Promise.all(contexts.map((c) => c.newPage()));
    await signUpFast(owner, info, 'own');
    const { groupId, meId, ids } = await makeGroup(owner, 'Private', '$', ['Omar']);
    const billId = await makeGroupBill(owner, groupId, { name: 'Secret dinner', items: [{ name: 'Wagyu', price: '123.45' }], participantIds: [meId], payerId: meId });
    const { group } = await api<{ group: { members: { name: string; inviteCode: string | null }[] } }>(owner, 'get', `/groups/${groupId}`);
    await signUpFast(omar, info, 'omar');
    await api(omar, 'post', `/invites/${group.members.find((m) => m.name === 'Omar')?.inviteCode}/accept`);
    await signUpFast(stranger, info, 'stranger');
    const addresses = [`/groups/${groupId}/bills/${billId}`, `/groups/${groupId}/bills/${billId}/edit`, `/groups/${groupId}/bills/new`];

    // A current member sees the bill (so the checks below are about access and not about a broken address).
    await omar.goto(addresses[0]);
    await expect(heading1(omar, 'Secret dinner')).toBeVisible();
    await expect(omar.getByText('Wagyu')).toBeVisible();

    const expectNothingShown = async (who: Page, message: string, label: string) => {
      for (const path of addresses) {
        await who.goto(path);
        await expect(who.getByText(message, { exact: true }), `${label}: ${path}`).toBeVisible();
        await expect(who.getByText('Secret dinner'), `${label}: ${path}`).toHaveCount(0);
        await expect(who.getByText('Wagyu'), `${label}: ${path}`).toHaveCount(0);
        await expect(who.getByText('123.45'), `${label}: ${path}`).toHaveCount(0);
        await expect(who.getByLabel('Item 1 price'), `${label}: ${path}`).toHaveCount(0);
        for (const name of ['Edit bill', 'Delete', 'Save bill', 'Calculate']) {
          await expect(who.getByRole(name === 'Edit bill' ? 'link' : 'button', { name, exact: true }), `${label}: ${path}`).toHaveCount(0);
        }
      }
    };
    await expectNothingShown(stranger, "You don't have access to this group", 'a stranger');

    // Removed (his balance is 0.00), he no longer has access either.
    await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
    await expectNothingShown(omar, 'You no longer have access to this group', 'a removed member');
  } finally {
    for (const c of contexts) await c.close();
  }
});

test('US-23 #4 once the member is restored, the bill has its "Edit bill" button again and its /edit address opens the form', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Locked', '$', ['Omar']);
  const billId = await makeGroupBill(page, groupId, { name: 'Omar snack', items: [{ price: '5' }], participantIds: [ids.Omar], payerId: ids.Omar });
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(page.getByRole('link', { name: 'Edit bill' })).toHaveCount(0);

  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/restore`);
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(heading1(page, 'Omar snack')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByText('so this bill is view only')).toHaveCount(0);
  await page.goto(`/groups/${groupId}/bills/${billId}/edit`);
  await expect(heading1(page, 'Edit Omar snack')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/bills/${billId}/edit$`));
  await expect(calculateButton(page)).toBeVisible();
});

// ======================================================================
// US-26 #5, #6, #10 Where Calculate, the results and Save bill sit, and the rates
// ======================================================================

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}
interface EditorBoxes {
  form: Box;
  calculate: Box;
  results: Box;
  save: Box;
}

/** The form, Calculate, the results region and Save bill, measured together in one go. */
function editorBoxes(page: Page): Promise<EditorBoxes> {
  return page.evaluate(() => {
    const box = (el: Element): Box => {
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, width: b.width };
    };
    const buttons = [...document.querySelectorAll('button')];
    const calculate = buttons.find((b) => b.textContent?.trim() === 'Calculate');
    const save = buttons.find((b) => b.textContent?.trim() === 'Save bill');
    const results = [...document.querySelectorAll('h2')].find((h) => h.textContent?.trim() === 'Results')?.closest('section');
    const form = document.querySelector('form');
    if (!calculate || !save || !results || !form) throw new Error('The bill form, Calculate, Results or Save bill is missing');
    return { form: box(form), calculate: box(calculate), results: box(results), save: box(save) };
  });
}

/** Calculate, then the results, then Save bill: one under the other, with nothing between. */
function expectCalculateResultsSaveInOrder(b: EditorBoxes): void {
  expect(b.calculate.bottom).toBeLessThanOrEqual(b.results.top);
  expect(b.results.bottom).toBeLessThanOrEqual(b.save.top);
  expect(b.results.top - b.calculate.bottom, 'Calculate sits just above the results').toBeLessThanOrEqual(32);
  expect(b.save.top - b.results.bottom, 'Save bill sits just below the results').toBeLessThanOrEqual(32);
  // In one column.
  expect(Math.abs(b.results.left - b.calculate.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.save.left - b.calculate.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.results.width - b.calculate.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.save.width - b.calculate.width)).toBeLessThanOrEqual(1);
}

const SCREENS = [
  { label: 'computer, 1280 px wide', width: 1280, height: 900, besideTheForm: true },
  { label: 'phone, 390 px wide', width: 390, height: 844, besideTheForm: false },
] as const;

for (const screen of SCREENS) {
  test(`US-26 #5 on a new solo bill the results area reads "Press Calculate to see results", with Calculate just above it and Save bill just below (${screen.label})`, async ({ page }, info) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await signUpFast(page, info);
    await openNewSolo(page);
    await expect(resultsRegion(page)).toContainText(MSG.pressCalculate);
    const boxes = await editorBoxes(page);
    expectCalculateResultsSaveInOrder(boxes);
    if (screen.besideTheForm) {
      expect(boxes.form.right, 'beside the form on a computer').toBeLessThanOrEqual(boxes.calculate.left);
      expect(Math.abs(boxes.calculate.top - boxes.form.top), 'level with the top of the form').toBeLessThanOrEqual(2);
    } else {
      expect(boxes.calculate.top, 'under the form on a phone').toBeGreaterThanOrEqual(boxes.form.bottom);
      expect(Math.abs(boxes.calculate.left - boxes.form.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(boxes.calculate.width - boxes.form.width)).toBeLessThanOrEqual(1);
    }
  });

  test(`US-26 #5 the group bill form has the same layout (${screen.label})`, async ({ page }, info) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    const t = await startTrip(page, info);
    await openNewGroupBill(page, t.groupId);
    await expect(resultsRegion(page)).toContainText(MSG.pressCalculate);
    const boxes = await editorBoxes(page);
    expectCalculateResultsSaveInOrder(boxes);
    if (screen.besideTheForm) {
      expect(boxes.form.right).toBeLessThanOrEqual(boxes.calculate.left);
      expect(Math.abs(boxes.calculate.top - boxes.form.top)).toBeLessThanOrEqual(2);
    } else {
      expect(boxes.calculate.top).toBeGreaterThanOrEqual(boxes.form.bottom);
    }
  });

  test(`US-26 #5 the edit page has the same layout, with the saved result already showing (${screen.label})`, async ({ page }, info) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await signUpFast(page, info);
    const id = await makeSoloBill(page, CHARGED);
    await page.goto(`/solo/${id}/edit`);
    await expect(heading1(page, 'Edit Charged dinner')).toBeVisible();
    await expect(grandTotal(page)).toHaveText('Rs 144.50');
    const boxes = await editorBoxes(page);
    expectCalculateResultsSaveInOrder(boxes);
    if (screen.besideTheForm) expect(boxes.form.right).toBeLessThanOrEqual(boxes.calculate.left);
    else expect(boxes.calculate.top).toBeGreaterThanOrEqual(boxes.form.bottom);
  });

  test(`US-26 #6 pressing Calculate shows the results in that area, in view (${screen.label})`, async ({ page }, info) => {
    await page.setViewportSize({ width: screen.width, height: screen.height });
    await signUpFast(page, info);
    await openNewSolo(page);
    // A long bill, so on a phone the results start below the screen.
    for (let n = 1; n <= 12; n += 1) {
      if (n > 1) await addItem(page).click();
      await itemPrice(page, n).fill(`${n}.50`);
    }
    await setCharge(page, 'Tax', 'percent', '10');
    await setCharge(page, 'Tip', 'percent', '15');
    const region = resultsRegion(page);
    await expect(region).toContainText(MSG.pressCalculate);
    const before = await editorBoxes(page);

    // Enter in the bill name is Calculate; this keeps Playwright from scrolling to the button for us.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByLabel('Bill name').focus();
    if (!screen.besideTheForm) await expect(region).not.toBeInViewport();
    await page.keyboard.press('Enter');

    await expect(grandTotal(page)).toBeVisible();
    // 78.00 + 12 x 0.50 = 84.00 items, tax 8.40, tip 15% of items 12.60 = 105.00
    await expect(grandTotal(page)).toHaveText('$105.00');
    await expect(region.getByRole('heading', { name: 'Results' })).toBeInViewport();
    await expect(grandTotal(page)).toBeInViewport();
    // It is the same area that said "Press Calculate to see results": same place, and it now holds the numbers.
    await expect(region).not.toContainText(MSG.pressCalculate);
    await expect(region.locator('dl.totals')).toBeVisible();
    const after = await editorBoxes(page);
    expect(after.results.left).toBeCloseTo(before.results.left, 0);
    expect(after.results.width).toBeCloseTo(before.results.width, 0);
  });
}

test('US-26 #6 on a group bill, Calculate shows the results and each person\'s share in the results area', async ({ page }, info) => {
  const t = await startTrip(page, info);
  await openNewGroupBill(page, t.groupId);
  await itemPrice(page, 1).fill('100');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('Rs 100.00');
  const region = resultsRegion(page);
  await expect(region.getByText(`${t.me} paid Rs 100.00.`, { exact: true })).toBeVisible();
  await expect.poll(() => shareLines(region)).toEqual([
    [t.me, 'Rs 33.34', ''],
    ['Ali', 'Rs 33.33', ''],
    ['Sara', 'Rs 33.33', ''],
  ]);
});

test('US-26 #10 a blank or 0% charge shows no rate on its line, while a real % shows it', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await itemPrice(page, 1).fill('50');
  const labels = () => totalLines(resultsRegion(page)).then((lines) => lines.map(([label]) => label));

  // Tax left blank, other charges and tip at 0 %, with the tip "on items + tax": no rate anywhere.
  await setCharge(page, 'Other charges', 'percent', '0');
  await setCharge(page, 'Tip', 'percent', '0');
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('$50.00');
  expect(await labels()).toEqual(['Subtotal', 'Tax', 'Other charges', 'Tip', 'Total']);
  await expect(resultsRegion(page)).not.toContainText('%');

  // 0.00 and 0 % written another way are no rate either.
  await setCharge(page, 'Tax', 'percent', '0.00');
  await setCharge(page, 'Tip', 'percent', '0.0');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('$50.00');
  expect(await labels()).toEqual(['Subtotal', 'Tax', 'Other charges', 'Tip', 'Total']);

  // A real % shows its rate (and the tip says what it is a % of)...
  await setCharge(page, 'Tax', 'percent', '5');
  await setCharge(page, 'Other charges', 'percent', '10');
  await setCharge(page, 'Tip', 'percent', '15');
  await calculateButton(page).click();
  // 50.00 + tax 2.50 + other charges 5.00 + tip 15% of (50.00 + 2.50) = 7.88 (never on other charges)
  await expect(grandTotal(page)).toHaveText('$65.38');
  expect(await labels()).toEqual(['Subtotal', 'Tax (5%)', 'Other charges (10%)', 'Tip (15% of items + tax)', 'Total']);

  // ...and it goes again when the box is emptied.
  await setCharge(page, 'Tax', 'percent', '');
  await setCharge(page, 'Tip', 'percent', '');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('$55.00');
  expect(await labels()).toEqual(['Subtotal', 'Tax', 'Other charges (10%)', 'Tip', 'Total']);
});

// ======================================================================
// US-39 #5 The currency info button
// ======================================================================

/** "Currency: <symbol>" with its info button: pressing it opens the explanation, pressing it again closes it. */
async function expectCurrencyInfo(page: Page, symbol: string): Promise<void> {
  await expect(page.getByText(new RegExp(`^Currency:\\s*${symbol}`))).toBeVisible();
  const button = page.getByRole('button', { name: 'About the currency' });
  const symbolNote = page.getByText(`${symbol} is only a symbol shown next to amounts. Nothing is converted between currencies.`, { exact: true });
  const editNote = page.getByText("Changing the group's currency in Edit group changes the symbol on every bill in this group. The numbers stay exactly the same.", { exact: true });

  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(symbolNote).toBeHidden();
  await expect(editNote).toBeHidden();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(symbolNote).toBeVisible();
  await expect(editNote).toBeVisible();
  // The button points at the note it opened.
  const controls = await button.getAttribute('aria-controls');
  expect(controls).toBeTruthy();
  await expect(page.locator(`[id="${controls}"]`)).toContainText('Nothing is converted between currencies.');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(symbolNote).toBeHidden();
  await expect(editNote).toBeHidden();

  // The keyboard works too (Enter opens it, Space closes it).
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(symbolNote).toBeVisible();
  await page.keyboard.press('Space');
  await expect(symbolNote).toBeHidden();
}

test('US-39 #5 on the group page, "Currency: Rs" has an info button that explains it is only a symbol', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Rupee club', 'Rs', ['Ali']);
  await page.goto(`/groups/${groupId}`);
  await expect(heading1(page, 'Rupee club')).toBeVisible();
  await expectCurrencyInfo(page, 'Rs');
});

test('US-39 #5 on the group bill form, the same info button explains it, whatever the symbol', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Pak club', 'PKR', ['Ali']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(heading1(page, 'Add bill to Pak club')).toBeVisible();
  await expectCurrencyInfo(page, 'PKR');
});

test('US-39 #5 the info button is also on the page of a saved bill being edited', async ({ page }, info) => {
  const t = await startTrip(page, info);
  const billId = await makeGroupBill(page, t.groupId, equalDinner(t));
  await page.goto(`/groups/${t.groupId}/bills/${billId}/edit`);
  await expect(heading1(page, 'Edit Equal dinner')).toBeVisible();
  await expectCurrencyInfo(page, 'Rs');
});

test('US-39 #5 changing the currency in Edit group changes the symbol on the bill, and the numbers stay the same', async ({ page }, info) => {
  const t = await startTrip(page, info);
  const billId = await makeGroupBill(page, t.groupId, equalDinner(t));
  await page.goto(`/groups/${t.groupId}/bills/${billId}`);
  await expect(grandTotal(page)).toHaveText('Rs 44.00');

  // The note says to do it in Edit group: do exactly that.
  await page.goto(`/groups/${t.groupId}/edit`);
  await expect(heading1(page, 'Edit group')).toBeVisible();
  await page.getByLabel('Currency', { exact: true }).selectOption('PKR');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(toast(page, 'Group saved')).toBeVisible();
  await page.goto(`/groups/${t.groupId}/bills/${billId}`);
  await expect(grandTotal(page)).toHaveText('PKR 44.00');
  await expect.poll(() => totalLines(receipt(page))).toEqual([
    ['Subtotal', 'PKR 40.00'],
    ['Tax (10%)', 'PKR 4.00'],
    ['Other charges', 'PKR 0.00'],
    ['Tip', 'PKR 0.00'],
    ['Total', 'PKR 44.00'],
  ]);
});

// ======================================================================
// Selects use the custom chevron
// ======================================================================

/** Every <select> on the page hides the browser's own arrow and leaves room for the app's chevron. */
async function expectCustomChevron(page: Page, label: string): Promise<void> {
  const selects = await page.locator('select').evaluateAll((els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      return {
        what: el.id || el.getAttribute('aria-label') || 'select',
        appearance: style.appearance,
        paddingRight: parseFloat(style.paddingRight),
        chevron: style.backgroundImage,
      };
    }),
  );
  expect(selects.length, `${label}: has a select`).toBeGreaterThan(0);
  for (const s of selects) {
    expect(s.appearance, `${label}: ${s.what} appearance`).toBe('none');
    expect(s.paddingRight, `${label}: ${s.what} padding-right`).toBeGreaterThanOrEqual(40);
    expect(s.chevron, `${label}: ${s.what} draws the chevron`).toContain('url(');
  }
}

test('every <select> uses the custom chevron: no browser arrow and room for it, on a new solo bill and on the group bill form', async ({ page }, info) => {
  const t = await startTrip(page, info);
  await openNewSolo(page);
  await expectCustomChevron(page, 'new solo bill');
  await openNewGroupBill(page, t.groupId);
  await expectCustomChevron(page, 'group bill form');
  await page.getByRole('radio', { name: /^By items/ }).check();
  await expectCustomChevron(page, 'group bill form, by items');
  await page.goto(`/groups/${t.groupId}/settle-ups/new`);
  await expect(heading1(page, 'Record a payment')).toBeVisible();
  await expectCustomChevron(page, 'settle-up form');
});

// ======================================================================
// US-34 #3 Nothing scrolls sideways at 360 px
// ======================================================================

const LONG = (letter: string, n: number) => letter.repeat(n);

/** The page's overflow past the screen's right edge, in px (0 when nothing scrolls sideways). */
const sidewaysOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Like expectNoHorizontalScroll, but a failure is recorded and the test carries on, so one run lists every page that overflows. */
async function softNoHorizontalScroll(page: Page, label: string): Promise<void> {
  expect.soft(await sidewaysOverflow(page), `${label}: px the page scrolls sideways`).toBeLessThanOrEqual(0);
}

test('US-34 #3 at 360 px the "← back" link never makes a bill page scroll sideways, even for the longest group and bill names (no spaces)', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  const group = LONG('G', 50);
  const bill = LONG('W', 60);
  const { groupId, meId, ids } = await makeGroup(page, group, 'CHF', ['Ali']);
  const groupBillId = await makeGroupBill(page, groupId, { name: bill, items: [{ price: '10' }], participantIds: [meId, ids.Ali], payerId: meId });
  const soloId = await makeSoloBill(page, { name: bill, items: [{ price: '10' }] });

  // The link at the top of these pages is "← <group name>" or "← <bill name>".
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(heading1(page, `Add bill to ${group}`)).toBeVisible();
  await softNoHorizontalScroll(page, 'new group bill (back link: the 50-character group name)');
  await page.goto(`/groups/${groupId}/bills/${groupBillId}`);
  await expect(heading1(page, bill)).toBeVisible();
  await softNoHorizontalScroll(page, 'saved group bill (back link: the 50-character group name)');
  await page.goto(`/groups/${groupId}/bills/${groupBillId}/edit`);
  await expect(heading1(page, `Edit ${bill}`)).toBeVisible();
  await softNoHorizontalScroll(page, 'group bill being edited (back link: the 60-character bill name)');
  await page.goto(`/solo/${soloId}`);
  await expect(heading1(page, bill)).toBeVisible();
  await softNoHorizontalScroll(page, 'saved solo bill');
  await page.goto(`/solo/${soloId}/edit`);
  await expect(heading1(page, `Edit ${bill}`)).toBeVisible();
  await softNoHorizontalScroll(page, 'solo bill being edited (back link: the 60-character bill name)');
});

test('US-34 #3 at 360 px a saved bill with the longest bill, item and member names (no spaces) fits on the screen, paid by me', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  const bill = LONG('W', 60);
  const long = { B: LONG('B', 30), C: LONG('C', 30) };

  const soloId = await makeSoloBill(page, {
    name: bill,
    currency: 'CHF',
    items: [
      { name: LONG('M', 40), price: '1000000' },
      { name: 'A long item name with plenty of words', price: '999999.99' },
      { price: '0.01' },
    ],
    tax: pct('12.5'),
    other: amt('1000000'),
    tip: pct('100'),
    tipOn: 'items_tax',
  });
  await page.goto(`/solo/${soloId}`);
  await expect(heading1(page, bill)).toBeVisible();
  await expect(grandTotal(page)).toBeVisible();
  await softNoHorizontalScroll(page, 'saved solo bill');

  const { groupId, meId, ids } = await makeGroup(page, 'Longest names', 'CHF', [long.B, long.C]);
  const everyone = [meId, ids[long.B], ids[long.C]];
  const equalId = await makeGroupBill(page, groupId, {
    name: bill,
    items: [{ name: LONG('M', 40), price: '1000000' }, { price: '999999.99' }],
    tax: pct('12.5'),
    other: amt('1000000'),
    participantIds: everyone,
    payerId: meId,
  });
  await page.goto(`/groups/${groupId}/bills/${equalId}`);
  await expect(heading1(page, bill)).toBeVisible();
  await expect(grandTotal(page)).toBeVisible();
  await softNoHorizontalScroll(page, 'saved group bill split equally, long-named people');

  const itemizedId = await makeGroupBill(page, groupId, {
    name: LONG('V', 60),
    items: [
      { name: LONG('M', 40), price: '1000000', sharerIds: everyone },
      { name: 'Another item', price: '12', sharerIds: [ids[long.C]] },
    ],
    tax: amt('1000000'),
    other: amt('1000000'),
    tip: amt('1000000'),
    splitMode: 'itemized',
    participantIds: everyone,
    payerId: meId,
  });
  await page.goto(`/groups/${groupId}/bills/${itemizedId}`);
  await expect(heading1(page, LONG('V', 60))).toBeVisible();
  await expect(grandTotal(page)).toBeVisible();
  await softNoHorizontalScroll(page, 'saved group bill split by items, long-named people');
});

test('US-34 #3 at 360 px a view-only group bill, with its note and the Delete message for a member with the longest name, fits on the screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  const long = LONG('B', 30);
  const { groupId, ids } = await makeGroup(page, 'Locked', 'CHF', [long]);
  const billId = await makeGroupBill(page, groupId, { name: LONG('W', 60), items: [{ name: LONG('M', 40), price: '1000000' }], participantIds: [ids[long]], payerId: ids[long] });
  await api(page, 'post', `/groups/${groupId}/members/${ids[long]}/remove`);
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(heading1(page, LONG('W', 60))).toBeVisible();
  await softNoHorizontalScroll(page, 'view-only group bill');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await softNoHorizontalScroll(page, 'view-only group bill with the Delete message');
});

test('US-34 #3 at 360 px the group bill form fits with the longest member names, split equally or by items, with results and errors showing', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Longest names', 'CHF', [LONG('B', 30), LONG('C', 30), 'Ali', 'Sara', 'Omar', 'Zainab']);
  await openNewGroupBill(page, groupId, 'Longest names');
  await softNoHorizontalScroll(page, 'new group bill');

  await page.getByLabel('Bill name').fill(LONG('W', 60));
  await itemName(page, 1).fill(LONG('M', 40));
  await itemPrice(page, 1).fill('1000000');
  await chargeGroup(page, 'Tax').getByRole('textbox').fill('100');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toBeVisible();
  await softNoHorizontalScroll(page, 'new group bill with results');

  await page.getByRole('radio', { name: /^By items/ }).check();
  await addItem(page).click();
  await itemName(page, 2).fill(LONG('M', 40));
  await itemPrice(page, 2).fill('999999.99');
  await sharedBy(page, 1).getByRole('button', { name: 'Everyone', exact: true }).click();
  await sharedBy(page, 2).getByRole('button', { name: 'Everyone', exact: true }).click();
  await softNoHorizontalScroll(page, 'new group bill split by items, everyone sharing both items');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toBeVisible();
  await softNoHorizontalScroll(page, 'new group bill split by items with results');

  // Errors showing on the form fit too.
  await itemPrice(page, 2).fill('abc');
  await saveButton(page).click();
  await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
  await softNoHorizontalScroll(page, 'new group bill with an error message');
});

test('US-34 #3 at 360 px the "<name> paid …" line of the results fits when the payer has the longest name (new bill, edit page, saved bill)', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  const long = LONG('B', 30);
  const { groupId, meId, ids } = await makeGroup(page, 'Longest names', 'CHF', [long]);
  const paidLine = (amount: string) => page.getByText(`${long} paid CHF ${amount}.`, { exact: true });

  // A new bill: pick the payer, then Calculate.
  await openNewGroupBill(page, groupId, 'Longest names');
  await itemPrice(page, 1).fill('10');
  await whoPaid(page).selectOption({ label: long });
  await calculateButton(page).click();
  await expect(paidLine('10.00')).toBeVisible();
  await softNoHorizontalScroll(page, 'new group bill with results ("<30-character name> paid CHF 10.00.")');

  // The same bill saved, on its edit page (the result shows at once) and as a receipt.
  const billId = await makeGroupBill(page, groupId, { name: 'Plain', items: [{ price: '10' }], participantIds: [meId, ids[long]], payerId: ids[long] });
  await page.goto(`/groups/${groupId}/bills/${billId}/edit`);
  await expect(heading1(page, 'Edit Plain')).toBeVisible();
  await expect(paidLine('10.00')).toBeVisible();
  await softNoHorizontalScroll(page, 'group bill being edited (results show "<30-character name> paid CHF 10.00.")');
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(heading1(page, 'Plain')).toBeVisible();
  await expect(paidLine('10.00')).toBeVisible();
  await softNoHorizontalScroll(page, 'saved group bill (receipt says "<30-character name> paid CHF 10.00.")');
});

test('US-34 #3 at 360 px a new and an edited solo bill fit on the screen with the largest amounts', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  await openNewSolo(page);
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Currency', { exact: true }).selectOption('other');
  await page.getByLabel('Currency symbol').fill('kr');
  await itemName(page, 1).fill(LONG('M', 40));
  await itemPrice(page, 1).fill('1000000');
  await setCharge(page, 'Tax', 'amount', '1000000');
  await setCharge(page, 'Other charges', 'amount', '1000000');
  await setCharge(page, 'Tip', 'amount', '1000000');
  await calculateButton(page).click();
  await expect(grandTotal(page)).toHaveText('kr 4,000,000.00');
  await expectNoHorizontalScroll(page);

  const id = await makeSoloBill(page, { ...CHARGED, name: 'Edited later' });
  await page.goto(`/solo/${id}/edit`);
  await expect(heading1(page, 'Edit Edited later')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

// ======================================================================
// US-36 #1, #3 Name chips, "Everyone" and the switch for keyboard and screen reader users
// ======================================================================

/** The focused control shows an outline at least 2 px wide, on itself or on the chip / segment around it. */
async function expectFocusOutline(control: Locator, what: string): Promise<void> {
  await expect(control, `${what} has the cursor`).toBeFocused();
  const width = await control.evaluate((el) => {
    const drawn = (node: Element) => {
      const style = getComputedStyle(node);
      return style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth) || 0;
    };
    return Math.max(drawn(el), el.closest('label') ? drawn(el.closest('label') as Element) : 0);
  });
  expect(width, `${what}: focus outline width in px`).toBeGreaterThanOrEqual(2);
}

test('US-36 #1 the name chips, "Everyone" and the %/currency switch are reached and used with the keyboard, with a clear focus outline', async ({ page, browserName }, info) => {
  const t = await startTrip(page, info);
  await openNewGroupBill(page, t.groupId);
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'; // Safari moves between buttons and tick boxes with Alt+Tab
  const took = tookPart(page);
  const everyone = took.getByRole('button', { name: 'Everyone', exact: true });
  const ticked = took.getByRole('checkbox', { checked: true });

  // From the bill name: "Everyone" first, then the chips in the order shown.
  await page.getByLabel('Bill name').focus();
  await page.keyboard.press(next);
  await expectFocusOutline(everyone, '"Everyone"');
  await page.keyboard.press('Space');
  await expect(ticked).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(ticked).toHaveCount(3);
  for (const name of [t.me, 'Ali', 'Sara']) {
    await page.keyboard.press(next);
    await expectFocusOutline(took.getByRole('checkbox', { name, exact: true }), `the "${name}" chip`);
  }
  await page.keyboard.press('Space'); // on the last chip
  await expect(took.getByRole('checkbox', { name: 'Sara', exact: true })).not.toBeChecked();
  await expect(everyone).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(took.getByRole('checkbox', { name: 'Sara', exact: true })).toBeChecked();

  // By items: the same on an item's chips, from its price: the remove button, then "Everyone" and the chips.
  await page.getByRole('radio', { name: /^By items/ }).check();
  await itemPrice(page, 1).fill('10');
  const shared = sharedBy(page, 1);
  const itemEveryone = shared.getByRole('button', { name: 'Everyone', exact: true });
  await page.keyboard.press(next);
  await expect(page.getByRole('button', { name: 'Remove item 1', exact: true })).toBeFocused();
  await page.keyboard.press(next);
  await expectFocusOutline(itemEveryone, 'item 1 "Everyone"');
  await page.keyboard.press('Space');
  await expect(shared.getByRole('checkbox', { checked: true })).toHaveCount(3);
  await page.keyboard.press(next);
  await expectFocusOutline(shared.getByRole('checkbox', { name: t.me, exact: true }), `item 1 "${t.me}" chip`);
  await page.keyboard.press('Space');
  await expect(shared.getByRole('checkbox', { name: t.me, exact: true })).not.toBeChecked();

  // The switch: arrow keys move along it, and the cursor stays on it.
  const taxSwitch = chargeGroup(page, 'Tax').getByRole('radiogroup');
  await taxSwitch.getByRole('radio', { name: 'Percentage' }).focus();
  await expectFocusOutline(taxSwitch.getByRole('radio', { name: 'Percentage' }), 'the "%" segment');
  await page.keyboard.press('ArrowRight');
  await expect(taxSwitch.getByRole('radio', { name: 'Amount' })).toBeFocused();
  await expect(taxSwitch.getByRole('radio', { name: 'Amount' })).toBeChecked();
  // WebKit does not count a radio reached by the arrow keys as ":focus-visible", so it draws no outline there;
  // the segment now on is still marked, as the one filled with colour.
  if (browserName === 'webkit') {
    const fill = (name: string) => taxSwitch.getByRole('radio', { name }).evaluate((el) => getComputedStyle(el.closest('label') as Element).backgroundColor);
    expect(await fill('Amount')).not.toBe(await fill('Percentage'));
  } else {
    await expectFocusOutline(taxSwitch.getByRole('radio', { name: 'Amount' }), 'the currency segment');
  }
});

test('US-36 #3 the "Choose who took part" and "Choose who shared this item" messages are linked to their chips', async ({ page }, info) => {
  const t = await startTrip(page, info);
  await openNewGroupBill(page, t.groupId);
  const took = tookPart(page);

  await itemPrice(page, 1).fill('10');
  await took.getByRole('button', { name: 'Everyone', exact: true }).click(); // untick them all
  await calculateButton(page).click();
  await expect(page.getByText(MSG.noParticipants, { exact: true })).toBeVisible();
  for (const chip of await took.getByRole('checkbox').all()) {
    await expect(chip).toHaveAttribute('aria-invalid', 'true');
    await expect(chip).toHaveAccessibleDescription(MSG.noParticipants);
  }
  // Fixing it clears the message at once, and the chips stop being flagged.
  await took.getByRole('checkbox', { name: 'Ali', exact: true }).check();
  await expect(page.getByText(MSG.noParticipants, { exact: true })).toHaveCount(0);
  await expect(took.getByRole('checkbox', { name: 'Ali', exact: true })).not.toHaveAttribute('aria-invalid', 'true');

  // An item nobody shares: the message sits with that item's chips.
  await took.getByRole('checkbox', { name: t.me, exact: true }).check();
  await whoPaid(page).selectOption({ label: t.me });
  await page.getByRole('radio', { name: /^By items/ }).check();
  await calculateButton(page).click();
  const shared = sharedBy(page, 1);
  await expect(shared.getByText(MSG.noSharers, { exact: true })).toBeVisible();
  for (const chip of await shared.getByRole('checkbox').all()) {
    await expect(chip).toHaveAttribute('aria-invalid', 'true');
    await expect(chip).toHaveAccessibleDescription(MSG.noSharers);
  }
  await shared.getByRole('checkbox', { name: 'Ali', exact: true }).check();
  await expect(shared.getByText(MSG.noSharers)).toHaveCount(0);
});

// ======================================================================
// US-36 #6 Automatic accessibility checks (light and dark) of the new screens
// ======================================================================

for (const scheme of ['light', 'dark'] as const) {
  test(`US-36 #6 no WCAG 2.2 AA problems on the read-only group bill, the group bill edit page (split by items) and the solo edit page (${scheme})`, async ({ browser }, info) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ colorScheme: scheme });
    try {
      const page = await context.newPage();
      const t = await startTrip(page, info);
      const itemizedId = await makeGroupBill(page, t.groupId, itemizedDinner(t));
      const equalId = await makeGroupBill(page, t.groupId, equalDinner(t));
      const soloId = await makeSoloBill(page, CHARGED);

      // The receipt of a bill split by items, then one split equally.
      await page.goto(`/groups/${t.groupId}/bills/${itemizedId}`);
      await expect(heading1(page, 'Itemized dinner')).toBeVisible();
      await expect(receipt(page).getByTestId('share')).toHaveCount(3);
      await expectScheme(page, scheme);
      await expectNoA11yViolations(page, `read-only group bill, split by items (${scheme})`);
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Delete this bill?' })).toBeVisible();
      await expectNoA11yViolations(page, `delete bill dialog (${scheme})`);
      await page.keyboard.press('Escape');
      await page.goto(`/groups/${t.groupId}/bills/${equalId}`);
      await expect(heading1(page, 'Equal dinner')).toBeVisible();
      await expect(receipt(page).getByTestId('share')).toHaveCount(3);
      await expectNoA11yViolations(page, `read-only group bill, split equally (${scheme})`);

      // Editing the bill split by items: chips under every item, the result showing, the currency note open.
      await page.goto(`/groups/${t.groupId}/bills/${itemizedId}/edit`);
      await expect(heading1(page, 'Edit Itemized dinner')).toBeVisible();
      await expect(sharedBy(page, 1)).toBeVisible();
      await expect(grandTotal(page)).toHaveText('Rs 65.30');
      await expectNoA11yViolations(page, `group bill edit page, split by items (${scheme})`);
      await page.getByRole('button', { name: 'About the currency' }).click();
      await expect(page.getByRole('button', { name: 'About the currency' })).toHaveAttribute('aria-expanded', 'true');
      await expectNoA11yViolations(page, `group bill edit page, currency note open (${scheme})`);
      // With errors showing as well.
      await tookPart(page).getByRole('button', { name: 'Everyone', exact: true }).click();
      await calculateButton(page).click();
      await expect(page.getByText(MSG.noParticipants, { exact: true })).toBeVisible();
      await expectNoA11yViolations(page, `group bill edit page with errors (${scheme})`);

      // The solo bill: read-only, then the edit page.
      await page.goto(`/solo/${soloId}`);
      await expect(heading1(page, 'Charged dinner')).toBeVisible();
      await expectNoA11yViolations(page, `read-only solo bill (${scheme})`);
      await page.goto(`/solo/${soloId}/edit`);
      await expect(heading1(page, 'Edit Charged dinner')).toBeVisible();
      await expect(grandTotal(page)).toHaveText('Rs 144.50');
      await expectNoA11yViolations(page, `solo edit page (${scheme})`);
      await itemPrice(page, 1).fill('abc');
      await saveButton(page).click();
      await expect(page.getByText(MSG.price, { exact: true })).toBeVisible();
      await expectNoA11yViolations(page, `solo edit page with an error (${scheme})`);
    } finally {
      await context.close();
    }
  });

  test(`US-36 #6 no WCAG 2.2 AA problems on a view-only group bill with its notes and the Delete message (${scheme})`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ colorScheme: scheme });
    try {
      const page = await context.newPage();
      await signUpFast(page, info);
      const { groupId, ids } = await makeGroup(page, 'Locked', '$', ['Omar']);
      const billId = await makeGroupBill(page, groupId, { name: 'Omar snack', items: [{ price: '5' }], participantIds: [ids.Omar], payerId: ids.Omar });
      await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
      await page.goto(`/groups/${groupId}/bills/${billId}`);
      await expect(heading1(page, 'Omar snack')).toBeVisible();
      await expectScheme(page, scheme);
      await expectNoA11yViolations(page, `view-only group bill (${scheme})`);
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Restore Omar to change this bill' })).toBeVisible();
      await expectNoA11yViolations(page, `view-only group bill with the Delete message (${scheme})`);
      // The group page, with the bill marked "Saved" after a save and the "View only" tag on this one.
      await page.goto(`/groups/${groupId}`);
      await expect(page.getByRole('tabpanel').getByText('View only')).toBeVisible();
      await expectNoA11yViolations(page, `group page with a view-only bill (${scheme})`);
    } finally {
      await context.close();
    }
  });

  test(`US-36 #6 no WCAG 2.2 AA problems on the history and the bill list right after saving, with the "Saved" mark (${scheme})`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({ colorScheme: scheme });
    try {
      const page = await context.newPage();
      const t = await startTrip(page, info);
      await openNewSolo(page);
      await itemPrice(page, 1).fill('9');
      await saveButton(page).click();
      await expect(heading1(page, 'Solo bills')).toBeVisible();
      await expect(page.getByRole('link', { name: /Bill – / }).getByText('Saved', { exact: true })).toBeVisible();
      await expectScheme(page, scheme);
      await expectNoA11yViolations(page, `solo history with a saved bill (${scheme})`);

      await openNewGroupBill(page, t.groupId);
      await itemPrice(page, 1).fill('9');
      await saveButton(page).click();
      await expect(heading1(page, 'Trip')).toBeVisible();
      await expect(page.getByRole('tabpanel').getByRole('link', { name: /Bill – / }).getByText('Saved', { exact: true })).toBeVisible();
      await expectNoA11yViolations(page, `group bill list with a saved bill (${scheme})`);
    } finally {
      await context.close();
    }
  });
}

// ======================================================================
// Re-review fixes: Back after saving, Enter on a ticked line, the "Saved" word,
// long names in dialogs, a long typed symbol and clicking the switch's text
// ======================================================================

const pathname = (page: Page) => new URL(page.url()).pathname;

test('US-07 #1 after saving a bill opened from the history, Back does not show the history a second time, and the bill is still marked "Saved"', async ({ page }, info) => {
  await signUpFast(page, info);
  // Dashboard -> Solo bills -> New solo bill (from the list's empty state).
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Solo bills' }).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'New solo bill' }).last().click();
  await expect(heading1(page, 'New solo bill')).toBeVisible();
  await page.getByLabel('Bill name').fill('First lunch');
  await itemPrice(page, 1).fill('9');
  await saveButton(page).click();

  await expect(heading1(page, 'Solo bills')).toBeVisible();
  const first = page.getByRole('link', { name: /First lunch/ });
  await expect(first.getByText('Saved', { exact: true })).toBeVisible();

  // Again from the header link, now that the list has a bill.
  await page.getByRole('main').getByRole('link', { name: 'New solo bill' }).click();
  await expect(heading1(page, 'New solo bill')).toBeVisible();
  await page.getByLabel('Bill name').fill('Second lunch');
  await itemPrice(page, 1).fill('11');
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await expect(page.getByRole('link', { name: /Second lunch/ }).getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText('Saved', { exact: true }), 'only the bill just saved is marked').toHaveCount(1);

  // One Back goes to the page before the history: the Dashboard.
  await page.goBack();
  await expect(heading1(page, 'Dashboard')).toBeVisible();
  expect(pathname(page)).toBe('/');
});

test('US-07 #1 a bill started from the Dashboard also lands on the history after saving, and Back goes to the Dashboard', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.getByRole('main').getByRole('link', { name: 'New solo bill' }).first().click();
  await expect(heading1(page, 'New solo bill')).toBeVisible();
  await itemPrice(page, 1).fill('5');
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toHaveCount(1);
  await page.goBack();
  await expect(heading1(page, 'Dashboard')).toBeVisible();
});

test('US-18 #2 after adding a bill from the group page, Back does not show the group a second time', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Flat', '$', ['Ali']);
  await page.goto('/groups');
  await expect(heading1(page, 'Groups')).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: /^Flat/ }).first().click();
  await expect(heading1(page, 'Flat')).toBeVisible();
  // From the empty Bills tab, then from the header button.
  for (const [name, price, from] of [['Groceries', '30', 'empty'], ['Rent share', '50', 'header']]) {
    const addBill = page.getByRole('main').getByRole('link', { name: 'Add bill' });
    await (from === 'empty' ? addBill.last() : addBill.first()).click();
    await expect(heading1(page, 'Add bill to Flat')).toBeVisible();
    await page.getByLabel('Bill name').fill(name);
    await itemPrice(page, 1).fill(price);
    await saveButton(page).click();
    await expect(heading1(page, 'Flat')).toBeVisible();
    expect(pathname(page)).toBe(`/groups/${groupId}`);
    await expect(page.getByRole('tabpanel').getByRole('link', { name: new RegExp(name) }).getByText('Saved', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved', { exact: true })).toHaveCount(1);
  }
  await page.goBack();
  await expect(heading1(page, 'Groups')).toBeVisible();
});

test('US-05 #16 split by items, Enter in the empty name of a last line that already has people ticked moves to its price', async ({ page }, info) => {
  const t = await startTrip(page, info);
  await openNewGroupBill(page, t.groupId);
  await page.getByRole('radio', { name: /^By items/ }).check();
  await itemName(page, 1).fill('Pizza');
  await itemPrice(page, 1).fill('30');
  await sharedBy(page, 1).getByRole('checkbox', { name: 'Ali', exact: true }).check();
  await addItem(page).click();
  await sharedBy(page, 2).getByRole('button', { name: 'Everyone' }).click();

  await itemName(page, 2).focus();
  await page.keyboard.press('Enter');
  await expect(itemPrice(page, 2), 'a line with people ticked counts, so Enter moves on').toBeFocused();
  await expect(grandTotal(page)).toHaveCount(0);
  await expect(page.getByText(MSG.price, { exact: true })).toHaveCount(0);
});

test('the "Saved" mark is its own word after the bill name, for screen readers too', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await page.getByLabel('Bill name').fill('Dinner');
  await itemPrice(page, 1).fill('10');
  await saveButton(page).click();
  const title = page.getByRole('link', { name: /Dinner/ }).locator('.link-row-title');
  expect(await title.evaluate((el) => el.textContent ?? '')).toMatch(/^Dinner Saved\b/);

  const { groupId } = await makeGroup(page, 'Flat', '$', ['Ali']);
  await openNewGroupBill(page, groupId, 'Flat');
  await page.getByLabel('Bill name').fill('Groceries');
  await itemPrice(page, 1).fill('30');
  await saveButton(page).click();
  const groupTitle = page.getByRole('tabpanel').getByRole('link', { name: /Groceries/ }).locator('.link-row-title');
  expect(await groupTitle.evaluate((el) => el.textContent ?? '')).toMatch(/^Groceries Saved\b/);
});

test('US-34 #3 at 360 px the "Remove <name>?" dialog wraps the longest member name (30 characters, no spaces) inside the dialog', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const longName = 'W'.repeat(30);
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Flat', '$', [longName]);
  await page.goto(`/groups/${groupId}`);
  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: `Remove ${longName}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Remove ${longName}?` })).toBeVisible();
  const sideways = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sideways, 'the dialog does not scroll sideways').toBeLessThanOrEqual(0);
  await expectNoHorizontalScroll(page);
});

test('US-34 #3 at 360 px a long symbol typed as "Other" currency does not stretch the charge switches', async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signUpFast(page, info);
  await openNewSolo(page);
  await page.getByLabel('Currency', { exact: true }).selectOption('other');
  await page.getByLabel('Currency symbol').fill('KyrgyzstaniSomUnits');
  for (const label of CHARGE_LABELS) {
    const group = chargeGroup(page, label);
    const switchBox = await group.getByRole('radiogroup', { name: `${label} as`, exact: true }).boundingBox();
    const box = await group.getByRole('textbox').boundingBox();
    expect(switchBox && switchBox.width, `${label}: the switch stays narrow`).toBeLessThan(170);
    expect(box && box.width, `${label}: the box keeps room to type`).toBeGreaterThan(100);
    // The whole symbol is still in the radio's name.
    await expect(group.getByRole('radiogroup', { name: `${label} as`, exact: true }).getByRole('radio').last()).toHaveAccessibleName('KyrgyzstaniSomUnits amount');
  }
  await expectNoHorizontalScroll(page);
});

test('US-05 #17 clicking the visible "%" or currency text of the switch puts the cursor in the box', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await page.getByLabel('Currency', { exact: true }).selectOption('Rs');
  for (const label of CHARGE_LABELS) {
    const group = chargeGroup(page, label);
    const switcher = group.getByRole('radiogroup', { name: `${label} as`, exact: true });
    for (const [i, radioName] of [[1, 'Rs amount'], [0, 'Percentage']] as const) {
      await page.getByLabel('Bill name').focus();
      // A real mouse click on the middle of the written text, as a person would.
      await switcher.scrollIntoViewIfNeeded();
      const text = await switcher.locator(SEGMENT_TEXT).nth(i).boundingBox();
      expect(text).not.toBeNull();
      await page.mouse.click(text!.x + text!.width / 2, text!.y + text!.height / 2);
      await expect(switcher.getByRole('radio', { name: radioName, exact: true }), `${label}: ${radioName} chosen`).toBeChecked();
      await expect(group.getByRole('textbox'), `${label}: cursor in the box after clicking "${radioName}"`).toBeFocused();
    }
  }
});

test('US-18 #2 "Add bill" pressed on the Members tab still lands on the bill list with the new bill marked "Saved"', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Flat', '$', ['Ali']);
  await page.goto(`/groups/${groupId}`);
  for (const tab of ['Members', 'Settle-ups', 'Activity']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.getByRole('tab', { name: tab, selected: true })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Add bill' }).first().click();
    await expect(heading1(page, 'Add bill to Flat')).toBeVisible();
    await page.getByLabel('Bill name').fill(`From ${tab}`);
    await itemPrice(page, 1).fill('10');
    await saveButton(page).click();
    await expect(heading1(page, 'Flat')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Bills', selected: true }), `saved from the ${tab} tab`).toBeVisible();
    await expect(page.getByRole('tabpanel').getByRole('link', { name: new RegExp(`From ${tab}`) }).getByText('Saved', { exact: true })).toBeVisible();
  }
});

test('US-07 #1 a new bill opened from the history and then reloaded still lands on the history, marked "Saved", with the "Bill saved" message', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo');
  await page.getByRole('main').getByRole('link', { name: 'New solo bill' }).first().click();
  await expect(heading1(page, 'New solo bill')).toBeVisible();
  await page.reload();
  await expect(heading1(page, 'New solo bill')).toBeVisible();
  await page.getByLabel('Bill name').fill('After reload');
  await itemPrice(page, 1).fill('7');
  await saveButton(page).click();
  await expect(heading1(page, 'Solo bills')).toBeVisible();
  expect(pathname(page)).toBe('/solo');
  await expect(toast(page, 'Bill saved')).toBeVisible();
  await expect(page.getByRole('link', { name: /After reload/ }).getByText('Saved', { exact: true })).toBeVisible();
  // And Back still doesn't show the history a second time.
  await page.goBack();
  await expect(heading1(page, 'Dashboard')).toBeVisible();
});

test('US-38 leaving a new bill while its save is still going: when the save finishes, I stay where I went', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo');
  await page.getByRole('main').getByRole('link', { name: 'New solo bill' }).first().click();
  await expect(heading1(page, 'New solo bill')).toBeVisible();
  await page.getByLabel('Bill name').fill('Slow save');
  await itemPrice(page, 1).fill('4');

  // Hold the save on its way to the server until the person has left.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/solo-bills', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await held;
    await route.continue();
  });
  await saveButton(page).click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Leave' }).click();
  await expect(heading1(page, 'Dashboard')).toBeVisible();

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/solo-bills') && r.request().method() === 'POST');
  release();
  await saved;
  // The finished save doesn't move the person again.
  await page.waitForTimeout(500);
  await expect(heading1(page, 'Dashboard')).toBeVisible();
  expect(pathname(page)).toBe('/');
});

test('US-05 #16 holding Enter down in the last price adds one line and does not calculate', async ({ page }, info) => {
  await signUpFast(page, info);
  await openNewSolo(page);
  await itemPrice(page, 1).fill('12');
  await itemPrice(page, 1).focus();
  await page.keyboard.down('Enter');
  await expect(itemName(page, 2)).toBeFocused();
  // The key is still down: these are the keyboard's repeats.
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  await expect(removeButtons(page)).toHaveCount(2);
  await expect(itemName(page, 2)).toBeFocused();
  await expect(grandTotal(page)).toHaveCount(0);
});
