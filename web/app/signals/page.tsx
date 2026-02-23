'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Radio } from 'lucide-react';
import { fetcher } from '@/lib/api';
import type { Signal, SignalsResponse } from '@/lib/types';
import { useWebSocket } from '@/lib/websocket';
import { cn, formatDateTime } from '@/lib/utils';

export default function SignalsPage() {
  const { data, mutate } = useSWR<SignalsResponse>(
    '/api/signals?limit=50',
    fetcher,
    { refreshInterval: 15_000 },
  );

  const { lastMessage, connected } = useWebSocket(['signal_generated']);
  const [liveSignals, setLiveSignals] = useState<Signal[]>([]);

  useEffect(() => {
    if (lastMessage?.event === 'signal_generated') {
      setLiveSignals((prev) => [lastMessage.data as Signal, ...prev].slice(0, 10));
      mutate();
    }
  }, [lastMessage, mutate]);

  const signals = [...liveSignals, ...(data?.signals ?? [])];
  const minConviction = data?.minConviction ?? 65;

  // Deduplicate by id
  const seen = new Set<number>();
  const uniqueSignals = signals.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Signals</h1>
          <p className="text-sm text-muted-foreground">
            Trading signals from the decision engine
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Tip text="The minimum decision score required for a BUY signal to be executed. Change it in Settings > ai.minConvictionScore.">
            <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
              Min conviction: <span className="font-semibold text-foreground">{minConviction}</span>
            </span>
          </Tip>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Radio
              className={cn('h-4 w-4', connected ? 'text-emerald-500' : 'text-red-500')}
            />
            {connected ? 'Live feed active' : 'Reconnecting...'}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {uniqueSignals.length === 0 && (
          <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
            No signals generated yet
          </div>
        )}

        {uniqueSignals.map((signal) => (
          <SignalCard key={signal.id} signal={signal} minConviction={minConviction} />
        ))}
      </div>
    </div>
  );
}

function SignalCard({ signal, minConviction }: { signal: Signal; minConviction: number }) {
  const [expanded, setExpanded] = useState(false);
  const conviction = signal.decisionScore ?? 0;
  const passedGate = conviction >= minConviction;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <Tip text="Final decision after all gates. BUY = open position, SELL = close position, HOLD = do nothing.">
            <span
              className={cn(
                'rounded px-2 py-0.5 text-xs font-bold',
                signal.decision === 'BUY' && 'bg-emerald-500/10 text-emerald-500',
                signal.decision === 'SELL' && 'bg-red-500/10 text-red-500',
                signal.decision === 'HOLD' && 'bg-muted text-muted-foreground',
              )}
            >
              {signal.decision ?? 'HOLD'}
            </span>
          </Tip>
          <span className="text-sm font-semibold">{signal.symbol}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(signal.timestamp)}
          </span>
          {signal.executed && (
            <Tip text="This signal was strong enough and a trade was placed.">
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-500">
                Executed
              </span>
            </Tip>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Tip text="Technical score (0-100). Based on indicators like RSI, MACD, moving averages. Higher = more bullish chart pattern.">
            <ScorePill label="Tech" value={signal.technicalScore} />
          </Tip>
          <Tip text="Sentiment score (0-100). Based on news headlines, insider trades, and social buzz. Higher = more positive market mood.">
            <ScorePill label="Sent" value={signal.sentimentScore} />
          </Tip>
          <Tip text="Fundamental score (0-100). Based on P/E ratio, revenue growth, debt levels. Higher = stronger company financials.">
            <ScorePill label="Fund" value={signal.fundamentalScore} />
          </Tip>
          <span className="text-muted-foreground">|</span>
          <Tip text="Decision engine conviction (0-100). This is the score checked against the min conviction threshold. It comes from the 4-strategy consensus weighted by market regime.">
            <span
              className={cn(
                'font-semibold',
                passedGate ? 'text-emerald-500' : 'text-foreground',
              )}
            >
              Conviction: {conviction}
            </span>
          </Tip>
          <span className="text-muted-foreground">
            / {minConviction}
          </span>
          <Tip text={passedGate
            ? 'Conviction met the threshold. This signal can trigger a trade.'
            : `Conviction is below the threshold. The signal was downgraded to HOLD. Need ${minConviction - conviction} more points.`
          }>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                passedGate
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-red-500/10 text-red-500',
              )}
            >
              {passedGate ? 'PASS' : 'BLOCKED'}
            </span>
          </Tip>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Score breakdown */}
          <div className="grid grid-cols-5 gap-2 text-xs">
            <ScoreBox
              label="Technical"
              value={signal.technicalScore}
              tip="Chart pattern strength based on 16+ indicators. Above 65 is bullish, below 35 is bearish."
            />
            <ScoreBox
              label="Sentiment"
              value={signal.sentimentScore}
              tip="Market mood from news, insider activity, and social media. Above 65 is positive, below 35 is negative."
            />
            <ScoreBox
              label="Fundamental"
              value={signal.fundamentalScore}
              tip="Company financial health: earnings quality, valuation, and growth. Above 65 is strong, below 35 is weak."
            />
            <ScoreBox
              label="Decision (gate)"
              value={signal.decisionScore}
              highlight
              pass={passedGate}
              tip="The 4-strategy consensus score. THIS is the value compared against the min conviction threshold to decide BUY or HOLD."
            />
            <ScoreBox
              label="Average"
              value={signal.convictionTotal}
              tip="Simple average of all four scores above. Shown for reference only — not used for any gate decisions."
            />
          </div>

          {/* Gate explanation */}
          <Tip text="The conviction gate is the final check. If the decision engine says BUY but its conviction score is below your threshold, the signal gets downgraded to HOLD.">
            <div
              className={cn(
                'rounded-md px-3 py-2 text-xs',
                passedGate ? 'bg-emerald-500/5 text-emerald-500' : 'bg-red-500/5 text-red-500',
              )}
            >
              Conviction gate: <span className="font-semibold">{conviction}</span>
              {passedGate ? ' >= ' : ' < '}
              <span className="font-semibold">{minConviction}</span>
              {passedGate
                ? ' — signal passed, trade eligible'
                : ` — blocked (need ${minConviction - conviction} more)`}
            </div>
          </Tip>

          {/* Indicators grid */}
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Indicator label="RSI" value={signal.rsi} tip="Relative Strength Index (0-100). Below 30 = oversold (may bounce up), above 70 = overbought (may drop)." />
            <Indicator label="MACD" value={signal.macdValue} decimals={4} tip="Moving Average Convergence Divergence. Positive = bullish momentum, negative = bearish. Crossovers signal trend changes." />
            <Indicator label="MACD-H" value={signal.macdHistogram} decimals={4} tip="MACD Histogram. Shows the gap between MACD and its signal line. Growing bars = strengthening trend." />
            <Indicator label="ADX" value={signal.adx} tip="Average Directional Index (0-100). Measures trend strength regardless of direction. Above 25 = strong trend, below 20 = weak/no trend." />
            <Indicator label="SMA20" value={signal.sma20} tip="20-day Simple Moving Average. Short-term trend line. Price above it = short-term bullish." />
            <Indicator label="SMA50" value={signal.sma50} tip="50-day Simple Moving Average. Medium-term trend. Price above it = medium-term bullish. Golden cross = SMA50 crosses above SMA200." />
            <Indicator label="SMA200" value={signal.sma200} tip="200-day Simple Moving Average. Long-term trend. Price above it = long-term bullish. The most watched moving average by institutions." />
            <Indicator label="ATR" value={signal.atr} tip="Average True Range. Measures daily price volatility in dollars. Higher = more volatile. Used to calculate stop-loss distances." />
            <Indicator label="Stoch K" value={signal.stochasticK} tip="Stochastic %K (0-100). Shows where price closed relative to its recent range. Below 20 = oversold, above 80 = overbought." />
            <Indicator label="Stoch D" value={signal.stochasticD} tip="Stochastic %D (0-100). Smoothed version of %K. When %K crosses above %D = buy signal, below = sell signal." />
            <Indicator label="MFI" value={signal.mfi} tip="Money Flow Index (0-100). Like RSI but includes volume. Below 20 = oversold with weak buying, above 80 = overbought with strong selling." />
            <Indicator label="CCI" value={signal.cci} tip="Commodity Channel Index. Measures how far price deviates from average. Above +100 = unusually strong, below -100 = unusually weak." />
            <Indicator label="Williams %R" value={signal.williamsR} tip="Williams %R (-100 to 0). Similar to Stochastic. Below -80 = oversold, above -20 = overbought." />
            <Indicator label="ROC" value={signal.roc} tip="Rate of Change (%). How much price changed over a period. Positive = price rising, negative = falling. Larger values = faster move." />
            <Indicator label="Vol Ratio" value={signal.volumeRatio} tip="Volume Ratio. Current volume divided by average volume. Above 1.5 = unusually high activity, below 0.5 = unusually quiet." />
            <Indicator label="VWAP" value={signal.vwap} tip="Volume-Weighted Average Price. The average price weighted by volume. Price above VWAP = buyers in control, below = sellers in control." />
          </div>

          {/* Reasoning */}
          {signal.reasoning && (
            <ReasoningBreakdown reasoning={signal.reasoning} />
          )}

          {/* Suggestions */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {signal.suggestedStopLossPct != null && (
              <Tip text="Suggested stop-loss percentage. If price drops this much from entry, the position will be closed to limit losses.">
                <span>SL: {(signal.suggestedStopLossPct * 100).toFixed(1)}%</span>
              </Tip>
            )}
            {signal.suggestedPositionSizePct != null && (
              <Tip text="Suggested position size as % of portfolio. How much of your capital to put into this trade.">
                <span>Size: {(signal.suggestedPositionSizePct * 100).toFixed(1)}%</span>
              </Tip>
            )}
            {signal.suggestedTakeProfitPct != null && (
              <Tip text="Suggested take-profit percentage. If price rises this much from entry, the position will be closed to lock in gains.">
                <span>TP: {(signal.suggestedTakeProfitPct * 100).toFixed(1)}%</span>
              </Tip>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded bg-gray-900 border border-gray-700 px-3 py-2 text-xs text-gray-200 shadow-lg pointer-events-none leading-relaxed">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}

function ScorePill({ label, value }: { label: string; value?: number }) {
  if (value == null) return null;
  return (
    <span className="text-muted-foreground">
      {label}:{' '}
      <span
        className={cn(
          'font-medium',
          value >= 65 ? 'text-emerald-500' : value <= 35 ? 'text-red-500' : 'text-foreground',
        )}
      >
        {value.toFixed(0)}
      </span>
    </span>
  );
}

function ScoreBox({
  label,
  value,
  highlight,
  pass,
  tip,
}: {
  label: string;
  value?: number;
  highlight?: boolean;
  pass?: boolean;
  tip?: string;
}) {
  const inner = (
    <div
      className={cn(
        'rounded px-2 py-1.5 text-center',
        highlight
          ? pass
            ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30'
            : 'bg-red-500/10 ring-1 ring-red-500/30'
          : 'bg-muted/30',
      )}
    >
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div
        className={cn(
          'font-semibold',
          highlight
            ? pass
              ? 'text-emerald-500'
              : 'text-red-500'
            : 'text-foreground',
        )}
      >
        {value != null ? value.toFixed(1) : 'N/A'}
      </div>
    </div>
  );

  if (tip) return <Tip text={tip}>{inner}</Tip>;
  return inner;
}

function Indicator({
  label,
  value,
  decimals = 2,
  tip,
}: {
  label: string;
  value?: number;
  decimals?: number;
  tip?: string;
}) {
  const inner = (
    <div className="rounded bg-muted/30 px-2 py-1">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">
        {value != null ? value.toFixed(decimals) : 'N/A'}
      </span>
    </div>
  );

  if (tip) return <Tip text={tip}>{inner}</Tip>;
  return inner;
}

// ── Reasoning parser & renderer ─────────────────────────────────────

interface ParsedReasoning {
  decision: string;
  regime: string;
  conviction: string;
  riskMult: string;
  fund: { combined: string; quality: string; value: string; growth: string };
  sl: string;
  tp: string;
  best: string;
  agree: { long: number; short: number };
  strategies: Array<{ name: string; direction: string; strength: number; confidence: number }>;
}

function parseReasoning(raw: string): ParsedReasoning | null {
  try {
    const decision = raw.match(/\[(\w+)\]/)?.[1] ?? '';
    const regime = raw.match(/regime=(\S+)/)?.[1] ?? '';
    const conviction = raw.match(/conviction=(\d+%)/)?.[1] ?? '';
    const riskMult = raw.match(/riskMult=(\S+)/)?.[1] ?? '';

    const fundMatch = raw.match(/fund=([\d.]+)\(Q=([\d.]+)\/V=([\d.]+)\/G=([\d.]+)\)/);
    const fund = fundMatch
      ? { combined: fundMatch[1], quality: fundMatch[2], value: fundMatch[3], growth: fundMatch[4] }
      : { combined: '0', quality: '0', value: '0', growth: '0' };

    const sl = raw.match(/SL=([\d.]+%)/)?.[1] ?? '';
    const tp = raw.match(/TP=([\d.]+%)/)?.[1] ?? '';
    const best = raw.match(/best=(\w+)/)?.[1] ?? '';

    const agreeMatch = raw.match(/agree=(\d+)L\/(\d+)S/);
    const agree = agreeMatch
      ? { long: Number(agreeMatch[1]), short: Number(agreeMatch[2]) }
      : { long: 0, short: 0 };

    const strategies: ParsedReasoning['strategies'] = [];
    const stratRegex = /(\w+):(LONG|SHORT)\(str=([\d.]+),conf=([\d.]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = stratRegex.exec(raw)) !== null) {
      strategies.push({
        name: m[1],
        direction: m[2],
        strength: Number(m[3]),
        confidence: Number(m[4]),
      });
    }

    return { decision, regime, conviction, riskMult, fund, sl, tp, best, agree, strategies };
  } catch {
    return null;
  }
}

const REGIME_LABELS: Record<string, string> = {
  strong_bull: 'Strong Bull',
  bull: 'Bull',
  bear: 'Bear',
  strong_bear: 'Strong Bear',
  sideways: 'Sideways',
  range_bound: 'Range-Bound',
  volatile: 'Volatile',
  unknown: 'Unknown',
};

const REGIME_TIPS: Record<string, string> = {
  strong_bull: 'Strong uptrend. Trend-following and momentum strategies get the highest weight.',
  bull: 'Moderate uptrend. Trend-following leads, with momentum and breakout supporting.',
  bear: 'Downtrend. Trend-following leads (looking for shorts), breakout gets extra weight.',
  strong_bear: 'Strong downtrend. Momentum and trend-following dominate, looking for short signals.',
  sideways: 'No clear direction. Mean-reversion strategies (buy low, sell high within range) get priority.',
  range_bound: 'Price is bouncing between support and resistance. Mean-reversion gets 40% weight, breakout 30%.',
  volatile: 'High uncertainty, large price swings. All strategies get reduced confidence.',
  unknown: 'Not enough data to determine the market regime.',
};

const STRATEGY_LABELS: Record<string, string> = {
  MEAN_REVERSION: 'Mean Reversion',
  TREND_FOLLOWING: 'Trend Following',
  MOMENTUM: 'Momentum',
  BREAKOUT: 'Breakout',
};

const STRATEGY_TIPS: Record<string, string> = {
  MEAN_REVERSION: 'Buys when price drops too far below average, expecting it to bounce back. Uses RSI, Bollinger Bands, Stochastic.',
  TREND_FOLLOWING: 'Buys when a clear uptrend is established and rides the trend. Uses EMA alignment, ADX, MACD.',
  MOMENTUM: 'Buys stocks that are already moving up fast, expecting the move to continue. Uses Rate of Change, volume, MFI.',
  BREAKOUT: 'Buys when price breaks above resistance with strong volume. Uses Donchian channels, volume surge, ATR expansion.',
};

function ReasoningBreakdown({ reasoning }: { reasoning: string }) {
  const parsed = parseReasoning(reasoning);

  if (!parsed) {
    return (
      <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        {reasoning}
      </div>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      {/* Row 1: Market context */}
      <div className="flex items-center gap-3">
        <Tip text={REGIME_TIPS[parsed.regime] ?? 'Current market condition detected by the regime detector. Determines how much weight each strategy gets.'}>
          <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
            Market: <span className="font-medium text-foreground">{REGIME_LABELS[parsed.regime] ?? parsed.regime}</span>
          </span>
        </Tip>
        {parsed.riskMult !== '1.00' && (
          <Tip text="Volatility risk adjustment. When volatility is very high, conviction is multiplied by this factor to reduce risk. 1.0 = no adjustment, 0.5 = halved.">
            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-500">
              Risk adjusted: {parsed.riskMult}x
            </span>
          </Tip>
        )}
        <Tip text="How far price can drop before the position is automatically closed to limit losses. Based on ATR (volatility).">
          <span className="text-muted-foreground">
            Stop Loss: <span className="font-medium text-foreground">{parsed.sl}</span>
          </span>
        </Tip>
        <Tip text="The profit target. When price rises this much, the position is closed to lock in gains.">
          <span className="text-muted-foreground">
            Take Profit: <span className="font-medium text-foreground">{parsed.tp}</span>
          </span>
        </Tip>
      </div>

      {/* Row 2: Fundamentals */}
      <div className="flex items-center gap-2">
        <Tip text="Fundamental analysis scores. These adjust the decision engine's conviction by up to +/- 20%.">
          <span className="text-muted-foreground">Fundamentals:</span>
        </Tip>
        <FundBar label="Quality" value={Number(parsed.fund.quality)} tip="Earnings quality: profitability, margins, return on equity. High = the company makes money efficiently." />
        <FundBar label="Value" value={Number(parsed.fund.value)} tip="Valuation: P/E ratio, price-to-book, debt levels. High = the stock looks cheap relative to its fundamentals." />
        <FundBar label="Growth" value={Number(parsed.fund.growth)} tip="Revenue and earnings growth rate. High = the company is growing quickly." />
      </div>

      {/* Row 3: Strategy breakdown */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Tip text="How many of the 4 strategies agree on direction. More agreement = stronger signal. At least 2 must agree for a BUY.">
            <span className="text-muted-foreground">
              Strategies: <span className="font-medium text-foreground">{parsed.agree.long} bullish</span>
              {parsed.agree.short > 0 && (
                <>, <span className="font-medium text-red-500">{parsed.agree.short} bearish</span></>
              )}
            </span>
          </Tip>
          {parsed.best && (
            <Tip text="The strategy with the highest combined strength x confidence score.">
              <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-400">
                Best: {STRATEGY_LABELS[parsed.best] ?? parsed.best}
              </span>
            </Tip>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {parsed.strategies.map((s) => (
            <StrategyBar key={s.name} strategy={s} isBest={s.name === parsed.best} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FundBar({ label, value, tip }: { label: string; value: number; tip: string }) {
  const pct = Math.round(value * 100);
  return (
    <Tip text={tip}>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground w-12 text-right">{label}</span>
        <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full',
              pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={cn(
          'font-medium w-8',
          pct >= 70 ? 'text-emerald-500' : pct >= 40 ? 'text-amber-500' : 'text-red-500',
        )}>
          {pct}%
        </span>
      </div>
    </Tip>
  );
}

function StrategyBar({
  strategy,
  isBest,
}: {
  strategy: { name: string; direction: string; strength: number; confidence: number };
  isBest: boolean;
}) {
  const score = Math.round(strategy.strength * strategy.confidence * 100);
  const isLong = strategy.direction === 'LONG';

  return (
    <Tip text={STRATEGY_TIPS[strategy.name] ?? `${strategy.name} strategy signal.`}>
      <div
        className={cn(
          'flex items-center gap-2 rounded px-2 py-1',
          isBest ? 'bg-blue-500/10 ring-1 ring-blue-500/20' : 'bg-muted/30',
        )}
      >
        <Tip text={isLong ? 'Bullish signal: this strategy thinks price will go up.' : 'Bearish signal: this strategy thinks price will go down.'}>
          <span
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              isLong ? 'bg-emerald-500' : 'bg-red-500',
            )}
          />
        </Tip>
        <span className="text-muted-foreground w-24">
          {STRATEGY_LABELS[strategy.name] ?? strategy.name}
        </span>
        <Tip text={`Strength: ${(strategy.strength * 100).toFixed(0)}% (how strong the signal is) x Confidence: ${(strategy.confidence * 100).toFixed(0)}% (how certain the strategy is) = ${score}% combined score.`}>
          <div className="flex items-center gap-1.5 flex-1">
            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full',
                  isLong ? 'bg-emerald-500' : 'bg-red-500',
                )}
                style={{ width: `${score}%` }}
              />
            </div>
            <span className={cn(
              'font-medium w-8 text-right',
              isLong ? 'text-emerald-500' : 'text-red-500',
            )}>
              {score}%
            </span>
          </div>
        </Tip>
      </div>
    </Tip>
  );
}
