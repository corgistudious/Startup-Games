import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { PageHeader, Panel, Button, Loading, Empty, Tabs } from '@/components/ui';
import { ago } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
const KINDS: Record<string, string> = {
  all: 'Tất cả',
  report: 'Báo cáo tháng',
  finance: 'Tài chính',
  company: 'Doanh nghiệp',
  reviewer: 'Reviewer',
  announcement: 'Thông báo hệ thống',
};

export default function Inbox() {
  const [kind, setKind] = useState('all');
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<any[]>('/notifications') });
  const readAll = useAction('/notifications/read-all', { invalidate: [['notifications']] });
  const read = useAction<{ id: number }>((b) => `/notifications/${b.id}/read`, { invalidate: [['notifications']] });
  const list = (q.data ?? []).filter((n) => kind === 'all' || n.kind === kind);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cá nhân" title="Hộp thư" actions={<Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate({})}>Đánh dấu đã đọc tất cả</Button>} />
      <Tabs tabs={Object.entries(KINDS).map(([id, label]) => ({ id, label }))} value={kind} onChange={setKind} />
      <Panel bodyClass="p-0">
        {q.isLoading ? (
          <div className="p-5">
            <Loading />
          </div>
        ) : list.length === 0 ? (
          <Empty title="Hộp thư trống" />
        ) : (
          <ul>
            {list.map((n) => (
              <li key={n.id}>
                <button onClick={() => !n.read_at && read.mutate({ id: n.id })} className={clsx('flex w-full gap-3 border-b px-5 py-4 text-left transition hover:bg-sky-400/5', !n.read_at && 'bg-sky-400/[0.04]')} style={{ borderColor: 'var(--line)' }}>
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-sky-400')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={clsx('font-medium', n.read_at ? 'text-ink-200' : 'text-white')}>{n.title}</span>
                      <span className="shrink-0 text-xs text-ink-500">{ago(n.created_at)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-ink-300">{n.body}</p>
                    {n.data?.action === 'reviewer_invite' && (
                      <Link to="/reviewer" className="mt-2 inline-block text-sm text-sky-300 hover:underline">
                        Xem thư mời Reviewer
                      </Link>
                    )}
                    {n.data?.companyId && (
                      <Link to={`/companies/${n.data.companyId}`} className="mt-2 inline-block text-sm text-sky-300 hover:underline">
                        Mở doanh nghiệp
                      </Link>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
