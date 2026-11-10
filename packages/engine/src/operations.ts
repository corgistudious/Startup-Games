import type { Tx } from './db';
import { many, one, maybe } from './db';
import { post, SYS, balance, activity } from './ledger';
import { C, type CompanyRow, EXPENSES } from './companies';
import { releasePerson } from './hr';
import { ECON } from './config';
import { DAYS_PER_MONTH, MINUTES_PER_DAY } from '@startup/shared';
import { notify, notifyCompanyOwner } from './notify';

/**
 * Daily operating costs: rent, equipment maintenance/wear/depreciation, spoilage,
 * brand decay and campaign effects, then insolvency tracking. Bills that cannot be
 * paid accrue as liabilities; seven consecutive insolvent days end in bankruptcy.
 */
export async function companyDaily(tx: Tx, companyId: string, day: number, minute: number) {
  const c = await maybe<CompanyRow & { rent_day: number }>(
    tx,
    `SELECT c.*, l.rent_day FROM companies c JOIN locations l ON l.code = c.location_code WHERE c.id=$1 FOR UPDATE OF c`,
    [companyId],
  );
  if (!c || !['active', 'insolvent', 'licensing'].includes(c.status)) return;

  const eq = await many<{ id: string; condition: number; book_value: number; maintenance_day: number; wear_per_day: number }>(
    tx,
    `SELECT e.id, e.condition, e.book_value, t.maintenance_day, t.wear_per_day FROM equipment e JOIN equipment_types t ON t.code = e.type_code WHERE e.company_id=$1`,
    [companyId],
  );
  const maintenance = eq.reduce((s, e) => s + e.maintenance_day, 0);
  const rent = c.rent_day;
  const bills = rent + maintenance;
  const otherPayable = -(await balance(tx, C(companyId, 'other_payable')));
  const cash = await balance(tx, C(companyId, 'cash'));
  let insolvent = false;

  if (bills > 0) {
    if (cash >= bills + otherPayable) {
      await post(tx, {
        key: `daily:costs:${companyId}:${day}`,
        kind: 'operating_costs',
        memo: `Thuê mặt bằng và bảo trì ngày ${day + 1}`,
        minute,
        ref: { type: 'company', id: companyId },
        lines: [
          { ...C(companyId, 'rent'), amount: rent },
          { ...C(companyId, 'maintenance'), amount: maintenance },
          { ...C(companyId, 'other_payable'), amount: otherPayable },
          { ...C(companyId, 'cash'), amount: -(bills + otherPayable) },
          { ...SYS.households('cash'), amount: bills + otherPayable },
          { ...SYS.households('income'), amount: -(bills + otherPayable) },
        ],
      });
      // Maintained equipment wears at the normal rate.
      for (const e of eq) await tx.query('UPDATE equipment SET condition = GREATEST(0, condition - $2) WHERE id=$1', [e.id, e.wear_per_day]);
    } else {
      insolvent = true;
      await post(tx, {
        key: `daily:costs:${companyId}:${day}`,
        kind: 'operating_costs_accrued',
        memo: `Nợ tiền thuê và bảo trì ngày ${day + 1}`,
        minute,
        ref: { type: 'company', id: companyId },
        lines: [
          { ...C(companyId, 'rent'), amount: rent },
          { ...C(companyId, 'maintenance'), amount: maintenance },
          { ...C(companyId, 'other_payable'), amount: -bills },
        ],
      });
      // Unmaintained equipment wears three times faster.
      for (const e of eq) await tx.query('UPDATE equipment SET condition = GREATEST(0, condition - $2) WHERE id=$1', [e.id, e.wear_per_day * 3]);
    }
  }

  // Straight-line-ish depreciation: 0.4% of book value per day.
  let dep = 0;
  for (const e of eq) {
    const d = Math.floor(e.book_value * 0.004);
    if (d > 0) {
      dep += d;
      await tx.query('UPDATE equipment SET book_value = book_value - $2 WHERE id=$1', [e.id, d]);
    }
  }
  if (dep > 0) {
    await post(tx, {
      key: `daily:dep:${companyId}:${day}`,
      kind: 'depreciation',
      memo: `Khấu hao thiết bị ngày ${day + 1}`,
      minute,
      ref: { type: 'company', id: companyId },
      lines: [
        { ...C(companyId, 'depreciation'), amount: dep },
        { ...C(companyId, 'equipment'), amount: -dep },
      ],
    });
  }

  // Spoilage of perishable goods.
  const perishable = await many<{ good_code: string; qty: number; reserved: number; value: number; spoil_per_day: number }>(
    tx,
    `SELECT i.good_code, i.qty, i.reserved, i.value, g.spoil_per_day FROM inventory i JOIN goods g ON g.code = i.good_code WHERE i.company_id=$1 AND i.qty > 0 AND g.spoil_per_day > 0 FOR UPDATE OF i`,
    [companyId],
  );
  let spoiledValue = 0;
  for (const p of perishable) {
    const lost = Math.min(p.qty - p.reserved, Math.floor(p.qty * p.spoil_per_day));
    if (lost <= 0) continue;
    const v = lost === p.qty ? p.value : Math.round((p.value * lost) / p.qty);
    spoiledValue += v;
    await tx.query('UPDATE inventory SET qty = qty - $3, value = value - $4 WHERE company_id=$1 AND good_code=$2', [companyId, p.good_code, lost, v]);
  }
  if (spoiledValue > 0) {
    await post(tx, {
      key: `daily:spoil:${companyId}:${day}`,
      kind: 'spoilage',
      memo: `Hao hụt hàng dễ hỏng ngày ${day + 1}`,
      minute,
      ref: { type: 'company', id: companyId },
      lines: [
        { ...C(companyId, 'spoilage'), amount: spoiledValue },
        { ...C(companyId, 'inventory'), amount: -spoiledValue },
      ],
    });
  }

  // Brand: running campaigns add points, everything decays 4%/day.
  const camp = await one<{ s: number }>(tx, 'SELECT COALESCE(SUM(strength),0)::float AS s FROM campaigns WHERE company_id=$1 AND start_minute <= $2 AND end_minute > $2', [companyId, minute]);
  await tx.query('UPDATE companies SET brand = LEAST(200, GREATEST(0, brand * 0.96 + $2)) WHERE id=$1', [companyId, camp.s]);

  // Insolvency: unpaid wages also count.
  const wagesOwed = -(await balance(tx, C(companyId, 'wages_payable')));
  if (wagesOwed > 0) insolvent = true;
  const days = insolvent ? c.insolvent_days + 1 : 0;
  if (days >= ECON.bankruptcyAfterInsolventDays) {
    await declareBankruptcy(tx, c, minute);
  } else {
    await tx.query(`UPDATE companies SET insolvent_days=$2, status = CASE WHEN status='licensing' THEN status WHEN $2 > 0 THEN 'insolvent' ELSE 'active' END WHERE id=$1`, [companyId, days]);
    if (days === 3) await notifyCompanyOwner(tx, companyId, 'finance', 'Cảnh báo mất khả năng thanh toán', `Doanh nghiệp đã 3 ngày không thanh toán đủ nghĩa vụ. Sau ${ECON.bankruptcyAfterInsolventDays} ngày sẽ bị tuyên bố phá sản.`, `insolvent3:${companyId}:${day}`);
  }
}

export async function declareBankruptcy(tx: Tx, c: CompanyRow, minute: number) {
  await tx.query(`UPDATE companies SET status='bankrupt', insolvent_days=$2 WHERE id=$1`, [c.id, ECON.bankruptcyAfterInsolventDays]);
  const staff = await many<{ id: string }>(tx, 'SELECT id FROM people WHERE company_id=$1', [c.id]);
  for (const p of staff) await releasePerson(tx, p.id);
  await tx.query('UPDATE listings SET active=false WHERE company_id=$1', [c.id]);
  await tx.query(`UPDATE production_orders SET status='cancelled', completed_minute=$2 WHERE company_id=$1 AND status='running'`, [c.id, minute]);
  await tx.query(`UPDATE orders SET status='cancelled' WHERE owner_type='company' AND owner_id=$1 AND status='open'`, [c.id]);
  await tx.query(`UPDATE instruments SET status='halted', halt_reason='Doanh nghiệp phá sản' WHERE company_id=$1`, [c.id]);
  if (c.owner_user_id) await notify(tx, c.owner_user_id, 'finance', `${c.name} đã phá sản`, 'Doanh nghiệp không thể thanh toán nghĩa vụ trong 7 ngày liên tiếp. Nhân sự đã được giải phóng và tài sản bị phong tỏa để xử lý nợ.', { companyId: c.id });
}

/** Activate companies whose license has been granted. */
export async function activateLicense(tx: Tx, c: CompanyRow, minute: number) {
  if (c.status !== 'licensing' || minute < c.license_ready_at) return false;
  await tx.query(`UPDATE companies SET status='active' WHERE id=$1 AND status='licensing'`, [c.id]);
  if (c.owner_user_id) {
    await tx.query('UPDATE users SET stage = GREATEST(stage, 2) WHERE id=$1', [c.owner_user_id]);
    await notify(tx, c.owner_user_id, 'company', 'Đã cấp giấy phép kinh doanh', `${c.name} chính thức hoạt động.`, { companyId: c.id }, `license:${c.id}`);
  }
  return true;
}

export const monthRange = (month: number) => [month * DAYS_PER_MONTH * MINUTES_PER_DAY, (month + 1) * DAYS_PER_MONTH * MINUTES_PER_DAY] as const;

/**
 * Close one game month for a company from the ledger. The UNIQUE(company, month)
 * constraint means a month can never be closed twice; nothing is re-earned at close.
 */
export async function closeMonth(tx: Tx, companyId: string, month: number) {
  const [from, to] = monthRange(month);
  const c = await one<CompanyRow & { tax_rate: number }>(tx, 'SELECT c.*, i.tax_rate FROM companies c JOIN industries i ON i.code=c.industry_code WHERE c.id=$1', [companyId]);
  if (c.founded_minute >= to) return null;
  const a = await activity(tx, 'company', companyId, from, to);
  const revenue = -((a.sales_revenue ?? 0) + (a.other_income ?? 0) + (a.trading_gain ?? 0) + (a.dividend_income ?? 0));
  const cogs = a.cogs ?? 0;
  const wages = a.wages ?? 0;
  const marketing = a.marketing ?? 0;
  const operating = (a.rent ?? 0) + (a.maintenance ?? 0) + (a.freight ?? 0) + (a.fees ?? 0) + (a.depreciation ?? 0) + (a.spoilage ?? 0) + (a.credit_losses ?? 0);
  const interest = a.interest ?? 0;
  const pbt = revenue - cogs - wages - marketing - operating - interest;
  const tax = Math.max(0, Math.round(pbt * c.tax_rate));
  const cashEnd = await balance(tx, C(companyId, 'cash'));
  const inventoryEnd = (await balance(tx, C(companyId, 'inventory'))) + (await balance(tx, C(companyId, 'wip'))) + (await balance(tx, C(companyId, 'inventory_transit')));
  const debtEnd = -(await balance(tx, C(companyId, 'loan_payable')));
  const ins = await maybe<{ id: number }>(
    tx,
    `INSERT INTO monthly_reports (company_id, month, revenue, cogs, wages, marketing, operating, interest, profit_before_tax, tax, net_profit, cash_end, inventory_end, debt_end, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (company_id, month) DO NOTHING RETURNING id`,
    [companyId, month, revenue, cogs, wages, marketing, operating, interest, pbt, tax, pbt - tax, cashEnd, inventoryEnd, debtEnd, { activity: a, taxRate: c.tax_rate }],
  );
  if (!ins) return null;
  if (tax > 0) {
    await post(tx, {
      key: `tax:${companyId}:${month}`,
      kind: 'tax_assessment',
      memo: `Thuế thu nhập doanh nghiệp tháng ${month + 1}`,
      minute: to - 1,
      ref: { type: 'company', id: companyId },
      lines: [
        { ...C(companyId, 'tax'), amount: tax },
        { ...C(companyId, 'tax_payable'), amount: -tax },
      ],
    });
    await tx.query(`INSERT INTO tax_bills (company_id, month, amount, due_minute) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [companyId, month, tax, to + ECON.taxDueDays * MINUTES_PER_DAY]);
  }
  if (!c.is_npc) {
    await notifyCompanyOwner(
      tx,
      companyId,
      'report',
      `Báo cáo tài chính tháng ${month + 1}: ${c.name}`,
      `Doanh thu ${revenue.toLocaleString('vi-VN')} ₫ · Lợi nhuận trước thuế ${pbt.toLocaleString('vi-VN')} ₫ · Thuế ${tax.toLocaleString('vi-VN')} ₫.`,
      `report:${companyId}:${month}`,
    );
  }
  return { revenue, pbt, tax };
}

/** Collect open tax bills when cash allows; overdue bills count toward insolvency. */
export async function collectTaxes(tx: Tx, companyId: string, day: number, minute: number) {
  const bills = await many<{ id: string; amount: number; paid: number; due_minute: number; month: number; status: string }>(tx, `SELECT * FROM tax_bills WHERE company_id=$1 AND status <> 'paid' ORDER BY month FOR UPDATE`, [companyId]);
  for (const b of bills) {
    const left = b.amount - b.paid;
    const cash = await balance(tx, C(companyId, 'cash'));
    if (cash >= left) {
      await post(tx, {
        key: `taxpay:${b.id}`,
        kind: 'tax_payment',
        memo: `Nộp thuế tháng ${b.month + 1}`,
        minute,
        ref: { type: 'tax_bill', id: b.id },
        lines: [
          { ...C(companyId, 'tax_payable'), amount: left },
          { ...C(companyId, 'cash'), amount: -left },
          { ...SYS.treasury('cash'), amount: left },
          { ...SYS.treasury('tax_revenue'), amount: -left },
        ],
      });
      await tx.query(`UPDATE tax_bills SET paid=amount, status='paid' WHERE id=$1`, [b.id]);
    } else if (minute > b.due_minute && b.status !== 'overdue') {
      await tx.query(`UPDATE tax_bills SET status='overdue' WHERE id=$1`, [b.id]);
      await tx.query('UPDATE companies SET insolvent_days = insolvent_days + 1 WHERE id=$1', [companyId]);
      await notifyCompanyOwner(tx, companyId, 'finance', 'Nợ thuế quá hạn', `Thuế tháng ${b.month + 1} còn ${left.toLocaleString('vi-VN')} ₫ chưa nộp.`, `taxlate:${b.id}`);
    }
  }
  void day;
}

/**
 * Daily household income: everything the treasury collected (taxes, fees) is spent back
 * as public services/salaries, plus a documented central-bank stimulus that scales with
 * the number of operating businesses (population growth).
 */
export async function householdIncome(tx: Tx, day: number, minute: number) {
  const treasury = await balance(tx, SYS.treasury('cash'));
  const active = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM companies WHERE status='active'`);
  const stimulus = ECON.householdStimulusBase + ECON.householdStimulusPerCompany * active.n;
  await post(tx, {
    key: `households:income:${day}`,
    kind: 'household_income',
    memo: `Chi tiêu công và thu nhập dân cư ngày ${day + 1}`,
    minute,
    lines: [
      { ...SYS.treasury('cash'), amount: -treasury },
      { ...SYS.treasury('transfers'), amount: treasury },
      { ...SYS.centralBank('policy_expense'), amount: stimulus },
      { ...SYS.centralBank('currency_issued'), amount: -stimulus },
      { ...SYS.households('cash'), amount: treasury + stimulus },
      { ...SYS.households('income'), amount: -(treasury + stimulus) },
    ],
  });
}

export function expenseTotal(a: Record<string, number>) {
  return EXPENSES.reduce((s, k) => s + (a[k] ?? 0), 0);
}
