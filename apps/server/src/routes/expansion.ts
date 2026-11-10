import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../app.js';
import {
  bonusSchema,
  hrPolicySchema,
  leaveSchema,
  contractProposalSchema,
  inspectSchema,
  disputeDecisionSchema,
  branchSchema,
  offerSchema,
  depositSchema,
  delistSchema,
  alertDecisionSchema,
  reasonSchema,
} from '@startup/shared';
import {
  ownedCompany,
  payBonus,
  setHrPolicies,
  grantLeave,
  proposeContract,
  acceptContract,
  rejectContract,
  cancelContract,
  inspectDelivery,
  resolveDispute,
  contractsOf,
  openBranch,
  closeBranch,
  makeOffer,
  respondOffer,
  mergeSubsidiary,
  groupOf,
  openDeposit,
  withdrawDeposit,
  depositsOf,
  voluntaryDelist,
  forceDelist,
  resolveAlert,
  many,
  maybe,
  fail,
  withTx,
  nowMinute,
  BENEFITS,
  ANNUAL_LEAVE_DAYS,
  DEPOSIT_RATES,
  BRANCH,
} from '@startup/engine';

const id = z.object({ id: z.string().uuid() });

export async function expansionRoutes(app: FastifyInstance, ctx: Ctx) {
  const ownerOf = async (userId: string, companyId: string) => {
    const c = await maybe<{ owner_user_id: string }>(ctx.db, 'SELECT owner_user_id FROM companies WHERE id=$1', [companyId]);
    if (!c || c.owner_user_id !== userId) fail('not_owner', 'Bạn không quản lý doanh nghiệp này.', 403);
  };

  app.get('/rules/expansion', async () => ({ benefits: BENEFITS, annualLeaveDays: ANNUAL_LEAVE_DAYS, depositRates: DEPOSIT_RATES, branch: BRANCH }));

  // ---------------- HR ----------------
  app.post('/companies/:id/bonus', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    const input = ctx.parse(bonusSchema, req.body);
    const key = ctx.actionKey(req, `bonus:${cid}`);
    const total = await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, cid);
      return payBonus(tx, u.id, cid, input.personIds, input.amountEach, m, key);
    });
    return { total };
  });

  app.put('/companies/:id/hr-policy', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    const input = ctx.parse(hrPolicySchema, req.body);
    await ctx.mutate(async (tx) => {
      await ownedCompany(tx, u.id, cid);
      await setHrPolicies(tx, cid, input);
    });
    return { ok: true };
  });

  app.post('/companies/:id/staff/:personId/leave', async (req) => {
    const u = ctx.requireUser(req);
    const p = z.object({ id: z.string().uuid(), personId: z.string().uuid() }).parse(req.params);
    const { days } = ctx.parse(leaveSchema, req.body);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, p.id);
      await grantLeave(tx, p.id, p.personId, days, m);
    });
    return { ok: true };
  });

  // ---------------- Contracts ----------------
  app.get('/companies/:id/contracts', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    await ownerOf(u.id, cid);
    return contractsOf(ctx.db, cid);
  });

  app.post('/companies/:id/contracts', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    const input = ctx.parse(contractProposalSchema, req.body);
    const contractId = await ctx.mutate(async (tx, m) => {
      // Buying is allowed while the licence is pending, as with spot purchases.
      const c = await ownedCompany(tx, u.id, cid);
      if (!['licensing', 'active', 'insolvent'].includes(c.status)) fail('not_active', 'Doanh nghiệp không còn hoạt động.');
      return proposeContract(tx, u.id, cid, input, m);
    });
    return { id: contractId };
  });

  const contractSide = async (userId: string, contractId: string) => {
    const k = await maybe<{ buyer_owner: string; seller_owner: string | null }>(
      ctx.db,
      `SELECT b.owner_user_id AS buyer_owner, s.owner_user_id AS seller_owner FROM supply_contracts k JOIN companies b ON b.id=k.buyer_company_id JOIN companies s ON s.id=k.seller_company_id WHERE k.id=$1`,
      [contractId],
    );
    if (!k) return fail('not_found', 'Không tìm thấy hợp đồng.', 404);
    if (k.seller_owner === userId) return 'seller' as const;
    if (k.buyer_owner === userId) return 'buyer' as const;
    return fail('not_party', 'Bạn không phải một bên của hợp đồng.', 403);
  };

  app.post('/contracts/:id/accept', async (req) => {
    const u = ctx.requireUser(req);
    const { id: kid } = id.parse(req.params);
    if ((await contractSide(u.id, kid)) !== 'seller') fail('seller_only', 'Chỉ bên bán ký chấp nhận hợp đồng.', 403);
    await ctx.mutate((tx, m) => acceptContract(tx, u.id, kid, m));
    return { ok: true };
  });

  app.post('/contracts/:id/reject', async (req) => {
    const u = ctx.requireUser(req);
    const { id: kid } = id.parse(req.params);
    if ((await contractSide(u.id, kid)) !== 'seller') fail('seller_only', 'Chỉ bên bán được từ chối.', 403);
    const { reason } = ctx.parse(reasonSchema, req.body);
    await withTx(ctx.db, (tx) => rejectContract(tx, u.id, kid, reason));
    return { ok: true };
  });

  app.post('/contracts/:id/cancel', async (req) => {
    const u = ctx.requireUser(req);
    const { id: kid } = id.parse(req.params);
    const side = await contractSide(u.id, kid);
    await ctx.mutate((tx, m) => cancelContract(tx, u.id, kid, side, m));
    return { ok: true };
  });

  app.post('/contract-deliveries/:id/inspect', async (req) => {
    const u = ctx.requireUser(req);
    const { id: did } = id.parse(req.params);
    const input = ctx.parse(inspectSchema, req.body);
    await withTx(ctx.db, (tx) => inspectDelivery(tx, u.id, did, input.accept, input.reason ?? null));
    return { ok: true };
  });

  app.get('/admin/disputes', async (req) => {
    ctx.requireAdmin(req);
    return many(
      ctx.db,
      `SELECT d.*, k.good_code, k.unit_price, k.qty_per_delivery, b.name AS buyer_name, s.name AS seller_name, g.name AS good_name
         FROM contract_deliveries d JOIN supply_contracts k ON k.id=d.contract_id JOIN companies b ON b.id=k.buyer_company_id JOIN companies s ON s.id=k.seller_company_id JOIN goods g ON g.code=k.good_code
        WHERE d.status IN ('disputed','resolved') ORDER BY d.status='disputed' DESC, d.created_minute DESC LIMIT 100`,
    );
  });

  app.post('/admin/disputes/:id/resolve', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id: did } = id.parse(req.params);
    const input = ctx.parse(disputeDecisionSchema, req.body);
    await ctx.mutate((tx, m) => resolveDispute(tx, admin.id, did, input.refundRate, input.resolution, m));
    return { ok: true };
  });

  // ---------------- Group, branches, M&A ----------------
  app.get('/companies/:id/group', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    await ownerOf(u.id, cid);
    return groupOf(ctx.db, cid);
  });

  app.post('/companies/:id/branches', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    const { location } = ctx.parse(branchSchema, req.body);
    const key = ctx.actionKey(req, `branch:${cid}`);
    await ctx.mutate(async (tx, m) => openBranch(tx, u.id, await ownedCompany(tx, u.id, cid, { requireActive: true }), location, m, key));
    return { ok: true };
  });

  app.delete('/companies/:id/branches/:branchId', async (req) => {
    const u = ctx.requireUser(req);
    const p = z.object({ id: z.string().uuid(), branchId: z.string().uuid() }).parse(req.params);
    await ctx.mutate(async (tx, m) => {
      await ownedCompany(tx, u.id, p.id);
      await closeBranch(tx, p.id, p.branchId, m);
    });
    return { ok: true };
  });

  app.get('/mna/targets', async (req) => {
    const u = ctx.requireUser(req);
    return many(
      ctx.db,
      `SELECT c.id, c.name, c.slug, c.is_npc, i.name AS industry, u.display_name AS owner,
              (SELECT balance FROM accounts a WHERE a.owner_type='company' AND a.owner_id=c.id::text AND a.code='cash') AS cash
         FROM companies c JOIN industries i ON i.code=c.industry_code LEFT JOIN users u ON u.id=c.owner_user_id
        WHERE c.status IN ('active','insolvent') AND (c.owner_user_id IS NULL OR c.owner_user_id <> $1)
          AND NOT EXISTS (SELECT 1 FROM instruments ins WHERE ins.company_id=c.id AND ins.status <> 'delisted')
        ORDER BY c.is_npc, c.name LIMIT 100`,
      [u.id],
    );
  });

  app.post('/companies/:id/offers', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    const input = ctx.parse(offerSchema, req.body);
    const offerId = await ctx.mutate(async (tx, m) => makeOffer(tx, u.id, await ownedCompany(tx, u.id, cid, { requireActive: true }), input.targetCompanyId, input.price, input.note, m));
    return { id: offerId };
  });

  app.post('/offers/:id/respond', async (req) => {
    const u = ctx.requireUser(req);
    const { id: oid } = id.parse(req.params);
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    await ctx.mutate((tx, m) => respondOffer(tx, u.id, oid, accept, m));
    return { ok: true };
  });

  app.post('/offers/:id/cancel', async (req) => {
    const u = ctx.requireUser(req);
    const { id: oid } = id.parse(req.params);
    const r = await ctx.db.query(
      `UPDATE acquisition_offers o SET status='cancelled', decided_at=now() FROM companies c WHERE o.id=$1 AND o.status='pending' AND c.id=o.acquirer_company_id AND c.owner_user_id=$2`,
      [oid, u.id],
    );
    if (!r.rowCount) fail('not_found', 'Không tìm thấy đề nghị đang chờ của bạn.', 404);
    return { ok: true };
  });

  app.post('/companies/:id/merge/:subId', async (req) => {
    const u = ctx.requireUser(req);
    const p = z.object({ id: z.string().uuid(), subId: z.string().uuid() }).parse(req.params);
    return ctx.mutate(async (tx, m) => mergeSubsidiary(tx, u.id, await ownedCompany(tx, u.id, p.id), p.subId, m));
  });

  // ---------------- Deposits ----------------
  const depositor = async (userId: string, companyId?: string) => {
    if (!companyId) return { type: 'user' as const, id: userId };
    await ownerOf(userId, companyId);
    return { type: 'company' as const, id: companyId };
  };

  app.get('/bank/deposits', async (req) => {
    const u = ctx.requireUser(req);
    const { companyId } = z.object({ companyId: z.string().uuid().optional() }).parse(req.query);
    const o = await depositor(u.id, companyId);
    return { rates: DEPOSIT_RATES, deposits: await depositsOf(ctx.db, o.type, o.id), minute: await nowMinute(ctx.db) };
  });

  app.post('/bank/deposits', async (req) => {
    const u = ctx.requireUser(req);
    const { companyId } = z.object({ companyId: z.string().uuid().optional() }).parse(req.query);
    const input = ctx.parse(depositSchema, req.body);
    const o = await depositor(u.id, companyId);
    const key = ctx.actionKey(req, `deposit:${o.id}`);
    return { id: await ctx.mutate((tx, m) => openDeposit(tx, u.id, o, input.amount, input.termDays, m, key)) };
  });

  app.post('/bank/deposits/:id/withdraw', async (req) => {
    const u = ctx.requireUser(req);
    const { id: did } = id.parse(req.params);
    const mine = new Set((await many<{ id: string }>(ctx.db, 'SELECT id::text FROM companies WHERE owner_user_id=$1', [u.id])).map((r) => r.id));
    return ctx.mutate((tx, m) => withdrawDeposit(tx, (d) => (d.owner_type === 'user' ? d.owner_id === u.id : mine.has(d.owner_id)), did, m));
  });

  // ---------------- Delisting & surveillance ----------------
  app.post('/companies/:id/delist', async (req) => {
    const u = ctx.requireUser(req);
    const { id: cid } = id.parse(req.params);
    const { price } = ctx.parse(delistSchema, req.body);
    const total = await ctx.mutate(async (tx, m) => voluntaryDelist(tx, u.id, await ownedCompany(tx, u.id, cid), price, m));
    return { total };
  });

  app.get('/admin/surveillance', async (req) => {
    ctx.requireAdmin(req);
    return many(ctx.db, `SELECT * FROM surveillance_alerts ORDER BY status='open' DESC, id DESC LIMIT 100`);
  });

  app.post('/admin/surveillance/:id/resolve', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { id: aid } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const input = ctx.parse(alertDecisionSchema, req.body);
    await ctx.mutate((tx, m) => resolveAlert(tx, admin.id, aid, input.resolution, input.resume, m));
    return { ok: true };
  });

  app.post('/admin/exchange/:symbol/delist', async (req) => {
    const admin = ctx.requireAdmin(req);
    const { symbol } = z.object({ symbol: z.string().regex(/^[A-Z]{3,5}$/) }).parse(req.params);
    const { reason } = ctx.parse(reasonSchema, req.body);
    await ctx.mutate((tx, m) => forceDelist(tx, admin.id, symbol, reason, m));
    return { ok: true };
  });
}
