'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { PairlistResponse } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';
import { ListFilter, Plus, RefreshCw, X } from 'lucide-react';

export default function PairlistPage() {
  const [pairlist, setPairlist] = useState<PairlistResponse | null>(null);
  const [staticSymbols, setStaticSymbols] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPairlist = async () => {
    try {
      const data = await api.getPairlist();
      setPairlist(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pairlist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPairlist();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshPairlist();
      await loadPairlist();
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
      await loadPairlist();
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
      await loadPairlist();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove symbol');
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
        <div>
          <h1 className="text-2xl font-bold">Pairlist</h1>
          <p className="text-sm text-muted-foreground">
            Manage active trading symbols and filters
          </p>
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

      {/* Active Pairlist */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ListFilter className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Active Pairlist</h2>
          <span className="ml-auto rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {pairlist?.stocks.length ?? 0} symbols
          </span>
        </div>
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
                  className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground"
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
            Manually added symbols that are always included in the pairlist
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
