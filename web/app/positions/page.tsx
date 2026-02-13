'use client';

import useSWR from 'swr';
import { Clock, Shield, Target, X } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import type { PortfolioResponse } from '@/lib/types';
import { PnlDisplay } from '@/components/pnl-display';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';

export default function PositionsPage() {
  const { data: portfolio, mutate } = useSWR<PortfolioResponse>(
    '/api/portfolio',
    fetcher,
    { refreshInterval: 10_000 },
  );

  async function handleClose(symbol: string) {
    await api.closePosition(symbol);
    mutate();
  }

  const positions = portfolio?.positions ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Positions</h1>
        <p className="text-sm text-muted-foreground">
          {positions.length} open position{positions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {positions.length === 0 && (
        <div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
          No open positions
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {positions.map((pos) => {
          const holdDuration = Math.round(
            (Date.now() - new Date(pos.entryTime).getTime()) / 3_600_000,
          );
          const holdLabel =
            holdDuration < 24
              ? `${holdDuration}h`
              : `${Math.round(holdDuration / 24)}d`;

          return (
            <div
              key={pos.id}
              className="rounded-lg border border-border bg-card p-5 space-y-4"
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold">{pos.symbol}</h3>
                    {pos.convictionScore != null && (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Conviction: {pos.convictionScore}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{pos.shares} shares</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {holdLabel}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleClose(pos.symbol)}
                  className="rounded-md bg-red-500/10 p-1.5 text-red-500 transition-colors hover:bg-red-500/20"
                  title="Close position"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Price grid */}
              <div className="grid grid-cols-3 gap-3">
                <PriceBox
                  label="Entry"
                  value={formatCurrency(pos.entryPrice)}
                />
                <PriceBox
                  label="Current"
                  value={formatCurrency(pos.currentPrice ?? pos.entryPrice)}
                />
                <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                  <div className="text-xs text-muted-foreground">P&L</div>
                  <PnlDisplay
                    value={pos.pnl ?? 0}
                    percentage={pos.pnlPct}
                    size="sm"
                  />
                </div>
              </div>

              {/* Stops and targets */}
              <div className="flex items-center gap-4 text-xs">
                {pos.stopLoss != null && (
                  <span className="flex items-center gap-1 text-red-400">
                    <Shield className="h-3 w-3" /> Stop: {formatCurrency(pos.stopLoss)}
                  </span>
                )}
                {pos.takeProfit != null && (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Target className="h-3 w-3" /> TP: {formatCurrency(pos.takeProfit)}
                  </span>
                )}
                {pos.trailingStop != null && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <Shield className="h-3 w-3" /> Trail: {formatCurrency(pos.trailingStop)}
                  </span>
                )}
              </div>

              {/* AI Reasoning */}
              {pos.aiExitConditions && (
                <div className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Exit conditions: </span>
                  {pos.aiExitConditions}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Opened {formatDateTime(pos.entryTime)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PriceBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}
