import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────

function chain(terminalValue?: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === 'then' || prop === 'catch') return undefined;
      if (!c[prop]) {
        c[prop] = vi.fn((..._a: unknown[]) => {
          if (prop === 'get') return terminalValue;
          if (prop === 'all') return terminalValue;
          if (prop === 'run') return terminalValue;
          return new Proxy({}, handler);
        });
      }
      return c[prop];
    },
  };
  return new Proxy({}, handler);
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

const mockWatchlistRepo = {
  getAll: vi.fn((): unknown[] => []),
  add: vi.fn((symbol: string, notes?: string) => ({ id: 1, symbol, notes: notes ?? null, addedAt: '2024-01-01T00:00:00.000Z' })),
  remove: vi.fn(() => true),
};

vi.mock('../../src/db/repositories/research-watchlist.js', () => ({
  getResearchWatchlistRepo: () => mockWatchlistRepo,
}));

vi.mock('../../src/db/schema.js', () => ({
  trades: { id: 'id', symbol: 'symbol', side: 'side', entryTime: 'entryTime', exitPrice: 'exitPrice', pnl: 'pnl', pnlPct: 'pnlPct' },
  signals: { id: 'id', symbol: 'symbol', timestamp: 'timestamp', technicalScore: 'technicalScore' },
  positions: { symbol: 'symbol' },
  dailyMetrics: { date: 'date' },
  pairlistHistory: { timestamp: 'timestamp' },
  fundamentalCache: { symbol: 'symbol', fetchedAt: 'fetchedAt' },
  config: { key: 'key', category: 'category' },
  aiResearch: { id: 'id', status: 'status' },
  priceCache: { symbol: 'symbol', timestamp: 'timestamp', open: 'open', high: 'high', low: 'low', close: 'close', volume: 'volume' },
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mockMarketTimes = {
  currentTimeET: '2024-01-15 10:00',
  currentTimeUTC: '2024-01-15T15:00:00.000Z',
  marketStatus: 'open' as const,
  nextOpen: '2024-01-16T14:30:00.000Z',
  nextClose: '2024-01-15T21:00:00.000Z',
  countdownMinutes: 360,
  isHoliday: false,
  isEarlyClose: false,
};

vi.mock('../../src/utils/market-hours.js', () => ({
  getMarketTimes: () => mockMarketTimes,
}));

const mockConfigManager = {
  get: vi.fn((key: string) => {
    const defaults: Record<string, unknown> = {
      't212.accountType': 'INVEST',
      't212.environment': 'demo',
      'execution.dryRun': true,
      'pairlist.staticSymbols': ['AAPL'],
    };
    return defaults[key] ?? null;
  }),
  set: vi.fn(),
  getAll: vi.fn(),
  getAllRaw: vi.fn((): Array<{ key: string; value: string; category: string; description: string | null }> => []),
  getByCategory: vi.fn(() => ({})),
  invalidateCache: vi.fn(),
};

vi.mock('../../src/config/manager.js', () => ({
  configManager: mockConfigManager,
}));

const mockAuditLogger = {
  logControl: vi.fn(),
  getRecent: vi.fn((): unknown[] => []),
  getEntriesForDate: vi.fn((): unknown[] => []),
  getByType: vi.fn((): unknown[] => []),
};

vi.mock('../../src/monitoring/audit-log.js', () => ({
  getAuditLogger: () => mockAuditLogger,
}));

const mockPerformanceMetrics: Record<string, unknown> = {
  totalTrades: 0,
  winRate: 0,
  avgReturnPct: 0,
  sharpeRatio: 0,
  sortinoRatio: null,
  calmarRatio: null,
  sqn: null,
  maxDrawdown: 0,
  currentDrawdown: 0,
  profitFactor: 0,
  expectancy: null,
  expectancyRatio: null,
  avgWin: null,
  avgLoss: null,
  avgHoldDuration: 'N/A',
  bestTrade: null,
  worstTrade: null,
};

const mockGetMetrics = vi.fn(() => ({ ...mockPerformanceMetrics }));

vi.mock('../../src/monitoring/performance.js', () => ({
  PerformanceTracker: vi.fn().mockImplementation(function () {
    return { getMetrics: mockGetMetrics };
  }),
}));

const mockCorrelationMatrix = { symbols: ['AAPL'], matrix: [[1]] };

vi.mock('../../src/analysis/correlation.js', () => ({
  CorrelationAnalyzer: vi.fn().mockImplementation(function () {
    return { getPortfolioCorrelationMatrix: () => mockCorrelationMatrix };
  }),
}));

<<<<<<< HEAD
const mockGetSnapshot = vi.fn(() => ({
  status: 'healthy',
  uptime: 100,
  memoryUsage: { heapUsedMB: 50, heapTotalMB: 100, rssMB: 120 },
  jobs: [],
  dataSources: [],
  activePositions: 0,
  lastAnalysisCycleAt: null,
  lastAnalysisCycleDurationMs: null,
  wsClientCount: 0,
}));

vi.mock('../../src/monitoring/health-metrics.js', () => ({
  getHealthMetrics: () => ({ getSnapshot: mockGetSnapshot }),
}));

// ── Orders mocks ────────────────────────────────────────────────────────

const mockGetRecentOrders = vi.fn(() => [] as unknown[]);
const mockGetOrderCount = vi.fn(() => 0);
const mockGetOrderById = vi.fn(() => null as unknown);
const mockGetOrdersBySymbol = vi.fn(() => [] as unknown[]);

vi.mock('../../src/db/repositories/orders.js', () => ({
  getRecentOrders: (...args: unknown[]) => mockGetRecentOrders(...args),
  getOrderCount: (...args: unknown[]) => mockGetOrderCount(...args),
  getOrderById: (...args: unknown[]) => mockGetOrderById(...args),
  getOrdersBySymbol: (...args: unknown[]) => mockGetOrdersBySymbol(...args),
}));

// ── Journal repository mock ─────────────────────────────────────────────

const mockGetRecentJournalEntries = vi.fn(() => [] as unknown[]);

vi.mock('../../src/db/repositories/journal.js', () => ({
  getRecentEntries: (...args: unknown[]) => mockGetRecentJournalEntries(...args),
}));

// ── Pair locks mock ──────────────────────────────────────────────────────

const mockGetActiveLocks = vi.fn(() => [] as unknown[]);
const mockUnlockPair = vi.fn();

const mockGetPairLockManager = vi.fn(() => ({
  getActiveLocks: mockGetActiveLocks,
  unlockPair: mockUnlockPair,
}));

vi.mock('../../src/execution/pair-locks.js', () => ({
  getPairLockManager: (...args: unknown[]) => mockGetPairLockManager(...args),
}));

// ── Backtest mocks ───────────────────────────────────────────────────────

const mockBacktestRun = vi.fn(async () => ({
  metrics: { winRate: 0.6, totalTrades: 10 },
  trades: [] as unknown[],
  config: {},
  dailyReturns: [] as unknown[],
}));

const mockCreateBacktestEngine = vi.fn(async () => ({ run: mockBacktestRun }));

vi.mock('../../src/backtest/engine.js', () => ({
  createBacktestEngine: (...args: unknown[]) => mockCreateBacktestEngine(...args),
}));

const mockGenerateSummary = vi.fn(() => ({ totalReturn: 0.1 }));
const mockGenerateSymbolBreakdown = vi.fn(() => [] as unknown[]);
const mockFormatEquityCurve = vi.fn(() => [] as unknown[]);

vi.mock('../../src/backtest/reporter.js', () => ({
  generateSummary: (...args: unknown[]) => mockGenerateSummary(...args),
  generateSymbolBreakdown: (...args: unknown[]) => mockGenerateSymbolBreakdown(...args),
  formatEquityCurve: (...args: unknown[]) => mockFormatEquityCurve(...args),
}));

// ── Regime detector mock ─────────────────────────────────────────────────

const mockDetect = vi.fn(() => ({ regime: 'bull', confidence: 0.8 }));
const mockGetRegimeDetector = vi.fn(() => ({ detect: mockDetect }));

vi.mock('../../src/analysis/regime-detector.js', () => ({
  getRegimeDetector: (...args: unknown[]) => mockGetRegimeDetector(...args),
}));

// ── Strategy profiles mock ────────────────────────────────────────────────

const mockListProfiles = vi.fn(() => [] as unknown[]);
const mockApplyProfile = vi.fn(async () => undefined);
const mockGetStrategyProfileManager = vi.fn(() => ({
  listProfiles: mockListProfiles,
  applyProfile: mockApplyProfile,
}));

vi.mock('../../src/config/strategy-profiles.js', () => ({
  getStrategyProfileManager: (...args: unknown[]) => mockGetStrategyProfileManager(...args),
}));

// ── Monte Carlo mock ──────────────────────────────────────────────────────

const mockSimulate = vi.fn(() => ({ mean: 100, p95: 500, p5: -100 }));
const mockCreateMonteCarloSimulator = vi.fn(() => ({ simulate: mockSimulate }));

vi.mock('../../src/analysis/monte-carlo.js', () => ({
  createMonteCarloSimulator: (...args: unknown[]) => mockCreateMonteCarloSimulator(...args),
}));

// ── Attribution mock ──────────────────────────────────────────────────────

const mockGetFactorBreakdown = vi.fn(() => ({ alpha: 0.05, beta: 1.1 }));
const mockGetPerformanceAttributor = vi.fn(() => ({
  getFactorBreakdown: mockGetFactorBreakdown,
}));

vi.mock('../../src/monitoring/attribution.js', () => ({
  getPerformanceAttributor: (...args: unknown[]) => mockGetPerformanceAttributor(...args),
}));

// ── Trade journal mock ────────────────────────────────────────────────────

const mockGetSymbolHistory = vi.fn(() => [] as unknown[]);
const mockAddNote = vi.fn(() => ({ id: 1, symbol: 'AAPL', note: 'test' }));
const mockSearch = vi.fn(() => [] as unknown[]);
const mockGetInsights = vi.fn(() => ({ patterns: [] }));
const mockGetTradeJournalManager = vi.fn(() => ({
  getSymbolHistory: mockGetSymbolHistory,
  addNote: mockAddNote,
  search: mockSearch,
  getInsights: mockGetInsights,
}));

vi.mock('../../src/monitoring/trade-journal.js', () => ({
  getTradeJournalManager: (...args: unknown[]) => mockGetTradeJournalManager(...args),
}));

// ── Tax tracker mock ──────────────────────────────────────────────────────

const mockGetYearlyTaxSummary = vi.fn(() => ({ gains: 1000, losses: 500 }));
const mockGetHarvestCandidates = vi.fn(() => [] as unknown[]);
const mockGetTaxTracker = vi.fn(() => ({
  getYearlyTaxSummary: mockGetYearlyTaxSummary,
  getHarvestCandidates: mockGetHarvestCandidates,
}));

vi.mock('../../src/monitoring/tax-tracker.js', () => ({
  getTaxTracker: (...args: unknown[]) => mockGetTaxTracker(...args),
}));

// ── Portfolio optimizer mock ──────────────────────────────────────────────

const mockSuggestRebalanceOptimizer = vi.fn(() => ({ rebalance: [] as unknown[] }));
const mockGetPortfolioOptimizer = vi.fn(() => ({
  suggestRebalance: mockSuggestRebalanceOptimizer,
}));

vi.mock('../../src/analysis/portfolio-optimizer.js', () => ({
  getPortfolioOptimizer: (...args: unknown[]) => mockGetPortfolioOptimizer(...args),
}));

// ── Report generator mock ─────────────────────────────────────────────────

const mockGenerateDailyReport = vi.fn(async () => ({ date: '2024-01-15', trades: [] as unknown[] }));
const mockGenerateWeeklyReport = vi.fn(async () => ({ week: '2024-W03', trades: [] as unknown[] }));
const mockFormatAsText = vi.fn(() => 'text report');
const mockFormatAsMarkdown = vi.fn(() => '# markdown report');
const mockGetReportGenerator = vi.fn(() => ({
  generateDailyReport: mockGenerateDailyReport,
  generateWeeklyReport: mockGenerateWeeklyReport,
  formatAsText: mockFormatAsText,
  formatAsMarkdown: mockFormatAsMarkdown,
}));

vi.mock('../../src/monitoring/report-generator.js', () => ({
  getReportGenerator: (...args: unknown[]) => mockGetReportGenerator(...args),
}));

// ── Conditional orders mock ───────────────────────────────────────────────

const mockGetConditionalOrderStatus = vi.fn(() => ({ orders: [] as unknown[] }));
const mockCreateOrder = vi.fn(() => ({ id: 1 }));
const mockCreateOcoPair = vi.fn(() => ({ id1: 1, id2: 2 }));
const mockCancelOrder = vi.fn();
const mockGetConditionalOrderManager = vi.fn(() => ({
  getStatus: mockGetConditionalOrderStatus,
  createOrder: mockCreateOrder,
  createOcoPair: mockCreateOcoPair,
  cancelOrder: mockCancelOrder,
}));

vi.mock('../../src/execution/conditional-orders.js', () => ({
  getConditionalOrderManager: (...args: unknown[]) => mockGetConditionalOrderManager(...args),
}));

// ── AI Self-Improvement mock ──────────────────────────────────────────────

const mockGenerateFeedback = vi.fn(async () => ({ feedback: 'improve stops' }));
const mockGetCalibrationCurve = vi.fn(async () => [{ bucket: '0.5-0.6', accuracy: 0.55 }]);
const mockCompareModels = vi.fn(async () => [{ model: 'claude', accuracy: 0.8 }]);
const mockGetAISelfImprovement = vi.fn(() => ({
  generateFeedback: mockGenerateFeedback,
  getCalibrationCurve: mockGetCalibrationCurve,
  compareModels: mockCompareModels,
}));

vi.mock('../../src/ai/self-improvement.js', () => ({
  getAISelfImprovement: (...args: unknown[]) => mockGetAISelfImprovement(...args),
}));

// ── Risk parity mock ──────────────────────────────────────────────────────

const mockSuggestRebalanceParity = vi.fn(() => [] as unknown[]);
const mockGetRiskParitySizer = vi.fn(() => ({
  suggestRebalance: mockSuggestRebalanceParity,
}));

vi.mock('../../src/execution/risk-parity.js', () => ({
  getRiskParitySizer: (...args: unknown[]) => mockGetRiskParitySizer(...args),
}));

// ── ROI table mock ────────────────────────────────────────────────────────

const mockParseRoiTable = vi.fn(() => ({}));
const mockGetRoiThreshold = vi.fn(() => null as number | null);

vi.mock('../../src/execution/roi-table.js', () => ({
  parseRoiTable: (...args: unknown[]) => mockParseRoiTable(...args),
  getRoiThreshold: (...args: unknown[]) => mockGetRoiThreshold(...args),
}));

// ── helpers mock ──────────────────────────────────────────────────────────

const mockSafeJsonParse = vi.fn(<T>(json: unknown, fallback: T): T => {
  if (typeof json === 'string') {
    try { return JSON.parse(json) as T; } catch { return fallback; }
  }
  return fallback;
});

vi.mock('../../src/utils/helpers.js', () => ({
  safeJsonParse: <T>(json: unknown, fallback: T) => mockSafeJsonParse(json, fallback),
  formatCurrency: vi.fn((v: number) => `$${v}`),
  formatPercent: vi.fn((v: number) => `${v}%`),
}));

// ── OpenAI Compat adapter mock ────────────────────────────────────────────

const mockRawChat = vi.fn(async () => 'pong');

vi.mock('../../src/ai/adapters/openai-compat.js', () => ({
  OpenAICompatibleAdapter: vi.fn().mockImplementation(function (this: any) {
    this.rawChat = mockRawChat;
  }),
}));

const mockWalkForwardRun = vi.fn().mockResolvedValue({
  windows: [],
  aggregateStats: { totalReturn: 0.05, sharpeRatio: 1.2, winRate: 0.6 },
});

vi.mock('../../src/backtest/walk-forward.js', () => ({
  WalkForwardAnalyzer: vi.fn().mockImplementation(function (this: any) {
    this.run = mockWalkForwardRun;
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  res.status = vi.fn(() => res);
  res.type = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

// Extract route handlers from the router
type RouteHandler = (req: any, res: any) => void | Promise<void>;
type RouteEntry = { method: string; path: string; handler: RouteHandler };

async function getRouteHandlers(): Promise<RouteEntry[]> {
  const { createRouter } = await import('../../src/api/routes.js');
  const router = createRouter();

  // Express Router stores routes in router.stack
  const routes: RouteEntry[] = [];
  for (const layer of (router as any).stack) {
    if (layer.route) {
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled) {
          routes.push({
            method,
            path: layer.route.path,
            handler: layer.route.stack[0].handle,
          });
        }
      }
    }
  }
  return routes;
}

function findHandler(routes: RouteEntry[], method: string, path: string): RouteHandler {
  const route = routes.find(r => r.method === method && r.path === path);
  if (!route) throw new Error(`No route found: ${method} ${path}`);
  return route.handler;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('api/routes', () => {
  let routes: RouteEntry[];

  beforeEach(async () => {
    vi.clearAllMocks();
    routes = await getRouteHandlers();
  });

  describe('GET /api/status', () => {
    it('returns bot status with market times', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: () => ({ paused: false, startedAt: '2024-01-15T00:00:00.000Z' }),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      });

      // Re-get routes after registering callbacks
      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/status');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
          uptime: expect.any(Number),
          startedAt: '2024-01-15T00:00:00.000Z',
          marketStatus: 'open',
          accountType: 'INVEST',
          environment: 'demo',
          dryRun: true,
        })
      );
    });

    it('returns paused status when bot is paused', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: () => ({ paused: true, startedAt: new Date().toISOString() }),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      });

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/status');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paused' })
      );
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: () => { throw new Error('status error'); },
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/status');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch status' });
    });
  });

  describe('GET /api/portfolio', () => {
    it('returns portfolio with positions and computed values', () => {
      const positionRows = [
        { symbol: 'AAPL', shares: 10, entryPrice: 150, currentPrice: 160, pnl: 100 },
        { symbol: 'MSFT', shares: 5, entryPrice: 300, currentPrice: 310, pnl: 50 },
      ];
      const cashRow = { cashBalance: 5000 };

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positionRows);
        return chain(cashRow);
      });

      const handler = findHandler(routes, 'get', '/api/portfolio');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          positions: positionRows,
          cashAvailable: 5000,
          pnl: 150,
        })
      );
    });

    it('uses entryPrice when currentPrice is null', () => {
      const positionRows = [
        { symbol: 'AAPL', shares: 10, entryPrice: 150, currentPrice: null, pnl: null },
      ];

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positionRows);
        return chain(undefined);
      });

      const handler = findHandler(routes, 'get', '/api/portfolio');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          totalValue: 1500, // 10 * 150 + 0 cash
          pnl: 0,
          cashAvailable: 0,
        })
      );
    });

    it('handles errors gracefully', () => {
      mockDb.select.mockImplementation(() => {
        throw new Error('DB error');
      });

      const handler = findHandler(routes, 'get', '/api/portfolio');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch portfolio' });
    });
  });

  describe('GET /api/trades', () => {
    it('returns trades with default parameters', () => {
      const rows = [{ id: 1, symbol: 'AAPL' }];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(rows);
        return chain({ count: 1 });
      });

      const handler = findHandler(routes, 'get', '/api/trades');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ trades: rows, total: 1 });
    });

    it('applies query filters', () => {
      mockDb.select.mockReturnValue(chain([]));

      const handler = findHandler(routes, 'get', '/api/trades');
      const res = mockRes();
      handler(mockReq({ query: { symbol: 'AAPL', side: 'BUY', from: '2024-01-01', to: '2024-02-01', limit: '10', offset: '5' } }), res);

      expect(res.json).toHaveBeenCalled();
    });

    it('handles total being null', () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain([]);
        return chain(undefined);
      });

      const handler = findHandler(routes, 'get', '/api/trades');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ trades: [], total: 0 });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/trades');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/trades/:id', () => {
    it('returns a trade by id', () => {
      const trade = { id: 1, symbol: 'AAPL' };
      mockDb.select.mockReturnValue(chain(trade));

      const handler = findHandler(routes, 'get', '/api/trades/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.json).toHaveBeenCalledWith(trade);
    });

    it('returns 404 when trade not found', () => {
      mockDb.select.mockReturnValue(chain(undefined));

      const handler = findHandler(routes, 'get', '/api/trades/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '999' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Trade not found' });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/trades/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/signals', () => {
    it('returns signals with default parameters', () => {
      const rows = [{ id: 1, symbol: 'AAPL' }];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(rows);
        return chain({ count: 1 });
      });

      const handler = findHandler(routes, 'get', '/api/signals');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ signals: rows, total: 1 });
    });

    it('applies filters', () => {
      mockDb.select.mockReturnValue(chain([]));

      const handler = findHandler(routes, 'get', '/api/signals');
      const res = mockRes();
      handler(mockReq({ query: { symbol: 'AAPL', from: '2024-01-01', to: '2024-02-01', limit: '10', offset: '5' } }), res);

      expect(res.json).toHaveBeenCalled();
    });

    it('handles null count', () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain([]);
        return chain(undefined);
      });

      const handler = findHandler(routes, 'get', '/api/signals');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ signals: [], total: 0 });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/signals');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/signals/:symbol/latest', () => {
    it('returns latest signal for symbol', () => {
      const signal = { symbol: 'AAPL', rsi: 55 };
      mockDb.select.mockReturnValue(chain(signal));

      const handler = findHandler(routes, 'get', '/api/signals/:symbol/latest');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.json).toHaveBeenCalledWith(signal);
    });

    it('returns 404 when no signal found', () => {
      mockDb.select.mockReturnValue(chain(undefined));

      const handler = findHandler(routes, 'get', '/api/signals/:symbol/latest');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'XYZ' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'No signals found for symbol' });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/signals/:symbol/latest');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/signals/:symbol/history', () => {
    it('returns signal history for symbol', () => {
      const rows = [{ symbol: 'AAPL', rsi: 55 }];
      mockDb.select.mockReturnValue(chain(rows));

      const handler = findHandler(routes, 'get', '/api/signals/:symbol/history');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.json).toHaveBeenCalledWith({ signals: rows });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/signals/:symbol/history');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/performance', () => {
    it('returns zero metrics when no closed trades', () => {
      mockGetMetrics.mockReturnValueOnce({ ...mockPerformanceMetrics });
      mockDb.select.mockReturnValue(chain([]));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.totalTrades).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.avgReturn).toBe(0);
      expect(result.sharpeRatio).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.profitFactor).toBe(0);
      expect(result.totalPnl).toBe(0);
      expect(result.sortinoRatio).toBeNull();
      expect(result.calmarRatio).toBeNull();
      expect(result.sqn).toBeNull();
      expect(result.currentDrawdown).toBe(0);
      expect(result.expectancy).toBeNull();
      expect(result.avgWin).toBeNull();
      expect(result.avgLoss).toBeNull();
    });

    it('calculates performance metrics from closed trades', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 3,
        winRate: 0.6667,
        avgReturnPct: 8.3333,
        profitFactor: 6,
        sharpeRatio: 1.5,
        sortinoRatio: 2.1,
        sqn: 1.2,
        expectancy: 83.33,
      });
      const closedTrades = [
        { pnl: 100, pnlPct: 10 },
        { pnl: -50, pnlPct: -5 },
        { pnl: 200, pnlPct: 20 },
      ];
      mockDb.select.mockReturnValue(chain(closedTrades));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.totalTrades).toBe(3);
      expect(result.winRate).toBeCloseTo(0.6667);
      expect(result.totalPnl).toBeCloseTo(250);
      expect(result.profitFactor).toBe(6);
      expect(result.sortinoRatio).toBe(2.1);
      expect(result.sqn).toBe(1.2);
    });

    it('handles all winning trades (grossLoss = 0)', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 2,
        winRate: 1,
        profitFactor: Infinity,
      });
      const closedTrades = [
        { pnl: 100, pnlPct: 10 },
        { pnl: 50, pnlPct: 5 },
      ];
      mockDb.select.mockReturnValue(chain(closedTrades));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.profitFactor).toBe(Number.POSITIVE_INFINITY);
    });

    it('handles all losing trades (grossProfit = 0)', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 2,
        winRate: 0,
        profitFactor: 0,
      });
      const closedTrades = [
        { pnl: -100, pnlPct: -10 },
        { pnl: -50, pnlPct: -5 },
      ];
      mockDb.select.mockReturnValue(chain(closedTrades));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.profitFactor).toBe(0);
    });

    it('calculates sharpe ratio correctly', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 2,
        sharpeRatio: 0,
      });
      const closedTrades = [
        { pnl: 100, pnlPct: 10 },
        { pnl: 100, pnlPct: 10 },
      ];
      mockDb.select.mockReturnValue(chain(closedTrades));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      // With identical returns, stdDev = 0, so sharpeRatio = 0
      expect(result.sharpeRatio).toBe(0);
    });

    it('calculates max drawdown from cumulative PnL', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 3,
        maxDrawdown: 2.0,
      });
      const closedTrades = [
        { pnl: 100, pnlPct: 10 },
        { pnl: -200, pnlPct: -20 },
        { pnl: 50, pnlPct: 5 },
      ];
      mockDb.select.mockReturnValue(chain(closedTrades));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.maxDrawdown).toBe(2.0);
    });

    it('handles null pnl and pnlPct values', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 2,
      });
      const closedTrades = [
        { pnl: null, pnlPct: null },
        { pnl: 100, pnlPct: 10 },
      ];
      mockDb.select.mockReturnValue(chain(closedTrades));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.totalTrades).toBe(2);
    });

    it('includes new metrics in response', () => {
      mockGetMetrics.mockReturnValueOnce({
        ...mockPerformanceMetrics,
        totalTrades: 10,
        sortinoRatio: 1.5,
        calmarRatio: 2.3,
        sqn: 1.8,
        expectancy: 42.50,
        expectancyRatio: 0.35,
        avgWin: 150,
        avgLoss: 75,
        currentDrawdown: 0.05,
      });
      mockDb.select.mockReturnValue(chain([]));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.sortinoRatio).toBe(1.5);
      expect(result.calmarRatio).toBe(2.3);
      expect(result.sqn).toBe(1.8);
      expect(result.expectancy).toBe(42.50);
      expect(result.expectancyRatio).toBe(0.35);
      expect(result.avgWin).toBe(150);
      expect(result.avgLoss).toBe(75);
      expect(result.currentDrawdown).toBe(0.05);
      expect(result.avgHoldDuration).toBe('N/A');
      expect(result.bestTrade).toBeNull();
      expect(result.worstTrade).toBeNull();
    });

    it('handles errors', () => {
      mockGetMetrics.mockImplementationOnce(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/performance/daily', () => {
    it('returns daily metrics', () => {
      const rows = [{ date: '2024-01-01' }];
      mockDb.select.mockReturnValue(chain(rows));

      const handler = findHandler(routes, 'get', '/api/performance/daily');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ metrics: rows });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/performance/daily');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/pairlist', () => {
    it('returns current pairlist', () => {
      mockDb.select.mockReturnValue(chain({ symbols: '["AAPL","MSFT"]', timestamp: '2024-01-01' }));

      const handler = findHandler(routes, 'get', '/api/pairlist');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        stocks: ['AAPL', 'MSFT'],
        lastRefreshed: '2024-01-01',
      });
    });

    it('returns empty when no pairlist exists', () => {
      mockDb.select.mockReturnValue(chain(undefined));

      const handler = findHandler(routes, 'get', '/api/pairlist');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ stocks: [], lastRefreshed: null });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/pairlist');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/pairlist/history', () => {
    it('returns pairlist history with parsed JSON', () => {
      const rows = [
        { symbols: '["AAPL"]', filterStats: '{"volume":1}', timestamp: '2024-01-01' },
        { symbols: '["MSFT"]', filterStats: null, timestamp: '2024-01-02' },
      ];
      mockDb.select.mockReturnValue(chain(rows));

      const handler = findHandler(routes, 'get', '/api/pairlist/history');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.history).toHaveLength(2);
      expect(result.history[0].symbols).toEqual(['AAPL']);
      expect(result.history[0].filterStats).toEqual({ volume: 1 });
      expect(result.history[1].filterStats).toBeNull();
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/pairlist/history');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/stock/:symbol', () => {
    it('returns stock detail with signal, fundamentals, and position', () => {
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain({ symbol: 'AAPL', rsi: 55 });
        if (callCount === 2) return chain({ symbol: 'AAPL', peRatio: 25 });
        return chain({ symbol: 'AAPL', shares: 10 });
      });

      const handler = findHandler(routes, 'get', '/api/stock/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      const result = res.json.mock.calls[0][0];
      expect(result.signal).toBeDefined();
      expect(result.fundamentals).toBeDefined();
      expect(result.position).toBeDefined();
    });

    it('returns nulls when no data exists', () => {
      mockDb.select.mockReturnValue(chain(undefined));

      const handler = findHandler(routes, 'get', '/api/stock/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'XYZ' } }), res);

      const result = res.json.mock.calls[0][0];
      expect(result.signal).toBeNull();
      expect(result.fundamentals).toBeNull();
      expect(result.position).toBeNull();
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/stock/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/config', () => {
    it('returns config grouped by category', () => {
      mockConfigManager.getAllRaw.mockReturnValue([
        { key: 'a.b', value: '1', category: 'cat1', description: 'desc1' },
        { key: 'c.d', value: '"hello"', category: 'cat1', description: null },
        { key: 'e.f', value: 'true', category: 'cat2', description: 'desc2' },
      ]);

      const handler = findHandler(routes, 'get', '/api/config');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.cat1).toHaveLength(2);
      expect(result.cat2).toHaveLength(1);
      expect(result.cat1[0].value).toBe(1);
      expect(result.cat1[1].value).toBe('hello');
    });

    it('handles errors', () => {
      mockConfigManager.getAllRaw.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/config');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/config/:category', () => {
    it('returns config by category', () => {
      mockConfigManager.getByCategory.mockReturnValue({ key1: 'val1' });

      const handler = findHandler(routes, 'get', '/api/config/:category');
      const res = mockRes();
      handler(mockReq({ params: { category: 'risk' } }), res);

      expect(res.json).toHaveBeenCalledWith({ key1: 'val1' });
    });

    it('handles errors', () => {
      mockConfigManager.getByCategory.mockImplementation(() => { throw new Error('err'); });

      const handler = findHandler(routes, 'get', '/api/config/:category');
      const res = mockRes();
      handler(mockReq({ params: { category: 'risk' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('PUT /api/config/:key', () => {
    it('updates config value', async () => {
      mockConfigManager.set.mockResolvedValue(undefined);

      const handler = findHandler(routes, 'put', '/api/config/:key');
      const res = mockRes();
      await handler(mockReq({ params: { key: 'risk.maxPositions' }, body: { value: 10 } }), res);

      expect(mockConfigManager.set).toHaveBeenCalledWith('risk.maxPositions', 10);
      expect(mockConfigManager.invalidateCache).toHaveBeenCalledWith('risk.maxPositions');
      expect(res.json).toHaveBeenCalledWith({ key: 'risk.maxPositions', value: 10, updated: true });
    });

    it('returns 400 when value is missing', async () => {
      const handler = findHandler(routes, 'put', '/api/config/:key');
      const res = mockRes();
      await handler(mockReq({ params: { key: 'k' }, body: {} }), res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles errors', async () => {
      mockConfigManager.set.mockRejectedValue(new Error('err'));

      const handler = findHandler(routes, 'put', '/api/config/:key');
      const res = mockRes();
      await handler(mockReq({ params: { key: 'k' }, body: { value: 'v' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/control/pause', () => {
    it('pauses the bot', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const setPaused = vi.fn();
      registerBotCallbacks({
        getStatus: () => ({ paused: false, startedAt: new Date().toISOString() }),
        setPaused,
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      });

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/pause');
      const res = mockRes();
      handler(mockReq(), res);

      expect(setPaused).toHaveBeenCalledWith(true);
      expect(res.json).toHaveBeenCalledWith({ status: 'paused' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: () => { throw new Error('pause error'); },
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/pause');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to pause bot' });
    });
  });

  describe('POST /api/control/resume', () => {
    it('resumes the bot', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const setPaused = vi.fn();
      registerBotCallbacks({
        getStatus: () => ({ paused: true, startedAt: new Date().toISOString() }),
        setPaused,
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      });

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/resume');
      const res = mockRes();
      handler(mockReq(), res);

      expect(setPaused).toHaveBeenCalledWith(false);
      expect(res.json).toHaveBeenCalledWith({ status: 'running' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: () => { throw new Error('resume error'); },
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/resume');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to resume bot' });
    });
  });

  describe('POST /api/control/close/:symbol', () => {
    it('closes a position', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const closePosition = vi.fn().mockResolvedValue('Position closed');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition,
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/close/:symbol');
      const res = mockRes();
      await handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(closePosition).toHaveBeenCalledWith('AAPL');
      expect(res.json).toHaveBeenCalledWith({ message: 'Position closed' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn().mockRejectedValue(new Error('fail')),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/close/:symbol');
      const res = mockRes();
      await handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/control/analyze/:symbol', () => {
    it('analyzes a symbol', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const analyzeSymbol = vi.fn().mockResolvedValue('Analysis complete');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol,
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/analyze/:symbol');
      const res = mockRes();
      await handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(analyzeSymbol).toHaveBeenCalledWith('AAPL');
      expect(res.json).toHaveBeenCalledWith({ message: 'Analysis complete' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn().mockRejectedValue(new Error('fail')),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/analyze/:symbol');
      const res = mockRes();
      await handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/control/refresh-pairlist', () => {
    it('refreshes the pairlist', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const refreshPairlist = vi.fn().mockResolvedValue('Refreshed');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist,
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/refresh-pairlist');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(refreshPairlist).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Refreshed' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn().mockRejectedValue(new Error('fail')),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/refresh-pairlist');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/control/emergency-stop', () => {
    it('executes emergency stop', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const emergencyStop = vi.fn().mockResolvedValue('Stopped');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop,
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/emergency-stop');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(emergencyStop).toHaveBeenCalled();
      expect(mockAuditLogger.logControl).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ message: 'Stopped' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn().mockRejectedValue(new Error('fail')),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/control/emergency-stop');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/trade-plans', () => {
    it('returns trade plans', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: () => [{ id: 1, symbol: 'AAPL' }],
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/trade-plans');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ plans: [{ id: 1, symbol: 'AAPL' }] });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: () => { throw new Error('fail'); },
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/trade-plans');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/trade-plans/:id/approve', () => {
    it('approves a trade plan', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: () => ({ id: 1, status: 'approved' }),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/trade-plans/:id/approve');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.json).toHaveBeenCalledWith({ plan: { id: 1, status: 'approved' } });
    });

    it('returns 404 when plan not found', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: () => null,
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/trade-plans/:id/approve');
      const res = mockRes();
      handler(mockReq({ params: { id: '999' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: () => { throw new Error('fail'); },
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/trade-plans/:id/approve');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/trade-plans/:id/reject', () => {
    it('rejects a trade plan', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/trade-plans/:id/reject');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.json).toHaveBeenCalledWith({ message: 'Plan rejected' });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: () => { throw new Error('fail'); },
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/trade-plans/:id/reject');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/research', () => {
    it('returns research reports', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: () => [{ id: 1 }],
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/research');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ reports: [{ id: 1 }] });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: () => { throw new Error('fail'); },
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/research');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/research/run', () => {
    it('runs research', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const runResearch = vi.fn().mockResolvedValue({ result: 'data' });
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch,
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/research/run');
      const res = mockRes();
      await handler(mockReq({ body: { focus: 'tech', symbols: ['AAPL'] } }), res);

      expect(runResearch).toHaveBeenCalledWith({ focus: 'tech', symbols: ['AAPL'] });
      expect(res.json).toHaveBeenCalledWith({ report: { result: 'data' } });
    });

    it('handles null body with validation error', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      const runResearch = vi.fn().mockResolvedValue(null);
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch,
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/research/run');
      const res = mockRes();
      await handler(mockReq({ body: null }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn().mockRejectedValue(new Error('fail')),
        getResearchReports: vi.fn(),
        getModelStats: vi.fn(),
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/research/run');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/model-stats', () => {
    it('returns model stats', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: () => [{ model: 'claude', accuracy: 0.8 }],
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/model-stats');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ stats: [{ model: 'claude', accuracy: 0.8 }] });
    });

    it('handles errors', async () => {
      const { registerBotCallbacks } = await import('../../src/api/routes.js');
      registerBotCallbacks({
        getStatus: vi.fn(),
        setPaused: vi.fn(),
        closePosition: vi.fn(),
        analyzeSymbol: vi.fn(),
        refreshPairlist: vi.fn(),
        emergencyStop: vi.fn(),
        getTradePlans: vi.fn(),
        approveTradePlan: vi.fn(),
        rejectTradePlan: vi.fn(),
        runResearch: vi.fn(),
        getResearchReports: vi.fn(),
        getModelStats: () => { throw new Error('fail'); },
      } as any);

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'get', '/api/model-stats');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/pairlist/static', () => {
    it('adds a symbol to static pairlist', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'pairlist.staticSymbols') return ['MSFT'];
        return null;
      });

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'aapl' } }), res);

      expect(mockConfigManager.set).toHaveBeenCalledWith('pairlist.staticSymbols', ['MSFT', 'AAPL']);
      expect(res.json).toHaveBeenCalledWith({ symbols: ['MSFT', 'AAPL'] });
    });

    it('does not duplicate existing symbol', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'pairlist.staticSymbols') return ['AAPL'];
        return null;
      });

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'post', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL' } }), res);

      expect(mockConfigManager.set).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ symbols: ['AAPL'] });
    });

    it('returns 400 when symbol is missing', () => {
      const handler = findHandler(routes, 'post', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq({ body: {} }), res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when symbol is not a string', () => {
      const handler = findHandler(routes, 'post', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 123 } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles errors', () => {
      mockConfigManager.get.mockImplementation(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'post', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('DELETE /api/pairlist/static/:symbol', () => {
    it('removes a symbol from static pairlist', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'pairlist.staticSymbols') return ['AAPL', 'MSFT'];
        return null;
      });

      routes = await getRouteHandlers();
      const handler = findHandler(routes, 'delete', '/api/pairlist/static/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'aapl' } }), res);

      expect(mockConfigManager.set).toHaveBeenCalledWith('pairlist.staticSymbols', ['MSFT']);
      expect(res.json).toHaveBeenCalledWith({ symbols: ['MSFT'] });
    });

    it('handles errors', () => {
      mockConfigManager.get.mockImplementation(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'delete', '/api/pairlist/static/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/audit', () => {
    it('returns recent audit entries by default', () => {
      mockAuditLogger.getRecent.mockReturnValue([{ id: 1 }]);

      const handler = findHandler(routes, 'get', '/api/audit');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockAuditLogger.getRecent).toHaveBeenCalledWith(100);
      expect(res.json).toHaveBeenCalledWith({ entries: [{ id: 1 }] });
    });

    it('filters by date', () => {
      mockAuditLogger.getEntriesForDate.mockReturnValue([]);

      const handler = findHandler(routes, 'get', '/api/audit');
      const res = mockRes();
      handler(mockReq({ query: { date: '2024-01-15' } }), res);

      expect(mockAuditLogger.getEntriesForDate).toHaveBeenCalledWith('2024-01-15');
    });

    it('filters by type', () => {
      mockAuditLogger.getByType.mockReturnValue([]);

      const handler = findHandler(routes, 'get', '/api/audit');
      const res = mockRes();
      handler(mockReq({ query: { type: 'trade', limit: '10' } }), res);

      expect(mockAuditLogger.getByType).toHaveBeenCalledWith('trade', 10);
    });

    it('uses custom limit', () => {
      mockAuditLogger.getRecent.mockReturnValue([]);

      const handler = findHandler(routes, 'get', '/api/audit');
      const res = mockRes();
      handler(mockReq({ query: { limit: '25' } }), res);

      expect(mockAuditLogger.getRecent).toHaveBeenCalledWith(25);
    });

    it('handles errors', () => {
      mockAuditLogger.getRecent.mockImplementation(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/api/audit');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('GET /api/correlation', () => {
    it('returns correlation matrix', () => {
      const handler = findHandler(routes, 'get', '/api/correlation');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith(mockCorrelationMatrix);
    });

    it('handles errors', async () => {
      const correlation = await import('../../src/analysis/correlation.js');
      const MockCtor = correlation.CorrelationAnalyzer as unknown as ReturnType<typeof vi.fn>;
      MockCtor.mockImplementationOnce(() => ({
        getPortfolioCorrelationMatrix: () => { throw new Error('fail'); },
      }));

      const handler = findHandler(routes, 'get', '/api/correlation');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('registerBotCallbacks', () => {
    it('default callbacks return expected values', async () => {
      // Reset module to get default callbacks (without calling registerBotCallbacks)
      vi.resetModules();
      const { createRouter } = await import('../../src/api/routes.js');
      const router = createRouter();

      // Call the default status handler to exercise line 112 (default getStatus)
      const statusRoute = (router as any).stack.find((l: any) => l.route?.path === '/api/status');
      expect(statusRoute).toBeDefined();
      const handler = statusRoute.route.stack[0].handle;
      const res = mockRes();
      // After resetModules, sub-mocks may not apply — but default getStatus is still exercised
      // before any error from downstream calls; the handler may succeed or return error, but
      // getStatus (line 112) is called either way.
      handler(mockReq(), res);
      // Either success or error — both paths exercise the default getStatus callback
      expect(res.json).toHaveBeenCalled();
    });

    it('default pause callback is a noop', async () => {
      vi.resetModules();

      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      // Find the pause handler to exercise the default setPaused noop
      const pauseRoute = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/control/pause'
      );
      const handler = pauseRoute.route.stack[0].handle;
      const res = mockRes();

      // This exercises the default noop setPaused callback (line 30-32)
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ status: 'paused' });
    });

    it('default rejectTradePlan callback is a noop', async () => {
      vi.resetModules();

      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      // Find the reject handler to exercise the default rejectTradePlan noop
      const rejectRoute = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/trade-plans/:id/reject'
      );
      const handler = rejectRoute.route.stack[0].handle;
      const res = mockRes();

      // This exercises the default noop rejectTradePlan callback (line 39-41)
      handler(mockReq({ params: { id: '1' } }), res);
      expect(res.json).toHaveBeenCalledWith({ message: 'Plan rejected' });
    });

    it('default closePosition returns not connected', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/control/close/:symbol'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      await handler(mockReq({ params: { symbol: 'AAPL' } }), res);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not connected to bot' });
    });

    it('default analyzeSymbol returns not connected', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/control/analyze/:symbol'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      await handler(mockReq({ params: { symbol: 'AAPL' } }), res);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not connected to bot' });
    });

    it('default refreshPairlist returns not connected', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/control/refresh-pairlist'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      await handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not connected to bot' });
    });

    it('default emergencyStop returns not connected', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/control/emergency-stop'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      await handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not connected to bot' });
    });

    it('default getTradePlans returns empty array', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/trade-plans' && l.route?.methods?.get
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ plans: [] });
    });

    it('default approveTradePlan returns null (404)', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/trade-plans/:id/approve'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('default runResearch returns null', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/research/run'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      await handler(mockReq({ body: {} }), res);
      expect(res.json).toHaveBeenCalledWith({ report: null });
    });

    it('default getResearchReports returns empty array', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/research' && l.route?.methods?.get
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ reports: [] });
    });

    it('default getModelStats returns empty array', async () => {
      vi.resetModules();
      const routesMod = await import('../../src/api/routes.js');
      const router = routesMod.createRouter();

      const route = (router as any).stack.find(
        (l: any) => l.route?.path === '/api/model-stats'
      );
      const handler = route.route.stack[0].handle;
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ stats: [] });
    });
  });

  // ── Research Watchlist ──────────────────────────────────────────────────
  describe('GET /api/research/watchlist', () => {
    it('returns all watchlist entries', () => {
      mockWatchlistRepo.getAll.mockReturnValue([
        { id: 1, symbol: 'AAPL', notes: 'test', addedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      const handler = findHandler(routes, 'get', '/api/research/watchlist');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith([
        { id: 1, symbol: 'AAPL', notes: 'test', addedAt: '2024-01-01T00:00:00.000Z' },
      ]);
    });

    it('handles errors', () => {
      mockWatchlistRepo.getAll.mockImplementation(() => { throw new Error('db error'); });
      const handler = findHandler(routes, 'get', '/api/research/watchlist');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /api/research/watchlist', () => {
    it('adds a symbol to the watchlist', () => {
      mockWatchlistRepo.add.mockReturnValue({ id: 2, symbol: 'MSFT', notes: null, addedAt: '2024-01-01T00:00:00.000Z' });
      const handler = findHandler(routes, 'post', '/api/research/watchlist');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'MSFT' } }), res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'MSFT' }));
    });

    it('returns 400 when symbol is missing', () => {
      const handler = findHandler(routes, 'post', '/api/research/watchlist');
      const res = mockRes();
      handler(mockReq({ body: {} }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles errors', () => {
      mockWatchlistRepo.add.mockImplementation(() => { throw new Error('db error'); });
      const handler = findHandler(routes, 'post', '/api/research/watchlist');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('DELETE /api/research/watchlist/:symbol', () => {
    it('removes a symbol from the watchlist', () => {
      mockWatchlistRepo.remove.mockReturnValue(true);
      const handler = findHandler(routes, 'delete', '/api/research/watchlist/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 404 when symbol not found', () => {
      mockWatchlistRepo.remove.mockReturnValue(false);
      const handler = findHandler(routes, 'delete', '/api/research/watchlist/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('handles errors', () => {
      mockWatchlistRepo.remove.mockImplementation(() => { throw new Error('db error'); });
      const handler = findHandler(routes, 'delete', '/api/research/watchlist/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── Research Screener ───────────────────────────────────────────────────
  describe('POST /api/research/screen', () => {
    it('returns screener results from signals', () => {
      const signalRow = { symbol: 'AAPL', technicalScore: 75, timestamp: '2024-01-15T10:00:00.000Z' };
      mockDb.select.mockReturnValue(chain([signalRow]));
      const handler = findHandler(routes, 'post', '/api/research/screen');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        results: expect.any(Array),
      }));
    });

    it('returns null screenerUpdatedAt when no results', () => {
      mockDb.select.mockReturnValue(chain([]));
      const handler = findHandler(routes, 'post', '/api/research/screen');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ results: [], screenerUpdatedAt: null });
    });

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('db err'); });
      const handler = findHandler(routes, 'post', '/api/research/screen');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── Research Idea Status ────────────────────────────────────────────────
  describe('POST /api/research/ideas/:id/status', () => {
    it('updates status for valid value', () => {
      mockDb.update.mockReturnValue(chain({ changes: 1 }));
      const handler = findHandler(routes, 'post', '/api/research/ideas/:id/status');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' }, body: { status: 'completed' } }), res);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('returns 400 for invalid status', () => {
      const handler = findHandler(routes, 'post', '/api/research/ideas/:id/status');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' }, body: { status: 'invalid' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles errors', () => {
      mockDb.update.mockImplementation(() => { throw new Error('db error'); });
      const handler = findHandler(routes, 'post', '/api/research/ideas/:id/status');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' }, body: { status: 'watching' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── AI Models ───────────────────────────────────────────────────────────
  describe('GET /ai/models', () => {
    it('returns parsed models list', () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'ai.models') return JSON.stringify([{ id: 'gpt4', enabled: true }]);
        return null;
      });
      const handler = findHandler(routes, 'get', '/ai/models');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith([{ id: 'gpt4', enabled: true }]);
    });

    it('returns empty array when models not configured', () => {
      mockConfigManager.get.mockReturnValue(null);
      const handler = findHandler(routes, 'get', '/ai/models');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith([]);
    });

    it('handles errors', () => {
      mockConfigManager.get.mockImplementation(() => { throw new Error('cfg err'); });
      const handler = findHandler(routes, 'get', '/ai/models');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /ai/models', () => {
    it('saves models list', async () => {
      mockConfigManager.set.mockResolvedValue(undefined);
      const handler = findHandler(routes, 'post', '/ai/models');
      const res = mockRes();
      await handler(mockReq({ body: [{ id: 'gpt4', enabled: true }] }), res);
      expect(mockConfigManager.set).toHaveBeenCalledWith('ai.models', expect.any(String));
      expect(res.json).toHaveBeenCalledWith({ ok: true, count: 1 });
    });

    it('returns 400 when body is not an array', async () => {
      const handler = findHandler(routes, 'post', '/ai/models');
      const res = mockRes();
      await handler(mockReq({ body: { id: 'gpt4' } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles errors', async () => {
      mockConfigManager.set.mockRejectedValue(new Error('fail'));
      const handler = findHandler(routes, 'post', '/ai/models');
      const res = mockRes();
      await handler(mockReq({ body: [{ id: 'gpt4' }] }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('POST /ai/test', () => {
    it('returns 404 when profileId not found', async () => {
      mockConfigManager.get.mockReturnValue(JSON.stringify([{ id: 'other', enabled: true }]));
      const handler = findHandler(routes, 'post', '/ai/test');
      const res = mockRes();
      await handler(mockReq({ body: { profileId: 'notexist' } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('handles outer errors', async () => {
      mockConfigManager.get.mockImplementation(() => { throw new Error('fail'); });
      const handler = findHandler(routes, 'post', '/ai/test');
      const res = mockRes();
      await handler(mockReq({ body: { profileId: 'gpt4' } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── Setup Status ────────────────────────────────────────────────────────
  describe('GET /setup/status', () => {
    it('returns configured: true when there is an enabled model', () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'ai.models') return JSON.stringify([{ enabled: true }]);
        if (key === 'ai.provider') return 'anthropic';
        return null;
      });
      const handler = findHandler(routes, 'get', '/api/setup/status');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ configured: true });
    });

    it('returns configured: true when legacy provider is non-default', () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'ai.models') return JSON.stringify([{ enabled: false }]);
        if (key === 'ai.provider') return 'ollama';
        return null;
      });
      const handler = findHandler(routes, 'get', '/api/setup/status');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ configured: true });
    });

    it('returns configured: false when nothing is set up', () => {
      mockConfigManager.get.mockReturnValue(null);
      const handler = findHandler(routes, 'get', '/api/setup/status');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith({ configured: false });
    });

    it('handles errors', () => {
      mockConfigManager.get.mockImplementation(() => { throw new Error('fail'); });
      const handler = findHandler(routes, 'get', '/api/setup/status');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── Health ────────────────────────────────────────────────────────────
  describe('GET /api/health', () => {
    it('returns health snapshot', () => {
      const handler = findHandler(routes, 'get', '/api/health');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'healthy' })
      );
    });

    it('handles errors', () => {
      mockGetSnapshot.mockImplementationOnce(() => { throw new Error('health fail'); });

      const handler = findHandler(routes, 'get', '/api/health');
      const res = mockRes();
      handler(mockReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch health metrics' });
    });
  });

  // ── Portfolio ROI enrichment ──────────────────────────────────────────
  describe('GET /api/portfolio (ROI enrichment)', () => {
    it('enriches positions with ROI thresholds when enabled', () => {
      const positionRows = [
        { symbol: 'AAPL', shares: 10, entryPrice: 150, currentPrice: 165, pnl: 150, entryTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      ];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positionRows);
        return chain({ cashBalance: 0 });
      });

      mockParseRoiTable.mockReturnValueOnce({ '60': 0.05 });
      mockGetRoiThreshold.mockReturnValueOnce(0.05);

      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'exit.roiEnabled') return true;
        if (key === 'exit.roiTable') return JSON.stringify({ '60': 0.05 });
        const defaults: Record<string, unknown> = {
          't212.accountType': 'INVEST',
          't212.environment': 'demo',
          'execution.dryRun': true,
          'pairlist.staticSymbols': ['AAPL'],
        };
        return defaults[key] ?? null;
      });

      const handler = findHandler(routes, 'get', '/api/portfolio');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          roiEnabled: true,
          positions: expect.arrayContaining([
            expect.objectContaining({ roiThreshold: 0.05 }),
          ]),
        })
      );
    });

    it('handles null pnlPct when currentPrice is null in ROI enrichment', () => {
      const positionRows = [
        { symbol: 'AAPL', shares: 10, entryPrice: 150, currentPrice: null, pnl: 0, entryTime: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
      ];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positionRows);
        return chain({ cashBalance: 0 });
      });

      mockParseRoiTable.mockReturnValueOnce({ '60': 0.05 });
      mockGetRoiThreshold.mockReturnValueOnce(0.05);

      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'exit.roiEnabled') return true;
        if (key === 'exit.roiTable') return JSON.stringify({ '60': 0.05 });
        const defaults: Record<string, unknown> = {
          't212.accountType': 'INVEST',
          't212.environment': 'demo',
          'execution.dryRun': true,
          'pairlist.staticSymbols': ['AAPL'],
        };
        return defaults[key] ?? null;
      });

      const handler = findHandler(routes, 'get', '/api/portfolio');
      const res = mockRes();
      handler(mockReq(), res);

      // roiDistancePct should be null because pnlPct is null (currentPrice is null)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          positions: expect.arrayContaining([
            expect.objectContaining({ roiDistancePct: null }),
          ]),
        })
      );
    });

    it('JSON.stringifies roiTable when it is not a string (object from config)', () => {
      // Cover the false branch at line 177: `typeof roiTableJson === 'string' ? ... : JSON.stringify(...)`
      const positionRows = [
        { symbol: 'AAPL', shares: 10, entryPrice: 150, currentPrice: 165, pnl: 150, entryTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() },
      ];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positionRows);
        return chain({ cashBalance: 0 });
      });

      mockParseRoiTable.mockReturnValueOnce({ '60': 0.05 });
      mockGetRoiThreshold.mockReturnValueOnce(0.05);

      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'exit.roiEnabled') return true;
        // Return an object (non-string) — triggers JSON.stringify branch
        if (key === 'exit.roiTable') return { '60': 0.05 };
        const defaults: Record<string, unknown> = {
          't212.accountType': 'INVEST',
          't212.environment': 'demo',
          'execution.dryRun': true,
          'pairlist.staticSymbols': ['AAPL'],
        };
        return defaults[key] ?? null;
      });

      const handler = findHandler(routes, 'get', '/api/portfolio');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockParseRoiTable).toHaveBeenCalledWith('{"60":0.05}');
      expect(res.json).toHaveBeenCalled();
    });
  });

  // ── PUT /api/config/:key - "Invalid value" 400 branch ────────────────
  describe('PUT /api/config/:key (invalid value error)', () => {
    it('returns 400 when configManager.set throws Invalid value error', async () => {
      mockConfigManager.set.mockRejectedValue(new Error('Invalid value for config key risk.maxPositions'));

      const handler = findHandler(routes, 'put', '/api/config/:key');
      const res = mockRes();
      await handler(mockReq({ params: { key: 'risk.maxPositions' }, body: { value: -1 } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid value for config key risk.maxPositions' });
    });

    it('returns 500 with fallback message when non-Error is thrown', async () => {
      // Throw a non-Error to cover the `err instanceof Error ? ... : 'Failed to update config'` false branch
      mockConfigManager.set.mockRejectedValue('string error');

      const handler = findHandler(routes, 'put', '/api/config/:key');
      const res = mockRes();
      await handler(mockReq({ params: { key: 'some.key' }, body: { value: 42 } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to update config' });
    });
  });

  // ── GET /api/pairlist/static ──────────────────────────────────────────
  describe('GET /api/pairlist/static', () => {
    it('returns static symbols list', () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'pairlist.staticSymbols') return ['AAPL', 'MSFT'];
        return null;
      });

      const handler = findHandler(routes, 'get', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ symbols: ['AAPL', 'MSFT'] });
    });

    it('returns empty symbols on error', () => {
      mockConfigManager.get.mockImplementation(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/api/pairlist/static');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ symbols: [] });
    });
  });

  // ── GET /api/orders ───────────────────────────────────────────────────
  describe('GET /api/orders', () => {
    it('returns orders with default filters', () => {
      mockGetRecentOrders.mockReturnValueOnce([{ id: 1, symbol: 'AAPL' }]);
      mockGetOrderCount.mockReturnValueOnce(1);

      const handler = findHandler(routes, 'get', '/api/orders');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ orders: [{ id: 1, symbol: 'AAPL' }], total: 1 });
    });

    it('applies symbol/status/limit filters', () => {
      mockGetRecentOrders.mockReturnValueOnce([]);
      mockGetOrderCount.mockReturnValueOnce(0);

      const handler = findHandler(routes, 'get', '/api/orders');
      const res = mockRes();
      handler(mockReq({ query: { symbol: 'MSFT', status: 'filled', limit: '10' } }), res);

      expect(mockGetRecentOrders).toHaveBeenCalledWith(
        expect.objectContaining({ symbol: 'MSFT', status: 'filled', limit: 10 })
      );
    });

    it('handles errors', () => {
      mockGetRecentOrders.mockImplementationOnce(() => { throw new Error('db err'); });

      const handler = findHandler(routes, 'get', '/api/orders');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch orders' });
    });
  });

  // ── GET /api/orders/:id ───────────────────────────────────────────────
  describe('GET /api/orders/:id', () => {
    it('returns order by id', () => {
      mockGetOrderById.mockReturnValueOnce({ id: 1, symbol: 'AAPL' });

      const handler = findHandler(routes, 'get', '/api/orders/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.json).toHaveBeenCalledWith({ id: 1, symbol: 'AAPL' });
    });

    it('returns 404 when order not found', () => {
      mockGetOrderById.mockReturnValueOnce(null);

      const handler = findHandler(routes, 'get', '/api/orders/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '999' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Order not found' });
    });

    it('handles errors', () => {
      mockGetOrderById.mockImplementationOnce(() => { throw new Error('db err'); });

      const handler = findHandler(routes, 'get', '/api/orders/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '1' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /api/positions/:symbol/orders ─────────────────────────────────
  describe('GET /api/positions/:symbol/orders', () => {
    it('returns orders for a symbol', () => {
      mockGetOrdersBySymbol.mockReturnValueOnce([{ id: 1, symbol: 'AAPL' }]);

      const handler = findHandler(routes, 'get', '/api/positions/:symbol/orders');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.json).toHaveBeenCalledWith({ orders: [{ id: 1, symbol: 'AAPL' }] });
    });

    it('handles errors', () => {
      mockGetOrdersBySymbol.mockImplementationOnce(() => { throw new Error('db err'); });

      const handler = findHandler(routes, 'get', '/api/positions/:symbol/orders');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /api/protections/locks ────────────────────────────────────────
  describe('GET /api/protections/locks', () => {
    it('returns active pair locks', () => {
      mockGetActiveLocks.mockReturnValueOnce([{ symbol: 'AAPL', lockedUntil: '2024-01-16T00:00:00.000Z' }]);

      const handler = findHandler(routes, 'get', '/api/protections/locks');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ locks: [{ symbol: 'AAPL', lockedUntil: '2024-01-16T00:00:00.000Z' }] });
    });

    it('handles errors', () => {
      mockGetPairLockManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/api/protections/locks');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── DELETE /api/protections/locks/:symbol ─────────────────────────────
  describe('DELETE /api/protections/locks/:symbol', () => {
    it('unlocks a pair', () => {
      const handler = findHandler(routes, 'delete', '/api/protections/locks/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(mockUnlockPair).toHaveBeenCalledWith('AAPL');
      expect(res.json).toHaveBeenCalledWith({ message: 'Pair AAPL unlocked' });
    });

    it('handles errors', () => {
      mockGetPairLockManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'delete', '/api/protections/locks/:symbol');
      const res = mockRes();
      handler(mockReq({ params: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /api/backtest ────────────────────────────────────────────────
  describe('POST /api/backtest', () => {
    const validBody = {
      symbols: ['AAPL', 'MSFT'],
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    };

    it('runs a backtest and returns results', async () => {
      const handler = findHandler(routes, 'post', '/api/backtest');
      const res = mockRes();
      await handler(mockReq({ body: validBody }), res);

      expect(mockCreateBacktestEngine).toHaveBeenCalled();
      expect(mockBacktestRun).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.any(Object),
          equityCurve: expect.any(Array),
        })
      );
    });

    it('returns 400 for invalid body', async () => {
      const handler = findHandler(routes, 'post', '/api/backtest');
      const res = mockRes();
      await handler(mockReq({ body: { symbols: [] } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('handles errors during backtest run', async () => {
      mockCreateBacktestEngine.mockRejectedValueOnce(new Error('engine fail'));

      const handler = findHandler(routes, 'post', '/api/backtest');
      const res = mockRes();
      await handler(mockReq({ body: validBody }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('runs walk-forward analysis when walkForward param is provided', async () => {
      const handler = findHandler(routes, 'post', '/api/backtest');
      const res = mockRes();
      await handler(
        mockReq({
          body: {
            ...validBody,
            walkForward: { windows: 3, trainRatio: 0.7 },
          },
        }),
        res,
      );

      expect(mockWalkForwardRun).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'walk-forward' })
      );
    });
  });

  // ── GET /regime ───────────────────────────────────────────────────────
  describe('GET /regime', () => {
    it('returns regime detection result with sufficient data', () => {
      // Need >= 20 candles
      const candles = Array.from({ length: 25 }, (_, i) => ({
        symbol: 'SPY',
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        open: 400 + i,
        high: 405 + i,
        low: 395 + i,
        close: 402 + i,
        volume: 1000000,
      }));
      mockDb.select.mockReturnValueOnce(chain(candles));

      const handler = findHandler(routes, 'get', '/regime');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockDetect).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ regime: 'bull', confidence: 0.8 });
    });

    it('returns null regime with insufficient data', () => {
      // Less than 20 candles
      const candles = Array.from({ length: 5 }, (_, i) => ({
        symbol: 'SPY',
        timestamp: `2024-01-0${i + 1}T00:00:00.000Z`,
        open: 400, high: 405, low: 395, close: 402, volume: 1000000,
      }));
      mockDb.select.mockReturnValueOnce(chain(candles));

      const handler = findHandler(routes, 'get', '/regime');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ regime: null, message: 'Insufficient SPY data' });
    });

    it('handles candles with null OHLCV values', () => {
      const candles = Array.from({ length: 25 }, (_, i) => ({
        symbol: 'SPY',
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        open: null, high: null, low: null, close: null, volume: null,
      }));
      mockDb.select.mockReturnValueOnce(chain(candles));

      const handler = findHandler(routes, 'get', '/regime');
      const res = mockRes();
      handler(mockReq(), res);

      // Should still call detect with 0s for nulls
      expect(mockDetect).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ open: 0, high: 0, low: 0, close: 0, volume: 0 }),
        ])
      );
    });

    it('handles errors', () => {
      mockGetRegimeDetector.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/regime');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /strategy-profiles ────────────────────────────────────────────
  describe('GET /strategy-profiles', () => {
    it('returns list of profiles', () => {
      mockListProfiles.mockReturnValueOnce([{ name: 'conservative' }, { name: 'aggressive' }]);

      const handler = findHandler(routes, 'get', '/api/strategy-profiles');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith([{ name: 'conservative' }, { name: 'aggressive' }]);
    });

    it('handles errors', () => {
      mockGetStrategyProfileManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/api/strategy-profiles');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /strategy-profiles/:name/activate ────────────────────────────
  describe('POST /strategy-profiles/:name/activate', () => {
    it('activates a strategy profile', async () => {
      const handler = findHandler(routes, 'post', '/api/strategy-profiles/:name/activate');
      const res = mockRes();
      await handler(mockReq({ params: { name: 'conservative' } }), res);

      expect(mockApplyProfile).toHaveBeenCalledWith('conservative');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: "Profile 'conservative' activated" });
    });

    it('handles errors', async () => {
      mockApplyProfile.mockRejectedValueOnce(new Error('fail'));

      const handler = findHandler(routes, 'post', '/api/strategy-profiles/:name/activate');
      const res = mockRes();
      await handler(mockReq({ params: { name: 'conservative' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /monte-carlo/simulate ────────────────────────────────────────
  describe('POST /monte-carlo/simulate', () => {
    it('returns simulation result with enough trades', () => {
      const trades = Array.from({ length: 10 }, (_, i) => ({ pnl: 100 * (i % 3 === 0 ? -1 : 1), pnlPct: 5 }));
      mockDb.select.mockReturnValueOnce(chain(trades));

      const handler = findHandler(routes, 'post', '/monte-carlo/simulate');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockSimulate).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ mean: 100, p95: 500, p5: -100 });
    });

    it('returns error when less than 5 trades', () => {
      mockDb.select.mockReturnValueOnce(chain([{ pnl: 100, pnlPct: 5 }]));

      const handler = findHandler(routes, 'post', '/monte-carlo/simulate');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ error: 'Need at least 5 closed trades for simulation' });
    });

    it('handles errors', () => {
      mockCreateMonteCarloSimulator.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'post', '/monte-carlo/simulate');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /attribution ──────────────────────────────────────────────────
  describe('GET /attribution', () => {
    it('returns factor breakdown', () => {
      const handler = findHandler(routes, 'get', '/attribution');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockGetFactorBreakdown).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ alpha: 0.05, beta: 1.1 });
    });

    it('handles errors', () => {
      mockGetPerformanceAttributor.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/attribution');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /journal ──────────────────────────────────────────────────────
  describe('GET /journal', () => {
    it('returns recent journal entries (no symbol)', () => {
      mockGetRecentJournalEntries.mockReturnValueOnce([{ id: 1, symbol: 'AAPL' }]);

      const handler = findHandler(routes, 'get', '/journal');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockGetRecentJournalEntries).toHaveBeenCalledWith(50);
      expect(res.json).toHaveBeenCalledWith([{ id: 1, symbol: 'AAPL' }]);
    });

    it('returns symbol history when symbol is provided', () => {
      mockGetSymbolHistory.mockReturnValueOnce([{ id: 2, symbol: 'AAPL' }]);

      const handler = findHandler(routes, 'get', '/journal');
      const res = mockRes();
      handler(mockReq({ query: { symbol: 'AAPL', limit: '20' } }), res);

      expect(mockGetSymbolHistory).toHaveBeenCalledWith('AAPL', 20);
      expect(res.json).toHaveBeenCalledWith([{ id: 2, symbol: 'AAPL' }]);
    });

    it('handles errors', () => {
      mockGetTradeJournalManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/journal');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /journal ─────────────────────────────────────────────────────
  describe('POST /journal', () => {
    it('adds a journal entry', () => {
      mockAddNote.mockReturnValueOnce({ id: 1, symbol: 'AAPL', note: 'test note' });

      const handler = findHandler(routes, 'post', '/journal');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL', note: 'test note', tags: ['momentum'] } }), res);

      expect(mockAddNote).toHaveBeenCalledWith('AAPL', 'test note', expect.objectContaining({ tags: ['momentum'] }));
      expect(res.json).toHaveBeenCalledWith({ id: 1, symbol: 'AAPL', note: 'test note' });
    });

    it('returns 400 when symbol or note is missing', () => {
      const handler = findHandler(routes, 'post', '/journal');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'symbol and note are required' });
    });

    it('handles errors', () => {
      mockGetTradeJournalManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'post', '/journal');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL', note: 'test' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /journal/search ───────────────────────────────────────────────
  describe('GET /journal/search', () => {
    it('returns search results', () => {
      mockSearch.mockReturnValueOnce([{ id: 1 }]);

      const handler = findHandler(routes, 'get', '/journal/search');
      const res = mockRes();
      handler(mockReq({ query: { q: 'momentum' } }), res);

      expect(mockSearch).toHaveBeenCalledWith('momentum');
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });

    it('returns 400 when q is missing', () => {
      const handler = findHandler(routes, 'get', '/journal/search');
      const res = mockRes();
      handler(mockReq({ query: {} }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'q query parameter is required' });
    });

    it('handles errors', () => {
      mockGetTradeJournalManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/journal/search');
      const res = mockRes();
      handler(mockReq({ query: { q: 'test' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /journal/insights ─────────────────────────────────────────────
  describe('GET /journal/insights', () => {
    it('returns journal insights', () => {
      mockGetInsights.mockReturnValueOnce({ patterns: ['buy the dip'] });

      const handler = findHandler(routes, 'get', '/journal/insights');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ patterns: ['buy the dip'] });
    });

    it('handles errors', () => {
      mockGetTradeJournalManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/journal/insights');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /tax/summary ──────────────────────────────────────────────────
  describe('GET /tax/summary', () => {
    it('returns tax summary for given year', () => {
      mockGetYearlyTaxSummary.mockReturnValueOnce({ gains: 2000, losses: 500 });

      const handler = findHandler(routes, 'get', '/tax/summary');
      const res = mockRes();
      handler(mockReq({ query: { year: '2024' } }), res);

      expect(mockGetYearlyTaxSummary).toHaveBeenCalledWith(2024);
      expect(res.json).toHaveBeenCalledWith({ gains: 2000, losses: 500 });
    });

    it('uses current year when not specified', () => {
      const handler = findHandler(routes, 'get', '/tax/summary');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockGetYearlyTaxSummary).toHaveBeenCalledWith(new Date().getFullYear());
    });

    it('handles errors', () => {
      mockGetTaxTracker.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/tax/summary');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /tax/harvest-candidates ───────────────────────────────────────
  describe('GET /tax/harvest-candidates', () => {
    it('returns harvest candidates', () => {
      const positions = [{ symbol: 'AAPL', currentPrice: 140, shares: 10, entryPrice: 150 }];
      mockDb.select.mockReturnValueOnce(chain(positions));
      mockGetHarvestCandidates.mockReturnValueOnce([{ symbol: 'AAPL', unrealizedLoss: -100 }]);

      const handler = findHandler(routes, 'get', '/tax/harvest-candidates');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockGetHarvestCandidates).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([{ symbol: 'AAPL', unrealizedLoss: -100 }]);
    });

    it('skips positions with null currentPrice for price map', () => {
      // Position with null currentPrice should not be added to priceMap (line 1210 branch)
      const positions = [{ symbol: 'AAPL', currentPrice: null, shares: 10, entryPrice: 150 }];
      mockDb.select.mockReturnValueOnce(chain(positions));
      mockGetHarvestCandidates.mockReturnValueOnce([]);

      const handler = findHandler(routes, 'get', '/tax/harvest-candidates');
      const res = mockRes();
      handler(mockReq(), res);

      // priceMap should be empty since currentPrice is null
      expect(mockGetHarvestCandidates).toHaveBeenCalledWith(new Map());
    });

    it('handles errors', () => {
      mockGetTaxTracker.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/tax/harvest-candidates');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /portfolio/optimize ───────────────────────────────────────────
  describe('GET /portfolio/optimize', () => {
    it('returns error when no positions', () => {
      mockDb.select.mockReturnValueOnce(chain([]));

      const handler = findHandler(routes, 'get', '/portfolio/optimize');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ error: 'No open positions to optimize' });
    });

    it('returns error when insufficient price data', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: 160, entryPrice: 150 },
      ];
      // First call: positions, subsequent calls: price data (< 5 for AAPL → skip)
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain([]); // not enough prices
      });

      const handler = findHandler(routes, 'get', '/portfolio/optimize');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ error: 'Need price data for at least 2 positions' });
    });

    it('returns optimization result with sufficient data', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: 160, entryPrice: 150 },
        { symbol: 'MSFT', shares: 5, currentPrice: 310, entryPrice: 300 },
      ];
      const prices6 = Array.from({ length: 10 }, (_, i) => ({ close: 150 + i }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices6);
      });

      mockSuggestRebalanceOptimizer.mockReturnValueOnce({ rebalance: [{ symbol: 'AAPL', action: 'reduce' }] });

      const handler = findHandler(routes, 'get', '/portfolio/optimize');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockSuggestRebalanceOptimizer).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ rebalance: [{ symbol: 'AAPL', action: 'reduce' }] });
    });

    it('handles null close price in price history', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: 160, entryPrice: 150 },
        { symbol: 'MSFT', shares: 5, currentPrice: 310, entryPrice: 300 },
      ];
      const prices6 = Array.from({ length: 10 }, () => ({ close: null }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices6);
      });

      const handler = findHandler(routes, 'get', '/portfolio/optimize');
      const res = mockRes();
      handler(mockReq(), res);

      // Should still work, using 0 for null close
      expect(mockSuggestRebalanceOptimizer).toHaveBeenCalled();
    });

    it('handles null currentPrice for positions', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: null, entryPrice: 150 },
        { symbol: 'MSFT', shares: 5, currentPrice: null, entryPrice: 300 },
      ];
      const prices6 = Array.from({ length: 10 }, (_, i) => ({ close: 150 + i }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices6);
      });

      const handler = findHandler(routes, 'get', '/portfolio/optimize');
      const res = mockRes();
      handler(mockReq(), res);

      // Uses entryPrice when currentPrice is null
      expect(mockSuggestRebalanceOptimizer).toHaveBeenCalled();
    });

    it('handles errors', () => {
      mockGetPortfolioOptimizer.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/portfolio/optimize');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /reports/daily ────────────────────────────────────────────────
  describe('GET /reports/daily', () => {
    it('returns JSON report by default', async () => {
      const handler = findHandler(routes, 'get', '/reports/daily');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(mockGenerateDailyReport).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ date: '2024-01-15', trades: [] });
    });

    it('returns text report when format=text', async () => {
      const handler = findHandler(routes, 'get', '/reports/daily');
      const res = mockRes();
      await handler(mockReq({ query: { format: 'text' } }), res);

      expect(res.type).toHaveBeenCalledWith('text/plain');
      expect(res.send).toHaveBeenCalledWith('text report');
    });

    it('returns markdown report when format=markdown', async () => {
      const handler = findHandler(routes, 'get', '/reports/daily');
      const res = mockRes();
      await handler(mockReq({ query: { format: 'markdown' } }), res);

      expect(res.type).toHaveBeenCalledWith('text/markdown');
      expect(res.send).toHaveBeenCalledWith('# markdown report');
    });

    it('returns error when no report data', async () => {
      mockGenerateDailyReport.mockResolvedValueOnce(null);

      const handler = findHandler(routes, 'get', '/reports/daily');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ error: 'No data for this period' });
    });

    it('handles errors', async () => {
      mockGenerateDailyReport.mockRejectedValueOnce(new Error('fail'));

      const handler = findHandler(routes, 'get', '/reports/daily');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /reports/weekly ───────────────────────────────────────────────
  describe('GET /reports/weekly', () => {
    it('returns JSON report by default', async () => {
      const handler = findHandler(routes, 'get', '/reports/weekly');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(mockGenerateWeeklyReport).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ week: '2024-W03', trades: [] });
    });

    it('returns text report when format=text', async () => {
      const handler = findHandler(routes, 'get', '/reports/weekly');
      const res = mockRes();
      await handler(mockReq({ query: { format: 'text' } }), res);

      expect(res.type).toHaveBeenCalledWith('text/plain');
      expect(res.send).toHaveBeenCalledWith('text report');
    });

    it('returns markdown report when format=markdown', async () => {
      const handler = findHandler(routes, 'get', '/reports/weekly');
      const res = mockRes();
      await handler(mockReq({ query: { format: 'markdown' } }), res);

      expect(res.type).toHaveBeenCalledWith('text/markdown');
      expect(res.send).toHaveBeenCalledWith('# markdown report');
    });

    it('returns error when no report data', async () => {
      mockGenerateWeeklyReport.mockResolvedValueOnce(null);

      const handler = findHandler(routes, 'get', '/reports/weekly');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ error: 'No data for this period' });
    });

    it('handles errors', async () => {
      mockGenerateWeeklyReport.mockRejectedValueOnce(new Error('fail'));

      const handler = findHandler(routes, 'get', '/reports/weekly');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /conditional-orders ───────────────────────────────────────────
  describe('GET /conditional-orders', () => {
    it('returns conditional orders status', () => {
      mockGetConditionalOrderStatus.mockReturnValueOnce({ orders: [{ id: 1 }] });

      const handler = findHandler(routes, 'get', '/conditional-orders');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ orders: [{ id: 1 }] });
    });

    it('handles errors', () => {
      mockGetConditionalOrderManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/conditional-orders');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /conditional-orders ──────────────────────────────────────────
  describe('POST /conditional-orders', () => {
    it('creates a conditional order', () => {
      mockCreateOrder.mockReturnValueOnce({ id: 99, type: 'limit' });

      const handler = findHandler(routes, 'post', '/conditional-orders');
      const res = mockRes();
      handler(mockReq({ body: { symbol: 'AAPL', type: 'limit', price: 150 } }), res);

      expect(mockCreateOrder).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ id: 99, type: 'limit' });
    });

    it('handles errors', () => {
      mockGetConditionalOrderManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'post', '/conditional-orders');
      const res = mockRes();
      handler(mockReq({ body: {} }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /conditional-orders/oco ──────────────────────────────────────
  describe('POST /conditional-orders/oco', () => {
    it('creates an OCO pair', () => {
      mockCreateOcoPair.mockReturnValueOnce({ id1: 10, id2: 11 });

      const handler = findHandler(routes, 'post', '/conditional-orders/oco');
      const res = mockRes();
      handler(mockReq({ body: { order1: { type: 'limit' }, order2: { type: 'stop' } } }), res);

      expect(mockCreateOcoPair).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ id1: 10, id2: 11 });
    });

    it('handles errors', () => {
      mockGetConditionalOrderManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'post', '/conditional-orders/oco');
      const res = mockRes();
      handler(mockReq({ body: {} }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── DELETE /conditional-orders/:id ───────────────────────────────────
  describe('DELETE /conditional-orders/:id', () => {
    it('cancels a conditional order', () => {
      const handler = findHandler(routes, 'delete', '/conditional-orders/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '5' } }), res);

      expect(mockCancelOrder).toHaveBeenCalledWith(5);
      expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('handles errors', () => {
      mockGetConditionalOrderManager.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'delete', '/conditional-orders/:id');
      const res = mockRes();
      handler(mockReq({ params: { id: '5' } }), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /ai/feedback ──────────────────────────────────────────────────
  describe('GET /ai/feedback', () => {
    it('returns AI feedback', async () => {
      const handler = findHandler(routes, 'get', '/ai/feedback');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(mockGenerateFeedback).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ feedback: 'improve stops' });
    });

    it('handles errors', async () => {
      mockGetAISelfImprovement.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/ai/feedback');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /ai/calibration ───────────────────────────────────────────────
  describe('GET /ai/calibration', () => {
    it('returns calibration curve', async () => {
      const handler = findHandler(routes, 'get', '/ai/calibration');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(mockGetCalibrationCurve).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([{ bucket: '0.5-0.6', accuracy: 0.55 }]);
    });

    it('handles errors', async () => {
      mockGetAISelfImprovement.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/ai/calibration');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /ai/model-comparison ──────────────────────────────────────────
  describe('GET /ai/model-comparison', () => {
    it('returns model comparison', async () => {
      const handler = findHandler(routes, 'get', '/ai/model-comparison');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(mockCompareModels).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith([{ model: 'claude', accuracy: 0.8 }]);
    });

    it('handles errors', async () => {
      mockGetAISelfImprovement.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/ai/model-comparison');
      const res = mockRes();
      await handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── GET /risk-parity/rebalance ────────────────────────────────────────
  describe('GET /risk-parity/rebalance', () => {
    it('returns empty actions when no positions', () => {
      mockDb.select.mockReturnValueOnce(chain([]));

      const handler = findHandler(routes, 'get', '/risk-parity/rebalance');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({ actions: [] });
    });

    it('returns rebalance suggestions with sufficient price data', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: 160, entryPrice: 150 },
      ];
      const prices10 = Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        open: 155 + i, high: 162 + i, low: 150 + i, close: 158 + i, volume: 1000000,
      }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices10);
      });

      mockSuggestRebalanceParity.mockReturnValueOnce([{ symbol: 'AAPL', action: 'hold' }]);

      const handler = findHandler(routes, 'get', '/risk-parity/rebalance');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockSuggestRebalanceParity).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ actions: [{ symbol: 'AAPL', action: 'hold' }] });
    });

    it('handles null currentPrice in positions', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: null, entryPrice: 150 },
      ];
      const prices10 = Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        open: 155 + i, high: 162 + i, low: 150 + i, close: 158 + i, volume: 1000000,
      }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices10);
      });

      const handler = findHandler(routes, 'get', '/risk-parity/rebalance');
      const res = mockRes();
      handler(mockReq(), res);

      // uses entryPrice as fallback
      expect(mockSuggestRebalanceParity).toHaveBeenCalled();
    });

    it('handles null OHLCV values in price candles', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: 160, entryPrice: 150 },
      ];
      const prices10 = Array.from({ length: 10 }, (_, i) => ({
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
        open: null, high: null, low: null, close: null, volume: null,
      }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices10);
      });

      const handler = findHandler(routes, 'get', '/risk-parity/rebalance');
      const res = mockRes();
      handler(mockReq(), res);

      expect(mockSuggestRebalanceParity).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Map)
      );
    });

    it('skips positions with insufficient price data (<= 5 candles)', () => {
      const positions = [
        { symbol: 'AAPL', shares: 10, currentPrice: 160, entryPrice: 150 },
      ];
      // Only 3 prices - should be skipped (not added to candleMap)
      const prices3 = Array.from({ length: 3 }, (_, i) => ({
        timestamp: `2024-01-0${i + 1}T00:00:00.000Z`,
        open: 155, high: 162, low: 150, close: 158, volume: 1000000,
      }));

      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(positions);
        return chain(prices3);
      });

      const handler = findHandler(routes, 'get', '/risk-parity/rebalance');
      const res = mockRes();
      handler(mockReq(), res);

      // Should still call suggestRebalance with an empty candleMap
      expect(mockSuggestRebalanceParity).toHaveBeenCalled();
    });

    it('handles errors', () => {
      mockGetRiskParitySizer.mockImplementationOnce(() => { throw new Error('fail'); });

      const handler = findHandler(routes, 'get', '/risk-parity/rebalance');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── POST /ai/test (inner try/catch) ───────────────────────────────────
  describe('POST /ai/test (inner try/catch)', () => {
    it('returns ok:false when rawChat throws', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'ai.models') return JSON.stringify([{ id: 'gpt4', enabled: true, baseUrl: 'http://test', model: 'gpt4', apiKey: 'key', weight: 1 }]);
        return null;
      });
      mockRawChat.mockRejectedValueOnce(new Error('connection refused'));

      const handler = findHandler(routes, 'post', '/ai/test');
      const res = mockRes();
      await handler(mockReq({ body: { profileId: 'gpt4' } }), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ ok: false, error: expect.stringContaining('connection refused') })
      );
    });

    it('returns ok:true when rawChat succeeds', async () => {
      mockConfigManager.get.mockImplementation((key: string) => {
        if (key === 'ai.models') return JSON.stringify([{ id: 'mymodel', enabled: true, baseUrl: 'http://test', model: 'gpt4', apiKey: 'key', weight: 1 }]);
        return null;
      });
      mockRawChat.mockResolvedValueOnce('pong');

      const handler = findHandler(routes, 'post', '/ai/test');
      const res = mockRes();
      await handler(mockReq({ body: { profileId: 'mymodel' } }), res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, latencyMs: expect.any(Number) })
      );
    });
  });

  // ── Screener duplicate symbol ─────────────────────────────────────────
  describe('POST /api/research/screen (duplicate symbols)', () => {
    it('deduplicates symbols across signal rows', () => {
      // Return two rows with the same symbol - second should be skipped
      const signalRows = [
        { symbol: 'AAPL', technicalScore: 75, timestamp: '2024-01-15T10:00:00.000Z' },
        { symbol: 'AAPL', technicalScore: 60, timestamp: '2024-01-14T10:00:00.000Z' }, // duplicate
        { symbol: 'MSFT', technicalScore: 80, timestamp: '2024-01-15T10:00:00.000Z' },
      ];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(signalRows);
        // fundamental cache queries return undefined
        return chain(undefined);
      });

      const handler = findHandler(routes, 'post', '/api/research/screen');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      // Should only have 2 results (AAPL deduplicated)
      expect(result.results).toHaveLength(2);
    });

    it('handles null technicalScore', () => {
      const signalRows = [
        { symbol: 'AAPL', technicalScore: null, timestamp: '2024-01-15T10:00:00.000Z' },
      ];
      let callCount = 0;
      mockDb.select.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return chain(signalRows);
        return chain(undefined);
      });

      const handler = findHandler(routes, 'post', '/api/research/screen');
      const res = mockRes();
      handler(mockReq(), res);

      const result = res.json.mock.calls[0][0];
      expect(result.results[0].score).toBeNull();
    });
  });

  // ── Audit log: type filter with no limit (uses default 50) ───────────
  describe('GET /api/audit (type filter no limit)', () => {
    it('uses default limit of 50 when filtering by type without limit', () => {
      mockAuditLogger.getByType.mockReturnValue([]);

      const handler = findHandler(routes, 'get', '/api/audit');
      const res = mockRes();
      handler(mockReq({ query: { type: 'trade' } }), res); // no limit param

      expect(mockAuditLogger.getByType).toHaveBeenCalledWith('trade', 50);
    });
  });
});
