import type { Tx, Queryable } from './db';
import { one, many } from './db';
import { netAssets } from './companies';
import { notify } from './notify';
import { stageName } from '@startup/shared';

export type StageCheck = { stage: number; label: string; met: boolean; detail: string };

/**
 * Stage requirements combine financial strength, real activity, workforce, legal standing
 * and reputation, never money alone.
 */
export async function stageProgress(q: Queryable, userId: string, minute: number) {
  const companies = await many<{ id: string; founded_minute: number; reputation: number; status: string }>(q, `SELECT id, founded_minute, reputation, status FROM companies WHERE owner_user_id=$1 AND status IN ('active','insolvent')`, [userId]);
  const ids = companies.map((c) => c.id);
  const emp = ids.length ? (await one<{ n: number }>(q, 'SELECT count(*)::int AS n FROM people WHERE company_id = ANY($1)', [ids])).n : 0;
  const oldestDays = companies.length ? Math.max(...companies.map((c) => (minute - c.founded_minute) / 1440)) : 0;
  const lastMonth = ids.length
    ? await one<{ revenue: number; profit: number }>(
        q,
        `SELECT COALESCE(SUM(revenue),0)::bigint AS revenue, COALESCE(SUM(net_profit),0)::bigint AS profit FROM monthly_reports WHERE company_id = ANY($1) AND month = (SELECT MAX(month) FROM monthly_reports WHERE company_id = ANY($1))`,
        [ids],
      )
    : { revenue: 0, profit: 0 };
  let equity = 0;
  for (const id of ids) equity += (await netAssets(q, id)).equity;
  const bestRep = companies.length ? Math.max(...companies.map((c) => c.reputation)) : 0;
  const defaulted = (await one<{ n: number }>(q, `SELECT count(*)::int AS n FROM loans WHERE status='defaulted' AND ((borrower_type='user' AND borrower_id=$1) OR (borrower_type='company' AND borrower_id = ANY($2)))`, [userId, ids])).n;
  const listed = ids.length ? (await one<{ n: number }>(q, `SELECT count(*)::int AS n FROM instruments WHERE company_id = ANY($1) AND status <> 'delisted'`, [ids])).n : 0;
  const insolvent = companies.some((c) => c.status === 'insolvent');
  const fmt = (n: number) => n.toLocaleString('vi-VN');

  const reqs: Record<number, StageCheck[]> = {
    2: [{ stage: 2, label: 'Có doanh nghiệp được cấp phép hoạt động', met: companies.length >= 1, detail: `${companies.length} doanh nghiệp` }],
    3: [
      { stage: 3, label: 'Hoạt động tối thiểu 14 ngày game', met: oldestDays >= 14, detail: `${Math.floor(oldestDays)} ngày` },
      { stage: 3, label: 'Tối thiểu 8 nhân sự', met: emp >= 8, detail: `${emp} người` },
      { stage: 3, label: 'Doanh thu tháng gần nhất ≥ 400 triệu ₫', met: lastMonth.revenue >= 400_000_000, detail: `${fmt(lastMonth.revenue)} ₫` },
      { stage: 3, label: 'Vốn chủ sở hữu dương', met: equity > 0, detail: `${fmt(equity)} ₫` },
      { stage: 3, label: 'Không có nợ xấu', met: defaulted === 0, detail: defaulted ? `${defaulted} khoản` : 'Sạch' },
    ],
    4: [
      { stage: 4, label: 'Hoạt động tối thiểu 42 ngày game', met: oldestDays >= 42, detail: `${Math.floor(oldestDays)} ngày` },
      { stage: 4, label: 'Tối thiểu 30 nhân sự', met: emp >= 30, detail: `${emp} người` },
      { stage: 4, label: 'Tối thiểu 2 doanh nghiệp hoạt động', met: companies.length >= 2, detail: `${companies.length}` },
      { stage: 4, label: 'Doanh thu tháng gần nhất ≥ 2,5 tỷ ₫ và có lãi', met: lastMonth.revenue >= 2_500_000_000 && lastMonth.profit > 0, detail: `${fmt(lastMonth.revenue)} ₫ / lãi ${fmt(lastMonth.profit)} ₫` },
      { stage: 4, label: 'Uy tín doanh nghiệp tốt nhất ≥ 65', met: bestRep >= 65, detail: bestRep.toFixed(1) },
      { stage: 4, label: 'Không doanh nghiệp nào mất khả năng thanh toán', met: !insolvent, detail: insolvent ? 'Có' : 'Không' },
    ],
    5: [
      { stage: 5, label: 'Tối thiểu 3 doanh nghiệp hoạt động', met: companies.length >= 3, detail: `${companies.length}` },
      { stage: 5, label: 'Có doanh nghiệp niêm yết', met: listed > 0, detail: `${listed}` },
      { stage: 5, label: 'Tối thiểu 80 nhân sự', met: emp >= 80, detail: `${emp} người` },
      { stage: 5, label: 'Tổng vốn chủ sở hữu ≥ 30 tỷ ₫', met: equity >= 30_000_000_000, detail: `${fmt(equity)} ₫` },
    ],
  };
  return { reqs, metrics: { companies: companies.length, employees: emp, oldestDays, lastMonth, equity, bestRep, listed } };
}

/** Stages only move up; each unlocks new mechanics (more companies, TV ads, IPO, ...). */
export async function evaluateStage(tx: Tx, userId: string, minute: number) {
  const u = await one<{ stage: number }>(tx, 'SELECT stage FROM users WHERE id=$1 FOR UPDATE', [userId]);
  const { reqs } = await stageProgress(tx, userId, minute);
  let stage = u.stage;
  while (stage < 5 && (reqs[stage + 1] ?? []).every((r) => r.met)) stage++;
  if (stage > u.stage) {
    await tx.query('UPDATE users SET stage=$2 WHERE id=$1', [userId, stage]);
    await notify(tx, userId, 'stage', `Thăng giai đoạn: ${stageName(stage)}`, 'Các cơ chế quản lý mới đã được mở khóa.', { stage }, `stage:${userId}:${stage}`);
  }
  return stage;
}
