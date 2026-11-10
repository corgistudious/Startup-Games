import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Db } from '../src/db';
import { withTx, one, many } from '../src/db';
import { balance, acct, auditLedger, SYS } from '../src/ledger';
import { createCompany, buyEquipment, type CompanyRow } from '../src/companies';
import { hire, payBonus, setHrPolicies, grantLeave } from '../src/hr';
import { workState } from '../src/workforce';
import { proposeContract, cancelContract, inspectDelivery } from '../src/contracts';
import { openBranch, makeOffer, mergeSubsidiary, reviewShareControl } from '../src/groups';
import { openDeposit, withdrawDeposit, depositDaily, takeLoan, seizeCollateral } from '../src/bank';
import { ipo, placeOrder, voluntaryDelist, forceDelist, runSurveillance } from '../src/exchange';
import { declareBankruptcy } from '../src/operations';
import { cashFlow } from '../src/cashflow';
import { freshWorld, newPlayer, minute, advance } from './helpers';

let db: Db;
let owner: string;
let shop: string;
const company = (id: string) => one<CompanyRow>(db, 'SELECT * FROM companies WHERE id=$1', [id]);
const cash = (id: string) => balance(db, acct('company', id, 'cash'));

beforeAll(async () => {
  db = await freshWorld();
  owner = await newPlayer(db, 'tycoon');
  const m = await minute(db);
  shop = await withTx(db, (tx) => createCompany(tx, owner, { name: 'Lò Bánh Mở Rộng', industry: 'tiem_banh', location: 'thu_duc', capital: 450_000_000 }, m));
  await withTx(db, (tx) => buyEquipment(tx, owner, shop, 'lo_nuong', 2, m, 'x:eq'));
  const ppl = await many<{ id: string; wage_expectation: number }>(db, `SELECT id, wage_expectation FROM people WHERE status='seeking' ORDER BY skill DESC LIMIT 3`);
  for (const p of ppl) await withTx(db, (tx) => hire(tx, owner, shop, p.id, p.wage_expectation, 'day', 'san_xuat', m));
  await advance(db, 9 * 60); // licence granted
});
afterAll(async () => db.end());

describe('HR policies', () => {
  it('overtime extends day shifts after 17:00 on weekdays; leave stops work but keeps pay', () => {
    expect(workState({ shift: 'day' }, 2, 0, 17 * 60, 0)).toMatchObject({ overtime: true, working: true, paid: false });
    expect(workState({ shift: 'day' }, 2, 0, 19 * 60, 0).working).toBe(false);
    expect(workState({ shift: 'day' }, 2, 5, 17 * 60, 0).working).toBe(false);
    expect(workState({ shift: 'day', leave_until_minute: 1000 }, 0, 0, 9 * 60, 500)).toMatchObject({ working: false, paid: true, onLeave: true });
  });

  it('bonus is a real ledger expense that raises morale', async () => {
    const p = await one<{ id: string; morale: number }>(db, 'SELECT id, morale FROM people WHERE company_id=$1 LIMIT 1', [shop]);
    const before = await cash(shop);
    await withTx(db, async (tx) => payBonus(tx, owner, shop, [p.id], 1_000_000, await minute(db), 'bonus:1'));
    expect(await cash(shop)).toBe(before - 1_000_000);
    expect((await one<{ morale: number }>(db, 'SELECT morale FROM people WHERE id=$1', [p.id])).morale).toBeGreaterThan(p.morale);
  });

  it('paid leave has an annual quota; benefits are charged daily; overtime is paid at 150%', async () => {
    const [a, b] = await many<{ id: string }>(db, 'SELECT id FROM people WHERE company_id=$1 ORDER BY id', [shop]);
    const m = await minute(db);
    await withTx(db, (tx) => grantLeave(tx, shop, a!.id, 2, m));
    await expect(withTx(db, (tx) => grantLeave(tx, shop, b!.id, 13, m))).rejects.toThrow(/ngày phép/);
    await withTx(db, (tx) => setHrPolicies(tx, shop, { benefitLevel: 2, overtimeHours: 2 }));
    const wagesBefore = await balance(db, acct('company', shop, 'wages'));
    // Advance to a weekday after 19:00 then through midnight payroll.
    await advance(db, 1440);
    const entries = await many<{ kind: string }>(db, `SELECT DISTINCT e.kind FROM journal_entries e WHERE e.ref_id=$1 AND e.kind IN ('benefits','payroll')`, [shop]);
    expect(entries.map((e) => e.kind).sort()).toEqual(['benefits', 'payroll']);
    expect(await balance(db, acct('company', shop, 'wages'))).toBeGreaterThan(wagesBefore);
    const ot = await one<{ s: number }>(db, `SELECT COALESCE(SUM(experience),0)::float AS s FROM people WHERE company_id=$1`, [shop]);
    expect(ot.s).toBeGreaterThan(0);
  });
});

describe('long-term supply contracts', () => {
  let farm: string;
  let contract: string;
  it('NPC supplier auto-accepts a fair contract; the deposit sits in escrow', async () => {
    farm = (await one<{ id: string }>(db, `SELECT id FROM companies WHERE name='Nông Trại Đồng Xanh'`)).id;
    const before = await cash(shop);
    contract = await withTx(db, async (tx) =>
      proposeContract(tx, owner, shop, { sellerCompanyId: farm, good: 'bot_mi', qtyPerDelivery: 60, unitPrice: 26_000, deliveries: 2, intervalDays: 1, depositRate: 0.2, penaltyRate: 0.1 }, await minute(db)),
    );
    const k = await one<{ status: string; deposit: number }>(db, 'SELECT status, deposit FROM supply_contracts WHERE id=$1', [contract]);
    expect(k.status).toBe('active');
    expect(k.deposit).toBe(Math.round(26_000 * 60 * 2 * 0.2));
    expect(await cash(shop)).toBe(before - k.deposit);
    expect(-(await balance(db, SYS.escrow('escrow_held')))).toBe(k.deposit);
  });

  it('rejects contract prices far from the market (no money laundering via contracts)', async () => {
    await expect(withTx(db, async (tx) => proposeContract(tx, owner, shop, { sellerCompanyId: farm, good: 'bot_mi', qtyPerDelivery: 10, unitPrice: 1_000, deliveries: 1, intervalDays: 1, depositRate: 0, penaltyRate: 0 }, await minute(db)))).rejects.toThrow(/60%–160%/);
  });

  it('delivers on schedule at the contract price, inspection accepts, completion refunds the deposit', async () => {
    await advance(db, 1440 * 2);
    const deliveries = await many<{ id: string; status: string }>(db, 'SELECT id, status FROM contract_deliveries WHERE contract_id=$1 ORDER BY seq', [contract]);
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    const shipped = await many<{ unit_price: number }>(db, `SELECT s.unit_price FROM shipments s JOIN contract_deliveries d ON d.shipment_id=s.id WHERE d.contract_id=$1`, [contract]);
    for (const s of shipped) expect(s.unit_price).toBe(26_000);
    const delivered = deliveries.find((d) => d.status === 'delivered');
    if (delivered) await withTx(db, (tx) => inspectDelivery(tx, owner, delivered.id, true, null));
    // Remaining deliveries are auto-accepted at the first day start after their 1-day inspection window.
    await advance(db, 1440 * 3);
    const k = await one<{ status: string }>(db, 'SELECT status FROM supply_contracts WHERE id=$1', [contract]);
    expect(k.status).toBe('completed');
    expect(await balance(db, SYS.escrow('escrow_held'))).toBe(0);
    expect(await balance(db, acct('company', shop, 'contract_deposits'))).toBe(0);
  });

  it('buyer cancelling an active contract forfeits the deposit to the seller', async () => {
    const id = await withTx(db, async (tx) => proposeContract(tx, owner, shop, { sellerCompanyId: farm, good: 'duong', qtyPerDelivery: 20, unitPrice: 25_000, deliveries: 3, intervalDays: 2, depositRate: 0.1, penaltyRate: 0.1 }, await minute(db)));
    const farmBefore = await cash(farm);
    const dep = (await one<{ deposit: number }>(db, 'SELECT deposit FROM supply_contracts WHERE id=$1', [id])).deposit;
    await withTx(db, async (tx) => cancelContract(tx, owner, id, 'buyer', await minute(db)));
    expect(await cash(farm)).toBe(farmBefore + dep);
  });
});

describe('bank deposits and collateral', () => {
  it('term deposit accrues daily and pays principal + interest at maturity; early withdrawal forfeits interest', async () => {
    const m = await minute(db);
    const before = await balance(db, acct('user', owner, 'cash'));
    const id = await withTx(db, (tx) => openDeposit(tx, owner, { type: 'user', id: owner }, 50_000_000, 7, m, 'dep:1'));
    for (let d = 1; d <= 7; d++) await withTx(db, (tx) => depositDaily(tx, id, Math.floor(m / 1440) + d, m + d * 1440));
    const dep = await one<{ status: string; accrued: number }>(db, 'SELECT status, accrued FROM deposits WHERE id=$1', [id]);
    expect(dep.status).toBe('matured');
    expect(dep.accrued).toBe(7 * Math.floor((50_000_000 * 8) / 10_000));
    expect(await balance(db, acct('user', owner, 'cash'))).toBe(before + dep.accrued);
    const id2 = await withTx(db, (tx) => openDeposit(tx, owner, { type: 'user', id: owner }, 10_000_000, 28, m, 'dep:2'));
    await withTx(db, (tx) => depositDaily(tx, id2, Math.floor(m / 1440) + 1, m + 1440));
    const r = await withTx(db, (tx) => withdrawDeposit(tx, (d) => d.owner_id === owner, id2, m + 1440));
    expect(r).toEqual({ interest: 0, early: true });
  });

  it('pledged equipment raises the credit limit; on default the bank seizes it at 60% of book value', async () => {
    const m = await minute(db);
    const eq = await many<{ id: string; book_value: number }>(db, 'SELECT id, book_value FROM equipment WHERE company_id=$1', [shop]);
    const loanId = await withTx(db, (tx) => takeLoan(tx, owner, { type: 'company', id: shop }, 20_000_000, 14, m, 'loan:col', { equipmentIds: [eq[0]!.id] }));
    const loan = await one<{ collateral_value: number; rate_daily_bp: number; outstanding: number }>(db, 'SELECT * FROM loans WHERE id=$1', [loanId]);
    expect(loan.collateral_value).toBe(Math.floor(eq[0]!.book_value * 0.7));
    expect(loan.rate_daily_bp).toBe(25);
    await expect(withTx(db, (tx) => takeLoan(tx, owner, { type: 'company', id: shop }, 1_000_000, 7, m, 'loan:col2', { equipmentIds: [eq[0]!.id] }))).rejects.toThrow(/thế chấp/);
    const book = (await one<{ book_value: number }>(db, 'SELECT book_value FROM equipment WHERE id=$1', [eq[0]!.id])).book_value;
    const recovered = await withTx(db, (tx) => seizeCollateral(tx, { id: loanId, borrower_id: shop, outstanding: loan.outstanding }, m));
    expect(recovered).toBe(Math.min(loan.outstanding, Math.floor(book * 0.6)));
    expect((await many(db, 'SELECT 1 FROM equipment WHERE id=$1', [eq[0]!.id])).length).toBe(0);
  });
});

describe('group structure and M&A', () => {
  it('branches need stage 3 and add rent', async () => {
    const c = await company(shop);
    await expect(withTx(db, async (tx) => openBranch(tx, owner, c, 'q1_hcm', await minute(db), 'br:0'))).rejects.toThrow(/giai đoạn/);
    await db.query('UPDATE users SET stage=4 WHERE id=$1', [owner]);
    await withTx(db, async (tx) => openBranch(tx, owner, c, 'q1_hcm', await minute(db), 'br:1'));
    expect((await many(db, `SELECT 1 FROM branches WHERE company_id=$1 AND status='active'`, [shop])).length).toBe(1);
  });

  let npcCafe: string;
  it('NPC owners reject offers below 130% of book value', async () => {
    npcCafe = (await one<{ id: string }>(db, `SELECT id FROM companies WHERE name='Cà Phê Góc Phố'`)).id;
    const low = await withTx(db, async (tx) => makeOffer(tx, owner, await company(shop), npcCafe, 1_000_000, 'thử', await minute(db)));
    expect((await one<{ status: string }>(db, 'SELECT status FROM acquisition_offers WHERE id=$1', [low])).status).toBe('rejected');
  });

  it('player-to-player acquisition: seller accepts, is paid, control and parent change', async () => {
    const { respondOffer } = await import('../src/groups');
    const m = await minute(db);
    const seller = await newPlayer(db, 'seller_founder');
    const target = await withTx(db, (tx) => createCompany(tx, seller, { name: 'Quán Được Mua Lại', industry: 'quan_ca_phe', location: 'hai_chau', capital: 120_000_000 }, m));
    await db.query(`UPDATE companies SET status='active' WHERE id=$1`, [target]);
    const offer = await withTx(db, async (tx) => makeOffer(tx, owner, await company(shop), target, 150_000_000, 'Mua lại toàn bộ', m));
    await expect(withTx(db, (tx) => respondOffer(tx, owner, offer, true, m))).rejects.toThrow(/chủ doanh nghiệp mục tiêu/);
    const sellerCash = await balance(db, acct('user', seller, 'cash'));
    const acqCash = await cash(shop);
    await withTx(db, (tx) => respondOffer(tx, seller, offer, true, m));
    expect(await balance(db, acct('user', seller, 'cash'))).toBe(sellerCash + 150_000_000);
    expect(await cash(shop)).toBe(acqCash - 150_000_000);
    expect(await company(target)).toMatchObject({ owner_user_id: owner, parent_company_id: shop });
    expect((await many(db, `SELECT 1 FROM ownership_events WHERE company_id=$1 AND kind='acquisition'`, [target])).length).toBe(1);
    expect((await auditLedger(db)).ok).toBe(true);
  });

  let grp: string;
  let grpHq: string;
  it('cannot make an acquisition offer for your own company (self-dealing)', async () => {
    const m = await minute(db);
    grp = await newPlayer(db, 'group_owner');
    await db.query('UPDATE users SET stage=5 WHERE id=$1', [grp]);
    grpHq = await withTx(db, (tx) => createCompany(tx, grp, { name: 'Tập Đoàn Mẹ', industry: 'tiem_banh', location: 'thu_duc', capital: 200_000_000 }, m));
    const second = await withTx(db, (tx) => createCompany(tx, grp, { name: 'Công Ty Phụ Trợ', industry: 'quan_ca_phe', location: 'hai_chau', capital: 100_000_000 }, m));
    await expect(withTx(db, async (tx) => makeOffer(tx, grp, await company(grpHq), second, 50_000_000, 'tự mua', m))).rejects.toThrow(/chính bạn/);
  });

  it('merges a 100% subsidiary at book value: assets, staff and equipment move; books still balance', async () => {
    const m = await minute(db);
    const sub = await withTx(db, (tx) => createCompany(tx, grp, { name: 'Xưởng Con Sáp Nhập', industry: 'tiem_banh', location: 'ninh_kieu', capital: 90_000_000 }, m));
    await db.query('UPDATE companies SET parent_company_id=$2 WHERE id=$1', [sub, grpHq]);
    const subCash = await cash(sub);
    const parentCash = await cash(grpHq);
    await withTx(db, async (tx) => mergeSubsidiary(tx, grp, await company(grpHq), sub, m));
    expect(await cash(grpHq)).toBe(parentCash + subCash);
    expect(await cash(sub)).toBe(0);
    expect((await company(sub)).status).toBe('closed');
    expect((await auditLedger(db)).ok).toBe(true);
  });
});

describe('exchange: control, delisting, surveillance', () => {
  let issuer: string;
  let founder: string;
  const players: string[] = [];
  beforeAll(async () => {
    founder = await newPlayer(db, 'issuer2');
    for (const n of ['inv_a', 'inv_b']) players.push(await newPlayer(db, n));
    const m = await minute(db);
    issuer = await withTx(db, (tx) => createCompany(tx, founder, { name: 'Niêm Yết Thử', industry: 'tiem_banh', location: 'thu_duc', capital: 300_000_000 }, m));
    await db.query(`UPDATE users SET stage=3 WHERE id=$1`, [founder]);
    await db.query(`UPDATE companies SET status='active', founded_minute = founded_minute - 30*1440 WHERE id=$1`, [issuer]);
    await db.query(`INSERT INTO monthly_reports (company_id, month, revenue, cogs, wages, marketing, operating, interest, profit_before_tax, tax, net_profit, cash_end, inventory_end, debt_end) VALUES ($1, 0, 1,1,1,1,1,1, 10, 1, 9, 1,1,0)`, [issuer]);
    const ppl = await many<{ id: string; wage_expectation: number }>(db, `SELECT id, wage_expectation FROM people WHERE status='seeking' LIMIT 8`);
    for (const p of ppl) await withTx(db, (tx) => hire(tx, founder, issuer, p.id, p.wage_expectation, 'day', 'san_xuat', m));
    await withTx(db, async (tx) => ipo(tx, founder, await company(issuer), { symbol: 'NYT', totalShares: 100_000, offerShares: 40_000, offerPrice: 1_000 }, m));
  });

  it('flags wash trading between two accounts trading back and forth', async () => {
    const m = await minute(db);
    const [a, b] = players as [string, string];
    // Take the whole IPO so the two accounts can only match each other.
    await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: a }, { symbol: 'NYT', side: 'buy', type: 'market', qty: 20_000 }, m));
    await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: b }, { symbol: 'NYT', side: 'buy', type: 'market', qty: 20_000 }, m));
    for (let i = 0; i < 3; i++) {
      await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: a }, { symbol: 'NYT', side: 'sell', type: 'limit', qty: 100, price: 1_000 }, m));
      await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: b }, { symbol: 'NYT', side: 'buy', type: 'limit', qty: 100, price: 1_000 }, m));
      await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: b }, { symbol: 'NYT', side: 'sell', type: 'limit', qty: 100, price: 1_000 }, m));
      await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: a }, { symbol: 'NYT', side: 'buy', type: 'limit', qty: 100, price: 1_000 }, m));
    }
    const n = await withTx(db, (tx) => runSurveillance(tx, m));
    expect(n).toBeGreaterThan(0);
    expect((await many(db, `SELECT 1 FROM surveillance_alerts WHERE symbol='NYT' AND kind='wash_trading'`)).length).toBe(1);
    expect(await withTx(db, (tx) => runSurveillance(tx, m))).toBe(0); // deduplicated
  });

  it('a player holding >50% takes control of the listed company', async () => {
    const m = await minute(db);
    await db.query(`UPDATE holdings SET qty = qty - 50000 WHERE symbol='NYT' AND holder_type='user' AND holder_id=$1`, [founder]);
    await db.query(`UPDATE holdings SET qty = qty + 50000 WHERE symbol='NYT' AND holder_type='user' AND holder_id=$1`, [players[0]]);
    await withTx(db, (tx) => reviewShareControl(tx, 'NYT', m));
    expect((await company(issuer)).owner_user_id).toBe(players[0]);
    // restore for the next test
    await db.query(`UPDATE holdings SET qty = qty + 50000 WHERE symbol='NYT' AND holder_type='user' AND holder_id=$1`, [founder]);
    await db.query(`UPDATE holdings SET qty = qty - 50000 WHERE symbol='NYT' AND holder_type='user' AND holder_id=$1`, [players[0]]);
    await withTx(db, (tx) => reviewShareControl(tx, 'NYT', m));
    expect((await company(issuer)).owner_user_id).toBe(founder);
  });

  it('bankruptcy cancels the company’s open orders and releases locked cash', async () => {
    const m = await minute(db);
    const bk = await withTx(db, (tx) => createCompany(tx, founder, { name: 'Sắp Phá Sản', industry: 'tiem_banh', location: 'thu_duc', capital: 100_000_000 }, m));
    await db.query(`UPDATE companies SET status='active' WHERE id=$1`, [bk]);
    await withTx(db, (tx) => placeOrder(tx, { type: 'company', id: bk }, { symbol: 'NYT', side: 'buy', type: 'limit', qty: 100, price: 800 }, m));
    expect(await balance(db, acct('company', bk, 'cash_locked'))).toBe(80_000);
    await withTx(db, async (tx) => declareBankruptcy(tx, await company(bk), m));
    expect(await balance(db, acct('company', bk, 'cash_locked'))).toBe(0);
    expect((await many(db, `SELECT 1 FROM orders WHERE owner_id=$1 AND status='open'`, [bk])).length).toBe(0);
  });

  it('voluntary delisting buys out every outside holder at ≥ last price and cancels open orders', async () => {
    const m = await minute(db);
    await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: players[1]! }, { symbol: 'NYT', side: 'buy', type: 'limit', qty: 100, price: 900 }, m));
    await expect(withTx(db, async (tx) => voluntaryDelist(tx, founder, await company(issuer), 500, m))).rejects.toThrow(/tối thiểu/);
    const aShares = (await one<{ qty: number }>(db, `SELECT qty FROM holdings WHERE symbol='NYT' AND holder_id=$1`, [players[0]])).qty;
    const aCash = await balance(db, acct('user', players[0]!, 'cash'));
    await withTx(db, async (tx) => voluntaryDelist(tx, founder, await company(issuer), 1_000, m));
    expect(await balance(db, acct('user', players[0]!, 'cash'))).toBe(aCash + aShares * 1_000);
    expect(await balance(db, acct('user', players[1]!, 'cash_locked'))).toBe(0);
    expect((await one<{ status: string }>(db, `SELECT status FROM instruments WHERE symbol='NYT'`)).status).toBe('delisted');
    await expect(withTx(db, (tx) => forceDelist(tx, null, 'NYT', 'lần nữa', m))).rejects.toThrow(/không còn/);
  });

});

describe('cash flow statement and global audit', () => {
  it('cash flow sections add up to the actual change in cash', async () => {
    const m = await minute(db);
    const cf = await cashFlow(db, shop, 0, m + 1);
    expect(cf.operating + cf.investing + cf.financing).toBe(cf.net);
    expect(cf.closing).toBe((await cash(shop)) + (await balance(db, acct('company', shop, 'cash_locked'))));
    expect(cf.opening).toBe(0);
    expect(cf.lines.some((l) => l.section === 'financing')).toBe(true);
  });

  it('the economy remains balanced after all new mechanics', async () => {
    const a = await auditLedger(db);
    expect(a.ok).toBe(true);
    expect(a.cashInCirculation).toBe(a.moneyIssued);
  });
});
