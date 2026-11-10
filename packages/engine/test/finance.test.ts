import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Db } from '../src/db';
import { withTx, one, many } from '../src/db';
import { balance, acct, auditLedger } from '../src/ledger';
import { createCompany, type CompanyRow } from '../src/companies';
import { hire } from '../src/hr';
import { ipo, placeOrder, cancelOrder, payDividend, ipoEligibility, orderBook } from '../src/exchange';
import { takeLoan, repayLoan, loanDaily } from '../src/bank';
import { freshWorld, newPlayer, minute, advance } from './helpers';

let db: Db;
let founder: string;
let alice: string;
let bob: string;
let co: CompanyRow;

beforeAll(async () => {
  db = await freshWorld({ npcs: false });
  founder = await newPlayer(db, 'issuer');
  alice = await newPlayer(db, 'alice');
  bob = await newPlayer(db, 'bob');
  const m = await minute(db);
  const id = await withTx(db, (tx) => createCompany(tx, founder, { name: 'Công Ty Sao Mai', industry: 'tiem_banh', location: 'thu_duc', capital: 400_000_000 }, m));
  co = await one<CompanyRow>(db, 'SELECT * FROM companies WHERE id=$1', [id]);
});
afterAll(async () => db.end());

const cash = (u: string) => balance(db, acct('user', u, 'cash'));
const locked = (u: string) => balance(db, acct('user', u, 'cash_locked'));
const shares = async (u: string, symbol = 'SMI') => (await one<{ qty: number; locked: number } | undefined>(db, 'SELECT qty, locked FROM holdings WHERE symbol=$1 AND holder_type=$2 AND holder_id=$3', [symbol, 'user', u]).catch(() => ({ qty: 0, locked: 0 })))!;

describe('bank', () => {
  it('lends from finite bank reserves within a credit limit, then accrues and collects interest on schedule', async () => {
    await advance(db, 8 * 60 + 30); // license granted -> founder becomes stage 2
    const m = await minute(db);
    await expect(withTx(db, (tx) => takeLoan(tx, founder, { type: 'company', id: co.id }, 5_000_000_000, 28, m, 'loan:big'))).rejects.toThrow(/hạn mức/);
    const loanId = await withTx(db, (tx) => takeLoan(tx, founder, { type: 'company', id: co.id }, 100_000_000, 28, m, 'loan:1'));
    expect(await balance(db, acct('company', co.id, 'loan_payable'))).toBe(-100_000_000);
    await withTx(db, (tx) => loanDaily(tx, loanId, 999, m));
    const l = await one<{ interest_due: number }>(db, 'SELECT interest_due FROM loans WHERE id=$1', [loanId]);
    expect(l.interest_due).toBe(Math.round((100_000_000 * 35) / 10_000));
    await withTx(db, (tx) => repayLoan(tx, (x) => x.borrower_id === co.id, loanId, 100_000_000 + l.interest_due, m, 'repay:1'));
    const after = await one<{ status: string; outstanding: number }>(db, 'SELECT status, outstanding FROM loans WHERE id=$1', [loanId]);
    expect(after).toEqual({ status: 'repaid', outstanding: 0 });
    expect(await balance(db, acct('system', 'bank', 'interest_income'))).toBe(-l.interest_due);
  });
});

describe('stock exchange', () => {
  it('rejects IPO until listing conditions are met', async () => {
    const el = await ipoEligibility(db, co, await minute(db));
    expect(el.eligible).toBe(false);
    expect(el.reasons.length).toBeGreaterThan(1);
  });

  it('IPO places a real sell order; no shares change hands without buyers', async () => {
    // Arrange listing conditions directly (covered by other tests individually).
    await db.query('UPDATE users SET stage=3 WHERE id=$1', [founder]);
    await db.query('UPDATE companies SET founded_minute = founded_minute - 20*1440 WHERE id=$1', [co.id]);
    await db.query(`INSERT INTO monthly_reports (company_id, month, revenue, cogs, wages, marketing, operating, interest, profit_before_tax, tax, net_profit, cash_end, inventory_end, debt_end) VALUES ($1, 0, 900000000, 1,1,1,1,1, 100000000, 15000000, 85000000, 1,1,0)`, [co.id]);
    const m = await minute(db);
    const people = await many<{ id: string; wage_expectation: number }>(db, `SELECT id, wage_expectation FROM people WHERE status='seeking' LIMIT 8`);
    for (const p of people) await withTx(db, (tx) => hire(tx, founder, co.id, p.id, p.wage_expectation, 'day', 'san_xuat', m));
    co = await one<CompanyRow>(db, 'SELECT * FROM companies WHERE id=$1', [co.id]);
    const cashBefore = await balance(db, acct('company', co.id, 'cash'));
    await withTx(db, (tx) => ipo(tx, founder, co, { symbol: 'SMI', totalShares: 1_000_000, offerShares: 300_000, offerPrice: 1_000 }, m));
    expect((await shares(founder)).qty).toBe(700_000);
    const book = await orderBook(db, 'SMI');
    expect(book.asks[0]).toMatchObject({ price: 1_000, qty: 300_000 });
    expect(await balance(db, acct('company', co.id, 'cash'))).toBe(cashBefore); // no proceeds until buyers match
  });

  it('a market buy with no liquidity is rejected instead of inventing shares', async () => {
    const m = await minute(db);
    await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: alice }, { symbol: 'SMI', side: 'buy', type: 'market', qty: 300_000 }, m));
    // Alice took the whole IPO; the book is now empty on the ask side.
    await expect(withTx(db, (tx) => placeOrder(tx, { type: 'user', id: bob }, { symbol: 'SMI', side: 'buy', type: 'market', qty: 10 }, m))).rejects.toThrow(/Không có lệnh bán/);
    expect((await shares(alice)).qty).toBe(300_000);
    expect(await cash(alice)).toBe(600_000_000 - 300_000_000);
    expect(await locked(alice)).toBe(0);
  });

  it('limit orders lock cash/shares, rest on the book, match by price then time, and fill partially', async () => {
    const m = await minute(db);
    await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: bob }, { symbol: 'SMI', side: 'buy', type: 'limit', qty: 1_000, price: 1_100 }, m));
    expect(await locked(bob)).toBe(1_100_000);
    const bobEarly = await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: bob }, { symbol: 'SMI', side: 'buy', type: 'limit', qty: 500, price: 1_200 }, m));
    // Alice sells 1,200 at 1,000: best bid (1,200) fills first, then 1,100 partially.
    const res = await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: alice }, { symbol: 'SMI', side: 'sell', type: 'limit', qty: 1_200, price: 1_000 }, m));
    expect(res.trades).toBe(2);
    const trades = await many<{ price: number; qty: number }>(db, 'SELECT price, qty FROM trades WHERE symbol=$1 ORDER BY id DESC LIMIT 2', ['SMI']);
    expect(trades.reverse()).toEqual([{ price: 1_200, qty: 500 }, { price: 1_100, qty: 700 }]);
    expect((await shares(bob)).qty).toBe(1_200);
    expect(await locked(bob)).toBe(300 * 1_100); // remaining 300 of the 1,100 bid still locked
    const last = await one<{ last_price: number }>(db, `SELECT last_price FROM instruments WHERE symbol='SMI'`);
    expect(last.last_price).toBe(1_100);
    void bobEarly;
  });

  it('cancel releases exactly the locked funds and shares', async () => {
    const m = await minute(db);
    const open = await one<{ id: string }>(db, `SELECT id FROM orders WHERE owner_id=$1 AND status='open' AND side='buy'`, [bob]);
    const before = await cash(bob);
    await withTx(db, (tx) => cancelOrder(tx, { type: 'user', id: bob }, open.id, m));
    expect(await locked(bob)).toBe(0);
    expect(await cash(bob)).toBe(before + 330_000);
    const sell = await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: alice }, { symbol: 'SMI', side: 'sell', type: 'limit', qty: 100, price: 1_300 }, m));
    expect((await shares(alice)).locked).toBe(100);
    await withTx(db, (tx) => cancelOrder(tx, { type: 'user', id: alice }, sell.orderId, m));
    expect((await shares(alice)).locked).toBe(0);
    await expect(withTx(db, (tx) => cancelOrder(tx, { type: 'user', id: bob }, sell.orderId, m))).rejects.toThrow(/Không tìm thấy/);
  });

  it('cannot sell more shares than available or trade outside the price band', async () => {
    const m = await minute(db);
    await expect(withTx(db, (tx) => placeOrder(tx, { type: 'user', id: bob }, { symbol: 'SMI', side: 'sell', type: 'limit', qty: 5_000, price: 1_100 }, m))).rejects.toThrow(/Không đủ cổ phiếu/);
    await expect(withTx(db, (tx) => placeOrder(tx, { type: 'user', id: bob }, { symbol: 'SMI', side: 'buy', type: 'limit', qty: 10, price: 5_000 }, m))).rejects.toThrow(/biên độ/);
  });

  it('pays dividends pro-rata from company cash to holders', async () => {
    const m = await minute(db);
    const aliceBefore = await cash(alice);
    const aliceShares = (await shares(alice)).qty;
    await withTx(db, (tx) => payDividend(tx, founder, co, 10, m, 'div:1'));
    expect(await cash(alice)).toBe(aliceBefore + aliceShares * 10);
    await expect(withTx(db, (tx) => payDividend(tx, founder, co, 10, m, 'div:1'))).rejects.toThrow(/Đã chi trả/);
  });

  it('concurrent orders on one symbol never oversell or double-fill', async () => {
    const m = await minute(db);
    const buyers = await Promise.all(Array.from({ length: 5 }, (_, i) => newPlayer(db, `racer${i}`)));
    await withTx(db, (tx) => placeOrder(tx, { type: 'user', id: alice }, { symbol: 'SMI', side: 'sell', type: 'limit', qty: 1_000, price: 1_100 }, m));
    await Promise.allSettled(buyers.map((b) => withTx(db, (tx) => placeOrder(tx, { type: 'user', id: b }, { symbol: 'SMI', side: 'buy', type: 'limit', qty: 400, price: 1_100 }, m))));
    const filled = await one<{ s: number }>(db, `SELECT COALESCE(SUM(qty),0)::bigint AS s FROM holdings WHERE symbol='SMI' AND holder_id = ANY($1)`, [buyers]);
    expect(filled.s).toBe(1_000);
    const total = await one<{ s: number }>(db, `SELECT SUM(qty)::bigint AS s FROM holdings WHERE symbol='SMI'`);
    expect(total.s).toBe(1_000_000);
    expect((await auditLedger(db)).ok).toBe(true);
  });
});
