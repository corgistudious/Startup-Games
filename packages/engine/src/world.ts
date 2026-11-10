import type { Db, Tx } from './db';
import { withTx, maybe, many, one } from './db';
import { enqueue, type JobHandler } from './jobs';
import { nowMinute, tickOf } from './clock';
import { toGameDate, TICK_MINUTES } from '@startup/shared';
import type { CompanyRow } from './companies';
import { workTick } from './production';
import { marketTick } from './market';
import { deliverShipment } from './logistics';
import { runPayroll } from './hr';
import { companyDaily, activateLicense, closeMonth, collectTaxes, householdIncome } from './operations';
import { loanDaily, depositDaily } from './bank';
import { contractDaily } from './contracts';
import { expireOffers } from './groups';
import { autoDelist, runSurveillance } from './exchange';
import { refillPeople } from './people';
import { evaluateStage } from './stages';
import { selectFavorites } from './community';
import { npcBrain } from './npc';
import { seeded } from './rng';
import { broadcastEvent } from './notify';

const OPERATING = `status IN ('licensing','active','insolvent')`;

/**
 * Schedule one world tick (30 game minutes). Inserting the tick row and enqueuing its jobs
 * happen in one transaction; the tick PK and job dedupe keys make this idempotent.
 */
export async function scheduleTick(tx: Tx, tick: number): Promise<number> {
  const minute = tick * TICK_MINUTES;
  const ins = await tx.query('INSERT INTO world_ticks (tick, game_minute) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tick, minute]);
  if (!ins.rowCount) return 0;
  const d = toGameDate(minute);
  let n = 0;
  const q = async (kind: string, key: string, payload: Record<string, unknown> = {}) => {
    if (await enqueue(tx, kind, key, minute, payload)) n++;
  };
  const companies = await many<{ id: string; is_npc: boolean }>(tx, `SELECT id, is_npc FROM companies WHERE ${OPERATING} ORDER BY id`);

  if (d.minuteOfDay === 0) {
    // New day: settle yesterday's payroll before today's work starts.
    for (const c of companies) await q('company.payroll', `payroll:${d.day}:${c.id}`, { companyId: c.id, day: d.day - 1 });
    for (const c of companies) await q('company.daily', `daily:${d.day}:${c.id}`, { companyId: c.id, day: d.day });
    const loans = await many<{ id: string }>(tx, `SELECT id FROM loans WHERE status IN ('active','overdue')`);
    for (const l of loans) await q('loan.daily', `loan:${d.day}:${l.id}`, { loanId: l.id, day: d.day });
    const contracts = await many<{ id: string }>(tx, `SELECT id FROM supply_contracts WHERE status='active'`);
    for (const k of contracts) await q('contract.daily', `contract:${d.day}:${k.id}`, { contractId: k.id, day: d.day });
    const deposits = await many<{ id: string }>(tx, `SELECT id FROM deposits WHERE status='active'`);
    for (const dp of deposits) await q('deposit.daily', `deposit:${d.day}:${dp.id}`, { depositId: dp.id, day: d.day });
    await q('world.daily', `world:daily:${d.day}`, { day: d.day });
    if (d.dayOfMonth === 0 && d.month > 0) {
      const all = await many<{ id: string }>(tx, `SELECT id FROM companies WHERE founded_minute < $1`, [minute]);
      for (const c of all) await q('company.close', `close:${d.month - 1}:${c.id}`, { companyId: c.id, month: d.month - 1 });
      await q('world.monthly', `world:monthly:${d.month - 1}`, { month: d.month - 1 });
    }
  }
  for (const c of companies) await q('company.tick', `tick:${tick}:${c.id}`, { companyId: c.id, tick });
  const due = await many<{ id: string }>(tx, `SELECT id FROM shipments WHERE status='in_transit' AND eta_minute < $1`, [minute + TICK_MINUTES]);
  for (const s of due) await q('shipment.deliver', `ship:${s.id}`, { shipmentId: s.id });
  await q('market.tick', `market:${tick}`, { tick });
  if (d.minuteOfHour === 0) {
    for (const c of companies.filter((x) => x.is_npc)) await q('npc.brain', `npc:${tick}:${c.id}`, { companyId: c.id });
    await q('exchange.surveillance', `surveillance:${tick}`);
  }
  await tx.query('UPDATE world_ticks SET jobs_enqueued=$2 WHERE tick=$1', [tick, n]);
  return n;
}

/** Catch up every tick between the last processed one and now (after downtime too). */
export async function processDueTicks(db: Db, maxTicks = 120): Promise<{ from: number; to: number; scheduled: number }> {
  const current = tickOf(await nowMinute(db));
  const last = await maybe<{ t: number | null }>(db, 'SELECT MAX(tick)::bigint AS t FROM world_ticks');
  const start = (last?.t ?? current - 1) + 1;
  let scheduled = 0;
  let t = start;
  for (; t <= current && t < start + maxTicks; t++) {
    await withTx(db, async (tx) => {
      scheduled += await scheduleTick(tx, t);
    });
  }
  if (t > start) await broadcastEvent(db, { t: 'tick', tick: t - 1 });
  return { from: start, to: t - 1, scheduled };
}

const company = (tx: Tx, id: string) => maybe<CompanyRow>(tx, 'SELECT * FROM companies WHERE id=$1 FOR UPDATE', [id]);

export const handlers: Record<string, JobHandler> = {
  'company.tick': async (tx, job) => {
    const c = await company(tx, job.payload.companyId as string);
    if (!c) return;
    await activateLicense(tx, c, job.game_minute);
    const fresh = (await company(tx, c.id))!;
    if (['active', 'insolvent'].includes(fresh.status)) await workTick(tx, fresh, job.game_minute);
  },
  'market.tick': async (tx, job) => {
    await marketTick(tx, job.payload.tick as number, job.game_minute);
  },
  'shipment.deliver': async (tx, job) => {
    await deliverShipment(tx, job.payload.shipmentId as string, job.game_minute);
  },
  'company.payroll': async (tx, job) => {
    await runPayroll(tx, job.payload.companyId as string, job.payload.day as number, job.game_minute);
  },
  'company.daily': async (tx, job) => {
    await companyDaily(tx, job.payload.companyId as string, job.payload.day as number, job.game_minute);
    await collectTaxes(tx, job.payload.companyId as string, job.payload.day as number, job.game_minute);
  },
  'loan.daily': async (tx, job) => {
    await loanDaily(tx, job.payload.loanId as string, job.payload.day as number, job.game_minute);
  },
  'world.daily': async (tx, job) => {
    const day = job.payload.day as number;
    await householdIncome(tx, day, job.game_minute);
    await refillPeople(tx, `people:${day}`);
    await expireOffers(tx, job.game_minute);
    await autoDelist(tx, job.game_minute);
  },
  'company.close': async (tx, job) => {
    await closeMonth(tx, job.payload.companyId as string, job.payload.month as number);
  },
  'world.monthly': async (tx, job) => {
    const month = job.payload.month as number;
    const owners = await many<{ id: string }>(tx, `SELECT DISTINCT owner_user_id AS id FROM companies WHERE owner_user_id IS NOT NULL`);
    for (const o of owners) await evaluateStage(tx, o.id, job.game_minute);
    await selectFavorites(tx, month, seeded(`favorites:${month}`));
  },
  'contract.daily': async (tx, job) => {
    await contractDaily(tx, job.payload.contractId as string, job.payload.day as number, job.game_minute);
  },
  'deposit.daily': async (tx, job) => {
    await depositDaily(tx, job.payload.depositId as string, job.payload.day as number, job.game_minute);
  },
  'exchange.surveillance': async (tx, job) => {
    await runSurveillance(tx, job.game_minute);
  },
  'npc.brain': async (tx, job) => {
    await npcBrain(tx, job.payload.companyId as string, job.game_minute);
  },
};

export async function worldStatus(db: Db) {
  const minute = await nowMinute(db);
  const lastTick = await maybe<{ tick: number; processed_at: Date }>(db, 'SELECT tick, processed_at FROM world_ticks ORDER BY tick DESC LIMIT 1');
  const jobs = await many<{ status: string; n: number }>(db, 'SELECT status, count(*)::int AS n FROM jobs GROUP BY status');
  const workers = await many(db, `SELECT worker_id, role, last_beat, info FROM worker_heartbeats ORDER BY last_beat DESC`);
  const lag = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM jobs WHERE status='pending' AND run_after <= now()`);
  return { minute, date: toGameDate(minute), lastTick, jobs, workers, pending: lag.n };
}
