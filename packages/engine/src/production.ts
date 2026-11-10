import type { Tx } from './db';
import { maybe, many, one } from './db';
import { fail } from './errors';
import { post } from './ledger';
import { C, type CompanyRow } from './companies';
import { toGameDate, type ShiftKind } from '@startup/shared';
import { workState } from './workforce';
import { laborPerTick } from './people';
import { notifyCompanyOwner } from './notify';

type Recipe = { code: string; industry_code: string; name: string; output_good: string; output_qty: number; labor_hours: number; equipment: string; inputs: { good: string; qty: number }[] };

/** Remove qty from inventory at average cost; returns the cost basis removed. */
export async function takeInventory(tx: Tx, companyId: string, good: string, qty: number): Promise<number> {
  const inv = await maybe<{ qty: number; reserved: number; value: number }>(tx, 'SELECT qty, reserved, value FROM inventory WHERE company_id=$1 AND good_code=$2 FOR UPDATE', [companyId, good]);
  if (!inv || inv.qty - inv.reserved < qty) return fail('insufficient_stock', 'Không đủ hàng trong kho.');
  const cost = inv.qty === qty ? inv.value : Math.round((inv.value * qty) / inv.qty);
  await tx.query('UPDATE inventory SET qty = qty - $3, value = value - $4 WHERE company_id=$1 AND good_code=$2', [companyId, good, qty, cost]);
  return cost;
}

export async function addInventory(tx: Tx, companyId: string, good: string, qty: number, value: number) {
  await tx.query(
    `INSERT INTO inventory (company_id, good_code, qty, value) VALUES ($1,$2,$3,$4)
     ON CONFLICT (company_id, good_code) DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, value = inventory.value + EXCLUDED.value`,
    [companyId, good, qty, value],
  );
}

/**
 * Start a production order. Inputs are consumed immediately (moved to work-in-progress);
 * output appears only as staff on shift and equipment capacity complete batches.
 */
export async function startProduction(tx: Tx, company: CompanyRow, recipeCode: string, batches: number, minute: number) {
  const recipe = await maybe<Recipe>(tx, 'SELECT * FROM recipes WHERE code = $1', [recipeCode]);
  if (!recipe || recipe.industry_code !== company.industry_code) return fail('bad_recipe', 'Công thức không thuộc ngành của doanh nghiệp.');
  const eq = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM equipment WHERE company_id=$1 AND type_code=$2 AND condition > 20', [company.id, recipe.equipment]);
  if (eq.n === 0) fail('no_equipment', 'Thiếu thiết bị vận hành được cho công thức này. Hãy mua hoặc bảo trì thiết bị.');
  let cost = 0;
  for (const input of recipe.inputs) {
    const need = input.qty * batches;
    const inv = await maybe<{ qty: number; reserved: number }>(tx, 'SELECT qty, reserved FROM inventory WHERE company_id=$1 AND good_code=$2', [company.id, input.good]);
    const have = inv ? inv.qty - inv.reserved : 0;
    if (have < need) {
      const g = await one<{ name: string; unit: string }>(tx, 'SELECT name, unit FROM goods WHERE code=$1', [input.good]);
      fail('missing_inputs', `Thiếu nguyên liệu: cần ${need} ${g.unit} ${g.name}, trong kho có ${have}.`);
    }
  }
  for (const input of recipe.inputs) cost += await takeInventory(tx, company.id, input.good, input.qty * batches);
  const order = await one<{ id: string }>(
    tx,
    `INSERT INTO production_orders (company_id, recipe_code, batches, labor_required, input_cost, created_minute) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [company.id, recipe.code, batches, recipe.labor_hours * batches, cost, minute],
  );
  if (cost > 0) {
    await post(tx, {
      key: `prod:start:${order.id}`,
      kind: 'production_start',
      memo: `Xuất nguyên liệu cho lệnh sản xuất ${recipe.name} × ${batches}`,
      minute,
      ref: { type: 'production', id: order.id },
      lines: [
        { ...C(company.id, 'wip'), amount: cost },
        { ...C(company.id, 'inventory'), amount: -cost },
      ],
    });
  }
  return order.id;
}

/** Cancelling writes off the remaining work in progress; consumed inputs are not recoverable. */
export async function cancelProduction(tx: Tx, companyId: string, orderId: string, minute: number) {
  const o = await maybe<{ id: string; status: string; batches: number; batches_done: number; input_cost: number }>(tx, 'SELECT * FROM production_orders WHERE id=$1 AND company_id=$2 FOR UPDATE', [orderId, companyId]);
  if (!o || o.status !== 'running') return fail('not_running', 'Lệnh sản xuất không còn chạy.');
  const usedCost = Math.round((o.input_cost * o.batches_done) / o.batches);
  const remaining = o.input_cost - usedCost;
  if (remaining > 0) {
    await post(tx, {
      key: `prod:cancel:${orderId}`,
      kind: 'production_cancel',
      memo: 'Hủy lệnh sản xuất, ghi nhận hao hụt nguyên liệu',
      minute,
      ref: { type: 'production', id: orderId },
      lines: [
        { ...C(companyId, 'spoilage'), amount: remaining },
        { ...C(companyId, 'wip'), amount: -remaining },
      ],
    });
  }
  await tx.query(`UPDATE production_orders SET status='cancelled', completed_minute=$2 WHERE id=$1`, [orderId, minute]);
}

/**
 * One 30-minute tick of work: count hours for every on-shift employee, then let
 * production staff advance running orders within equipment capacity.
 */
export async function workTick(tx: Tx, company: CompanyRow, minute: number) {
  const d = toGameDate(minute);
  const staff = await many<{ id: string; shift: ShiftKind; department: string; skill: number; morale: number; leave_until_minute: number | null }>(
    tx,
    'SELECT id, shift, department, skill, morale, leave_until_minute FROM people WHERE company_id=$1',
    [company.id],
  );
  const states = staff.map((s) => ({ s, w: workState(s, company.overtime_hours ?? 0, d.weekday, d.minuteOfDay, minute) }));
  const paidRegular = states.filter((x) => x.w.paid).map((x) => x.s.id); // includes paid leave
  const overtime = states.filter((x) => x.w.overtime && x.w.working).map((x) => x.s.id);
  if (paidRegular.length) await tx.query('UPDATE people SET hours_this_day = hours_this_day + 0.5 WHERE id = ANY($1)', [paidRegular]);
  if (overtime.length) await tx.query('UPDATE people SET ot_hours_this_day = ot_hours_this_day + 0.5 WHERE id = ANY($1)', [overtime]);
  const working = states.filter((x) => x.w.working).map((x) => x.s);

  const producers = working.filter((s) => s.department === 'san_xuat');
  let labor = producers.reduce((sum, s) => sum + laborPerTick(s.skill, s.morale), 0);
  // Managers on shift raise production efficiency a little (max +15%).
  const managers = working.filter((s) => s.department === 'dieu_hanh').length;
  labor *= 1 + Math.min(0.15, managers * 0.05);
  if (labor <= 0) return;

  const orders = await many<{ id: string; recipe_code: string; batches: number; batches_done: number; labor_required: number; labor_done: number; input_cost: number }>(
    tx,
    `SELECT * FROM production_orders WHERE company_id=$1 AND status='running' ORDER BY created_minute, id FOR UPDATE`,
    [company.id],
  );
  if (!orders.length) return;
  const recipes = new Map((await many<Recipe>(tx, 'SELECT * FROM recipes WHERE industry_code=$1', [company.industry_code])).map((r) => [r.code, r]));
  const eqRows = await many<{ type_code: string; cap: number }>(
    tx,
    `SELECT e.type_code, SUM(t.batches_per_hour * 0.5 * (0.5 + e.condition / 200.0))::float AS cap
       FROM equipment e JOIN equipment_types t ON t.code = e.type_code WHERE e.company_id=$1 AND e.condition > 20 GROUP BY e.type_code`,
    [company.id],
  );
  const capacity = new Map(eqRows.map((r) => [r.type_code, r.cap])); // batches this tick per equipment type

  for (const o of orders) {
    if (labor <= 1e-9) break;
    const r = recipes.get(o.recipe_code);
    if (!r) continue;
    const capBatches = capacity.get(r.equipment) ?? 0;
    if (capBatches <= 0) continue;
    const applied = Math.min(labor, capBatches * r.labor_hours, o.labor_required - o.labor_done);
    if (applied <= 0) continue;
    labor -= applied;
    capacity.set(r.equipment, capBatches - applied / r.labor_hours);
    const laborDone = o.labor_done + applied;
    const totalDone = Math.min(o.batches, Math.floor(laborDone / r.labor_hours + 1e-9));
    const newBatches = totalDone - o.batches_done;
    if (newBatches > 0) {
      const costBefore = Math.round((o.input_cost * o.batches_done) / o.batches);
      const costAfter = totalDone === o.batches ? o.input_cost : Math.round((o.input_cost * totalDone) / o.batches);
      const cost = costAfter - costBefore;
      await addInventory(tx, company.id, r.output_good, newBatches * r.output_qty, cost);
      if (cost > 0) {
        await post(tx, {
          key: `prod:out:${o.id}:${totalDone}`,
          kind: 'production_output',
          memo: `Nhập kho thành phẩm ${r.name}: ${newBatches} mẻ`,
          minute,
          ref: { type: 'production', id: o.id },
          lines: [
            { ...C(company.id, 'inventory'), amount: cost },
            { ...C(company.id, 'wip'), amount: -cost },
          ],
        });
      }
    }
    const finished = totalDone >= o.batches;
    await tx.query(`UPDATE production_orders SET labor_done=$2, batches_done=$3, status=$4, completed_minute=$5 WHERE id=$1`, [
      o.id,
      laborDone,
      totalDone,
      finished ? 'completed' : 'running',
      finished ? minute : null,
    ]);
    if (finished && !company.is_npc) {
      await notifyCompanyOwner(tx, company.id, 'production', 'Hoàn thành lệnh sản xuất', `${r.name} × ${o.batches} mẻ đã nhập kho.`, `prod-done:${o.id}`);
    }
  }
}
