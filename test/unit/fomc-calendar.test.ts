import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { getFOMCProximity } from '../../src/utils/fomc-calendar.js';

describe('fomc-calendar', () => {
  describe('getFOMCProximity', () => {
    it('returns correct daysToNext for a date right before a meeting', () => {
      // Jan 28, 2025 is one day before the Jan 29 FOMC meeting
      const result = getFOMCProximity(new Date(2025, 0, 28));
      expect(result.daysToNext).toBe(1);
    });

    it('returns daysToNext = 0 on a meeting day', () => {
      const result = getFOMCProximity(new Date(2025, 0, 29));
      expect(result.daysToNext).toBe(0);
    });

    it('isFOMCDay is true on a meeting day', () => {
      const result = getFOMCProximity(new Date(2025, 0, 29));
      expect(result.isFOMCDay).toBe(true);
    });

    it('isFOMCDay is false on a non-meeting day', () => {
      const result = getFOMCProximity(new Date(2025, 0, 28));
      expect(result.isFOMCDay).toBe(false);
    });

    it('isPreFOMC is true on T-1 (day before meeting)', () => {
      // Jan 28, 2025 is T-1 for the Jan 29 meeting
      const result = getFOMCProximity(new Date(2025, 0, 28));
      expect(result.isPreFOMC).toBe(true);
    });

    it('isPreFOMC is true on T (meeting day)', () => {
      const result = getFOMCProximity(new Date(2025, 0, 29));
      expect(result.isPreFOMC).toBe(true);
    });

    it('isPreFOMC is true on T+1 (day after meeting)', () => {
      // Jan 30, 2025 is T+1 for the Jan 29 meeting
      const result = getFOMCProximity(new Date(2025, 0, 30));
      expect(result.isPreFOMC).toBe(true);
    });

    it('isPreFOMC is false for dates far from any meeting', () => {
      // Feb 10, 2025 is well between the Jan 29 and Mar 19 meetings
      const result = getFOMCProximity(new Date(2025, 1, 10));
      expect(result.isPreFOMC).toBe(false);
    });

    it('returns daysToNext correctly when between meetings', () => {
      // Feb 10, 2025 -> next meeting is Mar 19, 2025 (37 days later)
      const result = getFOMCProximity(new Date(2025, 1, 10));
      expect(result.daysToNext).toBe(37);
      expect(result.isFOMCDay).toBe(false);
    });

    it('returns correct data when date falls after last known meeting', () => {
      // After all 2028 meetings
      const result = getFOMCProximity(new Date(2029, 5, 1));
      expect(result.daysToNext).toBe(Number.MAX_SAFE_INTEGER);
      expect(result.isFOMCDay).toBe(false);
      expect(result.isPreFOMC).toBe(false);
    });

    it('works with no argument (uses current date)', () => {
      const result = getFOMCProximity();
      expect(result).toHaveProperty('daysToNext');
      expect(result).toHaveProperty('isPreFOMC');
      expect(result).toHaveProperty('isFOMCDay');
      expect(typeof result.daysToNext).toBe('number');
      expect(typeof result.isPreFOMC).toBe('boolean');
      expect(typeof result.isFOMCDay).toBe('boolean');
    });

    it('detects FOMC days across multiple years', () => {
      // Spot-check one date from each year
      expect(getFOMCProximity(new Date(2024, 0, 31)).isFOMCDay).toBe(true);
      expect(getFOMCProximity(new Date(2025, 8, 17)).isFOMCDay).toBe(true);
      expect(getFOMCProximity(new Date(2026, 3, 29)).isFOMCDay).toBe(true);
      expect(getFOMCProximity(new Date(2027, 8, 22)).isFOMCDay).toBe(true);
      expect(getFOMCProximity(new Date(2028, 11, 13)).isFOMCDay).toBe(true);
    });

    it('calculates daysToNext correctly at year boundary', () => {
      // Dec 19, 2024 is one day after the Dec 18 meeting
      // Next FOMC is Jan 29, 2025 (41 days later)
      const result = getFOMCProximity(new Date(2024, 11, 19));
      expect(result.daysToNext).toBe(41);
    });
  });
});
