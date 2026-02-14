import type { Candle } from '../backtest/types.js';
import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('regime-detector');

export type MarketRegime =
  | 'trending_up'
  | 'trending_down'
  | 'range_bound'
  | 'high_volatility'
  | 'crash';

export interface RegimeDetails {
  spyTrend: 'up' | 'down' | 'flat';
  vixLevel: number;
  breadthScore: number;
  volatilityPctile: number;
  adjustments: RegimeAdjustments;
}

export interface RegimeAdjustments {
  positionSizeMultiplier: number;
  stopLossMultiplier: number;
  entryThresholdAdjustment: number;
  newEntriesAllowed: boolean;
}

export interface RegimeAnalysis {
  regime: MarketRegime;
  confidence: number;
  details: RegimeDetails;
}

export class RegimeDetector {
  /**
   * Detect current market regime based on SPY candles and optional VIX level
   */
  detect(spyCandles: Candle[], vixLevel?: number): RegimeAnalysis | null {
    const enabled = configManager.get<boolean>('regime.enabled');
    if (!enabled) {
      logger.debug('Regime detection disabled');
      return null;
    }

    const lookbackDays = configManager.get<number>('regime.lookbackDays');
    const vixThresholdHigh = configManager.get<number>('regime.vixThresholdHigh');
    const trendMaLength = configManager.get<number>('regime.trendMaLength');
    const volatilityWindow = configManager.get<number>('regime.volatilityWindow');

    if (spyCandles.length < lookbackDays) {
      logger.warn(
        `Insufficient SPY data for regime detection: ${spyCandles.length} < ${lookbackDays}`,
      );
      return null;
    }

    // Use most recent lookback period
    const recentCandles = spyCandles.slice(-lookbackDays);
    const _currentPrice = recentCandles[recentCandles.length - 1].close;

    // 1. Trend Analysis (SPY vs MA)
    const spyTrend = this.analyzeTrend(recentCandles, trendMaLength);

    // 2. Volatility Analysis
    const volatilityPctile = this.calculateVolatilityPercentile(recentCandles, volatilityWindow);

    // 3. VIX Analysis
    const effectiveVix = vixLevel ?? 15; // Default neutral VIX if not provided
    const isHighVix = effectiveVix > vixThresholdHigh;

    // 4. Crash Detection (SPY down >7% in 5 days + VIX > 30)
    const isCrash = this.detectCrash(recentCandles, effectiveVix);

    // 5. Range-bound Detection (SPY within 3% range over lookback)
    const isRangeBound = this.detectRangeBound(recentCandles);

    // 6. Breadth Score (placeholder - using volatility as proxy)
    const breadthScore = Math.max(0, Math.min(100, 100 - volatilityPctile));

    // Classify regime
    let regime: MarketRegime;
    let confidence: number;

    if (isCrash) {
      regime = 'crash';
      confidence = 0.95;
    } else if (isHighVix && volatilityPctile > 75) {
      regime = 'high_volatility';
      confidence = 0.85;
    } else if (isRangeBound) {
      regime = 'range_bound';
      confidence = 0.75;
    } else if (spyTrend === 'up') {
      regime = 'trending_up';
      confidence = volatilityPctile < 50 ? 0.85 : 0.65;
    } else if (spyTrend === 'down') {
      regime = 'trending_down';
      confidence = volatilityPctile < 50 ? 0.8 : 0.6;
    } else {
      // Flat trend defaults to range-bound
      regime = 'range_bound';
      confidence = 0.65;
    }

    const adjustments = this.getAdjustments(regime);

    const details: RegimeDetails = {
      spyTrend,
      vixLevel: effectiveVix,
      breadthScore,
      volatilityPctile,
      adjustments,
    };

    logger.info(
      {
        regime,
        confidence: `${(confidence * 100).toFixed(1)}%`,
        spyTrend,
        vix: effectiveVix,
        volatilityPctile: volatilityPctile.toFixed(1),
        adjustments,
      },
      `Market regime detected: ${regime}`,
    );

    return {
      regime,
      confidence,
      details,
    };
  }

  /**
   * Analyze trend direction based on price vs moving average
   */
  private analyzeTrend(candles: Candle[], maLength: number): 'up' | 'down' | 'flat' {
    if (candles.length < maLength) {
      return 'flat';
    }

    const recentCandles = candles.slice(-maLength);
    const ma = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
    const currentPrice = candles[candles.length - 1].close;

    const deviation = (currentPrice - ma) / ma;

    if (deviation > 0.02) {
      return 'up';
    }
    if (deviation < -0.02) {
      return 'down';
    }
    return 'flat';
  }

  /**
   * Calculate volatility percentile (0-100)
   */
  private calculateVolatilityPercentile(candles: Candle[], window: number): number {
    if (candles.length < window + 1) {
      return 50; // Neutral if insufficient data
    }

    // Calculate daily returns
    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
      returns.push(ret);
    }

    // Calculate rolling volatility (standard deviation of returns)
    const volatilities: number[] = [];
    for (let i = window; i <= returns.length; i++) {
      const windowReturns = returns.slice(i - window, i);
      const mean = windowReturns.reduce((sum, r) => sum + r, 0) / window;
      const variance = windowReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / window;
      const stdDev = Math.sqrt(variance);
      volatilities.push(stdDev);
    }

    if (volatilities.length === 0) {
      return 50;
    }

    // Current volatility is the most recent
    const currentVol = volatilities[volatilities.length - 1];

    // Calculate percentile
    const sorted = [...volatilities].sort((a, b) => a - b);
    const rank = sorted.filter((v) => v <= currentVol).length;
    const percentile = (rank / sorted.length) * 100;

    return percentile;
  }

  /**
   * Detect crash scenario: SPY down >7% in 5 days + VIX > 30
   */
  private detectCrash(candles: Candle[], vixLevel: number): boolean {
    if (candles.length < 6) {
      return false;
    }

    // Look at last 5 days (need 6 candles to have 5 days of change)
    const recent6 = candles.slice(-6);
    const startPrice = recent6[0].close;
    const endPrice = recent6[recent6.length - 1].close;
    const pctChange = (endPrice - startPrice) / startPrice;

    const spyDropped = pctChange <= -0.07; // Down 7% or more
    const vixElevated = vixLevel > 30;

    return spyDropped && vixElevated;
  }

  /**
   * Detect range-bound market: SPY within 3% range over lookback period
   */
  private detectRangeBound(candles: Candle[]): boolean {
    if (candles.length < 10) {
      return false;
    }

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const periodHigh = Math.max(...highs);
    const periodLow = Math.min(...lows);

    const range = (periodHigh - periodLow) / periodLow;

    // Range-bound if trading within 3% range
    return range < 0.03;
  }

  /**
   * Get parameter adjustments for a given regime
   */
  getAdjustments(regime: MarketRegime): RegimeAdjustments {
    switch (regime) {
      case 'trending_up':
        return {
          positionSizeMultiplier: 1.0,
          stopLossMultiplier: 1.0,
          entryThresholdAdjustment: 0,
          newEntriesAllowed: true,
        };

      case 'trending_down':
        return {
          positionSizeMultiplier: 0.5,
          stopLossMultiplier: 0.8,
          entryThresholdAdjustment: 10, // Require higher conviction
          newEntriesAllowed: true,
        };

      case 'range_bound':
        return {
          positionSizeMultiplier: 0.7,
          stopLossMultiplier: 0.7,
          entryThresholdAdjustment: 5,
          newEntriesAllowed: true,
        };

      case 'high_volatility':
        return {
          positionSizeMultiplier: 0.4,
          stopLossMultiplier: 1.5,
          entryThresholdAdjustment: 15,
          newEntriesAllowed: true,
        };

      case 'crash':
        return {
          positionSizeMultiplier: 0.0,
          stopLossMultiplier: 1.0,
          entryThresholdAdjustment: 100, // Effectively block
          newEntriesAllowed: false,
        };
    }
  }

  /**
   * Get human-readable label for regime
   */
  getRegimeLabel(regime: MarketRegime): string {
    switch (regime) {
      case 'trending_up':
        return 'Trending Up - Bull Market';
      case 'trending_down':
        return 'Trending Down - Bear Market';
      case 'range_bound':
        return 'Range-Bound - Sideways Market';
      case 'high_volatility':
        return 'High Volatility - Choppy Market';
      case 'crash':
        return 'Market Crash - Risk-Off Mode';
    }
  }
}

// Singleton instance
let instance: RegimeDetector | null = null;

export function getRegimeDetector(): RegimeDetector {
  if (!instance) {
    instance = new RegimeDetector();
    logger.info('RegimeDetector singleton initialized');
  }
  return instance;
}
