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
export async function takeLoan(tx: Tx, actorId: string | null, borrower: { type: 'user' | 'company'; id: string }, amount: number, termDays: number, minute: number, key: string) {
  if (termDays % 7 !== 0) fail('bad_term', 'Kỳ hạn phải là bội số của 7 ngày (1 tháng game).');
  const { limit, reason } = await creditLimit(tx, borrower);
  if (amount > limit) fail('over_limit', reason ?? `Vượt hạn mức tín dụng. Hạn mức còn lại: ${limit.toLocaleString('vi-VN')} ₫.`);
  const bankCash = await balance(tx, SYS.bank('cash'));
  if (bankCash < amount) fail('bank_liquidity', 'Ngân hàng tạm thời không đủ nguồn vốn cho khoản vay này.');
  const periods = termDays / 7;
  const loan = await one<{ id: string }>(
    tx,
    `INSERT INTO loans (borrower_type, borrower_id, principal, outstanding, rate_daily_bp, term_days, installment, start_minute, next_due_minute)
     VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [borrower.type, borrower.id, amount, ECON.loanRateDailyBp, termDays, Math.ceil(amount / periods), minute, minute + 7 * 1440],
  );
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
    if (status === 'defaulted' && loan.borrower_type === 'company') await tx.query(`UPDATE companies SET insolvent_days = GREATEST(insolvent_days, $2) WHERE id=$1`, [loan.borrower_id, ECON.bankruptcyAfterInsolventDays]);
  }
}

export async function loansOf(q: Queryable, type: string, id: string) {
  return many<Loan & { start_minute: number }>(q, 'SELECT * FROM loans WHERE borrower_type=$1 AND borrower_id=$2 ORDER BY created_at DESC', [type, id]);
}
