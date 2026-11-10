import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import { collateralLoanSchema, repaySchema, ipoSchema, orderSchema, dividendSchema } from '@startup/shared';
import { takeLoan, repayLoan, creditLimit, loansOf, ownedCompany, ipo, placeOrder, cancelOrder, payDividend, orderBook, many, one, maybe, fail, ECON } from '@startup/engine';

const borrowerQuery = z.object({ companyId: z.string().uuid().optional() });

export async function financeRoutes(app: FastifyInstance, ctx: Ctx) {
  const asOwner = async (userId: string, companyId?: string) => {
    if (!companyId) return { type: 'user' as const, id: userId };
    const c = await maybe<{ owner_user_id: string }>(ctx.db, 'SELECT owner_user_id FROM companies WHERE id=$1', [companyId]);
    if (!c || c.owner_user_id !== userId) fail('not_owner', 'Bạn không quản lý doanh nghiệp này.', 403);
    return { type: 'company' as const, id: companyId };
  };

  // ---------------- Bank ----------------
  app.get('/bank', async (req) => {
    const u = ctx.requireUser(req);
    const { companyId } = borrowerQuery.parse(req.query);
    const b = await asOwner(u.id, companyId);
    return { rateDailyBp: ECON.loanRateDailyBp, credit: await creditLimit(ctx.db, b), loans: await loansOf(ctx.db, b.type, b.id) };
  });

  app.post('/bank/loans', async (req) => {
    const u = ctx.requireUser(req);
    const { companyId } = borrowerQuery.parse(req.query);
    const input = ctx.parse(collateralLoanSchema, req.body);
    const b = await asOwner(u.id, companyId);
    const key = ctx.actionKey(req, `loan:${b.id}`);
    const id = await ctx.mutate((tx, m) => takeLoan(tx, u.id, b, input.amount, input.termDays, m, key, { equipmentIds: input.equipmentIds }));
    return { id };
  });

  app.post('/bank/loans/:id/repay', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { amount } = ctx.parse(repaySchema, req.body);
    const mine = new Set((await many<{ id: string }>(ctx.db, 'SELECT id::text FROM companies WHERE owner_user_id=$1', [u.id])).map((r) => r.id));
    const key = ctx.actionKey(req, `repay:${id}`);
    await ctx.mutate((tx, m) => repayLoan(tx, (l) => (l.borrower_type === 'user' ? l.borrower_id === u.id : mine.has(l.borrower_id)), id, amount, m, key));
    return { ok: true };
  });

  // ---------------- Exchange ----------------
  app.get('/exchange', async () => {
    return many(
      ctx.db,
      `SELECT i.symbol, i.status, i.ipo_price, i.last_price, i.halt_reason, c.name, c.slug, c.id AS company_id, c.shares_total, ind.name AS industry,
              (SELECT price FROM trades t WHERE t.symbol=i.symbol AND t.created_at < now() - interval '48 minutes' ORDER BY t.id DESC LIMIT 1) AS prev_price,
              (SELECT COALESCE(SUM(qty),0)::bigint FROM trades t WHERE t.symbol=i.symbol AND t.created_at > now() - interval '48 minutes') AS volume_day
         FROM instruments i JOIN companies c ON c.id=i.company_id JOIN industries ind ON ind.code=c.industry_code ORDER BY i.symbol`,
    );
  });

  app.get('/exchange/:symbol', async (req) => {
    const { symbol } = z.object({ symbol: z.string().regex(/^[A-Z]{3,5}$/) }).parse(req.params);
    const ins = await maybe(ctx.db, `SELECT i.*, c.name, c.slug, c.shares_total, c.id AS company_id FROM instruments i JOIN companies c ON c.id=i.company_id WHERE i.symbol=$1`, [symbol]);
    if (!ins) return fail('no_symbol', 'Mã chứng khoán không tồn tại.', 404);
    const [book, trades, disclosures, dividends, holders] = await Promise.all([
      orderBook(ctx.db, symbol),
      many(ctx.db, 'SELECT price, qty, game_minute, created_at FROM trades WHERE symbol=$1 ORDER BY id DESC LIMIT 200', [symbol]),
      many(ctx.db, 'SELECT * FROM disclosures WHERE symbol=$1 ORDER BY id DESC LIMIT 20', [symbol]),
      many(ctx.db, 'SELECT * FROM dividends WHERE symbol=$1 ORDER BY created_at DESC LIMIT 20', [symbol]),
      many(
        ctx.db,
        `SELECT h.holder_type, CASE WHEN h.holder_type='user' THEN u.display_name ELSE c.name END AS name, h.qty FROM holdings h LEFT JOIN users u ON h.holder_type='user' AND u.id::text=h.holder_id
           LEFT JOIN companies c ON h.holder_type='company' AND c.id::text=h.holder_id WHERE h.symbol=$1 AND h.qty > 0 ORDER BY h.qty DESC LIMIT 10`,
        [symbol],
      ),
    ]);
    return { instrument: ins, book, trades, disclosures, dividends, holders };
  });

  app.get('/exchange/me/portfolio', async (req) => {
    const u = ctx.requireUser(req);
    const { companyId } = borrowerQuery.parse(req.query);
    const o = await asOwner(u.id, companyId);
    const holdings = await many(ctx.db, `SELECT h.*, i.last_price, c.name FROM holdings h JOIN instruments i ON i.symbol=h.symbol JOIN companies c ON c.id=i.company_id WHERE h.holder_type=$1 AND h.holder_id=$2 AND h.qty > 0`, [o.type, o.id]);
    const orders = await many(ctx.db, `SELECT * FROM orders WHERE owner_type=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 50`, [o.type, o.id]);
    const cash = await one<{ cash: number; locked: number }>(
      ctx.db,
      `SELECT COALESCE((SELECT balance FROM accounts WHERE owner_type=$1 AND owner_id=$2 AND code='cash'),0)::bigint AS cash, COALESCE((SELECT balance FROM accounts WHERE owner_type=$1 AND owner_id=$2 AND code='cash_locked'),0)::bigint AS locked`,
      [o.type, o.id],
    );
    return { holdings, orders, ...cash };
  });

  app.post('/exchange/orders', async (req) => {
    const u = ctx.requireUser(req);
    const { companyId } = borrowerQuery.parse(req.query);
    const input = ctx.parse(orderSchema, req.body);
    const o = await asOwner(u.id, companyId);
    return ctx.mutate((tx, m) => placeOrder(tx, o, input, m));
  });

  app.delete('/exchange/orders/:id', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const order = await maybe<{ owner_type: 'user' | 'company'; owner_id: string }>(ctx.db, 'SELECT owner_type, owner_id FROM orders WHERE id=$1', [id]);
    if (!order) return fail('not_found', 'Không tìm thấy lệnh.', 404);
    const owner = await asOwner(u.id, order.owner_type === 'company' ? order.owner_id : undefined);
    await ctx.mutate((tx, m) => cancelOrder(tx, owner, id, m));
    return { ok: true };
  });

  app.post('/companies/:id/ipo', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = ctx.parse(ipoSchema, req.body);
    await ctx.mutate(async (tx, m) => ipo(tx, u.id, await ownedCompany(tx, u.id, id, { requireActive: true }), input, m));
    return { ok: true };
  });

  app.post('/companies/:id/dividends', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { perShare } = ctx.parse(dividendSchema, req.body);
    const key = ctx.actionKey(req, `dividend:${id}`);
    const total = await ctx.mutate(async (tx, m) => payDividend(tx, u.id, await ownedCompany(tx, u.id, id, { requireActive: true }), perShare, m, key));
    return { total };
  });
}
