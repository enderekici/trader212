import { and, eq, gte, isNotNull } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import { trades } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import { getPairLockManager } from './pair-locks.js';

const log = createLogger('protections');

export class ProtectionManager {
  /**
   * Run all protections after a trade closes.
   * Called with the symbol, exit reason, and realized P&L percentage.
   */
  evaluateAfterClose(symbol: string, exitReason: string, _pnlPct: number): void {
    try {
      this.checkCooldown(symbol);
      this.checkStoplossGuard(symbol, exitReason);
      this.checkMaxDrawdownLock();
      this.checkLowProfitPair(symbol);
    } catch (err) {
      log.error({ symbol, err }, 'Protection evaluation failed');
    }
  }

  /**
   * Check if trading is allowed for a given symbol.
   * Combines pair lock check with any additional protection logic.
   */
  canTrade(symbol: string): { allowed: boolean; reason?: string } {
    const lockManager = getPairLockManager();
    const lockResult = lockManager.isPairLocked(symbol);

    if (lockResult.locked) {
      return { allowed: false, reason: lockResult.reason };
    }

    return { allowed: true };
  }

  // ── Protection: Cooldown Period ──────────────────────────────────────

  /**
   * After closing a trade on a pair, lock that pair for cooldownMinutes.
   */
  private checkCooldown(symbol: string): void {
    const cooldownMinutes = configManager.get<number>('protection.cooldownMinutes');
    if (!cooldownMinutes || cooldownMinutes <= 0) return;

    const lockManager = getPairLockManager();
    lockManager.lockPair(symbol, cooldownMinutes, 'cooldown');

    log.info({ symbol, cooldownMinutes }, 'Cooldown lock applied after trade close');
  }

  // ── Protection: Stoploss Guard ──────────────────────────────────────

  /**
   * Count trades closed by stoploss within the lookback period.
   * If count >= tradeLimit, lock globally or per-pair.
   */
  private checkStoplossGuard(symbol: string, exitReason: string): void {
    const enabled = configManager.get<boolean>('protection.stoplossGuard.enabled');
    if (!enabled) return;

    // Only trigger on stoploss exits
    const lowerReason = exitReason.toLowerCase();
    if (
      !lowerReason.includes('stop') &&
      !lowerReason.includes('stoploss') &&
      !lowerReason.includes('stop-loss') &&
      !lowerReason.includes('stop_loss')
    ) {
      return;
    }

    const tradeLimit = configManager.get<number>('protection.stoplossGuard.tradeLimit');
    const lookbackMinutes = configManager.get<number>('protection.stoplossGuard.lookbackMinutes');
    const lockMinutes = configManager.get<number>('protection.stoplossGuard.lockMinutes');
    const onlyPerPair = configManager.get<boolean>('protection.stoplossGuard.onlyPerPair');

    const cutoff = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
    const db = getDb();

    // Query recent closed trades with exit reasons containing "stop"
    const recentTrades = db
      .select({
        symbol: trades.symbol,
        exitReason: trades.exitReason,
        exitTime: trades.exitTime,
      })
      .from(trades)
      .where(and(isNotNull(trades.exitTime), gte(trades.exitTime, cutoff)))
      .all();

    // Filter to stoploss exits
    const stoplossExits = recentTrades.filter((t) => {
      const reason = (t.exitReason ?? '').toLowerCase();
      return (
        reason.includes('stop') ||
        reason.includes('stoploss') ||
        reason.includes('stop-loss') ||
        reason.includes('stop_loss')
      );
    });

    if (onlyPerPair) {
      // Count only for this specific pair
      const pairStoplossCount = stoplossExits.filter((t) => t.symbol === symbol).length;
      if (pairStoplossCount >= tradeLimit) {
        const lockManager = getPairLockManager();
        lockManager.lockPair(symbol, lockMinutes, 'stoploss_guard');
        log.warn(
          { symbol, stoplossCount: pairStoplossCount, tradeLimit, lockMinutes },
          'Stoploss guard triggered: pair locked',
        );
      }
    } else {
      // Count globally across all pairs
      if (stoplossExits.length >= tradeLimit) {
        const lockManager = getPairLockManager();
        lockManager.lockGlobal(lockMinutes, 'stoploss_guard');
        log.warn(
          { stoplossCount: stoplossExits.length, tradeLimit, lockMinutes },
          'Stoploss guard triggered: global lock',
        );
      }
    }
  }

  // ── Protection: Max Drawdown Lock ───────────────────────────────────

  /**
   * Calculate max drawdown from recent closed trades within lookback.
   * If drawdown > threshold, lock all trading.
   */
  private checkMaxDrawdownLock(): void {
    const enabled = configManager.get<boolean>('protection.maxDrawdownLock.enabled');
    if (!enabled) return;

    const maxDrawdownPct = configManager.get<number>('protection.maxDrawdownLock.maxDrawdownPct');
    const lookbackMinutes = configManager.get<number>('protection.maxDrawdownLock.lookbackMinutes');
    const lockMinutes = configManager.get<number>('protection.maxDrawdownLock.lockMinutes');

    const cutoff = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
    const db = getDb();

    // Get closed trades in the lookback window, ordered by exit time ascending
    const recentTrades = db
      .select({
        pnlPct: trades.pnlPct,
        exitTime: trades.exitTime,
      })
      .from(trades)
      .where(
        and(isNotNull(trades.exitTime), gte(trades.exitTime, cutoff), isNotNull(trades.pnlPct)),
      )
      .all();

    if (recentTrades.length === 0) return;

    // Sort by exit time ascending for sequential drawdown calculation
    recentTrades.sort((a, b) => (a.exitTime ?? '').localeCompare(b.exitTime ?? ''));

    // Calculate cumulative returns and max drawdown
    let cumReturn = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const trade of recentTrades) {
      cumReturn += trade.pnlPct ?? 0;
      if (cumReturn > peak) {
        peak = cumReturn;
      }
      const drawdown = peak - cumReturn;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    if (maxDrawdown >= maxDrawdownPct) {
      const lockManager = getPairLockManager();
      lockManager.lockGlobal(lockMinutes, 'max_drawdown');
      log.warn(
        { maxDrawdown, threshold: maxDrawdownPct, lockMinutes },
        'Max drawdown lock triggered: all trading locked',
      );
    }
  }

  // ── Protection: Low Profit Pairs ────────────────────────────────────

  /**
   * Sum close profits for a pair within lookback.
   * If below threshold and trade count >= tradeLimit, lock the pair.
   */
  private checkLowProfitPair(symbol: string): void {
    const enabled = configManager.get<boolean>('protection.lowProfitPair.enabled');
    if (!enabled) return;

    const minProfit = configManager.get<number>('protection.lowProfitPair.minProfit');
    const tradeLimit = configManager.get<number>('protection.lowProfitPair.tradeLimit');
    const lookbackMinutes = configManager.get<number>('protection.lowProfitPair.lookbackMinutes');
    const lockMinutes = configManager.get<number>('protection.lowProfitPair.lockMinutes');

    const cutoff = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
    const db = getDb();

    // Get closed trades for this specific symbol in the lookback window
    const pairTrades = db
      .select({
        pnlPct: trades.pnlPct,
      })
      .from(trades)
      .where(
        and(
          eq(trades.symbol, symbol),
          isNotNull(trades.exitTime),
          gte(trades.exitTime, cutoff),
          isNotNull(trades.pnlPct),
        ),
      )
      .all();

    if (pairTrades.length < tradeLimit) return;

    const totalProfitPct = pairTrades.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0);

    if (totalProfitPct < minProfit) {
      const lockManager = getPairLockManager();
      lockManager.lockPair(symbol, lockMinutes, 'low_profit');
      log.warn(
        { symbol, totalProfitPct, minProfit, tradeCount: pairTrades.length, lockMinutes },
        'Low profit pair lock triggered',
      );
    }
  }
}

// Singleton
let _protectionManager: ProtectionManager | null = null;

export function getProtectionManager(): ProtectionManager {
  if (!_protectionManager) {
    _protectionManager = new ProtectionManager();
  }
  return _protectionManager;
}
