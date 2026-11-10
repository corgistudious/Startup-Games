import type { Tx } from './db';
import { maybe, many, one } from './db';
import { fail } from './errors';
import { post, SYS } from './ledger';
import { C } from './companies';
import { notifyCompanyOwner } from './notify';
import { OVERTIME_MULTIPLIER, ANNUAL_LEAVE_DAYS, BENEFITS } from './workforce';
import { toGameDate } from '@startup/shared';

type Person = {
  id: string;
  full_name: string;
  skill: number;
  wage_expectation: number;
  status: string;
  company_id: string | null;
  wage: number | null;
  morale: number;
  unpaid_days: number;
  hours_this_day: number;
  ot_hours_this_day: number;
};

export const DEPARTMENTS = ['san_xuat', 'ban_hang', 'kho_van', 'marketing', 'tai_chinh', 'dieu_hanh'] as const;

/**
 * Hire a job seeker. The candidate evaluates the offer: below 90% of their expectation they refuse,
 * so wages are a real decision. A recruitment fee (one day's wage) is paid to an agency.
 */
export async function hire(tx: Tx, actorId: string | null, companyId: string, personId: string, wage: number, shift: string, department: string, minute: number) {
  const p = await maybe<Person>(tx, 'SELECT * FROM people WHERE id = $1 FOR UPDATE', [personId]);
  if (!p || p.status !== 'seeking') return fail('not_available', 'Ứng viên không còn tìm việc.');
  if (wage < Math.round(p.wage_expectation * 0.9)) {
    fail('offer_refused', `${p.full_name} từ chối: mức lương thấp hơn kỳ vọng (${p.wage_expectation.toLocaleString('vi-VN')} ₫/ngày).`);
  }
  if (!(DEPARTMENTS as readonly string[]).includes(department)) fail('bad_department', 'Phòng ban không hợp lệ.');
  const morale = Math.max(40, Math.min(95, 70 + Math.round(((wage - p.wage_expectation) / p.wage_expectation) * 60)));
  await post(tx, {
    key: `hire:${personId}:${minute}`,
    kind: 'recruitment',
    memo: `Phí tuyển dụng ${p.full_name}`,
    minute,
    actorId,
    ref: { type: 'person', id: personId },
    lines: [
      { ...C(companyId, 'cash'), amount: -wage },
      { ...C(companyId, 'fees'), amount: wage },
      { ...SYS.households('cash'), amount: wage },
      { ...SYS.households('income'), amount: -wage },
    ],
  });
  await tx.query(
    `UPDATE people SET status='employed', company_id=$2, wage=$3, shift=$4, department=$5, morale=$6, hired_minute=$7, hours_this_day=0, unpaid_days=0, title=NULL WHERE id=$1`,
    [personId, companyId, wage, shift, department, morale, minute],
  );
}

/** Dismissal pays three days of severance; the person returns to the labour market. */
export async function dismiss(tx: Tx, actorId: string | null, companyId: string, personId: string, minute: number, reason = 'Chấm dứt hợp đồng') {
  const p = await maybe<Person>(tx, 'SELECT * FROM people WHERE id = $1 FOR UPDATE', [personId]);
  if (!p || p.company_id !== companyId) return fail('not_employee', 'Nhân sự không thuộc doanh nghiệp.');
  const severance = (p.wage ?? 0) * 3;
  if (severance > 0) {
    await post(tx, {
      key: `dismiss:${personId}:${minute}`,
      kind: 'severance',
      memo: `Trợ cấp thôi việc ${p.full_name}: ${reason}`,
      minute,
      actorId,
      ref: { type: 'person', id: personId },
      lines: [
        { ...C(companyId, 'cash'), amount: -severance },
        { ...C(companyId, 'wages'), amount: severance },
        { ...SYS.households('cash'), amount: severance },
        { ...SYS.households('income'), amount: -severance },
      ],
    });
  }
  await releasePerson(tx, personId);
}

export async function releasePerson(tx: Tx, personId: string) {
  await tx.query(
    `UPDATE people SET status='seeking', company_id=NULL, wage=NULL, shift=NULL, department=NULL, title=NULL, hours_this_day=0, ot_hours_this_day=0, leave_until_minute=NULL, unpaid_days=0, morale=60,
       wage_expectation = GREATEST(wage_expectation, COALESCE(wage, wage_expectation)) WHERE id=$1`,
    [personId],
  );
}

export async function updateEmployee(tx: Tx, companyId: string, personId: string, patch: { wage?: number; shift?: string; department?: string; title?: string | null }) {
  const p = await maybe<Person>(tx, 'SELECT * FROM people WHERE id = $1 FOR UPDATE', [personId]);
  if (!p || p.company_id !== companyId) return fail('not_employee', 'Nhân sự không thuộc doanh nghiệp.');
  let morale = p.morale;
  if (patch.wage !== undefined && p.wage) {
    const change = (patch.wage - p.wage) / p.wage;
    morale = Math.max(0, Math.min(100, morale + Math.round(change * (change < 0 ? 120 : 50))));
  }
  if (patch.department && !(DEPARTMENTS as readonly string[]).includes(patch.department)) fail('bad_department', 'Phòng ban không hợp lệ.');
  await tx.query(
    `UPDATE people SET wage=COALESCE($2,wage), shift=COALESCE($3,shift), department=COALESCE($4,department), title=CASE WHEN $5::boolean THEN $6 ELSE title END, morale=$7 WHERE id=$1`,
    [personId, patch.wage ?? null, patch.shift ?? null, patch.department ?? null, patch.title !== undefined, patch.title ?? null, morale],
  );
}

/**
 * Daily payroll for hours worked the previous day. Pays arrears first. If the company
 * cannot pay, wages accrue as a liability, morale falls and staff eventually quit.
 */
export async function runPayroll(tx: Tx, companyId: string, day: number, minute: number) {
  const staff = await many<Person>(tx, `SELECT * FROM people WHERE company_id = $1 FOR UPDATE`, [companyId]);
  const due = staff.map((p) => ({ p, pay: Math.round(((p.wage ?? 0) * (p.hours_this_day + p.ot_hours_this_day * OVERTIME_MULTIPLIER)) / 8) }));
  const benefitLevel = (await one<{ benefit_level: number }>(tx, 'SELECT benefit_level FROM companies WHERE id=$1', [companyId])).benefit_level;
  const today = due.reduce((s, d) => s + d.pay, 0);
  const arrearsRow = await maybe<{ balance: number }>(tx, `SELECT balance FROM accounts WHERE owner_type='company' AND owner_id=$1 AND code='wages_payable'`, [companyId]);
  const arrears = -(arrearsRow?.balance ?? 0);
  const cashRow = await maybe<{ balance: number }>(tx, `SELECT balance FROM accounts WHERE owner_type='company' AND owner_id=$1 AND code='cash'`, [companyId]);
  const cash = cashRow?.balance ?? 0;
  let paid = false;

  if (today + arrears === 0) {
    // nothing worked, nothing owed
  } else if (cash >= today + arrears) {
    paid = true;
    await post(tx, {
      key: `payroll:${companyId}:${day}`,
      kind: 'payroll',
      memo: `Trả lương ngày ${day + 1}${arrears ? ' và lương còn nợ' : ''}`,
      minute,
      ref: { type: 'company', id: companyId },
      lines: [
        { ...C(companyId, 'wages'), amount: today },
        { ...C(companyId, 'wages_payable'), amount: arrears },
        { ...C(companyId, 'cash'), amount: -(today + arrears) },
        { ...SYS.households('cash'), amount: today + arrears },
        { ...SYS.households('income'), amount: -(today + arrears) },
      ],
    });
  } else if (today > 0) {
    await post(tx, {
      key: `payroll:${companyId}:${day}`,
      kind: 'payroll_accrued',
      memo: `Nợ lương ngày ${day + 1} (không đủ tiền mặt)`,
      minute,
      ref: { type: 'company', id: companyId },
      lines: [
        { ...C(companyId, 'wages'), amount: today },
        { ...C(companyId, 'wages_payable'), amount: -today },
      ],
    });
    await notifyCompanyOwner(tx, companyId, 'finance', 'Không đủ tiền trả lương', `Doanh nghiệp đang nợ lương ${(today + arrears).toLocaleString('vi-VN')} ₫. Nhân viên sẽ nghỉ việc nếu bị nợ lương 3 ngày.`, `payroll-miss:${companyId}:${day}`);
  }

  for (const { p } of due) {
    if (p.hours_this_day + p.ot_hours_this_day <= 0 && paid) continue;
    let morale = p.morale;
    let unpaid = p.unpaid_days;
    if (paid) {
      unpaid = 0;
      morale += (p.wage ?? 0) >= p.wage_expectation ? 2 : -3;
    } else if (p.hours_this_day + p.ot_hours_this_day > 0) {
      unpaid += 1;
      morale -= 15;
    }
    morale -= Math.round(p.ot_hours_this_day); // overtime is tiring even when paid
    morale = Math.max(0, Math.min(100, morale));
    const exp = p.hours_this_day + p.ot_hours_this_day;
    if (unpaid >= 3 || morale < (benefitLevel >= 2 ? 10 : 15)) {
      await releasePerson(tx, p.id);
      await notifyCompanyOwner(tx, companyId, 'hr', `${p.full_name} đã nghỉ việc`, unpaid >= 3 ? 'Lý do: bị nợ lương nhiều ngày.' : 'Lý do: tinh thần làm việc quá thấp.', `quit:${p.id}:${day}`);
      continue;
    }
    await tx.query(
      `UPDATE people SET hours_this_day = 0, ot_hours_this_day = 0, unpaid_days = $2, morale = $3, experience = experience + $4,
              skill = LEAST(100, skill + CASE WHEN floor((experience + $4) / 60) > floor(experience / 60) THEN 1 ELSE 0 END) WHERE id = $1`,
      [p.id, unpaid, morale, exp],
    );
  }
  return { today, arrears, paid };
}

/** One-off bonus to selected employees; raises morale in proportion to the bonus/wage ratio. */
export async function payBonus(tx: Tx, actorId: string, companyId: string, personIds: string[], amountEach: number, minute: number, key: string) {
  const staff = await many<Person>(tx, 'SELECT * FROM people WHERE company_id=$1 AND id = ANY($2) FOR UPDATE', [companyId, personIds]);
  if (!staff.length) return fail('no_staff', 'Chọn ít nhất một nhân viên của doanh nghiệp.');
  const total = amountEach * staff.length;
  const res = await post(tx, {
    key,
    kind: 'bonus',
    memo: `Thưởng ${staff.length} nhân viên, mỗi người ${amountEach.toLocaleString('vi-VN')} ₫`,
    minute,
    actorId,
    ref: { type: 'company', id: companyId },
    lines: [
      { ...C(companyId, 'wages'), amount: total },
      { ...C(companyId, 'cash'), amount: -total },
      { ...SYS.households('cash'), amount: total },
      { ...SYS.households('income'), amount: -total },
    ],
  });
  if (!res.created) return fail('duplicate', 'Khoản thưởng này đã được chi.', 409);
  for (const p of staff) {
    const boost = Math.min(25, Math.round((amountEach / Math.max(1, p.wage ?? 1)) * 6));
    await tx.query('UPDATE people SET morale = LEAST(100, morale + $2) WHERE id=$1', [p.id, boost]);
  }
  return total;
}

export async function setHrPolicies(tx: Tx, companyId: string, policy: { benefitLevel?: number; overtimeHours?: number }) {
  if (policy.benefitLevel !== undefined && !BENEFITS.some((b) => b.level === policy.benefitLevel)) fail('bad_benefit', 'Gói phúc lợi không hợp lệ.');
  if (policy.overtimeHours !== undefined && (policy.overtimeHours < 0 || policy.overtimeHours > 3)) fail('bad_overtime', 'Tăng ca tối đa 3 giờ mỗi ngày.');
  await tx.query('UPDATE companies SET benefit_level = COALESCE($2, benefit_level), overtime_hours = COALESCE($3, overtime_hours) WHERE id=$1', [companyId, policy.benefitLevel ?? null, policy.overtimeHours ?? null]);
}

/** Paid annual leave, 12 game days per game year per employee. */
export async function grantLeave(tx: Tx, companyId: string, personId: string, days: number, minute: number) {
  const p = await maybe<Person & { leave_until_minute: number | null; leave_year: number; leave_days_used: number }>(tx, 'SELECT * FROM people WHERE id=$1 FOR UPDATE', [personId]);
  if (!p || p.company_id !== companyId) return fail('not_employee', 'Nhân sự không thuộc doanh nghiệp.');
  if (p.leave_until_minute && p.leave_until_minute > minute) fail('on_leave', `${p.full_name} đang nghỉ phép.`);
  const year = toGameDate(minute).year;
  const used = p.leave_year === year ? p.leave_days_used : 0;
  if (used + days > ANNUAL_LEAVE_DAYS) fail('no_leave_left', `Chỉ còn ${ANNUAL_LEAVE_DAYS - used} ngày phép trong năm.`);
  await tx.query('UPDATE people SET leave_until_minute=$2, leave_year=$3, leave_days_used=$4 WHERE id=$1', [personId, minute + days * 1440, year, used + days]);
}
