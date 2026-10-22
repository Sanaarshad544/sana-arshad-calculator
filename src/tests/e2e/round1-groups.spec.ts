import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { PASSWORD, api, expectNoA11yViolations, expectNoHorizontalScroll, makeGroup, signUpFast, uniqueName } from './helpers.js';

// First manual test round: personal invite links, renaming people, editing a group,
// and the group page layout. Every person is a separate browser context (own cookies).

// ---------- helpers ----------

/** A personal invite code is 12 characters and never contains 0, O, 1 or I. */
const INVITE_CODE = /^[A-HJ-NP-Z2-9]{12}$/;
const WRONG_LOGIN = 'Username or password is incorrect';
const NAME_USED = 'That name has already been used in this group';
const USERNAME_RULE = 'Enter a username of 3 to 30 English letters, numbers or underscores, like omar_99';
const PASSWORD_SHORT = 'Password must be at least 8 characters';

interface MemberInfo {
  id: string;
  name: string;
  status: 'current' | 'removed';
  hasAccount: boolean;
  isMe: boolean;
  inviteCode: string | null;
}

async function memberOf(page: Page, groupId: string, name: string): Promise<MemberInfo> {
  const { group } = await api<{ group: { members: MemberInfo[] } }>(page, 'get', `/groups/${groupId}`);
  const member = group.members.find((m) => m.name === name);
  if (!member) throw new Error(`"${name}" is not a member of group ${groupId}`);
  return member;
}

/** A person's own invite code, as the group's details give it to a member. */
async function inviteCodeOf(page: Page, groupId: string, name: string): Promise<string> {
  const { inviteCode } = await memberOf(page, groupId, name);
  if (!inviteCode) throw new Error(`"${name}" has no invite code`);
  return inviteCode;
}

/** Adds someone from "my other groups" (the same person, so the same invite code). */
async function addFromOtherGroups(page: Page, groupId: string, name: string): Promise<void> {
  const { people } = await api<{ people: { key: string; name: string }[] }>(page, 'get', `/people?groupId=${groupId}`);
  const person = people.find((p) => p.name === name);
  if (!person) throw new Error(`"${name}" is not among the people in my other groups`);
  await api(page, 'post', `/groups/${groupId}/members`, { personKey: person.key });
}

/** A bill paid by `payerId` and split equally between `participantIds`. */
async function postEqualBill(page: Page, groupId: string, participantIds: string[], payerId: string, price: string, name: string): Promise<void> {
  await api(page, 'post', `/groups/${groupId}/bills`, {
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
  });
}

async function openGroup(page: Page, groupId: string, name: string, tab?: string): Promise<void> {
  await page.goto(`/groups/${groupId}${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}

/** Opens /invite/<code> (logged in or out) and waits for the page's heading. */
async function openInvite(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/invite/${code}`);
  await expect(page.getByRole('heading', { level: 1, name: `${name}, join your friends' groups` })).toBeVisible();
}

/** One person's row on the Members tab (not the "was added" box). Every row has a "Rename" button. */
const memberRow = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Rename ${name}`, exact: true }) });
/** The "Invite <name>" box shown right after adding someone. */
const addedBox = (page: Page, name: string) => page.getByRole('region', { name: `Invite ${name}` });
// A row's text starts with the person's initial (their avatar), then their name.
const balanceRow = (page: Page, name: string) => page.getByTestId('balance-row').filter({ hasText: new RegExp(`^\\S${name}(?![A-Za-z0-9_])`) });
const fieldError = (page: Page, text: string) => page.locator('p.field-error', { hasText: text });
const renameBox = (page: Page, name: string) => page.getByLabel(`New name for ${name}`);

async function boxOf(target: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await target.boundingBox();
  if (!box) throw new Error('element has no box on the page');
  return box;
}

/** Opens a new browser (its own cookies) and remembers it, so the test can close them all. */
async function newBrowserPage(browser: Browser, opened: BrowserContext[], colorScheme?: 'light' | 'dark'): Promise<Page> {
  const context = await browser.newContext(colorScheme ? { colorScheme } : {});
  opened.push(context);
  return context.newPage();
}

async function closeAll(opened: BrowserContext[]): Promise<void> {
  for (const context of opened) await context.close();
}

// ---------- 1. the invite journey, step by step ----------

test('invite journey: a new person added to two groups has one code, and one sign-up joins both', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    const ownerName = await signUpFast(owner, info, 'own');
    const beach = await makeGroup(owner, 'Beach trip', '$', []);
    const flat = await makeGroup(owner, 'Flat share', '$', []);

    // Add Ghania by name to the first group: a box offers her own invite link straight away.
    await openGroup(owner, beach.groupId, 'Beach trip', 'members');
    await owner.getByLabel('Add a friend by name').fill('Ghania');
    await owner.getByRole('button', { name: 'Add member' }).click();
    const box = addedBox(owner, 'Ghania');
    await expect(box).toContainText('Send them their own invite link');
    await expect(box).toContainText("It links every group they're in at once.");
    const code = ((await box.getByTestId('invite-code-Ghania').textContent()) ?? '').trim();
    expect(code).toMatch(INVITE_CODE);
    await expect(box.getByRole('button', { name: 'Copy link for Ghania' })).toBeVisible();

    // Add the same person to the second group from "Or add someone from your other groups": the same code.
    await openGroup(owner, flat.groupId, 'Flat share', 'members');
    const picker = owner.getByLabel('Or add someone from your other groups');
    await expect(picker).toBeVisible();
    await picker.selectOption({ label: 'Ghania (Beach trip)' });
    await owner.getByRole('button', { name: 'Add to group' }).click();
    await expect(owner.getByRole('status').getByText('Member added')).toBeVisible();
    await expect(memberRow(owner, 'Ghania').getByTestId('invite-code-Ghania')).toHaveText(code);
    expect(await inviteCodeOf(owner, flat.groupId, 'Ghania')).toBe(code);
    expect(await inviteCodeOf(owner, beach.groupId, 'Ghania')).toBe(code);

    // Ghania opens the link where nobody is logged in: it names her and both groups.
    const ghania = await newBrowserPage(browser, opened);
    await openInvite(ghania, code, 'Ghania');
    await expect(ghania.getByText("You're in:")).toBeVisible();
    await expect(ghania.getByRole('listitem')).toHaveText(['Beach trip', 'Flat share']);
    await expect(ghania.getByRole('radio', { name: "I'm new here" })).toBeChecked();
    await expect(ghania.getByRole('radio', { name: 'I have an account' })).not.toBeChecked();
    await ghania.getByLabel('Username').fill(uniqueName('gha', info));
    await ghania.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await ghania.getByRole('button', { name: 'Create account and join' }).click();
    await expect(ghania.getByRole('heading', { level: 1, name: 'Save your recovery code' })).toBeVisible();
    await expect(ghania.getByTestId('recovery-code')).toBeVisible();
    await ghania.getByRole('button', { name: "I've saved it, continue" }).click();
    await expect(ghania.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(ghania.getByRole('status').getByText('You joined 2 groups')).toBeVisible();

    // Afterwards her Groups list shows both groups.
    await ghania.goto('/groups');
    await expect(ghania.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
    await expect(ghania.getByRole('link', { name: /Beach trip/ })).toBeVisible();
    await expect(ghania.getByRole('link', { name: /Flat share/ })).toBeVisible();

    // The owner sees that she has joined, and both groups logged it.
    await openGroup(owner, beach.groupId, 'Beach trip', 'members');
    await expect(memberRow(owner, 'Ghania')).toContainText('has an account');
    await expect(memberRow(owner, 'Ghania')).not.toContainText('Invite code');
    await owner.getByRole('tab', { name: 'Activity' }).click();
    await expect(owner.getByTestId('activity').first()).toHaveText(/^Ghania joined with their invite/);
    for (const g of [beach, flat]) {
      const { activity } = await api<{ activity: { message: string }[] }>(owner, 'get', `/groups/${g.groupId}/activity`);
      expect(activity.map((a) => a.message)).toEqual(['Ghania joined with their invite', `${ownerName} added Ghania`, `${ownerName} created the group`]);
    }
  } finally {
    await closeAll(opened);
  }
});

// ---------- 2. an existing account ----------

test('invite journey: an existing account chooses "I have an account"; a wrong password does not use up the invite', async ({ browser }, info) => {
  test.setTimeout(90_000);
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const beach = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const flat = await makeGroup(owner, 'Flat share', '$', []);
    await addFromOtherGroups(owner, flat.groupId, 'Ghania');
    const code = await inviteCodeOf(owner, beach.groupId, 'Ghania');

    // Ghania already has an account, with a group of her own.
    const home = await newBrowserPage(browser, opened);
    const existing = await signUpFast(home, info, 'gha');
    await makeGroup(home, 'My own group', '$', []);

    // On the link (logged out) she picks "I have an account".
    const ghania = await newBrowserPage(browser, opened);
    await openInvite(ghania, code, 'Ghania');
    await ghania.getByRole('radio', { name: 'I have an account' }).check();
    await expect(ghania.getByRole('button', { name: 'Log in and join' })).toBeVisible();
    await expect(ghania.getByRole('button', { name: 'Create account and join' })).toHaveCount(0);
    await ghania.getByLabel('Username').fill(existing);
    await ghania.getByLabel('Password', { exact: true }).fill('not the right one');
    await ghania.getByRole('button', { name: 'Log in and join' }).click();
    await expect(ghania.getByRole('alert')).toHaveText(WRONG_LOGIN);
    // Nothing was used up: the invite is still Ghania's.
    expect(await inviteCodeOf(owner, beach.groupId, 'Ghania')).toBe(code);
    await expect(ghania.getByRole('heading', { level: 1, name: "Ghania, join your friends' groups" })).toBeVisible();

    await ghania.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await ghania.getByRole('button', { name: 'Log in and join' }).click();
    await expect(ghania.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(ghania.getByRole('status').getByText('You joined 2 groups')).toBeVisible();

    // Her own group and the two new ones are all in her list.
    await ghania.goto('/groups');
    await expect(ghania.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
    for (const name of ['Beach trip', 'Flat share', 'My own group']) {
      await expect(ghania.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    }
    // In the owner's group she is still "Ghania", now with an account.
    await openGroup(owner, beach.groupId, 'Beach trip', 'members');
    await expect(memberRow(owner, 'Ghania')).toContainText('has an account');
  } finally {
    await closeAll(opened);
  }
});

// ---------- 3. the owner opens their friend's link ----------

test("invite page: the owner opening a friend's link sees \"This invite is for Ghania\" and no Join button", async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    const ownerName = await signUpFast(owner, info, 'own');
    const beach = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const flat = await makeGroup(owner, 'Flat share', '$', []);
    await addFromOtherGroups(owner, flat.groupId, 'Ghania');
    const code = await inviteCodeOf(owner, beach.groupId, 'Ghania');

    await openInvite(owner, code, 'Ghania');
    await expect(owner.getByRole('listitem')).toHaveText(['Beach trip', 'Flat share']);
    const note = owner.getByRole('status').filter({ hasText: 'This invite is for Ghania' });
    await expect(note).toHaveText(
      `You're already in these groups as ${ownerName}. This invite is for Ghania: send them the link so they can join.`,
    );
    await expect(owner.getByRole('button', { name: /join/i })).toHaveCount(0);
    await expect(owner.getByRole('textbox')).toHaveCount(0);

    // Nothing changed: the server refuses it as well, and the link still works for Ghania.
    await expect(api(owner, 'post', `/invites/${code}/accept`)).rejects.toThrow('409');
    expect(await inviteCodeOf(owner, beach.groupId, 'Ghania')).toBe(code);
    expect(await inviteCodeOf(owner, flat.groupId, 'Ghania')).toBe(code);
    const { activity } = await api<{ activity: { message: string }[] }>(owner, 'get', `/groups/${beach.groupId}/activity`);
    expect(activity.filter((a) => /joined/.test(a.message))).toEqual([]);
  } finally {
    await closeAll(opened);
  }
});

test('invite page: a signed-in person never sees the sign-up form, not even while the session is still loading', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const code = await inviteCodeOf(owner, groupId, 'Ghania');
    const friend = await newBrowserPage(browser, opened);
    await signUpFast(friend, info, 'fr');

    // The server answers "who am I?" slowly, so the invite arrives first.
    await friend.route('**/api/me', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await friend.goto(`/invite/${code}`);
    await expect(friend.getByRole('heading', { level: 1, name: "Ghania, join your friends' groups" })).toBeVisible();
    // Looked at once, not retried: the logged-out form must not be on screen, not even for a moment.
    expect(await friend.getByRole('button', { name: 'Create account and join' }).count()).toBe(0);
    expect(await friend.getByLabel('Username').count()).toBe(0);
    await expect(friend.getByRole('button', { name: 'Join these groups' })).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

// ---------- 4. used and wrong codes ----------

test('invite page: a used invite says "This invite has already been used" and offers no way to join', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const code = await inviteCodeOf(owner, groupId, 'Ghania');

    // Ghania signs up with the link, so the code is used.
    const ghania = await newBrowserPage(browser, opened);
    const signUp = await ghania.request.post('/api/auth/signup', { data: { username: uniqueName('gha', info), password: PASSWORD, inviteCode: code } });
    expect(signUp.status()).toBe(201);

    // Anyone who opens it now, logged out or logged in, is told so.
    const visitor = await newBrowserPage(browser, opened);
    for (const page of [visitor, owner]) {
      await page.goto(`/invite/${code}`);
      // A used invite no longer shows whose it was.
      await expect(page.getByRole('heading', { level: 1, name: 'Invite already used' })).toBeVisible();
      await expect(page.getByText('Ghania')).toHaveCount(0);
      await expect(page.getByRole('alert')).toHaveText('This invite has already been used');
      await expect(page.getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('textbox')).toHaveCount(0);
    }
  } finally {
    await closeAll(opened);
  }
});

test('invite page: a wrong link shows "Invite not found" and "That invite link isn\'t valid. Check the code and try again."', async ({ page }) => {
  for (const code of ['WRONGCODE', 'abc', '12345678']) {
    await page.goto(`/invite/${code}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Invite not found' }), code).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText("That invite link isn't valid. Check the code and try again.");
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to Bill Splitter' })).toBeVisible();
  }
});

test('invite page: the password box has an eye button and the hint "At least 8 characters"; too short and too long passwords show their messages', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const visitor = await newBrowserPage(browser, opened);
    await openInvite(visitor, await inviteCodeOf(owner, groupId, 'Ghania'), 'Ghania');

    const password = visitor.getByLabel('Password', { exact: true });
    await expect(visitor.getByText('At least 8 characters', { exact: true })).toBeVisible();
    await expect(password).toHaveAttribute('type', 'password');
    await visitor.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    // The label says what the button does next; there's no separate pressed state.
    await expect(visitor.getByRole('button', { name: 'Hide password' })).not.toHaveAttribute('aria-pressed');
    await expect(password).toHaveAttribute('autocapitalize', 'none');
    await expect(password).toHaveAttribute('spellcheck', 'false');
    await visitor.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');

    await visitor.getByLabel('Username').fill(uniqueName('gha', info));
    await password.fill('1234567');
    await visitor.getByRole('button', { name: 'Create account and join' }).click();
    await expect(fieldError(visitor, 'Password must be at least 8 characters')).toBeVisible();
    await password.fill('x'.repeat(129));
    await visitor.getByRole('button', { name: 'Create account and join' }).click();
    await expect(fieldError(visitor, 'Password can be at most 128 characters')).toBeVisible();
    // Nothing was created or used up.
    expect(await inviteCodeOf(owner, groupId, 'Ghania')).toMatch(INVITE_CODE);

    // "I have an account" has the eye button too, but no sign-up hint.
    await visitor.getByRole('radio', { name: 'I have an account' }).check();
    await expect(visitor.getByRole('button', { name: 'Show password' })).toBeVisible();
    await expect(visitor.getByText('At least 8 characters', { exact: true })).toHaveCount(0);
  } finally {
    await closeAll(opened);
  }
});

test('invite page and group pages: tab titles end with "Bill Splitter" and the invite page shows the app name', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Title trip', '$', ['Ghania']);
    const visitor = await newBrowserPage(browser, opened);

    await openInvite(visitor, await inviteCodeOf(owner, groupId, 'Ghania'), 'Ghania');
    await expect(visitor).toHaveTitle('Invite for Ghania · Bill Splitter');
    await expect(visitor.getByText('Bill Splitter', { exact: true })).toBeVisible();
    await visitor.goto('/invite/WRONGCODE');
    await expect(visitor.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
    await expect(visitor).toHaveTitle('Invite · Bill Splitter');
    await owner.goto('/join');
    await expect(owner.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
    await expect(owner).toHaveTitle('Use an invite code · Bill Splitter');
    await owner.goto(`/groups/${groupId}/edit`);
    await expect(owner.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
    await expect(owner).toHaveTitle('Edit group · Bill Splitter');
    await openGroup(owner, groupId, 'Title trip');
    await expect(owner).toHaveTitle('Title trip · Bill Splitter');
  } finally {
    await closeAll(opened);
  }
});

// ---------- 5. "Use an invite code" ----------

test('use an invite code: a code typed in lower case with spaces or dashes opens that invite', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const code = await inviteCodeOf(owner, groupId, 'Ghania');
    const friend = await newBrowserPage(browser, opened);
    await signUpFast(friend, info, 'fr');

    await friend.goto('/groups');
    await expect(friend.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
    await friend.getByRole('link', { name: 'Use an invite code' }).click();
    for (const typed of [`  ${code.slice(0, 4).toLowerCase()} ${code.slice(4).toLowerCase()}  `, `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`]) {
      await expect(friend.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
      await friend.getByLabel('Invite code').fill(typed);
      await friend.getByRole('button', { name: 'Continue' }).click();
      await expect(friend, `typed "${typed}"`).toHaveURL(new RegExp(`/invite/${code}$`));
      await expect(friend.getByRole('heading', { level: 1, name: "Ghania, join your friends' groups" })).toBeVisible();
      await expect(friend.getByRole('button', { name: 'Join these groups' })).toBeVisible();
      await friend.goBack();
    }
  } finally {
    await closeAll(opened);
  }
});

test('use an invite code: pressing Continue with nothing typed asks for the code and goes nowhere', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/join');
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(fieldError(page, 'Enter the invite code you were sent')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await expect(page).toHaveURL(/\/join$/);

  // Spaces and dashes alone are no code either.
  await page.goto('/join');
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await page.getByLabel('Invite code').fill(' - ');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(fieldError(page, 'Enter the invite code you were sent')).toBeVisible();
  await expect(page).toHaveURL(/\/join$/);
});

// ---------- 6. renaming ----------

test('rename: a new name shows in the balances, the suggestions and the activity log, and the old name becomes free', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Rename club', '$', ['Ali']);
  await postEqualBill(page, groupId, [meId, ids.Ali], meId, '40.00', 'Dinner');
  await openGroup(page, groupId, 'Rename club');
  await expect(balanceRow(page, 'Ali')).toContainText('−$20.00 owes');

  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Rename Ali', exact: true }).click();
  const box = renameBox(page, 'Ali');
  // The box opens with the current name, ready to change.
  await expect(box).toHaveValue('Ali');
  await expect(box).toBeFocused();
  await expect(page.getByRole('button', { name: 'Save name' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await box.fill('Alicia');
  await box.press('Enter');
  await expect(page.getByRole('status').getByText('Name changed')).toBeVisible();
  await expect(renameBox(page, 'Ali')).toHaveCount(0);
  await expect(memberRow(page, 'Alicia')).toContainText('Alicia');
  await expect(page.getByRole('button', { name: 'Rename Ali', exact: true })).toHaveCount(0);

  // The new name is everywhere: balances, suggested payments and new bills.
  await expect(balanceRow(page, 'Alicia')).toContainText('−$20.00 owes');
  await expect(balanceRow(page, 'Ali')).toHaveCount(0);
  await expect(page.getByTestId('suggestion')).toContainText(`Alicia pays ${username} $20.00`);
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity').first()).toContainText(`${username} renamed Ali to Alicia`);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: /^Add bill to / })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Who took part' }).getByRole('checkbox', { name: 'Alicia', exact: true })).toBeChecked();
  await expect(page.getByRole('group', { name: 'Who took part' }).getByRole('checkbox', { name: 'Ali', exact: true })).toHaveCount(0);

  // "Ali" is free again, for a new person.
  await openGroup(page, groupId, 'Rename club', 'members');
  await page.getByLabel('Add a friend by name').fill('Ali');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('status').getByText('Member added')).toBeVisible();
  await expect(memberRow(page, 'Ali')).toBeVisible();
  await expect(memberRow(page, 'Alicia')).toBeVisible();
});

test('rename: a name already used in the group, in any letter case or by a removed member, shows "That name has already been used in this group"', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Clash club', '$', ['Ali', 'Sara', 'Omar']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await openGroup(page, groupId, 'Clash club', 'members');

  await page.getByRole('button', { name: 'Rename Sara', exact: true }).click();
  const box = renameBox(page, 'Sara');
  for (const taken of ['ali', 'OMAR']) {
    await box.fill(taken);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(fieldError(page, NAME_USED), `renaming Sara to "${taken}"`).toBeVisible();
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(box).toHaveAccessibleDescription(NAME_USED);
    await expect(box).toHaveValue(taken);
  }
  await expect(page.getByRole('status').getByText('Name changed')).toHaveCount(0);

  // Cancel closes the box and Sara is still Sara.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(renameBox(page, 'Sara')).toHaveCount(0);
  await expect(memberRow(page, 'Sara')).toBeVisible();
  expect((await memberOf(page, groupId, 'Sara')).name).toBe('Sara');
  await expect(api(page, 'put', `/groups/${groupId}/members/${ids.Sara}`, { name: 'ali' })).rejects.toThrow('409');
});

test('rename: a blank or 31-character name shows "Enter a name of up to 30 characters"; exactly 30 is accepted', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Length club', '$', ['Ali']);
  await openGroup(page, groupId, 'Length club', 'members');
  await page.getByRole('button', { name: 'Rename Ali', exact: true }).click();
  const box = renameBox(page, 'Ali');
  for (const bad of ['', '   ', 'x'.repeat(31)]) {
    await box.fill(bad);
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(fieldError(page, 'Enter a name of up to 30 characters'), `"${bad}"`).toBeVisible();
  }
  expect((await memberOf(page, groupId, 'Ali')).name).toBe('Ali');

  const thirty = 'y'.repeat(30);
  await box.fill(thirty);
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').getByText('Name changed')).toBeVisible();
  expect((await memberOf(page, groupId, thirty)).name).toBe(thirty);
});

test('rename: a removed member can be renamed too and stays removed until restored', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, ids } = await makeGroup(page, 'Removed club', '$', ['Ali', 'Omar']);
  await api(page, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);
  await openGroup(page, groupId, 'Removed club', 'members');
  await expect(page.getByText('Omar (removed)')).toBeVisible();

  await page.getByRole('button', { name: 'Rename Omar', exact: true }).click();
  await renameBox(page, 'Omar').fill('Omar B');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status').getByText('Name changed')).toBeVisible();
  await expect(page.getByText('Omar B (removed)')).toBeVisible();
  await expect(page.getByText('Omar (removed)')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Members (2)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity').first()).toContainText(`${username} renamed Omar to Omar B`);

  await page.getByRole('tab', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Restore Omar B' }).click();
  await expect(page.getByRole('status').getByText('Member restored')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Members (3)' })).toBeVisible();
  await expect(memberRow(page, 'Omar B')).toBeVisible();
});

// ---------- 7. Edit group ----------

test('edit group: renaming the group and changing $ to PKR relabels the amounts without converting them, and logs both', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId, meId, ids } = await makeGroup(page, 'Old name', '$', ['Ali']);
  await postEqualBill(page, groupId, [meId, ids.Ali], meId, '50.00', 'Lunch');
  await openGroup(page, groupId, 'Old name');
  await expect(balanceRow(page, 'Ali')).toContainText('−$25.00 owes');

  await page.getByRole('link', { name: 'Edit group' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/edit$`));
  await expect(page.getByLabel('Group name')).toHaveValue('Old name');
  const currency = page.getByLabel('Currency', { exact: true });
  await expect(currency).toHaveValue('$');
  await expect(page.getByText("Changing the currency only changes the symbol shown on every bill. Amounts aren't converted.")).toBeVisible();
  await page.getByLabel('Group name').fill('New name');
  await currency.selectOption('PKR');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('status').getByText('Group saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'New name', exact: true })).toBeVisible();
  await expect(page.getByText('Currency: PKR')).toBeVisible();
  await expect(balanceRow(page, 'Ali')).toContainText('−PKR 25.00 owes');
  await expect(page.getByTestId('suggestion')).toContainText(`Ali pays ${username} PKR 25.00`);
  await page.goto('/groups');
  await expect(page.getByRole('link', { name: /New name/ })).toContainText('PKR');
  await expect(page.getByRole('link', { name: /Old name/ })).toHaveCount(0);

  await openGroup(page, groupId, 'New name', 'activity');
  const entries = page.getByTestId('activity');
  await expect(entries.filter({ hasText: `${username} renamed the group from 'Old name' to 'New name'` })).toHaveCount(1);
  await expect(entries.filter({ hasText: `${username} changed the currency from $ to PKR` })).toHaveCount(1);
});

test('edit group: changing only the currency (to an "Other" symbol) logs only the currency; changing only the name logs only the name', async ({ page }, info) => {
  const username = await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Steady name', '$', ['Ali']);
  await page.goto(`/groups/${groupId}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
  await page.getByLabel('Currency', { exact: true }).selectOption({ label: 'Other' });
  await page.getByLabel('Currency symbol').fill('kr');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').getByText('Group saved')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Steady name', exact: true })).toBeVisible();
  await expect(page.getByText('Currency: kr')).toBeVisible();

  // It opens again with the custom symbol filled in; now only the name changes.
  await page.getByRole('link', { name: 'Edit group' }).click();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('other');
  await expect(page.getByLabel('Currency symbol')).toHaveValue('kr');
  await page.getByLabel('Group name').fill('Renamed only');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Renamed only', exact: true })).toBeVisible();
  await expect(page.getByText('Currency: kr')).toBeVisible();

  const { activity } = await api<{ activity: { message: string }[] }>(page, 'get', `/groups/${groupId}/activity`);
  expect(activity.map((a) => a.message)).toEqual([
    `${username} renamed the group from 'Steady name' to 'Renamed only'`,
    `${username} changed the currency from $ to kr`,
    `${username} added Ali`,
    `${username} created the group`,
  ]);
});

test('edit group: a blank name or a currency with digits shows its message, and each message goes away as soon as that field is edited', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Checks', '$', []);
  await page.goto(`/groups/${groupId}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
  await page.getByLabel('Group name').fill('');
  await page.getByLabel('Currency', { exact: true }).selectOption({ label: 'Other' });
  await page.getByLabel('Currency symbol').fill('12');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(fieldError(page, 'Enter a group name of up to 50 characters')).toBeVisible();
  await expect(fieldError(page, 'Enter a currency symbol of up to 3 characters, with no digits')).toBeVisible();

  // Editing one field clears only that field's message.
  await page.getByLabel('Group name').fill('Checks again');
  await expect(fieldError(page, 'Enter a group name of up to 50 characters')).toHaveCount(0);
  await expect(fieldError(page, 'Enter a currency symbol of up to 3 characters, with no digits')).toBeVisible();
  await page.getByLabel('Currency symbol').fill('zł');
  await expect(fieldError(page, 'Enter a currency symbol of up to 3 characters, with no digits')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Checks again', exact: true })).toBeVisible();
  await expect(page.getByText('Currency: zł')).toBeVisible();
});

test("edit group: any current member can edit it (logged under their own name), and someone outside the group can't", async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Shared name', '$', ['Ghania']);
    const ghania = await newBrowserPage(browser, opened);
    await signUpFast(ghania, info, 'gha');
    await api(ghania, 'post', `/invites/${await inviteCodeOf(owner, groupId, 'Ghania')}/accept`);
    const outsider = await newBrowserPage(browser, opened);
    await signUpFast(outsider, info, 'out');

    await ghania.goto(`/groups/${groupId}`);
    await expect(ghania.getByRole('heading', { level: 1, name: 'Shared name', exact: true })).toBeVisible();
    await ghania.getByRole('link', { name: 'Edit group' }).click();
    await ghania.getByLabel('Group name').fill('Ghania renamed it');
    await ghania.getByRole('button', { name: 'Save changes' }).click();
    await expect(ghania.getByRole('heading', { level: 1, name: 'Ghania renamed it', exact: true })).toBeVisible();
    await openGroup(owner, groupId, 'Ghania renamed it', 'activity');
    await expect(owner.getByTestId('activity').first()).toContainText("Ghania renamed the group from 'Shared name' to 'Ghania renamed it'");

    await outsider.goto(`/groups/${groupId}/edit`);
    await expect(outsider.getByRole('alert')).toHaveText("You don't have access to this group");
    await expect(outsider.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await expect(api(outsider, 'put', `/groups/${groupId}`, { name: 'Hijacked', currency: '$' })).rejects.toThrow('403');
  } finally {
    await closeAll(opened);
  }
});

// US-39 #5: "Currency: Rs" has a small info button on the group page and on a group bill form.
const CURRENCY_NOTE = [
  'Rs is only a symbol shown next to amounts. Nothing is converted between currencies.',
  "Changing the group's currency in Edit group changes the symbol on every bill in this group. The numbers stay exactly the same.",
];
const currencyScreens: { where: string; path: (groupId: string, billId: string) => string; heading: string }[] = [
  { where: 'the group page', path: (groupId) => `/groups/${groupId}`, heading: 'Rupees' },
  { where: 'a new group bill', path: (groupId) => `/groups/${groupId}/bills/new`, heading: 'Add bill to Rupees' },
  { where: 'the edit form of a saved group bill', path: (groupId, billId) => `/groups/${groupId}/bills/${billId}/edit`, heading: 'Edit Lunch' },
];

for (const { where, path, heading } of currencyScreens) {
  test(`US-39 #5 on ${where}, "Currency: Rs" has an info button that explains the symbol and what changing it in Edit group does`, async ({ page }, info) => {
    await signUpFast(page, info);
    const { groupId, meId, ids } = await makeGroup(page, 'Rupees', 'Rs', ['Ali']);
    await postEqualBill(page, groupId, [meId, ids.Ali], meId, '50.00', 'Lunch');
    const { bills } = await api<{ bills: { id: string }[] }>(page, 'get', `/groups/${groupId}/bills`);
    await page.goto(path(groupId, bills[0].id));
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();

    await expect(page.getByText('Currency: Rs')).toBeVisible();
    const infoButton = page.getByRole('button', { name: 'About the currency' });
    await expect(infoButton).toBeVisible();
    await expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    for (const line of CURRENCY_NOTE) await expect(page.getByText(line)).toBeHidden();

    // Pressing it shows both explanations ...
    await infoButton.click();
    await expect(infoButton).toHaveAttribute('aria-expanded', 'true');
    for (const line of CURRENCY_NOTE) await expect(page.getByText(line)).toBeVisible();

    // ... and pressing it again puts them away.
    await infoButton.click();
    await expect(infoButton).toHaveAttribute('aria-expanded', 'false');
    for (const line of CURRENCY_NOTE) await expect(page.getByText(line)).toBeHidden();
  });
}

// ---------- 8. group page layout ----------

test('group page layout: at 1280px the Balances and Suggested payments cards start at the same height', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.setViewportSize({ width: 1280, height: 900 });
  const quiet = await makeGroup(page, 'Quiet', '$', ['Ali']);
  const busy = await makeGroup(page, 'Busy', '$', ['Ali', 'Sara', 'Omar', 'Zed']);
  await postEqualBill(page, busy.groupId, Object.values(busy.ids), busy.meId, '100.00', 'Big dinner');

  for (const [groupId, name] of [[quiet.groupId, 'Quiet'], [busy.groupId, 'Busy']]) {
    await openGroup(page, groupId, name);
    const balances = page.getByRole('region', { name: 'Balances' });
    const suggested = page.getByRole('region', { name: 'Suggested payments' });
    await expect(balances).toBeVisible();
    await expect(suggested).toBeVisible();
    await expect
      .poll(async () => Math.abs((await boxOf(balances)).y - (await boxOf(suggested)).y), { message: `top edges in "${name}"` })
      .toBeLessThanOrEqual(1);
    // They sit side by side, so the comparison means something.
    const [bal, sug] = [await boxOf(balances), await boxOf(suggested)];
    expect(sug.x).toBeGreaterThanOrEqual(bal.x + bal.width);
  }
});

test('group page layout: at 1280px the Balances and Suggested payments cards are the same height', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.setViewportSize({ width: 1280, height: 900 });
  const busy = await makeGroup(page, 'Busy', '$', ['Ali', 'Sara', 'Omar', 'Zed']);
  await postEqualBill(page, busy.groupId, Object.values(busy.ids), busy.meId, '100.00', 'Big dinner');
  const quiet = await makeGroup(page, 'Quiet', '$', ['Ali']);

  for (const [groupId, name] of [[quiet.groupId, 'Quiet'], [busy.groupId, 'Busy']]) {
    await openGroup(page, groupId, name);
    const balances = page.getByRole('region', { name: 'Balances' });
    const suggested = page.getByRole('region', { name: 'Suggested payments' });
    await expect(suggested).toBeVisible();
    await expect
      .poll(async () => Math.abs((await boxOf(balances)).height - (await boxOf(suggested)).height), { message: `heights in "${name}"` })
      .toBeLessThanOrEqual(1);
  }
});

// ---------- extras around the joining design ----------

test('adding someone who already has an account gives them the group straight away, with no invite to send', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const friend = await newBrowserPage(browser, opened);
    const friendName = await signUpFast(friend, info, 'fat');
    const first = await makeGroup(owner, 'First group', '$', ['Fatima']);
    await api(friend, 'post', `/invites/${await inviteCodeOf(owner, first.groupId, 'Fatima')}/accept`);
    const second = await makeGroup(owner, 'Second group', '$', []);

    // Her account shows up under her name in the group, never her username, in "my people".
    await openGroup(owner, second.groupId, 'Second group', 'members');
    await expect(owner.getByRole('option', { name: new RegExp(friendName) })).toHaveCount(0);
    await owner.getByLabel('Or add someone from your other groups').selectOption({ label: 'Fatima (First group)' });
    await owner.getByRole('button', { name: 'Add to group' }).click();
    await expect(owner.getByRole('status').getByText('Member added')).toBeVisible();
    await expect(memberRow(owner, 'Fatima')).toContainText('has an account');
    await expect(memberRow(owner, 'Fatima')).not.toContainText('Invite code');
    await expect(addedBox(owner, 'Fatima')).toHaveCount(0);

    await friend.goto('/groups');
    await expect(friend.getByRole('heading', { level: 1, name: 'Groups', exact: true })).toBeVisible();
    await expect(friend.getByRole('link', { name: /First group/ })).toBeVisible();
    await expect(friend.getByRole('link', { name: /Second group/ })).toBeVisible();
  } finally {
    await closeAll(opened);
  }
});

test('"Or add someone from your other groups" lists each person once with all their groups, never people already in this group', async ({ page }, info) => {
  await signUpFast(page, info);
  const a = await makeGroup(page, 'Group A', '$', ['Ghania', 'Sara']);
  const b = await makeGroup(page, 'Group B', '$', []);
  await addFromOtherGroups(page, b.groupId, 'Ghania');
  const c = await makeGroup(page, 'Group C', '$', []);
  const picker = page.getByLabel('Or add someone from your other groups');
  const options = () => picker.locator('option').allTextContents();

  await openGroup(page, c.groupId, 'Group C', 'members');
  await expect(picker).toBeVisible();
  expect(await options()).toEqual(['Choose a person', 'Ghania (Group A, Group B)', 'Sara (Group A)']);

  await openGroup(page, b.groupId, 'Group B', 'members');
  await expect(picker).toBeVisible();
  expect(await options()).toEqual(['Choose a person', 'Sara (Group A)']);

  // Group A has everyone already, so there is nobody to pick (the list has loaded when its answer is in).
  const peopleAnswered = page.waitForResponse((r) => r.url().includes(`/api/people?groupId=${a.groupId}`));
  await openGroup(page, a.groupId, 'Group A', 'members');
  expect((await peopleAnswered).ok()).toBe(true);
  await expect(page.getByLabel('Add a friend by name')).toBeVisible();
  await expect(picker).toHaveCount(0);

  // Pressing "Add to group" with nobody chosen asks to choose someone.
  await openGroup(page, c.groupId, 'Group C', 'members');
  await page.getByRole('button', { name: 'Add to group' }).click();
  await expect(fieldError(page, 'Choose someone to add')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Members (1)' })).toBeVisible();
});

test('on a phone the invite page and the Members tab with invite controls and the rename box do not scroll sideways', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    await owner.setViewportSize({ width: 375, height: 800 });
    const { groupId } = await makeGroup(owner, 'Phone trip', '$', ['Bartholomew Maximilian Fitz', 'Sara']);
    await openGroup(owner, groupId, 'Phone trip', 'members');
    await expect(owner.getByTestId('invite-code-Bartholomew Maximilian Fitz')).toBeVisible();
    await owner.getByRole('button', { name: 'Rename Bartholomew Maximilian Fitz', exact: true }).click();
    await expect(renameBox(owner, 'Bartholomew Maximilian Fitz')).toBeVisible();
    await expectNoHorizontalScroll(owner);

    const visitor = await newBrowserPage(browser, opened);
    await visitor.setViewportSize({ width: 375, height: 800 });
    await openInvite(visitor, await inviteCodeOf(owner, groupId, 'Sara'), 'Sara');
    await expectNoHorizontalScroll(visitor);
    await visitor.getByRole('button', { name: 'Create account and join' }).click();
    await expect(fieldError(visitor, USERNAME_RULE)).toBeVisible();
    await expectNoHorizontalScroll(visitor);
  } finally {
    await closeAll(opened);
  }
});

test('US-34 #3 on a phone 360 px wide, a group bill with long member names (on its chips, in its results, saved and being edited) does not scroll sideways', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.setViewportSize({ width: 360, height: 780 });
  /** The page never scrolls sideways; the message says which screen did. */
  const fits = async (where: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  };
  // A name with spaces to wrap at, and the longest name allowed (30 characters) with nothing to wrap at.
  const wrapping = 'Bartholomew Maximilian Fitz';
  const unbroken = 'W'.repeat(30);
  const { groupId } = await makeGroup(page, 'Narrow chips', '$', [wrapping, unbroken, 'Sara']);
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Add bill to Narrow chips' })).toBeVisible();
  await fits('the new bill form');

  // Split by items: every item has its own chips. An item with nobody ticked shows its message.
  await page.getByRole('radio', { name: 'By items (each pays for what they had)' }).check();
  await page.getByLabel('Who paid').selectOption({ label: unbroken });
  await page.getByLabel('Bill name').fill('Long names dinner');
  await page.getByLabel('Item 1 price').fill('30');
  await page.getByRole('button', { name: '+ Add item' }).click();
  await page.getByLabel('Item 2 price').fill('12');
  const chips = (n: number) => page.getByRole('group', { name: `Who shared item ${n}`, exact: true });
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(fieldError(page, 'Choose who shared this item')).toHaveCount(2);
  await fits('the bill form with its messages');
  await chips(1).getByRole('button', { name: 'Everyone', exact: true }).click();
  await chips(2).getByRole('checkbox', { name: unbroken, exact: true }).check();
  await expect(fieldError(page, 'Choose who shared this item')).toHaveCount(0);
  await fits('the bill form with every item shared');

  // The results name the payer and everyone's share.
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('$42.00');
  await expect(page.getByTestId('share')).toHaveCount(4);
  await expect(page.getByText(`${unbroken} paid $42.00.`)).toBeVisible();
  await fits('the bill form with its results');

  // Saved: the group page, the read-only bill ("Shared by" lines, who paid), and its edit form with the saved results.
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Narrow chips', exact: true })).toBeVisible();
  await fits('the group page');
  await page.getByRole('link', { name: /Long names dinner/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Long names dinner' })).toBeVisible();
  await expect(page.getByText(`Shared by ${unbroken}`)).toBeVisible();
  await fits('the saved bill');
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Long names dinner' })).toBeVisible();
  await expect(page.getByTestId('grand-total')).toHaveText('$42.00');
  await fits('the edit form of the saved bill');
});

test('US-34 #3 on a phone 360 px wide, the longest group, bill and item names with no spaces (50, 60 and 40 characters) do not scroll the bill screens sideways', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.setViewportSize({ width: 360, height: 780 });
  /** The page never scrolls sideways; the message says which screen did. */
  const fits = async (where: string) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${where} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  };
  const groupName = 'G'.repeat(50);
  const billName = 'B'.repeat(60);
  const itemName = 'I'.repeat(40);
  const { groupId } = await makeGroup(page, groupName, '$', ['Ali']);

  // The group name is the "back" link above the title of every screen of the group.
  await page.goto(`/groups/${groupId}/bills/new`);
  await expect(page.getByRole('heading', { level: 1, name: `Add bill to ${groupName}` })).toBeVisible();
  await fits('the new bill form');
  await page.getByLabel('Bill name').fill(billName);
  await page.getByLabel('Item 1 name').fill(itemName);
  await page.getByLabel('Item 1 price').fill('30');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('grand-total')).toHaveText('$30.00');
  await fits('the new bill form with its results');

  // Saved: the group page, the bill (its name is the title) and its edit form (its name is the "back" link).
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: groupName, exact: true })).toBeVisible();
  await fits('the group page');
  await page.getByRole('link', { name: new RegExp(billName) }).click();
  await expect(page.getByRole('heading', { level: 1, name: billName, exact: true })).toBeVisible();
  await expect(page.getByText(itemName)).toBeVisible();
  await fits('the saved bill');
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Edit ${billName}` })).toBeVisible();
  await fits('the edit form of the saved bill');

  // The same group name on the group's other screens.
  await page.goto(`/groups/${groupId}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
  await fits('Edit group');
  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  await fits('the payment form');
});

// ---------- a field's red message goes away as soon as that field is edited ----------

test('field messages: on the invite page the username or password message goes away as soon as that box is edited', async ({ browser }, info) => {
  const opened: BrowserContext[] = [];
  try {
    const owner = await newBrowserPage(browser, opened);
    await signUpFast(owner, info, 'own');
    const { groupId } = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
    const visitor = await newBrowserPage(browser, opened);
    await openInvite(visitor, await inviteCodeOf(owner, groupId, 'Ghania'), 'Ghania');

    await visitor.getByRole('button', { name: 'Create account and join' }).click();
    await expect(fieldError(visitor, USERNAME_RULE)).toBeVisible();
    await expect(fieldError(visitor, PASSWORD_SHORT)).toBeVisible();
    await visitor.getByLabel('Username').fill('ghania_ok');
    await expect(fieldError(visitor, USERNAME_RULE), 'username message after editing the username').toHaveCount(0);
    await expect(fieldError(visitor, PASSWORD_SHORT), 'password message stays while only the username is edited').toBeVisible();
    await visitor.getByLabel('Password', { exact: true }).fill('long enough now');
    await expect(fieldError(visitor, PASSWORD_SHORT), 'password message after editing the password').toHaveCount(0);
  } finally {
    await closeAll(opened);
  }
});

test('field messages: on "Use an invite code" the message goes away as soon as the code box is edited', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/join');
  await expect(page.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(fieldError(page, 'Enter the invite code you were sent')).toBeVisible();
  await page.getByLabel('Invite code').fill('A');
  await expect(fieldError(page, 'Enter the invite code you were sent')).toHaveCount(0);
});

test('field messages: on the Members tab the add-a-friend message goes away as soon as that box is edited', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Messages', '$', ['Ali']);
  await openGroup(page, groupId, 'Messages', 'members');
  await page.getByLabel('Add a friend by name').fill('ali');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(fieldError(page, NAME_USED)).toBeVisible();
  await page.getByLabel('Add a friend by name').fill('alix');
  await expect(fieldError(page, NAME_USED)).toHaveCount(0);
});

test('field messages: on the Members tab the rename message goes away as soon as the rename box is edited', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Messages', '$', ['Ali', 'Sara']);
  await openGroup(page, groupId, 'Messages', 'members');
  await page.getByRole('button', { name: 'Rename Sara', exact: true }).click();
  await renameBox(page, 'Sara').fill('ali');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(fieldError(page, NAME_USED)).toBeVisible();
  await renameBox(page, 'Sara').fill('alix');
  await expect(fieldError(page, NAME_USED)).toHaveCount(0);
});

test('field messages: on Create group the group-name message goes away as soon as the name is edited, as it does on Edit group', async ({ page }, info) => {
  await signUpFast(page, info);
  await page.goto('/groups/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Create group' })).toBeVisible();
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(fieldError(page, 'Enter a group name of up to 50 characters')).toBeVisible();
  await page.getByLabel('Group name').fill('Trip');
  await expect(fieldError(page, 'Enter a group name of up to 50 characters')).toHaveCount(0);
});

test('field messages: on the payment form the amount message goes away as soon as the amount is edited', async ({ page }, info) => {
  await signUpFast(page, info);
  const { groupId } = await makeGroup(page, 'Messages', '$', ['Ali']);
  await page.goto(`/groups/${groupId}/settle-ups/new`);
  await expect(page.getByRole('heading', { level: 1, name: 'Record a payment' })).toBeVisible();
  const amountMessage = 'Amount must be between 0.01 and 1,000,000.00, with at most 2 decimal places';
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(fieldError(page, amountMessage)).toBeVisible();
  await page.getByLabel('Amount ($)').fill('5');
  await expect(fieldError(page, amountMessage)).toHaveCount(0);
});

// ---------- 9. accessibility (WCAG 2.2 AA) in light and dark ----------

for (const scheme of ['light', 'dark'] as const) {
  test(`a11y (${scheme}): the invite page, logged out`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const opened: BrowserContext[] = [];
    try {
      const owner = await newBrowserPage(browser, opened, scheme);
      await signUpFast(owner, info, 'own');
      const beach = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
      const flat = await makeGroup(owner, 'Flat share', '$', []);
      await addFromOtherGroups(owner, flat.groupId, 'Ghania');
      const code = await inviteCodeOf(owner, beach.groupId, 'Ghania');
      const visitor = await newBrowserPage(browser, opened, scheme);

      await openInvite(visitor, code, 'Ghania');
      await expectNoA11yViolations(visitor, 'invite page, I\'m new here');

      await visitor.getByRole('button', { name: 'Create account and join' }).click();
      await expect(fieldError(visitor, USERNAME_RULE)).toBeVisible();
      await expectNoA11yViolations(visitor, 'invite page with field messages');

      await visitor.getByRole('radio', { name: 'I have an account' }).check();
      await visitor.getByLabel('Username').fill(uniqueName('nobody', info));
      await visitor.getByLabel('Password', { exact: true }).fill('some wrong password');
      await visitor.getByRole('button', { name: 'Log in and join' }).click();
      await expect(visitor.getByRole('alert')).toHaveText(WRONG_LOGIN);
      await expectNoA11yViolations(visitor, 'invite page, I have an account, wrong login');

      await visitor.goto('/invite/WRONGCODE');
      await expect(visitor.getByRole('heading', { level: 1, name: 'Invite not found' })).toBeVisible();
      await expectNoA11yViolations(visitor, 'invite not found');

      // The screen after signing up with the link.
      await openInvite(visitor, code, 'Ghania');
      await visitor.getByLabel('Username').fill(uniqueName('gha', info));
      await visitor.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await visitor.getByRole('button', { name: 'Create account and join' }).click();
      await expect(visitor.getByRole('heading', { level: 1, name: 'Save your recovery code' })).toBeVisible();
      await expectNoA11yViolations(visitor, 'invite page, recovery code');
      await visitor.getByRole('button', { name: "I've saved it, continue" }).click();
      await expect(visitor.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

      // And once it is used.
      const another = await newBrowserPage(browser, opened, scheme);
      await another.goto(`/invite/${code}`);
      await expect(another.getByRole('heading', { level: 1, name: 'Invite already used' })).toBeVisible();
      await expect(another.getByRole('alert')).toHaveText('This invite has already been used');
      await expectNoA11yViolations(another, 'invite already used');
    } finally {
      await closeAll(opened);
    }
  });

  test(`a11y (${scheme}): the invite page, logged in`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const opened: BrowserContext[] = [];
    try {
      const owner = await newBrowserPage(browser, opened, scheme);
      await signUpFast(owner, info, 'own');
      const { groupId } = await makeGroup(owner, 'Beach trip', '$', ['Ghania']);
      const code = await inviteCodeOf(owner, groupId, 'Ghania');

      // The owner: "This invite is for Ghania".
      await openInvite(owner, code, 'Ghania');
      await expect(owner.getByRole('status').filter({ hasText: 'This invite is for Ghania' })).toBeVisible();
      await expectNoA11yViolations(owner, 'invite page, already in these groups');

      // A friend who can join with one button.
      const friend = await newBrowserPage(browser, opened, scheme);
      await signUpFast(friend, info, 'fr');
      await openInvite(friend, code, 'Ghania');
      await expect(friend.getByRole('button', { name: 'Join these groups' })).toBeVisible();
      await expectNoA11yViolations(friend, 'invite page, join these groups');

      // "Use an invite code".
      await friend.goto('/join');
      await expect(friend.getByRole('heading', { level: 1, name: 'Use an invite code' })).toBeVisible();
      await expectNoA11yViolations(friend, 'use an invite code');
      await friend.getByRole('button', { name: 'Continue' }).click();
      await expect(fieldError(friend, 'Enter the invite code you were sent')).toBeVisible();
      await expectNoA11yViolations(friend, 'use an invite code, with a message');
    } finally {
      await closeAll(opened);
    }
  });

  test(`a11y (${scheme}): the Members tab with invite controls and the rename box open`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const opened: BrowserContext[] = [];
    try {
      const owner = await newBrowserPage(browser, opened, scheme);
      // Every browser offers sharing here, so the Share buttons are scanned everywhere.
      await owner.addInitScript(() => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: () => Promise.resolve() });
      });
      await signUpFast(owner, info, 'own');
      await makeGroup(owner, 'Other group', '$', ['Fatima']);
      const { groupId, ids } = await makeGroup(owner, 'Scanned', '$', ['Ali', 'Sara', 'Omar']);
      await api(owner, 'post', `/groups/${groupId}/members/${ids.Omar}/remove`);

      await openGroup(owner, groupId, 'Scanned', 'members');
      await expect(owner.getByRole('button', { name: 'Share invite for Ali' })).toBeVisible();
      // Just added: the box with the code, Copy link and (where offered) Share.
      await owner.getByLabel('Add a friend by name').fill('Zed');
      await owner.getByRole('button', { name: 'Add member' }).click();
      await expect(addedBox(owner, 'Zed')).toBeVisible();
      await expect(owner.getByLabel('Or add someone from your other groups')).toBeVisible();
      await expectNoA11yViolations(owner, 'members tab with the "was added" box and invite controls');

      // The rename box, open and with a message.
      await owner.getByRole('button', { name: 'Rename Sara', exact: true }).click();
      await expect(renameBox(owner, 'Sara')).toBeVisible();
      await expectNoA11yViolations(owner, 'members tab with the rename box open');
      await renameBox(owner, 'Sara').fill('ali');
      await owner.getByRole('button', { name: 'Save name' }).click();
      await expect(fieldError(owner, NAME_USED)).toBeVisible();
      await expectNoA11yViolations(owner, 'members tab, rename box with a message');

      // A removed member's row can be renamed too.
      await owner.getByRole('button', { name: 'Cancel', exact: true }).click();
      await owner.getByRole('button', { name: 'Rename Omar', exact: true }).click();
      await expect(renameBox(owner, 'Omar')).toBeVisible();
      await expectNoA11yViolations(owner, 'members tab, renaming a removed member');
    } finally {
      await closeAll(opened);
    }
  });

  test(`a11y (${scheme}): the Edit group page`, async ({ browser }, info) => {
    test.setTimeout(90_000);
    const opened: BrowserContext[] = [];
    try {
      const owner = await newBrowserPage(browser, opened, scheme);
      await signUpFast(owner, info, 'own');
      const { groupId } = await makeGroup(owner, 'Scanned', '$', ['Ali']);
      await openGroup(owner, groupId, 'Scanned');
      await expectNoA11yViolations(owner, 'group page with the Edit group button');

      await owner.getByRole('link', { name: 'Edit group' }).click();
      await expect(owner.getByRole('heading', { level: 1, name: 'Edit group' })).toBeVisible();
      await expectNoA11yViolations(owner, 'edit group');

      await owner.getByLabel('Group name').fill('');
      await owner.getByLabel('Currency', { exact: true }).selectOption({ label: 'Other' });
      await owner.getByLabel('Currency symbol').fill('12');
      await owner.getByRole('button', { name: 'Save changes' }).click();
      await expect(fieldError(owner, 'Enter a group name of up to 50 characters')).toBeVisible();
      await expectNoA11yViolations(owner, 'edit group with messages');
    } finally {
      await closeAll(opened);
    }
  });
}
