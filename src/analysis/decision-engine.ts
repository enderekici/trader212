import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('decision-engine');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const DECISION_ENGINE_MODEL_NAME = 'rules-engine';

export interface DecisionContext {
  symbol: string;
  currentPrice: number;
  priceChange1d: number;
  priceChange5d: number;
  priceChange1m: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  avgVolume: number | null;
  technical: {
    rsi: number | null;
    macdValue: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    sma20: number | null;
    sma50: number | null;
    sma200: number | null;
    ema12: number | null;
    ema26: number | null;
    bollingerUpper: number | null;
    bollingerMiddle: number | null;
    bollingerLower: number | null;
    atr: number | null;
    adx: number | null;
    stochasticK: number | null;
    stochasticD: number | null;
    williamsR: number | null;
    mfi: number | null;
    cci: number | null;
    obv: number | null;
    vwap: number | null;
    parabolicSar: number | null;
    roc: number | null;
    forceIndex: number | null;
    volumeRatio: number | null;
    perfWeek: number | null;
    perfMonth: number | null;
    perfQuarter: number | null;
    perfYear: number | null;
    ichimoku: {
      tenkanSen: number;
      kijunSen: number;
      senkouSpanA: number;
      senkouSpanB: number;
      chikouSpan: number;
    } | null;
    adl: number | null;
    awesomeOscillator: number | null;
    support: number | null;
    resistance: number | null;
    candlestickBullish: string | null;
    candlestickBearish: string | null;
    candlestickNeutral: string | null;
    score: number;
  };
  fundamental: {
    peRatio: number | null;
    forwardPE: number | null;
    pegRatio: number | null;
    revenueGrowthYoY: number | null;
    profitMargin: number | null;
    operatingMargin: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    marketCap: number | null;
    sector: string | null;
    beta: number | null;
    dividendYield: number | null;
    industry: string | null;
    earningsSurprise: number | null;
    roe: number | null;
    roa: number | null;
    freeCashflow: number | null;
    analystBuy: number | null;
    analystSell: number | null;
    analystTargetPrice: number | null;
    analystConsensus: string | null;
    analystCount: number | null;
    shortInterestPct: number | null;
    institutionalOwnershipPct: number | null;
    score: number;
  };
  sentiment: {
    headlines: Array<{ title: string; score: number; source: string; relevanceScore?: number }>;
    insiderNetBuying: number;
    daysToEarnings: number | null;
    epsEstimateNextQ: number | null;
    revenueEstimateNextQ: number | null;
    sentimentBreakdown: { positive: number; negative: number; neutral: number } | null;
    topKeywords: string[];
    finraShortVolumePct: number | null;
    score: number;
  };
  historicalSignals: Array<{
    timestamp: string;
    technicalScore: number;
    sentimentScore: number;
    fundamentalScore: number;
    decision: string;
    rsi: number | null;
    macdHistogram: number | null;
  }>;
  portfolio: {
    cashAvailable: number;
    portfolioValue: number;
    openPositions: number;
    maxPositions: number;
    todayPnl: number;
    todayPnlPct: number;
    sectorExposure: Record<string, number>;
    sectorExposureValue: Record<string, number>;
    existingPositions: Array<{
      symbol: string;
      pnlPct: number;
      entryPrice: number;
      currentPrice: number;
      shares: number;
      stopLoss: number | null;
      trailingStop: number | null;
      holdDays: number;
      dcaCount: number;
      partialExitCount: number;
    }>;
  };
  marketContext: {
    spyPrice: number;
    spyChange1d: number;
    vixLevel: number;
    marketTrend: string;
  };
  riskConstraints: {
    maxPositionSizePct: number;
    maxStopLossPct: number;
    minStopLossPct: number;
    maxRiskPerTradePct: number;
    dailyLossLimitPct: number;
  };
  correlationWarnings?: string[];
  portfolioCorrelations?: Array<{
    symbol: string;
    correlation: number;
  }>;
  regime?: {
    regime: string;
    confidence: number;
    spyTrend: string;
    volatilityPctile: number;
    newEntriesAllowed: boolean;
    positionSizeMultiplier: number;
    stopLossMultiplier: number;
    entryThresholdAdjustment: number;
    breadthScore: number;
  };
  multiTimeframe?: {
    compositeScore: number;
    alignment: string;
    timeframeScores: Record<string, number>;
    timeframeDetails: Array<{
      timeframe: string;
      score: number;
      signal: string;
      candleCount: number;
    }>;
  };
  socialSentiment?: {
    overallScore: number;
    buzzScore: number;
    mentionCount: number;
    trendDirection: string;
  };
}

export interface TradeDecision {
  decision: 'BUY' | 'SELL' | 'HOLD';
  conviction: number;
  reasoning: string;
  risks: string[];
  suggestedStopLossPct: number;
  suggestedPositionSizePct: number;
  suggestedTakeProfitPct: number;
  urgency: 'immediate' | 'wait_for_dip' | 'no_rush';
  exitConditions: string;
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

type StrategyType = 'MEAN_REVERSION' | 'TREND_FOLLOWING' | 'MOMENTUM' | 'BREAKOUT';

interface StrategySignal {
  strategy: StrategyType;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  strength: number; // 0-1
  confidence: number; // 0-1
  reasons: string[];
}

interface StrategyWeights {
  MEAN_REVERSION: number;
  TREND_FOLLOWING: number;
  MOMENTUM: number;
  BREAKOUT: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

function getConfigSafe<T>(key: string, defaultValue: T): T {
  try {
    return configManager.get<T>(key);
  } catch {
    return defaultValue;
  }
}

/**
 * Map regime string to strategy weights.
 * In strong trends, favor momentum/trend-following.
 * In sideways markets, favor mean-reversion/breakout.
 */
function getRegimeWeights(regime: string | undefined): StrategyWeights {
  switch (regime) {
    case 'strong_bull':
    case 'strong_bear':
      return { MOMENTUM: 0.4, TREND_FOLLOWING: 0.35, BREAKOUT: 0.2, MEAN_REVERSION: 0.05 };
    case 'bull':
    case 'bear':
      return { TREND_FOLLOWING: 0.4, MOMENTUM: 0.3, BREAKOUT: 0.2, MEAN_REVERSION: 0.1 };
    default:
      return { MEAN_REVERSION: 0.4, BREAKOUT: 0.3, MOMENTUM: 0.2, TREND_FOLLOWING: 0.1 };
  }
}

// ---------------------------------------------------------------------------
// Strategy Scorers
// ---------------------------------------------------------------------------

function scoreMeanReversion(ctx: DecisionContext): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;
  const t = ctx.technical;

  if (t.rsi != null) {
    subSignals++;
    if (t.rsi < 35) {
      longScore += clamp((35 - t.rsi) / 35) * 0.25;
      agreeing++;
      reasons.push(`RSI oversold at ${t.rsi.toFixed(1)}`);
    } else if (t.rsi > 65) {
      shortScore += clamp((t.rsi - 65) / 35) * 0.25;
      agreeing++;
      reasons.push(`RSI overbought at ${t.rsi.toFixed(1)}`);
    }
  }

  if (t.bollingerUpper != null && t.bollingerLower != null) {
    const range = t.bollingerUpper - t.bollingerLower;
    if (range > 0) {
      const percentB = (ctx.currentPrice - t.bollingerLower) / range;
      subSignals++;
      if (percentB < 0) {
        longScore += clamp(-percentB) * 0.25;
        agreeing++;
        reasons.push(`Price below lower BB (%B=${percentB.toFixed(2)})`);
      } else if (percentB > 1) {
        shortScore += clamp(percentB - 1) * 0.25;
        agreeing++;
        reasons.push(`Price above upper BB (%B=${percentB.toFixed(2)})`);
      } else if (percentB < 0.2) {
        longScore += 0.1;
        agreeing++;
        reasons.push(`Price near lower BB (%B=${percentB.toFixed(2)})`);
      } else if (percentB > 0.8) {
        shortScore += 0.1;
        agreeing++;
        reasons.push(`Price near upper BB (%B=${percentB.toFixed(2)})`);
      }
    }
  }

  if (t.stochasticK != null) {
    subSignals++;
    if (t.stochasticK < 20) {
      longScore += clamp((20 - t.stochasticK) / 20) * 0.15;
      agreeing++;
      reasons.push(`Stochastic oversold (%K=${t.stochasticK.toFixed(1)})`);
    } else if (t.stochasticK > 80) {
      shortScore += clamp((t.stochasticK - 80) / 20) * 0.15;
      agreeing++;
      reasons.push(`Stochastic overbought (%K=${t.stochasticK.toFixed(1)})`);
    }
  }

  if (t.williamsR != null) {
    subSignals++;
    if (t.williamsR < -80) {
      longScore += clamp((-80 - t.williamsR) / 20) * 0.15;
      agreeing++;
      reasons.push(`Williams %R oversold (${t.williamsR.toFixed(1)})`);
    } else if (t.williamsR > -20) {
      shortScore += clamp((t.williamsR + 20) / 20) * 0.15;
      agreeing++;
      reasons.push(`Williams %R overbought (${t.williamsR.toFixed(1)})`);
    }
  }

  if (t.cci != null) {
    subSignals++;
    if (t.cci < -100) {
      longScore += clamp((-t.cci - 100) / 200) * 0.2;
      agreeing++;
      reasons.push(`CCI deeply oversold (${t.cci.toFixed(0)})`);
    } else if (t.cci > 100) {
      shortScore += clamp((t.cci - 100) / 200) * 0.2;
      agreeing++;
      reasons.push(`CCI deeply overbought (${t.cci.toFixed(0)})`);
    }
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.03) {
    direction = 'LONG';
    strength = clamp(longScore * 2);
  } else if (netScore < -0.03) {
    direction = 'SHORT';
    strength = clamp(shortScore * 2);
  }

  if (reasons.length === 0) reasons.push('No mean-reversion signals');
  return {
    strategy: 'MEAN_REVERSION',
    direction,
    strength,
    confidence: subSignals > 0 ? clamp(agreeing / subSignals) : 0,
    reasons,
  };
}

function scoreTrendFollowing(ctx: DecisionContext): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;
  const t = ctx.technical;

  if (t.ema12 != null && t.sma50 != null && t.sma200 != null) {
    subSignals++;
    if (t.ema12 > t.sma50 && t.sma50 > t.sma200) {
      longScore += 0.25;
      agreeing++;
      reasons.push('EMA/SMA aligned bullish');
    } else if (t.ema12 < t.sma50 && t.sma50 < t.sma200) {
      shortScore += 0.25;
      agreeing++;
      reasons.push('EMA/SMA aligned bearish');
    }
  }

  if (t.adx != null) {
    subSignals++;
    if (t.adx > 25) {
      const s = clamp((t.adx - 25) / 25);
      if (longScore > shortScore) longScore += s * 0.15;
      else if (shortScore > longScore) shortScore += s * 0.15;
      agreeing++;
      reasons.push(`ADX confirming trend at ${t.adx.toFixed(1)}`);
    }
  }

  if (t.macdHistogram != null && t.macdValue != null && t.macdSignal != null) {
    subSignals++;
    if (t.macdValue > t.macdSignal && t.macdHistogram > 0) {
      const s = clamp(Math.abs(t.macdHistogram) / (Math.abs(t.macdValue) || 1));
      longScore += s * 0.25;
      agreeing++;
      reasons.push(`MACD bullish (hist=${t.macdHistogram.toFixed(3)})`);
    } else if (t.macdValue < t.macdSignal && t.macdHistogram < 0) {
      const s = clamp(Math.abs(t.macdHistogram) / (Math.abs(t.macdValue) || 1));
      shortScore += s * 0.25;
      agreeing++;
      reasons.push(`MACD bearish (hist=${t.macdHistogram.toFixed(3)})`);
    }
  }

  if (t.sma200 != null && t.sma200 > 0) {
    subSignals++;
    const pctFromSma = (ctx.currentPrice - t.sma200) / t.sma200;
    if (pctFromSma > 0) {
      longScore += clamp(pctFromSma * 5) * 0.2;
      agreeing++;
      reasons.push(`Price ${(pctFromSma * 100).toFixed(1)}% above SMA200`);
    } else {
      shortScore += clamp(-pctFromSma * 5) * 0.2;
      agreeing++;
      reasons.push(`Price ${(-pctFromSma * 100).toFixed(1)}% below SMA200`);
    }
  }

  if (t.volumeRatio != null && t.volumeRatio > 1.0) {
    subSignals++;
    const s = clamp((t.volumeRatio - 1.0) / 1.5);
    if (longScore > shortScore) longScore += s * 0.15;
    else shortScore += s * 0.15;
    agreeing++;
    reasons.push(`Volume confirming trend (${t.volumeRatio.toFixed(2)}x)`);
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.05) {
    direction = 'LONG';
    strength = clamp(longScore * 1.8);
  } else if (netScore < -0.05) {
    direction = 'SHORT';
    strength = clamp(shortScore * 1.8);
  }

  if (reasons.length === 0) reasons.push('No trend-following signals');
  return {
    strategy: 'TREND_FOLLOWING',
    direction,
    strength,
    confidence: subSignals > 0 ? clamp(agreeing / subSignals) : 0,
    reasons,
  };
}

function scoreMomentum(ctx: DecisionContext): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;
  const t = ctx.technical;

  if (t.roc != null) {
    subSignals++;
    if (t.roc > 3) {
      longScore += clamp(t.roc / 15) * 0.25;
      agreeing++;
      reasons.push(`Strong positive momentum (ROC=${t.roc.toFixed(1)}%)`);
    } else if (t.roc < -3) {
      shortScore += clamp(-t.roc / 15) * 0.25;
      agreeing++;
      reasons.push(`Strong negative momentum (ROC=${t.roc.toFixed(1)}%)`);
    }
  }

  if (t.rsi != null) {
    subSignals++;
    if (t.rsi >= 50 && t.rsi <= 70) {
      longScore += clamp((t.rsi - 50) / 20) * 0.2;
      agreeing++;
      reasons.push(`RSI in bullish momentum zone (${t.rsi.toFixed(1)})`);
    } else if (t.rsi >= 30 && t.rsi < 50) {
      shortScore += clamp((50 - t.rsi) / 20) * 0.2;
      agreeing++;
      reasons.push(`RSI in bearish momentum zone (${t.rsi.toFixed(1)})`);
    }
  }

  if (t.volumeRatio != null && t.volumeRatio > 1.2) {
    subSignals++;
    const s = clamp((t.volumeRatio - 1.2) / 1.5);
    if (longScore >= shortScore) longScore += s * 0.2;
    else shortScore += s * 0.2;
    agreeing++;
    reasons.push(`Above-average volume (${t.volumeRatio.toFixed(2)}x)`);
  }

  if (t.mfi != null) {
    subSignals++;
    if (t.mfi > 50 && longScore > shortScore) {
      longScore += clamp((t.mfi - 50) / 30) * 0.15;
      agreeing++;
      reasons.push(`MFI confirms buying pressure (${t.mfi.toFixed(1)})`);
    } else if (t.mfi < 50 && shortScore > longScore) {
      shortScore += clamp((50 - t.mfi) / 30) * 0.15;
      agreeing++;
      reasons.push(`MFI confirms selling pressure (${t.mfi.toFixed(1)})`);
    }
  }

  if (t.perfWeek != null && t.perfMonth != null) {
    subSignals++;
    if (t.perfWeek > 1 && t.perfMonth > 3) {
      longScore += clamp((t.perfWeek + t.perfMonth) / 30) * 0.2;
      agreeing++;
      reasons.push(
        `Multi-period positive momentum (1w=${t.perfWeek.toFixed(1)}%, 1m=${t.perfMonth.toFixed(1)}%)`,
      );
    } else if (t.perfWeek < -1 && t.perfMonth < -3) {
      shortScore += clamp((-t.perfWeek + -t.perfMonth) / 30) * 0.2;
      agreeing++;
      reasons.push(
        `Multi-period negative momentum (1w=${t.perfWeek.toFixed(1)}%, 1m=${t.perfMonth.toFixed(1)}%)`,
      );
    }
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.05) {
    direction = 'LONG';
    strength = clamp(longScore * 1.8);
  } else if (netScore < -0.05) {
    direction = 'SHORT';
    strength = clamp(shortScore * 1.8);
  }

  if (reasons.length === 0) reasons.push('No momentum signals');
  return {
    strategy: 'MOMENTUM',
    direction,
    strength,
    confidence: subSignals > 0 ? clamp(agreeing / subSignals) : 0,
    reasons,
  };
}

function scoreBreakout(ctx: DecisionContext): StrategySignal {
  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;
  let subSignals = 0;
  let agreeing = 0;
  const t = ctx.technical;

  if (t.support != null && t.resistance != null && t.resistance > t.support) {
    subSignals++;
    const range = t.resistance - t.support;
    const position = (ctx.currentPrice - t.support) / range;

    if (ctx.currentPrice >= t.resistance) {
      longScore += 0.3;
      agreeing++;
      reasons.push(`Price breaking above resistance ($${t.resistance.toFixed(2)})`);
    } else if (ctx.currentPrice <= t.support) {
      shortScore += 0.3;
      agreeing++;
      reasons.push(`Price breaking below support ($${t.support.toFixed(2)})`);
    } else if (position > 0.9) {
      longScore += 0.15;
      agreeing++;
      reasons.push(`Price near resistance (${(position * 100).toFixed(0)}%)`);
    } else if (position < 0.1) {
      shortScore += 0.15;
      agreeing++;
      reasons.push(`Price near support (${(position * 100).toFixed(0)}%)`);
    }
  }

  if (t.volumeRatio != null && t.volumeRatio > 1.3) {
    subSignals++;
    const s = clamp((t.volumeRatio - 1.3) / 2);
    if (longScore >= shortScore) longScore += s * 0.25;
    else shortScore += s * 0.25;
    agreeing++;
    reasons.push(`Volume surge (${t.volumeRatio.toFixed(2)}x)`);
  }

  if (t.adx != null && t.adx > 20 && t.adx < 40) {
    subSignals++;
    const s = clamp((t.adx - 20) / 20);
    if (longScore >= shortScore) longScore += s * 0.15;
    else shortScore += s * 0.15;
    agreeing++;
    reasons.push(`ADX emerging trend (${t.adx.toFixed(1)})`);
  }

  if (
    t.bollingerUpper != null &&
    t.bollingerLower != null &&
    t.bollingerMiddle != null &&
    t.bollingerMiddle > 0
  ) {
    subSignals++;
    const bandwidth = (t.bollingerUpper - t.bollingerLower) / t.bollingerMiddle;
    if (bandwidth > 0.08) {
      const s = clamp((bandwidth - 0.08) / 0.1);
      if (longScore >= shortScore) longScore += s * 0.15;
      else shortScore += s * 0.15;
      agreeing++;
      reasons.push(`Bollinger bandwidth expanding (${(bandwidth * 100).toFixed(1)}%)`);
    }
  }

  if (t.atr != null && ctx.currentPrice > 0) {
    subSignals++;
    const atrPct = t.atr / ctx.currentPrice;
    if (atrPct > 0.03) {
      const s = clamp((atrPct - 0.03) / 0.05);
      if (longScore >= shortScore) longScore += s * 0.15;
      else shortScore += s * 0.15;
      agreeing++;
      reasons.push(`High ATR volatility (${(atrPct * 100).toFixed(1)}%)`);
    }
  }

  const netScore = longScore - shortScore;
  let direction: StrategySignal['direction'] = 'NEUTRAL';
  let strength = 0;

  if (netScore > 0.03) {
    direction = 'LONG';
    strength = clamp(longScore * 1.6);
  } else if (netScore < -0.03) {
    direction = 'SHORT';
    strength = clamp(shortScore * 1.6);
  }

  if (reasons.length === 0) reasons.push('No breakout signals');
  return {
    strategy: 'BREAKOUT',
    direction,
    strength,
    confidence: subSignals > 0 ? clamp(agreeing / subSignals) : 0,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Fundamental Quality/Value/Growth scoring
// ---------------------------------------------------------------------------

interface FundamentalBucket {
  quality: number; // 0-1
  value: number; // 0-1
  growth: number; // 0-1
  combined: number; // 0-1
}

function scoreFundamentalsStructured(ctx: DecisionContext): FundamentalBucket {
  const f = ctx.fundamental;

  // Quality (35%): profit margin, D/E ratio, current ratio
  let quality = 0.5;
  if (f.profitMargin != null) quality += clamp(f.profitMargin * 2, 0, 0.4) - 0.2;
  if (f.debtToEquity != null) quality += clamp(1 - f.debtToEquity / 2, 0, 0.3) - 0.15;
  if (f.currentRatio != null) quality += clamp((f.currentRatio - 1) / 2, 0, 0.3) - 0.15;
  quality = clamp(quality);

  // Value (35%): P/E, forward P/E
  let value = 0.5;
  if (f.peRatio != null && f.peRatio > 0) value = clamp(1 - (f.peRatio - 10) / 40);
  if (f.forwardPE != null && f.forwardPE > 0) {
    const fwdValue = clamp(1 - (f.forwardPE - 8) / 35);
    value = value * 0.5 + fwdValue * 0.5;
  }

  // Growth (30%): revenue growth
  let growth = 0.5;
  if (f.revenueGrowthYoY != null) growth = clamp(f.revenueGrowthYoY * 2.5 + 0.3);

  const combined = quality * 0.35 + value * 0.35 + growth * 0.3;
  return {
    quality: clamp(quality),
    value: clamp(value),
    growth: clamp(growth),
    combined: clamp(combined),
  };
}

// ---------------------------------------------------------------------------
// Main Decision Engine
// ---------------------------------------------------------------------------

export class DecisionEngine {
  async analyze(context: DecisionContext): Promise<TradeDecision | null> {
    // ── 1. Run all 4 strategies ──────────────────────────────────────
    const signals: StrategySignal[] = [
      scoreMeanReversion(context),
      scoreTrendFollowing(context),
      scoreMomentum(context),
      scoreBreakout(context),
    ];

    // ── 2. Determine regime and get weights ──────────────────────────
    const regimeStr = context.regime?.regime;
    const weights = getRegimeWeights(regimeStr);

    // ── 3. Compute weighted directional score ────────────────────────
    let weightedScore = 0;
    let bestStrategy: StrategyType | null = null;
    let bestWeight = 0;

    for (const sig of signals) {
      const w = weights[sig.strategy];
      const sign = sig.direction === 'LONG' ? 1 : sig.direction === 'SHORT' ? -1 : 0;
      const contribution = sign * sig.strength * sig.confidence * w;
      weightedScore += contribution;

      const absContribution = Math.abs(contribution);
      if (absContribution > bestWeight) {
        bestWeight = absContribution;
        bestStrategy = sig.strategy;
      }
    }

    // ── 4. Apply fundamental modifier (±20%) ─────────────────────────
    const fundBucket = scoreFundamentalsStructured(context);
    const fundamentalModifier = (fundBucket.combined - 0.5) * 0.4;
    let conviction = clamp(Math.abs(weightedScore) + fundamentalModifier);
    const overallDirection = weightedScore > 0 ? 'LONG' : weightedScore < 0 ? 'SHORT' : 'NEUTRAL';

    // ── 5. Volatility risk adjustment ────────────────────────────────
    let riskMultiplier = 1.0;
    if (context.regime) {
      const volPctile = context.regime.volatilityPctile;
      if (volPctile > 90) riskMultiplier = 0.5;
      else if (volPctile > 75) riskMultiplier = 0.75;
      else if (volPctile < 25) riskMultiplier = 1.1;
    }
    conviction = clamp(conviction * riskMultiplier);

    // ── 6. Multi-strategy agreement gate ─────────────────────────────
    const longSignals = signals.filter((s) => s.direction === 'LONG' && s.strength > 0.05);
    const shortSignals = signals.filter((s) => s.direction === 'SHORT' && s.strength > 0.05);
    const strongLong = longSignals.some((s) => s.strength * s.confidence > 0.35);
    const strongShort = shortSignals.some((s) => s.strength * s.confidence > 0.35);

    // ── 7. Make decision ─────────────────────────────────────────────
    let decision: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    const meetsConviction = conviction > 0.38;
    const meetsMultiAgreement = longSignals.length >= 2 || shortSignals.length >= 2;
    const meetsSingleHigh = conviction > 0.3 && (strongLong || strongShort);

    if (
      overallDirection === 'LONG' &&
      meetsConviction &&
      (meetsMultiAgreement || (strongLong && meetsSingleHigh))
    ) {
      decision = 'BUY';
    } else if (
      overallDirection === 'SHORT' &&
      meetsConviction &&
      (meetsMultiAgreement || (strongShort && meetsSingleHigh))
    ) {
      decision = 'SELL';
    }

    // Scale conviction to 0-100
    const convictionPct = Math.round(conviction * 100);

    // ── 8. Stop-loss / take-profit from ATR ──────────────────────────
    const stopLossPct = getConfigSafe<number>('risk.defaultStopLossPct', 0.04);
    const positionSizePct = getConfigSafe<number>('risk.maxPositionSizePct', 0.1);
    const takeProfitPct = getConfigSafe<number>('risk.defaultTakeProfitPct', 0.2);

    let suggestedSL = stopLossPct;
    let suggestedTP = takeProfitPct;
    if (context.technical.atr != null && context.currentPrice > 0) {
      suggestedSL = clamp((2 * context.technical.atr) / context.currentPrice, 0.01, 0.15);
      suggestedTP = clamp((3 * context.technical.atr) / context.currentPrice, 0.02, 0.3);
      if (suggestedTP / suggestedSL < 1.5) suggestedTP = suggestedSL * 1.5;
    }

    // ── 9. Build reasoning ───────────────────────────────────────────
    const strategyReasons = signals
      .filter((s) => s.direction !== 'NEUTRAL')
      .map(
        (s) =>
          `${s.strategy}:${s.direction}(str=${s.strength.toFixed(2)},conf=${s.confidence.toFixed(2)})`,
      )
      .join(' | ');

    const reasoning = [
      `[${decision}] regime=${regimeStr ?? 'unknown'}`,
      `conviction=${convictionPct}%`,
      `riskMult=${riskMultiplier.toFixed(2)}`,
      `fund=${fundBucket.combined.toFixed(2)}(Q=${fundBucket.quality.toFixed(2)}/V=${fundBucket.value.toFixed(2)}/G=${fundBucket.growth.toFixed(2)})`,
      `SL=${(suggestedSL * 100).toFixed(1)}% TP=${(suggestedTP * 100).toFixed(1)}%`,
      bestStrategy ? `best=${bestStrategy}` : '',
      `agree=${longSignals.length}L/${shortSignals.length}S`,
      strategyReasons ? `[${strategyReasons}]` : '',
    ]
      .filter(Boolean)
      .join(' ');

    log.info(
      {
        symbol: context.symbol,
        decision,
        conviction: convictionPct,
        regime: regimeStr,
        best: bestStrategy,
      },
      'Decision engine 4-strategy result',
    );

    return {
      decision,
      conviction: convictionPct,
      reasoning,
      risks: decision === 'BUY' ? ['Rules-based multi-strategy consensus'] : [],
      suggestedStopLossPct: suggestedSL,
      suggestedPositionSizePct: positionSizePct,
      suggestedTakeProfitPct: suggestedTP,
      urgency: 'no_rush',
      exitConditions: '',
    };
  }
}
