import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { PASSWORD, api, makeGroup, signUpFast } from './helpers.js';

// Changes made after the security and code reviews of QA round 1: who can see an
// invite, when it changes, and smaller fixes found in review. Every person is a
// separate browser context (own cookies).

const NAME_USED = 'That name has already been used in this group';
const INVITE_INVALID = "That invite link isn't valid. Check the code and try again.";

interface MemberInfo {
  id: string;
  name: string;
  inviteCode: string | null;
}

async function memberOf(page: Page, groupId: string, name: string): Promise<MemberInfo> {
  const { group } = await api<{ group: { members: MemberInfo[] } }>(page, 'get', `/groups/${groupId}`);
  const member = group.members.find((m) => m.name === name);
  if (!member) throw new Error(`"${name}" is not a member of group ${groupId}`);
  return member;
}

async function inviteCodeOf(page: Page, groupId: string, name: string): Promise<string> {
  const { inviteCode } = await memberOf(page, groupId, name);
  if (!inviteCode) throw new Error(`"${name}" has no invite code`);
  return inviteCode;
}

async function addFromOtherGroups(page: Page, groupId: string, name: string): Promise<void> {
  const { people } = await api<{ people: { key: string; name: string }[] }>(page, 'get', `/people?groupId=${groupId}`);
  const person = people.find((p) => p.name === name);
  if (!person) throw new Error(`"${name}" is not among the people in my other groups`);
  await api(page, 'post', `/groups/${groupId}/members`, { personKey: person.key });
}

async function openMembers(page: Page, groupId: string, name: string): Promise<void> {
  await page.goto(`/groups/${groupId}?tab=members`);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/** One person's row on the Members tab (not the "Invite <name>" box). */
const memberRow = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Rename ${name}`, exact: true }) });

/** A second person, logged in, in their own browser context. */
async function newPerson(browser: Browser, opened: BrowserContext[], info: TestInfo, prefix: string) {
  const context = await browser.newContext();
  opened.push(context);
  const page = await context.newPage();
  const username = await signUpFast(page, info, prefix);
  return { page, username };
}

async function closeAll(opened: BrowserContext[]): Promise<void> {
  for (const context of opened) await context.close();
}

test("US-11 #6 a member who isn't in all of Omar's groups sees no code for him, only who can send it", async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const dinner = await makeGroup(page, 'Dinner', '$', ['Omar', 'Sara']);
    const trip = await makeGroup(page, 'Trip', '$', []);
    await addFromOtherGroups(page, trip.groupId, 'Omar');
    const sara = await newPerson(browser, opened, info, 'sara');
    await api(sara.page, 'post', `/invites/${await inviteCodeOf(page, dinner.groupId, 'Sara')}/accept`);

    // Sara is in Dinner but not in Trip, so Omar's code would let her into Trip.
    await openMembers(sara.page, dinner.groupId, 'Dinner');
    const row = memberRow(sara.page, 'Omar');
    await expect(row).toContainText("Only someone who's in all of Omar's groups can send their invite.");
    await expect(row).not.toContainText('Invite code');
    await expect(sara.page.getByRole('button', { name: 'Copy link for Omar' })).toHaveCount(0);

    // The owner is in both groups and can send it.
    await openMembers(page, dinner.groupId, 'Dinner');
    await expect(memberRow(page, 'Omar').getByRole('button', { name: 'Copy link for Omar' })).toBeVisible();
    await expect(memberRow(page, 'Omar')).not.toContainText('Only someone');
  } finally {
    await closeAll(opened);
  }
});

test("US-11 #2 when the browser can't copy, Omar's link is shown in a box to copy by hand", async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'No clipboard', '$', ['Omar']);
  const code = await inviteCodeOf(page, groupId, 'Omar');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('not allowed')) }, configurable: true });
  });
  await openMembers(page, groupId, 'No clipboard');
  await page.getByRole('button', { name: 'Copy link for Omar' }).click();
  const box = page.getByRole('textbox', { name: 'Invite link for Omar' });
  await expect(box).toHaveValue(`${new URL(page.url()).origin}/invite/${code}`);
  await expect(box).toHaveAttribute('readonly', '');
  await expect(page.getByText("Copying didn't work here. Select the link and copy it.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy link for Omar' })).toHaveText('Copy link for Omar');
});

test('US-11 #7 when someone with an account is removed, the old invite link stops working and a new code is shown', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const { groupId } = await makeGroup(page, 'Flat', '$', ['Omar', 'Sara']);
    const sara = await newPerson(browser, opened, info, 'sara');
    await api(sara.page, 'post', `/invites/${await inviteCodeOf(page, groupId, 'Sara')}/accept`);
    const old = await inviteCodeOf(sara.page, groupId, 'Omar');

    await openMembers(page, groupId, 'Flat');
    await page.getByRole('button', { name: 'Remove Sara' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove member' }).click();
    await expect(page.getByRole('status').getByText('Member removed')).toBeVisible();
    // The page shows Omar's new code once it has reloaded.
    const shown = memberRow(page, 'Omar').getByTestId('invite-code-Omar');
    await expect(shown).not.toHaveText(old);
    const fresh = (await shown.textContent()) ?? '';
    expect(fresh).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    // Sara's copy of the old link no longer opens anything, even from a new account.
    const strangerContext = await browser.newContext();
    opened.push(strangerContext);
    const visitor = await strangerContext.newPage();
    await visitor.goto(`/invite/${old}`);
    await expect(visitor.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
    await expect(visitor.getByRole('alert')).toHaveText(INVITE_INVALID);
    await visitor.goto(`/invite/${fresh}`);
    await expect(visitor.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

test("US-41 #2 adding Omar to a group: the box says whether his link stays the same or changed", async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    // Only the owner could see Zed's code, and the owner is in the new group: it stays the same.
    const club = await makeGroup(page, 'Club', '$', ['Zed']);
    const sent = await inviteCodeOf(page, club.groupId, 'Zed');
    const books = await makeGroup(page, 'Books', '$', []);
    await openMembers(page, books.groupId, 'Books');
    await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Zed (Club)' });
    await page.getByRole('button', { name: 'Add to group' }).click();
    const zedBox = page.getByRole('region', { name: 'Invite Zed' });
    await expect(zedBox).toContainText('Zed was added. Their invite link now covers this group too.');
    await expect(zedBox.getByTestId('invite-code-Zed')).toHaveText(sent);

    // Sara can see Omar's code in Dinner but isn't in Trip: adding Omar to Trip changes it.
    const dinner = await makeGroup(page, 'Dinner', '$', ['Omar', 'Sara']);
    const sara = await newPerson(browser, opened, info, 'sara');
    await api(sara.page, 'post', `/invites/${await inviteCodeOf(page, dinner.groupId, 'Sara')}/accept`);
    const old = await inviteCodeOf(sara.page, dinner.groupId, 'Omar');
    const trip = await makeGroup(page, 'Trip', '$', []);
    await openMembers(page, trip.groupId, 'Trip');
    await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Omar (Dinner)' });
    await page.getByRole('button', { name: 'Add to group' }).click();
    const omarBox = page.getByRole('region', { name: 'Invite Omar' });
    await expect(omarBox).toContainText("Omar was added. Their invite link has changed, so send them this new one. It links every group they're in at once.");
    const fresh = (await omarBox.getByTestId('invite-code-Omar').textContent()) ?? '';
    expect(fresh).not.toBe(old);
    expect(await inviteCodeOf(page, dinner.groupId, 'Omar')).toBe(fresh);
  } finally {
    await closeAll(opened);
  }
});

test('US-41 #4 when their name is taken here, a "Name in this group" box lets me add them under another name', async ({ page }, info) => {
  await signUpFast(page, info);
  const flat = await makeGroup(page, 'Flat', '$', ['Omar']);
  const club = await makeGroup(page, 'Club', '$', ['Omar']);
  await openMembers(page, club.groupId, 'Club');
  await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Omar (Flat)' });
  await page.getByRole('button', { name: 'Add to group' }).click();

  const name = page.getByRole('textbox', { name: 'Name in this group' });
  await expect(name).toHaveValue('Omar');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(NAME_USED)).toBeVisible();
  await name.fill('Omar F');
  await expect(page.getByText(NAME_USED)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to group' }).click();
  await expect(page.getByRole('status').getByText('Member added')).toBeVisible();
  await expect(memberRow(page, 'Omar F')).toBeVisible();
  // The same person: one code in both groups.
  expect(await inviteCodeOf(page, club.groupId, 'Omar F')).toBe(await inviteCodeOf(page, flat.groupId, 'Omar'));
  await expect(page.getByRole('textbox', { name: 'Name in this group' })).toHaveCount(0);
});

test('US-40 #6 the rename box closes with Esc, Cancel or Save name, and the cursor goes back to Rename', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Names', '$', ['omar']);
  await openMembers(page, groupId, 'Names');

  await page.getByRole('button', { name: 'Rename omar' }).click();
  const box = page.getByRole('textbox', { name: 'New name for omar' });
  await expect(box).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Rename omar' })).toBeFocused();

  await page.getByRole('button', { name: 'Rename omar' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Rename omar' })).toBeFocused();

  await page.getByRole('button', { name: 'Rename omar' }).click();
  await page.getByRole('textbox', { name: 'New name for omar' }).fill('Omar');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').getByText('Name changed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename Omar', exact: true })).toBeFocused();
});

test('US-12 #8 "Use an invite code" takes the code with spaces or dashes, or the whole pasted link, and explains bad characters', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const { groupId } = await makeGroup(page, 'Codes', '$', ['Omar']);
    const code = await inviteCodeOf(page, groupId, 'Omar');
    const friend = await newPerson(browser, opened, info, 'fr');
    const heading = friend.page.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" });

    await friend.page.goto('/join');
    await friend.page.getByLabel('Invite code').fill(`${new URL(friend.page.url()).origin}/invite/${code.toLowerCase()}`);
    await friend.page.getByRole('button', { name: 'Continue' }).click();
    await expect(heading).toBeVisible();

    await friend.page.goto('/join');
    await friend.page.getByLabel('Invite code').fill(`${code.slice(0, 4)}-${code.slice(4, 8)} ${code.slice(8)}`);
    await friend.page.getByRole('button', { name: 'Continue' }).click();
    await expect(heading).toBeVisible();

    await friend.page.goto('/join');
    const field = friend.page.getByLabel('Invite code');
    await field.fill('abc/def?');
    await friend.page.getByRole('button', { name: 'Continue' }).click();
    await expect(friend.page.getByText('Invite codes have only letters and numbers. Check the code and try again.')).toBeVisible();
    await expect(friend.page).toHaveURL(/\/join$/);
    await field.fill(code);
    await expect(friend.page.getByText('Invite codes have only letters and numbers.')).toHaveCount(0);
  } finally {
    await closeAll(opened);
  }
});

test('US-12 #7 a group skipped because I was already in it shows the invited name as "already here as" me', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, 'Omar');
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const result = await api<{ result: { joined: string[]; alreadyIn: string[] } }>(
      pat.page,
      'post',
      `/invites/${await inviteCodeOf(page, groupA.groupId, 'Omar')}/accept`,
    );
    expect(result.result).toMatchObject({ joined: ['Group B'], alreadyIn: ['Group A'] });

    await openMembers(page, groupA.groupId, 'Group A');
    await expect(memberRow(page, 'Omar')).toContainText('already here as Pat');
    await expect(memberRow(page, 'Omar')).not.toContainText('Invite code');
    await expect(memberRow(page, 'Omar')).not.toContainText('not joined yet');
  } finally {
    await closeAll(opened);
  }
});

test('US-26 #11 when the server rejects a field on Save, the message shows above Save and the cursor moves to that field', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/solo/new');
  await expect(page.getByRole('heading', { level: 1, name: 'New solo bill' })).toBeVisible();
  await page.getByLabel('Item 1 price').fill('10');
  await page.route('**/api/solo-bills', (route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Please fix the highlighted fields', fields: { 'items.0.price': 'Price must be between 0.01 and 1,000,000.00' } } }),
    }),
  );
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByLabel('Item 1 price')).toBeFocused();
  await expect(page.getByText('Price must be between 0.01 and 1,000,000.00')).toBeVisible();
  const alert = page.locator('.save-bar').getByRole('alert');
  await expect(alert).toHaveText('Please fix the highlighted fields');
});

test('US-18 #5 the "Restore Omar to change this bill" message for Delete shows at the top, next to Delete', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Locked', '$', ['Omar']);
  // Omar pays for only himself, so his balance is 0.00 and he can be removed.
  const { billId } = await api<{ billId: string }>(page, 'post', `/groups/${groupId}/bills`, {
    bill: {
      name: 'Omar snack',
      items: [{ name: '', price: '5' }],
      tax: { mode: 'amount', value: '0' },
      otherCharges: { mode: 'amount', value: '' },
      tip: { mode: 'amount', value: '0' },
      tipOn: 'items',
      splitMode: 'equal',
      participantIds: [ids.Omar],
      payerId: ids.Omar,
    },
  });
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await page.goto(`/groups/${groupId}/bills/${billId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Omar snack' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Restore Omar to change this bill' });
  await expect(alert).toBeVisible();
  const [alertTop, formTop, deleteBottom] = await page.evaluate(() => {
    const a = [...document.querySelectorAll('[role="alert"]')].find((el) => el.textContent?.includes('Restore Omar'));
    const f = document.querySelector('form.card');
    const d = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === 'Delete');
    return [a?.getBoundingClientRect().top ?? -1, f?.getBoundingClientRect().top ?? -1, d?.getBoundingClientRect().bottom ?? -1];
  });
  expect(alertTop).toBeGreaterThan(deleteBottom - 1);
  expect(alertTop).toBeLessThan(formTop);
});

test('US-25 #19 on sign up and reset, editing a field removes its own message and leaves the others', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible();
  await page.getByRole('button', { name: 'Create account' }).click();
  const usernameRule = page.getByText('Enter a username of 3 to 30 English letters, numbers or underscores, like omar_99');
  const passwordRule = page.getByText('Password must be at least 8 characters');
  await expect(usernameRule).toBeVisible();
  await expect(passwordRule).toBeVisible();
  await page.getByLabel('Username').fill('s');
  await expect(usernameRule).toHaveCount(0);
  await expect(passwordRule).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('x');
  await expect(passwordRule).toHaveCount(0);

  await page.goto('/reset');
  await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Username').fill('someone');
  await page.getByLabel('Recovery code').fill('AAAAA-BBBBB-CCCCC-DDDDD');
  await page.getByLabel('New password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(passwordRule).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await expect(passwordRule).toHaveCount(0);
});

test('US-12 #9 a friend already in one of the groups is warned, and Cancel in "Join as Omar?" changes nothing', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, 'Omar');
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const code = await inviteCodeOf(page, groupA.groupId, 'Omar');

    await pat.page.goto(`/invite/${code}`);
    await expect(pat.page.getByText("You're already in Group A. If you're not Omar, don't join: send them this link instead.")).toBeVisible();
    await pat.page.getByRole('button', { name: 'Join these groups' }).click();
    const dialog = pat.page.getByRole('dialog', { name: 'Join as Omar?' });
    await expect(dialog).toContainText(`${pat.username} is already in Group A.`);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // Nothing changed: the invite is still unused and Pat isn't in Group B.
    expect(await inviteCodeOf(page, groupA.groupId, 'Omar')).toBe(code);
    const { groups } = await api<{ groups: { name: string }[] }>(pat.page, 'get', '/groups');
    expect(groups.map((g) => g.name)).toEqual(['Group A']);
    // Logging in from the link as someone who can't use it still logs in, and says why.
    const ctx = await browser.newContext();
    opened.push(ctx);
    const owner2 = await ctx.newPage();
    const ownerName = (await api<{ account: { username: string } }>(page, 'get', '/me')).account.username;
    await owner2.goto(`/invite/${code}`);
    await owner2.getByRole('radio', { name: 'I have an account' }).check();
    await owner2.getByLabel('Username').fill(ownerName);
    await owner2.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await owner2.getByRole('button', { name: 'Log in and join' }).click();
    await expect(owner2.getByRole('status').filter({ hasText: 'This invite is for Omar' })).toBeVisible();
    await expect(owner2.getByText(`You're logged in as`)).toHaveCount(0);
  } finally {
    await closeAll(opened);
  }
});

test('US-12 #9 logging in from the link while already in one of the groups asks "Join as Omar?" before joining anything', async ({ page, browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    await signUpFast(page, info, 'own');
    const groupA = await makeGroup(page, 'Group A', '$', ['Omar', 'Pat']);
    const groupB = await makeGroup(page, 'Group B', '$', []);
    await addFromOtherGroups(page, groupB.groupId, 'Omar');
    const pat = await newPerson(browser, opened, info, 'pat');
    await api(pat.page, 'post', `/invites/${await inviteCodeOf(page, groupA.groupId, 'Pat')}/accept`);
    const code = await inviteCodeOf(page, groupA.groupId, 'Omar');

    // On another device, logged out, Pat opens Omar's link and logs in.
    const context = await browser.newContext();
    opened.push(context);
    const device = await context.newPage();
    await device.goto(`/invite/${code}`);
    await device.getByRole('radio', { name: 'I have an account' }).check();
    await device.getByLabel('Username').fill(pat.username);
    await device.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await device.getByRole('button', { name: 'Log in and join' }).click();

    // Logged in, but nothing joined yet: the warning and the confirmation come first,
    // and the cursor is on the page's heading, just above the warning.
    await expect(device.getByText("You're already in Group A. If you're not Omar, don't join: send them this link instead.")).toBeVisible();
    await expect(device.getByRole('heading', { level: 1, name: "Omar, join your friends' groups" })).toBeFocused();
    expect(await inviteCodeOf(page, groupA.groupId, 'Omar')).toBe(code);
    await device.getByRole('button', { name: 'Join these groups' }).click();
    await device.getByRole('dialog', { name: 'Join as Omar?' }).getByRole('button', { name: 'Join as Omar' }).click();
    await expect(device.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(device.getByRole('status').getByText('You joined 1 group. You were already in Group A, so it was skipped.')).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

test('US-41 after adding someone from my other groups, the cursor moves to their "Invite" box, ready to copy the link', async ({ page, browserName }, info) => {
  await signUpFast(page, info);
  await makeGroup(page, 'Flat', '$', ['Omar']);
  const club = await makeGroup(page, 'Club', '$', []);
  await openMembers(page, club.groupId, 'Club');
  await page.getByLabel('Or add someone from your other groups').selectOption({ label: 'Omar (Flat)' });
  await page.getByRole('button', { name: 'Add to group' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Invite Omar' })).toBeFocused();
  // Safari moves between buttons with Alt+Tab.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('region', { name: 'Invite Omar' }).getByRole('button', { name: 'Copy link for Omar' })).toBeFocused();
});

test('US-01 #5 and US-09 #3 the Username and Group name hints say the rule in plain words', async ({ page }, info) => {
  await page.goto('/signup');
  await expect(page.getByLabel('Username')).toHaveAccessibleDescription('3 to 30 English letters, numbers or underscores, like omar_99');
  await expect(page.getByText(/–|letters, numbers and _/)).toHaveCount(0);
  await signUpFast(page, info);
  await page.goto('/groups/new');
  await expect(page.getByLabel('Group name')).toHaveAccessibleDescription('Up to 50 characters');
});
