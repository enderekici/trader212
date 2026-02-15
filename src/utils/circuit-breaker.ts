import { createLogger } from './logger.js';

const log = createLogger('circuit-breaker');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Failure threshold before opening circuit */
  failureThreshold: number;
  /** Timeout in ms before attempting half-open state */
  resetTimeout: number;
  /** Optional name for logging */
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private nextAttempt = 0;
  private readonly name: string;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.name = options.name || 'circuit-breaker';
  }

  /**
   * Execute a function with circuit breaker protection.
   * Throws CircuitBreakerError if circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        throw new CircuitBreakerError(
          `Circuit breaker ${this.name} is OPEN (retry after ${new Date(this.nextAttempt).toISOString()})`,
        );
      }
      // Transition to half-open to allow one test request
      this.state = 'half-open';
      log.info({ name: this.name }, 'Circuit breaker transitioning to HALF-OPEN');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === 'half-open') {
      this.state = 'closed';
      log.info({ name: this.name }, 'Circuit breaker CLOSED after successful test');
    }
  }

  private onFailure(): void {
    this.failureCount += 1;

    if (this.state === 'half-open') {
      // Failed in half-open, go back to open
      this.state = 'open';
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      log.warn(
        { name: this.name, nextAttempt: new Date(this.nextAttempt).toISOString() },
        'Circuit breaker re-OPENED after half-open failure',
      );
      return;
    }

    if (this.failureCount >= this.options.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.options.resetTimeout;
      log.error(
        {
          name: this.name,
          failureCount: this.failureCount,
          threshold: this.options.failureThreshold,
          nextAttempt: new Date(this.nextAttempt).toISOString(),
        },
        'Circuit breaker OPENED due to failures',
      );
    }
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    // Update state if we're in open and reset timeout has passed
    if (this.state === 'open' && Date.now() >= this.nextAttempt) {
      return 'half-open';
    }
    return this.state;
  }

  /**
   * Get failure statistics.
   */
  getStats(): {
    state: CircuitState;
    failureCount: number;
    nextAttempt: number | null;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      nextAttempt: this.state === 'open' ? this.nextAttempt : null,
    };
  }

  /**
   * Manually reset the circuit breaker.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.nextAttempt = 0;
    log.info({ name: this.name }, 'Circuit breaker manually reset');
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}
