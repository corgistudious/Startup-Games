import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ShieldAlert, MailOpen } from 'lucide-react';
import clsx from 'clsx';
import { REVIEWER_RANKS } from '@startup/shared';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { PageHeader, Panel, Button, Loading, Empty, Badge, Progress, Stat } from '@/components/ui';
import { ago } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Reviewer() {
  const q = useQuery({ queryKey: ['reviewer'], queryFn: () => api<any>('/reviewer/me') });
  const respond = useAction('/reviewer/respond', { invalidate: [['reviewer']] });
  const [answers, setAnswers] = useState<number[]>([-1, -1, -1, -1, -1]);
  const quiz = useAction<object, { passed: boolean; correct: number }>('/reviewer/quiz', { invalidate: [['reviewer']], success: (r) => (r.passed ? 'Chúc mừng! Bạn đã trở thành Reviewer.' : `Đúng ${r.correct}/5 câu. Hãy đọc lại và thử lần nữa.`) });
  if (q.isLoading) return <Loading />;
  const { reviewer: r, rank, events, reviews, recommendations, quiz: questions } = q.data;
  const next = REVIEWER_RANKS.find((x) => x.min > (r?.eval_points ?? 0));

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Cộng đồng" title="Reviewer" subtitle="Vai trò đánh giá chuyên môn, chỉ nhận qua thư mời của Ban Quản Trị. Uy tín và điểm đánh giá là hai chỉ số riêng biệt." />
      {!r || r.status === 'declined' ? (
        <Panel>
          <Empty title="Bạn chưa có thư mời Reviewer" text="Ban Quản Trị chủ động mời những người chơi có đánh giá công tâm, chi tiết. Không thể tự đăng ký." />
        </Panel>
      ) : r.status === 'invited' ? (
        <Panel title="Thư mời trở thành Reviewer">
          <div className="flex items-start gap-3">
            <MailOpen className="mt-1 shrink-0 text-sky-300" />
            <div className="space-y-3 text-sm text-ink-200">
              <p>{r.invite_note}</p>
              <p className="text-ink-400">Sau khi chấp nhận, bạn làm bài kiểm tra 5 câu về tính công bằng và trách nhiệm. Vượt qua sẽ nhận vai trò Reviewer với 15 điểm uy tín.</p>
              <div className="flex gap-2">
                <Button shimmer loading={respond.isPending} onClick={() => respond.mutate({ accept: true })}>
                  Chấp nhận thư mời
                </Button>
                <Button variant="ghost" onClick={() => respond.mutate({ accept: false })}>
                  Từ chối
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      ) : r.status === 'accepted' ? (
        <Panel title="Bài kiểm tra Reviewer" eyebrow="Cần trả lời đúng cả 5 câu">
          <ol className="space-y-5">
            {questions.map((x: any, i: number) => (
              <li key={i}>
                <div className="mb-2 text-sm font-medium text-white">
                  {i + 1}. {x.q}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {x.options.map((o: string, j: number) => (
                    <button
                      key={j}
                      onClick={() => setAnswers(answers.map((a, k) => (k === i ? j : a)))}
                      className={clsx('min-h-[44px] rounded-xl border px-3 py-2 text-left text-sm transition', answers[i] === j ? 'border-sky-400/70 bg-sky-400/10 text-white' : 'text-ink-300 hover:border-sky-400/30')}
                      style={answers[i] === j ? undefined : { borderColor: 'var(--line)' }}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
          <Button className="mt-6" shimmer disabled={answers.includes(-1)} loading={quiz.isPending} onClick={() => quiz.mutate({ answers })}>
            Nộp bài
          </Button>
        </Panel>
      ) : (
        <>
          {r.status === 'revoked' && (
            <div className="panel flex items-start gap-3 border-red-400/40 p-4 text-sm text-red-100">
              <ShieldAlert className="shrink-0 text-loss" size={18} />
              Vai trò Reviewer đã bị thu hồi ({r.revoke_reason}). Muốn quay lại, bạn cần được Ban Quản Trị mời lại và làm bài kiểm tra từ đầu.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Cấp bậc" value={rank?.name ?? '—'} icon={<BadgeCheck size={16} />} />
            <Stat label="Điểm uy tín" value={`${r.reputation}`} hint="Trừ 1 điểm mỗi 7 ngày thực không có đánh giá hợp lệ" tone={r.reputation <= 5 ? 'loss' : r.reputation <= 10 ? 'warn' : undefined} />
            <Stat label="Điểm đánh giá" value={r.eval_points} hint={next ? `Còn ${next.min - r.eval_points} điểm lên ${next.name}` : 'Cấp cao nhất'} />
            <Stat label="Đánh giá hợp lệ gần nhất" value={r.last_valid_review_at ? ago(r.last_valid_review_at) : '—'} />
          </div>
          <Panel title="Tiến độ thăng cấp">
            <div className="mb-2 flex flex-wrap gap-2">
              {REVIEWER_RANKS.map((x) => (
                <Badge key={x.rank} tone={r.eval_points >= x.min ? 'sky' : 'muted'}>
                  {x.name} · {x.min}
                </Badge>
              ))}
            </div>
            <Progress value={r.eval_points} max={next?.min ?? r.eval_points} />
          </Panel>
          <div className="grid gap-5 lg:grid-cols-3">
            <Panel title="Đánh giá chuyên môn">
              {reviews.length === 0 ? (
                <Empty title="Chưa có đánh giá" text="Vào Thư viện doanh nghiệp để viết đánh giá." />
              ) : (
                <ul className="space-y-2 text-sm">
                  {reviews.map((x: any, i: number) => (
                    <li key={i} className="flex justify-between gap-2">
                      <Link to={`/library/${x.slug}`} className="truncate text-sky-200">
                        {x.name}
                      </Link>
                      <span className="shrink-0 text-ink-400">
                        {x.rating}★ · {ago(x.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Lịch sử đề cử">
              {recommendations.length === 0 ? (
                <Empty title="Chưa đề cử doanh nghiệp nào" />
              ) : (
                <ul className="space-y-2 text-sm">
                  {recommendations.map((x: any, i: number) => (
                    <li key={i} className="flex justify-between gap-2">
                      <Link to={`/library/${x.slug}`} className="truncate text-sky-200">
                        {x.name}
                      </Link>
                      {x.revoked_at ? <Badge>Đã thu hồi</Badge> : <Badge tone="gain">Hiệu lực</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Lịch sử điểm">
              <ul className="space-y-2 text-sm">
                {events.map((e: any, i: number) => (
                  <li key={i}>
                    <span className={e.delta > 0 ? 'text-gain' : e.delta < 0 ? 'text-loss' : 'text-ink-300'}>
                      {e.delta > 0 ? '+' : ''}
                      {e.delta} {e.kind === 'reputation' ? 'uy tín' : e.kind === 'points' ? 'điểm' : ''}
                    </span>{' '}
                    <span className="text-ink-300">{e.reason}</span>
                    <div className="text-[11px] text-ink-500">{ago(e.created_at)}</div>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
