'use client';

import { useEffect, useRef } from 'react';
import useSWR from 'swr';
import {
  Activity,
  DollarSign,
  Pause,
  Play,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import type {
  DailyMetricsResponse,
  PortfolioResponse,
  StatusResponse,
  TradesResponse,
} from '@/lib/types';
import { useWebSocket } from '@/lib/websocket';
import { StatusBadge } from '@/components/status-badge';
import { PnlDisplay } from '@/components/pnl-display';
import { StockChart } from '@/components/stock-chart';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';

export default function OverviewPage() {
  const { data: portfolio, mutate: mutatePortfolio } = useSWR<PortfolioResponse>(
    '/api/portfolio',
    fetcher,
    { refreshInterval: 10_000 },
  );
  const { data: status, mutate: mutateStatus } = useSWR<StatusResponse>(
    '/api/status',
    fetcher,
    { refreshInterval: 5_000 },
  );
  const { data: dailyMetrics } = useSWR<DailyMetricsResponse>(
    '/api/performance/daily',
    fetcher,
  );
  const { data: recentTrades } = useSWR<TradesResponse>(
    '/api/trades?limit=10',
    fetcher,
    { refreshInterval: 15_000 },
  );

  const { lastMessage, connected } = useWebSocket([
    'price_update',
    'trade_executed',
    'position_update',
  ]);

  // Debounce WS-triggered portfolio refresh (max once per 2s)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!lastMessage) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      mutatePortfolio();
    }, 2000);
  }, [lastMessage, mutatePortfolio]);

  const equityData =
    dailyMetrics?.metrics.map((m) => ({
      time: m.date,
      value: m.portfolioValue ?? 0,
    })) ?? [];

  async function toggleBot() {
    if (!status) return;
    if (status.status === 'running') {
      await api.pause();
    } else {
      await api.resume();
    }
    mutateStatus();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Portfolio overview and bot status</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                connected ? 'bg-emerald-500' : 'bg-red-500',
              )}
            />
            {connected ? 'Live' : 'Disconnected'}
          </div>
          {status && (
            <>
              <StatusBadge status={status.status} />
              <StatusBadge status={status.marketStatus} />
              <button
                type="button"
                onClick={toggleBot}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  status.status === 'running'
                    ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20',
                )}
              >
                {status.status === 'running' ? (
                  <>
                    <Pause className="h-4 w-4" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" /> Resume
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Portfolio Value"
          value={formatCurrency(portfolio?.totalValue ?? 0)}
          icon={<Wallet className="h-4 w-4" />}
        />
        <StatCard
          title="Cash Available"
          value={formatCurrency(portfolio?.cashAvailable ?? 0)}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          title="Today's P&L"
          value={
            <PnlDisplay value={portfolio?.pnl ?? 0} size="md" />
          }
          icon={
            (portfolio?.pnl ?? 0) >= 0 ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )
          }
        />
        <StatCard
          title="Open Positions"
          value={String(portfolio?.positions.length ?? 0)}
          icon={<Activity className="h-4 w-4" />}
        />
      </div>

      {/* Equity curve */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-4 text-sm font-semibold">Equity Curve</h2>
        {equityData.length > 0 ? (
          <StockChart data={equityData} height={280} />
        ) : (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            No historical data yet
          </div>
        )}
      </div>

      {/* Open positions + Recent activity */}
      <div className="grid grid-cols-2 gap-4">
        {/* Open positions */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Open Positions</h2>
          </div>
          <div className="divide-y divide-border">
            {portfolio?.positions.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No open positions
              </div>
            )}
            {portfolio?.positions.map((pos) => (
              <div
                key={pos.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{pos.symbol}</div>
                  <div className="text-xs text-muted-foreground">
                    {pos.shares} shares @ {formatCurrency(pos.entryPrice)}
                  </div>
                </div>
                <PnlDisplay
                  value={pos.pnl ?? 0}
                  percentage={pos.pnlPct}
                  size="sm"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Recent Activity</h2>
          </div>
          <div className="divide-y divide-border">
            {recentTrades?.trades.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No recent trades
              </div>
            )}
            {recentTrades?.trades.map((trade) => (
              <div
                key={trade.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs font-semibold',
                      trade.side === 'BUY'
                        ? 'bg-emerald-500/10 text-emerald-500'
                        : 'bg-red-500/10 text-red-500',
                    )}
                  >
                    {trade.side}
                  </span>
                  <div>
                    <div className="text-sm font-medium">{trade.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(trade.entryTime)}
                    </div>
                  </div>
                </div>
                {trade.pnl != null && (
                  <PnlDisplay value={trade.pnl} percentage={trade.pnlPct} size="sm" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{title}</span>
        <span className="text-muted-foreground">{icon}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
