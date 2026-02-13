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

vi.mock('../../src/db/schema.js', () => ({
  trades: { id: 'id', symbol: 'symbol', side: 'side', entryTime: 'entryTime', exitPrice: 'exitPrice' },
  signals: { id: 'id', symbol: 'symbol', timestamp: 'timestamp' },
  positions: { symbol: 'symbol' },
  dailyMetrics: { date: 'date' },
  pairlistHistory: { timestamp: 'timestamp' },
  fundamentalCache: { symbol: 'symbol', fetchedAt: 'fetchedAt' },
  config: { key: 'key', category: 'category' },
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
  getAllRaw: vi.fn(() => []),
  getByCategory: vi.fn(() => ({})),
  invalidateCache: vi.fn(),
};

vi.mock('../../src/config/manager.js', () => ({
  configManager: mockConfigManager,
}));

const mockAuditLogger = {
  logControl: vi.fn(),
  getRecent: vi.fn(() => []),
  getEntriesForDate: vi.fn(() => []),
  getByType: vi.fn(() => []),
};

vi.mock('../../src/monitoring/audit-log.js', () => ({
  getAuditLogger: () => mockAuditLogger,
}));

const mockCorrelationMatrix = { symbols: ['AAPL'], matrix: [[1]] };

vi.mock('../../src/analysis/correlation.js', () => ({
  CorrelationAnalyzer: vi.fn().mockImplementation(() => ({
    getPortfolioCorrelationMatrix: () => mockCorrelationMatrix,
  })),
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
      mockDb.select.mockReturnValue(chain([]));

      const handler = findHandler(routes, 'get', '/api/performance');
      const res = mockRes();
      handler(mockReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        winRate: 0,
        avgReturn: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        totalTrades: 0,
        totalPnl: 0,
      });
    });

    it('calculates performance metrics from closed trades', () => {
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
      expect(result.winRate).toBeCloseTo(2 / 3);
      expect(result.totalPnl).toBeCloseTo(250);
      expect(result.profitFactor).toBeCloseTo(300 / 50);
    });

    it('handles all winning trades (grossLoss = 0)', () => {
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
      // peak=100, after -200: cumulative=-100, drawdown=200
      expect(result.maxDrawdown).toBe(200);
    });

    it('handles null pnl and pnlPct values', () => {
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

    it('handles errors', () => {
      mockDb.select.mockImplementation(() => { throw new Error('err'); });

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
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing "value" in request body' });
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

    it('handles null body', async () => {
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

      expect(runResearch).toHaveBeenCalledWith({ focus: undefined, symbols: undefined });
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
      // Reset module to get default callbacks
      vi.resetModules();
      const { createRouter } = await import('../../src/api/routes.js');
      const router = createRouter();

      // Test default status endpoint
      const statusRoute = (router as any).stack.find((l: any) => l.route?.path === '/api/status');
      expect(statusRoute).toBeDefined();
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
  });
});
