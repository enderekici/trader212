import { desc, isNotNull } from 'drizzle-orm';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import { getPairLockManager } from './pair-locks.js';

const log = createLogger('risk-guard');

export interface PortfolioState {
  cashAvailable: number;
  portfolioValue: number;
  openPositions: number;
  todayPnl: number;
  todayPnlPct: number;
  sectorExposure: Record<string, number>;
  sectorExposureValue: Record<string, number>;
  peakValue: number;
}

export interface TradeProposal {
  symbol: string;
  side: 'BUY' | 'SELL';
  shares: number;
  price: number;
  stopLossPct: number;
  positionSizePct: number;
  sector?: string;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

export class RiskGuard {
  validateTrade(proposal: TradeProposal, portfolio: PortfolioState): ValidationResult {
    // Check pair locks before any other validation
    try {
      const lockManager = getPairLockManager();
      const lockResult = lockManager.isPairLocked(proposal.symbol);
      if (lockResult.locked) {
        const reason = `Pair locked: ${lockResult.reason}`;
        log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
        return { allowed: false, reason };
      }
    } catch {
      // Don't let pair lock check failures block trading
      log.debug({ symbol: proposal.symbol }, 'Pair lock check skipped (DB not ready)');
    }

    const maxPositions = configManager.get<number>('risk.maxPositions');
    const maxPositionSizePct = configManager.get<number>('risk.maxPositionSizePct');
    const maxRiskPerTradePct = configManager.get<number>('risk.maxRiskPerTradePct');
    const maxSectorConcentration = configManager.get<number>('risk.maxSectorConcentration');

    // Only validate limits for BUY orders
    if (proposal.side === 'BUY') {
      if (portfolio.openPositions >= maxPositions) {
        const reason = `Max positions reached: ${portfolio.openPositions}/${maxPositions}`;
        log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
        return { allowed: false, reason };
      }

      const positionValue = proposal.shares * proposal.price;
      const maxAllowed = maxPositionSizePct * portfolio.portfolioValue;
      if (positionValue > maxAllowed) {
        const reason = `Position size $${positionValue.toFixed(2)} exceeds max $${maxAllowed.toFixed(2)} (${(maxPositionSizePct * 100).toFixed(1)}% of portfolio)`;
        log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
        return { allowed: false, reason };
      }

      const riskPerTrade = positionValue * proposal.stopLossPct;
      const maxRisk = maxRiskPerTradePct * portfolio.portfolioValue;
      if (riskPerTrade > maxRisk) {
        const reason = `Trade risk $${riskPerTrade.toFixed(2)} exceeds max $${maxRisk.toFixed(2)} (${(maxRiskPerTradePct * 100).toFixed(1)}% of portfolio)`;
        log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
        return { allowed: false, reason };
      }

      if (proposal.sector) {
        const sectorCount = portfolio.sectorExposure[proposal.sector] ?? 0;
        if (sectorCount >= maxSectorConcentration) {
          const reason = `Sector '${proposal.sector}' already has ${sectorCount}/${maxSectorConcentration} positions`;
          log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
          return { allowed: false, reason };
        }

        const sectorValuePct = portfolio.sectorExposureValue[proposal.sector] ?? 0;
        const maxSectorValuePct = configManager.get<number>('risk.maxSectorValuePct');
        if (sectorValuePct >= maxSectorValuePct) {
          const reason = `Sector '${proposal.sector}' value ${(sectorValuePct * 100).toFixed(1)}% exceeds max ${(maxSectorValuePct * 100).toFixed(1)}%`;
          log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
          return { allowed: false, reason };
        }
      }

      if (positionValue > portfolio.cashAvailable) {
        const reason = `Insufficient cash: need $${positionValue.toFixed(2)}, have $${portfolio.cashAvailable.toFixed(2)}`;
        log.warn({ symbol: proposal.symbol, reason }, 'Trade rejected');
        return { allowed: false, reason };
      }
    }

    log.debug({ symbol: proposal.symbol, side: proposal.side }, 'Trade validated');
    return { allowed: true };
  }

  checkDailyLoss(portfolio: PortfolioState): boolean {
    const dailyLossLimitPct = configManager.get<number>('risk.dailyLossLimitPct');
    const shouldPause = portfolio.todayPnlPct < -dailyLossLimitPct;

    if (shouldPause) {
      log.warn(
        { todayPnlPct: portfolio.todayPnlPct, limit: -dailyLossLimitPct },
        'Daily loss limit breached — trading should pause',
      );
    }

    return shouldPause;
  }

  checkDrawdown(portfolio: PortfolioState): boolean {
    const maxDrawdownAlertPct = configManager.get<number>('risk.maxDrawdownAlertPct');

    if (portfolio.peakValue <= 0) return false;

    const drawdown = (portfolio.peakValue - portfolio.portfolioValue) / portfolio.peakValue;
    const shouldAlert = drawdown > maxDrawdownAlertPct;

    if (shouldAlert) {
      log.warn(
        {
          drawdown: `${(drawdown * 100).toFixed(2)}%`,
          limit: `${(maxDrawdownAlertPct * 100).toFixed(1)}%`,
          peakValue: portfolio.peakValue,
          currentValue: portfolio.portfolioValue,
        },
        'Drawdown alert threshold breached',
      );
    }

    return shouldAlert;
  }

  /**
   * Calculates a position size multiplier based on consecutive losing trades.
   * Every `streakReductionThreshold` consecutive losses, the multiplier is reduced
   * by `streakReductionFactor`. For example, with threshold=3 and factor=0.5:
   *   - 0-2 consecutive losses: 1.0 (no reduction)
   *   - 3-5 consecutive losses: 0.5
   *   - 6-8 consecutive losses: 0.25
   *   - etc.
   * Returns 1.0 if no reduction is needed.
   */
  getLosingStreakMultiplier(): number {
    const threshold = configManager.get<number>('risk.streakReductionThreshold');
    const factor = configManager.get<number>('risk.streakReductionFactor');

    if (!threshold || threshold <= 0 || !factor || factor <= 0 || factor >= 1) {
      return 1.0;
    }

    try {
      const db = getDb();

      // Get recent closed trades ordered by exit time descending
      const recentTrades = db
        .select({
          pnl: schema.trades.pnl,
          exitPrice: schema.trades.exitPrice,
          entryPrice: schema.trades.entryPrice,
        })
        .from(schema.trades)
        .where(isNotNull(schema.trades.exitPrice))
        .orderBy(desc(schema.trades.exitTime))
        .limit(100)
        .all();

      if (recentTrades.length === 0) {
        return 1.0;
      }

      // Count consecutive losses from most recent trade
      let consecutiveLosses = 0;
      for (const trade of recentTrades) {
        const isLoss =
          trade.pnl !== null ? trade.pnl < 0 : (trade.exitPrice ?? 0) < trade.entryPrice;
        if (isLoss) {
          consecutiveLosses++;
        } else {
          break;
        }
      }

      if (consecutiveLosses < threshold) {
        return 1.0;
      }

      // Calculate how many full threshold groups of losses
      const streakMultiples = Math.floor(consecutiveLosses / threshold);
      const multiplier = factor ** streakMultiples;

      log.warn(
        { consecutiveLosses, threshold, factor, multiplier },
        'Losing streak detected — reducing position size',
      );

      return multiplier;
    } catch (err) {
      log.error({ err }, 'Failed to compute losing streak multiplier');
      return 1.0;
    }
  }
}
