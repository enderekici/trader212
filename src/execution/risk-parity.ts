import { configManager } from '../config/manager.js';
import type { OHLCVCandle } from '../data/yahoo-finance.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('risk-parity');

export interface PositionSizeResult {
  shares: number;
  positionSizePct: number;
  symbolVolatility: number;
  reason: string;
}

export interface RebalanceAction {
  symbol: string;
  currentPct: number;
  targetPct: number;
  action: 'increase' | 'decrease' | 'hold';
}

export interface PositionInfo {
  symbol: string;
  shares: number;
  currentPrice: number;
  entryPrice: number;
}

/**
 * Risk Parity Position Sizer
 *
 * Volatility-adjusted position sizing for equal risk contribution across positions.
 * High-volatility stocks get smaller positions; low-volatility stocks get larger positions.
 */
export class RiskParitySizer {
  /**
   * Calculate position size based on risk parity principles.
   *
   * @param symbol Stock symbol
   * @param candles Historical OHLCV data
   * @param portfolioValue Total portfolio value
   * @param openPositions Current open positions
   * @returns Position size in shares, percent, volatility, and reasoning
   */
  calculatePositionSize(
    symbol: string,
    candles: OHLCVCandle[],
    portfolioValue: number,
    openPositions: PositionInfo[],
  ): PositionSizeResult {
    const enabled = configManager.get<boolean>('riskParity.enabled');
    const maxPositionSizePct = configManager.get<number>('risk.maxPositionSizePct');

    if (!enabled) {
      // Fallback to default sizing
      const defaultShares = Math.floor(
        (portfolioValue * maxPositionSizePct) / candles[candles.length - 1].close,
      );
      return {
        shares: defaultShares,
        positionSizePct: maxPositionSizePct,
        symbolVolatility: 0,
        reason: 'Risk parity disabled, using default maxPositionSizePct',
      };
    }

    const targetVolatility = configManager.get<number>('riskParity.targetVolatility');
    const lookbackDays = configManager.get<number>('riskParity.lookbackDays');

    // Compute symbol's annualized volatility
    const symbolVolatility = this.getVolatility(candles, lookbackDays);

    if (symbolVolatility === 0 || Number.isNaN(symbolVolatility)) {
      log.warn({ symbol }, 'Cannot compute volatility, falling back to default sizing');
      const currentPrice = candles[candles.length - 1].close;
      const defaultShares = Math.floor((portfolioValue * maxPositionSizePct) / currentPrice);
      return {
        shares: defaultShares,
        positionSizePct: maxPositionSizePct,
        symbolVolatility: 0,
        reason: 'Insufficient data for volatility calculation',
      };
    }

    // Number of positions (current + this new one)
    const numPositions = openPositions.length + 1;

    // Target contribution per position: targetVol / sqrt(N) for equal risk contribution
    // This is a simplified approach assuming uncorrelated positions
    const targetContributionPerPosition = targetVolatility / Math.sqrt(numPositions);

    // Position size in dollars: (targetContribution * portfolioValue) / symbolVolatility
    let positionSizeDollars = (targetContributionPerPosition * portfolioValue) / symbolVolatility;

    // Apply cap at maxPositionSizePct
    const maxPositionDollars = portfolioValue * maxPositionSizePct;
    let capped = false;
    if (positionSizeDollars > maxPositionDollars) {
      positionSizeDollars = maxPositionDollars;
      capped = true;
    }

    const currentPrice = candles[candles.length - 1].close;
    const shares = Math.floor(positionSizeDollars / currentPrice);
    const actualPositionSizePct = (shares * currentPrice) / portfolioValue;

    const reason = capped
      ? `Risk parity sizing capped at ${(maxPositionSizePct * 100).toFixed(1)}% (symbol vol: ${(symbolVolatility * 100).toFixed(2)}%)`
      : `Risk parity sizing: ${(actualPositionSizePct * 100).toFixed(2)}% (symbol vol: ${(symbolVolatility * 100).toFixed(2)}%)`;

    log.info(
      {
        symbol,
        symbolVolatility: `${(symbolVolatility * 100).toFixed(2)}%`,
        targetContribution: `${(targetContributionPerPosition * 100).toFixed(2)}%`,
        positionSizePct: `${(actualPositionSizePct * 100).toFixed(2)}%`,
        shares,
        capped,
      },
      'Risk parity position size calculated',
    );

    return {
      shares,
      positionSizePct: actualPositionSizePct,
      symbolVolatility,
      reason,
    };
  }

  /**
   * Compute annualized volatility from OHLCV candles.
   *
   * @param candles Historical OHLCV data
   * @param lookbackDays Number of days to look back (default from config)
   * @returns Annualized volatility (e.g., 0.25 = 25% annual volatility)
   */
  getVolatility(candles: OHLCVCandle[], lookbackDays?: number): number {
    if (!candles || candles.length < 2) {
      return 0;
    }

    const lookback = lookbackDays ?? configManager.get<number>('riskParity.lookbackDays');
    const recentCandles = candles.slice(-lookback);

    if (recentCandles.length < 2) {
      return 0;
    }

    // Compute daily returns
    const returns: number[] = [];
    for (let i = 1; i < recentCandles.length; i++) {
      const prevClose = recentCandles[i - 1].close;
      const currClose = recentCandles[i].close;

      if (prevClose === 0) continue;

      const dailyReturn = (currClose - prevClose) / prevClose;
      returns.push(dailyReturn);
    }

    if (returns.length === 0) {
      return 0;
    }

    // Calculate standard deviation of daily returns
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualize: stdDev * sqrt(252 trading days)
    const annualizedVolatility = stdDev * Math.sqrt(252);

    return annualizedVolatility;
  }

  /**
   * Estimate portfolio volatility from individual position volatilities.
   *
   * Simplified approach: sqrt(sum(weight^2 × vol^2)) assuming zero correlation.
   * This is a conservative approximation.
   *
   * @param positionVolatilities Array of { symbol, volatility, weightPct }
   * @returns Estimated portfolio volatility
   */
  getPortfolioVolatility(
    positionVolatilities: Array<{ symbol: string; volatility: number; weightPct: number }>,
  ): number {
    if (!positionVolatilities || positionVolatilities.length === 0) {
      return 0;
    }

    // Portfolio variance = sum(weight^2 × vol^2) under zero correlation assumption
    const variance = positionVolatilities.reduce((sum, pos) => {
      const weight = pos.weightPct; // Already in decimal form (e.g., 0.15)
      return sum + weight ** 2 * pos.volatility ** 2;
    }, 0);

    const portfolioVol = Math.sqrt(variance);
    return portfolioVol;
  }

  /**
   * Suggest position size adjustments to rebalance portfolio risk.
   *
   * @param currentPositions Current open positions with volatility data
   * @param candles Map of symbol to recent candles for re-computing volatility
   * @returns Array of rebalance actions
   */
  suggestRebalance(
    currentPositions: PositionInfo[],
    candles: Map<string, OHLCVCandle[]>,
  ): RebalanceAction[] {
    const enabled = configManager.get<boolean>('riskParity.enabled');

    if (!enabled || currentPositions.length === 0) {
      return [];
    }

    const targetVolatility = configManager.get<number>('riskParity.targetVolatility');
    const numPositions = currentPositions.length;

    // Target contribution per position
    const targetContributionPerPosition = targetVolatility / Math.sqrt(numPositions);

    // Compute total portfolio value
    const totalValue = currentPositions.reduce(
      (sum, pos) => sum + pos.shares * pos.currentPrice,
      0,
    );

    if (totalValue === 0) {
      return [];
    }

    const actions: RebalanceAction[] = [];

    for (const position of currentPositions) {
      const symbolCandles = candles.get(position.symbol);
      if (!symbolCandles || symbolCandles.length < 2) {
        log.warn({ symbol: position.symbol }, 'No candles for rebalance calculation, skipping');
        continue;
      }

      const symbolVolatility = this.getVolatility(symbolCandles);
      if (symbolVolatility === 0 || Number.isNaN(symbolVolatility)) {
        log.warn({ symbol: position.symbol }, 'Invalid volatility, skipping rebalance');
        continue;
      }

      // Current position weight
      const currentValue = position.shares * position.currentPrice;
      const currentPct = currentValue / totalValue;

      // Target position size based on risk parity
      const targetValue = (targetContributionPerPosition * totalValue) / symbolVolatility;
      const targetPct = targetValue / totalValue;

      // Determine action (with 2% threshold to avoid tiny adjustments)
      const deviation = targetPct - currentPct;
      let action: 'increase' | 'decrease' | 'hold';

      if (Math.abs(deviation) < 0.02) {
        action = 'hold';
      } else if (deviation > 0) {
        action = 'increase';
      } else {
        action = 'decrease';
      }

      actions.push({
        symbol: position.symbol,
        currentPct,
        targetPct,
        action,
      });
    }

    return actions;
  }
}

// Singleton instance
let instance: RiskParitySizer | null = null;

export function getRiskParitySizer(): RiskParitySizer {
  if (!instance) {
    instance = new RiskParitySizer();
  }
  return instance;
}
