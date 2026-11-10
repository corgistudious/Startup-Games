import type { Tx } from './db';
import { many } from './db';
import { post, SYS, balance } from './ledger';
import { C } from './companies';
import { isOpen, toGameDate, type ShiftKind } from '@startup/shared';
import { workState } from './workforce';
import { branchTraffic } from './groups';
import { ECON } from './config';

type Seller = {
  company_id: string;
  good_code: string;
  price: number;
  qty: number;
  value: number;
  reputation: number;
  brand: number;
  traffic: number;
  open_hour: number;
  close_hour: number;
  days_mask: number;
};

/**
 * Household demand for one 30-minute tick. Households spend part of their (finite) cash.
 * Each good's budget is shared between sellers by attractiveness:
 *   (refPrice / price)^elasticity × reputation × brand × location traffic,
 * against an outside option, so overpricing loses customers. Sales are capped by stock
 * and by the customers on-shift sales staff can serve. Nothing is sold that is not in stock,
 * and nothing is paid that households do not have.
 */
export async function marketTick(tx: Tx, tick: number, minute: number) {
  const d = toGameDate(minute);
  // Lock the household account for the whole tick: one market clearing at a time.
  await tx.query(`SELECT 1 FROM accounts WHERE owner_type='system' AND owner_id='households' AND code='cash' FOR UPDATE`);
  const households = await balance(tx, SYS.households('cash'));
  if (households <= 0) return { revenue: 0 };

  const goods = await many<{ code: string; ref_price: number; elasticity: number; demand_weight: number }>(tx, `SELECT code, ref_price, elasticity, demand_weight FROM goods WHERE category='consumer' AND demand_weight > 0`);
  const totalWeight = goods.reduce((s, g) => s + g.demand_weight, 0);
  // Evening/night ticks carry less demand than the daytime peak.
  const timeFactor = d.hour >= 7 && d.hour < 21 ? 1 : 0.35;
  const budget = households * ECON.householdSpendPerTick * timeFactor;

  const sellers = await many<Seller>(
    tx,
    `SELECT l.company_id, l.good_code, l.price, i.qty - i.reserved AS qty, i.value, c.reputation, c.brand, loc.traffic, ind.open_hour, ind.close_hour, ind.days_mask
       FROM listings l
       JOIN companies c ON c.id = l.company_id AND c.status IN ('active','insolvent')
       JOIN industries ind ON ind.code = c.industry_code
       JOIN locations loc ON loc.code = c.location_code
       JOIN inventory i ON i.company_id = l.company_id AND i.good_code = l.good_code
      WHERE l.active AND NOT l.b2b AND i.qty - i.reserved > 0
      ORDER BY l.company_id, l.good_code`,
  );
  const extraTraffic = await branchTraffic(tx);
  for (const s of sellers) s.traffic += extraTraffic.get(s.company_id) ?? 0;
  const open = sellers.filter((s) => isOpen(s.open_hour, s.close_hour, s.days_mask, d.weekday, d.minuteOfDay));
  if (!open.length) return { revenue: 0 };

  const staffRows = await many<{ company_id: string; shift: ShiftKind; leave_until_minute: number | null; overtime_hours: number }>(
    tx,
    `SELECT p.company_id, p.shift, p.leave_until_minute, c.overtime_hours FROM people p JOIN companies c ON c.id = p.company_id WHERE p.department='ban_hang' AND p.company_id = ANY($1)`,
    [[...new Set(open.map((s) => s.company_id))]],
  );
  const staff = staffRows.filter((p) => workState(p, p.overtime_hours, d.weekday, d.minuteOfDay, minute).working);
  const capacity = new Map<string, number>();
  for (const p of staff) capacity.set(p.company_id, (capacity.get(p.company_id) ?? 0) + ECON.customersPerSalesStaff);

  type Sale = { qty: number; revenue: number; cost: number; customers: number; byGood: Map<string, { qty: number; revenue: number; cost: number }> };
  const sales = new Map<string, Sale>();
  let spentTotal = 0;

  for (const g of goods) {
    const budgetG = (budget * g.demand_weight) / totalWeight;
    const cands = open.filter((s) => s.good_code === g.code && (capacity.get(s.company_id) ?? 0) > 0);
    if (!cands.length) continue;
    const attract = cands.map((s) => Math.pow(g.ref_price / s.price, g.elasticity) * (0.5 + s.reputation / 100) * (1 + s.brand / 100) * s.traffic);
    const denom = attract.reduce((a, b) => a + b, 0) + ECON.outsideOption;
    cands.forEach((s, i) => {
      const spend = (budgetG * attract[i]!) / denom;
      const cap = capacity.get(s.company_id) ?? 0;
      const q = Math.min(Math.floor(spend / s.price), s.qty, cap);
      if (q <= 0) return;
      capacity.set(s.company_id, cap - q);
      const revenue = q * s.price;
      const cost = q === s.qty ? s.value : Math.round((s.value * q) / s.qty);
      spentTotal += revenue;
      const sale = sales.get(s.company_id) ?? { qty: 0, revenue: 0, cost: 0, customers: 0, byGood: new Map() };
      sale.qty += q;
      sale.revenue += revenue;
      sale.cost += cost;
      sale.customers += q;
      sale.byGood.set(g.code, { qty: q, revenue, cost });
      sales.set(s.company_id, sale);
    });
  }
  if (spentTotal > households) return { revenue: 0 }; // cannot happen (budget < cash) but never overspend

  for (const [companyId, s] of sales) {
    const res = await post(tx, {
      key: `sale:${tick}:${companyId}`,
      kind: 'retail_sales',
      memo: `Doanh thu bán lẻ ${String(d.hour).padStart(2, '0')}:${String(d.minuteOfHour).padStart(2, '0')} ngày ${d.day + 1}`,
      minute,
      ref: { type: 'company', id: companyId },
      lines: [
        { ...SYS.households('cash'), amount: -s.revenue },
        { ...SYS.households('consumption'), amount: s.revenue },
        { ...C(companyId, 'cash'), amount: s.revenue },
        { ...C(companyId, 'sales_revenue'), amount: -s.revenue },
        { ...C(companyId, 'cogs'), amount: s.cost },
        { ...C(companyId, 'inventory'), amount: -s.cost },
      ],
    });
    if (!res.created) continue;
    for (const [good, x] of s.byGood) {
      await tx.query('UPDATE inventory SET qty = qty - $3, value = value - $4 WHERE company_id=$1 AND good_code=$2', [companyId, good, x.qty, x.cost]);
      await tx.query(
        `INSERT INTO sales_daily (company_id, day, good_code, qty, revenue, customers) VALUES ($1,$2,$3,$4,$5,$4)
         ON CONFLICT (company_id, day, good_code) DO UPDATE SET qty = sales_daily.qty + EXCLUDED.qty, revenue = sales_daily.revenue + EXCLUDED.revenue, customers = sales_daily.customers + EXCLUDED.customers`,
        [companyId, d.day, good, x.qty, x.revenue],
      );
    }
    await tx.query('UPDATE companies SET reputation = LEAST(100, reputation + 0.02) WHERE id=$1', [companyId]);
  }
  // Open shops with listings but nothing to sell (or nobody at the counter) disappoint customers.
  const servedOrStocked = new Set(open.filter((s) => (capacity.get(s.company_id) ?? 0) > 0 || sales.has(s.company_id)).map((s) => s.company_id));
  const unstaffed = [...new Set(open.map((s) => s.company_id))].filter((id) => !servedOrStocked.has(id) && !staff.some((p) => p.company_id === id));
  if (unstaffed.length) await tx.query('UPDATE companies SET reputation = GREATEST(0, reputation - 0.01) WHERE id = ANY($1)', [unstaffed]);
  return { revenue: spentTotal, sellers: sales.size };
}
