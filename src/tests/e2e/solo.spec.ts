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

test('US-06/US-07/US-08/US-37 save, reopen, edit and delete a solo bill', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Currency', { exact: true }).selectOption('Rs');
  await page.getByLabel('Bill name').fill('Biryani night');
  // Each price is at most 1,000,000.00, but the total can be larger.
  await page.getByLabel('Item 1 price').fill('1000000');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('234567.50');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,234,567.50');

  // US-37: Saving… while saving, one bill even with a double-click, and a corner message.
  await page.getByRole('button', { name: 'Save bill' }).dblclick();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Biryani night' })).toBeVisible();
  const { bills } = await api<{ bills: unknown[] }>(page, 'get', '/solo-bills');
  expect(bills).toHaveLength(1);

  // Reopened: currency is locked and inputs are as saved.
  await expect(page.getByText("can't be changed after the bill is saved")).toBeVisible();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Item 2 price')).toHaveValue('234567.50');

  // Edit and save recalculates.
  await page.getByRole('button', { name: 'Remove item 2' }).click();
  await page.getByLabel('Item 1 price').fill('400');
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 400.00');

  await page.getByRole('link', { name: 'Solo bills' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  const row = page.getByRole('link', { name: /Biryani night/ });
  await expect(row).toContainText('Rs 400.00');

  // Delete asks first; Cancel keeps it.
  await row.click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this bill?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Solo bills' })).toBeVisible();
  await expect(page.getByText('No solo bills yet.')).toBeVisible();
});

test('US-06 #4 a bad custom currency symbol is refused', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await page.getByLabel('Currency', { exact: true }).selectOption('other');
  await page.getByLabel('Currency symbol').fill('R1');
  await page.getByLabel('Item 1 price').fill('5');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByText('Currency symbol must be 1–3 characters with no digits')).toBeVisible();
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
