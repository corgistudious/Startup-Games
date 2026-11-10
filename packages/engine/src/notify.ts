import type { Queryable } from './db';

export async function notify(q: Queryable, userId: string, kind: string, title: string, body = '', data: Record<string, unknown> = {}, dedupeKey?: string) {
  const r = await q.query(
    `INSERT INTO notifications (user_id, kind, title, body, data, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [userId, kind, title, body, data, dedupeKey ?? null],
  );
  if (r.rowCount) await q.query(`SELECT pg_notify('events', $1)`, [JSON.stringify({ t: 'notification', userId })]);
}

export async function notifyCompanyOwner(q: Queryable, companyId: string, kind: string, title: string, body = '', dedupeKey?: string) {
  const r = await q.query<{ owner_user_id: string | null }>('SELECT owner_user_id FROM companies WHERE id=$1', [companyId]);
  const owner = r.rows[0]?.owner_user_id;
  if (owner) await notify(q, owner, kind, title, body, { companyId }, dedupeKey);
}

export async function broadcastEvent(q: Queryable, payload: Record<string, unknown>) {
  await q.query(`SELECT pg_notify('events', $1)`, [JSON.stringify(payload)]);
}
