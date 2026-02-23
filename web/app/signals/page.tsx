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
            <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Reasoning: </span>
              {signal.reasoning}
            </div>
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
