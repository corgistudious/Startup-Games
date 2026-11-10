/**
 * World clock. Game time is derived from real time, never stored as "current day",
 * so every process (API, worker, web) computes the same value from the same epoch.
 *
 *   1 real minute  = 30 game minutes
 *   1 game day     = 48 real minutes
 *   1 game month   = 7 game days (Thứ Hai → Chủ Nhật)
 *   1 game year    = 12 game months
 */
export const TIME_SCALE = 30;
export const MINUTES_PER_DAY = 1440;
export const DAYS_PER_MONTH = 7;
export const MONTHS_PER_YEAR = 12;
/** The world advances in ticks of 30 game minutes (= 1 real minute). */
export const TICK_MINUTES = 30;

export const WEEKDAY_NAMES = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật'] as const;

export function gameMinuteAt(realMs: number, epochMs: number, scale = TIME_SCALE): number {
  return Math.floor(((realMs - epochMs) * scale) / 60_000);
}

/** Real timestamp (ms) at which the given game minute begins. */
export function realMsAtGameMinute(gameMinute: number, epochMs: number, scale = TIME_SCALE): number {
  return epochMs + Math.ceil((gameMinute * 60_000) / scale);
}

export type GameDate = {
  minute: number;
  day: number; // absolute day index, 0-based
  month: number; // absolute month index, 0-based
  year: number; // 0-based
  monthOfYear: number; // 0-11
  dayOfMonth: number; // 0-6, also weekday (0 = Thứ Hai)
  weekday: number;
  hour: number;
  minuteOfHour: number;
  minuteOfDay: number;
};

export function toGameDate(gameMinute: number): GameDate {
  const m = Math.max(0, gameMinute);
  const day = Math.floor(m / MINUTES_PER_DAY);
  const minuteOfDay = m % MINUTES_PER_DAY;
  const month = Math.floor(day / DAYS_PER_MONTH);
  return {
    minute: m,
    day,
    month,
    year: Math.floor(month / MONTHS_PER_YEAR),
    monthOfYear: month % MONTHS_PER_YEAR,
    dayOfMonth: day % DAYS_PER_MONTH,
    weekday: day % DAYS_PER_MONTH,
    hour: Math.floor(minuteOfDay / 60),
    minuteOfHour: minuteOfDay % 60,
    minuteOfDay,
  };
}

export function formatGameDate(gameMinute: number): string {
  const d = toGameDate(gameMinute);
  const hh = String(d.hour).padStart(2, '0');
  const mm = String(d.minuteOfHour).padStart(2, '0');
  return `${hh}:${mm} · ${WEEKDAY_NAMES[d.weekday]} · Ngày ${d.dayOfMonth + 1} · Tháng ${d.monthOfYear + 1} · Năm ${d.year + 1}`;
}

export const isWeekend = (weekday: number) => weekday >= 5;

export type ShiftKind = 'day' | 'night' | 'part' | 'rotating';

/**
 * Whether an employee on the given shift is working during the half hour that
 * starts at `minuteOfDay` on `weekday`. Standard day shift:
 *   08:00–12:00 work, 12:00–13:00 lunch, 13:00–17:00 work, weekdays only.
 */
export function isOnShift(shift: ShiftKind, weekday: number, minuteOfDay: number): boolean {
  const h = minuteOfDay / 60;
  switch (shift) {
    case 'day':
      return !isWeekend(weekday) && ((h >= 8 && h < 12) || (h >= 13 && h < 17));
    case 'part':
      return weekday <= 5 && h >= 17 && h < 21;
    case 'night':
      return !isWeekend(weekday) && (h >= 22 || h < 6);
    case 'rotating':
      // 24/7 businesses: staff split into crews; modelled as everyone working 8h of every 24.
      return h >= 6 && h < 14;
  }
}

/** Store opening check with hours that may wrap past midnight. */
export function isOpen(openHour: number, closeHour: number, daysMask: number, weekday: number, minuteOfDay: number): boolean {
  if ((daysMask & (1 << weekday)) === 0) return false;
  if (openHour === closeHour) return true; // 24h
  const h = minuteOfDay / 60;
  return openHour < closeHour ? h >= openHour && h < closeHour : h >= openHour || h < closeHour;
}
