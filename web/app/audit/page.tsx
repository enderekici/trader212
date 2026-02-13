'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AuditEntry } from '@/lib/types';
import { cn, formatTime } from '@/lib/utils';
import { ChevronDown, ChevronUp, Filter, ScrollText } from 'lucide-react';

const EVENT_TYPES = [
  { value: '', label: 'All' },
  { value: 'trade', label: 'Trade' },
  { value: 'signal', label: 'Signal' },
  { value: 'pairlist', label: 'Pairlist' },
  { value: 'config', label: 'Config' },
  { value: 'error', label: 'Error' },
  { value: 'control', label: 'Control' },
  { value: 'research', label: 'Research' },
];

const SEVERITY_STYLES: Record<string, string> = {
  info: 'border-l-zinc-500',
  warn: 'border-l-yellow-500',
  error: 'border-l-red-500',
};

const EVENT_BADGE_STYLES: Record<string, string> = {
  trade: 'bg-emerald-500/20 text-emerald-400',
  signal: 'bg-blue-500/20 text-blue-400',
  pairlist: 'bg-purple-500/20 text-purple-400',
  config: 'bg-zinc-500/20 text-zinc-400',
  error: 'bg-red-500/20 text-red-400',
  control: 'bg-orange-500/20 text-orange-400',
  research: 'bg-cyan-500/20 text-cyan-400',
};

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayStr());
  const [typeFilter, setTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { date?: string; type?: string; limit?: number } = {
        limit: 200,
      };
      if (date) params.date = date;
      if (typeFilter) params.type = typeFilter;
      const data = await api.getAuditLog(params);
      setEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEntries();
  }, [date, typeFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Activity Log</h1>
        <p className="text-sm text-muted-foreground">
          Session replay and audit trail of all bot events
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <div className="flex gap-1">
            {EVENT_TYPES.map((et) => (
              <button
                key={et.value}
                type="button"
                onClick={() => setTypeFilter(et.value)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  typeFilter === et.value
                    ? 'bg-emerald-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                {et.label}
              </button>
            ))}
          </div>
        </div>

        <span className="ml-auto text-xs text-muted-foreground">
          {entries.length} events
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading activity log...
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-12 text-center">
          <ScrollText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No events found for this date and filter
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'rounded-lg border border-border bg-card border-l-4 transition-colors',
                SEVERITY_STYLES[entry.severity] ?? 'border-l-zinc-500',
              )}
            >
              <button
                type="button"
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors"
              >
                {/* Timestamp */}
                <span className="w-20 shrink-0 text-xs font-mono text-muted-foreground">
                  {formatTime(entry.timestamp)}
                </span>

                {/* Event type badge */}
                <span
                  className={cn(
                    'w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-semibold',
                    EVENT_BADGE_STYLES[entry.category] ?? 'bg-zinc-500/20 text-zinc-400',
                  )}
                >
                  {entry.category}
                </span>

                {/* Symbol */}
                {entry.symbol && (
                  <span className="w-16 shrink-0 text-xs font-bold text-foreground">
                    {entry.symbol}
                  </span>
                )}

                {/* Summary */}
                <span className="flex-1 truncate text-sm text-foreground">
                  {entry.summary}
                </span>

                {/* Severity dot */}
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    entry.severity === 'error'
                      ? 'bg-red-500'
                      : entry.severity === 'warn'
                        ? 'bg-yellow-500'
                        : 'bg-zinc-500',
                  )}
                />

                {/* Expand icon */}
                {entry.details && (
                  expandedId === entry.id ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )
                )}
              </button>

              {/* Expanded details */}
              {expandedId === entry.id && entry.details && (
                <div className="border-t border-border px-4 py-3">
                  <pre className="overflow-x-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
