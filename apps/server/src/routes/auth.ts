import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../app.js';
import { registerSchema, loginSchema, profileSchema, transferSchema } from '@startup/shared';
import { registerUser, login, logout, balances, many, one, maybe, post, acct, fail, stageProgress, nowMinute, loansOf, notify } from '@startup/engine';

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', strict, async (req) => {
    const input = ctx.parse(registerSchema, req.body);
    await registerUser(ctx.db, input);
    return login(ctx.db, input.username, input.password, { ip: req.ip, ua: req.headers['user-agent'] });
  });

  app.post('/auth/login', strict, async (req) => {
    const input = ctx.parse(loginSchema, req.body);
    return login(ctx.db, input.username, input.password, { ip: req.ip, ua: req.headers['user-agent'] });
  });

  app.post('/auth/logout', async (req) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) await logout(ctx.db, h.slice(7));
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const u = ctx.requireUser(req);
    const profile = await one(ctx.db, 'SELECT id, username, display_name, role, stage, bio, avatar_hue, created_at FROM users WHERE id=$1', [u.id]);
    const unread = await one<{ n: number }>(ctx.db, 'SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [u.id]);
    const reviewer = await maybe(ctx.db, 'SELECT status, reputation, eval_points FROM reviewers WHERE user_id=$1', [u.id]);
    return { ...profile, unread: unread.n, reviewer };
  });

  app.patch('/me/profile', async (req) => {
    const u = ctx.requireUser(req);
    const input = ctx.parse(profileSchema, req.body);
    await ctx.db.query('UPDATE users SET display_name=COALESCE($2,display_name), bio=COALESCE($3,bio) WHERE id=$1', [u.id, input.displayName ?? null, input.bio ?? null]);
    return { ok: true };
  });

  /** Personal overview: wallet, holdings, companies, loans, stage progress. */
  app.get('/me/overview', async (req) => {
    const u = ctx.requireUser(req);
    const b = await balances(ctx.db, 'user', u.id);
    const companies = await many(
      ctx.db,
      `SELECT c.id, c.name, c.slug, c.status, c.industry_code, i.name AS industry_name, i.icon, c.reputation, c.brand, c.logo_hue,
              (SELECT balance FROM accounts WHERE owner_type='company' AND owner_id=c.id::text AND code='cash') AS cash,
              (SELECT count(*)::int FROM people p WHERE p.company_id=c.id) AS employees,
              (SELECT COALESCE(SUM(revenue),0)::bigint FROM sales_daily s WHERE s.company_id=c.id AND s.day >= $2) AS revenue_7d
         FROM companies c JOIN industries i ON i.code=c.industry_code WHERE c.owner_user_id=$1 ORDER BY c.founded_at`,
      [u.id, Math.floor((await nowMinute(ctx.db)) / 1440) - 7],
    );
    const holdings = await many(
      ctx.db,
      `SELECT h.symbol, h.qty, h.locked, h.cost, i.last_price, c.name FROM holdings h JOIN instruments i ON i.symbol=h.symbol JOIN companies c ON c.id=i.company_id WHERE h.holder_type='user' AND h.holder_id=$1 AND h.qty > 0`,
      [u.id],
    );
    const portfolio = holdings.reduce((s: number, h) => s + Number(h.qty) * Number(h.last_price ?? 0), 0);
    const companyEquity = companies.reduce((s: number, c) => s + Number(c.cash ?? 0), 0);
    const loans = await loansOf(ctx.db, 'user', u.id);
    const progress = await stageProgress(ctx.db, u.id, await nowMinute(ctx.db));
    const revenueSeries = await many(
      ctx.db,
      `SELECT s.day, SUM(s.revenue)::bigint AS revenue FROM sales_daily s JOIN companies c ON c.id=s.company_id WHERE c.owner_user_id=$1 GROUP BY s.day ORDER BY s.day DESC LIMIT 14`,
      [u.id],
    );
    return {
      cash: b.cash ?? 0,
      cashLocked: b.cash_locked ?? 0,
      portfolioValue: portfolio,
      companyCash: companyEquity,
      netWorth: (b.cash ?? 0) + (b.cash_locked ?? 0) + portfolio + companyEquity + (b.loan_payable ?? 0),
      companies,
      holdings,
      loans,
      stage: progress,
      revenueSeries: revenueSeries.reverse(),
    };
  });

  app.get('/me/ledger', async (req) => {
    const u = ctx.requireUser(req);
    return many(
      ctx.db,
      `SELECT e.id, e.kind, e.memo, e.game_minute, e.created_at, p.amount, a.code FROM postings p JOIN accounts a ON a.id=p.account_id JOIN journal_entries e ON e.id=p.entry_id
        WHERE a.owner_type='user' AND a.owner_id=$1 AND a.code IN ('cash','cash_locked') ORDER BY p.id DESC LIMIT 100`,
      [u.id],
    );
  });

  /** Player-to-player transfer of personal cash. */
  app.post('/me/transfer', async (req) => {
    const u = ctx.requireUser(req);
    const input = ctx.parse(transferSchema, req.body);
    const to = await maybe<{ id: string; display_name: string }>(ctx.db, 'SELECT id, display_name FROM users WHERE username=$1 AND status=$2', [input.toUsername, 'active']);
    if (!to) return fail('not_found', 'Không tìm thấy người nhận.', 404);
    if (to.id === u.id) fail('self', 'Không thể chuyển cho chính mình.');
    const key = ctx.actionKey(req, 'transfer');
    const res = await ctx.mutate((tx, minute) =>
      post(tx, {
        key,
        kind: 'transfer',
        memo: `Chuyển tiền tới ${to.display_name}${input.memo ? `: ${input.memo}` : ''}`,
        minute,
        actorId: u.id,
        lines: [
          { ...acct('user', u.id, 'cash'), amount: -input.amount },
          { ...acct('user', u.id, 'capital'), amount: input.amount },
          { ...acct('user', to.id, 'cash'), amount: input.amount },
          { ...acct('user', to.id, 'capital'), amount: -input.amount },
        ],
      }),
    );
    if (res.created) await notify(ctx.db, to.id, 'finance', 'Nhận chuyển khoản', `${u.display_name} chuyển ${input.amount.toLocaleString('vi-VN')} ₫.`, {}, `transfer:${key}`);
    return { ok: true };
  });

  app.get('/notifications', async (req) => {
    const u = ctx.requireUser(req);
    return many(ctx.db, 'SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [u.id]);
  });
  app.post('/notifications/read-all', async (req) => {
    const u = ctx.requireUser(req);
    await ctx.db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [u.id]);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/notifications/:id/read', async (req) => {
    const u = ctx.requireUser(req);
    await ctx.db.query('UPDATE notifications SET read_at=now() WHERE id=$1 AND user_id=$2', [Number(req.params.id) || 0, u.id]);
    return { ok: true };
  });
}
