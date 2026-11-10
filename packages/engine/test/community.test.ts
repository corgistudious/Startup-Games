import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Db } from '../src/db';
import { withTx, one, many } from '../src/db';
import { createCompany } from '../src/companies';
import {
  submitReview,
  inviteReviewer,
  respondInvite,
  submitQuiz,
  applyReviewerInactivity,
  recommend,
  unrecommend,
  recommendationCount,
  grantTitle,
  revokeTitle,
  selectFavorites,
  FAVORITE_PARAMS,
  reportReview,
  moderateReview,
} from '../src/community';
import { freshWorld, newPlayer, minute } from './helpers';
import { seeded } from '../src/rng';

let db: Db;
let admin: string;
let owner: string;
let critic: string;
let company: string;
const BODY = 'Bánh mì giòn, nhân đầy đặn, phục vụ nhanh và giá hợp lý so với khu vực xung quanh.';

beforeAll(async () => {
  db = await freshWorld({ npcs: false });
  admin = await newPlayer(db, 'boss');
  await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [admin]);
  owner = await newPlayer(db, 'shopowner');
  critic = await newPlayer(db, 'critic');
  const m = await minute(db);
  company = await withTx(db, (tx) => createCompany(tx, owner, { name: 'Tiệm Bánh Hoa Sữa', industry: 'tiem_banh', location: 'hai_chau', capital: 200_000_000 }, m));
});
afterAll(async () => db.end());

describe('reviews', () => {
  it('blocks self-review, duplicates, spam and low-effort text', async () => {
    await expect(withTx(db, (tx) => submitReview(tx, owner, company, 5, BODY))).rejects.toThrow(/tự đánh giá/);
    await expect(withTx(db, (tx) => submitReview(tx, critic, company, 5, 'aaaaaaaaaaaaaaaaaaaaaaaa'))).rejects.toThrow(/cụ thể/);
    await withTx(db, (tx) => submitReview(tx, critic, company, 4, BODY));
    await expect(withTx(db, (tx) => submitReview(tx, critic, company, 1, BODY))).rejects.toThrow(/một lần/);
    const fresh = await newPlayer(db, 'brandnew');
    await db.query(`UPDATE users SET created_at = now() WHERE id=$1`, [fresh]);
    await expect(withTx(db, (tx) => submitReview(tx, fresh, company, 1, BODY))).rejects.toThrow(/2 giờ/);
  });

  it('owners cannot delete reviews; reports go to moderation', async () => {
    const r = await one<{ id: string }>(db, 'SELECT id FROM reviews WHERE company_id=$1', [company]);
    await withTx(db, (tx) => reportReview(tx, owner, r.id, 'Nghi ngờ đánh giá không đúng sự thật'));
    await withTx(db, (tx) => moderateReview(tx, admin, r.id, false, 'Đánh giá hợp lệ'));
    expect((await one<{ status: string }>(db, 'SELECT status FROM reviews WHERE id=$1', [r.id])).status).toBe('visible');
    expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM audit_log WHERE action='review.restore'`)).n).toBe(1);
  });
});

describe('reviewer programme', () => {
  let rv: string;
  it('requires an admin invitation, acceptance and a passed 5-question quiz; starts at 15 reputation', async () => {
    rv = await newPlayer(db, 'reviewer1');
    await expect(withTx(db, (tx) => respondInvite(tx, rv, true))).rejects.toThrow(/thư mời/);
    await expect(withTx(db, (tx) => submitQuiz(tx, rv, [1, 2, 1, 2, 1]))).rejects.toThrow(/chấp nhận/);
    await withTx(db, (tx) => inviteReviewer(tx, admin, rv, 'Bạn có nhiều đánh giá chất lượng.'));
    await withTx(db, (tx) => respondInvite(tx, rv, true));
    expect((await withTx(db, (tx) => submitQuiz(tx, rv, [0, 2, 1, 2, 1]))).passed).toBe(false);
    expect((await withTx(db, (tx) => submitQuiz(tx, rv, [1, 2, 1, 2, 1]))).passed).toBe(true);
    const r = await one<{ status: string; reputation: number; eval_points: number }>(db, 'SELECT * FROM reviewers WHERE user_id=$1', [rv]);
    expect(r).toMatchObject({ status: 'active', reputation: 15, eval_points: 0 });
  });

  it('a valid review earns evaluation points (separate from reputation)', async () => {
    await withTx(db, (tx) => submitReview(tx, rv, company, 5, BODY + ' Không gian sạch sẽ, nhân viên thân thiện.'));
    const r = await one<{ reputation: number; eval_points: number }>(db, 'SELECT * FROM reviewers WHERE user_id=$1', [rv]);
    expect(r.reputation).toBe(15);
    expect(r.eval_points).toBeGreaterThan(0);
  });

  it('recommendations: one per reviewer, revocable, no conflicts of interest, counted by distinct reviewers', async () => {
    await withTx(db, (tx) => recommend(tx, rv, company, 'Đáng thử'));
    await withTx(db, (tx) => recommend(tx, rv, company, 'Đáng thử lần 2'));
    expect(await recommendationCount(db, company)).toBe(1);
    await expect(withTx(db, (tx) => recommend(tx, critic, company, 'x'))).rejects.toThrow(/Reviewer/);
    await withTx(db, (tx) => unrecommend(tx, rv, company));
    expect(await recommendationCount(db, company)).toBe(0);
    await withTx(db, (tx) => recommend(tx, rv, company, 'Quay lại đề cử'));
    expect(await recommendationCount(db, company)).toBe(1);
  });

  it('loses 1 reputation per full 7 REAL days without a valid review, never twice for the same period', async () => {
    await db.query(`UPDATE reviewers SET last_valid_review_at = now() - interval '15 days' WHERE user_id=$1`, [rv]);
    await withTx(db, (tx) => applyReviewerInactivity(tx));
    await withTx(db, (tx) => applyReviewerInactivity(tx));
    const r = await one<{ reputation: number }>(db, 'SELECT reputation FROM reviewers WHERE user_id=$1', [rv]);
    expect(r.reputation).toBe(13);
    const events = await many(db, `SELECT * FROM reviewer_events WHERE user_id=$1 AND period_key IS NOT NULL`, [rv]);
    expect(events).toHaveLength(2);
  });

  it('is revoked automatically at 0 reputation and must be re-invited and retake the quiz', async () => {
    await db.query(`UPDATE reviewers SET last_valid_review_at = now() - interval '200 days' WHERE user_id=$1`, [rv]);
    await withTx(db, (tx) => applyReviewerInactivity(tx));
    const r = await one<{ status: string; reputation: number }>(db, 'SELECT status, reputation FROM reviewers WHERE user_id=$1', [rv]);
    expect(r).toEqual({ status: 'revoked', reputation: 0 });
    expect(await recommendationCount(db, company)).toBe(0);
    await expect(withTx(db, (tx) => submitQuiz(tx, rv, [1, 2, 1, 2, 1]))).rejects.toThrow();
    await withTx(db, (tx) => inviteReviewer(tx, admin, rv, 'Mời lại'));
    await withTx(db, (tx) => respondInvite(tx, rv, true));
    await withTx(db, (tx) => submitQuiz(tx, rv, [1, 2, 1, 2, 1]));
    expect((await one<{ reputation: number }>(db, 'SELECT reputation FROM reviewers WHERE user_id=$1', [rv])).reputation).toBe(15);
  });
});

describe('titles', () => {
  it('Tuyển Chọn is granted and revoked by admins with a reason and audit trail', async () => {
    await withTx(db, (tx) => grantTitle(tx, admin, company, 'Mô hình vận hành hiệu quả'));
    await expect(withTx(db, (tx) => grantTitle(tx, admin, company, 'Lần nữa'))).rejects.toThrow(/đang có/);
    await withTx(db, (tx) => revokeTitle(tx, admin, company, 'tuyen_chon', 'Kiểm tra lại'));
    const log = await many(db, `SELECT action FROM audit_log WHERE target_id=$1 AND action LIKE 'title.%'`, [company]);
    expect(log).toHaveLength(2);
  });

  it('Yêu Thích picks randomly among eligible companies only, once per cycle', async () => {
    // Make the company eligible: enough distinct positive reviews.
    for (let i = 0; i < FAVORITE_PARAMS.minReviews; i++) {
      const u = await newPlayer(db, `fan${i}`);
      await withTx(db, (tx) => submitReview(tx, u, company, 5, `${BODY} Lần ghé thứ ${i + 1} vẫn rất hài lòng với chất lượng.`));
    }
    const m = await minute(db);
    const other = await withTx(db, (tx) => createCompany(tx, critic, { name: 'Quán Vắng Khách', industry: 'quan_ca_phe', location: 'ninh_kieu', capital: 150_000_000 }, m));
    await db.query(`UPDATE companies SET status='active' WHERE id = ANY($1)`, [[company, other]]);
    const res = await withTx(db, (tx) => selectFavorites(tx, 1, seeded('t')));
    expect(res!.chosen).toEqual([company]);
    expect(await withTx(db, (tx) => selectFavorites(tx, 1, seeded('t')))).toBeNull();
  });
});
