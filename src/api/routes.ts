import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { getAISelfImprovement } from '../ai/self-improvement.js';
import { CorrelationAnalyzer } from '../analysis/correlation.js';
import { createMonteCarloSimulator } from '../analysis/monte-carlo.js';
import { getPortfolioOptimizer } from '../analysis/portfolio-optimizer.js';
import { getRegimeDetector } from '../analysis/regime-detector.js';
import { createBacktestEngine } from '../backtest/engine.js';
import {
  formatEquityCurve,
  generateSummary,
  generateSymbolBreakdown,
} from '../backtest/reporter.js';
import type { BacktestConfig } from '../backtest/types.js';
import { configManager } from '../config/manager.js';
import { getStrategyProfileManager } from '../config/strategy-profiles.js';
import { getDb } from '../db/index.js';
import { getRecentEntries as getRecentJournalEntries } from '../db/repositories/journal.js';
import {
  getOrderById,
  getOrderCount,
  getOrdersBySymbol,
  getRecentOrders,
} from '../db/repositories/orders.js';
import * as schema from '../db/schema.js';
import { getConditionalOrderManager } from '../execution/conditional-orders.js';
import { getPairLockManager } from '../execution/pair-locks.js';
import { getRiskParitySizer } from '../execution/risk-parity.js';
import { getRoiThreshold, parseRoiTable } from '../execution/roi-table.js';
import { getPerformanceAttributor } from '../monitoring/attribution.js';
import { getAuditLogger } from '../monitoring/audit-log.js';
import { PerformanceTracker } from '../monitoring/performance.js';
import { getReportGenerator } from '../monitoring/report-generator.js';
import { getTaxTracker } from '../monitoring/tax-tracker.js';
import { getTradeJournalManager } from '../monitoring/trade-journal.js';
import { safeJsonParse } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';
import { getMarketTimes } from '../utils/market-hours.js';

const configUpdateSchema = z.object({
  value: z
    .union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())])
    .refine((v) => v !== undefined, 'Missing "value" in request body'),
});

const staticSymbolSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(10)
    .regex(/^[A-Z]{1,5}(\.[A-Z]{1,2})?$/, 'Invalid symbol format (e.g. AAPL, BRK.B)')
    .transform((s) => s.toUpperCase()),
});

const researchRunSchema = z
  .object({
    focus: z.string().max(500).optional(),
    symbols: z.array(z.string().min(1).max(10)).max(20).optional(),
  })
  .optional();

const backtestSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(50),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  initialCapital: z.number().positive().default(10000),
  maxPositions: z.number().int().min(1).max(50).default(5),
  maxPositionSizePct: z.number().min(0.01).max(1).default(0.15),
  stopLossPct: z.number().min(0.001).max(0.5).default(0.05),
  takeProfitPct: z.number().min(0.001).max(5).optional(),
  roiTable: z.record(z.string(), z.number()).optional(),
  trailingStop: z.boolean().default(false),
  commission: z.number().min(0).default(0),
  entryThreshold: z.number().min(0).max(1).default(0.6),
});

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

      // Enrich positions with ROI threshold info if enabled
      const roiEnabled = configManager.get<boolean>('exit.roiEnabled');
      let enrichedPositions = positionRows;
      if (roiEnabled) {
        const roiTableJson = configManager.get<string>('exit.roiTable');
        const roiTable = parseRoiTable(
          typeof roiTableJson === 'string' ? roiTableJson : JSON.stringify(roiTableJson),
        );
        const now = Date.now();
        enrichedPositions = positionRows.map((p) => {
          const tradeMinutes = (now - new Date(p.entryTime).getTime()) / 60000;
          const threshold = getRoiThreshold(roiTable, tradeMinutes);
          const pnlPct =
            p.currentPrice != null ? (p.currentPrice - p.entryPrice) / p.entryPrice : null;
          return {
            ...p,
            roiThreshold: threshold,
            roiTradeMinutes: Math.round(tradeMinutes),
            roiDistancePct: threshold != null && pnlPct != null ? pnlPct - threshold : null,
          };
        });
      }

      res.json({
        positions: enrichedPositions,
        cashAvailable,
        totalValue: totalValue + cashAvailable,
        pnl: totalPnl,
        roiEnabled,
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
      const tracker = new PerformanceTracker();
      const metrics = tracker.getMetrics();

      const db = getDb();
      const allClosed = db
        .select()
        .from(schema.trades)
        .where(sql`${schema.trades.exitPrice} IS NOT NULL`)
        .all();

      const totalPnl = allClosed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

      res.json({
        winRate: metrics.winRate,
        avgReturn: metrics.avgReturnPct,
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        calmarRatio: metrics.calmarRatio,
        sqn: metrics.sqn,
        maxDrawdown: metrics.maxDrawdown,
        currentDrawdown: metrics.currentDrawdown,
        profitFactor: metrics.profitFactor,
        expectancy: metrics.expectancy,
        expectancyRatio: metrics.expectancyRatio,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        totalTrades: metrics.totalTrades,
        totalPnl,
        avgHoldDuration: metrics.avgHoldDuration,
        bestTrade: metrics.bestTrade,
        worstTrade: metrics.worstTrade,
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

      const stocks = safeJsonParse(latest.symbols, []);
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
        symbols: safeJsonParse(r.symbols, []),
        filterStats: r.filterStats ? safeJsonParse(r.filterStats, null) : null,
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
          value: safeJsonParse(row.value, row.value),
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
      const parsed = configUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }
      const { value } = parsed.data;

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
      const parsed = researchRunSchema.safeParse(req.body);
      if (parsed.success === false) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }
      const { focus, symbols } = parsed.data ?? {};
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
      const parsed = staticSymbolSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid symbol' });
        return;
      }
      const { symbol } = parsed.data;
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

  // ── Orders (list with filters) ──────────────────────────────────────
  router.get('/api/orders', (req, res) => {
    try {
      const { symbol, status, limit } = req.query;
      const filters = {
        symbol: symbol ? String(symbol) : undefined,
        status: status ? String(status) : undefined,
        limit: limit ? Number(limit) : undefined,
      };

      const rows = getRecentOrders(filters);
      const total = getOrderCount({
        symbol: filters.symbol,
        status: filters.status,
      });

      res.json({ orders: rows, total });
    } catch (err) {
      log.error({ err }, 'Error fetching orders');
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  });

  // ── Single order ──────────────────────────────────────────────────
  router.get('/api/orders/:id', (req, res) => {
    try {
      const order = getOrderById(Number(req.params.id));
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      res.json(order);
    } catch (err) {
      log.error({ err }, 'Error fetching order');
      res.status(500).json({ error: 'Failed to fetch order' });
    }
  });

  // ── Orders for a position (by symbol) ──────────────────────────────
  router.get('/api/positions/:symbol/orders', (req, res) => {
    try {
      const { symbol } = req.params;
      const orders = getOrdersBySymbol(symbol);
      res.json({ orders });
    } catch (err) {
      log.error({ err }, 'Error fetching position orders');
      res.status(500).json({ error: 'Failed to fetch position orders' });
    }
  });

  // ── Protections: Active pair locks ──────────────────────────────────
  router.get('/api/protections/locks', (_req, res) => {
    try {
      const lockManager = getPairLockManager();
      const locks = lockManager.getActiveLocks();
      res.json({ locks });
    } catch (err) {
      log.error({ err }, 'Error fetching pair locks');
      res.status(500).json({ error: 'Failed to fetch pair locks' });
    }
  });

  // ── Protections: Manually unlock a pair ───────────────────────────
  router.delete('/api/protections/locks/:symbol', (req, res) => {
    try {
      const { symbol } = req.params;
      const lockManager = getPairLockManager();
      lockManager.unlockPair(symbol);
      const audit = getAuditLogger();
      audit.logControl(`Manually unlocked pair: ${symbol}`, { symbol });
      res.json({ message: `Pair ${symbol} unlocked` });
    } catch (err) {
      log.error({ err }, 'Error unlocking pair');
      res.status(500).json({ error: 'Failed to unlock pair' });
    }
  });

  // ── Backtest ────────────────────────────────────────────────────────
  router.post('/api/backtest', async (req, res) => {
    try {
      const parsed = backtestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
        return;
      }

      const backtestConfig: BacktestConfig = parsed.data;
      const engine = await createBacktestEngine(backtestConfig);
      const result = await engine.run();

      res.json({
        summary: generateSummary(result),
        symbolBreakdown: generateSymbolBreakdown(result),
        equityCurve: formatEquityCurve(result),
        metrics: result.metrics,
        trades: result.trades,
        config: result.config,
        dailyReturns: result.dailyReturns,
      });
    } catch (err) {
      log.error({ err }, 'Error running backtest');
      res.status(500).json({ error: 'Failed to run backtest' });
    }
  });

  // ── Market Regime ──────────────────────────────────────────────────
  router.get('/regime', (_req, res) => {
    try {
      const detector = getRegimeDetector();
      const db = getDb();
      const spyCandles = db
        .select()
        .from(schema.priceCache)
        .where(eq(schema.priceCache.symbol, 'SPY'))
        .orderBy(desc(schema.priceCache.timestamp))
        .limit(200)
        .all();
      if (spyCandles.length < 20) {
        res.json({ regime: null, message: 'Insufficient SPY data' });
        return;
      }
      const candles = spyCandles.reverse().map((c) => ({
        date: c.timestamp,
        open: c.open ?? 0,
        high: c.high ?? 0,
        low: c.low ?? 0,
        close: c.close ?? 0,
        volume: c.volume ?? 0,
      }));
      const result = detector.detect(candles);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Error detecting regime');
      res.status(500).json({ error: 'Failed to detect market regime' });
    }
  });

  // ── Strategy Profiles ────────────────────────────────────────────
  router.get('/strategy-profiles', (_req, res) => {
    try {
      const manager = getStrategyProfileManager();
      res.json(manager.listProfiles());
    } catch (err) {
      log.error({ err }, 'Error listing strategy profiles');
      res.status(500).json({ error: 'Failed to list strategy profiles' });
    }
  });

  router.post('/strategy-profiles/:name/activate', async (req, res) => {
    try {
      const manager = getStrategyProfileManager();
      const name = req.params.name;
      await manager.applyProfile(name);
      res.json({ success: true, message: `Profile '${name}' activated` });
    } catch (err) {
      log.error({ err }, 'Error activating strategy profile');
      res.status(500).json({ error: 'Failed to activate profile' });
    }
  });

  // ── Monte Carlo Simulation ───────────────────────────────────────
  router.post('/monte-carlo/simulate', (_req, res) => {
    try {
      const simulator = createMonteCarloSimulator();
      const db = getDb();
      const closedTrades = db
        .select({ pnl: schema.trades.pnl, pnlPct: schema.trades.pnlPct })
        .from(schema.trades)
        .where(sql`${schema.trades.exitPrice} IS NOT NULL AND ${schema.trades.pnlPct} IS NOT NULL`)
        .all();
      if (closedTrades.length < 5) {
        res.json({ error: 'Need at least 5 closed trades for simulation' });
        return;
      }
      const result = simulator.simulate(closedTrades);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Error running Monte Carlo simulation');
      res.status(500).json({ error: 'Failed to run simulation' });
    }
  });

  // ── Performance Attribution ──────────────────────────────────────
  router.get('/attribution', (_req, res) => {
    try {
      const attributor = getPerformanceAttributor();
      const result = attributor.getFactorBreakdown();
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Error generating attribution');
      res.status(500).json({ error: 'Failed to generate attribution' });
    }
  });

  // ── Trade Journal ────────────────────────────────────────────────
  router.get('/journal', (req, res) => {
    try {
      const manager = getTradeJournalManager();
      const symbol = req.query.symbol as string | undefined;
      const limit = Number(req.query.limit) || 50;
      if (symbol) {
        res.json(manager.getSymbolHistory(symbol, limit));
      } else {
        res.json(getRecentJournalEntries(limit));
      }
    } catch (err) {
      log.error({ err }, 'Error fetching journal');
      res.status(500).json({ error: 'Failed to fetch journal' });
    }
  });

  router.post('/journal', (req, res) => {
    try {
      const { symbol, note, tags, tradeId, positionId } = req.body;
      if (!symbol || !note) {
        res.status(400).json({ error: 'symbol and note are required' });
        return;
      }
      const manager = getTradeJournalManager();
      const entry = manager.addNote(symbol, note, { tradeId, positionId, tags });
      res.json(entry);
    } catch (err) {
      log.error({ err }, 'Error adding journal entry');
      res.status(500).json({ error: 'Failed to add journal entry' });
    }
  });

  router.get('/journal/search', (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        res.status(400).json({ error: 'q query parameter is required' });
        return;
      }
      const manager = getTradeJournalManager();
      res.json(manager.search(query));
    } catch (err) {
      log.error({ err }, 'Error searching journal');
      res.status(500).json({ error: 'Failed to search journal' });
    }
  });

  router.get('/journal/insights', (_req, res) => {
    try {
      const manager = getTradeJournalManager();
      res.json(manager.getInsights());
    } catch (err) {
      log.error({ err }, 'Error generating journal insights');
      res.status(500).json({ error: 'Failed to generate insights' });
    }
  });

  // ── Tax Tracking ─────────────────────────────────────────────────
  router.get('/tax/summary', (req, res) => {
    try {
      const tracker = getTaxTracker();
      const year = Number(req.query.year) || new Date().getFullYear();
      res.json(tracker.getYearlyTaxSummary(year));
    } catch (err) {
      log.error({ err }, 'Error generating tax summary');
      res.status(500).json({ error: 'Failed to generate tax summary' });
    }
  });

  router.get('/tax/harvest-candidates', (_req, res) => {
    try {
      const tracker = getTaxTracker();
      const db = getDb();
      const positions = db.select().from(schema.positions).all();
      const priceMap = new Map<string, number>();
      for (const pos of positions) {
        if (pos.currentPrice) priceMap.set(pos.symbol, pos.currentPrice);
      }
      res.json(tracker.getHarvestCandidates(priceMap));
    } catch (err) {
      log.error({ err }, 'Error finding harvest candidates');
      res.status(500).json({ error: 'Failed to find harvest candidates' });
    }
  });

  // ── Portfolio Optimization ───────────────────────────────────────
  router.get('/portfolio/optimize', (_req, res) => {
    try {
      const optimizer = getPortfolioOptimizer();
      const db = getDb();
      const positions = db.select().from(schema.positions).all();
      if (positions.length === 0) {
        res.json({ error: 'No open positions to optimize' });
        return;
      }
      const posInfos = positions.map((p) => ({
        symbol: p.symbol,
        shares: p.shares,
        currentPrice: p.currentPrice ?? p.entryPrice,
        weight: 0,
      }));
      const totalValue = posInfos.reduce((s, p) => s + p.shares * p.currentPrice, 0);
      for (const p of posInfos) {
        p.weight = (p.shares * p.currentPrice) / totalValue;
      }
      // Get price history for each symbol
      const priceHistory = new Map<string, number[]>();
      for (const pos of positions) {
        const prices = db
          .select({ close: schema.priceCache.close })
          .from(schema.priceCache)
          .where(eq(schema.priceCache.symbol, pos.symbol))
          .orderBy(desc(schema.priceCache.timestamp))
          .limit(60)
          .all();
        if (prices.length > 5) {
          priceHistory.set(
            pos.symbol,
            prices.reverse().map((p) => p.close ?? 0),
          );
        }
      }
      if (priceHistory.size < 2) {
        res.json({ error: 'Need price data for at least 2 positions' });
        return;
      }
      const result = optimizer.suggestRebalance(posInfos, priceHistory, totalValue);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Error optimizing portfolio');
      res.status(500).json({ error: 'Failed to optimize portfolio' });
    }
  });

  // ── Reports ──────────────────────────────────────────────────────
  router.get('/reports/daily', async (req, res) => {
    try {
      const generator = getReportGenerator();
      const date = (req.query.date as string) || undefined;
      const report = await generator.generateDailyReport(date);
      if (!report) {
        res.json({ error: 'No data for this period' });
        return;
      }
      const format = (req.query.format as string) || 'json';
      if (format === 'text') res.type('text/plain').send(generator.formatAsText(report));
      else if (format === 'markdown')
        res.type('text/markdown').send(generator.formatAsMarkdown(report));
      else res.json(report);
    } catch (err) {
      log.error({ err }, 'Error generating daily report');
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  router.get('/reports/weekly', async (req, res) => {
    try {
      const generator = getReportGenerator();
      const report = await generator.generateWeeklyReport();
      if (!report) {
        res.json({ error: 'No data for this period' });
        return;
      }
      const format = (req.query.format as string) || 'json';
      if (format === 'text') res.type('text/plain').send(generator.formatAsText(report));
      else if (format === 'markdown')
        res.type('text/markdown').send(generator.formatAsMarkdown(report));
      else res.json(report);
    } catch (err) {
      log.error({ err }, 'Error generating weekly report');
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // ── Conditional Orders ───────────────────────────────────────────
  router.get('/conditional-orders', (_req, res) => {
    try {
      const manager = getConditionalOrderManager();
      res.json(manager.getStatus());
    } catch (err) {
      log.error({ err }, 'Error fetching conditional orders');
      res.status(500).json({ error: 'Failed to fetch conditional orders' });
    }
  });

  router.post('/conditional-orders', (req, res) => {
    try {
      const manager = getConditionalOrderManager();
      const order = manager.createOrder(req.body);
      res.json(order);
    } catch (err) {
      log.error({ err }, 'Error creating conditional order');
      res.status(500).json({ error: 'Failed to create conditional order' });
    }
  });

  router.post('/conditional-orders/oco', (req, res) => {
    try {
      const manager = getConditionalOrderManager();
      const { order1, order2 } = req.body;
      const result = manager.createOcoPair(order1, order2);
      res.json(result);
    } catch (err) {
      log.error({ err }, 'Error creating OCO pair');
      res.status(500).json({ error: 'Failed to create OCO pair' });
    }
  });

  router.delete('/conditional-orders/:id', (req, res) => {
    try {
      const manager = getConditionalOrderManager();
      manager.cancelOrder(Number(req.params.id));
      res.json({ success: true });
    } catch (err) {
      log.error({ err }, 'Error cancelling conditional order');
      res.status(500).json({ error: 'Failed to cancel conditional order' });
    }
  });

  // ── AI Self-Improvement ──────────────────────────────────────────
  router.get('/ai/feedback', async (_req, res) => {
    try {
      const engine = getAISelfImprovement();
      const feedback = await engine.generateFeedback();
      res.json(feedback);
    } catch (err) {
      log.error({ err }, 'Error generating AI feedback');
      res.status(500).json({ error: 'Failed to generate AI feedback' });
    }
  });

  router.get('/ai/calibration', async (_req, res) => {
    try {
      const engine = getAISelfImprovement();
      const curve = await engine.getCalibrationCurve();
      res.json(curve);
    } catch (err) {
      log.error({ err }, 'Error generating calibration curve');
      res.status(500).json({ error: 'Failed to generate calibration curve' });
    }
  });

  router.get('/ai/model-comparison', async (_req, res) => {
    try {
      const engine = getAISelfImprovement();
      const comparison = await engine.compareModels();
      res.json(comparison);
    } catch (err) {
      log.error({ err }, 'Error comparing models');
      res.status(500).json({ error: 'Failed to compare models' });
    }
  });

  // ── Risk Parity ──────────────────────────────────────────────────
  router.get('/risk-parity/rebalance', (_req, res) => {
    try {
      const sizer = getRiskParitySizer();
      const db = getDb();
      const positions = db.select().from(schema.positions).all();
      if (positions.length === 0) {
        res.json({ actions: [] });
        return;
      }
      const posInfos = positions.map((p) => ({
        symbol: p.symbol,
        shares: p.shares,
        currentPrice: p.currentPrice ?? p.entryPrice,
        entryPrice: p.entryPrice,
      }));
      const candleMap = new Map<
        string,
        Array<{
          date: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>
      >();
      for (const pos of positions) {
        const prices = db
          .select()
          .from(schema.priceCache)
          .where(eq(schema.priceCache.symbol, pos.symbol))
          .orderBy(desc(schema.priceCache.timestamp))
          .limit(30)
          .all();
        if (prices.length > 5) {
          candleMap.set(
            pos.symbol,
            prices.reverse().map((p) => ({
              date: p.timestamp,
              open: p.open ?? 0,
              high: p.high ?? 0,
              low: p.low ?? 0,
              close: p.close ?? 0,
              volume: p.volume ?? 0,
            })),
          );
        }
      }
      const actions = sizer.suggestRebalance(posInfos, candleMap);
      res.json({ actions });
    } catch (err) {
      log.error({ err }, 'Error computing risk parity rebalance');
      res.status(500).json({ error: 'Failed to compute rebalance' });
    }
  });

  return router;
}
