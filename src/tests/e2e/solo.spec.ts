import { expect, test, type Page } from '@playwright/test';
import { api, signUpFast } from './helpers.js';

async function fillCharge(page: Page, label: 'Tax' | 'Other charges' | 'Tip', mode: '%' | 'Amount', value: string) {
  const group = page.getByRole('group', { name: label, exact: false }).filter({ has: page.getByRole('radiogroup') }).first();
  await group.getByRole('radio', { name: mode === '%' ? 'Percentage' : 'Amount' }).check();
  await group.getByRole('textbox').fill(value);
}

test('US-05/US-26 calculate a solo bill; results hide when inputs change', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.getByRole('link', { name: 'New solo bill' }).first().click();
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();

  await page.getByLabel('Item 1 price').fill('12.50');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('7.50');
  await fillCharge(page, 'Tax', '%', '10');
  await fillCharge(page, 'Other charges', '%', '5');
  await fillCharge(page, 'Tip', '%', '15');
  await page.getByRole('button', { name: 'Calculate' }).click();

  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByText('$20.00')).toBeVisible();
  await expect(results.getByText('$2.00')).toBeVisible();
  await expect(results.getByText('$1.00')).toBeVisible();
  await expect(results.getByText('$3.00')).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveText('$26.00');
  await expect(results).toBeInViewport();

  // Changing anything hides the old result.
  await page.getByLabel('Item 1 price').fill('12.51');
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();

  // An invalid field shows its message next to it and no result.
  await page.getByLabel('Item 1 price').fill('1.000,50');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Price must be between 0.01 and 1,000,000.00, with at most 2 decimal places')).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveCount(0);
  await expect(page.getByLabel('Item 1 price')).toBeFocused();

  // Fixing it and pressing Calculate shows the right result without reloading:
  // items 1,008.00 + tax 100.80 + other charges 50.40 + tip 151.20.
  await page.getByLabel('Item 1 price').fill('1,000.50');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('$1,310.40');
  await expect(page.getByText('Price must be between')).toHaveCount(0);
});

test('US-05 #13 / US-25 other charges and empty bills give clear messages', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByRole('button', { name: /Remove/ }).click();
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Add at least one item')).toBeVisible();

  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 1 price').fill('10');
  await fillCharge(page, 'Other charges', 'Amount', '0.001');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Other charges must be between 0.01 and 1,000,000.00, or left empty')).toBeVisible();
  await fillCharge(page, 'Other charges', '%', '100.01');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Other charges must be between 0.01% and 100%, or left empty')).toBeVisible();
});

test('US-06 #7 / US-07 #1 / US-08 #1-#6 / US-37 save, open, edit and delete a solo bill', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Currency', { exact: true }).selectOption('Rs');
  await page.getByLabel('Bill name').fill('Biryani night');
  // Each price is at most 1,000,000.00, but the total can be larger.
  await page.getByLabel('Item 1 name').fill('Biryani');
  await page.getByLabel('Item 1 price').fill('1000000');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('234567.50');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,234,567.50');

  // US-37 #1: a corner message. (US-37 #3, one bill for a double-click, has its own test below.)
  // US-07 #1: saving takes me to my history, with the bill marked "Saved".
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  const { bills } = await api<{ bills: unknown[] }>(page, 'get', '/solo-bills');
  expect(bills).toHaveLength(1);
  const row = page.getByRole('link', { name: /Biryani night/ });
  await expect(row).toContainText('Saved');
  await expect(row).toContainText('Rs 1,234,567.50');

  // US-08 #1: opened, it is a read-only receipt: the items and the total, with Edit bill and Delete.
  await row.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Biryani night' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Items' }).getByRole('listitem')).toHaveText([/^Biryani\s*Rs 1,000,000\.00$/, /^Item 2\s*Rs 234,567\.50$/]);
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,234,567.50');
  await expect(page.getByLabel('Item 1 price')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

  // US-08 #2 and US-06 #7: "Edit bill" opens the form as saved, with the currency shown as fixed.
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Biryani night' })).toBeVisible();
  await expect(
    page.getByText('A saved bill keeps its currency. To use a different one, delete this bill and add it again with the right currency.'),
  ).toBeVisible();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Item 2 price')).toHaveValue('234567.50');

  // US-08 #3: saving an edit recalculates, and goes back to the history with the bill marked "Saved".
  await page.getByRole('button', { name: 'Remove item 2' }).click();
  await page.getByLabel('Item 1 price').fill('400');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(row).toContainText('Rs 400.00');
  await expect(row).toContainText('Saved');

  // US-08 #6: Delete asks first; Cancel (or Esc) keeps it.
  await row.click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this bill?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Biryani night' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page.getByText('No solo bills yet.')).toBeVisible();
});

test('US-37 #3 a second click on Save that lands right after the first save has finished still creates only one bill', async ({ page }, info) => {
  await signUpFast(page, info);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/solo-bills') posts.push(r.url());
  });
  await page.goto('/solo/new');
  await page.getByLabel('Bill name').fill('Pressed twice');
  await page.getByLabel('Item 1 price').fill('5');

  // How far apart the two clicks of a double-click land depends on the browser and the machine, so here the second
  // click is made to land at the worst moment: the instant "Saving…" turns back into "Save bill" because the first
  // save has finished (the form is only left a moment later). A second save must not start from there.
  await page.evaluate(() => {
    const saveButton = () => [...document.querySelectorAll('button')].find((b) => /^(Save bill|Saving…)$/.test(b.textContent?.trim() ?? ''));
    let saving = false;
    let pressedAgain = false;
    new MutationObserver(() => {
      const button = saveButton();
      if (!button) return;
      if (button.textContent?.trim() === 'Saving…') saving = true;
      else if (saving && !pressedAgain) {
        pressedAgain = true;
        button.click();
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();

  // A request to save is made the moment a click is accepted, so a second one shows up here.
  expect(posts, 'requests to save the bill').toHaveLength(1);
  const { bills } = await api<{ bills: { name: string }[] }>(page, 'get', '/solo-bills');
  expect(bills.map((b) => b.name)).toEqual(['Pressed twice']);
});

test('US-06 #4 a bad custom currency symbol is refused', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Currency', { exact: true }).selectOption('other');
  await page.getByLabel('Currency symbol').fill('R1');
  await page.getByLabel('Item 1 price').fill('5');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Enter a currency symbol of up to 3 characters, with no digits')).toBeVisible();
  await page.getByLabel('Currency symbol').fill('kr');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('kr 5.00');
});

test('US-38 leaving with unsaved changes asks first', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').fill('9.99');
  await page.getByRole('link', { name: 'Groups' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'You have unsaved changes. Leave without saving?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByLabel('Item 1 price')).toHaveValue('9.99');

  await page.getByRole('link', { name: 'Groups' }).first().click();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  expect((await api<{ bills: unknown[] }>(page, 'get', '/solo-bills')).bills).toHaveLength(0);

  // No changes: no question.
  await page.goto('/solo/new');
  await page.getByRole('link', { name: 'Groups' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
});

test("US-38 #1-#3/#5 on a saved bill's edit page, leaving with changes asks first, and nothing is asked when there are none or after saving", async ({ page }, info) => {
  await signUpFast(page, info);
  const { bill } = await api<{ bill: { id: string } }>(page, 'post', '/solo-bills', {
    currency: '$',
    bill: {
      name: 'Guard check',
      items: [{ name: '', price: '20' }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
    },
  });
  const receiptHeading = page.getByRole('heading', { level: 1, name: 'Guard check', exact: true });
  const dialog = page.getByRole('dialog', { name: 'You have unsaved changes. Leave without saving?' });
  const savedTotal = async () => (await api<{ bill: { totalCents: number } }>(page, 'get', `/solo-bills/${bill.id}`)).bill.totalCents;
  await page.goto(`/solo/${bill.id}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Guard check' })).toBeVisible();

  // Nothing changed: Cancel goes straight back to the receipt, with no question (#5).
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(receiptHeading).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A change: Cancel asks first (#1), and Stay keeps what I typed (#2).
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await page.getByLabel('Item 1 price').fill('99');
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Item 1 price')).toHaveValue('99');

  // Leave goes to the receipt and the change is thrown away: nothing was saved (#3).
  await page.getByRole('link', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Leave' }).click();
  await expect(receiptHeading).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveText('$20.00');
  expect(await savedTotal()).toBe(2000);

  // Just saved: moving on to the history needs no question (#5).
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await page.getByLabel('Item 1 price').fill('50');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await savedTotal()).toBe(5000);
});

test('US-27 offline save keeps every input', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Item 1 price').fill('42.00');
  await page.route('**/api/solo-bills', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('alert')).toHaveText("Couldn't save — check your connection");
  await expect(page.getByLabel('Item 1 price')).toHaveValue('42.00');
  await page.unroute('**/api/solo-bills');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
});
