import { configManager } from '../config/manager.js';
import type { OHLCVCandle } from '../data/yahoo-finance.js';
import { createLogger } from '../utils/logger.js';
import { scoreTechnicals } from './technical/scorer.js';

const log = createLogger('multi-timeframe');

export interface TimeframeScore {
  timeframe: string;
  score: number;
  signal: 'bullish' | 'bearish' | 'neutral';
  candleCount: number;
}

export interface MultiTimeframeResult {
  compositeScore: number;
  timeframeScores: Record<string, number>;
  alignment: 'bullish' | 'bearish' | 'mixed';
  details: string;
  timeframeDetails: TimeframeScore[];
}

/**
 * Multi-timeframe analyzer that evaluates technical signals across different timeframes
 * and produces a weighted composite score.
 */
export class MultiTimeframeAnalyzer {
  private readonly scoreFn: (candles: OHLCVCandle[]) => number;

  constructor(scoreFn: (candles: OHLCVCandle[]) => number = scoreTechnicals) {
    this.scoreFn = scoreFn;
  }

  /**
   * Analyzes a symbol across multiple timeframes using daily candles as the base.
   * For intraday timeframes (4h, 1h), uses different lookback windows to simulate
   * different timeframe perspectives.
   *
   * @param symbol - Stock symbol
   * @param candles1d - Daily OHLCV candles (should be sorted chronologically)
   * @returns Multi-timeframe analysis result or null if feature disabled
   */
  analyze(symbol: string, candles1d: OHLCVCandle[]): MultiTimeframeResult | null {
    const enabled = configManager.get<boolean>('multiTimeframe.enabled');
    if (!enabled) {
      log.debug({ symbol }, 'Multi-timeframe analysis disabled');
      return null;
    }

    if (!candles1d || candles1d.length === 0) {
      log.warn({ symbol }, 'No candles provided for multi-timeframe analysis');
      return this.createNullResult();
    }

    const timeframes = configManager.get<string[]>('multiTimeframe.timeframes');
    const weights = configManager.get<Record<string, number>>('multiTimeframe.weights');

    if (!timeframes || timeframes.length === 0) {
      log.warn({ symbol }, 'No timeframes configured');
      return this.createNullResult();
    }

    // Normalize weights if they don't sum to 1.0
    const normalizedWeights = this.normalizeWeights(weights, timeframes);

    const timeframeScores: Record<string, number> = {};
    const timeframeDetails: TimeframeScore[] = [];

    for (const tf of timeframes) {
      const candles = this.getTimeframeCandles(candles1d, tf);
      if (candles.length === 0) {
        log.warn({ symbol, timeframe: tf }, 'Insufficient data for timeframe');
        timeframeScores[tf] = 50; // Neutral default
        timeframeDetails.push({
          timeframe: tf,
          score: 50,
          signal: 'neutral',
          candleCount: 0,
        });
        continue;
      }

      const score = this.scoreFn(candles);
      const signal = this.getTimeframeSignal(score);

      timeframeScores[tf] = score;
      timeframeDetails.push({
        timeframe: tf,
        score,
        signal,
        candleCount: candles.length,
      });

      log.debug(
        { symbol, timeframe: tf, score, signal, candleCount: candles.length },
        'Timeframe analysis complete',
      );
    }

    // Compute weighted composite score
    const compositeScore = this.computeCompositeScore(timeframeScores, normalizedWeights);

    // Determine alignment
    const alignment = this.determineAlignment(timeframeDetails);

    // Generate detailed explanation
    const details = this.generateDetails(timeframeDetails, compositeScore, alignment);

    log.info({ symbol, compositeScore, alignment }, 'Multi-timeframe analysis complete');

    return {
      compositeScore: Math.round(compositeScore),
      timeframeScores,
      alignment,
      details,
      timeframeDetails,
    };
  }

  /**
   * Extracts appropriate candles for a given timeframe.
   * For daily: uses all candles directly
   * For 4h: simulates by using recent N candles (representing a shorter perspective)
   * For 1h: uses even fewer candles for very short-term view
   *
   * This is a simplified approach since we only have daily data. In a real implementation
   * with actual intraday data, we'd use the appropriate timeframe candles.
   */
  private getTimeframeCandles(candles: OHLCVCandle[], timeframe: string): OHLCVCandle[] {
    if (candles.length === 0) return [];

    // Parse timeframe (e.g., "1d", "4h", "1h")
    const tfLower = timeframe.toLowerCase();

    // Daily timeframe: use all available candles
    if (tfLower === '1d' || tfLower === 'd' || tfLower === 'day' || tfLower === 'daily') {
      return candles;
    }

    // 4-hour timeframe: simulate with last 20 daily candles (~1 month of trading days)
    if (tfLower === '4h' || tfLower === '4hr') {
      const lookback = 20;
      return candles.slice(Math.max(0, candles.length - lookback));
    }

    // 1-hour timeframe: simulate with last 5 daily candles (~1 week of trading days)
    if (tfLower === '1h' || tfLower === '1hr') {
      const lookback = 5;
      return candles.slice(Math.max(0, candles.length - lookback));
    }

    // Weekly timeframe: use more data
    if (tfLower === '1w' || tfLower === 'w' || tfLower === 'week' || tfLower === 'weekly') {
      // Use all available data for weekly
      return candles;
    }

    // Default: treat unknown timeframes as daily
    log.warn({ timeframe }, 'Unknown timeframe, defaulting to daily');
    return candles;
  }

  /**
   * Maps a technical score (0-100) to a directional signal.
   */
  private getTimeframeSignal(score: number): 'bullish' | 'bearish' | 'neutral' {
    if (score >= 60) return 'bullish';
    if (score <= 40) return 'bearish';
    return 'neutral';
  }

  /**
   * Computes weighted composite score from individual timeframe scores.
   */
  private computeCompositeScore(
    scores: Record<string, number>,
    weights: Record<string, number>,
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const [tf, score] of Object.entries(scores)) {
      const weight = weights[tf] ?? 0;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return 50; // Neutral default

    return weightedSum / totalWeight;
  }

  /**
   * Determines overall alignment based on timeframe signals.
   * If all timeframes agree on direction (all bullish or all bearish), returns that alignment.
   * Otherwise returns 'mixed'.
   */
  private determineAlignment(details: TimeframeScore[]): 'bullish' | 'bearish' | 'mixed' {
    if (details.length === 0) return 'mixed';

    const signals = details.map((d) => d.signal);
    const uniqueSignals = new Set(signals.filter((s) => s !== 'neutral'));

    // If all non-neutral signals are the same, we have alignment
    if (uniqueSignals.size === 0) {
      // All neutral
      return 'mixed';
    }

    if (uniqueSignals.size === 1) {
      const signal = Array.from(uniqueSignals)[0];
      return signal;
    }

    // Mixed signals
    return 'mixed';
  }

  /**
   * Generates a human-readable summary of the multi-timeframe analysis.
   */
  private generateDetails(
    details: TimeframeScore[],
    compositeScore: number,
    alignment: 'bullish' | 'bearish' | 'mixed',
  ): string {
    const lines: string[] = [];

    lines.push(`Composite Score: ${Math.round(compositeScore)}/100 (${alignment})`);
    lines.push('');
    lines.push('Timeframe Breakdown:');

    for (const tf of details) {
      lines.push(`  ${tf.timeframe}: ${tf.score}/100 (${tf.signal}) [${tf.candleCount} candles]`);
    }

    if (alignment === 'bullish') {
      lines.push('');
      lines.push('All timeframes show bullish alignment.');
    } else if (alignment === 'bearish') {
      lines.push('');
      lines.push('All timeframes show bearish alignment.');
    } else {
      lines.push('');
      lines.push('Mixed signals across timeframes - proceed with caution.');
    }

    return lines.join('\n');
  }

  /**
   * Normalizes weights to ensure they sum to 1.0.
   * If weights are missing for some timeframes, distributes evenly.
   */
  private normalizeWeights(
    weights: Record<string, number> | null | undefined,
    timeframes: string[],
  ): Record<string, number> {
    if (!weights || Object.keys(weights).length === 0) {
      // Equal weights for all timeframes
      const equalWeight = 1.0 / timeframes.length;
      const normalized: Record<string, number> = {};
      for (const tf of timeframes) {
        normalized[tf] = equalWeight;
      }
      return normalized;
    }

    // Calculate sum of provided weights
    let sum = 0;
    const normalized: Record<string, number> = {};

    for (const tf of timeframes) {
      const weight = weights[tf] ?? 0;
      normalized[tf] = weight;
      sum += weight;
    }

    // If sum is zero, fall back to equal weights
    if (sum === 0) {
      const equalWeight = 1.0 / timeframes.length;
      for (const tf of timeframes) {
        normalized[tf] = equalWeight;
      }
      return normalized;
    }

    // Normalize to sum to 1.0
    if (Math.abs(sum - 1.0) > 0.01) {
      log.debug({ originalSum: sum }, 'Normalizing weights to sum to 1.0');
      for (const tf of timeframes) {
        normalized[tf] = normalized[tf] / sum;
      }
    }

    return normalized;
  }

  /**
   * Creates a neutral result when analysis cannot be performed.
   */
  private createNullResult(): MultiTimeframeResult {
    return {
      compositeScore: 50,
      timeframeScores: {},
      alignment: 'mixed',
      details: 'Multi-timeframe analysis unavailable',
      timeframeDetails: [],
    };
  }
}

/**
 * Factory function to create a multi-timeframe analyzer.
 */
export function createMultiTimeframeAnalyzer(): MultiTimeframeAnalyzer {
  return new MultiTimeframeAnalyzer();
}
