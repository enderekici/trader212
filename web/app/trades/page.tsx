'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import type { TradesResponse } from '@/lib/types';
import { PnlDisplay } from '@/components/pnl-display';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';

export default function TradesPage() {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('');
  const [page, setPage] = useState(0);
  const limit = 25;

  const params = new URLSearchParams();
  if (symbol) params.set('symbol', symbol);
  if (side) params.set('side', side);
  params.set('limit', String(limit));
  params.set('offset', String(page * limit));
  const qs = params.toString();

  const { data } = useSWR<TradesResponse>(`/api/trades?${qs}`, fetcher, {
    refreshInterval: 30_000,
  });

  const trades = data?.trades ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trade History</h1>
        <p className="text-sm text-muted-foreground">{total} total trades</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by symbol..."
          value={symbol}
          onChange={(e) => {
            setSymbol(e.target.value.toUpperCase());
            setPage(0);
          }}
          className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring"
        />
        <select
          value={side}
          onChange={(e) => {
            setSide(e.target.value);
            setPage(0);
          }}
          className="rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground outline-none focus:border-ring"
        >
          <option value="">All sides</option>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Symbol</th>
              <th className="px-4 py-3 font-medium">Side</th>
              <th className="px-4 py-3 font-medium">Shares</th>
              <th className="px-4 py-3 font-medium">Entry</th>
              <th className="px-4 py-3 font-medium">Exit</th>
              <th className="px-4 py-3 font-medium">P&L</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {trades.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No trades found
                </td>
              </tr>
            )}
            {trades.map((trade) => (
              <tr key={trade.id} className="hover:bg-muted/30">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {formatDateTime(trade.entryTime)}
                </td>
                <td className="px-4 py-3 font-medium">{trade.symbol}</td>
                <td className="px-4 py-3">
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
                </td>
                <td className="px-4 py-3 tabular-nums">{trade.shares}</td>
                <td className="px-4 py-3 tabular-nums">
                  {formatCurrency(trade.entryPrice)}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {trade.exitPrice != null
                    ? formatCurrency(trade.exitPrice)
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  {trade.pnl != null ? (
                    <PnlDisplay
                      value={trade.pnl}
                      percentage={trade.pnlPct}
                      size="sm"
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-4 py-3">
                  {trade.pnl != null && (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        trade.pnl >= 0
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : 'bg-red-500/10 text-red-500',
                      )}
                    >
                      {trade.pnl >= 0 ? 'Win' : 'Loss'}
                    </span>
                  )}
                </td>
                <td className="max-w-[200px] truncate px-4 py-3 text-xs text-muted-foreground">
                  {trade.exitReason || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-30"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
