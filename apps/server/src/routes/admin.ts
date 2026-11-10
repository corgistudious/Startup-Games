import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { reasonSchema, adminRoleSchema, broadcastSchema, ticketReplySchema } from '@startup/shared';
import {
  many,
  one,
  maybe,
  fail,
  audit,
  withTx,
  revokeAllSessions,
  inviteReviewer,
  revokeReviewer,
  grantTitle,
  revokeTitle,
  moderateReview,
  auditLedger,
  worldStatus,
  notify,
  FAVORITE_PARAMS,
  haltSymbol,
  nowMinute,
} from '@startup/engine';

const uuid = z.object({ id: z.string().uuid() });

/** Every admin route checks the role server-side; sensitive actions require a reason and are audited. */
export async function adminRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/admin/overview', async (req) => {
    ctx.requireAdmin(req);
    const counts = await one(
      ctx.db,
      `SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE status='locked') AS locked,
              (SELECT count(*)::int FROM companies WHERE NOT is_npc) AS companies, (SELECT count(*)::int FROM companies WHERE is_npc) AS npcs,
              (SELECT count(*)::int FROM companies WHERE status='bankrupt') AS bankrupt, (SELECT count(*)::int FROM review_reports WHERE status='open') AS open_reports,
              (SELECT count(*)::int FROM tickets WHERE status='open') AS open_tickets, (SELECT count(*)::int FROM instruments) AS listed`,
    );
    const ledger = await auditLedger(ctx.db);
    const world = await worldStatus(ctx.db);
    const sectors = await many(ctx.db, `SELECT owner_type, owner_id, code, balance FROM accounts WHERE owner_type='system' ORDER BY owner_id, code`);
    return { counts, ledger, world, sectors, favoriteParams: FAVORITE_PARAMS };
  });

  app.get('/admin/users', async (req) => {
    ctx.requireAdmin(req);
    const q = z.object({ q: z.string().trim().max(40).optional() }).parse(req.query);
    return many(
      ctx.db,
      `SELECT u.id, u.username, u.display_name, u.role, u.status, u.lock_reason, u.stage, u.created_at, u.last_login_at,
              (SELECT balance FROM accounts a WHERE a.owner_type='user' AND a.owner_id=u.id::text AND a.code='cash') AS cash,
              (SELECT status FROM reviewers r WHERE r.user_id=u.id) AS reviewer_status
         FROM users u WHERE ($1::text IS NULL OR u.username ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%') ORDER BY u.created_at DESC LIMIT 200`,
      [q.q ?? null],
    );
  });

  app.post('/admin/users/:id/lock', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { reason, locked } = z.object({ reason: z.string().trim().min(5).max(300), locked: z.boolean() }).parse(req.body);
    if (id === admin.id) fail('self', 'Không thể tự khóa tài khoản của mình.');
    await withTx(ctx.db, async (tx) => {
      await tx.query(`UPDATE users SET status=$2, lock_reason=$3 WHERE id=$1`, [id, locked ? 'locked' : 'active', locked ? reason : null]);
      if (locked) await revokeAllSessions(tx, id);
      await audit(tx, admin.id, locked ? 'user.lock' : 'user.unlock', 'user', id, { reason });
    });
    return { ok: true };
  });

  app.post('/admin/users/:id/role', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { role, reason } = ctx.parse(adminRoleSchema, req.body);
    if (id === admin.id) fail('self', 'Không thể tự thay đổi quyền của mình.');
    await withTx(ctx.db, async (tx) => {
      await tx.query('UPDATE users SET role=$2 WHERE id=$1', [id, role]);
      await audit(tx, admin.id, 'user.role', 'user', id, { role, reason });
    });
    return { ok: true };
  });

  app.get('/admin/companies', async (req) => {
    ctx.requireAdmin(req);
    return many(
      ctx.db,
      `SELECT c.id, c.name, c.slug, c.status, c.is_npc, c.verified, c.reputation, c.insolvent_days, i.name AS industry, u.username AS owner,
              (SELECT balance FROM accounts a WHERE a.owner_type='company' AND a.owner_id=c.id::text AND a.code='cash') AS cash,
              (SELECT count(*)::int FROM people p WHERE p.company_id=c.id) AS employees,
              (SELECT COALESCE(json_agg(title),'[]') FROM company_titles t WHERE t.company_id=c.id AND t.revoked_at IS NULL) AS titles
         FROM companies c JOIN industries i ON i.code=c.industry_code LEFT JOIN users u ON u.id=c.owner_user_id ORDER BY c.is_npc, c.founded_at DESC`,
    );
  });

  app.post('/admin/companies/:id/verify', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { verified, reason } = z.object({ verified: z.boolean(), reason: z.string().trim().min(5).max(300) }).parse(req.body);
    await withTx(ctx.db, async (tx) => {
      await tx.query('UPDATE companies SET verified=$2 WHERE id=$1', [id, verified]);
      await audit(tx, admin.id, verified ? 'company.verify' : 'company.unverify', 'company', id, { reason });
    });
    return { ok: true };
  });

  app.post('/admin/companies/:id/titles', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { title, grant, reason } = z.object({ title: z.enum(['tuyen_chon', 'yeu_thich']), grant: z.boolean(), reason: z.string().trim().min(5).max(300) }).parse(req.body);
    if (grant && title !== 'tuyen_chon') fail('auto_only', 'Danh hiệu Yêu Thích chỉ được xét chọn tự động.');
    await withTx(ctx.db, (tx) => (grant ? grantTitle(tx, admin.id, id, reason) : revokeTitle(tx, admin.id, id, title, reason)));
    return { ok: true };
  });

  app.get('/admin/reviewers', async (req) => {
    ctx.requireAdmin(req);
    return many(ctx.db, `SELECT r.*, u.username, u.display_name FROM reviewers r JOIN users u ON u.id=r.user_id ORDER BY r.status, r.eval_points DESC`);
  });
  app.post('/admin/reviewers/invite', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { userId, note } = z.object({ userId: z.string().uuid(), note: z.string().trim().min(5).max(300) }).parse(req.body);
    await withTx(ctx.db, (tx) => inviteReviewer(tx, admin.id, userId, note));
    return { ok: true };
  });
  app.post('/admin/reviewers/:id/revoke', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { reason } = ctx.parse(reasonSchema, req.body);
    await withTx(ctx.db, (tx) => revokeReviewer(tx, admin.id, id, reason));
    return { ok: true };
  });

  app.get('/admin/reports', async (req) => {
    ctx.requireAdmin(req);
    return many(
      ctx.db,
      `SELECT rr.id, rr.reason, rr.status, rr.created_at, r.id AS review_id, r.rating, r.body, r.status AS review_status, c.name AS company, a.display_name AS author, rp.display_name AS reporter
         FROM review_reports rr JOIN reviews r ON r.id=rr.review_id JOIN companies c ON c.id=r.company_id JOIN users a ON a.id=r.author_id JOIN users rp ON rp.id=rr.reporter_id
        ORDER BY rr.status='open' DESC, rr.created_at DESC LIMIT 100`,
    );
  });
  app.post('/admin/reviews/:id/moderate', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { hide, reason } = z.object({ hide: z.boolean(), reason: z.string().trim().min(5).max(300) }).parse(req.body);
    await withTx(ctx.db, (tx) => moderateReview(tx, admin.id, id, hide, reason));
    return { ok: true };
  });

  app.post('/admin/broadcast', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { title, body } = ctx.parse(broadcastSchema, req.body);
    await withTx(ctx.db, async (tx) => {
      const users = await many<{ id: string }>(tx, `SELECT id FROM users WHERE status='active'`);
      for (const u of users) await notify(tx, u.id, 'announcement', title, body);
      await audit(tx, admin.id, 'broadcast', null, null, { title, recipients: users.length });
    });
    return { ok: true };
  });

  app.get('/admin/tickets', async (req) => {
    ctx.requireAdmin(req);
    const tickets = await many(ctx.db, `SELECT t.*, u.username FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.status='open' DESC, t.updated_at DESC LIMIT 100`);
    const messages = await many(ctx.db, `SELECT m.*, u.display_name FROM ticket_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id = ANY($1) ORDER BY m.id`, [tickets.map((t) => t.id)]);
    return { tickets, messages };
  });
  app.post('/admin/tickets/:id/reply', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = uuid.parse(req.params);
    const { body } = ctx.parse(ticketReplySchema, req.body);
    const close = z.object({ close: z.boolean().default(false) }).parse(req.query).close;
    await withTx(ctx.db, async (tx) => {
      const t = await maybe<{ user_id: string; subject: string }>(tx, 'SELECT user_id, subject FROM tickets WHERE id=$1', [id]);
      if (!t) return fail('not_found', 'Không tìm thấy yêu cầu.', 404);
      await tx.query('INSERT INTO ticket_messages (ticket_id, author_id, is_staff, body) VALUES ($1,$2,true,$3)', [id, admin.id, body]);
      await tx.query(`UPDATE tickets SET status=$2, updated_at=now() WHERE id=$1`, [id, close ? 'closed' : 'answered']);
      await notify(tx, t.user_id, 'support', 'Hỗ trợ đã phản hồi', t.subject);
    });
    return { ok: true };
  });

  app.post('/admin/exchange/:symbol/halt', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { symbol } = z.object({ symbol: z.string().regex(/^[A-Z]{3,5}$/) }).parse(req.params);
    const { halted, reason } = z.object({ halted: z.boolean(), reason: z.string().trim().min(5).max(300) }).parse(req.body);
    await withTx(ctx.db, async (tx) => {
      await haltSymbol(tx, symbol, halted, reason, await nowMinute(tx));
      await audit(tx, admin.id, halted ? 'exchange.halt' : 'exchange.resume', 'instrument', symbol, { reason });
    });
    return { ok: true };
  });

  app.get('/admin/audit', async (req) => {
    ctx.requireAdmin(req);
    return many(ctx.db, `SELECT a.*, u.username AS actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200`);
  });

  app.get('/admin/ledger', async (req) => {
    ctx.requireAdmin(req);
    const q = z.object({ kind: z.string().max(40).optional() }).parse(req.query);
    return many(
      ctx.db,
      `SELECT e.id, e.kind, e.memo, e.game_minute, e.created_at, (SELECT COALESCE(SUM(amount),0) FROM postings p WHERE p.entry_id=e.id AND p.amount > 0)::bigint AS amount
         FROM journal_entries e WHERE ($1::text IS NULL OR e.kind=$1) ORDER BY e.created_at DESC LIMIT 200`,
      [q.kind ?? null],
    );
  });

  app.get('/admin/jobs', async (req) => {
    ctx.requireAdmin(req);
    return { failed: await many(ctx.db, `SELECT id, kind, dedupe_key, attempts, last_error, created_at FROM jobs WHERE status='failed' ORDER BY id DESC LIMIT 50`), world: await worldStatus(ctx.db) };
  });

  app.post('/admin/jobs/:id/retry', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    await ctx.db.query(`UPDATE jobs SET status='pending', attempts=0, run_after=now() WHERE id=$1 AND status='failed'`, [id]);
    await audit(ctx.db, admin.id, 'job.retry', 'job', String(id));
    return { ok: true };
  });
}
