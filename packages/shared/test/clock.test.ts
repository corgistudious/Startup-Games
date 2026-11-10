import { describe, it, expect } from 'vitest';
import { gameMinuteAt, toGameDate, isOnShift, isOpen, realMsAtGameMinute } from '../src/clock';

const EPOCH = Date.UTC(2026, 0, 1);

describe('world clock', () => {
  it('1 real minute = 30 game minutes', () => {
    expect(gameMinuteAt(EPOCH + 60_000, EPOCH)).toBe(30);
    expect(gameMinuteAt(EPOCH + 2 * 60_000, EPOCH)).toBe(60);
  });
  it('48 real minutes = 1 game day', () => {
    expect(toGameDate(gameMinuteAt(EPOCH + 48 * 60_000, EPOCH))).toMatchObject({ day: 1, hour: 0, minuteOfDay: 0 });
  });
  it('7 game days = 1 month = 5h36m real, 12 months = 1 year', () => {
    const month = gameMinuteAt(EPOCH + (5 * 60 + 36) * 60_000, EPOCH);
    expect(toGameDate(month)).toMatchObject({ month: 1, dayOfMonth: 0, weekday: 0 });
    expect(toGameDate(1440 * 7 * 12)).toMatchObject({ year: 1, monthOfYear: 0 });
  });
  it('round-trips real time for a game minute', () => {
    expect(gameMinuteAt(realMsAtGameMinute(12345, EPOCH), EPOCH)).toBe(12345);
  });
  it('standard shift: 08–12 work, 12–13 lunch, 13–17 work, weekends off', () => {
    expect(isOnShift('day', 0, 7.5 * 60)).toBe(false);
    expect(isOnShift('day', 0, 8 * 60)).toBe(true);
    expect(isOnShift('day', 0, 12 * 60)).toBe(false);
    expect(isOnShift('day', 0, 13 * 60)).toBe(true);
    expect(isOnShift('day', 0, 17 * 60)).toBe(false);
    expect(isOnShift('day', 5, 9 * 60)).toBe(false);
    expect(isOnShift('night', 2, 23 * 60)).toBe(true);
  });
  it('opening hours wrap midnight and respect day mask', () => {
    expect(isOpen(18, 2, 0b1111111, 3, 60)).toBe(true);
    expect(isOpen(18, 2, 0b1111111, 3, 12 * 60)).toBe(false);
    expect(isOpen(8, 22, 0b0011111, 6, 10 * 60)).toBe(false);
    expect(isOpen(0, 0, 0b1111111, 6, 3 * 60)).toBe(true);
  });
});
