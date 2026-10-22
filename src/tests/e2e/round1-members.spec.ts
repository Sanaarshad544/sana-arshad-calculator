import { expect, test, type Locator, type Page } from '@playwright/test';
import { PASSWORD, api, makeGroup, signUpFast, uniqueName } from './helpers.js';

// QA round 1 additions about members and groups: the Dashboard's "who" lists (US-33 #9),
// removed members and invites (US-23 #7, US-12 #7), and the group bill form's layout and messages (US-26 #5, #9, #11).

// ---------- Local helpers ----------

interface MemberDto {
  id: string;
  name: string;
  status: 'current' | 'removed';
  /** The person's own invite code while they have no account; null once they have one. */
  inviteCode: string | null;
}

/** A group bill paid by `payerId`, split equally between `participantIds`. */
function groupBillBody(participantIds: string[], payerId: string, price: string, name: string) {
  return {
    bill: {
      name,
      items: [{ name: '', price }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds,
      payerId,
    },
  };
}

/** A not-yet-joined person's own invite code, as any member of the group sees it. */
async function inviteCodeOf(page: Page, groupId: string, memberName: string): Promise<string> {
  const { group } = await api<{ group: { members: MemberDto[] } }>(page, 'get', `/groups/${groupId}`);
  const code = group.members.find((m) => m.name === memberName)?.inviteCode;
  if (!code) throw new Error(`${memberName} has no invite code`);
  return code;
}

async function openMembersTab(page: Page, groupId: string, groupName: string): Promise<void> {
  await page.goto(`/groups/${groupId}?tab=members`);
  await expect(page.getByRole('heading', { level: 1, name: groupName })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /^Members \(/ })).toBeVisible();
}

async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

// ---------- US-33 #9 who I owe and who owes me ----------

const whoYouOwe = (page: Page) => page.getByRole('list', { name: 'Who you owe' });
const whoOwesYou = (page: Page) => page.getByRole('list', { name: 'Who owes you' });
const bothWhoLists = (page: Page) => page.getByRole('list', { name: /^Who (you owe|owes you)$/ });
const rowFor = (list: Locator, text: string) => list.getByRole('listitem').filter({ hasText: text });

test("US-33 #9 the Dashboard says who I owe and who owes me: the person, the amount in the group's currency, and a link to the group", async ({ page }, info) => {
  await signUpFast(page, info);

  // QA Trip (Rs): I paid 900.00 for three, so Ali and Zara each owe me 300.00.
  const trip = await makeGroup(page, 'QA Trip', 'Rs', ['Ali', 'Zara']);
  await api(page, 'post', `/groups/${trip.groupId}/bills`, groupBillBody([trip.meId, trip.ids.Ali, trip.ids.Zara], trip.meId, '900', 'Hotel'));
  // Flat share ($): Sara paid 60.00 for three, so I owe Sara 20.00. Dina owes Sara 20.00 too, but that is not mine to pay.
  const flat = await makeGroup(page, 'Flat share', '$', ['Sara', 'Dina']);
  await api(page, 'post', `/groups/${flat.groupId}/bills`, groupBillBody([flat.meId, flat.ids.Sara, flat.ids.Dina], flat.ids.Sara, '60', 'Groceries'));
  // All square (£): I paid 10.00 for two and Omar paid his 5.00 back, so nobody owes anything.
  const square = await makeGroup(page, 'All square', '£', ['Omar']);
  await api(page, 'post', `/groups/${square.groupId}/bills`, groupBillBody([square.meId, square.ids.Omar], square.meId, '10', 'Snacks'));
  await api(page, 'post', `/groups/${square.groupId}/settle-ups`, { fromId: square.ids.Omar, toId: square.meId, amount: '5' });

  await openDashboard(page);
  const owe = whoYouOwe(page);
  const owed = whoOwesYou(page);

  // Who I owe: Sara, in the $ group.
  await expect(owe.getByRole('listitem')).toHaveCount(1);
  const sara = rowFor(owe, 'To Sara');
  await expect(sara).toHaveCount(1);
  await expect(sara).toContainText('$20.00');
  await expect(sara.getByRole('link', { name: 'Flat share' })).toHaveAttribute('href', `/groups/${flat.groupId}`);

  // Who owes me: Ali and Zara, in the Rs group, each with their own amount.
  await expect(owed.getByRole('listitem')).toHaveCount(2);
  for (const person of ['Ali', 'Zara']) {
    const row = rowFor(owed, `From ${person}`);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Rs 300.00');
    await expect(row.getByRole('link', { name: 'QA Trip' })).toHaveAttribute('href', `/groups/${trip.groupId}`);
  }

  // Nobody shows up in the wrong list, and what isn't mine to pay or is settled up isn't listed.
  await expect(owe).not.toContainText(/Ali|Zara/);
  await expect(owed).not.toContainText('Sara');
  await expect(bothWhoLists(page)).toHaveCount(2);
  for (const list of [owe, owed]) {
    await expect(list).not.toContainText(/Dina|Omar/);
    await expect(list.getByRole('link', { name: 'All square' })).toHaveCount(0);
  }
  // The rows add up to the totals above them, one line per currency.
  await expect(page.getByRole('region', { name: 'You owe', exact: true })).toContainText('−$20.00');
  await expect(page.getByRole('region', { name: "You're owed", exact: true })).toContainText('+Rs 600.00');

  // A group link opens that group.
  await rowFor(owed, 'From Zara').getByRole('link', { name: 'QA Trip' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'QA Trip' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${trip.groupId}$`));
  await openDashboard(page);
  await rowFor(whoYouOwe(page), 'To Sara').getByRole('link', { name: 'Flat share' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Flat share' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${flat.groupId}$`));
});

test('US-33 #9 a row follows the payments: part-paying lowers its amount and paying in full removes it', async ({ page }, info) => {
  await signUpFast(page, info);
  const trip = await makeGroup(page, 'Pay back', 'Rs', ['Ali', 'Zara']);
  await api(page, 'post', `/groups/${trip.groupId}/bills`, groupBillBody([trip.meId, trip.ids.Ali, trip.ids.Zara], trip.meId, '900', 'Hotel'));
  const pays = (name: 'Ali' | 'Zara', amount: string) =>
    api(page, 'post', `/groups/${trip.groupId}/settle-ups`, { fromId: trip.ids[name], toId: trip.meId, amount });

  await openDashboard(page);
  await expect(rowFor(whoOwesYou(page), 'From Ali')).toContainText('Rs 300.00');
  await expect(rowFor(whoOwesYou(page), 'From Zara')).toContainText('Rs 300.00');

  await pays('Ali', '100');
  await openDashboard(page);
  await expect(rowFor(whoOwesYou(page), 'From Ali')).toContainText('Rs 200.00');
  await expect(rowFor(whoOwesYou(page), 'From Zara')).toContainText('Rs 300.00');

  await pays('Ali', '200');
  await openDashboard(page);
  await expect(whoOwesYou(page).getByRole('listitem')).toHaveCount(1);
  await expect(rowFor(whoOwesYou(page), 'From Zara')).toContainText('Rs 300.00');
  await expect(whoOwesYou(page)).not.toContainText('Ali');

  await pays('Zara', '300');
  await openDashboard(page);
  await expect(page.getByText('You owe nothing and are owed nothing.')).toBeVisible();
  await expect(whoOwesYou(page)).toHaveCount(0);
  await expect(whoYouOwe(page)).toHaveCount(0);
});

// ---------- US-23 #7 a removed member's used invite ----------

test('US-23 #7 a removed member who opens their used invite again is refused, and only Restore gives the group back', async ({ browser }, info) => {
  const ownerCtx = await browser.newContext();
  const omarCtx = await browser.newContext();
  try {
    const owner = await ownerCtx.newPage();
    const omar = await omarCtx.newPage();
    await signUpFast(owner, info, 'own');
    const { groupId, ids } = await makeGroup(owner, 'Locked out', '$', ['Omar']);
    const code = await inviteCodeOf(owner, groupId, 'Omar');
    await signUpFast(omar, info, 'omar');
    await api(omar, 'post', `/invites/${code}/accept`);
    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('heading', { level: 1, name: 'Locked out' })).toBeVisible();

    await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);

    // He opens his own invite link again: it has been used, so there is nothing to join.
    await omar.goto(`/invite/${code}`);
    await expect(omar.getByRole('heading', { level: 1, name: 'Invite already used' })).toBeVisible();
    await expect(omar.getByRole('alert')).toHaveText('This invite has already been used');
    await expect(omar.getByRole('button', { name: 'Join these groups' })).toHaveCount(0);
    // Asking the server directly is refused too.
    const again = await omar.request.post(`/api/invites/${code}/accept`, { data: {} });
    expect(again.status()).toBe(409);
    expect(((await again.json()) as { error: { message: string } }).error.message).toBe('This invite has already been used');

    // He is still out: no access to the group, and it is not in his list.
    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('alert')).toHaveText('You no longer have access to this group');
    await omar.goto('/groups');
    await expect(omar.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(omar.getByText('No groups yet. Create one to start splitting with friends.')).toBeVisible();
    await expect(omar.getByRole('link', { name: /Locked out/ })).toHaveCount(0);

    // The group still lists him as removed, so only a member's Restore can bring him back.
    await openMembersTab(owner, groupId, 'Locked out');
    await expect(owner.getByRole('heading', { level: 2, name: 'Members (1)' })).toBeVisible();
    await expect(owner.getByText('Omar (removed)')).toBeVisible();
    await owner.getByRole('button', { name: 'Restore Omar' }).click();
    await expect(owner.getByRole('status').getByText('Member restored')).toBeVisible();
    await expect(owner.getByRole('heading', { level: 2, name: 'Members (2)' })).toBeVisible();
    await expect(owner.getByText('Omar (removed)')).toHaveCount(0);

    await omar.goto(`/groups/${groupId}`);
    await expect(omar.getByRole('heading', { level: 1, name: 'Locked out' })).toBeVisible();
    await omar.goto('/groups');
    await expect(omar.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(omar.getByRole('link', { name: /Locked out/ })).toBeVisible();
  } finally {
    await ownerCtx.close();
    await omarCtx.close();
  }
});

test('US-12 #7 a person removed from one of their groups before joining gets the other group, and the removed one only when someone restores them', async ({ browser }, info) => {
  const ownerCtx = await browser.newContext();
  const ghaniaCtx = await browser.newContext();
  try {
    const owner = await ownerCtx.newPage();
    const ghania = await ghaniaCtx.newPage();
    await signUpFast(owner, info, 'own');
    const open = await makeGroup(owner, 'Open group', '$', ['Ghania']);
    const closed = await makeGroup(owner, 'Closed group', '$', []);
    // The same person in both groups (picked from "My people"), then removed from the second one before she ever joined.
    const { people } = await api<{ people: { key: string; name: string }[] }>(owner, 'get', `/people?groupId=${closed.groupId}`);
    const key = people.find((p) => p.name === 'Ghania')?.key;
    expect(key, 'Ghania is offered from the other group').toBeTruthy();
    const { memberId } = await api<{ memberId: string }>(owner, 'post', `/groups/${closed.groupId}/members`, { personKey: key });
    await api(owner, 'post', `/groups/${closed.groupId}/members/${memberId}/remove`);
    const code = await inviteCodeOf(owner, open.groupId, 'Ghania');

    // She creates her account from her invite link.
    await ghania.goto(`/invite/${code}`);
    await expect(ghania.getByRole('heading', { level: 1, name: "Ghania, join your friends' groups" })).toBeVisible();
    await ghania.getByLabel('Username').fill(uniqueName('gh', info));
    await ghania.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await ghania.getByRole('button', { name: 'Create account and join' }).click();
    await expect(ghania.getByRole('heading', { level: 1, name: 'Save your recovery code' })).toBeVisible();
    await ghania.getByRole('button', { name: "I've saved it, continue" }).click();
    await expect(ghania.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(ghania.getByRole('status').getByText('You joined 1 group')).toBeVisible();

    // The open group is hers; the one she was removed from is not.
    await ghania.goto('/groups');
    await expect(ghania.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(ghania.getByRole('link', { name: /Open group/ })).toBeVisible();
    await expect(ghania.getByRole('link', { name: /Closed group/ })).toHaveCount(0);
    await ghania.goto(`/groups/${closed.groupId}`);
    await expect(ghania.getByRole('alert')).toHaveText('You no longer have access to this group');

    // The closed group still lists her as removed: only Restore brings her in.
    await openMembersTab(owner, closed.groupId, 'Closed group');
    await expect(owner.getByText('Ghania (removed)')).toBeVisible();
    await owner.getByRole('button', { name: 'Restore Ghania' }).click();
    await expect(owner.getByRole('status').getByText('Member restored')).toBeVisible();
    await ghania.goto(`/groups/${closed.groupId}`);
    await expect(ghania.getByRole('heading', { level: 1, name: 'Closed group' })).toBeVisible();
    await ghania.goto('/groups');
    await expect(ghania.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
    await expect(ghania.getByRole('link', { name: /Closed group/ })).toBeVisible();
  } finally {
    await ownerCtx.close();
    await ghaniaCtx.close();
  }
});

// ---------- US-26 #11 Save bill sits under the results ----------

/** How far `lower` starts below the bottom edge of `upper`, in CSS pixels. Both are measured in the same instant, so a scroll can't skew it. */
async function gapBelow(lower: Locator, upper: Locator): Promise<number> {
  const reference = await upper.elementHandle();
  try {
    return await lower.evaluate((el, ref) => el.getBoundingClientRect().top - ref.getBoundingClientRect().bottom, reference);
  } finally {
    await reference.dispose();
  }
}

/** Edges of an element measured from the top left of the page, so scrolling never changes them. */
async function pageBox(target: Locator): Promise<{ left: number; right: number; top: number; bottom: number }> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left + window.scrollX, right: box.right + window.scrollX, top: box.top + window.scrollY, bottom: box.bottom + window.scrollY };
  });
}

test('US-26 #5 on a group bill, Calculate, the results area and "Save bill" sit beside the form on a computer and under the form on a phone', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Side column', '$', ['Ali']);
  const form = page.locator('form').filter({ has: page.getByLabel('Bill name') });
  const calculate = page.getByRole('button', { name: 'Calculate' });
  const results = page.getByRole('region', { name: 'Results' });
  const save = page.getByRole('button', { name: 'Save bill' });
  const measure = async () => ({ form: await pageBox(form), calculate: await pageBox(calculate), results: await pageBox(results), save: await pageBox(save) });

  // A computer: the three sit in a column to the right of the form, starting level with it, in this order.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Side column' })).toBeVisible();
  await expect(results).toContainText('Press Calculate to see results');
  const wide = await measure();
  for (const part of [wide.calculate, wide.results, wide.save]) expect(part.left, 'beside the form').toBeGreaterThanOrEqual(wide.form.right);
  expect(wide.calculate.top, 'starts level with the form').toBeLessThan(wide.form.bottom);
  expect(wide.results.top, 'results under Calculate').toBeGreaterThanOrEqual(wide.calculate.bottom);
  expect(wide.save.top, 'Save under the results').toBeGreaterThanOrEqual(wide.results.bottom);

  // A phone: the same three, in the same order, but under the form.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(results).toBeVisible();
  const narrow = await measure();
  expect(narrow.calculate.top, 'Calculate under the form').toBeGreaterThanOrEqual(narrow.form.bottom);
  expect(narrow.results.top, 'results under Calculate').toBeGreaterThanOrEqual(narrow.calculate.bottom);
  expect(narrow.save.top, 'Save under the results').toBeGreaterThanOrEqual(narrow.results.bottom);
  for (const part of [narrow.calculate, narrow.results, narrow.save]) expect(part.left, 'not beside the form').toBeLessThan(narrow.form.right);
});

test('US-26 #6 on a group bill at 375 px wide, Calculate fills the results area and brings it into view', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.setViewportSize({ width: 375, height: 812 });
  const { groupId } = await makeGroup(page, 'Long form', '$', ['Ali', 'Sara', 'Omar']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Long form' })).toBeVisible();
  // Eight items make the form taller than the screen.
  for (let n = 1; n <= 8; n += 1) {
    if (n > 1) await page.getByRole('button', { name: '+ Add item' }).click();
    await page.getByLabel(`Item ${n} price`).fill(String(n * 5));
  }
  const results = page.getByRole('region', { name: 'Results' });
  // Back at the top, the results area is off screen.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(results).not.toBeInViewport();
  // Enter in the bill name is Calculate; it avoids Playwright scrolling the Calculate button into view for us.
  await page.getByLabel('Bill name').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('grand-total')).toHaveText('$180.00');
  await expect(page.getByTestId('share')).toHaveCount(4);
  await expect(results.getByRole('heading', { name: 'Results' })).toBeInViewport();
  await expect(page.getByTestId('grand-total')).toBeInViewport();
  // The cursor is in the results, so a screen reader reads them out.
  await expect(results).toBeFocused();
});

test('US-26 #7 on a group bill, changing who took part, who paid, how to split or who shared an item sends the results area back to "Press Calculate to see results"', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Stale results', '$', ['Ali', 'Sara']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Stale results' })).toBeVisible();

  const took = page.getByRole('group', { name: 'Who took part' });
  const shared = page.getByRole('group', { name: 'Who shared item 1', exact: true });
  const press = () => page.getByRole('button', { name: 'Calculate' }).click();
  /** The results are showing the figures for the bill as it is now. */
  const showing = async () => {
    await expect(page.getByTestId('grand-total')).toHaveText('$30.00');
    await expect(page.getByText('Press Calculate to see results')).toHaveCount(0);
  };
  /** The old figures are gone and the area asks for Calculate again. */
  const gone = async () => {
    await expect(page.getByText('Press Calculate to see results')).toBeVisible();
    await expect(page.getByTestId('grand-total')).toHaveCount(0);
    await expect(page.getByTestId('share')).toHaveCount(0);
  };

  await page.getByLabel('Item 1 price').fill('30');
  await press();
  await showing();
  await expect(page.getByTestId('share')).toHaveCount(3);

  // Who took part: unticking a chip, and the "Everyone" button.
  await took.getByRole('checkbox', { name: 'Sara', exact: true }).uncheck();
  await gone();
  await press();
  await showing();
  await expect(page.getByTestId('share')).toHaveCount(2);
  await took.getByRole('button', { name: 'Everyone', exact: true }).click();
  await gone();
  await press();
  await showing();
  await expect(page.getByTestId('share')).toHaveCount(3);

  // Who paid.
  await page.getByLabel('Who paid').selectOption({ label: 'Ali' });
  await gone();
  await press();
  await showing();
  await expect(page.getByText('Ali paid $30.00.')).toBeVisible();

  // How to split, then who shared the item: a chip and the item's "Everyone" button.
  await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
  await gone();
  await shared.getByRole('button', { name: 'Everyone', exact: true }).click();
  await press();
  await showing();
  await shared.getByRole('checkbox', { name: 'Sara', exact: true }).uncheck();
  await gone();
  await press();
  await showing();
  await shared.getByRole('button', { name: 'Everyone', exact: true }).click();
  await gone();
});

test('US-26 #11 on a group bill, "Save bill" sits under the results (before and after Calculate, on a computer and a phone), and saving still works', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Save below', '$', ['Ali']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Save below' })).toBeVisible();

  const calculate = page.getByRole('button', { name: 'Calculate' });
  const results = page.getByRole('region', { name: 'Results' });
  const save = page.getByRole('button', { name: 'Save bill' });
  await expect(save).toHaveCount(1);

  // Before Calculate the results area holds its placeholder, and Save is already under it.
  await expect(results).toContainText('Press Calculate to see results');
  expect(await gapBelow(results, calculate), 'Results start below the Calculate button').toBeGreaterThanOrEqual(0);
  expect(await gapBelow(save, results), 'Save bill starts below the empty results area').toBeGreaterThanOrEqual(0);

  // After Calculate the results are filled in, and Save is still under them.
  await page.getByLabel('Bill name').fill('Dinner out');
  await page.getByLabel('Item 1 price').fill('20');
  await calculate.click();
  await expect(page.getByTestId('grand-total')).toHaveText('$20.00');
  await expect(page.getByTestId('share')).toHaveCount(2);
  expect(await gapBelow(results, calculate), 'Results start below the Calculate button').toBeGreaterThanOrEqual(0);
  expect(await gapBelow(save, results), 'Save bill starts below the results').toBeGreaterThanOrEqual(0);
  await expect(save).toHaveCount(1);

  // The order is the same on a phone-sized screen.
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await gapBelow(results, calculate), 'Results start below the Calculate button on a phone').toBeGreaterThanOrEqual(0);
  expect(await gapBelow(save, results), 'Save bill starts below the results on a phone').toBeGreaterThanOrEqual(0);

  // Saving from down there still saves the bill.
  await save.click();
  await expect(page.getByRole('status').getByText('Bill saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Save below' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Dinner out/ })).toBeVisible();
  const { bills } = await api<{ bills: { name: string; totalCents: number }[] }>(page, 'get', `/groups/${groupId}/bills`);
  expect(bills.map((b) => [b.name, b.totalCents])).toEqual([['Dinner out', 2000]]);
});

// ---------- US-26 #9 an error goes as soon as its field is edited ----------

const sharedBy = (page: Page, n: number) => page.getByRole('group', { name: `Who shared item ${n}`, exact: true });

test(`US-26 #9 on a group bill, "Choose who shared this item" goes as soon as someone is ticked for that item, before Calculate`, async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Sharers', '$', ['Ali', 'Sara']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Sharers' })).toBeVisible();
  await page.getByRole('radio', { name: /By items/ }).check();
  await page.getByLabel('Item 1 price').fill('10');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('6');
  const ali = (n: number) => sharedBy(page, n).getByRole('checkbox', { name: 'Ali', exact: true });
  const sara = (n: number) => sharedBy(page, n).getByRole('checkbox', { name: 'Sara', exact: true });

  // Nobody ticked on either item: Calculate shows one error per item (under its chips) and no result.
  await page.getByRole('button', { name: 'Calculate' }).click();
  const errors = page.getByText('Choose who shared this item', { exact: true });
  await expect(errors).toHaveCount(2);
  for (const n of [1, 2]) {
    await expect(sharedBy(page, n).getByText('Choose who shared this item', { exact: true })).toBeVisible();
    for (const box of [ali(n), sara(n)]) {
      await expect(box).toHaveAccessibleDescription('Choose who shared this item');
      await expect(box).toHaveAttribute('aria-invalid', 'true');
    }
  }
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();

  // Editing some other field leaves both errors alone.
  await page.getByLabel('Bill name').fill('Dinner');
  await expect(errors).toHaveCount(2);

  // Ticking Ali on item 1 clears item 1's error at once: item 2's stays.
  await ali(1).check();
  await expect(errors).toHaveCount(1);
  for (const box of [ali(1), sara(1)]) {
    await expect(box).toHaveAccessibleDescription('');
    await expect(box).not.toHaveAttribute('aria-invalid', 'true');
  }
  for (const box of [ali(2), sara(2)]) {
    await expect(box).toHaveAccessibleDescription('Choose who shared this item');
    await expect(box).toHaveAttribute('aria-invalid', 'true');
  }

  // Ticking Sara on item 2 clears the last one. Calculate was never pressed, so there is still no result.
  await sara(2).check();
  await expect(errors).toHaveCount(0);
  for (const box of [ali(2), sara(2)]) await expect(box).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Press Calculate to see results')).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveCount(0);
});
