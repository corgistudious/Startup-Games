import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { PageHeader, Panel, Money, Button, Field, Badge, Loading, Empty, Stat, TableWrap } from '@/components/ui';
import { vnd, gameTime, ago } from '@/lib/format';
import { Deposits } from '@/components/Deposits';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Bank() {
  const bank = useQuery({ queryKey: ['bank'], queryFn: () => api<any>('/bank') });
  const ov = useQuery({ queryKey: ['overview'], queryFn: () => api<any>('/me/overview') });
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => api<any[]>('/me/ledger') });
  const [loan, setLoan] = useState({ amount: 100_000_000, termDays: 28 });
  const [tr, setTr] = useState({ toUsername: '', amount: 1_000_000, memo: '' });
  const take = useAction('/bank/loans', { invalidate: [['bank'], ['overview'], ['ledger']], success: 'Ngân hàng đã giải ngân vào tài khoản cá nhân' });
  const repay = useAction<{ id: string; amount: number }>((b) => `/bank/loans/${b.id}/repay`, { invalidate: [['bank'], ['overview'], ['ledger']], success: 'Đã trả nợ' });
  const send = useAction('/me/transfer', { invalidate: [['overview'], ['ledger']], success: 'Chuyển khoản thành công' });
  if (bank.isLoading) return <Loading />;
  const b = bank.data;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Tài chính" title="Ngân hàng" subtitle="Ngân hàng cho vay từ vốn điều lệ và tiền gửi của khách hàng. Lãi tính mỗi ngày game, trả gốc và lãi mỗi 7 ngày. Trễ hạn bị phạt lãi; trễ 3 kỳ là nợ xấu." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tiền mặt cá nhân" value={<Money value={ov.data?.cash} compact />} icon={<Landmark size={16} />} />
        <Stat label="Hạn mức vay cá nhân" value={<Money value={b.credit.limit} compact />} hint={b.credit.reason ?? 'Theo giai đoạn phát triển'} tone={b.credit.reason ? 'warn' : undefined} />
        <Stat label="Dư nợ hiện tại" value={<Money value={b.credit.existing} compact />} />
        <Stat label="Lãi suất" value={`${(b.rateDailyBp / 100).toLocaleString('vi-VN')}%/ngày`} hint="Doanh nghiệp vay tại trang quản lý" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Vay cá nhân">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Số tiền">{(id) => <input id={id} type="number" inputMode="numeric" className="field num" step={10_000_000} value={loan.amount} onChange={(e) => setLoan({ ...loan, amount: Number(e.target.value) })} />}</Field>
            <Field label="Kỳ hạn">
              {(id) => (
                <select id={id} className="field" value={loan.termDays} onChange={(e) => setLoan({ ...loan, termDays: Number(e.target.value) })}>
                  {[7, 14, 28, 56].map((t) => (
                    <option key={t} value={t}>
                      {t} ngày game
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Button className="mt-3 w-full" disabled={loan.amount > b.credit.limit} loading={take.isPending} onClick={() => take.mutate(loan)}>
            Đề nghị vay {vnd(loan.amount, true)}
          </Button>
          <div className="mt-5 space-y-2">
            {b.loans.length === 0 ? (
              <Empty title="Không có khoản vay cá nhân" />
            ) : (
              b.loans.map((l: any) => (
                <div key={l.id} className="rounded-xl bg-ink-950/40 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span>
                      Gốc <Money value={l.outstanding} /> / <Money value={l.principal} compact />
                    </span>
                    <Badge tone={l.status === 'active' ? 'sky' : l.status === 'repaid' ? 'gain' : 'loss'}>{l.status}</Badge>
                  </div>
                  {['active', 'overdue'].includes(l.status) && (
                    <div className="mt-2 flex items-center justify-between text-xs text-ink-400">
                      <span>
                        Lãi chờ {vnd(l.interest_due)} · kỳ tới {gameTime(l.next_due_minute)}
                      </span>
                      <Button size="sm" variant="outline" loading={repay.isPending} onClick={() => repay.mutate({ id: l.id, amount: l.outstanding + l.interest_due })}>
                        Tất toán
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel title="Chuyển khoản cho người chơi khác">
          <div className="space-y-3">
            <Field label="Tên đăng nhập người nhận">{(id) => <input id={id} className="field" value={tr.toUsername} onChange={(e) => setTr({ ...tr, toUsername: e.target.value })} />}</Field>
            <Field label="Số tiền">{(id) => <input id={id} type="number" inputMode="numeric" className="field num" value={tr.amount} onChange={(e) => setTr({ ...tr, amount: Number(e.target.value) })} />}</Field>
            <Field label="Nội dung">{(id) => <input id={id} className="field" maxLength={120} value={tr.memo} onChange={(e) => setTr({ ...tr, memo: e.target.value })} />}</Field>
            <Button variant="secondary" className="w-full" icon={<Send size={16} />} disabled={!tr.toUsername || tr.amount <= 0} loading={send.isPending} onClick={() => send.mutate({ ...tr, memo: tr.memo || undefined })}>
              Chuyển {vnd(tr.amount, true)}
            </Button>
          </div>
        </Panel>
      </div>
      <Deposits />
      <Panel title="Lịch sử giao dịch tài khoản">
        <TableWrap>
          <table className="table min-w-[520px]">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Diễn giải</th>
                <th className="text-right">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.map((l, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap text-xs text-ink-400">{ago(l.created_at)}</td>
                  <td>
                    {l.memo}
                    {l.code === 'cash_locked' && <span className="ml-2 text-xs text-ink-400">(phong tỏa)</span>}
                  </td>
                  <td className="text-right">
                    <Money value={l.amount} signed />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Panel>
    </div>
  );
}
