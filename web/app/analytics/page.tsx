'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import type { DailyMetricsResponse, PerformanceResponse } from '@/lib/types';
import { StockChart } from '@/components/stock-chart';
import { formatCurrency, formatPct } from '@/lib/utils';

export default function AnalyticsPage() {
  const { data: perf } = useSWR<PerformanceResponse>('/api/performance', fetcher);
  const { data: daily } = useSWR<DailyMetricsResponse>(
    '/api/performance/daily',
    fetcher,
  );

  const metrics = daily?.metrics ?? [];

  const pnlData = metrics.map((m) => ({
    time: m.date,
    value: m.totalPnl ?? 0,
  }));

  // Cumulative P&L
  let cumPnl = 0;
  const cumulativePnlData = metrics.map((m) => {
    cumPnl += m.totalPnl ?? 0;
    return { time: m.date, value: cumPnl };
  });

  const drawdownData = metrics.map((m) => ({
    time: m.date,
    value: (m.maxDrawdown ?? 0) * -100,
  }));

  const winRateData = metrics
    .filter((m) => m.winRate != null)
    .map((m) => ({
      time: m.date,
      value: (m.winRate ?? 0) * 100,
    }));

  const sharpeData = metrics
    .filter((m) => m.sharpeRatio != null)
    .map((m) => ({
      time: m.date,
      value: m.sharpeRatio ?? 0,
    }));

  // Sector breakdown from latest metrics that have trading data
  // (we don't have sector data in daily metrics, so show key stats instead)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Performance metrics and trends
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          label="Total P&L"
          value={formatCurrency(perf?.totalPnl ?? 0)}
          highlight={(perf?.totalPnl ?? 0) >= 0}
        />
        <MetricCard
          label="Win Rate"
          value={formatPct(perf?.winRate ?? 0)}
          highlight={(perf?.winRate ?? 0) >= 0.5}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={(perf?.sharpeRatio ?? 0).toFixed(2)}
          highlight={(perf?.sharpeRatio ?? 0) >= 1}
        />
        <MetricCard
          label="Max Drawdown"
          value={formatPct(perf?.maxDrawdown ?? 0)}
          highlight={false}
        />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          label="Total Trades"
          value={String(perf?.totalTrades ?? 0)}
        />
        <MetricCard
          label="Avg Return"
          value={formatPct(perf?.avgReturn ?? 0)}
          highlight={(perf?.avgReturn ?? 0) >= 0}
        />
        <MetricCard
          label="Profit Factor"
          value={(perf?.profitFactor ?? 0).toFixed(2)}
          highlight={(perf?.profitFactor ?? 0) >= 1}
        />
        <MetricCard label="Days Tracked" value={String(metrics.length)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Cumulative P&L" data={cumulativePnlData} color="#10b981" />
        <ChartCard title="Daily P&L" data={pnlData} color="#3b82f6" type="line" />
        <ChartCard title="Drawdown (%)" data={drawdownData} color="#ef4444" />
        <ChartCard title="Win Rate (%)" data={winRateData} color="#8b5cf6" type="line" />
        <ChartCard
          title="Sharpe Ratio"
          data={sharpeData}
          color="#f59e0b"
          type="line"
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-xl font-bold ${
          highlight === true
            ? 'text-emerald-500'
            : highlight === false
              ? 'text-red-500'
              : 'text-foreground'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  data,
  color,
  type = 'area',
}: {
  title: string;
  data: Array<{ time: string; value: number }>;
  color: string;
  type?: 'area' | 'line';
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {data.length > 0 ? (
        <StockChart data={data} height={200} color={color} type={type} />
      ) : (
        <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
          No data yet
        </div>
      )}
    </div>
  );
}
