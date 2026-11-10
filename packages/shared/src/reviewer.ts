/** Questions are public; the answer key only lives on the server (engine/community.ts). */
export const REVIEWER_QUIZ = [
  { q: 'Bạn được chủ doanh nghiệp tặng quà để viết đánh giá 5 sao. Bạn làm gì?', options: ['Nhận quà và viết 5 sao', 'Từ chối và đánh giá theo trải nghiệm thật', 'Nhận quà nhưng không viết gì', 'Viết 4 sao cho công bằng'] },
  { q: 'Doanh nghiệp do bạn sở hữu cổ phần lớn có được bạn đề cử không?', options: ['Có, vì tôi hiểu rõ nó', 'Có nếu nó thật sự tốt', 'Không, vì xung đột lợi ích', 'Chỉ khi Admin đồng ý'] },
  { q: 'Một đánh giá hợp lệ cần có điều gì?', options: ['Ít nhất 5 sao', 'Nhận xét cụ thể dựa trên hoạt động thật của doanh nghiệp', 'Nhiều biểu tượng cảm xúc', 'Được viết trong 1 phút'] },
  { q: 'Bạn phát hiện nhóm tài khoản cùng đánh giá 1 sao một doanh nghiệp trong vài phút. Bạn nên?', options: ['Tham gia cho vui', 'Bỏ qua', 'Báo cáo cho Ban Quản Trị', 'Đánh giá 5 sao để cân bằng'] },
  { q: 'Nếu 7 ngày thực liên tiếp bạn không có đánh giá hợp lệ nào thì điều gì xảy ra?', options: ['Không có gì', 'Bị trừ 1 điểm uy tín', 'Bị khóa tài khoản', 'Mất toàn bộ điểm đánh giá'] },
] as const;

export const REVIEWER_RANKS = [
  { rank: 0, name: 'Reviewer Tập Sự', min: 0 },
  { rank: 1, name: 'Reviewer I', min: 100 },
  { rank: 2, name: 'Reviewer II', min: 200 },
  { rank: 3, name: 'Reviewer III', min: 450 },
  { rank: 4, name: 'Reviewer IV', min: 900 },
  { rank: 5, name: 'Reviewer V', min: 1900 },
] as const;

export function reviewerRank(points: number) {
  let r: (typeof REVIEWER_RANKS)[number] = REVIEWER_RANKS[0];
  for (const x of REVIEWER_RANKS) if (points >= x.min) r = x;
  return r;
}
