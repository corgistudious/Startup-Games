import type { Tx } from './db';
import { many, maybe, one, attempt } from './db';
import { balance } from './ledger';
import { C, type CompanyRow, setListing } from './companies';
import { hire, dismiss } from './hr';
import { startProduction } from './production';
import { purchase } from './logistics';
import { toGameDate } from '@startup/shared';

export type NpcProfile = {
  role: 'supplier' | 'retail';
  targetStaff: number;
  /** Days of output the NPC wants in stock. */
  stockDays: number;
};

type Recipe = { code: string; output_good: string; output_qty: number; labor_hours: number; equipment: string; inputs: { good: string; qty: number }[] };

/**
 * NPC companies follow the same rules as players: finite cash, real staff paid through
 * payroll, production needs inputs and equipment, purchases go through the B2B market
 * (players' listings included) and every action is checked against their own budget.
 */
export async function npcBrain(tx: Tx, companyId: string, minute: number) {
  const c = await maybe<CompanyRow & { npc_profile: NpcProfile }>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [companyId]);
  if (!c || !c.is_npc || !['active', 'insolvent'].includes(c.status)) return;
  const p = c.npc_profile;
  const d = toGameDate(minute);
  const cash = await balance(tx, C(c.id, 'cash'));
  const staff = await many<{ id: string; wage: number; skill: number; department: string }>(tx, 'SELECT id, wage, skill, department FROM people WHERE company_id=$1', [c.id]);
  const payrollDay = staff.reduce((s, x) => s + x.wage, 0);

  // ---- Staffing within budget ----
  if (d.hour === 7) {
    if (staff.length < p.targetStaff && cash > (payrollDay + 600_000) * 20) {
      const cand = await maybe<{ id: string; wage_expectation: number }>(tx, `SELECT id, wage_expectation FROM people WHERE status='seeking' AND wage_expectation < 650000 ORDER BY skill DESC LIMIT 1`);
      if (cand && cash > cand.wage_expectation * 25) {
        const sales = staff.filter((s) => s.department === 'ban_hang').length;
        const wantSales = p.role === 'retail' && sales < Math.ceil(p.targetStaff / 3);
        const shift = wantSales && sales % 2 === 1 ? 'part' : 'day';
        await attempt(tx, () => hire(tx, null, c.id, cand.id, cand.wage_expectation, shift, wantSales ? 'ban_hang' : 'san_xuat', minute));
      }
    } else if (staff.length > 1 && cash < payrollDay * 5) {
      const weakest = [...staff].sort((a, b) => a.skill - b.skill)[0]!;
      await attempt(tx, () => dismiss(tx, null, c.id, weakest.id, minute, 'Cắt giảm chi phí'));
    }
  }

  const recipes = await many<Recipe>(tx, 'SELECT * FROM recipes WHERE industry_code=$1', [c.industry_code]);
  const stock = new Map((await many<{ good_code: string; qty: number }>(tx, 'SELECT good_code, qty - reserved AS qty FROM inventory WHERE company_id=$1', [c.id])).map((r) => [r.good_code, r.qty]));
  const running = new Set((await many<{ recipe_code: string }>(tx, `SELECT recipe_code FROM production_orders WHERE company_id=$1 AND status='running'`, [c.id])).map((r) => r.recipe_code));

  for (const r of recipes) {
    const eq = await one<{ cap: number }>(
      tx,
      `SELECT COALESCE(SUM(t.batches_per_hour),0)::float AS cap FROM equipment e JOIN equipment_types t ON t.code=e.type_code WHERE e.company_id=$1 AND e.type_code=$2 AND e.condition > 20`,
      [c.id, r.equipment],
    );
    if (eq.cap <= 0) continue;
    const dailyBatches = Math.max(1, Math.floor(eq.cap * 8));
    const dailyOutput = dailyBatches * r.output_qty;
    const target = dailyOutput * p.stockDays;
    const have = stock.get(r.output_good) ?? 0;

    // ---- Purchasing inputs (retail) from the cheapest seller in stock ----
    for (const input of r.inputs) {
      const need = input.qty * dailyBatches * 2;
      const haveIn = stock.get(input.good) ?? 0;
      const inTransit = await one<{ q: number }>(tx, `SELECT COALESCE(SUM(qty),0)::bigint AS q FROM shipments WHERE buyer_company_id=$1 AND good_code=$2 AND status='in_transit'`, [c.id, input.good]);
      if (haveIn + inTransit.q >= need || d.hour < 7 || d.hour > 18) continue;
      const offer = await maybe<{ company_id: string; price: number; qty: number }>(
        tx,
        `SELECT l.company_id, l.price, i.qty - i.reserved AS qty FROM listings l
           JOIN companies s ON s.id = l.company_id AND s.status IN ('active','insolvent')
           JOIN inventory i ON i.company_id = l.company_id AND i.good_code = l.good_code
          WHERE l.b2b AND l.active AND l.good_code = $1 AND i.qty - i.reserved > 0 AND l.company_id <> $2
          ORDER BY l.price, l.updated_at LIMIT 1`,
        [input.good, c.id],
      );
      if (!offer) continue;
      const cashNow = await balance(tx, C(c.id, 'cash'));
      const budget = cashNow - payrollDay * 4; // keep a payroll reserve
      const qty = Math.min(offer.qty, input.qty * dailyBatches * 3, Math.floor((budget * 0.9) / offer.price));
      if (qty <= 0) continue;
      await attempt(tx, () => purchase(tx, null, c.id, offer.company_id, input.good, qty, offer.price, minute, `npc:buy:${c.id}:${input.good}:${minute}`));
    }

    // ---- Production ----
    if (!running.has(r.code) && have < target && staff.length > 0) {
      let batches = dailyBatches;
      for (const input of r.inputs) batches = Math.min(batches, Math.floor((stock.get(input.good) ?? 0) / input.qty));
      if (batches > 0) await attempt(tx, () => startProduction(tx, c, r.code, batches, minute));
    }

    // ---- Pricing once a day ----
    if (d.hour === 8) {
      const g = await one<{ ref_price: number; category: string }>(tx, 'SELECT ref_price, category FROM goods WHERE code=$1', [r.output_good]);
      const b2b = g.category === 'raw';
      const cur = await maybe<{ price: number }>(tx, 'SELECT price FROM listings WHERE company_id=$1 AND good_code=$2 AND b2b=$3', [c.id, r.output_good, b2b]);
      const ratio = target > 0 ? have / target : 1;
      let price: number;
      if (b2b) price = g.ref_price * Math.min(1.45, Math.max(0.75, 1.35 - 0.5 * ratio));
      else {
        const base = cur?.price ?? g.ref_price;
        price = ratio > 1.3 ? base * 0.97 : ratio < 0.3 ? base * 1.03 : base;
        price = Math.min(g.ref_price * 1.35, Math.max(g.ref_price * 0.8, price));
      }
      price = Math.max(100, Math.round(price / 100) * 100);
      await attempt(tx, () => setListing(tx, c.id, r.output_good, price, true, b2b));
    }
  }
}
