'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ResearchReport, ResearchResult } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';
import { FlaskConical, Loader2, Play, ChevronDown, ChevronUp } from 'lucide-react';

const RECOMMENDATION_COLORS: Record<string, string> = {
  strong_buy: 'bg-green-500/20 text-green-400 border-green-500/30',
  buy: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  hold: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  sell: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  strong_sell: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function getRecommendationStyle(rec: string): string {
  const key = rec.toLowerCase().replace(/[\s-]/g, '_');
  return RECOMMENDATION_COLORS[key] ?? 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30';
}

export default function ResearchPage() {
  const [reports, setReports] = useState<ResearchReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [focus, setFocus] = useState('');
  const [symbols, setSymbols] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);

  const loadReports = async () => {
    try {
      const data = await api.getResearch();
      setReports(data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load research');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleRunResearch = async () => {
    setRunning(true);
    setError(null);
    try {
      const params: { focus?: string; symbols?: string[] } = {};
      if (focus.trim()) params.focus = focus.trim();
      if (symbols.trim()) {
        params.symbols = symbols
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
      }
      await api.runResearch(Object.keys(params).length > 0 ? params : undefined);
      await loadReports();
      setFocus('');
      setSymbols('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run research');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading research reports...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">AI Market Research</h1>
        <p className="text-sm text-muted-foreground">
          Run AI-powered market research and view past reports
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Run Research */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Run New Research</h2>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Focus (optional)
            </label>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. tech sector momentum"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Symbols (optional, comma-separated)
            </label>
            <input
              type="text"
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              placeholder="e.g. AAPL, MSFT, GOOGL"
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleRunResearch}
          disabled={running}
          className={cn(
            'flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700',
            running && 'opacity-50 cursor-not-allowed',
          )}
        >
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Running...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run Research
            </>
          )}
        </button>
      </div>

      {/* Reports List */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Past Reports ({reports.length})
        </h2>

        {reports.length === 0 ? (
          <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground">
            No research reports yet. Run your first research above.
          </div>
        ) : (
          reports.map((report) => (
            <div
              key={report.id}
              className="rounded-lg border border-border bg-card"
            >
              {/* Report header */}
              <button
                type="button"
                onClick={() =>
                  setExpandedReport(expandedReport === report.id ? null : report.id)
                }
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors"
              >
                <div>
                  <div className="text-sm font-medium">
                    {report.query || 'General Research'}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span>{formatDateTime(report.timestamp)}</span>
                    {report.aiModel && <span>{report.aiModel}</span>}
                    <span>{report.results.length} results</span>
                  </div>
                </div>
                {expandedReport === report.id ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>

              {/* Expanded results */}
              {expandedReport === report.id && (
                <div className="border-t border-border divide-y divide-border">
                  {report.results.map((result, idx) => (
                    <ResearchResultCard key={idx} result={result} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ResearchResultCard({ result }: { result: ResearchResult }) {
  const convictionWidth = Math.min(Math.max(result.conviction, 0), 100);

  return (
    <div className="px-4 py-4 space-y-3">
      {/* Symbol + Recommendation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-base font-bold">{result.symbol}</span>
          <span
            className={cn(
              'rounded border px-2 py-0.5 text-xs font-semibold uppercase',
              getRecommendationStyle(result.recommendation),
            )}
          >
            {result.recommendation.replace(/_/g, ' ')}
          </span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {result.sector}
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {result.targetPrice != null && (
            <span>
              Target: <span className="text-foreground font-medium">${result.targetPrice.toFixed(2)}</span>
            </span>
          )}
          <span>
            Horizon: <span className="text-foreground font-medium">{result.timeHorizon}</span>
          </span>
        </div>
      </div>

      {/* Conviction bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Conviction</span>
          <span className="font-medium">{result.conviction}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className={cn(
              'h-2 rounded-full transition-all',
              result.conviction >= 70
                ? 'bg-emerald-500'
                : result.conviction >= 40
                  ? 'bg-yellow-500'
                  : 'bg-red-500',
            )}
            style={{ width: `${convictionWidth}%` }}
          />
        </div>
      </div>

      {/* Reasoning */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {result.reasoning}
      </p>

      {/* Catalysts + Risks */}
      <div className="grid grid-cols-2 gap-4">
        {result.catalysts.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold text-emerald-400">
              Catalysts
            </h4>
            <ul className="space-y-1">
              {result.catalysts.map((c, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  + {c}
                </li>
              ))}
            </ul>
          </div>
        )}
        {result.risks.length > 0 && (
          <div>
            <h4 className="mb-1 text-xs font-semibold text-red-400">Risks</h4>
            <ul className="space-y-1">
              {result.risks.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground">
                  - {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
