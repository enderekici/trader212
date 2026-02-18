'use client';

import { useState, useMemo } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import useSWR from 'swr';
import { api, fetcher } from '@/lib/api';
import type { ConfigResponse, ConfigItem } from '@/lib/types';
import { ConfigEditor } from '@/components/config-editor';

const CATEGORY_ORDER = [
  'trading212',
  'pairlist',
  'dataSources',
  'analysis',
  'ai',
  'risk',
  'execution',
  'exit',
  'dca',
  'partialExit',
  'multiTimeframe',
  'regime',
  'protection',
  'webhook',
  'attribution',
  'riskParity',
  'tax',
  'monteCarlo',
  'portfolioOptimization',
  'socialSentiment',
  'conditionalOrders',
  'aiSelfImprovement',
  'reports',
  'webResearch',
  'monitoring',
];

const CATEGORY_LABELS: Record<string, string> = {
  trading212: 'Trading212',
  pairlist: 'Pairlist',
  dataSources: 'Data Sources',
  analysis: 'Analysis',
  ai: 'AI Model',
  risk: 'Risk Management',
  execution: 'Execution',
  monitoring: 'Monitoring',
  exit: 'Exit Rules',
  dca: 'DCA (Dollar Cost Averaging)',
  partialExit: 'Partial Exit / Scale-Out',
  multiTimeframe: 'Multi-Timeframe Analysis',
  regime: 'Market Regime Detection',
  protection: 'Protections',
  webhook: 'Webhooks',
  attribution: 'Performance Attribution',
  riskParity: 'Risk Parity Sizing',
  tax: 'Tax Awareness',
  monteCarlo: 'Monte Carlo Simulation',
  portfolioOptimization: 'Portfolio Optimization',
  socialSentiment: 'Social Sentiment',
  conditionalOrders: 'Conditional / OCO Orders',
  aiSelfImprovement: 'AI Self-Improvement',
  reports: 'Scheduled Reports',
  webResearch: 'Web Research (Steer)',
};

// Keys shown in Quick Settings (also appear in their regular category)
const QUICK_KEYS = [
  't212.environment',
  't212.accountType',
  'ai.provider',
  'pairlist.mode',
  'pairlist.maxPairs',
  'risk.maxPositions',
  'risk.maxPortfolioRisk',
  'risk.stopLossPct',
];

// Categories expanded by default
const DEFAULT_OPEN = new Set(['trading212', 'ai', 'risk']);

export default function SettingsPage() {
  const { data: config, mutate } = useSWR<ConfigResponse>('/api/config', fetcher);
  const [search, setSearch] = useState('');
  const [openCategories, setOpenCategories] = useState<Set<string>>(DEFAULT_OPEN);

  const categories = useMemo(() => {
    if (!config) return [];
    const cats = CATEGORY_ORDER.filter((cat) => config[cat]?.length > 0).map((cat) => ({
      key: cat,
      label: CATEGORY_LABELS[cat] || cat,
      items: config[cat],
    }));
    // Also include any categories not in the predefined order
    for (const cat of Object.keys(config)) {
      if (!CATEGORY_ORDER.includes(cat) && config[cat].length > 0) {
        cats.push({ key: cat, label: cat, items: config[cat] });
      }
    }
    return cats;
  }, [config]);

  // Quick Settings items
  const quickItems = useMemo(() => {
    if (!config) return [];
    const allItems: ConfigItem[] = Object.values(config).flat();
    return QUICK_KEYS.map((k) => allItems.find((i) => i.key === k)).filter(Boolean) as ConfigItem[];
  }, [config]);

  // Search filtering
  const q = search.toLowerCase().trim();
  const filteredCategories = useMemo(() => {
    if (!q) return categories;
    return categories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter(
          (item) =>
            item.key.toLowerCase().includes(q) ||
            item.description?.toLowerCase().includes(q),
        ),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [categories, q]);

  function toggleCategory(key: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // When searching, treat all matching categories as open
  function isCategoryOpen(key: string) {
    if (q) return true;
    return openCategories.has(key);
  }

  async function handleRefreshPairlist() {
    await api.refreshPairlist();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Configure all bot parameters</p>
        </div>
        <button
          type="button"
          onClick={handleRefreshPairlist}
          className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh Pairlist
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search settings..."
          className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-9 text-sm text-foreground outline-none focus:border-ring placeholder:text-muted-foreground"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!config && (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading configuration...
        </div>
      )}

      {/* Quick Settings — hidden during search */}
      {!q && quickItems.length > 0 && (
        <ConfigEditor
          category="⚡ Quick Settings"
          items={quickItems}
          onUpdate={() => mutate()}
          defaultOpen
          isQuick
        />
      )}

      {/* Category sections */}
      <div className="space-y-2">
        {filteredCategories.map((cat) => (
          <ConfigEditor
            key={cat.key}
            category={cat.label}
            items={cat.items}
            onUpdate={() => mutate()}
            defaultOpen={isCategoryOpen(cat.key)}
            onToggle={() => toggleCategory(cat.key)}
          />
        ))}
        {q && filteredCategories.length === 0 && (
          <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No settings match &quot;{search}&quot;
          </div>
        )}
      </div>
    </div>
  );
}
