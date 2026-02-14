'use client';

import useSWR from 'swr';
import { RefreshCw } from 'lucide-react';
import { api, fetcher } from '@/lib/api';
import type { ConfigResponse } from '@/lib/types';
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
};

export default function SettingsPage() {
  const { data: config, mutate } = useSWR<ConfigResponse>('/api/config', fetcher);

  const categories = config
    ? CATEGORY_ORDER.filter((cat) => config[cat]?.length > 0).map((cat) => ({
        key: cat,
        label: CATEGORY_LABELS[cat] || cat,
        items: config[cat],
      }))
    : [];

  // Also include any categories not in the predefined order
  if (config) {
    for (const cat of Object.keys(config)) {
      if (!CATEGORY_ORDER.includes(cat) && config[cat].length > 0) {
        categories.push({
          key: cat,
          label: cat,
          items: config[cat],
        });
      }
    }
  }

  async function handleRefreshPairlist() {
    await api.refreshPairlist();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure all bot parameters
          </p>
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

      {!config && (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Loading configuration...
        </div>
      )}

      <div className="space-y-6">
        {categories.map((cat) => (
          <ConfigEditor
            key={cat.key}
            category={cat.label}
            items={cat.items}
            onUpdate={() => mutate()}
          />
        ))}
      </div>
    </div>
  );
}
