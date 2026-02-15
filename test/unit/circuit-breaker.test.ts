import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerError } from '../../src/utils/circuit-breaker.js';

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    vi.clearAllMocks();
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      name: 'test-breaker',
    });
  });

  describe('initial state', () => {
    it('should start in closed state', () => {
      expect(breaker.getState()).toBe('closed');
    });

    it('should have zero failure count', () => {
      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.state).toBe('closed');
      expect(stats.nextAttempt).toBeNull();
    });
  });

  describe('successful execution', () => {
    it('should execute function and return result', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledOnce();
      expect(breaker.getState()).toBe('closed');
    });

    it('should reset failure count on success', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Fail once
      await expect(breaker.execute(failFn)).rejects.toThrow('fail');
      expect(breaker.getStats().failureCount).toBe(1);

      // Then succeed
      await breaker.execute(successFn);
      expect(breaker.getStats().failureCount).toBe(0);
    });
  });

  describe('failure handling', () => {
    it('should increment failure count on error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      expect(breaker.getStats().failureCount).toBe(1);
    });

    it('should open circuit after threshold failures', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Fail 3 times (threshold)
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');

      expect(breaker.getState()).toBe('open');
      expect(breaker.getStats().failureCount).toBe(3);
    });

    it('should throw CircuitBreakerError when open', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');

      // Next attempt should throw CircuitBreakerError
      await expect(breaker.execute(fn)).rejects.toThrow(CircuitBreakerError);
      await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker test-breaker is OPEN');
    });

    it('should propagate original error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('original error'));

      await expect(breaker.execute(fn)).rejects.toThrow('original error');
    });
  });

  describe('half-open state', () => {
    it('should transition to half-open after timeout', async () => {
      vi.useFakeTimers();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      expect(breaker.getState()).toBe('open');

      // Advance time past resetTimeout
      vi.advanceTimersByTime(1100);
      expect(breaker.getState()).toBe('half-open');

      vi.useRealTimers();
    });

    it('should close circuit on successful half-open request', async () => {
      vi.useFakeTimers();
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Open the circuit
      await expect(breaker.execute(failFn)).rejects.toThrow();
      await expect(breaker.execute(failFn)).rejects.toThrow();
      await expect(breaker.execute(failFn)).rejects.toThrow();

      // Wait for reset timeout
      vi.advanceTimersByTime(1100);

      // Execute should work in half-open state
      const result = await breaker.execute(successFn);
      expect(result).toBe('success');
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getStats().failureCount).toBe(0);

      vi.useRealTimers();
    });

    it('should re-open circuit on failed half-open request', async () => {
      vi.useFakeTimers();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();

      // Wait for reset timeout
      vi.advanceTimersByTime(1100);

      // Fail in half-open state
      await expect(breaker.execute(fn)).rejects.toThrow('fail');
      expect(breaker.getState()).toBe('open');

      vi.useRealTimers();
    });
  });

  describe('manual reset', () => {
    it('should reset circuit to closed state', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      expect(breaker.getState()).toBe('open');

      // Manual reset
      breaker.reset();
      expect(breaker.getState()).toBe('closed');
      expect(breaker.getStats().failureCount).toBe(0);
      expect(breaker.getStats().nextAttempt).toBeNull();
    });

    it('should allow execution after manual reset', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // Open the circuit
      await expect(breaker.execute(failFn)).rejects.toThrow();
      await expect(breaker.execute(failFn)).rejects.toThrow();
      await expect(breaker.execute(failFn)).rejects.toThrow();

      // Reset and execute
      breaker.reset();
      const result = await breaker.execute(successFn);
      expect(result).toBe('success');
    });
  });

  describe('getStats', () => {
    it('should return current statistics', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();

      const stats = breaker.getStats();
      expect(stats.state).toBe('closed');
      expect(stats.failureCount).toBe(2);
      expect(stats.nextAttempt).toBeNull();
    });

    it('should include nextAttempt when open', async () => {
      vi.useFakeTimers();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();

      const stats = breaker.getStats();
      expect(stats.state).toBe('open');
      expect(stats.nextAttempt).toBeGreaterThan(Date.now());

      vi.useRealTimers();
    });
  });

  describe('custom threshold', () => {
    it('should respect custom failure threshold', async () => {
      const customBreaker = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 1000,
      });

      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Fail 4 times - should still be closed
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      expect(customBreaker.getState()).toBe('closed');

      // 5th failure should open
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      expect(customBreaker.getState()).toBe('open');
    });
  });

  describe('custom resetTimeout', () => {
    it('should respect custom reset timeout', async () => {
      vi.useFakeTimers();
      const customBreaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 5000,
      });

      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      // Open the circuit
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      await expect(customBreaker.execute(fn)).rejects.toThrow();
      expect(customBreaker.getState()).toBe('open');

      // Advance time by 4 seconds - should still be open
      vi.advanceTimersByTime(4000);
      expect(customBreaker.getState()).toBe('open');

      // Advance time by 1 more second - should be half-open
      vi.advanceTimersByTime(1100);
      expect(customBreaker.getState()).toBe('half-open');

      vi.useRealTimers();
    });
  });
});
