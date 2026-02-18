'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { PairlistResponse } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';
import { BarChart3, ListFilter, Plus, RefreshCw, X } from 'lucide-react';

type PairlistMode = 'dynamic' | 'static' | 'hybrid';

export default function PairlistPage() {
  const [pairlist, setPairlist] = useState<PairlistResponse | null>(null);
  const [staticSymbols, setStaticSymbols] = useState<string[]>([]);
  const [mode, setMode] = useState<PairlistMode>('dynamic');
  const [filterStats, setFilterStats] = useState<Record<string, number> | null>(null);
  const [newSymbol, setNewSymbol] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [changingMode, setChangingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPairlist = async () => {
    try {
      const data = await api.getPairlist();
      setPairlist(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pairlist');
    }
  };

  const loadStaticSymbols = async () => {
    try {
      const data = await api.getStaticSymbols();
      setStaticSymbols(data.symbols);
    } catch {
      // ignore - static symbols may not be configured
    }
  };

  const loadMode = async () => {
    try {
      const config = await api.getConfig();
      const pairlistConfig = config.pairlist;
      if (pairlistConfig) {
        const modeItem = pairlistConfig.find((c) => c.key === 'pairlist.mode');
        if (modeItem?.value) setMode(modeItem.value as PairlistMode);
      }
    } catch {
      // ignore
    }
  };

  const loadFilterStats = async () => {
    try {
      const data = await api.getPairlistHistory();
      if (data.history.length > 0) {
        setFilterStats(data.history[0].filterStats);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const loadAll = async () => {
      await Promise.all([loadPairlist(), loadStaticSymbols(), loadMode(), loadFilterStats()]);
      setLoading(false);
    };
    loadAll();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshPairlist();
      // Wait briefly for the pipeline to run, then reload
      await new Promise((r) => setTimeout(r, 1000));
      await Promise.all([loadPairlist(), loadFilterStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddSymbol = async () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;
    setAddingSymbol(true);
    setError(null);
    try {
      const result = await api.addStaticSymbol(symbol);
      setStaticSymbols(result.symbols);
      setNewSymbol('');
      // Auto-refresh pairlist after adding
      await api.refreshPairlist();
      await new Promise((r) => setTimeout(r, 1000));
      await Promise.all([loadPairlist(), loadFilterStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add symbol');
    } finally {
      setAddingSymbol(false);
    }
  };

  const handleRemoveSymbol = async (symbol: string) => {
    try {
      const result = await api.removeStaticSymbol(symbol);
      setStaticSymbols(result.symbols);
      // Auto-refresh pairlist after removing
      await api.refreshPairlist();
      await new Promise((r) => setTimeout(r, 1000));
      await Promise.all([loadPairlist(), loadFilterStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove symbol');
    }
  };

  const handleModeChange = async (newMode: PairlistMode) => {
    setChangingMode(true);
    setError(null);
    try {
      await api.updateConfig('pairlist.mode', newMode);
      setMode(newMode);
      // Auto-refresh pairlist after mode change
      await api.refreshPairlist();
      await new Promise((r) => setTimeout(r, 1000));
      await Promise.all([loadPairlist(), loadFilterStats()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change mode');
    } finally {
      setChangingMode(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading pairlist...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold">Pairlist</h1>
            <p className="text-sm text-muted-foreground">
              Manage active trading symbols and filters
            </p>
          </div>
          {/* Mode badge */}
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
              mode === 'dynamic' && 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30',
              mode === 'static' && 'bg-blue-500/10 text-blue-400 border border-blue-500/30',
              mode === 'hybrid' && 'bg-purple-500/10 text-purple-400 border border-purple-500/30',
            )}
          >
            {mode}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {pairlist?.lastRefreshed && (
            <span className="text-xs text-muted-foreground">
              Last refreshed: {formatDateTime(pairlist.lastRefreshed)}
            </span>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn(
              'flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80',
              refreshing && 'opacity-50 cursor-not-allowed',
            )}
          >
            <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            Refresh Now
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Mode Selector */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Pipeline Mode</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Controls how the trading universe is assembled
          </p>
        </div>
        <div className="p-4 flex gap-3">
          {(['dynamic', 'static', 'hybrid'] as PairlistMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={changingMode}
              onClick={() => handleModeChange(m)}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                mode === m
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
                changingMode && 'opacity-50 cursor-not-allowed',
              )}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
              <span className="block text-xs font-normal opacity-70 mt-0.5">
                {m === 'dynamic' && 'Filters only'}
                {m === 'static' && 'Manual symbols'}
                {m === 'hybrid' && 'Static + filtered'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Active Pairlist + Filter Stats */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Active Pairlist</h2>
          <span className="ml-auto rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {pairlist?.stocks.length ?? 0} symbols
          </span>
        </div>

        {/* Filter stats bar */}
        {filterStats && Object.keys(filterStats).length > 0 && (
          <div className="border-b border-border px-4 py-2 flex items-center gap-1.5 flex-wrap">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground mr-1">Filters:</span>
            {Object.entries(filterStats).map(([name, dropped]) => (
              <span
                key={name}
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs',
                  dropped > 0
                    ? 'bg-red-500/10 text-red-400'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {name}: {dropped > 0 ? `-${dropped}` : '0'}
              </span>
            ))}
          </div>
        )}

        <div className="p-4">
          {pairlist?.stocks.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No symbols in pairlist
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pairlist?.stocks.map((symbol) => (
                <span
                  key={symbol}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium',
                    staticSymbols.includes(symbol)
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                      : 'bg-muted text-foreground',
                  )}
                >
                  {symbol}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Static Symbols Management */}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Static Symbols</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Manually added symbols — always included in static and hybrid modes
          </p>
        </div>
        <div className="p-4 space-y-4">
          {/* Add symbol input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddSymbol();
              }}
              placeholder="Enter symbol (e.g. AAPL)"
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <button
              type="button"
              onClick={handleAddSymbol}
              disabled={addingSymbol || !newSymbol.trim()}
              className={cn(
                'flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700',
                (addingSymbol || !newSymbol.trim()) && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          {/* Static symbols list */}
          {staticSymbols.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No static symbols added
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staticSymbols.map((symbol) => (
                <span
                  key={symbol}
                  className="flex items-center gap-1.5 rounded-md bg-blue-500/10 border border-blue-500/30 px-3 py-1.5 text-sm font-medium text-blue-400"
                >
                  {symbol}
                  <button
                    type="button"
                    onClick={() => handleRemoveSymbol(symbol)}
                    className="rounded-full p-0.5 hover:bg-blue-500/20 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
