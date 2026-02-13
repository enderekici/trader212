import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  clamp,
  formatCurrency,
  formatPercent,
  generateId,
  round,
  sleep,
  retryAsync,
} from '../../src/utils/helpers.js';

describe('helpers', () => {
  describe('sleep', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves after the specified delay', async () => {
      const p = sleep(1000);
      vi.advanceTimersByTime(1000);
      await expect(p).resolves.toBeUndefined();
    });

    it('resolves immediately for 0ms', async () => {
      const p = sleep(0);
      vi.advanceTimersByTime(0);
      await expect(p).resolves.toBeUndefined();
    });
  });

  describe('clamp', () => {
    it('returns value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
    });

    it('clamps to min', () => {
      expect(clamp(-1, 0, 10)).toBe(0);
    });

    it('clamps to max', () => {
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('returns min when value equals min', () => {
      expect(clamp(0, 0, 10)).toBe(0);
    });

    it('returns max when value equals max', () => {
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe('formatCurrency', () => {
    it('formats USD by default', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
    });

    it('formats with a different currency', () => {
      const result = formatCurrency(1234.56, 'EUR');
      expect(result).toContain('1,234.56');
    });

    it('formats zero', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('formats negative numbers', () => {
      expect(formatCurrency(-100)).toBe('-$100.00');
    });
  });

  describe('formatPercent', () => {
    it('formats as percentage', () => {
      expect(formatPercent(0.1234)).toBe('12.34%');
    });

    it('formats zero percent', () => {
      expect(formatPercent(0)).toBe('0.00%');
    });

    it('formats negative percent', () => {
      expect(formatPercent(-0.05)).toBe('-5.00%');
    });

    it('formats 100 percent', () => {
      expect(formatPercent(1)).toBe('100.00%');
    });
  });

  describe('generateId', () => {
    it('returns a string', () => {
      expect(typeof generateId()).toBe('string');
    });

    it('returns a 16-character hex string', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('returns unique values', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('round', () => {
    it('rounds to 2 decimals by default', () => {
      expect(round(1.2345)).toBe(1.23);
    });

    it('rounds to specified decimals', () => {
      expect(round(1.2345, 3)).toBe(1.235);
    });

    it('rounds to 0 decimals', () => {
      expect(round(1.5, 0)).toBe(2);
    });

    it('handles negative numbers', () => {
      // Math.round(-1.235 * 100) / 100 = Math.round(-123.5) / 100 = -124 / 100 = -1.24
      expect(round(-1.235, 2)).toBe(-1.24);
    });

    it('handles integers', () => {
      expect(round(5)).toBe(5);
    });

    it('rounds up correctly', () => {
      expect(round(1.255, 2)).toBe(1.25); // floating point: 1.255 * 100 = 125.49999...
    });

    it('handles large decimal places', () => {
      expect(round(3.14159265, 4)).toBe(3.1416);
    });
  });

  describe('retryAsync', () => {
    it('returns on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retryAsync(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and eventually succeeds', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');
      const result = await retryAsync(fn, 3, 1);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws last error after all attempts exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      await expect(retryAsync(fn, 3, 1)).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('wraps non-Error throws in an Error', async () => {
      const fn = vi.fn().mockRejectedValue('string error');
      await expect(retryAsync(fn, 1, 1)).rejects.toThrow('string error');
    });

    it('retries correct number of times with default params', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      const result = await retryAsync(fn, 2, 1);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('succeeds on the last attempt', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValueOnce('last-chance');
      const result = await retryAsync(fn, 3, 1);
      expect(result).toBe('last-chance');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('handles a single attempt that fails', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('single fail'));
      await expect(retryAsync(fn, 1, 1)).rejects.toThrow('single fail');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('handles non-Error objects by wrapping them', async () => {
      const fn = vi.fn().mockRejectedValue(42);
      await expect(retryAsync(fn, 1, 1)).rejects.toThrow('42');
    });

    it('preserves the Error instance when thrown error is an Error', async () => {
      const specificError = new TypeError('type error');
      const fn = vi.fn().mockRejectedValue(specificError);
      try {
        await retryAsync(fn, 1, 1);
      } catch (err) {
        expect(err).toBe(specificError);
      }
    });
  });
});
