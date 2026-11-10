import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Flag, MessageSquareReply, BadgeCheck, Users, MapPin, CalendarDays } from 'lucide-react';
import { stageName } from '@startup/shared';
import { api } from '@/lib/api';
import { useAction, useMe } from '@/lib/hooks';
import { useSession } from '@/lib/store';
import { Panel, Button, Field, Loading, ErrorBox, Empty, Logo, initials, Badge, Modal } from '@/components/ui';
import { TitleTags, Stars } from '@/components/Titles';
import { Bars } from '@/components/charts';
import { ago, monthLabel, STATUS_LABEL, gameTime } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function LibraryProfile() {
  const { slug = '' } = useParams();
  const token = useSession((s) => s.token);
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['profile', slug], queryFn: () => api<any>(`/library/${slug}`) });
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [report, setReport] = useState<{ id: string; text: string } | null>(null);
  const [note, setNote] = useState('');
  const id = q.data?.company.id;
  const review = useAction(`/companies/${id}/reviews`, { invalidate: [['profile', slug]], success: 'Cảm ơn bạn đã đánh giá' });
  const doReply = useAction<{ id: string; body: string }>((b) => `/reviews/${b.id}/reply`, { invalidate: [['profile', slug]], success: 'Đã phản hồi' });
  const doReport = useAction<{ id: string; reason: string }>((b) => `/reviews/${b.id}/report`, { success: 'Đã gửi báo cáo cho Ban Quản Trị' });
  const rec = useAction(`/companies/${id}/recommend`, { invalidate: [['profile', slug]], success: 'Đã cập nhật đề cử' });
  if (q.isLoading) return <Loading rows={4} />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { company: c, reviews, stats, recommendations, recommenders, history, titleHistory } = q.data;
  const isOwner = me && c.owner_user_id === me.id;
  const mine = reviews.find((r: any) => r.author_id === me?.id);
  const isReviewer = me?.reviewer?.status === 'active';
  const recommended = recommenders.some((r: any) => r.display_name === me?.display_name);

  return (
    <div className="space-y-5">
      <section className="panel rise overflow-hidden">
        <div className="h-24 sm:h-32" style={{ background: `linear-gradient(120deg, hsl(${c.logo_hue} 60% 30%), #0A1226 70%)` }} />
        <div className="-mt-10 flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <Logo hue={c.logo_hue} glyph={initials(c.name)} size={84} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold sm:text-3xl">{c.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-300">
              <span>{c.industry}</span>
              <span className="inline-flex items-center gap-1">
                <MapPin size={13} />
                {c.location}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users size={13} />
                {c.employees} nhân sự
              </span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={13} />
                Thành lập {gameTime(c.founded_minute)}
              </span>
            </div>
            <div className="mt-2">
              <TitleTags titles={c.titles} recommendations={recommendations} verified={c.verified} />
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-2">
              <Stars value={stats.avg ?? 0} size={18} />
              <span className="num text-2xl font-semibold text-white">{stats.avg ? stats.avg.toFixed(1) : '—'}</span>
            </div>
            <div className="text-xs text-ink-400">{stats.n} đánh giá hợp lệ</div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Giới thiệu">
            <p className="whitespace-pre-line text-sm text-ink-200">{c.description || 'Doanh nghiệp chưa viết giới thiệu.'}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-ink-400">Chủ sở hữu</dt>
                <dd className="text-white">{c.owner ?? 'NPC'}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Giai đoạn</dt>
                <dd className="text-white">{c.owner_stage ? stageName(c.owner_stage) : '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Trạng thái</dt>
                <dd className="text-white">{STATUS_LABEL[c.status]}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Uy tín</dt>
                <dd className="num text-white">{Number(c.reputation).toFixed(0)}/100</dd>
              </div>
            </dl>
            {c.symbol && token && (
              <Link to={`/exchange/${c.symbol}`} className="mt-4 inline-block text-sm text-sky-300 hover:underline">
                Cổ phiếu {c.symbol} trên sàn
              </Link>
            )}
          </Panel>
          {history.length > 0 && (
            <Panel title="Lịch sử phát triển" eyebrow="Báo cáo tháng đã chốt">
              <Bars data={history.map((h: any) => ({ ...h, label: monthLabel(h.month) }))} x="label" bars={[{ key: 'revenue', color: '#38BDF8', name: 'Doanh thu' }, { key: 'net_profit', color: '#34D399', name: 'Lợi nhuận' }]} height={200} />
            </Panel>
          )}
          <Panel title={`Đánh giá (${stats.n})`}>
            {token && !isOwner && !mine && c.owner_user_id && (
              <div className="mb-6 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                <div className="mb-2 flex items-center gap-1" role="radiogroup" aria-label="Số sao">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} role="radio" aria-checked={rating === n} aria-label={`${n} sao`} onClick={() => setRating(n)} className={`grid h-10 w-10 place-items-center rounded-lg text-xl ${n <= rating ? 'text-amber-300' : 'text-ink-600'}`}>
                      ★
                    </button>
                  ))}
                </div>
                <Field label="Nhận xét cụ thể (tối thiểu 20 ký tự)" hint="Mỗi tài khoản đánh giá một lần. Chủ doanh nghiệp không thể xóa đánh giá hợp lệ.">
                  {(fid) => <textarea id={fid} className="field min-h-[96px]" maxLength={1500} value={body} onChange={(e) => setBody(e.target.value)} />}
                </Field>
                <Button className="mt-3" disabled={body.trim().length < 20} loading={review.isPending} onClick={() => review.mutate({ rating, body }, { onSuccess: () => setBody('') })}>
                  Gửi đánh giá
                </Button>
              </div>
            )}
            {reviews.length === 0 ? (
              <Empty title="Chưa có đánh giá" />
            ) : (
              <ul className="space-y-4">
                {reviews.map((r: any) => (
                  <li key={r.id} className="border-b pb-4 last:border-0" style={{ borderColor: 'var(--line)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars value={r.rating} />
                      <span className="text-sm font-medium text-white">{r.author}</span>
                      {r.by_reviewer && (
                        <Badge tone="sky" icon={<BadgeCheck size={11} />}>
                          Reviewer
                        </Badge>
                      )}
                      <span className="text-xs text-ink-500">{ago(r.created_at)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-line text-sm text-ink-200">{r.body}</p>
                    {r.owner_reply && (
                      <div className="mt-2 rounded-lg border-l-2 border-sky-400/60 bg-sky-400/5 px-3 py-2 text-sm text-ink-200">
                        <div className="text-xs font-medium text-sky-200">Phản hồi từ doanh nghiệp</div>
                        {r.owner_reply}
                      </div>
                    )}
                    {token && (
                      <div className="mt-2 flex gap-1">
                        {isOwner && (
                          <Button size="sm" variant="ghost" icon={<MessageSquareReply size={14} />} onClick={() => setReply({ id: r.id, text: r.owner_reply ?? '' })}>
                            Phản hồi
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={<Flag size={14} />} onClick={() => setReport({ id: r.id, text: '' })}>
                          Báo cáo
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Phân bố điểm">
            {[5, 4, 3, 2, 1].map((n) => {
              const cnt = Number(stats.dist?.[n] ?? 0);
              return (
                <div key={n} className="mb-2 flex items-center gap-2 text-sm">
                  <span className="w-6 text-ink-300">{n}★</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700/70">
                    <div className="h-full rounded-full bg-amber-300" style={{ width: `${stats.n ? (cnt / stats.n) * 100 : 0}%` }} />
                  </div>
                  <span className="num w-8 text-right text-xs text-ink-400">{cnt}</span>
                </div>
              );
            })}
          </Panel>
          <Panel title={`Reviewer đề cử: ${recommendations}`}>
            {recommenders.length === 0 ? (
              <p className="text-sm text-ink-400">Chưa có Reviewer đề cử.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recommenders.map((r: any, i: number) => (
                  <li key={i}>
                    <span className="text-white">{r.display_name}</span>
                    {r.note && <div className="text-xs text-ink-400">“{r.note}”</div>}
                  </li>
                ))}
              </ul>
            )}
            {isReviewer && !isOwner && (
              <div className="mt-4 space-y-2">
                {!recommended && <input aria-label="Ghi chú đề cử" className="field" placeholder="Lý do đề cử (tùy chọn)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
                <Button variant={recommended ? 'outline' : 'primary'} className="w-full" loading={rec.isPending} onClick={() => rec.mutate({ on: !recommended, note })}>
                  {recommended ? 'Thu hồi đề cử' : 'Đề cử doanh nghiệp'}
                </Button>
              </div>
            )}
          </Panel>
          {titleHistory.length > 0 && (
            <Panel title="Lịch sử danh hiệu">
              <ul className="space-y-2 text-sm">
                {titleHistory.map((t: any, i: number) => (
                  <li key={i}>
                    <span className="text-white">{t.title === 'tuyen_chon' ? 'Tuyển Chọn' : 'Yêu Thích'}</span> <span className="text-xs text-ink-400">· {ago(t.granted_at)}</span>
                    <div className="text-xs text-ink-400">{t.reason}</div>
                    {t.revoked_at && <div className="text-xs text-loss">Thu hồi: {t.revoke_reason}</div>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <Modal open={!!reply} onClose={() => setReply(null)} title="Phản hồi đánh giá" footer={<Button loading={doReply.isPending} onClick={() => reply && doReply.mutate({ id: reply.id, body: reply.text }, { onSuccess: () => setReply(null) })}>Gửi phản hồi</Button>}>
        <textarea aria-label="Nội dung phản hồi" className="field min-h-[120px]" value={reply?.text ?? ''} onChange={(e) => reply && setReply({ ...reply, text: e.target.value })} />
      </Modal>
      <Modal open={!!report} onClose={() => setReport(null)} title="Báo cáo đánh giá vi phạm" footer={<Button variant="danger" disabled={(report?.text.length ?? 0) < 5} loading={doReport.isPending} onClick={() => report && doReport.mutate({ id: report.id, reason: report.text }, { onSuccess: () => setReport(null) })}>Gửi báo cáo</Button>}>
        <Field label="Lý do">{(fid) => <textarea id={fid} className="field min-h-[100px]" value={report?.text ?? ''} onChange={(e) => report && setReport({ ...report, text: e.target.value })} />}</Field>
      </Modal>
    </div>
  );
}
