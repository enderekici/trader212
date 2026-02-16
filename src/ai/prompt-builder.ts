import type { RegimeAnalysis } from '../analysis/regime-detector.js';
import { configManager } from '../config/manager.js';
import type { MarketContext } from '../data/yahoo-finance.js';
import type { AIContext } from './agent.js';
import type { ResearchSymbolData } from './market-research.js';

function fmt(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(decimals);
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

function fmtLarge(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(0)}`;
}

function buildWebResearchSection(context: AIContext): string {
  const w = context.webResearch;
  if (!w) return '';

  const hasAnyData =
    w.pegRatio !== null ||
    w.analystTargetPrice !== null ||
    w.analystConsensus !== null ||
    w.shortInterestPct !== null ||
    w.institutionalOwnershipPct !== null ||
    w.epsEstimateNextQ !== null ||
    w.revenueEstimateNextQ !== null ||
    w.perfWeek !== null ||
    w.perfMonth !== null ||
    w.perfQuarter !== null ||
    w.perfYear !== null;

  if (!hasAnyData) return '';

  const lines: string[] = ['ANALYST & WEB RESEARCH DATA:'];

  if (w.pegRatio !== null) lines.push(`- PEG Ratio: ${w.pegRatio.toFixed(2)}`);
  if (w.analystTargetPrice !== null) {
    const currentPrice = context.currentPrice;
    const upside =
      currentPrice > 0 ? ((w.analystTargetPrice - currentPrice) / currentPrice) * 100 : 0;
    lines.push(
      `- Analyst Target Price: $${w.analystTargetPrice.toFixed(2)} (${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%)`,
    );
  }
  if (w.analystConsensus !== null) {
    const countStr = w.analystCount !== null ? ` (${w.analystCount} analysts)` : '';
    lines.push(`- Analyst Consensus: ${w.analystConsensus}${countStr}`);
  }
  if (w.shortInterestPct !== null)
    lines.push(`- Short Interest: ${(w.shortInterestPct * 100).toFixed(1)}%`);
  if (w.institutionalOwnershipPct !== null)
    lines.push(`- Institutional Ownership: ${(w.institutionalOwnershipPct * 100).toFixed(1)}%`);
  if (w.epsEstimateNextQ !== null)
    lines.push(`- EPS Estimate (next Q): $${w.epsEstimateNextQ.toFixed(2)}`);
  if (w.revenueEstimateNextQ !== null) {
    const revStr =
      w.revenueEstimateNextQ >= 1e9
        ? `$${(w.revenueEstimateNextQ / 1e9).toFixed(1)}B`
        : w.revenueEstimateNextQ >= 1e6
          ? `$${(w.revenueEstimateNextQ / 1e6).toFixed(1)}M`
          : `$${w.revenueEstimateNextQ.toFixed(0)}`;
    lines.push(`- Revenue Estimate (next Q): ${revStr}`);
  }

  // Performance line
  const perfParts: string[] = [];
  if (w.perfWeek !== null)
    perfParts.push(`1W ${(w.perfWeek * 100) >= 0 ? '+' : ''}${(w.perfWeek * 100).toFixed(1)}%`);
  if (w.perfMonth !== null)
    perfParts.push(`1M ${(w.perfMonth * 100) >= 0 ? '+' : ''}${(w.perfMonth * 100).toFixed(1)}%`);
  if (w.perfQuarter !== null)
    perfParts.push(
      `1Q ${(w.perfQuarter * 100) >= 0 ? '+' : ''}${(w.perfQuarter * 100).toFixed(1)}%`,
    );
  if (w.perfYear !== null)
    perfParts.push(`1Y ${(w.perfYear * 100) >= 0 ? '+' : ''}${(w.perfYear * 100).toFixed(1)}%`);
  if (perfParts.length > 0) lines.push(`- Performance: ${perfParts.join(' | ')}`);

  // Volume data
  if (w.relativeVolume != null) lines.push(`- Relative Volume: ${w.relativeVolume.toFixed(2)}x`);
  if (w.averageVolume != null) lines.push(`- Average Volume: ${fmtLarge(w.averageVolume)}`);

  return `${lines.join('\n')}\n\n`;
}

function buildRegimeSection(context: AIContext): string {
  const rg = context.regime;
  if (!rg) return '';

  const regimeLabels: Record<string, string> = {
    trending_up: 'Trending Up (Bull)',
    trending_down: 'Trending Down (Bear)',
    range_bound: 'Range-Bound (Sideways)',
    high_volatility: 'High Volatility (Choppy)',
    crash: 'Market Crash (Risk-Off)',
  };

  const lines = [
    '\nMARKET REGIME:',
    `- Regime: ${regimeLabels[rg.regime] ?? rg.regime} (${(rg.confidence * 100).toFixed(0)}% confidence)`,
    `- SPY Trend: ${rg.spyTrend}`,
    `- Volatility Percentile: ${rg.volatilityPctile.toFixed(0)}th`,
    `- New Entries Allowed: ${rg.newEntriesAllowed ? 'Yes' : 'NO — regime blocks new positions'}`,
    `- Position Size Multiplier: ${rg.positionSizeMultiplier.toFixed(1)}x`,
  ];
  return `${lines.join('\n')}\n`;
}

function buildMultiTimeframeSection(context: AIContext): string {
  const mt = context.multiTimeframe;
  if (!mt) return '';

  const tfLines = Object.entries(mt.timeframeScores)
    .map(([tf, score]) => `  ${tf}: ${score}/100`)
    .join(' | ');

  const lines = [
    '\nMULTI-TIMEFRAME ANALYSIS:',
    `- Composite Score: ${mt.compositeScore}/100`,
    `- Alignment: ${mt.alignment}${mt.alignment === 'mixed' ? ' — CAUTION: conflicting timeframe signals' : ''}`,
    `- Scores: ${tfLines}`,
  ];
  return `${lines.join('\n')}\n`;
}

function buildSocialSentimentSection(context: AIContext): string {
  const ss = context.socialSentiment;
  if (!ss) return '';

  const scoreLabel =
    ss.overallScore > 0.2 ? 'bullish' : ss.overallScore < -0.2 ? 'bearish' : 'neutral';
  const lines = [
    '\nSOCIAL SENTIMENT:',
    `- Overall: ${ss.overallScore.toFixed(2)} (${scoreLabel})`,
    `- Buzz Score: ${ss.buzzScore.toFixed(0)}/100 (${ss.mentionCount} mentions)`,
    `- Trend: ${ss.trendDirection}`,
  ];
  return `${lines.join('\n')}\n`;
}

export function buildAnalysisPrompt(context: AIContext): {
  system: string;
  user: string;
} {
  const system = `You are an expert stock trading analyst with deep knowledge of technical analysis, fundamental analysis, and market sentiment. Your job is to analyze comprehensive market data and make a trading decision.

You must consider:
- Technical indicators and their confluence
- Fundamental valuation metrics
- News sentiment and insider activity
- Current portfolio state and risk constraints
- Historical signal context for trend consistency
- Market-wide conditions (SPY trend, VIX level)
- Market regime (if provided) - adjust aggressiveness accordingly
- Multi-timeframe alignment (if provided) - divergence across timeframes is a warning sign
- Social sentiment (if provided) - high buzz with rising sentiment may indicate retail-driven momentum

Be conservative with position sizing. Prefer HOLD when signals are mixed or unclear.
Only recommend BUY with strong conviction when multiple indicators align.
Always respect risk constraints provided.

Respond ONLY with valid JSON matching the exact schema provided. No additional text, explanations, or markdown outside the JSON.`;

  const t = context.technical;
  const f = context.fundamental;
  const s = context.sentiment;
  const p = context.portfolio;
  const m = context.marketContext;
  const r = context.riskConstraints;

  const headlines = s.headlines
    .map((h) => `  - [${h.score > 0 ? '+' : ''}${h.score.toFixed(2)}] "${h.title}" (${h.source})`)
    .join('\n');

  const positions = p.existingPositions
    .map((pos) => {
      const pnlStr = `${pos.pnlPct >= 0 ? '+' : ''}${fmtPct(pos.pnlPct)}`;
      const stopStr = pos.trailingStop
        ? `trailing $${fmt(pos.trailingStop)}`
        : pos.stopLoss
          ? `stop $${fmt(pos.stopLoss)}`
          : 'no stop';
      const extras: string[] = [];
      if (pos.dcaCount > 0) extras.push(`DCA×${pos.dcaCount}`);
      if (pos.partialExitCount > 0) extras.push(`partial-exit×${pos.partialExitCount}`);
      const extrasStr = extras.length > 0 ? ` [${extras.join(', ')}]` : '';
      return `  - ${pos.symbol}: ${pos.shares} shares @ $${fmt(pos.entryPrice)} → $${fmt(pos.currentPrice)} (${pnlStr}) | ${stopStr} | ${pos.holdDays}d held${extrasStr}`;
    })
    .join('\n');

  const sectorExposureLines: string[] = [];
  for (const [sector, count] of Object.entries(p.sectorExposure)) {
    const valuePct = p.sectorExposureValue[sector];
    const valuePctStr =
      valuePct !== undefined ? ` (${(valuePct * 100).toFixed(1)}% of portfolio)` : '';
    sectorExposureLines.push(`  - ${sector}: ${count} position(s)${valuePctStr}`);
  }
  const sectorExposure = sectorExposureLines.join('\n');

  const historicalSignals =
    context.historicalSignals.length > 0
      ? context.historicalSignals
          .slice(0, 3) // Limit to reduce anchoring
          .map(
            (sig) =>
              `  [${sig.timestamp}] Tech: ${sig.technicalScore.toFixed(0)} | Sent: ${sig.sentimentScore.toFixed(0)} | Fund: ${sig.fundamentalScore.toFixed(0)} | RSI: ${fmt(sig.rsi)} | MACD-H: ${fmt(sig.macdHistogram)}`,
          )
          .join('\n')
      : '';

  const correlationWarnings = context.correlationWarnings ?? [];
  const portfolioCorrelations = context.portfolioCorrelations ?? [];

  const correlationLabel = (corr: number): string => {
    const abs = Math.abs(corr);
    if (abs >= 0.7) return 'high';
    if (abs >= 0.4) return 'moderate';
    return 'low';
  };

  const correlationLines =
    portfolioCorrelations.length > 0
      ? portfolioCorrelations
          .map(
            (c) =>
              `  - ${c.symbol}: ${c.correlation.toFixed(2)} (${correlationLabel(c.correlation)})`,
          )
          .join('\n')
      : '';

  const correlationSection =
    correlationLines || correlationWarnings.length > 0
      ? `\n${
          correlationLines
            ? `PORTFOLIO CORRELATIONS:\n${correlationLines}\nHigh correlation (>0.7) means this stock moves similarly to existing positions, increasing portfolio risk. Negative correlation indicates inverse movement.\n`
            : ''
        }${
          correlationWarnings.length > 0
            ? `CORRELATION WARNINGS:\n${correlationWarnings.map((w) => `- ${w}`).join('\n')}\n`
            : ''
        }`
      : '';

  const user = `=== CURRENT ANALYSIS FOR ${context.symbol} ===

PRICE DATA:
- Current Price: $${fmt(context.currentPrice)}
- 1-Day Change: ${fmtPct(context.priceChange1d)}
- 5-Day Change: ${fmtPct(context.priceChange5d)}
- 1-Month Change: ${fmtPct(context.priceChange1m)}

TECHNICAL INDICATORS (Composite Score: ${t.score.toFixed(0)}/100):
- RSI(14): ${fmt(t.rsi)}
- MACD: Value ${fmt(t.macdValue, 4)} | Signal ${fmt(t.macdSignal, 4)} | Histogram ${fmt(t.macdHistogram, 4)}
- SMA: 20-day ${fmt(t.sma20)} | 50-day ${fmt(t.sma50)} | 200-day ${fmt(t.sma200)}
- EMA: 12-day ${fmt(t.ema12)} | 26-day ${fmt(t.ema26)}
- Bollinger Bands: Upper ${fmt(t.bollingerUpper)} | Middle ${fmt(t.bollingerMiddle)} | Lower ${fmt(t.bollingerLower)}
- ATR(14): ${fmt(t.atr)}
- ADX(14): ${fmt(t.adx)}
- Stochastic: K ${fmt(t.stochasticK)} | D ${fmt(t.stochasticD)}
- Williams %R: ${fmt(t.williamsR)}
- MFI(14): ${fmt(t.mfi)}
- CCI(20): ${fmt(t.cci)}
- OBV: ${fmt(t.obv, 0)}
- VWAP: ${fmt(t.vwap)}
- Parabolic SAR: ${fmt(t.parabolicSar)}
- ROC(12): ${fmt(t.roc)}
- Force Index: ${fmt(t.forceIndex, 0)}
- Volume Ratio (vs 20d avg): ${fmt(t.volumeRatio)}
- Support Level: ${fmt(t.support)}
- Resistance Level: ${fmt(t.resistance)}

FUNDAMENTAL METRICS (Composite Score: ${f.score.toFixed(0)}/100):
- P/E Ratio: ${fmt(f.peRatio)}
- Forward P/E: ${fmt(f.forwardPE)}
- Revenue Growth YoY: ${fmtPct(f.revenueGrowthYoY)}
- Profit Margin: ${fmtPct(f.profitMargin)}
- Operating Margin: ${fmtPct(f.operatingMargin)}
- Debt/Equity: ${fmt(f.debtToEquity)}
- Current Ratio: ${fmt(f.currentRatio)}
- Market Cap: ${fmtLarge(f.marketCap)}
- Sector: ${f.sector || 'N/A'}
- Beta: ${fmt(f.beta)}
- Dividend Yield: ${fmtPct(f.dividendYield)}

${buildWebResearchSection(context)}NEWS SENTIMENT (Composite Score: ${s.score.toFixed(0)}/100):
Headlines:
${headlines || '  (no recent headlines)'}
- Insider Net Buying: ${s.insiderNetBuying > 0 ? '+' : ''}${s.insiderNetBuying} transactions
- Days to Earnings: ${s.daysToEarnings !== null ? s.daysToEarnings : 'N/A'}

HISTORICAL CONTEXT (recent signals):
${historicalSignals || '  (no prior signals)'}

MARKET CONDITIONS:
- SPY Price: $${fmt(m.spyPrice)}
- SPY 1-Day Change: ${fmtPct(m.spyChange1d)}
- VIX Level: ${fmt(m.vixLevel)}
- Market Trend: ${m.marketTrend}
${buildRegimeSection(context)}${buildMultiTimeframeSection(context)}${buildSocialSentimentSection(context)}
PORTFOLIO STATE:
- Cash Available: $${fmt(p.cashAvailable)}
- Portfolio Value: $${fmt(p.portfolioValue)}
- Open Positions: ${p.openPositions} / ${p.maxPositions}
- Today P&L: $${fmt(p.todayPnl)} (${fmtPct(p.todayPnlPct)})
- Sector Exposure:
${sectorExposure || '  (none)'}
- Existing Positions:
${positions || '  (none)'}
${correlationSection}
RISK CONSTRAINTS:
- Max Position Size: ${fmtPct(r.maxPositionSizePct)} of portfolio
- Stop-Loss Range: ${fmtPct(r.minStopLossPct)} to ${fmtPct(r.maxStopLossPct)}
- Max Risk Per Trade: ${fmtPct(r.maxRiskPerTradePct)} of portfolio
- Daily Loss Limit: ${fmtPct(r.dailyLossLimitPct)} of portfolio

Respond with JSON:
{
  "decision": "BUY | SELL | HOLD",
  "conviction": 0-100,
  "reasoning": "2-3 sentence explanation",
  "risks": ["risk1", "risk2"],
  "suggestedStopLossPct": 0.01-0.10,
  "suggestedPositionSizePct": 0.03-0.15,
  "suggestedTakeProfitPct": 0.05-0.30,
  "urgency": "immediate | wait_for_dip | no_rush",
  "exitConditions": "specific conditions to exit"
}`;

  return { system, user };
}

// ── Research Data Prompt ─────────────────────────────────────────────────────

function buildMarketSection(
  marketCtx: MarketContext | null,
  regime: RegimeAnalysis | null,
): string {
  if (!marketCtx && !regime) return '';

  const lines: string[] = ['MARKET CONDITIONS:'];
  if (marketCtx) {
    lines.push(
      `- SPY: $${fmt(marketCtx.spyPrice)} (${fmtPct(marketCtx.spyChange1d ? marketCtx.spyChange1d / 100 : null)})`,
    );
    lines.push(`- VIX: ${fmt(marketCtx.vixLevel)}`);
    lines.push(`- Trend: ${marketCtx.marketTrend}`);
  }
  if (regime) {
    const regimeLabels: Record<string, string> = {
      trending_up: 'Trending Up (Bull)',
      trending_down: 'Trending Down (Bear)',
      range_bound: 'Range-Bound',
      high_volatility: 'High Volatility',
      crash: 'Crash (Risk-Off)',
    };
    lines.push(
      `- Regime: ${regimeLabels[regime.regime] ?? regime.regime} (${(regime.confidence * 100).toFixed(0)}% conf)`,
    );
  }
  return `${lines.join('\n')}\n\n`;
}

function buildDetailedSymbol(sym: string, d: ResearchSymbolData): string {
  const lines: string[] = [`=== ${sym} ===`];

  // Price
  lines.push(
    `Price: $${fmt(d.price)} | 1d: ${d.change1dPct >= 0 ? '+' : ''}${d.change1dPct.toFixed(2)}% | 5d: ${d.change5dPct !== null ? `${d.change5dPct >= 0 ? '+' : ''}${d.change5dPct.toFixed(2)}%` : 'N/A'} | 1m: ${d.change1mPct !== null ? `${d.change1mPct >= 0 ? '+' : ''}${d.change1mPct.toFixed(2)}%` : 'N/A'}`,
  );
  if (d.sector) lines.push(`Sector: ${d.sector} | MCap: ${fmtLarge(d.marketCap)}`);

  // Technical
  if (d.technical) {
    const t = d.technical;
    lines.push(`\nTECHNICAL (Score: ${t.score}/100):`);
    lines.push(
      `- RSI(14): ${fmt(t.rsi)} | MACD-H: ${fmt(t.macd?.histogram, 4)} | ADX: ${fmt(t.adx)}`,
    );
    lines.push(`- SMA: 20d ${fmt(t.sma20)} | 50d ${fmt(t.sma50)} | 200d ${fmt(t.sma200)}`);
    lines.push(`- EMA: 12d ${fmt(t.ema12)} | 26d ${fmt(t.ema26)}`);
    lines.push(
      `- Bollinger: U ${fmt(t.bollinger?.upper)} | M ${fmt(t.bollinger?.middle)} | L ${fmt(t.bollinger?.lower)}`,
    );
    lines.push(`- ATR: ${fmt(t.atr)} | Stoch K/D: ${fmt(t.stochastic?.k)}/${fmt(t.stochastic?.d)}`);
    lines.push(`- Williams %R: ${fmt(t.williamsR)} | MFI: ${fmt(t.mfi)} | CCI: ${fmt(t.cci)}`);
    lines.push(`- OBV: ${fmt(t.obv, 0)} | VWAP: ${fmt(t.vwap)} | Vol Ratio: ${fmt(t.volumeRatio)}`);
    lines.push(
      `- SAR: ${fmt(t.parabolicSar)} | ROC: ${fmt(t.roc)} | Force: ${fmt(t.forceIndex, 0)}`,
    );
    lines.push(
      `- Support: ${fmt(t.supportResistance?.support)} | Resistance: ${fmt(t.supportResistance?.resistance)}`,
    );
  }

  // Fundamental
  if (d.fundamentals) {
    const f = d.fundamentals;
    lines.push(`\nFUNDAMENTAL (Score: ${d.fundamentalScore}/100):`);
    lines.push(
      `- P/E: ${fmt(f.peRatio)} | Fwd P/E: ${fmt(f.forwardPE)} | Growth: ${fmtPct(f.revenueGrowthYoY)}`,
    );
    lines.push(`- Margin: ${fmtPct(f.profitMargin)} (op: ${fmtPct(f.operatingMargin)})`);
    lines.push(
      `- D/E: ${fmt(f.debtToEquity)} | Current: ${fmt(f.currentRatio)} | Beta: ${fmt(f.beta)}`,
    );
    lines.push(
      `- Div Yield: ${fmtPct(f.dividendYield)} | Earnings Surprise: ${fmt(f.earningsSurprise)}`,
    );
  }

  // Sentiment
  lines.push(`\nSENTIMENT (Score: ${d.sentimentScore}/100):`);
  if (d.headlines.length > 0) {
    for (const h of d.headlines.slice(0, 5)) {
      lines.push(`- [${h.score > 0 ? '+' : ''}${h.score.toFixed(2)}] "${h.title}" (${h.source})`);
    }
  } else {
    lines.push('- (no recent headlines)');
  }
  lines.push(`- Insider Net Buying: ${d.insiderNetBuying > 0 ? '+' : ''}${d.insiderNetBuying}`);
  lines.push(`- Days to Earnings: ${d.daysToEarnings !== null ? d.daysToEarnings : 'N/A'}`);

  return lines.join('\n');
}

function buildCondensedSymbol(sym: string, d: ResearchSymbolData): string {
  const lines: string[] = [`--- ${sym} ---`];

  // Price line
  lines.push(
    `$${fmt(d.price)} | 1d: ${d.change1dPct >= 0 ? '+' : ''}${d.change1dPct.toFixed(2)}% | 5d: ${d.change5dPct !== null ? `${d.change5dPct >= 0 ? '+' : ''}${d.change5dPct.toFixed(2)}%` : 'N/A'} | 1m: ${d.change1mPct !== null ? `${d.change1mPct >= 0 ? '+' : ''}${d.change1mPct.toFixed(2)}%` : 'N/A'}`,
  );
  if (d.sector) lines.push(`${d.sector} | MCap: ${fmtLarge(d.marketCap)}`);

  // Key technicals (6 indicators)
  if (d.technical) {
    const t = d.technical;
    lines.push(
      `Tech(${t.score}): RSI ${fmt(t.rsi)} | MACD-H ${fmt(t.macd?.histogram, 4)} | ADX ${fmt(t.adx)} | SMA50 ${fmt(t.sma50)} | ATR ${fmt(t.atr)} | VolR ${fmt(t.volumeRatio)}`,
    );
  }

  // Key fundamentals (5 metrics)
  if (d.fundamentals) {
    const f = d.fundamentals;
    lines.push(
      `Fund(${d.fundamentalScore}): P/E ${fmt(f.peRatio)} | FwdPE ${fmt(f.forwardPE)} | Growth ${fmtPct(f.revenueGrowthYoY)} | Margin ${fmtPct(f.profitMargin)} | D/E ${fmt(f.debtToEquity)}`,
    );
  }

  // Top 3 headlines + earnings
  const sentParts = [`Sent(${d.sentimentScore})`];
  if (d.headlines.length > 0) {
    sentParts.push(
      d.headlines
        .slice(0, 3)
        .map((h) => `"${h.title.slice(0, 60)}"`)
        .join(' | '),
    );
  }
  if (d.daysToEarnings !== null) sentParts.push(`Earnings: ${d.daysToEarnings}d`);
  if (d.insiderNetBuying !== 0)
    sentParts.push(`Insider: ${d.insiderNetBuying > 0 ? '+' : ''}${d.insiderNetBuying}`);
  lines.push(sentParts.join(' | '));

  return lines.join('\n');
}

export function buildResearchDataPrompt(
  symbolData: Map<string, ResearchSymbolData>,
  marketCtx?: MarketContext | null,
  regime?: RegimeAnalysis | null,
): string {
  const threshold = configManager.get<number>('ai.research.detailedThreshold') ?? 3;
  const useDetailed = symbolData.size <= threshold;

  const sections: string[] = [];

  // Market context section
  const marketSection = buildMarketSection(marketCtx ?? null, regime ?? null);
  if (marketSection) sections.push(marketSection);

  // Per-symbol sections
  for (const [sym, data] of symbolData) {
    sections.push(useDetailed ? buildDetailedSymbol(sym, data) : buildCondensedSymbol(sym, data));
  }

  const dataBlock = sections.join('\n\n');

  return `\n${dataBlock}\n\nIMPORTANT: Use the ACTUAL market data provided above in your analysis. Reference real prices, technical indicators, and fundamentals. Do NOT hallucinate or make up numbers.\n`;
}
