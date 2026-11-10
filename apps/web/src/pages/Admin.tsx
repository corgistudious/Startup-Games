import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShieldCheck, Users, Building2, BadgeCheck, Flag, Megaphone, LifeBuoy, ScrollText, Activity, Scale, Radar, Gavel } from 'lucide-react';
import { api } from '@/lib/api';
import { useAction, useMe } from '@/lib/hooks';
import { PageHeader, Panel, Button, Badge, Tabs, Loading, Empty, Stat, Money, ConfirmButton, Field, TableWrap, Modal } from '@/components/ui';
import { TitleTags } from '@/components/Titles';
import { ago, gameTime, num, STATUS_LABEL } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'overview' | 'users' | 'companies' | 'reviewers' | 'moderation' | 'market' | 'disputes' | 'support' | 'broadcast' | 'audit';

export default function Admin() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<Tab>('overview');
  if (me?.role !== 'admin') return <Empty title="Không có quyền truy cập" text="Khu vực dành cho Ban Quản Trị." />;
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Quản trị" title="Admin Dashboard" subtitle="Mọi thao tác được kiểm tra quyền ở máy chủ và ghi vào nhật ký kiểm toán. Thao tác nhạy cảm yêu cầu xác nhận và lý do." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Kinh tế & Hệ thống', icon: <Activity size={16} /> },
          { id: 'users', label: 'Tài khoản', icon: <Users size={16} /> },
          { id: 'companies', label: 'Doanh nghiệp & Danh hiệu', icon: <Building2 size={16} /> },
          { id: 'reviewers', label: 'Reviewer', icon: <BadgeCheck size={16} /> },
          { id: 'moderation', label: 'Kiểm duyệt', icon: <Flag size={16} /> },
          { id: 'market', label: 'Giám sát chứng khoán', icon: <Radar size={16} /> },
          { id: 'disputes', label: 'Tranh chấp hợp đồng', icon: <Gavel size={16} /> },
          { id: 'support', label: 'Hỗ trợ', icon: <LifeBuoy size={16} /> },
          { id: 'broadcast', label: 'Thông báo', icon: <Megaphone size={16} /> },
          { id: 'audit', label: 'Nhật ký', icon: <ScrollText size={16} /> },
        ]}
      />
      {tab === 'overview' && <Overview />}
      {tab === 'users' && <UsersTab />}
      {tab === 'companies' && <CompaniesTab />}
      {tab === 'reviewers' && <ReviewersTab />}
      {tab === 'moderation' && <Moderation />}
      {tab === 'market' && <MarketWatch />}
      {tab === 'disputes' && <Disputes />}
      {tab === 'support' && <SupportTab />}
      {tab === 'broadcast' && <Broadcast />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Overview() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api<any>('/admin/overview'), refetchInterval: 20_000 });
  const jobs = useQuery({ queryKey: ['admin', 'jobs'], queryFn: () => api<any>('/admin/jobs') });
  const retry = useAction<{ id: number }>((b) => `/admin/jobs/${b.id}/retry`, { invalidate: [['admin', 'jobs']], success: 'Đã xếp lại hàng đợi' });
  if (q.isLoading) return <Loading />;
  const o = q.data;
  const lastBeat = o.world.workers[0]?.last_beat;
  const workerOk = lastBeat && Date.now() - new Date(lastBeat).getTime() < 60_000;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Người chơi" value={num(o.counts.users)} hint={`${o.counts.locked} bị khóa`} />
        <Stat label="Doanh nghiệp người chơi / NPC" value={`${o.counts.companies} / ${o.counts.npcs}`} hint={`${o.counts.bankrupt} phá sản`} />
        <Stat label="Báo cáo chờ xử lý" value={o.counts.open_reports} tone={o.counts.open_reports ? 'warn' : undefined} hint={`${o.counts.open_tickets} ticket mở`} />
        <Stat label="Worker thế giới" value={workerOk ? 'Đang chạy' : 'Mất kết nối'} tone={workerOk ? 'gain' : 'loss'} hint={lastBeat ? `Heartbeat ${ago(lastBeat)} · ${o.world.pending} job chờ` : 'Chưa có heartbeat'} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Kiểm toán sổ cái" eyebrow="Chạy trực tiếp trên toàn bộ bút toán" action={o.ledger.ok ? <Badge tone="gain" icon={<Scale size={12} />}>Cân bằng</Badge> : <Badge tone="loss">Phát hiện lệch</Badge>}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">Tổng các bút toán</dt>
              <dd className="num">{o.ledger.postingsSum}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Tài khoản lệch số dư</dt>
              <dd className="num">{o.ledger.driftAccounts}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Chủ thể mất cân đối</dt>
              <dd className="num">{o.ledger.unbalancedOwners}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Tiền đã phát hành</dt>
              <dd>
                <Money value={o.ledger.moneyIssued} compact />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">Tiền đang lưu thông</dt>
              <dd>
                <Money value={o.ledger.cashInCirculation} compact />
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Tài khoản hệ thống">
          <TableWrap>
            <table className="table">
              <tbody>
                {o.sectors.map((s: any) => (
                  <tr key={`${s.owner_id}-${s.code}`}>
                    <td className="text-ink-300">
                      {s.owner_id} · {s.code}
                    </td>
                    <td className="text-right">
                      <Money value={s.balance} compact />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      </div>
      <Panel title="Đồng hồ & hàng đợi" eyebrow={`Giờ game: ${gameTime(o.world.minute)}`}>
        <div className="flex flex-wrap gap-2 text-sm">
          {o.world.jobs.map((j: any) => (
            <Badge key={j.status} tone={j.status === 'failed' ? 'loss' : j.status === 'pending' ? 'sky' : 'muted'}>
              {j.status}: {num(j.n)}
            </Badge>
          ))}
          {o.world.lastTick && <Badge tone="muted">Tick gần nhất #{o.world.lastTick.tick} · {ago(o.world.lastTick.processed_at)}</Badge>}
        </div>
        {jobs.data?.failed.length > 0 && (
          <TableWrap>
            <table className="table mt-4 min-w-[640px]">
              <thead>
                <tr>
                  <th>Job lỗi</th>
                  <th>Lỗi</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {jobs.data.failed.map((j: any) => (
                  <tr key={j.id}>
                    <td className="text-xs">
                      {j.kind}
                      <div className="text-ink-500">{j.dedupe_key}</div>
                    </td>
                    <td className="max-w-md truncate text-xs text-loss">{j.last_error}</td>
                    <td className="text-right">
                      <Button size="sm" variant="secondary" onClick={() => retry.mutate({ id: j.id })}>
                        Chạy lại
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
      <Panel title="Thông số đề xuất cho danh hiệu Yêu Thích" eyebrow="Chờ chủ dự án phê duyệt">
        <pre className="overflow-x-auto rounded-xl bg-ink-950/60 p-3 text-xs text-ink-200">{JSON.stringify(o.favoriteParams, null, 2)}</pre>
      </Panel>
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin', 'users', search], queryFn: () => api<any[]>(`/admin/users${search ? `?q=${encodeURIComponent(search)}` : ''}`) });
  const lock = useAction<{ id: string; locked: boolean; reason: string }>((b) => `/admin/users/${b.id}/lock`, { invalidate: [['admin', 'users']], success: 'Đã cập nhật trạng thái tài khoản' });
  const role = useAction<{ id: string; role: string; reason: string }>((b) => `/admin/users/${b.id}/role`, { invalidate: [['admin', 'users']], success: 'Đã cập nhật quyền' });
  const invite = useAction('/admin/reviewers/invite', { invalidate: [['admin', 'users']], success: 'Đã gửi thư mời Reviewer' });
  const [inv, setInv] = useState<{ id: string; name: string; note: string } | null>(null);
  return (
    <Panel title="Tài khoản" action={<input aria-label="Tìm tài khoản" className="field max-w-[220px]" placeholder="Tìm tên" value={search} onChange={(e) => setSearch(e.target.value)} />}>
      {q.isLoading ? (
        <Loading />
      ) : (
        <TableWrap>
          <table className="table min-w-[900px]">
            <thead>
              <tr>
                <th>Người chơi</th>
                <th>Giai đoạn</th>
                <th className="text-right">Tiền mặt</th>
                <th>Trạng thái</th>
                <th>Reviewer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data?.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="text-white">
                      {u.display_name} {u.role === 'admin' && <Badge tone="gold">Admin</Badge>}
                    </div>
                    <div className="text-xs text-ink-400">
                      @{u.username} · đăng ký {ago(u.created_at)}
                    </div>
                  </td>
                  <td className="num">{u.stage}</td>
                  <td className="text-right">
                    <Money value={u.cash} compact />
                  </td>
                  <td>{u.status === 'locked' ? <Badge tone="loss">Bị khóa</Badge> : <Badge tone="gain">Hoạt động</Badge>}</td>
                  <td>{u.reviewer_status ? <Badge tone="sky">{u.reviewer_status}</Badge> : '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {!['invited', 'accepted', 'active'].includes(u.reviewer_status) && (
                      <Button size="sm" variant="ghost" onClick={() => setInv({ id: u.id, name: u.display_name, note: '' })}>
                        Mời Reviewer
                      </Button>
                    )}
                    <ConfirmButton
                      variant={u.status === 'locked' ? 'primary' : 'danger'}
                      label={u.status === 'locked' ? 'Mở khóa' : 'Khóa'}
                      title={`${u.status === 'locked' ? 'Mở khóa' : 'Khóa'} tài khoản ${u.display_name}`}
                      message={u.status === 'locked' ? 'Người chơi có thể đăng nhập lại.' : 'Toàn bộ phiên đăng nhập bị thu hồi ngay lập tức. Dữ liệu được giữ nguyên.'}
                      needReason
                      onConfirm={(reason) => lock.mutateAsync({ id: u.id, locked: u.status !== 'locked', reason })}
                    />
                    <ConfirmButton
                      variant="secondary"
                      label={u.role === 'admin' ? 'Gỡ Admin' : 'Cấp Admin'}
                      title="Thay đổi phân quyền"
                      message={`Đổi quyền của ${u.display_name} thành ${u.role === 'admin' ? 'người chơi' : 'Admin'}.`}
                      needReason
                      onConfirm={(reason) => role.mutateAsync({ id: u.id, role: u.role === 'admin' ? 'player' : 'admin', reason })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Modal open={!!inv} onClose={() => setInv(null)} title={`Mời ${inv?.name ?? ''} làm Reviewer`} footer={<Button disabled={(inv?.note.length ?? 0) < 5} loading={invite.isPending} onClick={() => inv && invite.mutate({ userId: inv.id, note: inv.note }, { onSuccess: () => setInv(null) })}>Gửi thư mời</Button>}>
        <Field label="Lời mời (hiển thị trong hộp thư người chơi)">{(id) => <textarea id={id} className="field min-h-[100px]" value={inv?.note ?? ''} onChange={(e) => inv && setInv({ ...inv, note: e.target.value })} />}</Field>
      </Modal>
    </Panel>
  );
}

function CompaniesTab() {
  const q = useQuery({ queryKey: ['admin', 'companies'], queryFn: () => api<any[]>('/admin/companies') });
  const title = useAction<{ id: string; title: string; grant: boolean; reason: string }>((b) => `/admin/companies/${b.id}/titles`, { invalidate: [['admin', 'companies']], success: 'Đã cập nhật danh hiệu' });
  const verify = useAction<{ id: string; verified: boolean; reason: string }>((b) => `/admin/companies/${b.id}/verify`, { invalidate: [['admin', 'companies']], success: 'Đã cập nhật Verified' });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Doanh nghiệp">
      <TableWrap>
        <table className="table min-w-[960px]">
          <thead>
            <tr>
              <th>Doanh nghiệp</th>
              <th>Trạng thái</th>
              <th className="text-right">Tiền mặt</th>
              <th className="text-right">Nhân sự</th>
              <th>Danh hiệu</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/library/${c.slug}`} className="text-white hover:text-sky-200">
                    {c.name}
                  </Link>
                  <div className="text-xs text-ink-400">
                    {c.industry} · {c.is_npc ? 'NPC' : `@${c.owner}`}
                  </div>
                </td>
                <td>
                  <Badge tone={c.status === 'active' ? 'gain' : c.status === 'licensing' ? 'sky' : 'loss'}>{STATUS_LABEL[c.status]}</Badge>
                </td>
                <td className="text-right">
                  <Money value={c.cash} compact />
                </td>
                <td className="num text-right">{c.employees}</td>
                <td>
                  <TitleTags titles={c.titles} verified={c.verified} />
                </td>
                <td className="whitespace-nowrap text-right">
                  {!c.is_npc &&
                    (c.titles.includes('tuyen_chon') ? (
                      <ConfirmButton label="Thu hồi Tuyển Chọn" title="Thu hồi danh hiệu Tuyển Chọn" message={c.name} needReason onConfirm={(reason) => title.mutateAsync({ id: c.id, title: 'tuyen_chon', grant: false, reason })} />
                    ) : (
                      <ConfirmButton variant="primary" label="Cấp Tuyển Chọn" title="Cấp danh hiệu Tuyển Chọn" message={`${c.name} sẽ hiển thị tag Tuyển Chọn trong Thư viện.`} needReason onConfirm={(reason) => title.mutateAsync({ id: c.id, title: 'tuyen_chon', grant: true, reason })} />
                    ))}
                  {c.titles.includes('yeu_thich') && <ConfirmButton label="Thu hồi Yêu Thích" title="Thu hồi danh hiệu Yêu Thích" message="Chỉ dùng khi phát hiện thao túng đánh giá." needReason onConfirm={(reason) => title.mutateAsync({ id: c.id, title: 'yeu_thich', grant: false, reason })} />}
                  <ConfirmButton variant="secondary" label={c.verified ? 'Gỡ Verified' : 'Verified'} title="Xác minh doanh nghiệp" message={c.name} needReason onConfirm={(reason) => verify.mutateAsync({ id: c.id, verified: !c.verified, reason })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}

function ReviewersTab() {
  const q = useQuery({ queryKey: ['admin', 'reviewers'], queryFn: () => api<any[]>('/admin/reviewers') });
  const revoke = useAction<{ id: string; reason: string }>((b) => `/admin/reviewers/${b.id}/revoke`, { invalidate: [['admin', 'reviewers']], success: 'Đã thu hồi vai trò Reviewer' });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Đội ngũ Reviewer" eyebrow="Mời Reviewer mới từ tab Tài khoản">
      {!q.data?.length ? (
        <Empty title="Chưa có Reviewer" />
      ) : (
        <TableWrap>
          <table className="table min-w-[760px]">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Trạng thái</th>
                <th className="text-right">Uy tín</th>
                <th className="text-right">Điểm đánh giá</th>
                <th>Đánh giá gần nhất</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.user_id}>
                  <td>
                    <div className="text-white">{r.display_name}</div>
                    <div className="text-xs text-ink-400">@{r.username}</div>
                  </td>
                  <td>
                    <Badge tone={r.status === 'active' ? 'gain' : r.status === 'revoked' ? 'loss' : 'sky'}>{r.status}</Badge>
                  </td>
                  <td className="num text-right">{r.reputation}</td>
                  <td className="num text-right">{r.eval_points}</td>
                  <td className="text-xs text-ink-400">{r.last_valid_review_at ? ago(r.last_valid_review_at) : '—'}</td>
                  <td className="text-right">{['invited', 'accepted', 'active'].includes(r.status) && <ConfirmButton label="Thu hồi" title={`Thu hồi Reviewer ${r.display_name}`} message="Mọi đề cử của Reviewer này sẽ bị vô hiệu." needReason onConfirm={(reason) => revoke.mutateAsync({ id: r.user_id, reason })} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Panel>
  );
}

function Moderation() {
  const q = useQuery({ queryKey: ['admin', 'reports'], queryFn: () => api<any[]>('/admin/reports') });
  const mod = useAction<{ id: string; hide: boolean; reason: string }>((b) => `/admin/reviews/${b.id}/moderate`, { invalidate: [['admin', 'reports']], success: 'Đã xử lý' });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Báo cáo đánh giá">
      {!q.data?.length ? (
        <Empty title="Không có báo cáo" />
      ) : (
        <ul className="space-y-4">
          {q.data.map((r) => (
            <li key={r.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <b className="text-white">{r.company}</b> · {r.rating}★ bởi {r.author}
                </span>
                <Badge tone={r.status === 'open' ? 'warn' : 'muted'}>{r.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-ink-200">{r.body}</p>
              <p className="mt-2 text-xs text-ink-400">
                Báo cáo bởi {r.reporter}: “{r.reason}” · {ago(r.created_at)}
              </p>
              {r.status === 'open' && (
                <div className="mt-3 flex gap-2">
                  <ConfirmButton label="Ẩn đánh giá" title="Ẩn đánh giá vi phạm" message="Đánh giá bị ẩn khỏi hồ sơ công khai và không tính vào điểm." needReason onConfirm={(reason) => mod.mutateAsync({ id: r.review_id, hide: true, reason })} />
                  <ConfirmButton variant="secondary" label="Giữ nguyên" title="Bác bỏ báo cáo" message="Đánh giá hợp lệ được giữ nguyên." needReason onConfirm={(reason) => mod.mutateAsync({ id: r.review_id, hide: false, reason })} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SupportTab() {
  const q = useQuery({ queryKey: ['admin', 'tickets'], queryFn: () => api<any>('/admin/tickets') });
  const [text, setText] = useState<Record<string, string>>({});
  const reply = useAction<{ id: string; body: string; close: boolean }>((b) => `/admin/tickets/${b.id}/reply?close=${b.close}`, { invalidate: [['admin', 'tickets']], success: 'Đã phản hồi' });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Yêu cầu hỗ trợ">
      {!q.data.tickets.length ? (
        <Empty title="Không có ticket" />
      ) : (
        <ul className="space-y-4">
          {q.data.tickets.map((t: any) => (
            <li key={t.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">
                  {t.subject} <span className="text-xs text-ink-400">@{t.username}</span>
                </span>
                <Badge tone={t.status === 'open' ? 'warn' : 'muted'}>{t.status}</Badge>
              </div>
              <div className="mt-2 space-y-1.5">
                {q.data.messages
                  .filter((m: any) => m.ticket_id === t.id)
                  .map((m: any) => (
                    <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.is_staff ? 'bg-sky-400/10' : 'bg-ink-950/40'}`}>
                      <span className="text-[11px] text-ink-400">{m.display_name}: </span>
                      {m.body}
                    </div>
                  ))}
              </div>
              {t.status !== 'closed' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <input aria-label="Phản hồi" className="field min-w-[200px] flex-1" value={text[t.id] ?? ''} onChange={(e) => setText({ ...text, [t.id]: e.target.value })} />
                  <Button size="sm" disabled={!text[t.id]} onClick={() => reply.mutate({ id: t.id, body: text[t.id]!, close: false })}>
                    Trả lời
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!text[t.id]} onClick={() => reply.mutate({ id: t.id, body: text[t.id]!, close: true })}>
                    Trả lời & đóng
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Broadcast() {
  const [form, setForm] = useState({ title: '', body: '' });
  const send = useAction('/admin/broadcast', { success: 'Đã gửi thông báo tới mọi người chơi' });
  return (
    <Panel title="Gửi thông báo hệ thống">
      <div className="max-w-2xl space-y-3">
        <Field label="Tiêu đề">{(id) => <input id={id} className="field" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
        <Field label="Nội dung">{(id) => <textarea id={id} className="field min-h-[140px]" maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />}</Field>
        <ConfirmButton variant="primary" label="Gửi tới tất cả người chơi" title="Xác nhận gửi thông báo" message={`"${form.title}" sẽ được gửi vào hộp thư của mọi người chơi đang hoạt động.`} onConfirm={() => send.mutateAsync(form).then(() => setForm({ title: '', body: '' }))} icon={<ShieldCheck size={15} />} />
      </div>
    </Panel>
  );
}

function Audit() {
  const q = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => api<any[]>('/admin/audit') });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Nhật ký kiểm toán" eyebrow="200 thao tác gần nhất">
      <TableWrap>
        <table className="table min-w-[720px]">
          <thead>
            <tr>
              <th>Thời điểm</th>
              <th>Người thực hiện</th>
              <th>Hành động</th>
              <th>Đối tượng</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap text-xs text-ink-400">{ago(a.created_at)}</td>
                <td>{a.actor ?? 'hệ thống'}</td>
                <td>
                  <Badge tone="sky">{a.action}</Badge>
                </td>
                <td className="text-xs text-ink-300">
                  {a.target_type} {a.target_id?.slice(0, 8)}
                </td>
                <td className="max-w-xs truncate text-xs text-ink-400">{JSON.stringify(a.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Panel>
  );
}

const ALERT_KIND: Record<string, string> = { price_spike: 'Biến động giá bất thường', wash_trading: 'Giao dịch vòng (wash trading)', concentration: 'Tập trung khối lượng' };

function MarketWatch() {
  const alerts = useQuery({ queryKey: ['admin', 'surveillance'], queryFn: () => api<any[]>('/admin/surveillance') });
  const symbols = useQuery({ queryKey: ['exchange'], queryFn: () => api<any[]>('/exchange') });
  const inv = [['admin', 'surveillance'], ['exchange']];
  const resolve = useAction<{ id: number; resolution: string; resume: boolean }>((b) => `/admin/surveillance/${b.id}/resolve`, { invalidate: inv, success: 'Đã xử lý cảnh báo' });
  const halt = useAction<{ symbol: string; halted: boolean; reason: string }>((b) => `/admin/exchange/${b.symbol}/halt`, { invalidate: inv, success: 'Đã cập nhật trạng thái giao dịch' });
  const delist = useAction<{ symbol: string; reason: string }>((b) => `/admin/exchange/${b.symbol}/delist`, { invalidate: inv, success: 'Đã hủy niêm yết' });
  return (
    <div className="space-y-5">
      <Panel title="Cảnh báo giám sát" eyebrow="Tự động mỗi giờ game: biến động giá, giao dịch vòng, tập trung khối lượng">
        {alerts.isLoading ? (
          <Loading />
        ) : !alerts.data?.length ? (
          <Empty title="Không có cảnh báo" />
        ) : (
          <ul className="space-y-3">
            {alerts.data.map((a) => (
              <li key={a.id} className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--line)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b className="text-white">{a.symbol}</b> · {ALERT_KIND[a.kind]} {a.auto_halted && <Badge tone="warn">Đã tự động tạm ngừng</Badge>}
                  </span>
                  <Badge tone={a.status === 'open' ? (a.severity === 'high' ? 'loss' : 'warn') : 'muted'}>{a.status === 'open' ? (a.severity === 'high' ? 'Nghiêm trọng' : 'Trung bình') : 'Đã xử lý'}</Badge>
                </div>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-950/60 p-2 text-xs text-ink-300">{JSON.stringify(a.detail, null, 1)}</pre>
                {a.resolution && <p className="mt-1 text-xs text-ink-400">Kết luận: {a.resolution}</p>}
                {a.status === 'open' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <ConfirmButton variant="secondary" label="Đóng cảnh báo" title="Kết luận cảnh báo" message="Ghi kết luận điều tra." needReason onConfirm={(r) => resolve.mutateAsync({ id: a.id, resolution: r, resume: false })} />
                    {a.auto_halted && <ConfirmButton variant="primary" label="Đóng và mở lại giao dịch" title="Mở lại giao dịch" message={`Mã ${a.symbol} được giao dịch trở lại.`} needReason onConfirm={(r) => resolve.mutateAsync({ id: a.id, resolution: r, resume: true })} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Mã niêm yết">
        <TableWrap>
          <table className="table min-w-[640px]">
            <tbody>
              {symbols.data?.map((s) => (
                <tr key={s.symbol}>
                  <td className="num font-semibold text-sky-200">{s.symbol}</td>
                  <td>{s.name}</td>
                  <td>
                    <Badge tone={s.status === 'listed' ? 'gain' : s.status === 'halted' ? 'warn' : 'muted'}>{({ listed: 'Giao dịch', halted: 'Tạm ngừng', delisted: 'Hủy niêm yết' } as Record<string, string>)[s.status]}</Badge>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {s.status !== 'delisted' && (
                      <>
                        <ConfirmButton variant="secondary" label={s.status === 'halted' ? 'Mở lại' : 'Tạm ngừng'} title="Thay đổi trạng thái giao dịch" message={s.symbol} needReason onConfirm={(reason) => halt.mutateAsync({ symbol: s.symbol, halted: s.status !== 'halted', reason })} />
                        <ConfirmButton label="Hủy niêm yết" title={`Hủy niêm yết bắt buộc ${s.symbol}`} message="Mọi lệnh đang chờ bị hủy, cổ đông vẫn giữ cổ phần nhưng không giao dịch được trên sàn." needReason onConfirm={(reason) => delist.mutateAsync({ symbol: s.symbol, reason })} />
                      </>
                    )}
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

function Disputes() {
  const q = useQuery({ queryKey: ['admin', 'disputes'], queryFn: () => api<any[]>('/admin/disputes') });
  const [rate, setRate] = useState<Record<string, number>>({});
  const resolve = useAction<{ id: string; refundRate: number; resolution: string }>((b) => `/admin/disputes/${b.id}/resolve`, { invalidate: [['admin', 'disputes']], success: 'Đã ra phán quyết' });
  if (q.isLoading) return <Loading />;
  return (
    <Panel title="Tranh chấp giao hàng theo hợp đồng" eyebrow="Hoàn tiền được chuyển từ bên bán sang bên mua, tối đa số tiền bên bán đang có">
      {!q.data?.length ? (
        <Empty title="Không có tranh chấp" />
      ) : (
        <ul className="space-y-3">
          {q.data.map((x) => (
            <li key={x.id} className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--line)' }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b className="text-white">{x.buyer_name}</b> khiếu nại <b className="text-white">{x.seller_name}</b> · lần giao {x.seq} · {x.qty_per_delivery} {x.good_name} · <Money value={x.value} compact />
                </span>
                <Badge tone={x.status === 'disputed' ? 'loss' : 'muted'}>{x.status === 'disputed' ? 'Chờ phân xử' : 'Đã phân xử'}</Badge>
              </div>
              <p className="mt-2 text-ink-200">“{x.dispute_reason}”</p>
              {x.resolution && <p className="mt-1 text-xs text-ink-400">Phán quyết: {x.resolution} · hoàn {Number(x.refund).toLocaleString('vi-VN')} ₫</p>}
              {x.status === 'disputed' && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label="Tỷ lệ hoàn tiền">
                    {(id) => (
                      <select id={id} className="field w-32" value={rate[x.id] ?? 0.5} onChange={(e) => setRate({ ...rate, [x.id]: Number(e.target.value) })}>
                        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                          <option key={r} value={r}>
                            {r * 100}%
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                  <ConfirmButton variant="primary" label="Ra phán quyết" title="Phân xử tranh chấp" message={`Hoàn ${(rate[x.id] ?? 0.5) * 100}% giá trị lô hàng cho bên mua.`} needReason onConfirm={(r) => resolve.mutateAsync({ id: x.id, refundRate: rate[x.id] ?? 0.5, resolution: r })} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
