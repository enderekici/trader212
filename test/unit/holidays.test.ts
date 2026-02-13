import { describe, expect, it } from 'vitest';
import {
  isNYSEHoliday,
  isNYSEEarlyClose,
  getNYSECloseMinutes,
  getNextTradingDay,
} from '../../src/utils/holidays.js';

describe('holidays', () => {
  describe('isNYSEHoliday', () => {
    it('returns true for a known 2025 holiday (New Year)', () => {
      const date = new Date(2025, 0, 1); // Jan 1, 2025
      expect(isNYSEHoliday(date)).toBe(true);
    });

    it('returns true for a known 2025 holiday (MLK Day)', () => {
      const date = new Date(2025, 0, 20); // Jan 20, 2025
      expect(isNYSEHoliday(date)).toBe(true);
    });

    it('returns true for a known 2024 holiday (July 4th)', () => {
      const date = new Date(2024, 6, 4); // Jul 4, 2024
      expect(isNYSEHoliday(date)).toBe(true);
    });

    it('returns true for a known 2026 holiday', () => {
      const date = new Date(2026, 0, 1); // Jan 1, 2026
      expect(isNYSEHoliday(date)).toBe(true);
    });

    it('returns true for a known 2027 holiday', () => {
      const date = new Date(2027, 0, 1); // Jan 1, 2027
      expect(isNYSEHoliday(date)).toBe(true);
    });

    it('returns true for a known 2028 holiday', () => {
      const date = new Date(2028, 0, 17); // Jan 17, 2028
      expect(isNYSEHoliday(date)).toBe(true);
    });

    it('returns false for a non-holiday weekday', () => {
      const date = new Date(2025, 0, 2); // Jan 2, 2025 (Thursday)
      expect(isNYSEHoliday(date)).toBe(false);
    });

    it('returns false for a year not in the holiday calendar', () => {
      const date = new Date(2030, 0, 1);
      expect(isNYSEHoliday(date)).toBe(false);
    });
  });

  describe('isNYSEEarlyClose', () => {
    it('returns true for a known 2024 early close day (Jul 3)', () => {
      const date = new Date(2024, 6, 3); // Jul 3, 2024
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns true for a known 2024 early close (Nov 29)', () => {
      const date = new Date(2024, 10, 29); // Nov 29, 2024
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns true for a known 2024 early close (Dec 24)', () => {
      const date = new Date(2024, 11, 24); // Dec 24, 2024
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns true for a known 2025 early close day (Jul 3)', () => {
      const date = new Date(2025, 6, 3); // Jul 3, 2025
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns true for a known 2026 early close day', () => {
      const date = new Date(2026, 10, 27); // Nov 27, 2026
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns true for a known 2027 early close day', () => {
      const date = new Date(2027, 10, 26); // Nov 26, 2027
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns true for a known 2028 early close day', () => {
      const date = new Date(2028, 6, 3); // Jul 3, 2028
      expect(isNYSEEarlyClose(date)).toBe(true);
    });

    it('returns false for a normal trading day', () => {
      const date = new Date(2025, 0, 2); // Jan 2, 2025
      expect(isNYSEEarlyClose(date)).toBe(false);
    });

    it('returns false for a year not in the early close calendar', () => {
      const date = new Date(2030, 6, 3);
      expect(isNYSEEarlyClose(date)).toBe(false);
    });
  });

  describe('getNYSECloseMinutes', () => {
    it('returns 780 (1:00 PM) for an early close day', () => {
      const date = new Date(2024, 6, 3); // Jul 3, 2024 — early close
      expect(getNYSECloseMinutes(date)).toBe(13 * 60); // 780
    });

    it('returns 960 (4:00 PM) for a normal trading day', () => {
      const date = new Date(2025, 0, 2); // Jan 2, 2025 — normal
      expect(getNYSECloseMinutes(date)).toBe(16 * 60); // 960
    });
  });

  describe('getNextTradingDay', () => {
    it('skips to Monday when given a Friday', () => {
      const friday = new Date(2025, 0, 3); // Jan 3, 2025 (Friday)
      const next = getNextTradingDay(friday);
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getDate()).toBe(6);
    });

    it('skips to Monday when given a Saturday', () => {
      const saturday = new Date(2025, 0, 4); // Jan 4, 2025 (Saturday)
      const next = getNextTradingDay(saturday);
      expect(next.getDay()).toBe(1); // Monday
      expect(next.getDate()).toBe(6);
    });

    it('returns next day for a regular weekday', () => {
      const tuesday = new Date(2025, 0, 7); // Jan 7, 2025 (Tuesday)
      const next = getNextTradingDay(tuesday);
      expect(next.getDate()).toBe(8);
    });

    it('skips holidays', () => {
      // Dec 31, 2024 (Tue) -> next day is Jan 1, 2025 (holiday) -> Jan 2
      const dec31 = new Date(2024, 11, 31);
      const next = getNextTradingDay(dec31);
      expect(next.getDate()).toBe(2);
      expect(next.getMonth()).toBe(0); // January
    });

    it('skips weekend AND holiday', () => {
      // Jan 17, 2025 (Friday) -> Jan 18 (Sat) -> Jan 19 (Sun) -> Jan 20 (MLK holiday) -> Jan 21 (Tue)
      const fri = new Date(2025, 0, 17);
      const next = getNextTradingDay(fri);
      expect(next.getDate()).toBe(21);
    });
  });
});
