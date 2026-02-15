import type { TechnicalAnalysis } from '../analysis/technical/scorer.js';
import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('atr-stoploss');

export interface ATRStopLossResult {
  stopLossPrice: number;
  stopLossDistance: number;
  stopLossPct: number;
  method: 'atr' | 'fixed';
  atrValue: number | null;
  atrMultiplier: number | null;
}

/**
 * Calculate stop-loss price using ATR (Average True Range) for volatility-adjusted stops.
 * Falls back to fixed percentage if ATR is unavailable.
 *
 * @param entryPrice - The entry price of the position
 * @param techAnalysis - Technical analysis containing ATR value
 * @param fixedStopLossPct - Fallback fixed percentage (e.g., 0.05 for 5%)
 * @returns Stop-loss calculation result
 */
export function calculateATRStopLoss(
  entryPrice: number,
  techAnalysis: TechnicalAnalysis,
  fixedStopLossPct: number,
): ATRStopLossResult {
  const atrEnabled = configManager.get<boolean>('risk.atrStopLossEnabled') ?? false;
  const atrMultiplier = configManager.get<number>('risk.atrStopLossMultiplier') ?? 2.0;

  // Use ATR if enabled and available
  if (atrEnabled && techAnalysis.atr !== null && techAnalysis.atr > 0) {
    const atrDistance = techAnalysis.atr * atrMultiplier;
    const stopLossPrice = entryPrice - atrDistance;
    const stopLossPct = atrDistance / entryPrice;

    log.debug(
      {
        entryPrice,
        atr: techAnalysis.atr,
        atrMultiplier,
        stopLossPrice,
        stopLossPct,
      },
      'ATR-based stop-loss calculated',
    );

    return {
      stopLossPrice,
      stopLossDistance: atrDistance,
      stopLossPct,
      method: 'atr',
      atrValue: techAnalysis.atr,
      atrMultiplier,
    };
  }

  // Fallback to fixed percentage
  const stopLossDistance = entryPrice * fixedStopLossPct;
  const stopLossPrice = entryPrice - stopLossDistance;

  log.debug(
    {
      entryPrice,
      fixedStopLossPct,
      stopLossPrice,
      reason: !atrEnabled ? 'atr_disabled' : 'atr_unavailable',
    },
    'Fixed percentage stop-loss used',
  );

  return {
    stopLossPrice,
    stopLossDistance,
    stopLossPct: fixedStopLossPct,
    method: 'fixed',
    atrValue: null,
    atrMultiplier: null,
  };
}

/**
 * Get recommended stop-loss percentage based on ATR if available.
 * Useful for AI suggestions and trade planning.
 */
export function getRecommendedStopLossPct(techAnalysis: TechnicalAnalysis): number {
  const atrEnabled = configManager.get<boolean>('risk.atrStopLossEnabled') ?? false;
  const atrMultiplier = configManager.get<number>('risk.atrStopLossMultiplier') ?? 2.0;
  const defaultStopLossPct = configManager.get<number>('risk.defaultStopLossPct') ?? 0.05;

  if (atrEnabled && techAnalysis.atr !== null && techAnalysis.atr > 0) {
    // ATR is absolute price distance, need to estimate percentage
    // We don't have current price here, so we use a conservative estimate
    // based on typical price ranges (ATR / typical_price_estimate)
    // For a stock with ATR of $2 and price of $100, that's 2% per ATR
    // This is approximate - actual calculation happens in calculateATRStopLoss
    const estimatedPct = (techAnalysis.atr * atrMultiplier) / 100; // Rough estimate
    return Math.max(estimatedPct, defaultStopLossPct); // At least default
  }

  return defaultStopLossPct;
}
