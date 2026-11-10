import { formatVnd, toGameDate, WEEKDAY_NAMES } from '@startup/shared';

export const vnd = (n: number | string | null | undefined, compact = false) => formatVnd(Number(n ?? 0), { compact });
export const num = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('vi-VN');
export const pct = (n: number) => `${(n * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;

export function gameTime(minute: number) {
  const d = toGameDate(minute);
  return `${String(d.hour).padStart(2, '0')}:${String(d.minuteOfHour).padStart(2, '0')} ${WEEKDAY_NAMES[d.weekday]}, ngày ${d.day + 1}`;
}
export const dayLabel = (day: number) => `N${day + 1}`;
export const monthLabel = (m: number) => `Tháng ${(m % 12) + 1}/Năm ${Math.floor(m / 12) + 1}`;

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return `${Math.floor(s / 86400)} ngày trước`;
}

export const STATUS_LABEL: Record<string, string> = {
  licensing: 'Chờ giấy phép',
  active: 'Đang hoạt động',
  insolvent: 'Mất khả năng thanh toán',
  bankrupt: 'Phá sản',
  closed: 'Đã đóng',
};
