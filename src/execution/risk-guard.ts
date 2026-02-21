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
    } catch (err) {
      // Fail-closed: if pair lock check fails, block the trade for safety
      log.warn(
        { symbol: proposal.symbol, err },
        'Pair lock check failed — blocking trade for safety',
      );
      return { allowed: false, reason: 'Pair lock check failed — trade blocked for safety' };
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

  /**
   * Graduated loss response instead of binary emergency stop.
   * Returns a response tier indicating the appropriate action:
   *   - 'normal': 0-1% daily loss, no restrictions
   *   - 'reduce': 1-2% daily loss, reduce position size by 50%
   *   - 'pause_day': 2-3% daily loss, pause trading for rest of day
   *   - 'emergency': >3% daily loss, emergency stop
   */
  checkDailyLoss(portfolio: PortfolioState): boolean {
    const response = this.getGraduatedLossResponse(portfolio);
    return response === 'pause_day' || response === 'emergency';
  }

  getGraduatedLossResponse(
    portfolio: PortfolioState,
  ): 'normal' | 'reduce' | 'pause_day' | 'emergency' {
    const lossPct = Math.abs(Math.min(0, portfolio.todayPnlPct));

    if (lossPct > 0.03) {
      log.warn(
        { todayPnlPct: portfolio.todayPnlPct, tier: 'emergency' },
        'Graduated loss: EMERGENCY STOP — daily loss > 3%',
      );
      return 'emergency';
    }
    if (lossPct > 0.02) {
      log.warn(
        { todayPnlPct: portfolio.todayPnlPct, tier: 'pause_day' },
        'Graduated loss: PAUSE DAY — daily loss 2-3%',
      );
      return 'pause_day';
    }
    if (lossPct > 0.01) {
      log.warn(
        { todayPnlPct: portfolio.todayPnlPct, tier: 'reduce' },
        'Graduated loss: REDUCE SIZE 50% — daily loss 1-2%',
      );
      return 'reduce';
    }
    return 'normal';
  }

  /**
   * Weekly loss check — >5% weekly loss triggers emergency stop requiring manual restart.
   */
  checkWeeklyLoss(weeklyPnlPct: number): boolean {
    if (weeklyPnlPct < -0.05) {
      log.warn({ weeklyPnlPct }, 'Weekly loss > 5% — emergency stop, manual restart required');
      return true;
    }
    return false;
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
   * Uses exponential reduction: multiplier = 0.8^streak for streak >= 5.
   * For streaks below 5, uses the configurable threshold/factor system.
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

      // Exponential reduction for long streaks (>=5 consecutive losses)
      let multiplier: number;
      if (consecutiveLosses >= 5) {
        multiplier = 0.8 ** consecutiveLosses;
      } else {
        // Standard threshold-based reduction for shorter streaks
        const streakMultiples = Math.floor(consecutiveLosses / threshold);
        multiplier = factor ** streakMultiples;
      }

      // Floor at 10% to avoid effectively zero position sizes
      multiplier = Math.max(multiplier, 0.1);

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

  /**
   * Get position size multiplier combining graduated daily loss and streak responses.
   */
  getPositionSizeMultiplier(portfolio: PortfolioState): number {
    const streakMult = this.getLosingStreakMultiplier();
    const dailyResponse = this.getGraduatedLossResponse(portfolio);
    const dailyMult = dailyResponse === 'reduce' ? 0.5 : 1.0;
    return streakMult * dailyMult;
  }
}
