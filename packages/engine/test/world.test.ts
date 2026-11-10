import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Db } from '../src/db';
import { withTx, one, many } from '../src/db';
import { balance, acct, auditLedger, SYS } from '../src/ledger';
import { createCompany, buyEquipment, setListing, type CompanyRow, launchCampaign } from '../src/companies';
import { hire } from '../src/hr';
import { startProduction } from '../src/production';
import { purchase } from '../src/logistics';
import { scheduleTick, processDueTicks } from '../src/world';
import { tickOf } from '../src/clock';
import { freshWorld, newPlayer, advance, minute, drainJobs, clock } from './helpers';
import { GameError } from '../src/errors';

let db: Db;
let player: string;
let bakery: string;

beforeAll(async () => {
  db = await freshWorld();
  player = await newPlayer(db, 'founder');
});
afterAll(async () => db.end());

const company = (id: string) => one<CompanyRow>(db, 'SELECT * FROM companies WHERE id=$1', [id]);

async function inventoryMatchesLedger() {
  const rows = await many<{ company_id: string; v: number }>(db, 'SELECT company_id, SUM(value)::bigint AS v FROM inventory GROUP BY company_id');
  for (const r of rows) expect(await balance(db, acct('company', r.company_id, 'inventory'))).toBe(r.v);
}

describe('world clock & jobs', () => {
  it('ticks are idempotent: scheduling the same tick twice enqueues nothing new', async () => {
    const t = tickOf(await minute(db)) + 1;
    const first = await withTx(db, (tx) => scheduleTick(tx, t));
    const second = await withTx(db, (tx) => scheduleTick(tx, t));
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    await withTx(db, (tx) => tx.query('DELETE FROM jobs WHERE game_minute = $1', [t * 30]).then(() => tx.query('DELETE FROM world_ticks WHERE tick=$1', [t])));
  });

  it('catches up every missed tick after downtime, in order, exactly once', async () => {
    await processDueTicks(db);
    await drainJobs(db);
    const before = await one<{ t: number }>(db, 'SELECT MAX(tick)::bigint AS t FROM world_ticks');
    clock.advanceGame(5 * 30); // server was "down" for 5 ticks
    const r = await processDueTicks(db);
    expect(r.to - r.from + 1).toBe(5);
    expect(r.from).toBe(before.t + 1);
    await drainJobs(db);
    const again = await processDueTicks(db);
    expect(again.scheduled).toBe(0);
  });
});

describe('founding and operating a bakery', () => {
  it('founds a company: capital and fee leave the founder, license takes game time', async () => {
    const m = await minute(db);
    bakery = await withTx(db, (tx) => createCompany(tx, player, { name: 'Bánh Mì Sương Mai', industry: 'tiem_banh', location: 'thu_duc', capital: 300_000_000 }, m));
    expect(await balance(db, acct('user', player, 'cash'))).toBe(600_000_000 - 300_000_000 - 8_000_000);
    expect(await balance(db, acct('company', bakery, 'cash'))).toBe(300_000_000);
    expect((await company(bakery)).status).toBe('licensing');
    await expect(withTx(db, (tx) => createCompany(tx, player, { name: 'Công ty thứ hai', industry: 'tiem_banh', location: 'thu_duc', capital: 100_000_000 }, m))).rejects.toThrow(/tối đa 1/);
  });

  it('cannot produce without equipment, staff or inputs', async () => {
    const m = await minute(db);
    const c = await company(bakery);
    await expect(withTx(db, (tx) => startProduction(tx, c, 'r_banh_mi', 2, m))).rejects.toThrow(/thiết bị/);
    await withTx(db, (tx) => buyEquipment(tx, player, bakery, 'lo_nuong', 1, m, `eq:${bakery}:1`));
    await expect(withTx(db, (tx) => startProduction(tx, c, 'r_banh_mi', 2, m))).rejects.toThrow(/Thiếu nguyên liệu/);
  });

  it('candidates refuse offers far below expectation', async () => {
    const m = await minute(db);
    const p = await one<{ id: string; wage_expectation: number }>(db, `SELECT id, wage_expectation FROM people WHERE status='seeking' ORDER BY skill DESC LIMIT 1`);
    await expect(withTx(db, (tx) => hire(tx, player, bakery, p.id, Math.round(p.wage_expectation * 0.5), 'day', 'san_xuat', m))).rejects.toThrow(/từ chối/);
    await withTx(db, (tx) => hire(tx, player, bakery, p.id, p.wage_expectation, 'day', 'san_xuat', m));
    const seekers = await many<{ id: string; wage_expectation: number }>(db, `SELECT id, wage_expectation FROM people WHERE status='seeking' ORDER BY skill DESC LIMIT 3`);
    await withTx(db, (tx) => hire(tx, player, bakery, seekers[0]!.id, seekers[0]!.wage_expectation, 'day', 'san_xuat', m));
    await withTx(db, (tx) => hire(tx, player, bakery, seekers[1]!.id, seekers[1]!.wage_expectation, 'day', 'ban_hang', m));
    await withTx(db, (tx) => hire(tx, player, bakery, seekers[2]!.id, seekers[2]!.wage_expectation, 'part', 'ban_hang', m));
    expect((await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM people WHERE company_id=$1', [bakery])).n).toBe(4);
  });

  it('buys inputs from an NPC supplier; goods travel and arrive at the ETA, not instantly', async () => {
    const m = await minute(db);
    const farm = await one<{ id: string }>(db, `SELECT id FROM companies WHERE name='Nông Trại Đồng Xanh'`);
    const price = (await one<{ price: number }>(db, `SELECT price FROM listings WHERE company_id=$1 AND good_code='bot_mi' AND b2b`, [farm.id])).price;
    await expect(withTx(db, (tx) => purchase(tx, player, bakery, farm.id, 'bot_mi', 120, price - 1, m, 'buy:low'))).rejects.toThrow(/Giá đã thay đổi/);
    const r = await withTx(db, (tx) => purchase(tx, player, bakery, farm.id, 'bot_mi', 120, price, m, 'buy:flour'));
    await withTx(db, (tx) => purchase(tx, player, bakery, farm.id, 'duong', 20, 30_000, m, 'buy:sugar'));
    expect(r.etaMinute).toBeGreaterThan(m);
    expect(await balance(db, acct('company', bakery, 'inventory'))).toBe(0);
    expect(await balance(db, acct('company', bakery, 'inventory_transit'))).toBeGreaterThan(0);
    await advance(db, r.etaMinute - m + 60 * 12); // allow for possible delays
    const inv = await one<{ qty: number }>(db, `SELECT qty FROM inventory WHERE company_id=$1 AND good_code='bot_mi'`, [bakery]);
    expect(inv.qty).toBe(120);
    expect(await balance(db, acct('company', bakery, 'inventory_transit'))).toBe(0);
    await inventoryMatchesLedger();
  });

  it('production needs staff time: output appears gradually during shifts', async () => {
    const m = await minute(db);
    expect((await company(bakery)).status).toBe('active'); // license granted after 8 game hours
    const c = await company(bakery);
    const order = await withTx(db, (tx) => startProduction(tx, c, 'r_banh_mi', 10, m));
    const o0 = await one<{ batches_done: number }>(db, 'SELECT batches_done FROM production_orders WHERE id=$1', [order]);
    expect(o0.batches_done).toBe(0);
    await withTx(db, (tx) => setListing(tx, bakery, 'banh_mi', 24_000, true, false));
    await advance(db, 2 * 1440);
    const o = await one<{ batches_done: number; status: string }>(db, 'SELECT batches_done, status FROM production_orders WHERE id=$1', [order]);
    expect(o.batches_done).toBeGreaterThan(0);
    await inventoryMatchesLedger();
  });

  it('households buy bread: revenue is recorded with cost of goods, money comes from households', async () => {
    const sales = await one<{ q: number; r: number }>(db, 'SELECT COALESCE(SUM(qty),0)::bigint AS q, COALESCE(SUM(revenue),0)::bigint AS r FROM sales_daily WHERE company_id=$1', [bakery]);
    expect(sales.q).toBeGreaterThan(0);
    expect(-(await balance(db, acct('company', bakery, 'sales_revenue')))).toBe(sales.r);
    expect(await balance(db, acct('company', bakery, 'cogs'))).toBeGreaterThan(0);
    expect(await balance(db, SYS.households('consumption'))).toBeGreaterThan(0);
  });

  it('payroll pays hours actually worked; wages flow to households', async () => {
    const wages = await balance(db, acct('company', bakery, 'wages'));
    expect(wages).toBeGreaterThan(0);
    const people = await many<{ hours_this_day: number }>(db, 'SELECT hours_this_day FROM people WHERE company_id=$1', [bakery]);
    for (const p of people) expect(p.hours_this_day).toBeLessThanOrEqual(8);
  });

  it('marketing costs money up front and takes effect only after a delay', async () => {
    const m = await minute(db);
    const brandBefore = (await company(bakery)).brand;
    await withTx(db, (tx) => launchCampaign(tx, player, bakery, 'mang_xa_hoi', 30_000_000, 3, m, 'camp:1'));
    expect((await company(bakery)).brand).toBe(brandBefore);
    await expect(withTx(db, (tx) => launchCampaign(tx, player, bakery, 'truyen_hinh', 100_000_000, 2, m, 'camp:tv'))).rejects.toThrow(/giai đoạn/);
    await advance(db, 1440 * 2);
    expect((await company(bakery)).brand).toBeGreaterThan(0);
  });

  it('NPC companies keep operating while players are offline, within their budgets', async () => {
    const npc = await many<{ id: string; name: string }>(db, `SELECT id, name FROM companies WHERE is_npc`);
    for (const n of npc) expect(await balance(db, acct('company', n.id, 'cash'))).toBeGreaterThanOrEqual(0);
    const produced = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM production_orders p JOIN companies c ON c.id=p.company_id WHERE c.is_npc`);
    expect(produced.n).toBeGreaterThan(0);
    const npcPurchases = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM shipments s JOIN companies c ON c.id=s.buyer_company_id WHERE c.is_npc`);
    expect(npcPurchases.n).toBeGreaterThan(0);
  });

  it('closes each game month exactly once, from the ledger, and assesses tax', async () => {
    const now = await minute(db);
    const toMonthEnd = 7 * 1440 - (now % (7 * 1440)) + 60;
    await advance(db, toMonthEnd);
    const reports = await many<{ month: number; revenue: number; tax: number; profit_before_tax: number }>(db, 'SELECT * FROM monthly_reports WHERE company_id=$1', [bakery]);
    expect(reports).toHaveLength(1);
    const r = reports[0]!;
    expect(r.revenue).toBeGreaterThan(0);
    expect(r.tax).toBe(Math.max(0, Math.round(r.profit_before_tax * 0.15)));
    // Re-running the close job does nothing.
    const { closeMonth } = await import('../src/operations');
    expect(await withTx(db, (tx) => closeMonth(tx, bakery, r.month))).toBeNull();
    expect((await many(db, 'SELECT 1 FROM monthly_reports WHERE company_id=$1', [bakery])).length).toBe(1);
  });

  it('the whole economy still balances: no money or goods appeared without a source', async () => {
    const a = await auditLedger(db);
    expect(a.ok).toBe(true);
    expect(a.cashInCirculation).toBeLessThanOrEqual(a.moneyIssued);
    await inventoryMatchesLedger();
    const negatives = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM accounts WHERE no_overdraft AND balance < 0`);
    expect(negatives.n).toBe(0);
  });

  it('business errors are typed GameErrors safe to show players', async () => {
    const m = await minute(db);
    const err = await withTx(db, (tx) => purchase(tx, player, bakery, bakery, 'bot_mi', 1, 1, m, 'self')).catch((e) => e);
    expect(err).toBeInstanceOf(GameError);
  });
});
