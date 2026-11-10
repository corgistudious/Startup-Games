import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { reviewSchema, reviewReplySchema, reportSchema, quizAnswerSchema, ticketSchema, ticketReplySchema, REVIEWER_QUIZ, reviewerRank } from '@startup/shared';
import { submitReview, replyReview, reportReview, respondInvite, submitQuiz, recommend, unrecommend, recommendationCount, many, one, maybe, fail, withTx } from '@startup/engine';

const TITLES_SQL = `(SELECT COALESCE(json_agg(title), '[]') FROM company_titles t WHERE t.company_id=c.id AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now()))`;
const RECS_SQL = `(SELECT count(DISTINCT rc.reviewer_id)::int FROM recommendations rc JOIN reviewers rv ON rv.user_id=rc.reviewer_id AND rv.status='active' WHERE rc.company_id=c.id AND rc.revoked_at IS NULL)`;

export async function communityRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---------------- Company library (public) ----------------
  app.get('/library', async (req) => {
    const q = z
      .object({
        q: z.string().trim().max(60).optional(),
        industry: z.string().max(40).optional(),
        title: z.enum(['tuyen_chon', 'yeu_thich', 'de_cu']).optional(),
        sort: z.enum(['rating', 'newest', 'reviews', 'recommended']).default('rating'),
      })
      .parse(req.query);
    const order = { rating: 'avg_rating DESC NULLS LAST, review_count DESC', newest: 'c.founded_at DESC', reviews: 'review_count DESC', recommended: 'recommendations DESC, avg_rating DESC NULLS LAST' }[q.sort];
    return many(
      ctx.db,
      `SELECT * FROM (
         SELECT c.id, c.name, c.slug, c.description, c.logo_hue, c.is_npc, c.status, c.reputation, c.verified, c.founded_minute, c.industry_code, i.name AS industry, i.icon,
                u.display_name AS owner, u.stage AS owner_stage,
                (SELECT AVG(rating)::float FROM reviews r WHERE r.company_id=c.id AND r.status='visible') AS avg_rating,
                (SELECT count(*)::int FROM reviews r WHERE r.company_id=c.id AND r.status='visible') AS review_count,
                ${RECS_SQL} AS recommendations, ${TITLES_SQL} AS titles
           FROM companies c JOIN industries i ON i.code=c.industry_code LEFT JOIN users u ON u.id=c.owner_user_id
          WHERE NOT c.is_npc AND c.status <> 'closed'
            AND ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR c.industry_code = $2)
       ) c
       WHERE ($3::text IS NULL OR ($3 = 'de_cu' AND recommendations > 0) OR titles::jsonb ? $3)
       ORDER BY ${order} LIMIT 60`,
      [q.q ?? null, q.industry ?? null, q.title ?? null],
    );
  });

  app.get('/library/:slug', async (req) => {
    const { slug } = z.object({ slug: z.string().max(80) }).parse(req.params);
    const c = await maybe<{ id: string }>(
      ctx.db,
      `SELECT c.id, c.name, c.slug, c.description, c.logo_hue, c.is_npc, c.status, c.reputation, c.brand, c.verified, c.founded_minute, c.founded_at, c.owner_user_id,
              i.name AS industry, i.icon, l.name AS location, u.display_name AS owner, u.stage AS owner_stage,
              (SELECT count(*)::int FROM people p WHERE p.company_id=c.id) AS employees,
              (SELECT symbol FROM instruments ins WHERE ins.company_id=c.id) AS symbol,
              ${TITLES_SQL} AS titles
         FROM companies c JOIN industries i ON i.code=c.industry_code JOIN locations l ON l.code=c.location_code LEFT JOIN users u ON u.id=c.owner_user_id WHERE c.slug=$1`,
      [slug],
    );
    if (!c) return fail('not_found', 'Không tìm thấy doanh nghiệp.', 404);
    const reviews = await many(
      ctx.db,
      `SELECT r.id, r.rating, r.body, r.by_reviewer, r.owner_reply, r.replied_at, r.created_at, u.display_name AS author, u.id AS author_id FROM reviews r JOIN users u ON u.id=r.author_id
        WHERE r.company_id=$1 AND r.status='visible' ORDER BY r.created_at DESC LIMIT 100`,
      [c.id],
    );
    const stats = await one(ctx.db, `SELECT AVG(rating)::float AS avg, count(*)::int AS n, COALESCE(json_object_agg(rating, cnt), '{}') AS dist FROM (SELECT rating, count(*) AS cnt FROM reviews WHERE company_id=$1 AND status='visible' GROUP BY rating) x`, [c.id]);
    const recommendations = await recommendationCount(ctx.db, c.id);
    const history = await many(ctx.db, `SELECT month, revenue, net_profit FROM monthly_reports WHERE company_id=$1 ORDER BY month`, [c.id]);
    const titleHistory = await many(ctx.db, `SELECT title, reason, granted_at, revoked_at, revoke_reason, expires_at FROM company_titles WHERE company_id=$1 ORDER BY granted_at DESC`, [c.id]);
    const recommenders = await many(ctx.db, `SELECT u.display_name, rc.note, rc.created_at FROM recommendations rc JOIN users u ON u.id=rc.reviewer_id JOIN reviewers rv ON rv.user_id=rc.reviewer_id AND rv.status='active' WHERE rc.company_id=$1 AND rc.revoked_at IS NULL`, [c.id]);
    return { company: c, reviews, stats, recommendations, recommenders, history, titleHistory };
  });

  app.post('/companies/:id/reviews', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = ctx.parse(reviewSchema, req.body);
    const reviewId = await withTx(ctx.db, (tx) => submitReview(tx, u.id, id, input.rating, input.body));
    return { id: reviewId };
  });

  app.post('/reviews/:id/reply', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { body } = ctx.parse(reviewReplySchema, req.body);
    await withTx(ctx.db, (tx) => replyReview(tx, u.id, id, body));
    return { ok: true };
  });

  app.post('/reviews/:id/report', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason } = ctx.parse(reportSchema, req.body);
    await withTx(ctx.db, (tx) => reportReview(tx, u.id, id, reason));
    return { ok: true };
  });

  app.post('/companies/:id/follow', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const on = z.object({ on: z.boolean() }).parse(req.body).on;
    if (on) await ctx.db.query('INSERT INTO follows (user_id, company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [u.id, id]);
    else await ctx.db.query('DELETE FROM follows WHERE user_id=$1 AND company_id=$2', [u.id, id]);
    return { ok: true };
  });

  app.get('/players/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = await maybe(ctx.db, 'SELECT id, display_name, stage, bio, avatar_hue, created_at FROM users WHERE id=$1', [id]);
    if (!p) return fail('not_found', 'Không tìm thấy người chơi.', 404);
    const companies = await many(ctx.db, `SELECT c.name, c.slug, c.status, c.logo_hue, i.name AS industry FROM companies c JOIN industries i ON i.code=c.industry_code WHERE owner_user_id=$1`, [id]);
    const reviewer = await maybe<{ status: string; eval_points: number; reputation: number }>(ctx.db, 'SELECT status, eval_points, reputation FROM reviewers WHERE user_id=$1', [id]);
    return { player: p, companies, reviewer: reviewer?.status === 'active' ? { ...reviewer, rank: reviewerRank(reviewer.eval_points) } : null };
  });

  // ---------------- Reviewer ----------------
  app.get('/reviewer/me', async (req) => {
    const u = ctx.requireUser(req);
    const r = await maybe<{ eval_points: number }>(ctx.db, 'SELECT * FROM reviewers WHERE user_id=$1', [u.id]);
    const events = await many(ctx.db, 'SELECT kind, delta, reason, created_at FROM reviewer_events WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [u.id]);
    const reviews = await many(ctx.db, `SELECT r.rating, r.created_at, c.name, c.slug FROM reviews r JOIN companies c ON c.id=r.company_id WHERE r.author_id=$1 AND r.by_reviewer ORDER BY r.created_at DESC LIMIT 30`, [u.id]);
    const recs = await many(ctx.db, `SELECT c.name, c.slug, rc.created_at, rc.revoked_at FROM recommendations rc JOIN companies c ON c.id=rc.company_id WHERE rc.reviewer_id=$1 ORDER BY rc.created_at DESC`, [u.id]);
    return { reviewer: r, rank: r ? reviewerRank(r.eval_points) : null, events, reviews, recommendations: recs, quiz: REVIEWER_QUIZ };
  });
  app.post('/reviewer/respond', async (req) => {
    const u = ctx.requireUser(req);
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    await withTx(ctx.db, (tx) => respondInvite(tx, u.id, accept));
    return { ok: true };
  });
  app.post('/reviewer/quiz', async (req) => {
    const u = ctx.requireUser(req);
    const { answers } = ctx.parse(quizAnswerSchema, req.body);
    return withTx(ctx.db, (tx) => submitQuiz(tx, u.id, answers));
  });
  app.post('/companies/:id/recommend', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { on, note } = z.object({ on: z.boolean(), note: z.string().trim().max(300).default('') }).parse(req.body);
    await withTx(ctx.db, (tx) => (on ? recommend(tx, u.id, id, note) : unrecommend(tx, u.id, id)));
    return { ok: true };
  });

  // ---------------- Support ----------------
  app.get('/tickets', async (req) => {
    const u = ctx.requireUser(req);
    const tickets = await many(ctx.db, 'SELECT * FROM tickets WHERE user_id=$1 ORDER BY updated_at DESC', [u.id]);
    const messages = await many(ctx.db, `SELECT m.*, u.display_name FROM ticket_messages m JOIN users u ON u.id=m.author_id WHERE m.ticket_id IN (SELECT id FROM tickets WHERE user_id=$1) ORDER BY m.id`, [u.id]);
    return { tickets, messages };
  });
  app.post('/tickets', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
    const u = ctx.requireUser(req);
    const input = ctx.parse(ticketSchema, req.body);
    return withTx(ctx.db, async (tx) => {
      const t = await one<{ id: string }>(tx, 'INSERT INTO tickets (user_id, subject) VALUES ($1,$2) RETURNING id', [u.id, input.subject]);
      await tx.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)', [t.id, u.id, input.body]);
      return t;
    });
  });
  app.post('/tickets/:id/messages', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { body } = ctx.parse(ticketReplySchema, req.body);
    const t = await maybe<{ user_id: string; status: string }>(ctx.db, 'SELECT user_id, status FROM tickets WHERE id=$1', [id]);
    if (!t || t.user_id !== u.id) return fail('not_found', 'Không tìm thấy yêu cầu hỗ trợ.', 404);
    if (t.status === 'closed') fail('closed', 'Yêu cầu đã đóng.');
    await ctx.db.query('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1,$2,$3)', [id, u.id, body]);
    await ctx.db.query(`UPDATE tickets SET status='open', updated_at=now() WHERE id=$1`, [id]);
    return { ok: true };
  });
}
