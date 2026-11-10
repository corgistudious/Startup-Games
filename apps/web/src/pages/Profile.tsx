import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle } from 'lucide-react';
import { STAGES, stageName, reviewerRank } from '@startup/shared';
import { api } from '@/lib/api';
import { useAction, useMe } from '@/lib/hooks';
import { PageHeader, Panel, Button, Field, Badge, Loading } from '@/components/ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
const UNLOCKS: Record<number, string[]> = {
  1: ['Thành lập 1 doanh nghiệp', 'Giao dịch chứng khoán', 'Chuyển khoản'],
  2: ['Vay vốn cá nhân và doanh nghiệp', 'Quảng cáo tờ rơi, mạng xã hội, báo chí'],
  3: ['Sở hữu 2 doanh nghiệp', 'Quảng cáo truyền hình', 'Đủ điều kiện IPO'],
  4: ['Sở hữu 3 doanh nghiệp', 'Hạn mức vay cá nhân cao hơn'],
  5: ['Sở hữu tối đa 6 doanh nghiệp, xây dựng tập đoàn'],
};

export default function Profile() {
  const { data: me } = useMe();
  const stage = useQuery({ queryKey: ['stage'], queryFn: () => api<any>('/me/stage') });
  const [form, setForm] = useState({ displayName: '', bio: '' });
  useEffect(() => {
    if (me) setForm({ displayName: me.display_name, bio: me.bio });
  }, [me]);
  const save = useAction('/me/profile', { method: 'PATCH', success: 'Đã lưu hồ sơ' });
  if (!me || stage.isLoading) return <Loading />;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cá nhân" title="Hồ sơ doanh nhân" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        <Panel>
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl text-2xl font-semibold text-white" style={{ background: `hsl(${me.avatar_hue} 60% 40%)` }}>
              {me.display_name[0]}
            </div>
            <div>
              <div className="font-display text-xl font-semibold text-white">{me.display_name}</div>
              <div className="text-sm text-ink-400">@{me.username}</div>
              <div className="mt-1 flex gap-1.5">
                <Badge tone="sky">{stageName(me.stage)}</Badge>
                {me.role === 'admin' && <Badge tone="gold">Ban Quản Trị</Badge>}
                {me.reviewer?.status === 'active' && <Badge tone="gain">{reviewerRank(me.reviewer.eval_points).name}</Badge>}
              </div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <Field label="Tên hiển thị">{(id) => <input id={id} className="field" maxLength={40} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}</Field>
            <Field label="Giới thiệu bản thân">{(id) => <textarea id={id} className="field min-h-[96px]" maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />}</Field>
            <Button loading={save.isPending} onClick={() => save.mutate(form)}>
              Lưu hồ sơ
            </Button>
          </div>
        </Panel>
        <Panel title="Năm giai đoạn phát triển" eyebrow="Mỗi giai đoạn mở khóa cơ chế quản lý mới">
          <ol className="space-y-4">
            {STAGES.map((s) => {
              const reqs = stage.data.reqs[s.stage] ?? [];
              const done = me.stage >= s.stage;
              return (
                <li key={s.stage} className={`rounded-xl border p-4 ${me.stage === s.stage ? 'border-sky-400/60 bg-sky-400/5' : ''}`} style={me.stage === s.stage ? undefined : { borderColor: 'var(--line)' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">
                      {s.stage}. {s.name}
                    </span>
                    {done ? <Badge tone="gain">Đã đạt</Badge> : <Badge>Chưa đạt</Badge>}
                  </div>
                  <div className="mt-1 text-xs text-ink-400">Mở khóa: {UNLOCKS[s.stage]?.join(' · ')}</div>
                  {!done && reqs.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {reqs.map((r: any) => (
                        <li key={r.label} className="flex gap-2">
                          {r.met ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-gain" /> : <Circle size={16} className="mt-0.5 shrink-0 text-ink-500" />}
                          <span className="text-ink-200">
                            {r.label} <span className="text-xs text-ink-400">({r.detail})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-ink-400">Điều kiện được xét tự động khi chốt mỗi tháng game.</p>
        </Panel>
      </div>
    </div>
  );
}
