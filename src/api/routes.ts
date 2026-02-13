import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { configManager } from '../config/manager.js';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getAuditLogger } from '../monitoring/audit-log.js';
import { createLogger } from '../utils/logger.js';
import { getMarketTimes } from '../utils/market-hours.js';
import { CorrelationAnalyzer } from '../analysis/correlation.js';

const log = createLogger('api-routes');

export interface BotCallbacks {
  getStatus: () => { paused: boolean; startedAt: string };
  setPaused: (paused: boolean) => void;
  closePosition: (symbol: string) => Promise<string>;
  analyzeSymbol: (symbol: string) => Promise<string>;
  refreshPairlist: () => Promise<string>;
  emergencyStop: () => Promise<string>;
  getTradePlans: () => unknown[];
  approveTradePlan: (id: number) => unknown;
  rejectTradePlan: (id: number) => void;
  runResearch: (params?: { focus?: string; symbols?: string[] }) => Promise<unknown>;
  getResearchReports: () => unknown[];
  getModelStats: () => unknown[];
}

let callbacks: BotCallbacks = {
  getStatus: () => ({ paused: false, startedAt: new Date().toISOString() }),
  setPaused: () => {
    /* noop */
  },
  closePosition: async () => 'Not connected to bot',
  analyzeSymbol: async () => 'Not connected to bot',
  refreshPairlist: async () => 'Not connected to bot',
  emergencyStop: async () => 'Not connected to bot',
  getTradePlans: () => [],
  approveTradePlan: () => null,
  rejectTradePlan: () => {
    /* noop */
  },
  runResearch: async () => null,
  getResearchReports: () => [],
  getModelStats: () => [],
};

export function registerBotCallbacks(cb: BotCallbacks): void {
  callbacks = cb;
}

export function createRouter(): Router {
  const router = Router();

  // ── Portfolio ────────────────────────────────────────────────────────
  router.get('/api/portfolio', (_req, res) => {
    try {
      const db = getDb();
      const positionRows = db.select().from(schema.positions).all();

      let totalValue = 0;
      let totalPnl = 0;
      for (const p of positionRows) {
        const currentVal = (p.currentPrice ?? p.entryPrice) * p.shares;
        totalValue += currentVal;
        totalPnl += p.pnl ?? 0;
      }

      const cashRow = db
        .select()
        .from(schema.dailyMetrics)
        .orderBy(desc(schema.dailyMetrics.date))
        .limit(1)
        .get();

      const cashAvailable = cashRow?.cashBalance ?? 0;

      res.json({
        positions: positionRows,
        cashAvailable,
        totalValue: totalValue + cashAvailable,
        pnl: totalPnl,
      });
    } catch (err) {
      log.error({ err }, 'Error fetching portfolio');
      res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
  });

  // ── Trades (list with filters) ──────────────────────────────────────
  router.get('/api/trades', (req, res) => {
    try {
      const db = getDb();
      const { symbol, from, to, side, limit, offset } = req.query;

      const conditions = [];
      if (symbol) conditions.push(eq(schema.trades.symbol, String(symbol)));
      if (side) conditions.push(eq(schema.trades.side, String(side) as 'BUY' | 'SELL'));
      if (from) conditions.push(gte(schema.trades.entryTime, String(from)));
      if (to) conditions.push(lte(schema.trades.entryTime, String(to)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = db
        .select()
        .from(schema.trades)
        .where(where)
        .orderBy(desc(schema.trades.entryTime))
        .limit(Number(limit) || 50)
        .offset(Number(offset) || 0)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.trades)
        .where(where)
        .get();

      res.json({ trades: rows, total: countResult?.count ?? 0 });
    } catch (err) {
      log.error({ err }, 'Error fetching trades');
      res.status(500).json({ error: 'Failed to fetch trades' });
    }
  });

  // ── Single trade ────────────────────────────────────────────────────
  router.get('/api/trades/:id', (req, res) => {
    try {
      const db = getDb();
      const trade = db
        .select()
        .from(schema.trades)
        .where(eq(schema.trades.id, Number(req.params.id)))
        .get();

      if (!trade) {
        res.status(404).json({ error: 'Trade not found' });
        return;
      }
      res.json(trade);
    } catch (err) {
      log.error({ err }, 'Error fetching trade');
      res.status(500).json({ error: 'Failed to fetch trade' });
    }
  });

  // ── Signals (list with filters) ─────────────────────────────────────
  router.get('/api/signals', (req, res) => {
    try {
      const db = getDb();
      const { symbol, from, to, limit, offset } = req.query;

      const conditions = [];
      if (symbol) conditions.push(eq(schema.signals.symbol, String(symbol)));
      if (from) conditions.push(gte(schema.signals.timestamp, String(from)));
      if (to) conditions.push(lte(schema.signals.timestamp, String(to)));

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = db
        .select()
        .from(schema.signals)
        .where(where)
        .orderBy(desc(schema.signals.timestamp))
        .limit(Number(limit) || 50)
        .offset(Number(offset) || 0)
        .all();

      const countResult = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.signals)
        .where(where)
        .get();

      res.json({ signals: rows, total: countResult?.count ?? 0 });
    } catch (err) {
      log.error({ err }, 'Error fetching signals');
      res.status(500).json({ error: 'Failed to fetch signals' });
    }
  });

  // ── Latest signal for symbol ────────────────────────────────────────
  router.get('/api/signals/:symbol/latest', (req, res) => {
    try {
      const db = getDb();
      const signal = db
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.symbol, req.params.symbol))
        .orderBy(desc(schema.signals.timestamp))
        .limit(1)
        .get();

      if (!signal) {
        res.status(404).json({ error: 'No signals found for symbol' });
        return;
      }
      res.json(signal);
    } catch (err) {
      log.error({ err }, 'Error fetching latest signal');
      res.status(500).json({ error: 'Failed to fetch latest signal' });
    }
  });

  // ── Signal history for symbol ───────────────────────────────────────
  router.get('/api/signals/:symbol/history', (req, res) => {
    try {
      const db = getDb();
      const rows = db
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.symbol, req.params.symbol))
        .orderBy(desc(schema.signals.timestamp))
        .limit(50)
        .all();

      res.json({ signals: rows });
    } catch (err) {
      log.error({ err }, 'Error fetching signal history');
      res.status(500).json({ error: 'Failed to fetch signal history' });
    }
  });

  // ── Performance metrics ─────────────────────────────────────────────
  router.get('/api/performance', (_req, res) => {
    try {
      const db = getDb();
      const allClosed = db
        .select()
        .from(schema.trades)
        .where(sql`${schema.trades.exitPrice} IS NOT NULL`)
        .all();

      const totalTrades = allClosed.length;

      if (totalTrades === 0) {
        res.json({
          winRate: 0,
          avgReturn: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          profitFactor: 0,
          totalTrades: 0,
          totalPnl: 0,
        });
        return;
      }

      const wins = allClosed.filter((t) => (t.pnl ?? 0) > 0);
      const losses = allClosed.filter((t) => (t.pnl ?? 0) < 0);
      const winRate = wins.length / totalTrades;

      const returns = allClosed.map((t) => t.pnlPct ?? 0);
      const avgReturn = returns.reduce((a, b) => a + b, 0) / totalTrades;

      const totalPnl = allClosed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const grossProfit = wins.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
      const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.pnl ?? 0), 0));
      const profitFactor =
        grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

      // Sharpe ratio (annualized, assuming ~252 trading days)
      const meanReturn = avgReturn;
      const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / totalTrades;
      const stdDev = Math.sqrt(variance);
      const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

      // Max drawdown from cumulative PnL
      let peak = 0;
      let maxDrawdown = 0;
      let cumulative = 0;
      for (const trade of allClosed) {
        cumulative += trade.pnl ?? 0;
        if (cumulative > peak) peak = cumulative;
        const drawdown = peak - cumulative;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }

      res.json({
        winRate,
        avgReturn,
        sharpeRatio,
        maxDrawdown,
        profitFactor,
        totalTrades,
        totalPnl,
      });
    } catch (err) {
      log.error({ err }, 'Error computing performance');
      res.status(500).json({ error: 'Failed to compute performance' });
    }
  });

  // ── Daily performance metrics ───────────────────────────────────────
  router.get('/api/performance/daily', (_req, res) => {
    try {
      const db = getDb();
      const rows = db
        .select()
        .from(schema.dailyMetrics)
        .orderBy(desc(schema.dailyMetrics.date))
        .all();

      res.json({ metrics: rows });
    } catch (err) {
      log.error({ err }, 'Error fetching daily metrics');
      res.status(500).json({ error: 'Failed to fetch daily metrics' });
    }
  });

  // ── Pairlist (current) ──────────────────────────────────────────────
  router.get('/api/pairlist', (_req, res) => {
    try {
      const db = getDb();
      const latest = db
        .select()
        .from(schema.pairlistHistory)
        .orderBy(desc(schema.pairlistHistory.timestamp))
        .limit(1)
        .get();

      if (!latest) {
        res.json({ stocks: [], lastRefreshed: null });
        return;
      }

      const stocks = JSON.parse(latest.symbols);
      res.json({ stocks, lastRefreshed: latest.timestamp });
    } catch (err) {
      log.error({ err }, 'Error fetching pairlist');
      res.status(500).json({ error: 'Failed to fetch pairlist' });
    }
  });

  // ── Pairlist history ────────────────────────────────────────────────
  router.get('/api/pairlist/history', (_req, res) => {
    try {
      const db = getDb();
      const rows = db
        .select()
        .from(schema.pairlistHistory)
        .orderBy(desc(schema.pairlistHistory.timestamp))
        .limit(20)
        .all();

      const parsed = rows.map((r) => ({
        ...r,
        symbols: JSON.parse(r.symbols),
        filterStats: r.filterStats ? JSON.parse(r.filterStats) : null,
      }));

      res.json({ history: parsed });
    } catch (err) {
      log.error({ err }, 'Error fetching pairlist history');
      res.status(500).json({ error: 'Failed to fetch pairlist history' });
    }
  });

  // ── Stock detail ────────────────────────────────────────────────────
  router.get('/api/stock/:symbol', (req, res) => {
    try {
      const db = getDb();
      const { symbol } = req.params;

      const latestSignal = db
        .select()
        .from(schema.signals)
        .where(eq(schema.signals.symbol, symbol))
        .orderBy(desc(schema.signals.timestamp))
        .limit(1)
        .get();

      const fundamentals = db
        .select()
        .from(schema.fundamentalCache)
        .where(eq(schema.fundamentalCache.symbol, symbol))
        .orderBy(desc(schema.fundamentalCache.fetchedAt))
        .limit(1)
        .get();

      const position = db
        .select()
        .from(schema.positions)
        .where(eq(schema.positions.symbol, symbol))
        .get();

      res.json({
        signal: latestSignal ?? null,
        fundamentals: fundamentals ?? null,
        position: position ?? null,
      });
    } catch (err) {
      log.error({ err }, 'Error fetching stock detail');
      res.status(500).json({ error: 'Failed to fetch stock detail' });
    }
  });

  // ── Status ──────────────────────────────────────────────────────────
  router.get('/api/status', (_req, res) => {
    try {
      const botState = callbacks.getStatus();
      const now = Date.now();
      const startMs = new Date(botState.startedAt).getTime();
      const uptimeSeconds = Math.floor((now - startMs) / 1000);
      const marketTimes = getMarketTimes();

      res.json({
        status: botState.paused ? 'paused' : 'running',
        uptime: uptimeSeconds,
        startedAt: botState.startedAt,
        marketStatus: marketTimes.marketStatus,
        accountType: configManager.get<string>('t212.accountType'),
        environment: configManager.get<string>('t212.environment'),
        dryRun: configManager.get<boolean>('execution.dryRun'),
        marketTimes,
      });
    } catch (err) {
      log.error({ err }, 'Error fetching status');
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  // ── Config (all, grouped by category) ───────────────────────────────
  router.get('/api/config', (_req, res) => {
    try {
      const allRaw = configManager.getAllRaw();
      const grouped: Record<
        string,
        Array<{ key: string; value: unknown; description: string | null }>
      > = {};

      for (const row of allRaw) {
        if (!grouped[row.category]) grouped[row.category] = [];
        grouped[row.category].push({
          key: row.key,
          value: JSON.parse(row.value),
          description: row.description,
        });
      }

      res.json(grouped);
    } catch (err) {
      log.error({ err }, 'Error fetching config');
      res.status(500).json({ error: 'Failed to fetch config' });
    }
  });

  // ── Config by category ──────────────────────────────────────────────
  router.get('/api/config/:category', (req, res) => {
    try {
      const result = configManager.getByCategory(req.params.category);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Error fetching config category');
      res.status(500).json({ error: 'Failed to fetch config category' });
    }
  });

  // ── Update config key ───────────────────────────────────────────────
  router.put('/api/config/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;

      if (value === undefined) {
        res.status(400).json({ error: 'Missing "value" in request body' });
        return;
      }

      await configManager.set(key, value);
      configManager.invalidateCache(key);

      res.json({ key, value, updated: true });
    } catch (err) {
      log.error({ err }, 'Error updating config');
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  // ── Control: Pause ──────────────────────────────────────────────────
  router.post('/api/control/pause', (_req, res) => {
    try {
      callbacks.setPaused(true);
      log.info('Bot paused via API');
      res.json({ status: 'paused' });
    } catch (err) {
      log.error({ err }, 'Error pausing bot');
      res.status(500).json({ error: 'Failed to pause bot' });
    }
  });

  // ── Control: Resume ─────────────────────────────────────────────────
  router.post('/api/control/resume', (_req, res) => {
    try {
      callbacks.setPaused(false);
      log.info('Bot resumed via API');
      res.json({ status: 'running' });
    } catch (err) {
      log.error({ err }, 'Error resuming bot');
      res.status(500).json({ error: 'Failed to resume bot' });
    }
  });

  // ── Control: Close position ─────────────────────────────────────────
  router.post('/api/control/close/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      log.info({ symbol }, 'Close position requested via API');
      const message = await callbacks.closePosition(symbol);
      res.json({ message });
    } catch (err) {
      log.error({ err }, 'Error closing position');
      res.status(500).json({ error: 'Failed to close position' });
    }
  });

  // ── Control: Analyze symbol ─────────────────────────────────────────
  router.post('/api/control/analyze/:symbol', async (req, res) => {
    try {
      const { symbol } = req.params;
      log.info({ symbol }, 'Analysis requested via API');
      const message = await callbacks.analyzeSymbol(symbol);
      res.json({ message });
    } catch (err) {
      log.error({ err }, 'Error running analysis');
      res.status(500).json({ error: 'Failed to run analysis' });
    }
  });

  // ── Control: Refresh pairlist ───────────────────────────────────────
  router.post('/api/control/refresh-pairlist', async (_req, res) => {
    try {
      log.info('Pairlist refresh requested via API');
      const message = await callbacks.refreshPairlist();
      res.json({ message });
    } catch (err) {
      log.error({ err }, 'Error refreshing pairlist');
      res.status(500).json({ error: 'Failed to refresh pairlist' });
    }
  });

  // ── Control: Emergency Stop ───────────────────────────────────────
  router.post('/api/control/emergency-stop', async (_req, res) => {
    try {
      log.warn('EMERGENCY STOP requested via API');
      const audit = getAuditLogger();
      audit.logControl('Emergency stop triggered via dashboard', { source: 'api' });
      const message = await callbacks.emergencyStop();
      res.json({ message });
    } catch (err) {
      log.error({ err }, 'Error executing emergency stop');
      res.status(500).json({ error: 'Failed to execute emergency stop' });
    }
  });

  // ── Trade Plans ───────────────────────────────────────────────────
  router.get('/api/trade-plans', (_req, res) => {
    try {
      const plans = callbacks.getTradePlans();
      res.json({ plans });
    } catch (err) {
      log.error({ err }, 'Error fetching trade plans');
      res.status(500).json({ error: 'Failed to fetch trade plans' });
    }
  });

  router.post('/api/trade-plans/:id/approve', (req, res) => {
    try {
      const plan = callbacks.approveTradePlan(Number(req.params.id));
      if (!plan) {
        res.status(404).json({ error: 'Plan not found or already processed' });
        return;
      }
      res.json({ plan });
    } catch (err) {
      log.error({ err }, 'Error approving trade plan');
      res.status(500).json({ error: 'Failed to approve trade plan' });
    }
  });

  router.post('/api/trade-plans/:id/reject', (req, res) => {
    try {
      callbacks.rejectTradePlan(Number(req.params.id));
      res.json({ message: 'Plan rejected' });
    } catch (err) {
      log.error({ err }, 'Error rejecting trade plan');
      res.status(500).json({ error: 'Failed to reject trade plan' });
    }
  });

  // ── AI Research ───────────────────────────────────────────────────
  router.get('/api/research', (_req, res) => {
    try {
      const reports = callbacks.getResearchReports();
      res.json({ reports });
    } catch (err) {
      log.error({ err }, 'Error fetching research');
      res.status(500).json({ error: 'Failed to fetch research' });
    }
  });

  router.post('/api/research/run', async (req, res) => {
    try {
      const { focus, symbols } = req.body ?? {};
      const report = await callbacks.runResearch({ focus, symbols });
      res.json({ report });
    } catch (err) {
      log.error({ err }, 'Error running research');
      res.status(500).json({ error: 'Failed to run research' });
    }
  });

  // ── Model Performance ─────────────────────────────────────────────
  router.get('/api/model-stats', (_req, res) => {
    try {
      const stats = callbacks.getModelStats();
      res.json({ stats });
    } catch (err) {
      log.error({ err }, 'Error fetching model stats');
      res.status(500).json({ error: 'Failed to fetch model stats' });
    }
  });

  // ── Pairlist: Static symbols management ───────────────────────────
  router.post('/api/pairlist/static', (req, res) => {
    try {
      const { symbol } = req.body;
      if (!symbol || typeof symbol !== 'string') {
        res.status(400).json({ error: 'Missing symbol' });
        return;
      }
      const current = configManager.get<string[]>('pairlist.staticSymbols');
      const upper = symbol.toUpperCase();
      if (!current.includes(upper)) {
        current.push(upper);
        configManager.set('pairlist.staticSymbols', current);
        configManager.invalidateCache('pairlist.staticSymbols');
      }
      const audit = getAuditLogger();
      audit.logControl(`Added ${upper} to static pairlist`, { symbol: upper });
      res.json({ symbols: current });
    } catch (err) {
      log.error({ err }, 'Error adding static symbol');
      res.status(500).json({ error: 'Failed to add static symbol' });
    }
  });

  router.delete('/api/pairlist/static/:symbol', (req, res) => {
    try {
      const upper = req.params.symbol.toUpperCase();
      const current = configManager.get<string[]>('pairlist.staticSymbols');
      const updated = current.filter((s) => s !== upper);
      configManager.set('pairlist.staticSymbols', updated);
      configManager.invalidateCache('pairlist.staticSymbols');
      const audit = getAuditLogger();
      audit.logControl(`Removed ${upper} from static pairlist`, { symbol: upper });
      res.json({ symbols: updated });
    } catch (err) {
      log.error({ err }, 'Error removing static symbol');
      res.status(500).json({ error: 'Failed to remove static symbol' });
    }
  });

  // ── Audit Log ─────────────────────────────────────────────────────
  router.get('/api/audit', (req, res) => {
    try {
      const audit = getAuditLogger();
      const { date, type, limit: lim } = req.query;
      let entries: ReturnType<typeof audit.getRecent>;
      if (date) {
        entries = audit.getEntriesForDate(String(date));
      } else if (type) {
        entries = audit.getByType(
          String(type) as Parameters<typeof audit.getByType>[0],
          Number(lim) || 50,
        );
      } else {
        entries = audit.getRecent(Number(lim) || 100);
      }
      res.json({ entries });
    } catch (err) {
      log.error({ err }, 'Error fetching audit log');
      res.status(500).json({ error: 'Failed to fetch audit log' });
    }
  });

  // ── Correlation matrix ────────────────────────────────────────────
  router.get('/api/correlation', (_req, res) => {
    try {
      const analyzer = new CorrelationAnalyzer();
      const matrix = analyzer.getPortfolioCorrelationMatrix();
      res.json(matrix);
    } catch (err) {
      log.error({ err }, 'Error computing correlation matrix');
      res.status(500).json({ error: 'Failed to compute correlation matrix' });
    }
  });

  return router;
}
