import type {
  AuditEntry,
  ConfigResponse,
  DailyMetricsResponse,
  PairlistResponse,
  PerformanceResponse,
  PortfolioResponse,
  ResearchReport,
  SignalsResponse,
  StatusResponse,
  TradePlan,
  TradesResponse,
} from './types';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Portfolio
  getPortfolio: () => fetchApi<PortfolioResponse>('/api/portfolio'),

  // Trades
  getTrades: (params?: {
    symbol?: string;
    from?: string;
    to?: string;
    side?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.symbol) qs.set('symbol', params.symbol);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.side) qs.set('side', params.side);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return fetchApi<TradesResponse>(`/api/trades${q ? `?${q}` : ''}`);
  },

  // Signals
  getSignals: (params?: {
    symbol?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.symbol) qs.set('symbol', params.symbol);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return fetchApi<SignalsResponse>(`/api/signals${q ? `?${q}` : ''}`);
  },

  getLatestSignal: (symbol: string) =>
    fetchApi<{ signal: import('./types').Signal }>(`/api/signals/${symbol}/latest`),

  // Performance
  getPerformance: () => fetchApi<PerformanceResponse>('/api/performance'),
  getDailyMetrics: () => fetchApi<DailyMetricsResponse>('/api/performance/daily'),

  // Status
  getStatus: () => fetchApi<StatusResponse>('/api/status'),

  // Pairlist
  getPairlist: () => fetchApi<PairlistResponse>('/api/pairlist'),

  // Config
  getConfig: () => fetchApi<ConfigResponse>('/api/config'),
  updateConfig: (key: string, value: unknown) =>
    fetchApi<{ key: string; value: unknown; updated: boolean }>(`/api/config/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),

  // Control
  pause: () => fetchApi<{ status: string }>('/api/control/pause', { method: 'POST' }),
  resume: () => fetchApi<{ status: string }>('/api/control/resume', { method: 'POST' }),
  closePosition: (symbol: string) =>
    fetchApi<{ message: string }>(`/api/control/close/${symbol}`, { method: 'POST' }),
  analyzeSymbol: (symbol: string) =>
    fetchApi<{ message: string }>(`/api/control/analyze/${symbol}`, { method: 'POST' }),
  refreshPairlist: () =>
    fetchApi<{ message: string }>('/api/control/refresh-pairlist', { method: 'POST' }),

  // Trade Plans
  getTradePlans: () => fetchApi<{ plans: TradePlan[] }>('/api/trade-plans'),
  approveTradePlan: (id: number) =>
    fetchApi<{ plan: TradePlan }>(`/api/trade-plans/${id}/approve`, { method: 'POST' }),
  rejectTradePlan: (id: number) =>
    fetchApi<{ message: string }>(`/api/trade-plans/${id}/reject`, { method: 'POST' }),

  // Research
  getResearch: () => fetchApi<{ reports: ResearchReport[] }>('/api/research'),
  runResearch: (params?: { focus?: string; symbols?: string[] }) =>
    fetchApi<{ report: ResearchReport }>('/api/research/run', {
      method: 'POST',
      body: JSON.stringify(params ?? {}),
    }),

  // Audit
  getAuditLog: (params?: { date?: string; type?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set('date', params.date);
    if (params?.type) qs.set('type', params.type);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return fetchApi<{ entries: AuditEntry[] }>(`/api/audit${q ? `?${q}` : ''}`);
  },

  // Pairlist management
  addStaticSymbol: (symbol: string) =>
    fetchApi<{ symbols: string[] }>('/api/pairlist/static', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    }),
  removeStaticSymbol: (symbol: string) =>
    fetchApi<{ symbols: string[] }>(`/api/pairlist/static/${symbol}`, { method: 'DELETE' }),

  // Circuit breaker
  emergencyStop: () =>
    fetchApi<{ message: string }>('/api/control/emergency-stop', { method: 'POST' }),
};

// SWR fetcher
export const fetcher = <T>(path: string): Promise<T> => fetchApi<T>(path);
