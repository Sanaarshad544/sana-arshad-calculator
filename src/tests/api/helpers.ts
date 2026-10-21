import { afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../server/app.js';
import { createPool, type Pool } from '../../server/db.js';
import { TEST_SESSION_SECRET, testDatabaseUrl } from '../test-env.js';

export const PASSWORD = 'correct horse 1';

let shared: { pool: Pool; app: Express } | null = null;

/** One app + pool per test file, closed when the file finishes. */
export function testApp(): { pool: Pool; app: Express } {
  if (!shared) {
    const pool = createPool(testDatabaseUrl());
    shared = { pool, app: createApp({ pool, secret: TEST_SESSION_SECRET, production: false }) };
    afterAll(async () => {
      await shared?.pool.end();
      shared = null;
    });
  }
  return shared;
}

let counter = 0;
/** A username nobody else in this test run has used. */
export function uniqueName(prefix = 'u'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`.slice(0, 30);
}

export type Agent = ReturnType<typeof request.agent>;

/** Signs up a new account and returns a logged-in agent (cookies kept). */
export async function newUser(prefix = 'u'): Promise<{ agent: Agent; username: string; recoveryCode: string }> {
  const { app } = testApp();
  const agent = request.agent(app);
  const username = uniqueName(prefix);
  const res = await agent.post('/api/auth/signup').send({ username, password: PASSWORD });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, username, recoveryCode: res.body.recoveryCode };
}

export function anon(): Agent {
  return request.agent(testApp().app);
}

export const amt = (value: string) => ({ mode: 'amount' as const, value });
export const pct = (value: string) => ({ mode: 'percent' as const, value });

export function soloBill(prices: string[], over: Record<string, unknown> = {}) {
  return {
    name: '',
    items: prices.map((price) => ({ name: '', price })),
    tax: amt('0'),
    otherCharges: amt(''),
    tip: amt('0'),
    tipOn: 'items',
    ...over,
  };
}

export function groupBill(participantIds: string[], payerId: string, prices: string[], over: Record<string, unknown> = {}) {
  return { ...soloBill(prices), splitMode: 'equal', participantIds, payerId, ...over };
}

/** Creates a group and returns its id and my member id. */
export async function createGroup(agent: Agent, name = 'Friends', currency = '$'): Promise<{ groupId: string; meId: string }> {
  const res = await agent.post('/api/groups').send({ name, currency });
  if (res.status !== 201) throw new Error(`create group failed: ${JSON.stringify(res.body)}`);
  const detail = await agent.get(`/api/groups/${res.body.groupId}`);
  return { groupId: res.body.groupId, meId: detail.body.group.meId };
}

/** Adds name-only members and returns their ids by name. */
export async function addMembers(agent: Agent, groupId: string, names: string[]): Promise<Record<string, string>> {
  for (const name of names) {
    const res = await agent.post(`/api/groups/${groupId}/members`).send({ name });
    if (res.status !== 201) throw new Error(`add member failed: ${JSON.stringify(res.body)}`);
  }
  const detail = await agent.get(`/api/groups/${groupId}`);
  return Object.fromEntries(detail.body.group.members.map((m: { name: string; id: string }) => [m.name, m.id]));
}

export async function balances(agent: Agent, groupId: string): Promise<Record<string, number>> {
  const detail = await agent.get(`/api/groups/${groupId}`);
  return Object.fromEntries(
    detail.body.group.members
      .filter((m: { status: string }) => m.status === 'current')
      .map((m: { name: string; balanceCents: number }) => [m.name, m.balanceCents]),
  );
}
