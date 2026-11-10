import type { Tx, Queryable } from './db';
import { maybe, one, many } from './db';
import { fail } from './errors';
import { audit } from './audit';
import { notify } from './notify';
import { reviewerRank } from '@startup/shared';

const DAY_MS = 86_400_000;
const QUIZ_KEY = [1, 2, 1, 2, 1]; // server-only answer key for REVIEWER_QUIZ

/** Rules for a review to count (anti-spam, anti-self-review). */
export async function submitReview(tx: Tx, userId: string, companyId: string, rating: number, body: string) {
  const c = await maybe<{ id: string; owner_user_id: string | null; name: string; is_npc: boolean }>(tx, 'SELECT id, owner_user_id, name, is_npc FROM companies WHERE id=$1', [companyId]);
  if (!c) return fail('not_found', 'Không tìm thấy doanh nghiệp.', 404);
  if (c.owner_user_id === userId) fail('self_review', 'Không thể tự đánh giá doanh nghiệp của mình.');
  const holds = await maybe<{ qty: number; total: number }>(
    tx,
    `SELECT h.qty, c.shares_total AS total FROM holdings h JOIN instruments i ON i.symbol=h.symbol JOIN companies c ON c.id=i.company_id WHERE i.company_id=$1 AND h.holder_type='user' AND h.holder_id=$2`,
    [companyId, userId],
  );
  if (holds && holds.total > 0 && holds.qty / holds.total >= 0.05) fail('conflict', 'Cổ đông lớn (từ 5%) không được đánh giá doanh nghiệp để tránh xung đột lợi ích.');
  const u = await one<{ too_new: boolean }>(tx, `SELECT created_at > now() - interval '2 hours' AS too_new FROM users WHERE id=$1`, [userId]);
  if (u.too_new) fail('too_new', 'Tài khoản cần hoạt động ít nhất 2 giờ trước khi viết đánh giá.');
  const recent = await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM reviews WHERE author_id=$1 AND created_at > now() - interval '1 hour'`, [userId]);
  if (recent.n >= 5) fail('rate_limited', 'Bạn đã viết quá nhiều đánh giá trong 1 giờ. Vui lòng thử lại sau.');
  if (/(.)\1{9,}/.test(body) || new Set(body.toLowerCase().split(/\s+/)).size < 5) fail('low_quality', 'Nhận xét cần cụ thể, có nội dung thực tế.');
  const reviewer = await maybe<{ status: string }>(tx, 'SELECT status FROM reviewers WHERE user_id=$1', [userId]);
  const byReviewer = reviewer?.status === 'active';
  const existing = await maybe<{ id: string }>(tx, 'SELECT id FROM reviews WHERE company_id=$1 AND author_id=$2', [companyId, userId]);
  if (existing) fail('already_reviewed', 'Bạn đã đánh giá doanh nghiệp này. Mỗi người chỉ được đánh giá một lần.');
  const r = await one<{ id: string }>(tx, 'INSERT INTO reviews (company_id, author_id, rating, body, by_reviewer) VALUES ($1,$2,$3,$4,$5) RETURNING id', [companyId, userId, rating, body, byReviewer]);
  // Reviews move company reputation slowly.
  await tx.query('UPDATE companies SET reputation = LEAST(100, GREATEST(0, reputation + $2)) WHERE id=$1', [companyId, (rating - 3) * (byReviewer ? 0.8 : 0.4)]);
  if (byReviewer) {
    const points = Math.min(20, 8 + Math.floor(body.length / 100));
    await tx.query('UPDATE reviewers SET last_valid_review_at = now(), eval_points = eval_points + $2 WHERE user_id=$1', [userId, points]);
    await tx.query(`INSERT INTO reviewer_events (user_id, kind, delta, reason) VALUES ($1,'points',$2,$3)`, [userId, points, `Đánh giá chuyên môn ${c.name}`]);
    await checkRankUp(tx, userId);
  }
  if (c.owner_user_id) await notify(tx, c.owner_user_id, 'community', `Đánh giá mới ${rating}★`, `${c.name} nhận một đánh giá mới.`, { companyId });
  await recheckFavorite(tx, companyId);
  return r.id;
}

async function checkRankUp(tx: Tx, userId: string) {
  const r = await one<{ eval_points: number }>(tx, 'SELECT eval_points FROM reviewers WHERE user_id=$1', [userId]);
  const rank = reviewerRank(r.eval_points);
  if (rank.rank > 0) await notify(tx, userId, 'reviewer', `Thăng cấp ${rank.name}`, `Bạn đạt ${r.eval_points} điểm đánh giá.`, {}, `rank:${userId}:${rank.rank}`);
}

export async function replyReview(tx: Tx, userId: string, reviewId: string, body: string) {
  const r = await maybe<{ company_id: string; owner_user_id: string }>(tx, 'SELECT r.company_id, c.owner_user_id FROM reviews r JOIN companies c ON c.id = r.company_id WHERE r.id=$1', [reviewId]);
  if (!r || r.owner_user_id !== userId) return fail('not_owner', 'Chỉ chủ doanh nghiệp được phản hồi.', 403);
  await tx.query('UPDATE reviews SET owner_reply=$2, replied_at=now() WHERE id=$1', [reviewId, body]);
}

/** Owners cannot delete reviews; they can only report them for moderation. */
export async function reportReview(tx: Tx, userId: string, reviewId: string, reason: string) {
  const r = await maybe(tx, 'SELECT 1 FROM reviews WHERE id=$1', [reviewId]);
  if (!r) fail('not_found', 'Không tìm thấy đánh giá.', 404);
  await tx.query('INSERT INTO review_reports (review_id, reporter_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [reviewId, userId, reason]);
}

export async function moderateReview(tx: Tx, adminId: string, reviewId: string, hide: boolean, reason: string) {
  await tx.query(`UPDATE reviews SET status=$2, hidden_reason=$3 WHERE id=$1`, [reviewId, hide ? 'hidden' : 'visible', hide ? reason : null]);
  await tx.query(`UPDATE review_reports SET status=$2 WHERE review_id=$1 AND status='open'`, [reviewId, hide ? 'upheld' : 'dismissed']);
  await audit(tx, adminId, hide ? 'review.hide' : 'review.restore', 'review', reviewId, { reason });
  const rv = await one<{ company_id: string }>(tx, 'SELECT company_id FROM reviews WHERE id=$1', [reviewId]);
  await recheckFavorite(tx, rv.company_id);
}

// ---------------- Reviewer programme ----------------

export async function inviteReviewer(tx: Tx, adminId: string, userId: string, note: string) {
  const r = await maybe<{ status: string }>(tx, 'SELECT status FROM reviewers WHERE user_id=$1 FOR UPDATE', [userId]);
  if (r && ['invited', 'accepted', 'active'].includes(r.status)) fail('already', 'Người chơi đã có thư mời hoặc đang là Reviewer.');
  await tx.query(
    `INSERT INTO reviewers (user_id, status, reputation, eval_points, invited_by, invite_note, invited_at) VALUES ($1,'invited',0,0,$2,$3,now())
     ON CONFLICT (user_id) DO UPDATE SET status='invited', reputation=0, eval_points=0, invited_by=$2, invite_note=$3, invited_at=now(), activated_at=NULL, revoked_at=NULL, revoke_reason=NULL, last_valid_review_at=NULL`,
    [userId, adminId, note],
  );
  await notify(tx, userId, 'reviewer', 'Thư mời trở thành Reviewer', `Ban Quản Trị mời bạn tham gia đội Reviewer. ${note}`, { action: 'reviewer_invite' });
  await audit(tx, adminId, 'reviewer.invite', 'user', userId, { note });
}

export async function respondInvite(tx: Tx, userId: string, accept: boolean) {
  const r = await maybe<{ status: string }>(tx, 'SELECT status FROM reviewers WHERE user_id=$1 FOR UPDATE', [userId]);
  if (!r || r.status !== 'invited') return fail('no_invite', 'Bạn không có thư mời Reviewer đang chờ.');
  await tx.query('UPDATE reviewers SET status=$2 WHERE user_id=$1', [userId, accept ? 'accepted' : 'declined']);
}

/** Pass = all 5 answers correct. On pass: active Reviewer with exactly 15 reputation. */
export async function submitQuiz(tx: Tx, userId: string, answers: number[]) {
  const r = await maybe<{ status: string }>(tx, 'SELECT status FROM reviewers WHERE user_id=$1 FOR UPDATE', [userId]);
  if (!r || r.status !== 'accepted') return fail('not_accepted', 'Bạn cần chấp nhận thư mời trước khi làm bài kiểm tra.');
  const correct = answers.filter((a, i) => a === QUIZ_KEY[i]).length;
  if (correct < QUIZ_KEY.length) return { passed: false, correct };
  await tx.query(`UPDATE reviewers SET status='active', reputation=15, eval_points=0, activated_at=now(), last_valid_review_at=now() WHERE user_id=$1`, [userId]);
  await tx.query(`INSERT INTO reviewer_events (user_id, kind, delta, reason) VALUES ($1,'reputation',15,'Vượt qua bài kiểm tra Reviewer')`, [userId]);
  await notify(tx, userId, 'reviewer', 'Chúc mừng Reviewer mới', 'Bạn bắt đầu với 15 điểm uy tín. Mỗi 7 ngày thực không có đánh giá hợp lệ sẽ bị trừ 1 điểm.');
  return { passed: true, correct };
}

/**
 * Real-time inactivity rule (not game time): for every full 7-day period since the last
 * valid review, deduct 1 reputation. The period key makes each deduction happen once.
 * Reaching 0 revokes the role; returning requires a new invitation and quiz.
 */
export async function applyReviewerInactivity(tx: Tx, nowMs?: number) {
  nowMs ??= (await one<{ t: Date }>(tx, 'SELECT now() AS t')).t.getTime();
  const list = await many<{ user_id: string; reputation: number; last_valid_review_at: Date; activated_at: Date }>(tx, `SELECT * FROM reviewers WHERE status='active' FOR UPDATE`);
  let penalties = 0;
  for (const r of list) {
    const anchor = (r.last_valid_review_at ?? r.activated_at).getTime();
    const periods = Math.floor((nowMs - anchor) / (7 * DAY_MS));
    let rep = r.reputation;
    for (let p = 1; p <= periods && rep > 0; p++) {
      const key = `inactive:${anchor}:${p}`;
      const ins = await tx.query(`INSERT INTO reviewer_events (user_id, kind, delta, reason, period_key) VALUES ($1,'reputation',-1,$2,$3) ON CONFLICT (user_id, period_key) DO NOTHING`, [
        r.user_id,
        `Không có đánh giá hợp lệ trong 7 ngày (kỳ ${p})`,
        key,
      ]);
      if (ins.rowCount) {
        rep -= 1;
        penalties++;
      }
    }
    if (rep !== r.reputation) {
      await tx.query('UPDATE reviewers SET reputation=$2 WHERE user_id=$1', [r.user_id, rep]);
      if (rep <= 0) {
        await tx.query(`UPDATE reviewers SET status='revoked', revoked_at=now(), revoke_reason='Uy tín về 0' WHERE user_id=$1`, [r.user_id]);
        await tx.query(`UPDATE recommendations SET revoked_at=now() WHERE reviewer_id=$1 AND revoked_at IS NULL`, [r.user_id]);
        await tx.query(`INSERT INTO reviewer_events (user_id, kind, delta, reason) VALUES ($1,'status',0,'Tự động thu hồi vai trò Reviewer do uy tín về 0')`, [r.user_id]);
        await notify(tx, r.user_id, 'reviewer', 'Vai trò Reviewer đã bị thu hồi', 'Điểm uy tín về 0. Muốn quay lại, bạn cần được Admin mời và làm lại bài kiểm tra.');
      } else {
        await notify(tx, r.user_id, 'reviewer', 'Bị trừ điểm uy tín', `Uy tín còn ${rep}/15. Hãy viết đánh giá hợp lệ để đặt lại mốc thời gian.`);
      }
    }
  }
  return penalties;
}

export async function revokeReviewer(tx: Tx, adminId: string, userId: string, reason: string) {
  await tx.query(`UPDATE reviewers SET status='revoked', revoked_at=now(), revoke_reason=$2 WHERE user_id=$1 AND status IN ('invited','accepted','active')`, [userId, reason]);
  await tx.query(`UPDATE recommendations SET revoked_at=now() WHERE reviewer_id=$1 AND revoked_at IS NULL`, [userId]);
  await audit(tx, adminId, 'reviewer.revoke', 'user', userId, { reason });
  await notify(tx, userId, 'reviewer', 'Vai trò Reviewer đã bị thu hồi', reason);
}

/** One recommendation per (reviewer, company); conflicts of interest are rejected. */
export async function recommend(tx: Tx, userId: string, companyId: string, note: string) {
  const r = await maybe<{ status: string }>(tx, 'SELECT status FROM reviewers WHERE user_id=$1', [userId]);
  if (r?.status !== 'active') return fail('not_reviewer', 'Chỉ Reviewer đang hoạt động được đề cử.', 403);
  const c = await maybe<{ owner_user_id: string | null }>(tx, 'SELECT owner_user_id FROM companies WHERE id=$1', [companyId]);
  if (!c) return fail('not_found', 'Không tìm thấy doanh nghiệp.', 404);
  if (c.owner_user_id === userId) fail('conflict', 'Không thể đề cử doanh nghiệp của chính mình.');
  const stake = await maybe(tx, `SELECT 1 FROM holdings h JOIN instruments i ON i.symbol=h.symbol WHERE i.company_id=$1 AND h.holder_type='user' AND h.holder_id=$2 AND h.qty > 0`, [companyId, userId]);
  if (stake) fail('conflict', 'Bạn đang nắm giữ cổ phiếu của doanh nghiệp này (xung đột lợi ích).');
  const reviewed = await maybe(tx, `SELECT 1 FROM reviews WHERE company_id=$1 AND author_id=$2 AND status='visible'`, [companyId, userId]);
  if (!reviewed) fail('review_first', 'Hãy viết đánh giá chuyên môn cho doanh nghiệp trước khi đề cử.');
  await tx.query(
    `INSERT INTO recommendations (company_id, reviewer_id, note) VALUES ($1,$2,$3)
     ON CONFLICT (company_id, reviewer_id) DO UPDATE SET revoked_at=NULL, note=EXCLUDED.note, created_at=now() WHERE recommendations.revoked_at IS NOT NULL`,
    [companyId, userId, note],
  );
}
export async function unrecommend(tx: Tx, userId: string, companyId: string) {
  await tx.query('UPDATE recommendations SET revoked_at=now() WHERE company_id=$1 AND reviewer_id=$2 AND revoked_at IS NULL', [companyId, userId]);
}

export async function recommendationCount(q: Queryable, companyId: string) {
  const r = await one<{ n: number }>(
    q,
    `SELECT count(DISTINCT rc.reviewer_id)::int AS n FROM recommendations rc JOIN reviewers rv ON rv.user_id = rc.reviewer_id AND rv.status='active' WHERE rc.company_id=$1 AND rc.revoked_at IS NULL`,
    [companyId],
  );
  return r.n;
}

// ---------------- Titles ----------------

export async function grantTitle(tx: Tx, adminId: string, companyId: string, reason: string) {
  const ins = await tx.query(`INSERT INTO company_titles (company_id, title, granted_by, reason) VALUES ($1,'tuyen_chon',$2,$3) ON CONFLICT DO NOTHING`, [companyId, adminId, reason]);
  if (!ins.rowCount) fail('already', 'Doanh nghiệp đang có danh hiệu Tuyển Chọn.');
  await audit(tx, adminId, 'title.grant', 'company', companyId, { title: 'tuyen_chon', reason });
  const c = await one<{ owner_user_id: string | null; name: string }>(tx, 'SELECT owner_user_id, name FROM companies WHERE id=$1', [companyId]);
  if (c.owner_user_id) await notify(tx, c.owner_user_id, 'community', 'Doanh nghiệp được Tuyển Chọn', `${c.name}: ${reason}`, { companyId });
}

export async function revokeTitle(tx: Tx, adminId: string, companyId: string, title: 'tuyen_chon' | 'yeu_thich', reason: string) {
  const r = await tx.query(`UPDATE company_titles SET revoked_at=now(), revoke_reason=$3 WHERE company_id=$1 AND title=$2 AND revoked_at IS NULL`, [companyId, title, reason]);
  if (!r.rowCount) fail('none', 'Doanh nghiệp không có danh hiệu này.');
  await audit(tx, adminId, 'title.revoke', 'company', companyId, { title, reason });
}

/**
 * "Yêu Thích" rules (thresholds approved by the project owner 10/11/2026):
 *  - at least 10 visible reviews from distinct accounts,
 *  - average rating >= 4.5,
 *  - >= 85% positive reviews (4-5★),
 *  - no upheld manipulation report.
 * Selection: up to `winners` random companies per game month among those eligible.
 * The title is lost automatically as soon as any threshold is no longer met
 * (checked after every review, moderation decision and at each monthly cycle).
 * `months` (title term) and `winners` are still the original proposal, pending approval.
 */
export const FAVORITE_PARAMS = { minReviews: 10, minAvg: 4.5, minPositive: 0.85, winners: 3, months: 4 };

export type FavoriteStats = { reviews: number; avg: number; positive: number; manipulated: boolean };

export async function favoriteStats(q: Queryable, companyId: string): Promise<FavoriteStats> {
  const r = await one<{ n: number; avg: number | null; positive: number | null; manipulated: boolean }>(
    q,
    `SELECT count(DISTINCT r.author_id)::int AS n, AVG(r.rating)::float AS avg, AVG(CASE WHEN r.rating >= 4 THEN 1 ELSE 0 END)::float AS positive,
            EXISTS (SELECT 1 FROM review_reports rr JOIN reviews r2 ON r2.id = rr.review_id WHERE r2.company_id = $1 AND rr.status='upheld') AS manipulated
       FROM reviews r WHERE r.company_id = $1 AND r.status = 'visible'`,
    [companyId],
  );
  return { reviews: r.n, avg: r.avg ?? 0, positive: r.positive ?? 0, manipulated: r.manipulated };
}

/** Which thresholds a company currently fails (empty = eligible). */
export function favoriteFailures(s: FavoriteStats): string[] {
  const P = FAVORITE_PARAMS;
  const out: string[] = [];
  if (s.reviews < P.minReviews) out.push(`số đánh giá hợp lệ còn ${s.reviews}/${P.minReviews}`);
  if (s.avg < P.minAvg) out.push(`điểm trung bình còn ${s.avg.toFixed(2)}/${P.minAvg}`);
  if (s.positive < P.minPositive) out.push(`tỷ lệ đánh giá tích cực còn ${Math.round(s.positive * 100)}%/${Math.round(P.minPositive * 100)}%`);
  if (s.manipulated) out.push('có báo cáo thao túng đánh giá được xác nhận');
  return out;
}

/** Revoke "Yêu Thích" immediately if the company no longer meets every threshold. */
export async function recheckFavorite(tx: Tx, companyId: string): Promise<boolean> {
  const held = await maybe<{ id: string }>(tx, `SELECT id FROM company_titles WHERE company_id=$1 AND title='yeu_thich' AND revoked_at IS NULL FOR UPDATE`, [companyId]);
  if (!held) return false;
  const failures = favoriteFailures(await favoriteStats(tx, companyId));
  if (!failures.length) return false;
  const reason = `Tự động thu hồi: ${failures.join('; ')}`;
  await tx.query(`UPDATE company_titles SET revoked_at=now(), revoke_reason=$2 WHERE id=$1`, [held.id, reason]);
  await audit(tx, null, 'title.auto_revoke', 'company', companyId, { title: 'yeu_thich', failures });
  const c = await one<{ owner_user_id: string | null; name: string }>(tx, 'SELECT owner_user_id, name FROM companies WHERE id=$1', [companyId]);
  if (c.owner_user_id) await notify(tx, c.owner_user_id, 'community', 'Mất danh hiệu Yêu Thích', `${c.name}: ${failures.join('; ')}.`, { companyId });
  return true;
}

export async function selectFavorites(tx: Tx, month: number, seedFn: () => number) {
  const cycle = `month:${month}`;
  if (await maybe(tx, 'SELECT 1 FROM favorite_cycles WHERE cycle_key=$1', [cycle])) return null;
  await tx.query(`UPDATE company_titles SET revoked_at=now(), revoke_reason='Hết thời hạn' WHERE title='yeu_thich' AND revoked_at IS NULL AND expires_at < now()`);
  // Safety net: re-check current holders (covers anything that changed outside review flows).
  const holders = await many<{ company_id: string }>(tx, `SELECT company_id FROM company_titles WHERE title='yeu_thich' AND revoked_at IS NULL`);
  for (const h of holders) await recheckFavorite(tx, h.company_id);
  const P = FAVORITE_PARAMS;
  const candidates = await many<{ company_id: string }>(
    tx,
    `SELECT r.company_id FROM reviews r JOIN companies c ON c.id = r.company_id AND c.status IN ('active','insolvent')
      WHERE r.status='visible'
        AND NOT EXISTS (SELECT 1 FROM company_titles t WHERE t.company_id = r.company_id AND t.title='yeu_thich' AND t.revoked_at IS NULL)
      GROUP BY r.company_id HAVING count(DISTINCT r.author_id) >= $1`,
    [P.minReviews],
  );
  const pool: string[] = [];
  for (const c of candidates) if (!favoriteFailures(await favoriteStats(tx, c.company_id)).length) pool.push(c.company_id);
  const chosen: string[] = [];
  const bag = [...pool];
  while (bag.length && chosen.length < P.winners) chosen.push(bag.splice(Math.floor(seedFn() * bag.length), 1)[0]!);
  for (const id of chosen) {
    await tx.query(
      `INSERT INTO company_titles (company_id, title, reason, expires_at, cycle_key) VALUES ($1,'yeu_thich',$2, now() + make_interval(mins => $3), $4)`,
      [id, 'Được cộng đồng đánh giá tích cực, chọn ngẫu nhiên trong nhóm đủ điều kiện', Math.round((P.months * 7 * 1440) / 30), cycle],
    );
    const c = await one<{ owner_user_id: string | null; name: string }>(tx, 'SELECT owner_user_id, name FROM companies WHERE id=$1', [id]);
    if (c.owner_user_id) await notify(tx, c.owner_user_id, 'community', 'Danh hiệu Yêu Thích', `${c.name} được cộng đồng yêu thích!`, { companyId: id });
  }
  await tx.query('INSERT INTO favorite_cycles (cycle_key, eligible, selected, params) VALUES ($1,$2,$3,$4)', [cycle, pool.length, JSON.stringify(chosen), P]);
  return { eligible: pool.length, chosen };
}
