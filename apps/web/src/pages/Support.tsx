import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { PageHeader, Panel, Button, Field, Loading, Empty, Badge } from '@/components/ui';
import { ago } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Support() {
  const q = useQuery({ queryKey: ['tickets'], queryFn: () => api<any>('/tickets') });
  const [form, setForm] = useState({ subject: '', body: '' });
  const [replies, setReplies] = useState<Record<string, string>>({});
  const create = useAction('/tickets', { invalidate: [['tickets']], success: 'Đã gửi yêu cầu hỗ trợ' });
  const reply = useAction<{ id: string; body: string }>((b) => `/tickets/${b.id}/messages`, { invalidate: [['tickets']] });
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cá nhân" title="Hỗ trợ người chơi" subtitle="Gặp lỗi, cần giải thích luật chơi hay báo cáo gian lận? Ban Quản Trị phản hồi qua hộp thư." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <Panel title="Gửi yêu cầu mới">
          <div className="space-y-3">
            <Field label="Tiêu đề">{(id) => <input id={id} className="field" maxLength={120} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>
            <Field label="Nội dung chi tiết">{(id) => <textarea id={id} className="field min-h-[140px]" maxLength={3000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}</Field>
            <Button className="w-full" disabled={form.subject.length < 4 || form.body.length < 10} loading={create.isPending} onClick={() => create.mutate(form, { onSuccess: () => setForm({ subject: '', body: '' }) })}>
              Gửi yêu cầu
            </Button>
          </div>
        </Panel>
        <Panel title="Yêu cầu của bạn">
          {q.isLoading ? (
            <Loading />
          ) : !q.data?.tickets.length ? (
            <Empty title="Chưa có yêu cầu hỗ trợ" />
          ) : (
            <ul className="space-y-4">
              {q.data.tickets.map((t: any) => (
                <li key={t.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white">{t.subject}</span>
                    <Badge tone={t.status === 'answered' ? 'gain' : t.status === 'open' ? 'sky' : 'muted'}>{t.status === 'answered' ? 'Đã phản hồi' : t.status === 'open' ? 'Đang chờ' : 'Đã đóng'}</Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {q.data.messages
                      .filter((m: any) => m.ticket_id === t.id)
                      .map((m: any) => (
                        <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.is_staff ? 'bg-sky-400/10 text-sky-50' : 'bg-ink-950/40 text-ink-200'}`}>
                          <div className="text-[11px] text-ink-400">
                            {m.is_staff ? 'Ban Quản Trị' : m.display_name} · {ago(m.created_at)}
                          </div>
                          <div className="whitespace-pre-line">{m.body}</div>
                        </div>
                      ))}
                  </div>
                  {t.status !== 'closed' && (
                    <div className="mt-3 flex gap-2">
                      <input aria-label="Trả lời" className="field" value={replies[t.id] ?? ''} onChange={(e) => setReplies({ ...replies, [t.id]: e.target.value })} placeholder="Bổ sung thông tin" />
                      <Button variant="secondary" disabled={!replies[t.id]} onClick={() => reply.mutate({ id: t.id, body: replies[t.id]! }, { onSuccess: () => setReplies({ ...replies, [t.id]: '' }) })}>
                        Gửi
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
