import type { Queryable } from './db';
import { many, maybe } from './db';

export type Section = 'operating' | 'investing' | 'financing';

/** Classification of journal kinds touching company cash (direct method, VAS/IFRS style). */
const KIND: Record<string, { section: Section; label: string }> = {
  retail_sales: { section: 'operating', label: 'Thu tiền bán lẻ' },
  b2b_purchase: { section: 'operating', label: 'Mua bán hàng hóa bán buôn' },
  contract_delivery: { section: 'operating', label: 'Giao nhận hàng theo hợp đồng' },
  contract_deposit: { section: 'operating', label: 'Đặt cọc hợp đồng' },
  contract_deposit_release: { section: 'operating', label: 'Hoàn/nhận tiền cọc hợp đồng' },
  contract_penalty: { section: 'operating', label: 'Phạt và hoàn tiền hợp đồng' },
  payroll: { section: 'operating', label: 'Trả lương' },
  bonus: { section: 'operating', label: 'Thưởng nhân viên' },
  benefits: { section: 'operating', label: 'Phúc lợi nhân viên' },
  severance: { section: 'operating', label: 'Trợ cấp thôi việc' },
  recruitment: { section: 'operating', label: 'Phí tuyển dụng' },
  operating_costs: { section: 'operating', label: 'Thuê mặt bằng và bảo trì' },
  marketing: { section: 'operating', label: 'Marketing' },
  tax_payment: { section: 'operating', label: 'Nộp thuế' },
  branch_open: { section: 'investing', label: 'Mở chi nhánh' },
  equipment_purchase: { section: 'investing', label: 'Mua thiết bị' },
  acquisition: { section: 'investing', label: 'Mua lại doanh nghiệp' },
  deposit_open: { section: 'investing', label: 'Gửi tiền ngân hàng' },
  deposit_close: { section: 'investing', label: 'Rút tiền gửi và lãi' },
  company_founding: { section: 'financing', label: 'Vốn góp ban đầu' },
  capital_injection: { section: 'financing', label: 'Chủ sở hữu góp thêm vốn' },
  loan_disbursement: { section: 'financing', label: 'Vay ngân hàng' },
  dividend: { section: 'financing', label: 'Chi trả cổ tức' },
  delisting_buyback: { section: 'financing', label: 'Mua lại cổ phiếu khi hủy niêm yết' },
  genesis: { section: 'financing', label: 'Vốn đầu tư ban đầu' },
  merger: { section: 'investing', label: 'Sáp nhập công ty con' },
};

/**
 * Cash flow statement for a company over a game-minute range, built from the ledger.
 * Loan payments are split: interest is operating, principal is financing. Share trades:
 * IPO proceeds are financing; buying/selling other companies' shares is investing.
 */
export async function cashFlow(q: Queryable, companyId: string, from: number, to: number) {
  const rows = await many<{ entry_id: string; kind: string; amount: number }>(
    q,
    `SELECT e.id AS entry_id, e.kind, SUM(p.amount)::bigint AS amount FROM postings p JOIN accounts a ON a.id=p.account_id JOIN journal_entries e ON e.id=p.entry_id
      WHERE a.owner_type='company' AND a.owner_id=$1 AND a.code IN ('cash','cash_locked') AND e.game_minute >= $2 AND e.game_minute < $3
      GROUP BY e.id, e.kind HAVING SUM(p.amount) <> 0`,
    [companyId, from, to],
  );
  const lines = new Map<string, { section: Section; label: string; amount: number }>();
  const add = (key: string, section: Section, label: string, amount: number) => {
    const l = lines.get(key) ?? { section, label, amount: 0 };
    l.amount += amount;
    lines.set(key, l);
  };
  for (const r of rows) {
    if (r.kind === 'loan_payment') {
      const interest = await maybe<{ i: number }>(
        q,
        `SELECT COALESCE(SUM(p.amount),0)::bigint AS i FROM postings p JOIN accounts a ON a.id=p.account_id WHERE p.entry_id=$1 AND a.owner_type='company' AND a.owner_id=$2 AND a.code='interest'`,
        [r.entry_id, companyId],
      );
      const i = interest?.i ?? 0;
      add('interest', 'operating', 'Trả lãi vay', -i);
      add('principal', 'financing', 'Trả nợ gốc vay', r.amount + i);
      continue;
    }
    if (r.kind === 'stock_trade') {
      const ipo = await maybe(q, `SELECT 1 FROM postings p JOIN accounts a ON a.id=p.account_id WHERE p.entry_id=$1 AND a.owner_type='company' AND a.owner_id=$2 AND a.code='share_capital'`, [r.entry_id, companyId]);
      if (ipo) add('ipo', 'financing', 'Phát hành cổ phiếu (IPO)', r.amount);
      else add('securities', 'investing', 'Mua bán cổ phiếu doanh nghiệp khác', r.amount);
      continue;
    }
    if (r.kind === 'order_lock' || r.kind === 'order_release') continue; // moves between cash and cash_locked
    const k = KIND[r.kind] ?? { section: 'operating' as Section, label: 'Khác' };
    add(r.kind in KIND ? r.kind : 'other', k.section, k.label, r.amount);
  }
  const list = [...lines.values()].filter((l) => l.amount !== 0);
  const sum = (s: Section) => list.filter((l) => l.section === s).reduce((t, l) => t + l.amount, 0);
  const closingRow = await maybe<{ c: number }>(
    q,
    `SELECT COALESCE(SUM(p.amount),0)::bigint AS c FROM postings p JOIN accounts a ON a.id=p.account_id JOIN journal_entries e ON e.id=p.entry_id
      WHERE a.owner_type='company' AND a.owner_id=$1 AND a.code IN ('cash','cash_locked') AND e.game_minute < $2`,
    [companyId, to],
  );
  const operating = sum('operating');
  const investing = sum('investing');
  const financing = sum('financing');
  const closing = closingRow?.c ?? 0;
  return { lines: list, operating, investing, financing, net: operating + investing + financing, opening: closing - (operating + investing + financing), closing };
}
