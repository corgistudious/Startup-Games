import type { Queryable } from './db';
export async function audit(q: Queryable, actorId: string | null, action: string, targetType: string | null, targetId: string | null, detail: Record<string, unknown> = {}) {
  await q.query('INSERT INTO audit_log (actor_id, action, target_type, target_id, detail) VALUES ($1,$2,$3,$4,$5)', [actorId, action, targetType, targetId, detail]);
}
