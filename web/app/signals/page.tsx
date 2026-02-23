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
          <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            Min conviction: <span className="font-semibold text-foreground">{minConviction}</span>
          </span>
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
          <span className="text-sm font-semibold">{signal.symbol}</span>
          <span className="text-xs text-muted-foreground">
            {formatDateTime(signal.timestamp)}
          </span>
          {signal.executed && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-500">
              Executed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <ScorePill label="Tech" value={signal.technicalScore} />
          <ScorePill label="Sent" value={signal.sentimentScore} />
          <ScorePill label="Fund" value={signal.fundamentalScore} />
          <span className="text-muted-foreground">|</span>
          <span
            className={cn(
              'font-semibold',
              passedGate ? 'text-emerald-500' : 'text-foreground',
            )}
          >
            Conviction: {conviction}
          </span>
          <span className="text-muted-foreground">
            / {minConviction}
          </span>
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
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Score breakdown */}
          <div className="grid grid-cols-5 gap-2 text-xs">
            <ScoreBox label="Technical" value={signal.technicalScore} />
            <ScoreBox label="Sentiment" value={signal.sentimentScore} />
            <ScoreBox label="Fundamental" value={signal.fundamentalScore} />
            <ScoreBox
              label="Decision (gate)"
              value={signal.decisionScore}
              highlight
              pass={passedGate}
            />
            <ScoreBox label="Average" value={signal.convictionTotal} />
          </div>

          {/* Gate explanation */}
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

          {/* Indicators grid */}
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Indicator label="RSI" value={signal.rsi} />
            <Indicator label="MACD" value={signal.macdValue} decimals={4} />
            <Indicator label="MACD-H" value={signal.macdHistogram} decimals={4} />
            <Indicator label="ADX" value={signal.adx} />
            <Indicator label="SMA20" value={signal.sma20} />
            <Indicator label="SMA50" value={signal.sma50} />
            <Indicator label="SMA200" value={signal.sma200} />
            <Indicator label="ATR" value={signal.atr} />
            <Indicator label="Stoch K" value={signal.stochasticK} />
            <Indicator label="Stoch D" value={signal.stochasticD} />
            <Indicator label="MFI" value={signal.mfi} />
            <Indicator label="CCI" value={signal.cci} />
            <Indicator label="Williams %R" value={signal.williamsR} />
            <Indicator label="ROC" value={signal.roc} />
            <Indicator label="Vol Ratio" value={signal.volumeRatio} />
            <Indicator label="VWAP" value={signal.vwap} />
          </div>

          {/* Reasoning */}
          {signal.reasoning && (
            <ReasoningBreakdown reasoning={signal.reasoning} />
          )}

          {/* Suggestions */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {signal.suggestedStopLossPct != null && (
              <span>SL: {(signal.suggestedStopLossPct * 100).toFixed(1)}%</span>
            )}
            {signal.suggestedPositionSizePct != null && (
              <span>Size: {(signal.suggestedPositionSizePct * 100).toFixed(1)}%</span>
            )}
            {signal.suggestedTakeProfitPct != null && (
              <span>TP: {(signal.suggestedTakeProfitPct * 100).toFixed(1)}%</span>
            )}
          </div>
        </div>
      )}
    </div>
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
}: {
  label: string;
  value?: number;
  highlight?: boolean;
  pass?: boolean;
}) {
  return (
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
}

function Indicator({
  label,
  value,
  decimals = 2,
}: {
  label: string;
  value?: number;
  decimals?: number;
}) {
  return (
    <div className="rounded bg-muted/30 px-2 py-1">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium text-foreground">
        {value != null ? value.toFixed(decimals) : 'N/A'}
      </span>
    </div>
  );
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

const STRATEGY_LABELS: Record<string, string> = {
  MEAN_REVERSION: 'Mean Reversion',
  TREND_FOLLOWING: 'Trend Following',
  MOMENTUM: 'Momentum',
  BREAKOUT: 'Breakout',
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
        <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">
          Market: <span className="font-medium text-foreground">{REGIME_LABELS[parsed.regime] ?? parsed.regime}</span>
        </span>
        {parsed.riskMult !== '1.00' && (
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-amber-500">
            Risk adjusted: {parsed.riskMult}x
          </span>
        )}
        <span className="text-muted-foreground">
          Stop Loss: <span className="font-medium text-foreground">{parsed.sl}</span>
        </span>
        <span className="text-muted-foreground">
          Take Profit: <span className="font-medium text-foreground">{parsed.tp}</span>
        </span>
      </div>

      {/* Row 2: Fundamentals */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Fundamentals:</span>
        <FundBar label="Quality" value={Number(parsed.fund.quality)} />
        <FundBar label="Value" value={Number(parsed.fund.value)} />
        <FundBar label="Growth" value={Number(parsed.fund.growth)} />
      </div>

      {/* Row 3: Strategy breakdown */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            Strategies: <span className="font-medium text-foreground">{parsed.agree.long} bullish</span>
            {parsed.agree.short > 0 && (
              <>, <span className="font-medium text-red-500">{parsed.agree.short} bearish</span></>
            )}
          </span>
          {parsed.best && (
            <span className="rounded bg-blue-500/10 px-2 py-0.5 text-blue-400">
              Best: {STRATEGY_LABELS[parsed.best] ?? parsed.best}
            </span>
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

function FundBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
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
    <div
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1',
        isBest ? 'bg-blue-500/10 ring-1 ring-blue-500/20' : 'bg-muted/30',
      )}
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          isLong ? 'bg-emerald-500' : 'bg-red-500',
        )}
      />
      <span className="text-muted-foreground w-24">
        {STRATEGY_LABELS[strategy.name] ?? strategy.name}
      </span>
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
  );
}
