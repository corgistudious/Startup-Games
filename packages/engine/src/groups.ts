import type { Tx, Queryable } from './db';
import { maybe, one, many } from './db';
import { fail } from './errors';
import { post, SYS, balance, type Line } from './ledger';
import { C, U, netAssets, type CompanyRow } from './companies';
import { addInventory } from './production';
import { notify, notifyCompanyOwner } from './notify';
import { audit } from './audit';

// ---------------- Branches ----------------

export const BRANCH = { openingFee: 60_000_000, maxBranches: 5, minStage: 3, trafficShare: 0.6 };

/** A branch is an extra sales outlet: more foot traffic for the company's shop, with its own rent. */
export async function openBranch(tx: Tx, actorId: string, c: CompanyRow, location: string, minute: number, key: string) {
  const stage = (await one<{ stage: number }>(tx, 'SELECT stage FROM users WHERE id=$1', [actorId])).stage;
  if (stage < BRANCH.minStage) fail('stage_locked', 'Mở chi nhánh từ giai đoạn Doanh nghiệp vừa.');
  const kind = (await one<{ kind: string }>(tx, 'SELECT kind FROM industries WHERE code=$1', [c.industry_code])).kind;
  if (kind !== 'manufacturer_retail') fail('not_retail', 'Chỉ doanh nghiệp bán lẻ mới mở chi nhánh bán hàng.');
  if (location === c.location_code) fail('same_location', 'Trụ sở đã ở địa điểm này.');
  const n = (await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM branches WHERE company_id=$1 AND status='active'`, [c.id])).n;
  if (n >= BRANCH.maxBranches) fail('branch_limit', `Tối đa ${BRANCH.maxBranches} chi nhánh.`);
  if (await maybe(tx, `SELECT 1 FROM branches WHERE company_id=$1 AND location_code=$2 AND status='active'`, [c.id, location])) fail('exists', 'Đã có chi nhánh tại địa điểm này.');
  await post(tx, {
    key,
    kind: 'branch_open',
    memo: 'Chi phí mở chi nhánh (cải tạo mặt bằng, giấy phép)',
    minute,
    actorId,
    ref: { type: 'company', id: c.id },
    lines: [
      { ...C(c.id, 'cash'), amount: -BRANCH.openingFee },
      { ...C(c.id, 'fees'), amount: BRANCH.openingFee },
      { ...SYS.households('cash'), amount: BRANCH.openingFee },
      { ...SYS.households('income'), amount: -BRANCH.openingFee },
    ],
  });
  await tx.query('INSERT INTO branches (company_id, location_code, opened_minute) VALUES ($1,$2,$3)', [c.id, location, minute]);
}

export async function closeBranch(tx: Tx, companyId: string, branchId: string, minute: number) {
  const r = await tx.query(`UPDATE branches SET status='closed', closed_minute=$3 WHERE id=$1 AND company_id=$2 AND status='active'`, [branchId, companyId, minute]);
  if (!r.rowCount) fail('not_found', 'Không tìm thấy chi nhánh.', 404);
}

/** Effective traffic multiplier: headquarters plus 60% of each branch location's traffic. */
export async function branchTraffic(q: Queryable): Promise<Map<string, number>> {
  const rows = await many<{ company_id: string; t: number }>(q, `SELECT b.company_id, SUM(l.traffic)::float AS t FROM branches b JOIN locations l ON l.code=b.location_code WHERE b.status='active' GROUP BY b.company_id`);
  return new Map(rows.map((r) => [r.company_id, r.t * BRANCH.trafficShare]));
}

// ---------------- Acquisitions ----------------

export const MNA = { minStage: 4, offerDays: 2, npcPremium: 1.3 };

/** Root owner of a company, following the parent chain. */
async function controller(q: Queryable, companyId: string) {
  return (await one<{ owner_user_id: string | null }>(q, 'SELECT owner_user_id FROM companies WHERE id=$1', [companyId])).owner_user_id;
}

/**
 * Offer to buy 100% of an unlisted company. Rules against self-dealing: the acquirer and
 * target cannot share an owner (moving assets between your own companies goes through
 * normal trade or a merger at book value). Listed companies are taken over on the exchange.
 */
export async function makeOffer(tx: Tx, actorId: string, acquirer: CompanyRow, targetId: string, price: number, note: string, minute: number) {
  const stage = (await one<{ stage: number }>(tx, 'SELECT stage FROM users WHERE id=$1', [actorId])).stage;
  if (stage < MNA.minStage) fail('stage_locked', 'Mua lại doanh nghiệp mở khóa từ giai đoạn Doanh nghiệp lớn.');
  const t = await maybe<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1', [targetId]);
  if (!t) return fail('not_found', 'Không tìm thấy doanh nghiệp mục tiêu.', 404);
  if (t.owner_user_id && t.owner_user_id === acquirer.owner_user_id) fail('self_dealing', 'Không thể chào mua doanh nghiệp do chính bạn sở hữu.');
  if (!['active', 'insolvent'].includes(t.status)) fail('target_inactive', 'Doanh nghiệp mục tiêu không hoạt động.');
  if (await maybe(tx, `SELECT 1 FROM instruments WHERE company_id=$1 AND status <> 'delisted'`, [t.id])) fail('listed', 'Doanh nghiệp đã niêm yết: hãy mua cổ phiếu trên sàn (nắm trên 50% là nắm quyền kiểm soát).');
  if (t.id === acquirer.parent_company_id) fail('circular', 'Không thể mua lại công ty mẹ của chính mình.');
  const o = await one<{ id: string }>(
    tx,
    `INSERT INTO acquisition_offers (acquirer_company_id, target_company_id, price, note, created_minute, expires_minute) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [acquirer.id, t.id, price, note, minute, minute + MNA.offerDays * 1440],
  );
  await audit(tx, actorId, 'mna.offer', 'company', t.id, { acquirer: acquirer.id, price });
  if (t.is_npc) {
    const na = await netAssets(tx, t.id);
    const fair = Math.max(na.equity, 0) * MNA.npcPremium;
    await respondOffer(tx, null, o.id, price >= fair, minute, price >= fair ? undefined : `Giá thấp hơn ${Math.round(fair).toLocaleString('vi-VN')} ₫ (130% giá trị sổ sách)`);
  } else if (t.owner_user_id) {
    await notify(tx, t.owner_user_id, 'mna', `Đề nghị mua lại ${t.name}`, `${acquirer.name} đề nghị mua toàn bộ doanh nghiệp với giá ${price.toLocaleString('vi-VN')} ₫. Hiệu lực ${MNA.offerDays} ngày game.`, { offerId: o.id });
  }
  return o.id;
}

export async function respondOffer(tx: Tx, actorId: string | null, offerId: string, accept: boolean, minute: number, reason?: string) {
  const o = await maybe<{ id: string; acquirer_company_id: string; target_company_id: string; price: number; status: string; expires_minute: number }>(tx, 'SELECT * FROM acquisition_offers WHERE id=$1 FOR UPDATE', [offerId]);
  if (!o || o.status !== 'pending') return fail('not_pending', 'Đề nghị không còn hiệu lực.');
  const t = await one<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [o.target_company_id]);
  if (actorId !== null && t.owner_user_id !== actorId) fail('not_owner', 'Chỉ chủ doanh nghiệp mục tiêu được trả lời.', 403);
  if (minute > o.expires_minute) {
    await tx.query(`UPDATE acquisition_offers SET status='expired', decided_at=now() WHERE id=$1`, [o.id]);
    return fail('expired', 'Đề nghị đã hết hạn.');
  }
  if (!accept) {
    await tx.query(`UPDATE acquisition_offers SET status='rejected', decided_at=now() WHERE id=$1`, [o.id]);
    await notifyCompanyOwner(tx, o.acquirer_company_id, 'mna', `Đề nghị mua ${t.name} bị từ chối`, reason ?? '');
    return;
  }
  const a = await one<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [o.acquirer_company_id]);
  if ((await balance(tx, C(a.id, 'cash'))) < o.price) fail('insufficient_funds', 'Bên mua không đủ tiền mặt để hoàn tất thương vụ.');
  const lines: Line[] = [
    { ...C(a.id, 'cash'), amount: -o.price },
    { ...C(a.id, 'investments'), amount: o.price },
  ];
  if (t.owner_user_id) {
    // Seller's cost basis = capital they contributed to this company.
    const cost = Math.max(0, -(await balance(tx, C(t.id, 'share_capital'))));
    const userInv = await balance(tx, U(t.owner_user_id, 'investments'));
    const costOut = Math.min(cost, Math.max(0, userInv));
    lines.push(
      { ...U(t.owner_user_id, 'cash'), amount: o.price },
      { ...U(t.owner_user_id, 'investments'), amount: -costOut },
      { ...U(t.owner_user_id, 'trading_gain'), amount: -(o.price - costOut) },
    );
  } else {
    // NPC founders are domestic investors funded by the central bank: the purchase price retires that money.
    lines.push({ ...SYS.centralBank('currency_issued'), amount: o.price }, { ...SYS.centralBank('policy_expense'), amount: -o.price });
  }
  await post(tx, { key: `mna:${o.id}`, kind: 'acquisition', memo: `Mua lại toàn bộ ${t.name}`, minute, actorId, ref: { type: 'company', id: t.id }, lines });
  await transferControl(tx, t, a.owner_user_id, a.id, 'acquisition', minute, { offerId: o.id, price: o.price });
  await tx.query(`UPDATE companies SET is_npc=false WHERE id=$1`, [t.id]);
  await tx.query(`UPDATE acquisition_offers SET status='accepted', decided_at=now() WHERE id=$1`, [o.id]);
  await tx.query(`UPDATE acquisition_offers SET status='cancelled', decided_at=now() WHERE target_company_id=$1 AND status='pending'`, [t.id]);
  await notifyCompanyOwner(tx, a.id, 'mna', `Hoàn tất mua lại ${t.name}`, `${t.name} trở thành công ty con.`);
}

export async function transferControl(tx: Tx, t: CompanyRow, newOwner: string | null, parentId: string | null, kind: string, minute: number, detail: Record<string, unknown> = {}) {
  if (t.owner_user_id === newOwner && t.parent_company_id === parentId) return;
  await tx.query('UPDATE companies SET owner_user_id=$2, parent_company_id=$3 WHERE id=$1', [t.id, newOwner, parentId]);
  await tx.query('INSERT INTO ownership_events (company_id, kind, from_owner, to_owner, parent_company_id, detail, game_minute) VALUES ($1,$2,$3,$4,$5,$6,$7)', [t.id, kind, t.owner_user_id, newOwner, parentId, detail, minute]);
  if (t.owner_user_id && t.owner_user_id !== newOwner) await notify(tx, t.owner_user_id, 'mna', `Mất quyền kiểm soát ${t.name}`, kind === 'share_control' ? 'Một cổ đông khác đã nắm trên 50% cổ phần.' : 'Doanh nghiệp đã được chuyển nhượng.', { companyId: t.id });
}

/**
 * Control follows the shares of a listed company: whoever holds more than 50% controls it.
 * A company holder becomes the parent; a person holder becomes the direct owner.
 */
export async function reviewShareControl(tx: Tx, symbol: string, minute: number) {
  const ins = await one<{ company_id: string; shares_total: number }>(tx, 'SELECT i.company_id, c.shares_total FROM instruments i JOIN companies c ON c.id=i.company_id WHERE i.symbol=$1', [symbol]);
  const top = await maybe<{ holder_type: 'user' | 'company'; holder_id: string; qty: number }>(
    tx,
    `SELECT holder_type, holder_id, qty FROM holdings WHERE symbol=$1 AND NOT (holder_type='company' AND holder_id=$2) ORDER BY qty DESC LIMIT 1`,
    [symbol, ins.company_id],
  );
  if (!top || top.qty * 2 <= ins.shares_total) return;
  const t = await one<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [ins.company_id]);
  if (top.holder_type === 'user') return transferControl(tx, t, top.holder_id, null, 'share_control', minute, { symbol, qty: top.qty });
  if (top.holder_id === t.id) return;
  await transferControl(tx, t, await controller(tx, top.holder_id), top.holder_id, 'share_control', minute, { symbol, qty: top.qty });
}

// ---------------- Merger ----------------

/**
 * Absorb a 100%-owned unlisted subsidiary into its parent at book value. Every asset and
 * liability balance moves to the parent; the difference between the subsidiary's net assets
 * and the parent's investment cost is booked to the parent's equity (merger reserve).
 * Staff, stock, equipment and loans move too. Requires no goods in transit or production running.
 */
export async function mergeSubsidiary(tx: Tx, actorId: string, parent: CompanyRow, subId: string, minute: number) {
  const sub = await maybe<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [subId]);
  if (!sub || sub.parent_company_id !== parent.id) return fail('not_subsidiary', 'Chỉ sáp nhập được công ty con trực tiếp.');
  if (await maybe(tx, `SELECT 1 FROM instruments WHERE company_id=$1 AND status <> 'delisted'`, [sub.id])) fail('listed', 'Công ty con đang niêm yết: cần hủy niêm yết trước khi sáp nhập.');
  if (await maybe(tx, `SELECT 1 FROM shipments WHERE (buyer_company_id=$1 OR seller_company_id=$1) AND status='in_transit'`, [sub.id])) fail('in_transit', 'Còn lô hàng đang vận chuyển.');
  if (await maybe(tx, `SELECT 1 FROM production_orders WHERE company_id=$1 AND status='running'`, [sub.id])) fail('producing', 'Còn lệnh sản xuất đang chạy.');
  if (await maybe(tx, `SELECT 1 FROM supply_contracts WHERE (buyer_company_id=$1 OR seller_company_id=$1) AND status IN ('proposed','active')`, [sub.id])) fail('contracts', 'Còn hợp đồng cung ứng đang hiệu lực.');
  if (await maybe(tx, `SELECT 1 FROM orders WHERE owner_type='company' AND owner_id=$1 AND status='open'`, [sub.id])) fail('orders', 'Còn lệnh chứng khoán đang chờ khớp.');

  const balances = await many<{ code: string; kind: string; balance: number }>(tx, `SELECT code, kind, balance FROM accounts WHERE owner_type='company' AND owner_id=$1 AND kind IN ('asset','liability') AND balance <> 0`, [sub.id]);
  const net = balances.reduce((s, b) => s + b.balance, 0); // assets − liabilities (debit-positive)
  const parentCost = Math.min(Math.max(0, await balance(tx, C(parent.id, 'investments'))), Math.max(0, net));
  const lines: Line[] = [];
  for (const b of balances) lines.push({ ...C(sub.id, b.code), amount: -b.balance }, { ...C(parent.id, b.code), amount: b.balance });
  lines.push({ ...C(sub.id, 'capital'), amount: net });
  if (parentCost) lines.push({ ...C(parent.id, 'investments'), amount: -parentCost });
  lines.push({ ...C(parent.id, 'capital'), amount: -(net - parentCost) });
  if (lines.length > 2) await post(tx, { key: `merge:${sub.id}`, kind: 'merger', memo: `Sáp nhập ${sub.name} vào ${parent.name}`, minute, actorId, ref: { type: 'company', id: sub.id }, lines });

  const inv = await many<{ good_code: string; qty: number; value: number }>(tx, 'SELECT good_code, qty, value FROM inventory WHERE company_id=$1 AND qty > 0', [sub.id]);
  for (const i of inv) await addInventory(tx, parent.id, i.good_code, i.qty, i.value);
  await tx.query('UPDATE inventory SET qty=0, reserved=0, value=0 WHERE company_id=$1', [sub.id]);
  await tx.query('UPDATE people SET company_id=$2 WHERE company_id=$1', [sub.id, parent.id]);
  await tx.query('UPDATE equipment SET company_id=$2 WHERE company_id=$1', [sub.id, parent.id]);
  await tx.query(`UPDATE loans SET borrower_id=$2 WHERE borrower_type='company' AND borrower_id=$1`, [sub.id, parent.id]);
  await tx.query(`UPDATE deposits SET owner_id=$2 WHERE owner_type='company' AND owner_id=$1`, [sub.id, parent.id]);
  await tx.query('UPDATE listings SET active=false WHERE company_id=$1', [sub.id]);
  await tx.query(`UPDATE branches SET status='closed', closed_minute=$2 WHERE company_id=$1 AND status='active'`, [sub.id, minute]);
  await tx.query(`UPDATE companies SET status='closed' WHERE id=$1`, [sub.id]);
  await tx.query('INSERT INTO ownership_events (company_id, kind, from_owner, to_owner, parent_company_id, detail, game_minute) VALUES ($1,$2,$3,$3,$4,$5,$6)', [sub.id, 'merger', parent.owner_user_id, parent.id, { net, parentCost }, minute]);
  await audit(tx, actorId, 'mna.merge', 'company', sub.id, { parent: parent.id, net });
  return { net };
}

export async function groupOf(q: Queryable, companyId: string) {
  const subsidiaries = await many(
    q,
    `SELECT c.id, c.name, c.slug, c.status, i.name AS industry, (SELECT balance FROM accounts a WHERE a.owner_type='company' AND a.owner_id=c.id::text AND a.code='cash') AS cash,
            (SELECT count(*)::int FROM people p WHERE p.company_id=c.id) AS employees
       FROM companies c JOIN industries i ON i.code=c.industry_code WHERE c.parent_company_id=$1 AND c.status <> 'closed'`,
    [companyId],
  );
  const branches = await many(q, `SELECT b.*, l.name AS location_name, l.rent_day, l.traffic FROM branches b JOIN locations l ON l.code=b.location_code WHERE b.company_id=$1 AND b.status='active'`, [companyId]);
  const offers = await many(
    q,
    `SELECT o.*, a.name AS acquirer_name, t.name AS target_name FROM acquisition_offers o JOIN companies a ON a.id=o.acquirer_company_id JOIN companies t ON t.id=o.target_company_id
      WHERE o.acquirer_company_id=$1 OR o.target_company_id=$1 ORDER BY o.created_at DESC LIMIT 30`,
    [companyId],
  );
  const parent = await maybe(q, `SELECT p.id, p.name, p.slug FROM companies c JOIN companies p ON p.id=c.parent_company_id WHERE c.id=$1`, [companyId]);
  let consolidatedEquity = (await netAssets(q, companyId)).equity;
  for (const s of subsidiaries) consolidatedEquity += (await netAssets(q, s.id as string)).equity;
  return { parent, subsidiaries, branches, offers, consolidatedEquity };
}

/** Expire stale offers (daily). */
export async function expireOffers(tx: Tx, minute: number) {
  await tx.query(`UPDATE acquisition_offers SET status='expired', decided_at=now() WHERE status='pending' AND expires_minute < $1`, [minute]);
}
