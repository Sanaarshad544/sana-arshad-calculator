import { expect, test, type Page } from '@playwright/test';
import { makeGroup, signUpFast } from './helpers.js';

/** Adds rows until there are `count` items, then types the same price into each. */
async function fillItems(page: Page, count: number, price: string): Promise<void> {
  await expect(page.getByRole('button', { name: '+ Add item' })).toBeVisible();
  await page.evaluate(
    async ({ count, price }) => {
      const add = [...document.querySelectorAll('button')].find((b) => b.textContent === '+ Add item') as HTMLButtonElement;
      while (document.querySelectorAll('.item-row').length < count) {
        add.click();
        await new Promise((r) => setTimeout(r, 0));
      }
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (let i = 1; i <= count; i += 1) {
        const input = [...document.querySelectorAll('input')].find((el) =>
          [...(el.labels ?? [])].some((l) => l.textContent === `Item ${i} price`),
        ) as HTMLInputElement;
        setValue.call(input, price);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    { count, price },
  );
  await expect(page.getByLabel(`Item ${count} price`)).toHaveValue(price);
}

async function setCharge(page: Page, group: string, mode: 'Percentage' | 'Amount', value: string) {
  const g = page.getByRole('group', { name: group });
  await g.getByRole('radio', { name: mode }).check();
  await g.getByRole('textbox').fill(value);
}

test('US-25 #12 three items of 1,000,000.00 give a subtotal of 3,000,000.00 with no error', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await fillItems(page, 3, '1000000.00');
  await page.getByRole('button', { name: 'Calculate' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.locator('dt', { hasText: 'Subtotal' }).locator('xpath=following-sibling::dd')).toHaveText('$3,000,000.00');
  await expect(page.getByTestId('grand-total')).toHaveText('$3,000,000.00');
  await expect(page.locator('.field-error')).toHaveCount(0);
});

test('US-25 #13 the largest bill shows exactly 1,000,000,000.00', async ({ page }, info) => {
  test.setTimeout(120_000);
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await fillItems(page, 200, '1000000.00');
  await setCharge(page, 'Tax', 'Percentage', '100');
  await setCharge(page, 'Other charges (optional)', 'Percentage', '100');
  await setCharge(page, 'Tip', 'Percentage', '100');
  await page.getByRole('radio', { name: 'Items + tax' }).check();
  await page.getByRole('button', { name: 'Calculate' }).click();
  const results = page.getByRole('region', { name: 'Results' });
  // A % line carries its rate in its label, so each line is found by its full label.
  const line = (label: RegExp) => results.locator('dt').filter({ hasText: label }).locator('xpath=following-sibling::dd');
  await expect(line(/^Subtotal$/)).toHaveText('$200,000,000.00');
  await expect(line(/^Tax \(100%\)$/)).toHaveText('$200,000,000.00');
  await expect(line(/^Other charges \(100%\)$/)).toHaveText('$200,000,000.00');
  await expect(line(/^Tip \(100% of items \+ tax\)$/)).toHaveText('$400,000,000.00');
  await expect(page.getByTestId('grand-total')).toHaveText('$1,000,000,000.00');
});

test('US-10 #3 member names must be 1–30 characters', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Names', '$', []);
  await page.goto(`/groups/${groupId}?tab=members`);
  const field = page.getByLabel('Add a friend by name');
  const add = page.getByRole('button', { name: 'Add member' });
  for (const bad of ['', '   ', 'x'.repeat(31)]) {
    await field.fill(bad);
    await add.click();
    await expect(page.getByText('Name must be 1–30 characters')).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Members (1)' })).toBeVisible();
  for (const good of ['Z', 'y'.repeat(30)]) {
    await field.fill(good);
    await add.click();
    await expect(page.getByRole('button', { name: `Remove ${good}` })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Members (3)' })).toBeVisible();
});

test('US-13 #2 the extra cent goes to the first person listed, even after unticking and re-ticking', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Order', '$', ['Ali', 'Sara']);
  await page.goto(`/groups/${groupId}/bills/new`);
  const took = page.getByRole('group', { name: 'Who took part' });
  const me = took.getByRole('checkbox').first();
  await me.uncheck();
  await me.check();
  await page.getByLabel('Item 1 price').fill('100');
  await page.getByRole('button', { name: 'Calculate' }).click();
  const shares = page.getByTestId('share');
  await expect(shares.nth(0)).toContainText('$33.34');
  await expect(shares.nth(0)).toContainText('+1 cent');
  await expect(shares.nth(1)).toContainText('Ali');
  await expect(shares.nth(2)).toContainText('Sara');
});
