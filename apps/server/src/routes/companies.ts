import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import {
  createCompanySchema,
  capitalSchema,
  hireSchema,
  equipmentBuySchema,
  productionSchema,
  listingSchema,
  purchaseSchema,
  campaignSchema,
} from '@startup/shared';
import {
  createCompany,
  injectCapital,
  ownedCompany,
  buyEquipment,
  hire,
  dismiss,
  updateEmployee,
  startProduction,
  cancelProduction,
  setListing,
  purchase,
  launchCampaign,
  balanceSheet,
  many,
  one,
  maybe,
  fail,
  activity,
  nowMinute,
  monthRange,
  ipoEligibility,
  stageProgress,
  creditLimit,
  loansOf,
  quoteFreight,
  transitMinutes,
  cashFlow,
} from '@startup/engine';

const idParam = z.object({ id: z.string().uuid() });

export async function companyRoutes(app: FastifyInstance, ctx: Ctx) {
  const owned = async (userId: string, id: string) => {
    const c = await maybe<{ owner_user_id: string }>(ctx.db, 'SELECT owner_user_id FROM companies WHERE id=$1', [id]);
    if (!c || c.owner_user_id !== userId) fail('not_owner', 'Bạn không quản lý doanh nghiệp này.', 403);
  };

  app.post('/companies', async (req) => {
    const u = ctx.requireUser(req);
    const input = ctx.parse(createCompanySchema, req.body);
    const id = await ctx.mutate((tx, minute) => createCompany(tx, u.id, input, minute));
    return { id };
  });

  /** Owner's full management view of one company. */
  app.get('/companies/:id', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    await owned(u.id, id);
    const minute = await nowMinute(ctx.db);
    const day = Math.floor(minute / 1440);
    const company = await one(
      ctx.db,
      `SELECT c.*, i.name AS industry_name, i.kind AS industry_kind, i.icon, i.open_hour, i.close_hour, i.days_mask, i.tax_rate, l.name AS location_name, l.rent_day, l.traffic
         FROM companies c JOIN industries i ON i.code=c.industry_code JOIN locations l ON l.code=c.location_code WHERE c.id=$1`,
      [id],
    );
    const [staff, equipment, inventory, orders, shipments, listings, campaigns, reports, taxBills, sales] = await Promise.all([
      many(ctx.db, 'SELECT * FROM people WHERE company_id=$1 ORDER BY department, skill DESC', [id]),
      many(ctx.db, 'SELECT e.*, t.name, t.batches_per_hour, t.maintenance_day FROM equipment e JOIN equipment_types t ON t.code=e.type_code WHERE e.company_id=$1 ORDER BY t.name', [id]),
      many(ctx.db, 'SELECT i.*, g.name, g.unit, g.category, g.spoil_per_day FROM inventory i JOIN goods g ON g.code=i.good_code WHERE i.company_id=$1 AND (i.qty > 0 OR i.reserved > 0) ORDER BY g.category, g.name', [id]),
      many(ctx.db, `SELECT o.*, r.name AS recipe_name, r.output_good, r.output_qty FROM production_orders o JOIN recipes r ON r.code=o.recipe_code WHERE o.company_id=$1 ORDER BY o.created_minute DESC LIMIT 30`, [id]),
      many(
        ctx.db,
        `SELECT s.*, g.name AS good_name, g.unit, b.name AS buyer_name, se.name AS seller_name FROM shipments s JOIN goods g ON g.code=s.good_code JOIN companies b ON b.id=s.buyer_company_id JOIN companies se ON se.id=s.seller_company_id
          WHERE s.buyer_company_id=$1 OR s.seller_company_id=$1 ORDER BY s.ordered_minute DESC LIMIT 40`,
        [id],
      ),
      many(ctx.db, 'SELECT l.*, g.name, g.unit, g.ref_price FROM listings l JOIN goods g ON g.code=l.good_code WHERE l.company_id=$1', [id]),
      many(ctx.db, 'SELECT * FROM campaigns WHERE company_id=$1 ORDER BY start_minute DESC LIMIT 20', [id]),
      many(ctx.db, 'SELECT * FROM monthly_reports WHERE company_id=$1 ORDER BY month DESC LIMIT 12', [id]),
      many(ctx.db, 'SELECT * FROM tax_bills WHERE company_id=$1 ORDER BY month DESC LIMIT 12', [id]),
      many(ctx.db, 'SELECT day, SUM(revenue)::bigint AS revenue, SUM(qty)::bigint AS qty, SUM(customers)::bigint AS customers FROM sales_daily WHERE company_id=$1 AND day >= $2 GROUP BY day ORDER BY day', [id, day - 13]),
    ]);
    const currentMonth = Math.floor(day / 7);
    const [from] = monthRange(currentMonth);
    const mtd = await activity(ctx.db, 'company', id, from, minute + 1);
    const sheet = await balanceSheet(ctx.db, id);
    const loans = await loansOf(ctx.db, 'company', id);
    const credit = await creditLimit(ctx.db, { type: 'company', id });
    const ipo = await ipoEligibility(ctx.db, (await one(ctx.db, 'SELECT * FROM companies WHERE id=$1', [id])) as never, minute);
    const instrument = await maybe(ctx.db, 'SELECT * FROM instruments WHERE company_id=$1', [id]);
    const ledger = await many(
      ctx.db,
      `SELECT e.memo, e.kind, e.game_minute, p.amount FROM postings p JOIN accounts a ON a.id=p.account_id JOIN journal_entries e ON e.id=p.entry_id
        WHERE a.owner_type='company' AND a.owner_id=$1 AND a.code='cash' ORDER BY p.id DESC LIMIT 60`,
      [id],
    );
    const cashFlowMtd = await cashFlow(ctx.db, id, from, minute + 1);
    return { company, staff, equipment, inventory, orders, shipments, listings, campaigns, reports, taxBills, sales, monthToDate: mtd, cashFlow: cashFlowMtd, balanceSheet: sheet, loans, credit, ipo, instrument, ledger, minute };
  });

  app.post('/companies/:id/capital', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const { amount } = ctx.parse(capitalSchema, req.body);
    const key = ctx.actionKey(req, `capital:${id}`);
    await ctx.mutate((tx, m) => injectCapital(tx, u.id, id, amount, m, key));
    return { ok: true };
  });

  app.post('/companies/:id/equipment', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(equipmentBuySchema, req.body);
    const key = ctx.actionKey(req, `eq:${id}`);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, id);
      await buyEquipment(tx, u.id, id, input.type, input.count, m, key);
    });
    return { ok: true };
  });

  app.get('/people', async (req) => {
    ctx.requireUser(req);
    const q = z.object({ minSkill: z.coerce.number().int().min(0).max(100).default(0) }).parse(req.query);
    return many(ctx.db, `SELECT id, full_name, age, skill, wage_expectation FROM people WHERE status='seeking' AND skill >= $1 ORDER BY skill DESC LIMIT 60`, [q.minSkill]);
  });

  app.post('/companies/:id/staff', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(hireSchema, req.body);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, id);
      await hire(tx, u.id, id, input.personId, input.wage, input.shift, input.department, m);
    });
    return { ok: true };
  });

  app.patch('/companies/:id/staff/:personId', async (req) => {
    const u = ctx.requireUser(req);
    const { id, personId } = z.object({ id: z.string().uuid(), personId: z.string().uuid() }).parse(req.params);
    const patch = ctx.parse(
      z.object({
        wage: z.number().int().positive().max(1e9).optional(),
        shift: z.enum(['day', 'night', 'part', 'rotating']).optional(),
        department: z.enum(['san_xuat', 'ban_hang', 'kho_van', 'marketing', 'tai_chinh', 'dieu_hanh']).optional(),
        title: z.string().trim().max(40).nullable().optional(),
      }),
      req.body,
    );
    await ctx.mutate(async (tx) => {
      await ownedCompany(tx, u.id, id);
      await updateEmployee(tx, id, personId, patch);
    });
    return { ok: true };
  });

  app.delete('/companies/:id/staff/:personId', async (req) => {
    const u = ctx.requireUser(req);
    const { id, personId } = z.object({ id: z.string().uuid(), personId: z.string().uuid() }).parse(req.params);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, id);
      await dismiss(tx, u.id, id, personId, m);
    });
    return { ok: true };
  });

  app.post('/companies/:id/production', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(productionSchema, req.body);
    const orderId = await ctx.mutate(async (tx, m) => startProduction(tx, await ownedCompany(tx, u.id, id, { requireActive: true }), input.recipe, input.batches, m));
    return { orderId };
  });

  app.delete('/companies/:id/production/:orderId', async (req) => {
    const u = ctx.requireUser(req);
    const { id, orderId } = z.object({ id: z.string().uuid(), orderId: z.string().uuid() }).parse(req.params);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, id);
      await cancelProduction(tx, id, orderId, m);
    });
    return { ok: true };
  });

  app.put('/companies/:id/listings', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(listingSchema, req.body);
    await ctx.mutate(async (tx) => {
      await ownedCompany(tx, u.id, id);
      await setListing(tx, id, input.good, input.price, input.active, input.b2b);
    });
    return { ok: true };
  });

  app.post('/companies/:id/purchases/quote', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(purchaseSchema, req.body);
    await owned(u.id, id);
    const l = await maybe<{ price: number }>(ctx.db, 'SELECT price FROM listings WHERE company_id=$1 AND good_code=$2 AND b2b AND active', [input.sellerCompanyId, input.good]);
    if (!l) return fail('not_listed', 'Nhà cung cấp không chào bán mặt hàng này.');
    const km = await one<{ km: number; same: boolean }>(
      ctx.db,
      `SELECT (a.logistics_km + b.logistics_km) AS km, a.code = b.code AS same FROM companies x JOIN locations a ON a.code=x.location_code, companies y JOIN locations b ON b.code=y.location_code WHERE x.id=$1 AND y.id=$2`,
      [id, input.sellerCompanyId],
    );
    const dist = km.same ? 10 : km.km;
    const goods = l.price * input.qty;
    return { unitPrice: l.price, goods, freight: quoteFreight(goods, dist), etaMinutes: transitMinutes(dist) };
  });

  app.post('/companies/:id/purchases', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(purchaseSchema, req.body);
    const key = ctx.actionKey(req, `purchase:${id}`);
    return ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, id);
      return purchase(tx, u.id, id, input.sellerCompanyId, input.good, input.qty, input.maxUnitPrice, m, key);
    });
  });

  app.post('/companies/:id/campaigns', async (req) => {
    const u = ctx.requireUser(req);
    const { id } = ctx.parse(idParam, req.params);
    const input = ctx.parse(campaignSchema, req.body);
    const key = ctx.actionKey(req, `campaign:${id}`);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, id, { requireActive: true });
      await launchCampaign(tx, u.id, id, input.channel, input.budget, input.days, m, key);
    });
    return { ok: true };
  });

  app.get('/me/stage', async (req) => {
    const u = ctx.requireUser(req);
    return stageProgress(ctx.db, u.id, await nowMinute(ctx.db));
  });
}
