import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PiggyBank } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { Panel, Button, Field, Badge, Money, Empty, ConfirmButton } from './ui';
import { vnd, gameTime } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TERMS = [
  [0, 'Không kỳ hạn (rút bất cứ lúc nào)'],
  [7, '7 ngày game'],
  [14, '14 ngày game'],
  [28, '28 ngày game'],
] as const;

export function Deposits({ companyId }: { companyId?: string }) {
  const qs = companyId ? `?companyId=${companyId}` : '';
  const key = ['deposits', companyId ?? 'me'];
  const q = useQuery({ queryKey: key, queryFn: () => api<any>(`/bank/deposits${qs}`) });
  const [form, setForm] = useState({ amount: 50_000_000, termDays: 7 as 0 | 7 | 14 | 28 });
  const inv = [key, ['overview'], ['company', companyId ?? ''], ['ledger']];
  const open = useAction(`/bank/deposits${qs}`, { invalidate: inv, success: 'Đã gửi tiền vào ngân hàng' });
  const withdraw = useAction<{ id: string }, { interest: number; early: boolean }>((b) => `/bank/deposits/${b.id}/withdraw`, { invalidate: inv, success: (r) => (r.early ? 'Đã rút trước hạn (không hưởng lãi)' : `Đã rút kèm lãi ${vnd(r.interest)}`) });
  const rate = q.data?.rates?.[form.termDays] ?? 0;
  const deposits = q.data?.deposits ?? [];
  return (
    <Panel title="Tiền gửi ngân hàng" eyebrow="Lãi tính mỗi ngày game, trả khi đáo hạn hoặc khi rút">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Số tiền">{(id) => <input id={id} type="number" inputMode="numeric" className="field num" step={10_000_000} value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />}</Field>
        <Field label="Kỳ hạn" hint={`Lãi ${(rate / 100).toLocaleString('vi-VN')}%/ngày · ước tính ${vnd(Math.floor((form.amount * rate) / 10_000) * Math.max(1, form.termDays))} ${form.termDays ? 'khi đáo hạn' : 'mỗi ngày'}`}>
          {(id) => (
            <select id={id} className="field" value={form.termDays} onChange={(e) => setForm({ ...form, termDays: Number(e.target.value) as 0 | 7 | 14 | 28 })}>
              {TERMS.map(([t, l]) => (
                <option key={t} value={t}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="flex items-end">
          <Button className="w-full" variant="secondary" icon={<PiggyBank size={16} />} loading={open.isPending} disabled={form.amount < 1_000_000} onClick={() => open.mutate(form)}>
            Gửi tiền
          </Button>
        </div>
      </div>
      {deposits.length === 0 ? (
        <Empty title="Chưa có khoản tiền gửi" />
      ) : (
        <ul className="mt-4 space-y-2 text-sm">
          {deposits.map((d: any) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-950/40 px-3 py-2">
              <span>
                <Money value={d.amount} compact /> · {d.term_days ? `${d.term_days} ngày` : 'không kỳ hạn'} · lãi tích lũy <Money value={d.accrued} />
                {d.maturity_minute && d.status === 'active' && <span className="text-xs text-ink-400"> · đáo hạn {gameTime(d.maturity_minute)}</span>}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={d.status === 'active' ? 'sky' : 'muted'}>{({ active: 'Đang gửi', withdrawn: 'Đã rút', matured: 'Đã đáo hạn' } as Record<string, string>)[d.status]}</Badge>
                {d.status === 'active' &&
                  (d.term_days && q.data && d.maturity_minute > q.data.minute ? (
                    <ConfirmButton label="Rút trước hạn" title="Rút tiền gửi trước hạn" message={`Bạn nhận lại gốc ${vnd(d.amount)} nhưng mất toàn bộ lãi đã tích lũy (${vnd(d.accrued)}).`} onConfirm={() => withdraw.mutateAsync({ id: d.id })} />
                  ) : (
                    <Button size="sm" variant="outline" loading={withdraw.isPending} onClick={() => withdraw.mutate({ id: d.id })}>
                      Rút
                    </Button>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
