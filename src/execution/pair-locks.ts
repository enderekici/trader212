import { and, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { pairLocks } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pair-locks');

export interface PairLock {
  id: number;
  symbol: string; // '*' for global
  lockEnd: string; // ISO timestamp
  reason: string | null;
  side: '*' | 'long' | 'short';
  active: boolean;
  createdAt: string;
}

export class PairLockManager {
  /**
   * Lock a specific pair for a given duration.
   */
  lockPair(
    symbol: string,
    durationMinutes: number,
    reason: string,
    side: '*' | 'long' | 'short' = '*',
  ): void {
    const db = getDb();
    const lockEnd = new Date(Date.now() + durationMinutes * 60_000).toISOString();
    const now = new Date().toISOString();

    db.insert(pairLocks)
      .values({
        symbol,
        lockEnd,
        reason,
        side,
        active: true,
        createdAt: now,
      })
      .run();

    log.info({ symbol, durationMinutes, reason, side, lockEnd }, 'Pair locked');
  }

  /**
   * Lock all trading globally for a given duration.
   */
  lockGlobal(durationMinutes: number, reason: string): void {
    this.lockPair('*', durationMinutes, reason, '*');
    log.info({ durationMinutes, reason }, 'Global trading lock activated');
  }

  /**
   * Check whether a given pair is currently locked (also checks global locks).
   */
  isPairLocked(
    symbol: string,
    side: '*' | 'long' | 'short' = '*',
  ): { locked: boolean; reason?: string } {
    const db = getDb();
    const now = new Date().toISOString();

    // Check symbol-specific locks
    const symbolLocks = db
      .select()
      .from(pairLocks)
      .where(
        and(eq(pairLocks.symbol, symbol), eq(pairLocks.active, true), gte(pairLocks.lockEnd, now)),
      )
      .all();

    for (const lock of symbolLocks) {
      if (lock.side === '*' || lock.side === side || side === '*') {
        return { locked: true, reason: lock.reason ?? 'Pair locked' };
      }
    }

    // Check global locks
    const globalLocks = db
      .select()
      .from(pairLocks)
      .where(
        and(eq(pairLocks.symbol, '*'), eq(pairLocks.active, true), gte(pairLocks.lockEnd, now)),
      )
      .all();

    for (const lock of globalLocks) {
      if (lock.side === '*' || lock.side === side || side === '*') {
        return { locked: true, reason: lock.reason ?? 'Global lock active' };
      }
    }

    return { locked: false };
  }

  /**
   * Check whether there is an active global lock.
   */
  isGlobalLocked(): { locked: boolean; reason?: string } {
    const db = getDb();
    const now = new Date().toISOString();

    const globalLocks = db
      .select()
      .from(pairLocks)
      .where(
        and(eq(pairLocks.symbol, '*'), eq(pairLocks.active, true), gte(pairLocks.lockEnd, now)),
      )
      .all();

    if (globalLocks.length > 0) {
      return { locked: true, reason: globalLocks[0].reason ?? 'Global lock active' };
    }

    return { locked: false };
  }

  /**
   * Get all active (unexpired) locks.
   */
  getActiveLocks(): PairLock[] {
    const db = getDb();
    const now = new Date().toISOString();

    return db
      .select()
      .from(pairLocks)
      .where(and(eq(pairLocks.active, true), gte(pairLocks.lockEnd, now)))
      .all() as PairLock[];
  }

  /**
   * Deactivate all locks for a specific symbol.
   */
  unlockPair(symbol: string): void {
    const db = getDb();

    db.update(pairLocks)
      .set({ active: false })
      .where(and(eq(pairLocks.symbol, symbol), eq(pairLocks.active, true)))
      .run();

    log.info({ symbol }, 'Pair unlocked');
  }

  /**
   * Deactivate all expired locks (housekeeping).
   */
  cleanupExpired(): number {
    const db = getDb();
    const now = new Date().toISOString();

    // Find expired but still active locks (lockEnd < now)
    const expired = db
      .select({ id: pairLocks.id })
      .from(pairLocks)
      .where(and(eq(pairLocks.active, true), lte(pairLocks.lockEnd, now)))
      .all();

    if (expired.length === 0) return 0;

    for (const lock of expired) {
      db.update(pairLocks).set({ active: false }).where(eq(pairLocks.id, lock.id)).run();
    }

    log.info({ count: expired.length }, 'Expired pair locks cleaned up');
    return expired.length;
  }
}

// Singleton
let _pairLockManager: PairLockManager | null = null;

export function getPairLockManager(): PairLockManager {
  if (!_pairLockManager) {
    _pairLockManager = new PairLockManager();
  }
  return _pairLockManager;
}
