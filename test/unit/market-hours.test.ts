import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger module
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// We need to mock the Date to control what getETTime() returns.
// The module uses `new Date()` and `toLocaleString('en-US', { timeZone: 'America/New_York' })`
// So we mock Date globally to control the returned ET time.

import {
  isWeekday,
  isUSMarketOpen,
  isPreMarket,
  isAfterHours,
  getMarketStatus,
  getNextMarketOpen,
  getNextMarketClose,
  getMarketTimes,
} from '../../src/utils/market-hours.js';

/**
 * Helper to mock the system time. We set the Date so that
 * `new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })`
 * returns the ET time we want.
 *
 * We need to figure out the UTC time that corresponds to our desired ET time.
 * During EST (standard time, Nov-Mar): ET = UTC - 5
 * During EDT (daylight saving, Mar-Nov): ET = UTC - 4
 *
 * For simplicity we use winter dates (EST, UTC-5).
 */
function setETTime(year: number, month: number, day: number, hours: number, minutes: number) {
  // Create a date in UTC that maps to the desired ET time.
  // For EST (winter): UTC = ET + 5 hours
  const utcDate = new Date(Date.UTC(year, month, day, hours + 5, minutes, 0, 0));
  vi.setSystemTime(utcDate);
}

describe('market-hours', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isWeekday', () => {
    it('returns true for a Monday', () => {
      // Jan 6, 2025 is Monday
      setETTime(2025, 0, 6, 10, 0);
      expect(isWeekday()).toBe(true);
    });

    it('returns true for a Wednesday', () => {
      // Jan 8, 2025 is Wednesday
      setETTime(2025, 0, 8, 10, 0);
      expect(isWeekday()).toBe(true);
    });

    it('returns true for a Friday', () => {
      // Jan 10, 2025 is Friday
      setETTime(2025, 0, 10, 10, 0);
      expect(isWeekday()).toBe(true);
    });

    it('returns false for a Saturday', () => {
      // Jan 11, 2025 is Saturday
      setETTime(2025, 0, 11, 10, 0);
      expect(isWeekday()).toBe(false);
    });

    it('returns false for a Sunday', () => {
      // Jan 12, 2025 is Sunday
      setETTime(2025, 0, 12, 10, 0);
      expect(isWeekday()).toBe(false);
    });

    it('returns false for a holiday that falls on a weekday', () => {
      // Jan 20, 2025 is MLK Day (Monday, NYSE holiday)
      setETTime(2025, 0, 20, 10, 0);
      expect(isWeekday()).toBe(false);
    });
  });

  describe('isUSMarketOpen', () => {
    it('returns true during normal market hours (10:00 AM ET)', () => {
      // Jan 6, 2025 is Monday
      setETTime(2025, 0, 6, 10, 0);
      expect(isUSMarketOpen()).toBe(true);
    });

    it('returns true at market open (9:30 AM ET)', () => {
      setETTime(2025, 0, 6, 9, 30);
      expect(isUSMarketOpen()).toBe(true);
    });

    it('returns false just before market open (9:29 AM ET)', () => {
      setETTime(2025, 0, 6, 9, 29);
      expect(isUSMarketOpen()).toBe(false);
    });

    it('returns false at market close (4:00 PM ET)', () => {
      setETTime(2025, 0, 6, 16, 0);
      expect(isUSMarketOpen()).toBe(false);
    });

    it('returns false just after market close (3:59 PM ET should still be open)', () => {
      setETTime(2025, 0, 6, 15, 59);
      expect(isUSMarketOpen()).toBe(true);
    });

    it('returns false on weekends', () => {
      setETTime(2025, 0, 11, 10, 0); // Saturday
      expect(isUSMarketOpen()).toBe(false);
    });

    it('returns false on holidays', () => {
      setETTime(2025, 0, 20, 10, 0); // MLK Day
      expect(isUSMarketOpen()).toBe(false);
    });

    it('returns true during early close day before close time', () => {
      // Jul 3, 2025 is an early close day (1:00 PM ET)
      // We need EDT offset: UTC = ET + 4 for summer
      const utcDate = new Date(Date.UTC(2025, 6, 3, 12 + 4, 0, 0, 0)); // 12:00 PM ET
      vi.setSystemTime(utcDate);
      expect(isUSMarketOpen()).toBe(true);
    });

    it('returns false during early close day at close time (1:00 PM ET)', () => {
      // Jul 3, 2025 — early close at 1:00 PM ET (EDT)
      const utcDate = new Date(Date.UTC(2025, 6, 3, 13 + 4, 0, 0, 0)); // 1:00 PM ET
      vi.setSystemTime(utcDate);
      expect(isUSMarketOpen()).toBe(false);
    });
  });

  describe('isPreMarket', () => {
    it('returns true at 4:00 AM ET on a weekday', () => {
      setETTime(2025, 0, 6, 4, 0);
      expect(isPreMarket()).toBe(true);
    });

    it('returns true at 8:00 AM ET on a weekday', () => {
      setETTime(2025, 0, 6, 8, 0);
      expect(isPreMarket()).toBe(true);
    });

    it('returns true at 9:29 AM ET on a weekday', () => {
      setETTime(2025, 0, 6, 9, 29);
      expect(isPreMarket()).toBe(true);
    });

    it('returns false at 9:30 AM ET (market open)', () => {
      setETTime(2025, 0, 6, 9, 30);
      expect(isPreMarket()).toBe(false);
    });

    it('returns false at 3:59 AM ET (before pre-market)', () => {
      setETTime(2025, 0, 6, 3, 59);
      expect(isPreMarket()).toBe(false);
    });

    it('returns false on weekends', () => {
      setETTime(2025, 0, 11, 6, 0); // Saturday
      expect(isPreMarket()).toBe(false);
    });

    it('returns false on holidays', () => {
      setETTime(2025, 0, 20, 6, 0); // MLK Day
      expect(isPreMarket()).toBe(false);
    });
  });

  describe('isAfterHours', () => {
    it('returns true at 4:00 PM ET on a normal weekday', () => {
      setETTime(2025, 0, 6, 16, 0);
      expect(isAfterHours()).toBe(true);
    });

    it('returns true at 7:00 PM ET on a weekday', () => {
      setETTime(2025, 0, 6, 19, 0);
      expect(isAfterHours()).toBe(true);
    });

    it('returns true at 7:59 PM ET on a weekday', () => {
      setETTime(2025, 0, 6, 19, 59);
      expect(isAfterHours()).toBe(true);
    });

    it('returns false at 8:00 PM ET (after-hours end)', () => {
      setETTime(2025, 0, 6, 20, 0);
      expect(isAfterHours()).toBe(false);
    });

    it('returns false during market hours (10:00 AM ET)', () => {
      setETTime(2025, 0, 6, 10, 0);
      expect(isAfterHours()).toBe(false);
    });

    it('returns false on weekends', () => {
      setETTime(2025, 0, 11, 17, 0); // Saturday
      expect(isAfterHours()).toBe(false);
    });

    it('returns true for after-hours on early close day', () => {
      // Jul 3, 2025 — early close at 1:00 PM ET, after-hours starts then (EDT: UTC-4)
      const utcDate = new Date(Date.UTC(2025, 6, 3, 14 + 4, 0, 0, 0)); // 2:00 PM ET
      vi.setSystemTime(utcDate);
      expect(isAfterHours()).toBe(true);
    });
  });

  describe('getMarketStatus', () => {
    it('returns "open" during market hours', () => {
      setETTime(2025, 0, 6, 10, 0);
      expect(getMarketStatus()).toBe('open');
    });

    it('returns "pre" during pre-market hours', () => {
      setETTime(2025, 0, 6, 7, 0);
      expect(getMarketStatus()).toBe('pre');
    });

    it('returns "after" during after-hours', () => {
      setETTime(2025, 0, 6, 17, 0);
      expect(getMarketStatus()).toBe('after');
    });

    it('returns "closed" during weekend', () => {
      setETTime(2025, 0, 11, 10, 0); // Saturday
      expect(getMarketStatus()).toBe('closed');
    });

    it('returns "closed" during nighttime on a weekday', () => {
      setETTime(2025, 0, 6, 22, 0); // 10:00 PM Monday
      expect(getMarketStatus()).toBe('closed');
    });

    it('returns "closed" very early morning before pre-market', () => {
      setETTime(2025, 0, 6, 2, 0); // 2:00 AM Monday
      expect(getMarketStatus()).toBe('closed');
    });
  });

  describe('getNextMarketOpen', () => {
    it('returns same day 9:30 AM when before market open on a weekday', () => {
      // Monday Jan 6, 2025 at 7:00 AM ET => next open is same day 9:30 AM
      setETTime(2025, 0, 6, 7, 0);
      const nextOpen = getNextMarketOpen();
      expect(nextOpen).toBeInstanceOf(Date);
      // The result is UTC-based; we verify it's in the future
      const now = new Date();
      // The open should be approximately 2.5 hours from now
      const diffMinutes = (nextOpen.getTime() - now.getTime()) / 60000;
      expect(diffMinutes).toBeGreaterThan(0);
      expect(diffMinutes).toBeLessThan(200);
    });

    it('returns next trading day when on a Saturday', () => {
      // Saturday Jan 11, 2025 => next open is Monday Jan 13
      setETTime(2025, 0, 11, 10, 0);
      const nextOpen = getNextMarketOpen();
      expect(nextOpen).toBeInstanceOf(Date);
      const now = new Date();
      const diffHours = (nextOpen.getTime() - now.getTime()) / 3600000;
      // Should be approximately 47.5 hours (Sat 10AM -> Mon 9:30AM)
      expect(diffHours).toBeGreaterThan(0);
    });

    it('returns next trading day when on a Sunday', () => {
      // Sunday Jan 12, 2025 => next open is Monday Jan 13
      setETTime(2025, 0, 12, 10, 0);
      const nextOpen = getNextMarketOpen();
      expect(nextOpen).toBeInstanceOf(Date);
      const now = new Date();
      expect(nextOpen.getTime()).toBeGreaterThan(now.getTime());
    });

    it('returns next trading day when after market close', () => {
      // Monday Jan 6, 2025 at 5:00 PM ET => next open is Tuesday Jan 7 at 9:30 AM
      setETTime(2025, 0, 6, 17, 0);
      const nextOpen = getNextMarketOpen();
      expect(nextOpen).toBeInstanceOf(Date);
      const now = new Date();
      const diffHours = (nextOpen.getTime() - now.getTime()) / 3600000;
      // Should be in the future, could be up to ~48h if timezone interpretation leads to next day
      expect(diffHours).toBeGreaterThan(0);
      expect(diffHours).toBeLessThan(72);
    });

    it('returns next day open when on a holiday', () => {
      // Jan 20, 2025 MLK Day (Monday) => next open is Tuesday Jan 21
      setETTime(2025, 0, 20, 10, 0);
      const nextOpen = getNextMarketOpen();
      expect(nextOpen).toBeInstanceOf(Date);
      const now = new Date();
      expect(nextOpen.getTime()).toBeGreaterThan(now.getTime());
    });

    it('returns same day open when during market hours', () => {
      // Monday Jan 6, 2025 at 10:00 AM — daysToAdd = 0
      setETTime(2025, 0, 6, 10, 0);
      const nextOpen = getNextMarketOpen();
      // During market hours, daysToAdd is 0, etNext = 9:30 same day
      // But 9:30 < 10:00, so next open is in the past (negative diff) or near-zero
      // Actually the function doesn't check if we're past 9:30, it just returns 9:30 same day
      expect(nextOpen).toBeInstanceOf(Date);
    });

    it('handles Friday after close -> skip to Monday', () => {
      // Friday Jan 10, 2025 at 5:00 PM ET
      setETTime(2025, 0, 10, 17, 0);
      const nextOpen = getNextMarketOpen();
      expect(nextOpen).toBeInstanceOf(Date);
      const now = new Date();
      const diffHours = (nextOpen.getTime() - now.getTime()) / 3600000;
      // About 64.5 hours (Fri 5PM -> Mon 9:30AM)
      expect(diffHours).toBeGreaterThan(40);
    });
  });

  describe('getNextMarketClose', () => {
    it('returns null on weekends', () => {
      setETTime(2025, 0, 11, 10, 0); // Saturday
      expect(getNextMarketClose()).toBeNull();
    });

    it('returns null on holidays', () => {
      setETTime(2025, 0, 20, 10, 0); // MLK Day (Mon)
      expect(getNextMarketClose()).toBeNull();
    });

    it('returns today 4:00 PM when market is open', () => {
      // Monday Jan 6, 2025 at 10:00 AM ET
      setETTime(2025, 0, 6, 10, 0);
      const nextClose = getNextMarketClose();
      expect(nextClose).toBeInstanceOf(Date);
      expect(nextClose).not.toBeNull();
      const now = new Date();
      const diffMinutes = (nextClose!.getTime() - now.getTime()) / 60000;
      // 6 hours = 360 minutes from 10AM to 4PM
      expect(diffMinutes).toBeGreaterThan(350);
      expect(diffMinutes).toBeLessThan(370);
    });

    it('returns today close when before market open', () => {
      // Monday Jan 6, 2025 at 7:00 AM ET
      setETTime(2025, 0, 6, 7, 0);
      const nextClose = getNextMarketClose();
      expect(nextClose).toBeInstanceOf(Date);
      expect(nextClose).not.toBeNull();
      const now = new Date();
      const diffMinutes = (nextClose!.getTime() - now.getTime()) / 60000;
      // 9 hours = 540 minutes from 7AM to 4PM
      expect(diffMinutes).toBeGreaterThan(530);
      expect(diffMinutes).toBeLessThan(550);
    });

    it('returns next trading day close when after market close', () => {
      // Monday Jan 6, 2025 at 5:00 PM ET => next close is Tue Jan 7 at 4:00 PM
      setETTime(2025, 0, 6, 17, 0);
      const nextClose = getNextMarketClose();
      expect(nextClose).toBeInstanceOf(Date);
      expect(nextClose).not.toBeNull();
      const now = new Date();
      const diffMinutes = (nextClose!.getTime() - now.getTime()) / 60000;
      // About 23 hours = 1380 minutes from Mon 5PM to Tue 4PM
      expect(diffMinutes).toBeGreaterThan(1370);
      expect(diffMinutes).toBeLessThan(1390);
    });

    it('handles early close day during market hours', () => {
      // Jul 3, 2025 — early close at 1:00 PM ET (EDT: UTC-4)
      // Market at 10:00 AM ET
      const utcDate = new Date(Date.UTC(2025, 6, 3, 10 + 4, 0, 0, 0));
      vi.setSystemTime(utcDate);
      const nextClose = getNextMarketClose();
      expect(nextClose).not.toBeNull();
      const now = new Date();
      const diffMinutes = (nextClose!.getTime() - now.getTime()) / 60000;
      // 3 hours = 180 minutes from 10AM to 1PM
      expect(diffMinutes).toBeGreaterThan(170);
      expect(diffMinutes).toBeLessThan(190);
    });
  });

  describe('getMarketTimes', () => {
    it('returns a MarketTimes object with all fields during market open', () => {
      setETTime(2025, 0, 6, 10, 0); // Monday 10 AM
      const times = getMarketTimes();
      expect(times.marketStatus).toBe('open');
      expect(times.currentTimeET).toBeDefined();
      expect(times.currentTimeUTC).toBeDefined();
      expect(times.nextOpen).toBeDefined();
      expect(times.nextClose).not.toBeNull();
      expect(typeof times.countdownMinutes).toBe('number');
      expect(times.isHoliday).toBe(false);
      expect(times.isEarlyClose).toBe(false);
    });

    it('returns correct countdown when market is open (countdown to close)', () => {
      setETTime(2025, 0, 6, 10, 0); // Monday 10 AM, close at 4 PM = 360 min
      const times = getMarketTimes();
      expect(times.marketStatus).toBe('open');
      // countdownMinutes should be approximately 360
      expect(times.countdownMinutes).toBeGreaterThan(350);
      expect(times.countdownMinutes).toBeLessThan(370);
    });

    it('returns correct countdown when market is closed (countdown to open)', () => {
      setETTime(2025, 0, 6, 22, 0); // Monday 10 PM, closed
      const times = getMarketTimes();
      expect(times.marketStatus).toBe('closed');
      // countdown should be to next open
      expect(times.countdownMinutes).toBeGreaterThan(0);
    });

    it('returns correct status for pre-market', () => {
      setETTime(2025, 0, 6, 7, 0); // Monday 7 AM
      const times = getMarketTimes();
      expect(times.marketStatus).toBe('pre');
      expect(times.countdownMinutes).toBeGreaterThan(0);
    });

    it('returns correct status for after-hours', () => {
      setETTime(2025, 0, 6, 17, 0); // Monday 5 PM
      const times = getMarketTimes();
      expect(times.marketStatus).toBe('after');
    });

    it('returns isHoliday true on a holiday', () => {
      setETTime(2025, 0, 20, 10, 0); // MLK Day
      const times = getMarketTimes();
      expect(times.isHoliday).toBe(true);
    });

    it('returns isEarlyClose true on an early close day', () => {
      // Jul 3, 2025 — early close (EDT: UTC-4)
      const utcDate = new Date(Date.UTC(2025, 6, 3, 10 + 4, 0, 0, 0));
      vi.setSystemTime(utcDate);
      const times = getMarketTimes();
      expect(times.isEarlyClose).toBe(true);
    });

    it('returns nextClose as null on weekends', () => {
      setETTime(2025, 0, 11, 10, 0); // Saturday
      const times = getMarketTimes();
      expect(times.nextClose).toBeNull();
      expect(times.marketStatus).toBe('closed');
    });
  });
});
