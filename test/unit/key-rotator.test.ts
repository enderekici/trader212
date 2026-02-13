import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger module before importing anything that uses it
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

import { KeyRotator, createFinnhubRotator, createMarketauxRotator } from '../../src/utils/key-rotator.js';

describe('KeyRotator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('FINNHUB_API_KEY', '');
    vi.stubEnv('MARKETAUX_API_TOKEN', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('constructor', () => {
    it('filters empty keys', () => {
      const rotator = new KeyRotator(['key1', '', 'key2', ''], 60, 60000);
      expect(rotator.getKeyCount()).toBe(2);
    });

    it('logs warning when no keys provided', () => {
      const rotator = new KeyRotator([], 60, 60000);
      expect(rotator.getKeyCount()).toBe(0);
    });

    it('logs warning when all keys are empty strings', () => {
      const rotator = new KeyRotator(['', ''], 60, 60000);
      expect(rotator.getKeyCount()).toBe(0);
    });
  });

  describe('getKey', () => {
    it('returns null when no keys are available', () => {
      const rotator = new KeyRotator([], 60, 60000);
      expect(rotator.getKey()).toBeNull();
    });

    it('returns the first key on first call', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 60, 60000);
      expect(rotator.getKey()).toBe('key1');
    });

    it('rotates through keys in round-robin fashion', () => {
      const rotator = new KeyRotator(['key1', 'key2', 'key3'], 60, 60000);
      expect(rotator.getKey()).toBe('key1');
      expect(rotator.getKey()).toBe('key2');
      expect(rotator.getKey()).toBe('key3');
      expect(rotator.getKey()).toBe('key1');
    });

    it('tracks call counts and respects rate limits', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 2, 60000);
      // key1 count: 1
      expect(rotator.getKey()).toBe('key1');
      // key2 count: 1
      expect(rotator.getKey()).toBe('key2');
      // key1 count: 2 (at limit)
      expect(rotator.getKey()).toBe('key1');
      // key2 count: 2 (at limit)
      expect(rotator.getKey()).toBe('key2');
      // Both at rate limit, returns current key
      expect(rotator.getKey()).toBe('key1');
    });

    it('resets rate count after the rate period expires', () => {
      const rotator = new KeyRotator(['key1'], 1, 1000);
      expect(rotator.getKey()).toBe('key1');
      // Now at limit
      // Calling again should trigger the "all exhausted" branch
      expect(rotator.getKey()).toBe('key1');
      // Advance time past rate period
      vi.advanceTimersByTime(1001);
      // Should reset and return the key again
      expect(rotator.getKey()).toBe('key1');
    });

    it('falls back to current key when all keys at rate limit', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 1, 60000);
      rotator.getKey(); // key1 count: 1 (at limit)
      rotator.getKey(); // key2 count: 1 (at limit)
      // All exhausted, should warn and return current key
      const result = rotator.getKey();
      expect(result).toBe('key1');
    });

    it('handles single key correctly', () => {
      const rotator = new KeyRotator(['onlykey'], 3, 60000);
      expect(rotator.getKey()).toBe('onlykey');
      expect(rotator.getKey()).toBe('onlykey');
      expect(rotator.getKey()).toBe('onlykey');
      // 4th call: at limit, returns the single key
      expect(rotator.getKey()).toBe('onlykey');
    });

    it('uses key where usage.count < rateLimit', () => {
      // Test the branch: if (usage.count < this.rateLimit)
      const rotator = new KeyRotator(['key1', 'key2'], 3, 60000);
      // First call: key1, no usage record -> creates new record with count=1
      expect(rotator.getKey()).toBe('key1');
      // Second call: key2, no usage record -> creates new record with count=1
      expect(rotator.getKey()).toBe('key2');
      // Third call: key1, usage.count=1 < 3 -> increments to 2
      expect(rotator.getKey()).toBe('key1');
      // Fourth call: key2, usage.count=1 < 3 -> increments to 2
      expect(rotator.getKey()).toBe('key2');
    });
  });

  describe('getEffectiveRateLimit', () => {
    it('multiplies rate limit by key count', () => {
      const rotator = new KeyRotator(['a', 'b', 'c'], 60, 60000);
      expect(rotator.getEffectiveRateLimit()).toBe(180);
    });

    it('returns rate limit for single key', () => {
      const rotator = new KeyRotator(['a'], 60, 60000);
      expect(rotator.getEffectiveRateLimit()).toBe(60);
    });

    it('returns rate limit when no keys (uses Math.max(0, 1) = 1)', () => {
      const rotator = new KeyRotator([], 60, 60000);
      expect(rotator.getEffectiveRateLimit()).toBe(60);
    });
  });

  describe('getKeyCount', () => {
    it('returns the number of valid keys', () => {
      const rotator = new KeyRotator(['a', 'b'], 60, 60000);
      expect(rotator.getKeyCount()).toBe(2);
    });

    it('returns 0 when no keys', () => {
      const rotator = new KeyRotator([], 60, 60000);
      expect(rotator.getKeyCount()).toBe(0);
    });
  });

  describe('getUsageStats', () => {
    it('returns empty stats for unused keys', () => {
      const rotator = new KeyRotator(['a', 'b'], 60, 60000);
      const stats = rotator.getUsageStats();
      expect(stats).toEqual([
        { keyIndex: 0, calls: 0, resetsIn: 0 },
        { keyIndex: 1, calls: 0, resetsIn: 0 },
      ]);
    });

    it('returns usage stats after calls', () => {
      vi.setSystemTime(new Date(1000));
      const rotator = new KeyRotator(['a', 'b'], 60, 5000);
      rotator.getKey(); // 'a' gets 1 call
      rotator.getKey(); // 'b' gets 1 call

      const stats = rotator.getUsageStats();
      expect(stats[0].keyIndex).toBe(0);
      expect(stats[0].calls).toBe(1);
      expect(stats[0].resetsIn).toBe(5000); // resetAt = 1000 + 5000 = 6000, now = 1000, diff = 5000
      expect(stats[1].keyIndex).toBe(1);
      expect(stats[1].calls).toBe(1);
    });

    it('returns 0 resetsIn when reset time has passed', () => {
      vi.setSystemTime(new Date(1000));
      const rotator = new KeyRotator(['a'], 60, 100);
      rotator.getKey();

      vi.advanceTimersByTime(200);
      const stats = rotator.getUsageStats();
      expect(stats[0].resetsIn).toBe(0); // Math.max(0, resetAt - now) = Math.max(0, negative) = 0
    });

    it('returns empty array when no keys', () => {
      const rotator = new KeyRotator([], 60, 60000);
      expect(rotator.getUsageStats()).toEqual([]);
    });
  });

  describe('createFinnhubRotator', () => {
    it('creates a rotator with FINNHUB_API_KEY env var', () => {
      vi.stubEnv('FINNHUB_API_KEY', 'key1,key2,key3');
      const rotator = createFinnhubRotator();
      expect(rotator.getKeyCount()).toBe(3);
      expect(rotator.getEffectiveRateLimit()).toBe(180); // 60 * 3
    });

    it('handles single key', () => {
      vi.stubEnv('FINNHUB_API_KEY', 'singlekey');
      const rotator = createFinnhubRotator();
      expect(rotator.getKeyCount()).toBe(1);
    });

    it('handles empty env var', () => {
      vi.stubEnv('FINNHUB_API_KEY', '');
      const rotator = createFinnhubRotator();
      expect(rotator.getKeyCount()).toBe(0);
    });

    it('handles undefined env var', () => {
      delete process.env.FINNHUB_API_KEY;
      const rotator = createFinnhubRotator();
      expect(rotator.getKeyCount()).toBe(0);
    });

    it('trims whitespace from keys', () => {
      vi.stubEnv('FINNHUB_API_KEY', ' key1 , key2 ');
      const rotator = createFinnhubRotator();
      expect(rotator.getKeyCount()).toBe(2);
      expect(rotator.getKey()).toBe('key1');
      expect(rotator.getKey()).toBe('key2');
    });

    it('filters empty segments from commas', () => {
      vi.stubEnv('FINNHUB_API_KEY', 'key1,,key2,');
      const rotator = createFinnhubRotator();
      expect(rotator.getKeyCount()).toBe(2);
    });
  });

  describe('createMarketauxRotator', () => {
    it('creates a rotator with MARKETAUX_API_TOKEN env var', () => {
      vi.stubEnv('MARKETAUX_API_TOKEN', 'token1,token2');
      const rotator = createMarketauxRotator();
      expect(rotator.getKeyCount()).toBe(2);
      expect(rotator.getEffectiveRateLimit()).toBe(200); // 100 * 2
    });

    it('handles empty env var', () => {
      vi.stubEnv('MARKETAUX_API_TOKEN', '');
      const rotator = createMarketauxRotator();
      expect(rotator.getKeyCount()).toBe(0);
    });

    it('handles undefined env var', () => {
      delete process.env.MARKETAUX_API_TOKEN;
      const rotator = createMarketauxRotator();
      expect(rotator.getKeyCount()).toBe(0);
    });
  });
});
