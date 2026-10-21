import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueName } from './helpers.js';

test('US-01/US-02 sign up, see the recovery code once, log out and back in', async ({ page }, info) => {
  const username = uniqueName('Sana', info);
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Password must be 8–128 characters')).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  await expect(page.getByText('Save this now.')).toBeVisible();
  const code = (await page.getByTestId('recovery-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
  await page.getByRole('button', { name: "I've saved it, continue" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // US-01 #2: the code is never shown again.
  await page.goto('/signup');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(code)).toHaveCount(0);

  // US-02 #7: log out, then private pages send you to login.
  await page.getByRole('link', { name: 'Account' }).first().click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.goto('/solo');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  // US-02 #2-#5: wrong password, then the right one in another letter case.
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('wrong password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Username or password is incorrect');
  await page.getByLabel('Username').fill(username.toUpperCase());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  // US-33 #1: logging in always lands on the Dashboard.
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  // US-01 #3: the same username can't be taken twice.
  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByLabel('Username').fill(username.toLowerCase());
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('That username is taken')).toBeVisible();
});

test('US-03 reset a forgotten password with the recovery code', async ({ page }, info) => {
  const username = uniqueName('reset', info);
  const res = await page.request.post('/api/auth/signup', { data: { username, password: PASSWORD } });
  const { recoveryCode } = await res.json();
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Recovery code').fill('WRONG-CODE');
  await page.getByLabel('New password').fill('a new password');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('alert')).toHaveText('Username or recovery code is incorrect');

  await page.getByLabel('Recovery code').fill(recoveryCode);
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery code' })).toBeVisible();
  const newCode = (await page.getByTestId('recovery-code').textContent())?.trim();
  expect(newCode).not.toBe(recoveryCode);
  await page.getByRole('button', { name: "I've saved it, continue" }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});

test('US-02 #6/#10 after 5 wrong passwords the log-in page asks me to wait', async ({ page }, info) => {
  const username = uniqueName('wait', info);
  await page.request.post('/api/auth/signup', { data: { username, password: PASSWORD } });
  await page.context().clearCookies();
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
  await page.getByLabel('Username').fill(username);
  for (let i = 0; i < 5; i += 1) {
    await page.getByLabel('Password').fill(`wrong password ${i}`);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Username or password is incorrect');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
  }
  // Even the right password has to wait.
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert')).toHaveText(/^Too many wrong tries\. Wait (30|29) seconds and try again\.$/);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
