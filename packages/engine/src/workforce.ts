import { isOnShift, type ShiftKind } from '@startup/shared';

export type WorkState = { regular: boolean; overtime: boolean; onLeave: boolean; working: boolean; paid: boolean };

/**
 * Single source of truth for "is this employee working during the half hour starting
 * at minuteOfDay". Used by production, the retail market and payroll so they agree.
 *  - regular: inside the employee's shift;
 *  - overtime: day-shift staff on weekdays, 17:00 to 17:00 + company overtime hours;
 *  - onLeave: paid leave, regular hours are paid but no work is done.
 */
export function workState(p: { shift: ShiftKind | string; leave_until_minute?: number | null }, overtimeHours: number, weekday: number, minuteOfDay: number, minute: number): WorkState {
  const h = minuteOfDay / 60;
  const regular = isOnShift(p.shift as ShiftKind, weekday, minuteOfDay);
  const overtime = !regular && p.shift === 'day' && weekday < 5 && overtimeHours > 0 && h >= 17 && h < 17 + overtimeHours;
  const onLeave = p.leave_until_minute != null && minute < p.leave_until_minute;
  return { regular, overtime, onLeave, working: (regular || overtime) && !onLeave, paid: regular };
}

/** Daily cost per employee and daily morale effect of each benefit package. */
export const BENEFITS = [
  { level: 0, name: 'Không có', costPerDay: 0, morale: 0 },
  { level: 1, name: 'Cơ bản: bảo hiểm xã hội', costPerDay: 25_000, morale: 1 },
  { level: 2, name: 'Tiêu chuẩn: bảo hiểm + ăn trưa', costPerDay: 60_000, morale: 2 },
  { level: 3, name: 'Cao cấp: bảo hiểm sức khỏe, ăn trưa, du lịch', costPerDay: 120_000, morale: 3 },
] as const;

export const OVERTIME_MULTIPLIER = 1.5;
export const ANNUAL_LEAVE_DAYS = 12;
