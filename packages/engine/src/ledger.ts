import type { Tx, Queryable } from './db';
import { many, maybe } from './db';
import { fail, mapDbError } from './errors';

export type OwnerType = 'system' | 'user' | 'company';
export type Kind = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/**
 * Chart of accounts. `noOverdraft` cash-like accounts are protected by a DB CHECK,
 * so no code path (or race) can spend money that is not there.
 */
const CHART: Record<string, { kind: Kind; noOverdraft?: boolean }> = {
  cash: { kind: 'asset', noOverdraft: true },
  cash_locked: { kind: 'asset', noOverdraft: true },
  inventory: { kind: 'asset', noOverdraft: true },
  inventory_transit: { kind: 'asset', noOverdraft: true },
  wip: { kind: 'asset', noOverdraft: true },
  equipment: { kind: 'asset' },
  investments: { kind: 'asset' },
  loans_receivable: { kind: 'asset' },
  loan_payable: { kind: 'liability' },
  wages_payable: { kind: 'liability' },
  tax_payable: { kind: 'liability' },
  other_payable: { kind: 'liability' },
  currency_issued: { kind: 'liability' },
  share_capital: { kind: 'equity' },
  capital: { kind: 'equity' },
  dividends_paid: { kind: 'equity' },
  sales_revenue: { kind: 'revenue' },
  other_income: { kind: 'revenue' },
  dividend_income: { kind: 'revenue' },
  trading_gain: { kind: 'revenue' },
  interest_income: { kind: 'revenue' },
  income: { kind: 'revenue' },
  tax_revenue: { kind: 'revenue' },
  fee_revenue: { kind: 'revenue' },
  cogs: { kind: 'expense' },
  wages: { kind: 'expense' },
  marketing: { kind: 'expense' },
  rent: { kind: 'expense' },
  maintenance: { kind: 'expense' },
  freight: { kind: 'expense' },
  fees: { kind: 'expense' },
  interest: { kind: 'expense' },
  tax: { kind: 'expense' },
  depreciation: { kind: 'expense' },
  spoilage: { kind: 'expense' },
  consumption: { kind: 'expense' },
  policy_expense: { kind: 'expense' },
  transfers: { kind: 'expense' },
  credit_losses: { kind: 'expense' },
};

export type AccountRef = { type: OwnerType; id: string; code: string };
export type Line = AccountRef & { amount: number }; // debit-positive

export const acct = (type: OwnerType, id: string, code: string): AccountRef => ({ type, id, code });
export const SYS = {
  centralBank: (code: string) => acct('system', 'central_bank', code),
  households: (code: string) => acct('system', 'households', code),
  treasury: (code: string) => acct('system', 'treasury', code),
  bank: (code: string) => acct('system', 'bank', code),
};

export type PostInput = {
  key: string; // idempotency key, globally unique
  kind: string;
  memo: string;
  minute: number;
  lines: Line[];
  actorId?: string | null;
  ref?: { type: string; id: string };
};

/** No caching: an id inserted by a transaction that later rolls back must never be reused. */
export async function ensureAccount(tx: Queryable, r: AccountRef): Promise<number> {
  const def = CHART[r.code];
  if (!def) throw new Error(`unknown account code ${r.code}`);
  const found = await maybe<{ id: number }>(tx, 'SELECT id FROM accounts WHERE owner_type=$1 AND owner_id=$2 AND code=$3', [r.type, r.id, r.code]);
  if (found) return found.id;
  const row = await maybe<{ id: number }>(
    tx,
    `INSERT INTO accounts (owner_type, owner_id, code, kind, no_overdraft) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (owner_type, owner_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
    [r.type, r.id, r.code, def.kind, def.noOverdraft ?? false],
  );
  return row!.id;
}

/**
 * Post a balanced journal entry. Rules:
 *  - lines sum to zero overall AND per owner (every entity's own books balance);
 *  - the idempotency key makes retries safe: a repeated key returns { created: false }
 *    without touching balances;
 *  - balances update under row locks taken in account-id order (no deadlocks).
 */
export async function post(tx: Tx, input: PostInput): Promise<{ created: boolean; entryId?: string }> {
  const lines = input.lines.filter((l) => l.amount !== 0);
  if (lines.length < 2) fail('ledger_empty', 'Bút toán không hợp lệ.');
  for (const l of lines) if (!Number.isSafeInteger(l.amount)) throw new Error(`non-integer amount in ${input.key}`);
  const perOwner = new Map<string, number>();
  let total = 0;
  for (const l of lines) {
    total += l.amount;
    const o = `${l.type}:${l.id}`;
    perOwner.set(o, (perOwner.get(o) ?? 0) + l.amount);
  }
  if (total !== 0) throw new Error(`unbalanced entry ${input.key}: ${total}`);
  for (const [o, s] of perOwner) if (s !== 0) throw new Error(`entry ${input.key} unbalanced for ${o}: ${s}`);

  const entry = await maybe<{ id: string }>(
    tx,
    `INSERT INTO journal_entries (idempotency_key, kind, memo, game_minute, actor_id, ref_type, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
    [input.key, input.kind, input.memo, input.minute, input.actorId ?? null, input.ref?.type ?? null, input.ref?.id ?? null],
  );
  if (!entry) return { created: false };

  const resolved: (Line & { accountId: number })[] = [];
  for (const l of lines) resolved.push({ ...l, accountId: await ensureAccount(tx, l) });
  const byAccount = new Map<number, number>();
  for (const l of resolved) byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) + l.amount);
  const ids = [...byAccount.keys()].sort((a, b) => a - b);
  try {
    // Lock in id order, then apply.
    await tx.query('SELECT id FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE', [ids]);
    for (const id of ids) {
      const amt = byAccount.get(id)!;
      if (amt !== 0) await tx.query('UPDATE accounts SET balance = balance + $2 WHERE id = $1', [id, amt]);
    }
    const values: unknown[] = [];
    const rows: string[] = [];
    resolved.forEach((l, i) => {
      rows.push(`($1, $${i * 2 + 2}, $${i * 2 + 3})`);
      values.push(l.accountId, l.amount);
    });
    await tx.query(`INSERT INTO postings (entry_id, account_id, amount) VALUES ${rows.join(',')}`, [entry.id, ...values]);
  } catch (err) {
    throw mapDbError(err);
  }
  return { created: true, entryId: entry.id };
}

export async function balance(q: Queryable, r: AccountRef): Promise<number> {
  const row = await maybe<{ balance: number }>(q, 'SELECT balance FROM accounts WHERE owner_type=$1 AND owner_id=$2 AND code=$3', [r.type, r.id, r.code]);
  return row?.balance ?? 0;
}

export async function balances(q: Queryable, type: OwnerType, id: string): Promise<Record<string, number>> {
  const rows = await many<{ code: string; balance: number }>(q, 'SELECT code, balance FROM accounts WHERE owner_type=$1 AND owner_id=$2', [type, id]);
  return Object.fromEntries(rows.map((r) => [r.code, r.balance]));
}

/** Sum of each account's postings within a game-minute range. */
export async function activity(q: Queryable, type: OwnerType, id: string, fromMinute: number, toMinute: number): Promise<Record<string, number>> {
  const rows = await many<{ code: string; total: number }>(
    q,
    `SELECT a.code, SUM(p.amount)::bigint AS total FROM postings p
       JOIN accounts a ON a.id = p.account_id
       JOIN journal_entries e ON e.id = p.entry_id
      WHERE a.owner_type = $1 AND a.owner_id = $2 AND e.game_minute >= $3 AND e.game_minute < $4
      GROUP BY a.code`,
    [type, id, fromMinute, toMinute],
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.total]));
}

/** Global audit: every posting sums to zero and stored balances equal posting sums. */
export async function auditLedger(q: Queryable) {
  const total = await maybe<{ s: number }>(q, 'SELECT COALESCE(SUM(amount),0)::bigint AS s FROM postings');
  const drift = await many<{ id: number; balance: number; computed: number }>(
    q,
    `SELECT a.id, a.balance, COALESCE(SUM(p.amount),0)::bigint AS computed
       FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
      GROUP BY a.id HAVING a.balance <> COALESCE(SUM(p.amount),0)`,
  );
  const ownerImbalance = await many<{ owner_type: string; owner_id: string; s: number }>(
    q,
    `SELECT owner_type, owner_id, SUM(balance)::bigint AS s FROM accounts GROUP BY 1,2 HAVING SUM(balance) <> 0`,
  );
  const supply = await maybe<{ issued: number }>(q, `SELECT COALESCE(-balance,0) AS issued FROM accounts WHERE owner_type='system' AND owner_id='central_bank' AND code='currency_issued'`);
  const cash = await maybe<{ s: number }>(q, `SELECT COALESCE(SUM(balance),0)::bigint AS s FROM accounts WHERE code IN ('cash','cash_locked')`);
  return {
    postingsSum: total?.s ?? 0,
    driftAccounts: drift.length,
    unbalancedOwners: ownerImbalance.length,
    moneyIssued: supply?.issued ?? 0,
    cashInCirculation: cash?.s ?? 0,
    // Money can only exist if it was issued or is owed to the bank.
    ok: (total?.s ?? 0) === 0 && drift.length === 0 && ownerImbalance.length === 0,
  };
}
