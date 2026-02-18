'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { WatchlistEntry, ScreenerResult, ResearchReport } from '@/lib/types';

type Tab = 'watchlist' | 'screener' | 'ideas';

export default function ResearchPage() {
  const [tab, setTab] = useState<Tab>('ideas');

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Research</h1>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-700">
        {(['ideas', 'watchlist', 'screener'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'ideas' ? 'Trade Ideas' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'ideas' && <IdeasTab />}
      {tab === 'watchlist' && <WatchlistTab />}
      {tab === 'screener' && <ScreenerTab />}
    </div>
  );
}

// ── Status badge helpers ──────────────────────────────────────────────────

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'watching':
      return 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
    case 'completed':
      return 'bg-green-500/20 text-green-400 border border-green-500/30';
    case 'rejected':
      return 'bg-red-500/20 text-red-400 border border-red-500/30';
    default:
      return 'bg-gray-700/50 text-gray-400 border border-gray-600';
  }
}

function formatMarketCap(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

// ── Ideas Tab ─────────────────────────────────────────────────────────────

function IdeasTab() {
  const [reports, setReports] = useState<ResearchReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [focus, setFocus] = useState('');
  const [symbols, setSymbols] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<number | null>(null);

  const loadReports = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getResearch();
      setReports(data.reports as ResearchReport[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

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

  const handleStatusUpdate = async (id: number, status: string) => {
    setStatusUpdating(id);
    try {
      await api.updateIdeaStatus(id, status);
      setReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setStatusUpdating(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Run Research panel */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-4">
        <h2 className="text-sm font-semibold text-gray-200">Run New Research</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs text-gray-400">Focus (optional)</label>
            <input
              type="text"
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. tech sector momentum"
              className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-400">
              Symbols (optional, comma-separated)
            </label>
            <input
              type="text"
              value={symbols}
              onChange={(e) => setSymbols(e.target.value)}
              placeholder="e.g. AAPL, MSFT, GOOGL"
              className="w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleRunResearch}
          disabled={running}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? 'Running...' : 'Run Research'}
        </button>
      </div>

      {/* Reports list */}
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading reports...</div>
      ) : reports.length === 0 ? (
        <div className="rounded-lg border border-gray-700 py-12 text-center text-sm text-gray-500">
          No research reports yet. Run your first research above.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => {
            const reportStatus = report.status ?? 'pending';
            const symbolList: string[] = Array.isArray(report.results)
              ? report.results.map((r: { symbol: string }) => r.symbol)
              : [];
            return (
              <div
                key={report.id}
                className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-gray-200">
                      {report.query || 'General Research'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(report.timestamp).toLocaleString()} · {report.aiModel ?? '—'}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {symbolList.slice(0, 8).map((sym) => (
                        <span
                          key={sym}
                          className="rounded bg-gray-700 px-1.5 py-0.5 text-xs text-gray-300"
                        >
                          {sym}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(reportStatus)}`}
                  >
                    {reportStatus}
                  </span>
                </div>
                {/* Status buttons */}
                <div className="flex gap-2">
                  {(['watching', 'completed', 'rejected'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={statusUpdating === report.id || reportStatus === s}
                      onClick={() => handleStatusUpdate(report.id, s)}
                      className={`rounded px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        reportStatus === s
                          ? statusBadgeClass(s)
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Watchlist Tab ─────────────────────────────────────────────────────────

function WatchlistTab() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getResearchWatchlist();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load watchlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    const sym = symbolInput.trim().toUpperCase();
    if (!sym) return;
    setAdding(true);
    setError(null);
    try {
      await api.addToWatchlist(sym, notesInput.trim() || undefined);
      setSymbolInput('');
      setNotesInput('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add symbol');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (symbol: string) => {
    try {
      await api.removeFromWatchlist(symbol);
      setEntries((prev) => prev.filter((e) => e.symbol !== symbol));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove symbol');
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Add symbol */}
      <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-200">Add Symbol</h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Symbol (e.g. AAPL)"
            className="w-32 rounded-md border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 uppercase"
          />
          <input
            type="text"
            value={notesInput}
            onChange={(e) => setNotesInput(e.target.value)}
            placeholder="Notes (optional)"
            className="flex-1 rounded-md border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || !symbolInput.trim()}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading watchlist...</div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-gray-700 py-12 text-center text-sm text-gray-500">
          No symbols in watchlist yet.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/80">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Symbol
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Notes
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Date Added
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-gray-200">{entry.symbol}</td>
                  <td className="px-4 py-3 text-gray-400">{entry.notes ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(entry.addedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleRemove(entry.symbol)}
                      className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Screener Tab ──────────────────────────────────────────────────────────

const SECTORS = [
  '',
  'Technology',
  'Healthcare',
  'Finance',
  'Energy',
  'Consumer',
  'Industrial',
  'Other',
];

function ScreenerTab() {
  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sector, setSector] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [watchlistAdding, setWatchlistAdding] = useState<string | null>(null);

  const runScreener = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { sector?: string } = {};
      if (sector) params.sector = sector;
      const data = await api.screenStocks(params);
      let filtered = data.results;
      if (sector) {
        filtered = filtered.filter(
          (r) => r.sector?.toLowerCase().includes(sector.toLowerCase()),
        );
      }
      setResults(filtered);
      setUpdatedAt(data.screenerUpdatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run screener');
    } finally {
      setLoading(false);
    }
  }, [sector]);

  const handleWatch = async (symbol: string) => {
    setWatchlistAdding(symbol);
    try {
      await api.addToWatchlist(symbol);
    } catch {
      // silently ignore duplicate errors
    } finally {
      setWatchlistAdding(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3">
        <select
          value={sector}
          onChange={(e) => setSector(e.target.value)}
          className="rounded-md border border-gray-600 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {s || 'All Sectors'}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={runScreener}
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Running...' : 'Run Screener'}
        </button>
        {updatedAt && (
          <span className="text-xs text-gray-500">
            Last updated: {new Date(updatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Results */}
      {results.length === 0 && !loading ? (
        <div className="rounded-lg border border-gray-700 py-12 text-center text-sm text-gray-500">
          Click &quot;Run Screener&quot; to load results.
        </div>
      ) : (
        <div className="rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/80">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Symbol
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Sector
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Market Cap
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                  P/E
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Score
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                  Updated
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {results.map((r) => (
                <tr key={r.symbol} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 font-semibold text-gray-200">{r.symbol}</td>
                  <td className="px-4 py-3 text-gray-400">{r.sector ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {formatMarketCap(r.marketCap)}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {r.peRatio != null ? r.peRatio.toFixed(1) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.score != null ? (
                      <span
                        className={
                          r.score >= 0.6
                            ? 'text-green-400'
                            : r.score >= 0.4
                              ? 'text-yellow-400'
                              : 'text-red-400'
                        }
                      >
                        {(r.score * 100).toFixed(0)}
                      </span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleWatch(r.symbol)}
                      disabled={watchlistAdding === r.symbol}
                      className="rounded px-2 py-1 text-xs text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 transition-colors"
                    >
                      {watchlistAdding === r.symbol ? '...' : 'Watch'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
