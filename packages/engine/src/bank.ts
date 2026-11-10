import type { Tx, Queryable } from './db';
import { maybe, one, many } from './db';
import { fail } from './errors';
import { post, acct, SYS, balance, type OwnerType } from './ledger';
import { ECON } from './config';
import { netAssets } from './companies';
import { notify, notifyCompanyOwner } from './notify';

type Loan = {
  id: string;
  borrower_type: 'user' | 'company';
  borrower_id: string;
  principal: number;
  outstanding: number;
  interest_due: number;
  rate_daily_bp: number;
  term_days: number;
  installment: number;
  next_due_minute: number;
  missed: number;
  status: string;
};

export async function creditLimit(q: Queryable, borrower: { type: 'user' | 'company'; id: string }) {
  const existing = await one<{ s: number }>(q, `SELECT COALESCE(SUM(outstanding),0)::bigint AS s FROM loans WHERE borrower_type=$1 AND borrower_id=$2 AND status IN ('active','overdue')`, [borrower.type, borrower.id]);
  const defaulted = await maybe(q, `SELECT 1 FROM loans WHERE borrower_type=$1 AND borrower_id=$2 AND status='defaulted'`, [borrower.type, borrower.id]);
  if (defaulted) return { limit: 0, existing: existing.s, reason: 'Có khoản vay đã vỡ nợ.' };
  if (borrower.type === 'company') {
    const na = await netAssets(q, borrower.id);
    return { limit: Math.max(0, Math.floor(na.equity * ECON.loanMaxMultipleOfEquity) - existing.s), existing: existing.s, reason: null };
  }
  const u = await one<{ stage: number }>(q, 'SELECT stage FROM users WHERE id=$1', [borrower.id]);
  if (u.stage < 2) return { limit: 0, existing: existing.s, reason: 'Vay cá nhân mở khóa khi bạn sở hữu doanh nghiệp đang hoạt động.' };
  return { limit: Math.max(0, 200_000_000 * u.stage - existing.s), existing: existing.s, reason: null };
}

/** Bank lends from its own finite reserves (bank capital + repayments + interest). */
export const COLLATERAL_LTV = 0.7;
export const SEIZURE_RECOVERY = 0.6;

export async function takeLoan(
  tx: Tx,
  actorId: string | null,
  borrower: { type: 'user' | 'company'; id: string },
  amount: number,
  termDays: number,
  minute: number,
  key: string,
  opts: { equipmentIds?: string[] } = {},
) {
  if (termDays % 7 !== 0) fail('bad_term', 'Kỳ hạn phải là bội số của 7 ngày (1 tháng game).');
  const { limit, reason } = await creditLimit(tx, borrower);
  // Pledged equipment raises the limit by 70% of its book value and lowers the rate.
  let collateral = 0;
  const pledged = opts.equipmentIds ?? [];
  if (pledged.length) {
    if (borrower.type !== 'company') fail('collateral_company', 'Chỉ doanh nghiệp mới thế chấp thiết bị.');
    const eq = await many<{ id: string; book_value: number }>(tx, 'SELECT id, book_value FROM equipment WHERE id = ANY($1) AND company_id=$2 AND pledged_loan_id IS NULL FOR UPDATE', [pledged, borrower.id]);
    if (eq.length !== pledged.length) fail('collateral_unavailable', 'Có thiết bị không thuộc doanh nghiệp hoặc đã được thế chấp.');
    collateral = Math.floor(eq.reduce((s, e) => s + e.book_value, 0) * COLLATERAL_LTV);
  }
  if (amount > limit + collateral) fail('over_limit', reason && !collateral ? reason : `Vượt hạn mức tín dụng. Hạn mức còn lại: ${(limit + collateral).toLocaleString('vi-VN')} ₫ (gồm tài sản bảo đảm).`);
  const bankCash = await balance(tx, SYS.bank('cash'));
  if (bankCash < amount) fail('bank_liquidity', 'Ngân hàng tạm thời không đủ nguồn vốn cho khoản vay này.');
  const periods = termDays / 7;
  const loan = await one<{ id: string }>(
    tx,
    `INSERT INTO loans (borrower_type, borrower_id, principal, outstanding, rate_daily_bp, term_days, installment, start_minute, next_due_minute)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [borrower.type, borrower.id, amount, ECON.loanRateDailyBp - (collateral >= amount * 0.5 ? 10 : 0), termDays, Math.ceil(amount / periods), minute, minute + 7 * 1440],
  );
  if (pledged.length) {
    await tx.query('UPDATE equipment SET pledged_loan_id=$1 WHERE id = ANY($2)', [loan.id, pledged]);
    await tx.query('UPDATE loans SET collateral_value=$2 WHERE id=$1', [loan.id, collateral]);
  }
  const res = await post(tx, {
    key,
    kind: 'loan_disbursement',
    memo: `Giải ngân khoản vay ${termDays} ngày`,
    minute,
    actorId,
    ref: { type: 'loan', id: loan.id },
    lines: [
      { ...acct(borrower.type, borrower.id, 'cash'), amount },
      { ...acct(borrower.type, borrower.id, 'loan_payable'), amount: -amount },
      { ...SYS.bank('loans_receivable'), amount },
      { ...SYS.bank('cash'), amount: -amount },
    ],
  });
  if (!res.created) fail('duplicate', 'Yêu cầu vay đã được xử lý.', 409);
  return loan.id;
}

async function pay(tx: Tx, loan: Loan, principal: number, interest: number, minute: number, key: string, memo: string) {
  const b = acct(loan.borrower_type as OwnerType, loan.borrower_id, 'cash');
  await post(tx, {
    key,
    kind: 'loan_payment',
    memo,
    minute,
    ref: { type: 'loan', id: loan.id },
    lines: [
      { ...b, amount: -(principal + interest) },
      { ...acct(loan.borrower_type, loan.borrower_id, 'loan_payable'), amount: principal },
      { ...acct(loan.borrower_type, loan.borrower_id, 'interest'), amount: interest },
      { ...SYS.bank('cash'), amount: principal + interest },
      { ...SYS.bank('loans_receivable'), amount: -principal },
      { ...SYS.bank('interest_income'), amount: -interest },
    ],
  });
  const outstanding = loan.outstanding - principal;
  await tx.query(`UPDATE loans SET outstanding=$2::bigint, interest_due=interest_due-$3::bigint, status=CASE WHEN $2::bigint=0 THEN 'repaid' ELSE status END WHERE id=$1`, [loan.id, outstanding, interest]);
  if (outstanding === 0) await tx.query('UPDATE equipment SET pledged_loan_id=NULL WHERE pledged_loan_id=$1', [loan.id]);
}

export async function repayLoan(tx: Tx, ownerCheck: (l: Loan) => boolean, loanId: string, amount: number, minute: number, key: string) {
  const loan = await maybe<Loan>(tx, 'SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId]);
  if (!loan || !ownerCheck(loan)) return fail('not_found', 'Không tìm thấy khoản vay.', 404);
  if (loan.status === 'repaid') fail('repaid', 'Khoản vay đã tất toán.');
  const interest = Math.min(amount, loan.interest_due);
  const principal = Math.min(amount - interest, loan.outstanding);
  if (principal + interest <= 0) fail('nothing_due', 'Không có khoản nào cần trả.');
  await pay(tx, loan, principal, interest, minute, key, 'Trả nợ trước hạn');
  if (loan.outstanding - principal > 0 && loan.status === 'overdue' && loan.interest_due - interest === 0) {
    await tx.query(`UPDATE loans SET status='active', missed=0 WHERE id=$1`, [loan.id]);
  }
}

/** Daily: accrue interest; on each 7-day due date collect principal installment + interest. */
export async function loanDaily(tx: Tx, loanId: string, day: number, minute: number) {
  const loan = await maybe<Loan>(tx, 'SELECT * FROM loans WHERE id=$1 FOR UPDATE', [loanId]);
  if (!loan || !['active', 'overdue'].includes(loan.status)) return;
  const penalty = loan.status === 'overdue' ? 1.5 : 1;
  const accrued = Math.round((loan.outstanding * loan.rate_daily_bp * penalty) / 10_000);
  await tx.query('UPDATE loans SET interest_due = interest_due + $2 WHERE id=$1', [loan.id, accrued]);
  loan.interest_due += accrued;
  if (minute < loan.next_due_minute) return;

  const principal = Math.min(loan.installment * (loan.missed + 1), loan.outstanding);
  const dueTotal = principal + loan.interest_due;
  const cash = await balance(tx, acct(loan.borrower_type, loan.borrower_id, 'cash'));
  const who = (title: string, body: string) =>
    loan.borrower_type === 'user' ? notify(tx, loan.borrower_id, 'finance', title, body, { loanId: loan.id }, `loan:${loan.id}:${day}`) : notifyCompanyOwner(tx, loan.borrower_id, 'finance', title, body, `loan:${loan.id}:${day}`);
  if (cash >= dueTotal) {
    await pay(tx, loan, principal, loan.interest_due, minute, `loan:due:${loan.id}:${day}`, 'Thanh toán kỳ hạn khoản vay');
    await tx.query(`UPDATE loans SET next_due_minute = next_due_minute + 10080, missed = 0, status = CASE WHEN outstanding = 0 THEN 'repaid' ELSE 'active' END WHERE id=$1`, [loan.id]);
    await who('Đã thanh toán kỳ vay', `Gốc ${principal.toLocaleString('vi-VN')} ₫ + lãi ${loan.interest_due.toLocaleString('vi-VN')} ₫.`);
  } else {
    const missed = loan.missed + 1;
    const status = missed >= 3 ? 'defaulted' : 'overdue';
    await tx.query(`UPDATE loans SET missed=$2, status=$3, next_due_minute = next_due_minute + 10080 WHERE id=$1`, [loan.id, missed, status]);
    await who(status === 'defaulted' ? 'Khoản vay bị vỡ nợ' : 'Trễ hạn trả nợ', status === 'defaulted' ? 'Ngân hàng chuyển hồ sơ sang xử lý nợ xấu.' : `Cần ${dueTotal.toLocaleString('vi-VN')} ₫ để thanh toán kỳ này. Lãi phạt áp dụng từ hôm nay.`);
    if (status === 'defaulted' && loan.borrower_type === 'company') {
      const recovered = await seizeCollateral(tx, loan, minute);
      const remaining = loan.outstanding - recovered;
      if (remaining > 0) await tx.query(`UPDATE companies SET insolvent_days = GREATEST(insolvent_days, $2) WHERE id=$1`, [loan.borrower_id, ECON.bankruptcyAfterInsolventDays]);
    }
  }
}

export async function loansOf(q: Queryable, type: string, id: string) {
  return many<Loan & { start_minute: number }>(q, 'SELECT * FROM loans WHERE borrower_type=$1 AND borrower_id=$2 ORDER BY created_at DESC', [type, id]);
}

/**
 * On default the bank takes the pledged equipment. It is valued at 60% of book value
 * (forced sale); that amount reduces the debt, the rest of the book value is a loss.
 */
export async function seizeCollateral(tx: Tx, loan: { id: string; borrower_id: string; outstanding: number }, minute: number) {
  const eq = await many<{ id: string; book_value: number }>(tx, 'SELECT id, book_value FROM equipment WHERE pledged_loan_id=$1 FOR UPDATE', [loan.id]);
  if (!eq.length) return 0;
  const book = eq.reduce((s, e) => s + e.book_value, 0);
  const recovered = Math.min(loan.outstanding, Math.floor(book * SEIZURE_RECOVERY));
  const c = (code: string) => acct('company', loan.borrower_id, code);
  await post(tx, {
    key: `loan:seize:${loan.id}`,
    kind: 'collateral_seizure',
    memo: `Ngân hàng xử lý tài sản bảo đảm (${eq.length} thiết bị)`,
    minute,
    ref: { type: 'loan', id: loan.id },
    lines: [
      { ...c('equipment'), amount: -book },
      { ...c('loan_payable'), amount: recovered },
      { ...c('credit_losses'), amount: book - recovered },
      { ...SYS.bank('seized_assets'), amount: recovered },
      { ...SYS.bank('loans_receivable'), amount: -recovered },
    ],
  });
  await tx.query('DELETE FROM equipment WHERE id = ANY($1)', [eq.map((e) => e.id)]);
  await tx.query(`UPDATE loans SET outstanding = outstanding - $2, status = CASE WHEN outstanding - $2 = 0 THEN 'repaid' ELSE status END WHERE id=$1`, [loan.id, recovered]);
  await notifyCompanyOwner(tx, loan.borrower_id, 'finance', 'Tài sản bảo đảm bị xử lý', `Ngân hàng thu ${eq.length} thiết bị, giảm nợ ${recovered.toLocaleString('vi-VN')} ₫.`);
  return recovered;
}

// ---------------- Deposits ----------------

/** Daily interest in basis points by term (0 = demand deposit, withdraw any time). */
export const DEPOSIT_RATES: Record<number, number> = { 0: 3, 7: 8, 14: 10, 28: 14 };

export async function openDeposit(tx: Tx, actorId: string | null, owner: { type: 'user' | 'company'; id: string }, amount: number, termDays: number, minute: number, key: string) {
  const rate = DEPOSIT_RATES[termDays];
  if (rate === undefined) return fail('bad_term', 'Kỳ hạn gửi: không kỳ hạn, 7, 14 hoặc 28 ngày.');
  if (amount < 1_000_000) fail('min_deposit', 'Số tiền gửi tối thiểu 1 triệu ₫.');
  const d = await one<{ id: string }>(
    tx,
    `INSERT INTO deposits (owner_type, owner_id, amount, rate_daily_bp, term_days, start_minute, maturity_minute, last_accrual_day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [owner.type, owner.id, amount, rate, termDays, minute, termDays ? minute + termDays * 1440 : null, Math.floor(minute / 1440)],
  );
  const res = await post(tx, {
    key,
    kind: 'deposit_open',
    memo: termDays ? `Gửi tiết kiệm kỳ hạn ${termDays} ngày` : 'Gửi tiền không kỳ hạn',
    minute,
    actorId,
    ref: { type: 'deposit', id: d.id },
    lines: [
      { ...acct(owner.type, owner.id, 'cash'), amount: -amount },
      { ...acct(owner.type, owner.id, 'bank_deposits'), amount },
      { ...SYS.bank('cash'), amount },
      { ...SYS.bank('customer_deposits'), amount: -amount },
    ],
  });
  if (!res.created) fail('duplicate', 'Yêu cầu gửi tiền đã được xử lý.', 409);
  return d.id;
}

type Deposit = { id: string; owner_type: 'user' | 'company'; owner_id: string; amount: number; rate_daily_bp: number; term_days: number; accrued: number; maturity_minute: number | null; last_accrual_day: number | null; status: string };

async function payoutDeposit(tx: Tx, d: Deposit, interest: number, minute: number, status: 'withdrawn' | 'matured', memo: string) {
  await post(tx, {
    key: `deposit:payout:${d.id}`,
    kind: 'deposit_close',
    memo,
    minute,
    ref: { type: 'deposit', id: d.id },
    lines: [
      { ...SYS.bank('customer_deposits'), amount: d.amount },
      { ...SYS.bank('interest'), amount: interest },
      { ...SYS.bank('cash'), amount: -(d.amount + interest) },
      { ...acct(d.owner_type, d.owner_id, 'bank_deposits'), amount: -d.amount },
      { ...acct(d.owner_type, d.owner_id, 'interest_income'), amount: -interest },
      { ...acct(d.owner_type, d.owner_id, 'cash'), amount: d.amount + interest },
    ],
  });
  await tx.query('UPDATE deposits SET status=$2 WHERE id=$1', [d.id, status]);
}

/** Withdraw: demand deposits keep accrued interest; term deposits broken early lose it. */
export async function withdrawDeposit(tx: Tx, ownerCheck: (d: Deposit) => boolean, depositId: string, minute: number) {
  const d = await maybe<Deposit>(tx, 'SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [depositId]);
  if (!d || !ownerCheck(d)) return fail('not_found', 'Không tìm thấy khoản tiền gửi.', 404);
  if (d.status !== 'active') fail('closed', 'Khoản tiền gửi đã tất toán.');
  const early = d.term_days > 0 && d.maturity_minute !== null && minute < d.maturity_minute;
  await payoutDeposit(tx, d, early ? 0 : d.accrued, minute, 'withdrawn', early ? 'Rút trước hạn (không hưởng lãi)' : 'Rút tiền gửi kèm lãi');
  return { interest: early ? 0 : d.accrued, early };
}

export async function depositDaily(tx: Tx, depositId: string, day: number, minute: number) {
  const d = await maybe<Deposit>(tx, 'SELECT * FROM deposits WHERE id=$1 FOR UPDATE', [depositId]);
  if (!d || d.status !== 'active') return;
  if (d.last_accrual_day === null || d.last_accrual_day < day) {
    const add = Math.floor((d.amount * d.rate_daily_bp) / 10_000);
    await tx.query('UPDATE deposits SET accrued = accrued + $2, last_accrual_day=$3 WHERE id=$1', [d.id, add, day]);
    d.accrued += add;
  }
  if (d.term_days > 0 && d.maturity_minute !== null && minute >= d.maturity_minute) {
    await payoutDeposit(tx, d, d.accrued, minute, 'matured', `Tất toán tiền gửi kỳ hạn ${d.term_days} ngày`);
    const msg = `Gốc ${d.amount.toLocaleString('vi-VN')} ₫ + lãi ${d.accrued.toLocaleString('vi-VN')} ₫ đã về tài khoản.`;
    if (d.owner_type === 'user') await notify(tx, d.owner_id, 'finance', 'Tiền gửi đáo hạn', msg);
    else await notifyCompanyOwner(tx, d.owner_id, 'finance', 'Tiền gửi đáo hạn', msg);
  }
}

export async function depositsOf(q: Queryable, type: string, id: string) {
  return many<Deposit & { start_minute: number }>(q, 'SELECT * FROM deposits WHERE owner_type=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 30', [type, id]);
}
