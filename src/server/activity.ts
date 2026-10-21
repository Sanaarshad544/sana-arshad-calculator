import type { Queryable } from './db.js';

/** Adds a line to a group's activity log. */
export async function logActivity(db: Queryable, groupId: number, actorName: string, message: string): Promise<void> {
  await db.query('INSERT INTO activity (group_id, actor_name, message) VALUES ($1, $2, $3)', [groupId, actorName, message]);
}
