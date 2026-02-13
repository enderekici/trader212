import type { AIContext } from './agent.js';

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
    .map(
      (pos) =>
        `  - ${pos.symbol}: entry $${fmt(pos.entryPrice)} → $${fmt(pos.currentPrice)} (${pos.pnlPct >= 0 ? '+' : ''}${fmtPct(pos.pnlPct)})`,
    )
    .join('\n');

  const sectorExposure = Object.entries(p.sectorExposure)
    .map(([sector, count]) => `  - ${sector}: ${count} position(s)`)
    .join('\n');

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

NEWS SENTIMENT (Composite Score: ${s.score.toFixed(0)}/100):
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
