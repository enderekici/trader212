import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

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
}
