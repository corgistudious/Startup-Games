import type { Tx, Queryable } from './db';
import { one, maybe, many } from './db';
import { fail } from './errors';
import { post, acct, SYS, balances, type AccountRef } from './ledger';
import { audit } from './audit';
import { notify } from './notify';
import { CHANNEL_RULES } from './config';

export const C = (companyId: string, code: string): AccountRef => acct('company', companyId, code);
export const U = (userId: string, code: string): AccountRef => acct('user', userId, code);

export type CompanyRow = {
  id: string;
  owner_user_id: string | null;
  is_npc: boolean;
  name: string;
  slug: string;
  industry_code: string;
  location_code: string;
  status: string;
  license_ready_at: number;
  founded_minute: number;
  reputation: number;
  brand: number;
  shares_total: number;
  insolvent_days: number;
};

export function slugify(name: string) {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 50) || 'doanh-nghiep'
  );
}

/** Max companies a player may own at each development stage. */
export const companyLimit = (stage: number) => [0, 1, 1, 2, 3, 6][stage] ?? 1;

/** Load a company the user controls, locking it for the rest of the transaction. */
export async function ownedCompany(tx: Tx, userId: string, companyId: string, opts: { requireActive?: boolean } = {}): Promise<CompanyRow> {
  const c = await maybe<CompanyRow>(tx, 'SELECT * FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
  if (!c || c.owner_user_id !== userId) return fail('not_owner', 'Bạn không quản lý doanh nghiệp này.', 403);
  if (opts.requireActive && !['active', 'insolvent'].includes(c.status)) {
    fail('not_active', c.status === 'licensing' ? 'Doanh nghiệp đang chờ cấp giấy phép.' : 'Doanh nghiệp không còn hoạt động.');
  }
  return c;
}

export async function createCompany(
  tx: Tx,
  userId: string,
  input: { name: string; industry: string; location: string; capital: number; description?: string },
  minute: number,
) {
  const user = await one<{ stage: number }>(tx, 'SELECT stage FROM users WHERE id = $1 FOR UPDATE', [userId]);
  const owned = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM companies WHERE owner_user_id = $1 AND status NOT IN ('bankrupt','closed')`, [userId]);
  if (owned.n >= companyLimit(user.stage)) {
    fail('company_limit', `Giai đoạn hiện tại cho phép tối đa ${companyLimit(user.stage)} doanh nghiệp. Phát triển doanh nghiệp hiện có để mở rộng.`);
  }
  const ind = await maybe<{ code: string; name: string; register_fee: number; min_capital: number; license_hours: number }>(tx, 'SELECT * FROM industries WHERE code = $1', [input.industry]);
  if (!ind) return fail('bad_industry', 'Ngành nghề không tồn tại.');
  const loc = await maybe(tx, 'SELECT code FROM locations WHERE code = $1', [input.location]);
  if (!loc) fail('bad_location', 'Địa điểm không tồn tại.');
  if (input.capital < ind.min_capital) fail('low_capital', `Ngành ${ind.name} cần vốn điều lệ tối thiểu ${ind.min_capital.toLocaleString('vi-VN')} ₫.`);
  if (await maybe(tx, 'SELECT 1 FROM companies WHERE name = $1', [input.name])) fail('name_taken', 'Tên doanh nghiệp đã được đăng ký.', 409);

  let slug = slugify(input.name);
  if (await maybe(tx, 'SELECT 1 FROM companies WHERE slug = $1', [slug])) slug = `${slug}-${Math.floor(Math.random() * 9000 + 1000)}`;

  const c = await one<{ id: string }>(
    tx,
    `INSERT INTO companies (owner_user_id, name, slug, industry_code, location_code, license_ready_at, founded_minute, description, logo_hue)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [userId, input.name, slug, ind.code, input.location, minute + ind.license_hours * 60, minute, input.description ?? '', Math.floor(Math.random() * 360)],
  );
  const fee = ind.register_fee;
  await post(tx, {
    key: `company:found:${c.id}`,
    kind: 'company_founding',
    memo: `Góp vốn điều lệ và lệ phí đăng ký ${input.name}`,
    minute,
    actorId: userId,
    ref: { type: 'company', id: c.id },
    lines: [
      { ...U(userId, 'cash'), amount: -(input.capital + fee) },
      { ...U(userId, 'investments'), amount: input.capital },
      { ...U(userId, 'fees'), amount: fee },
      { ...C(c.id, 'cash'), amount: input.capital },
      { ...C(c.id, 'share_capital'), amount: -input.capital },
      { ...SYS.treasury('cash'), amount: fee },
      { ...SYS.treasury('fee_revenue'), amount: -fee },
    ],
  });
  await audit(tx, userId, 'company.create', 'company', c.id, { industry: ind.code, capital: input.capital });
  await notify(tx, userId, 'company', 'Hồ sơ đăng ký đã nộp', `${input.name} sẽ được cấp giấy phép sau ${ind.license_hours} giờ trong game. Trong lúc chờ, hãy mua thiết bị và tuyển nhân sự.`, { companyId: c.id });
  return c.id;
}

export async function injectCapital(tx: Tx, userId: string, companyId: string, amount: number, minute: number, key: string) {
  await ownedCompany(tx, userId, companyId);
  await post(tx, {
    key,
    kind: 'capital_injection',
    memo: 'Chủ sở hữu góp thêm vốn',
    minute,
    actorId: userId,
    ref: { type: 'company', id: companyId },
    lines: [
      { ...U(userId, 'cash'), amount: -amount },
      { ...U(userId, 'investments'), amount },
      { ...C(companyId, 'cash'), amount },
      { ...C(companyId, 'share_capital'), amount: -amount },
    ],
  });
}

/** Equipment is bought from domestic suppliers whose workers are part of the household sector. */
export async function buyEquipment(tx: Tx, userId: string | null, companyId: string, type: string, count: number, minute: number, key: string) {
  const et = await maybe<{ code: string; name: string; price: number }>(tx, 'SELECT * FROM equipment_types WHERE code = $1', [type]);
  if (!et) return fail('bad_equipment', 'Loại thiết bị không tồn tại.');
  const c = await one<CompanyRow>(tx, 'SELECT * FROM companies WHERE id = $1', [companyId]);
  const usable = await maybe(tx, 'SELECT 1 FROM recipes WHERE industry_code = $1 AND equipment = $2', [c.industry_code, type]);
  if (!usable) fail('equipment_unusable', 'Thiết bị này không dùng được cho ngành của doanh nghiệp.');
  const total = et.price * count;
  const res = await post(tx, {
    key,
    kind: 'equipment_purchase',
    memo: `Mua ${count} × ${et.name}`,
    minute,
    actorId: userId,
    ref: { type: 'company', id: companyId },
    lines: [
      { ...C(companyId, 'cash'), amount: -total },
      { ...C(companyId, 'equipment'), amount: total },
      { ...SYS.households('cash'), amount: total },
      { ...SYS.households('income'), amount: -total },
    ],
  });
  if (!res.created) return;
  for (let i = 0; i < count; i++) {
    await tx.query('INSERT INTO equipment (company_id, type_code, book_value, bought_minute) VALUES ($1,$2,$3,$4)', [companyId, type, et.price, minute]);
  }
}

export async function setListing(tx: Tx, companyId: string, good: string, price: number, active: boolean, b2b: boolean) {
  const g = await maybe<{ category: string }>(tx, 'SELECT category FROM goods WHERE code = $1', [good]);
  if (!g) return fail('bad_good', 'Mặt hàng không tồn tại.');
  if (!b2b && g.category !== 'consumer') fail('not_consumer', 'Nguyên liệu chỉ bán buôn cho doanh nghiệp.');
  const c = await one<CompanyRow>(tx, 'SELECT * FROM companies WHERE id = $1', [companyId]);
  const makes = await maybe(tx, 'SELECT 1 FROM recipes WHERE industry_code = $1 AND output_good = $2', [c.industry_code, good]);
  const holds = await maybe(tx, 'SELECT 1 FROM inventory WHERE company_id = $1 AND good_code = $2 AND qty > 0', [companyId, good]);
  if (!makes && !holds) fail('cannot_sell', 'Doanh nghiệp không sản xuất hoặc không có mặt hàng này.');
  await tx.query(
    `INSERT INTO listings (company_id, good_code, price, active, b2b) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (company_id, good_code, b2b) DO UPDATE SET price = EXCLUDED.price, active = EXCLUDED.active, updated_at = now()`,
    [companyId, good, price, active, b2b],
  );
}

export async function launchCampaign(tx: Tx, userId: string, companyId: string, channel: string, budget: number, days: number, minute: number, key: string) {
  const rule = CHANNEL_RULES[channel];
  if (!rule) return fail('bad_channel', 'Kênh quảng cáo không hợp lệ.');
  const stage = (await one<{ stage: number }>(tx, 'SELECT stage FROM users WHERE id = $1', [userId])).stage;
  if (channel === 'truyen_hinh' && stage < 3) fail('stage_locked', 'Quảng cáo truyền hình mở khóa từ giai đoạn Doanh nghiệp vừa.');
  if (budget < 5_000_000 * days) fail('low_budget', 'Ngân sách tối thiểu 5 triệu ₫ mỗi ngày chạy.');
  // Diminishing returns: brand points/day grow with the square root of daily spend and are capped per channel.
  const daily = budget / days;
  const strength = Math.min(rule.maxDaily, rule.pointsPerMillion * Math.sqrt(daily / 1_000_000) * 3);
  const res = await post(tx, {
    key,
    kind: 'marketing',
    memo: `Chiến dịch quảng cáo ${channel} ${days} ngày`,
    minute,
    actorId: userId,
    ref: { type: 'company', id: companyId },
    lines: [
      { ...C(companyId, 'cash'), amount: -budget },
      { ...C(companyId, 'marketing'), amount: budget },
      { ...SYS.households('cash'), amount: budget },
      { ...SYS.households('income'), amount: -budget },
    ],
  });
  if (!res.created) return;
  const start = minute + rule.delayHours * 60;
  await tx.query('INSERT INTO campaigns (company_id, channel, budget, start_minute, end_minute, strength) VALUES ($1,$2,$3,$4,$5,$6)', [
    companyId,
    channel,
    budget,
    start,
    start + days * 1440,
    strength,
  ]);
}

/** Assets minus liabilities from the company's own ledger. */
export async function netAssets(q: Queryable, companyId: string) {
  const b = await balances(q, 'company', companyId);
  const assets = (b.cash ?? 0) + (b.cash_locked ?? 0) + (b.inventory ?? 0) + (b.inventory_transit ?? 0) + (b.wip ?? 0) + (b.equipment ?? 0) + (b.investments ?? 0);
  const liabilities = -((b.loan_payable ?? 0) + (b.wages_payable ?? 0) + (b.tax_payable ?? 0) + (b.other_payable ?? 0));
  return { assets, liabilities, equity: assets - liabilities, cash: b.cash ?? 0, b };
}

export async function balanceSheet(q: Queryable, companyId: string) {
  const { b, assets, liabilities, equity } = await netAssets(q, companyId);
  const retained = -Object.entries(b)
    .filter(([code]) => ['sales_revenue', 'other_income', 'trading_gain', 'dividend_income'].includes(code) || EXPENSES.includes(code))
    .reduce((s, [, v]) => s + v, 0);
  return {
    assets: {
      cash: b.cash ?? 0,
      cashLocked: b.cash_locked ?? 0,
      inventory: (b.inventory ?? 0) + (b.inventory_transit ?? 0) + (b.wip ?? 0),
      equipment: b.equipment ?? 0,
      investments: b.investments ?? 0,
      total: assets,
    },
    liabilities: {
      loans: -(b.loan_payable ?? 0),
      wages: -(b.wages_payable ?? 0),
      tax: -(b.tax_payable ?? 0),
      other: -(b.other_payable ?? 0),
      total: liabilities,
    },
    equity: { shareCapital: -(b.share_capital ?? 0), retained: retained - (b.dividends_paid ?? 0), total: equity },
  };
}

export const EXPENSES = ['cogs', 'wages', 'marketing', 'rent', 'maintenance', 'freight', 'fees', 'interest', 'tax', 'depreciation', 'spoilage', 'credit_losses'];

export async function companyIdsForOwner(q: Queryable, userId: string) {
  return (await many<{ id: string }>(q, 'SELECT id FROM companies WHERE owner_user_id = $1', [userId])).map((r) => r.id);
}
