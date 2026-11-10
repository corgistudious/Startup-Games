import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Db } from '../src/db';
import { withTx, one } from '../src/db';
import { post, acct, balance, auditLedger, SYS } from '../src/ledger';
import { freshWorld, newPlayer, minute } from './helpers';
import { GameError } from '../src/errors';

let db: Db;
beforeAll(async () => {
  db = await freshWorld({ npcs: false });
});
afterAll(async () => db.end());

describe('double-entry ledger', () => {
  it('starter grant is a documented central-bank issuance and the books balance', async () => {
    const u = await newPlayer(db, 'ledger_a');
    expect(await balance(db, acct('user', u, 'cash'))).toBe(600_000_000);
    const a = await auditLedger(db);
    expect(a.ok).toBe(true);
    expect(a.postingsSum).toBe(0);
    expect(a.moneyIssued).toBeGreaterThanOrEqual(600_000_000);
  });

  it('rejects entries that do not balance overall or per owner', async () => {
    const u = await newPlayer(db, 'ledger_b');
    const m = await minute(db);
    await expect(withTx(db, (tx) => post(tx, { key: 'bad1', kind: 't', memo: 't', minute: m, lines: [{ ...acct('user', u, 'cash'), amount: 5 }, { ...acct('user', u, 'capital'), amount: -4 }] }))).rejects.toThrow(/unbalanced/);
    // Balanced overall but money appears from nowhere for one owner.
    await expect(
      withTx(db, (tx) => post(tx, { key: 'bad2', kind: 't', memo: 't', minute: m, lines: [{ ...acct('user', u, 'cash'), amount: 5 }, { ...SYS.households('cash'), amount: -5 }] })),
    ).rejects.toThrow(/unbalanced for/);
  });

  it('is idempotent: the same key never posts twice', async () => {
    const a = await newPlayer(db, 'ledger_c');
    const b = await newPlayer(db, 'ledger_d');
    const m = await minute(db);
    const transfer = () =>
      withTx(db, (tx) =>
        post(tx, {
          key: 'transfer:once',
          kind: 'transfer',
          memo: 'x',
          minute: m,
          lines: [
            { ...acct('user', a, 'cash'), amount: -1000 },
            { ...acct('user', a, 'capital'), amount: 1000 },
            { ...acct('user', b, 'cash'), amount: 1000 },
            { ...acct('user', b, 'capital'), amount: -1000 },
          ],
        }),
      );
    expect((await transfer()).created).toBe(true);
    expect((await transfer()).created).toBe(false);
    expect(await balance(db, acct('user', b, 'cash'))).toBe(600_001_000);
  });

  it('the database refuses overdrafts even under concurrent spending (no double spend)', async () => {
    const u = await newPlayer(db, 'ledger_race');
    const m = await minute(db);
    const spend = (i: number) =>
      withTx(db, (tx) =>
        post(tx, {
          key: `race:${i}`,
          kind: 'spend',
          memo: 'race',
          minute: m,
          lines: [
            { ...acct('user', u, 'cash'), amount: -250_000_000 },
            { ...acct('user', u, 'fees'), amount: 250_000_000 },
            { ...SYS.treasury('cash'), amount: 250_000_000 },
            { ...SYS.treasury('fee_revenue'), amount: -250_000_000 },
          ],
        }),
      );
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => spend(i)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    expect(ok).toBe(2); // 600M only covers two spends of 250M
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(GameError);
    expect(await balance(db, acct('user', u, 'cash'))).toBe(100_000_000);
    expect((await auditLedger(db)).ok).toBe(true);
  });

  it('postings are append-only', async () => {
    await expect(db.query('UPDATE postings SET amount = amount + 1')).rejects.toThrow(/append-only/);
    await expect(db.query('DELETE FROM journal_entries')).rejects.toThrow(/append-only/);
    const n = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM postings');
    expect(n.n).toBeGreaterThan(0);
  });
});
