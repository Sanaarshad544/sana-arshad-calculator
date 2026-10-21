import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, type TestInfo } from '@playwright/test';

export const PASSWORD = 'correct horse 1';

let n = 0;
export function uniqueName(prefix: string, info: TestInfo): string {
  n += 1;
  const tag = `${info.project.name.slice(0, 2)}${info.workerIndex}${Date.now().toString(36).slice(-5)}${n}`;
  return `${prefix}${tag}`.slice(0, 30);
}

/** Signs up through the API (fast) and opens the Dashboard logged in. */
export async function signUpFast(page: Page, info: TestInfo, prefix = 'u'): Promise<string> {
  const username = uniqueName(prefix, info);
  const res = await page.request.post('/api/auth/signup', { data: { username, password: PASSWORD } });
  expect(res.status()).toBe(201);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  return username;
}

export async function api<T = unknown>(page: Page, method: 'get' | 'post' | 'put' | 'delete', path: string, data?: unknown): Promise<T> {
  const body = data === undefined && (method === 'post' || method === 'put') ? {} : data;
  const res = await page.request[method](`/api${path}`, body === undefined ? {} : { data: body });
  if (!res.ok()) throw new Error(`${method} ${path} -> ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Creates a group with name-only members through the API; returns ids by name. */
export async function makeGroup(page: Page, name: string, currency: string, members: string[]) {
  const { groupId } = await api<{ groupId: string }>(page, 'post', '/groups', { name, currency });
  for (const m of members) await api(page, 'post', `/groups/${groupId}/members`, { name: m });
  const { group } = await api<{ group: { meId: string; members: { id: string; name: string }[] } }>(page, 'get', `/groups/${groupId}`);
  const ids = Object.fromEntries(group.members.map((m) => [m.name, m.id]));
  return { groupId, meId: group.meId, ids };
}

/** Runs axe and fails on any WCAG 2.0/2.1/2.2 A or AA problem. */
export async function expectNoA11yViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((nd) => nd.target.join(' ')).join(', ')})`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** The page never scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
