import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createLogger } from '../utils/logger.js';
import * as schema from './schema.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const log = createLogger('database');

let db: ReturnType<typeof drizzle<typeof schema>>;

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(dbPath?: string): ReturnType<typeof drizzle<typeof schema>> {
  const resolvedPath = dbPath || process.env.DB_PATH || './data/trader212.db';
  log.info({ path: resolvedPath }, 'Initializing database');

  const sqlite = new Database(resolvedPath);

  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');

  db = drizzle(sqlite, { schema });

  createTables(sqlite);

  log.info('Database initialized with WAL mode');
  return db;
}

function createTables(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      t212Ticker TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
      shares REAL NOT NULL,
      entryPrice REAL NOT NULL,
      exitPrice REAL,
      pnl REAL,
      pnlPct REAL,
      entryTime TEXT NOT NULL,
      exitTime TEXT,
      stopLoss REAL,
      takeProfit REAL,
      exitReason TEXT,
      aiReasoning TEXT,
      convictionScore REAL,
      aiModel TEXT,
      accountType TEXT NOT NULL CHECK(accountType IN ('INVEST','ISA')),
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      symbol TEXT NOT NULL,
      rsi REAL, macdValue REAL, macdSignal REAL, macdHistogram REAL,
      sma20 REAL, sma50 REAL, sma200 REAL,
      ema12 REAL, ema26 REAL,
      bollingerUpper REAL, bollingerMiddle REAL, bollingerLower REAL,
      atr REAL, adx REAL,
      stochasticK REAL, stochasticD REAL,
      williamsR REAL, mfi REAL, cci REAL,
      obv REAL, vwap REAL, parabolicSar REAL,
      roc REAL, forceIndex REAL, volumeRatio REAL,
      supportLevel REAL, resistanceLevel REAL,
      technicalScore REAL, sentimentScore REAL, fundamentalScore REAL,
      aiScore REAL, convictionTotal REAL,
      decision TEXT CHECK(decision IN ('BUY','SELL','HOLD')),
      executed INTEGER DEFAULT 0,
      aiReasoning TEXT, aiModel TEXT,
      suggestedStopLossPct REAL, suggestedPositionSizePct REAL, suggestedTakeProfitPct REAL,
      extraIndicators TEXT, newsHeadlines TEXT
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL UNIQUE,
      t212Ticker TEXT NOT NULL,
      shares REAL NOT NULL,
      entryPrice REAL NOT NULL,
      entryTime TEXT NOT NULL,
      currentPrice REAL, pnl REAL, pnlPct REAL,
      stopLoss REAL, trailingStop REAL, takeProfit REAL,
      convictionScore REAL, stopOrderId TEXT, takeProfitOrderId TEXT, aiExitConditions TEXT,
      accountType TEXT NOT NULL CHECK(accountType IN ('INVEST','ISA')),
      updatedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS price_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      open REAL, high REAL, low REAL, close REAL, volume REAL,
      timeframe TEXT DEFAULT '1d'
    );
    CREATE INDEX IF NOT EXISTS idx_price_symbol_ts ON price_cache(symbol, timestamp);

    CREATE TABLE IF NOT EXISTS news_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT, url TEXT, publishedAt TEXT,
      sentimentScore REAL, fetchedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_news_symbol ON news_cache(symbol, fetchedAt);

    CREATE TABLE IF NOT EXISTS earnings_calendar (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      earningsDate TEXT NOT NULL,
      estimate REAL, actual REAL, surprise REAL,
      fetchedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_earnings_symbol ON earnings_calendar(symbol, earningsDate);

    CREATE TABLE IF NOT EXISTS insider_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      filingDate TEXT, transactionDate TEXT, ownerName TEXT,
      transactionType TEXT, shares REAL, pricePerShare REAL, totalValue REAL,
      fetchedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_insider_symbol ON insider_transactions(symbol, fetchedAt);

    CREATE TABLE IF NOT EXISTS fundamental_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      fetchedAt TEXT NOT NULL,
      peRatio REAL, forwardPE REAL, revenueGrowthYoY REAL,
      profitMargin REAL, operatingMargin REAL,
      debtToEquity REAL, currentRatio REAL, marketCap REAL,
      sector TEXT, industry TEXT,
      earningsSurprise REAL, dividendYield REAL, beta REAL
    );
    CREATE INDEX IF NOT EXISTS idx_fund_symbol ON fundamental_cache(symbol, fetchedAt);

    CREATE TABLE IF NOT EXISTS daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      totalPnl REAL, tradesCount INTEGER, winCount INTEGER, lossCount INTEGER,
      winRate REAL, maxDrawdown REAL, sharpeRatio REAL, profitFactor REAL,
      portfolioValue REAL, cashBalance REAL, accountType TEXT
    );

    CREATE TABLE IF NOT EXISTS pairlist_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      symbols TEXT NOT NULL,
      filterStats TEXT
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trade_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      t212Ticker TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','executed','expired')),
      side TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
      entryPrice REAL NOT NULL,
      shares INTEGER NOT NULL,
      positionValue REAL NOT NULL,
      positionSizePct REAL NOT NULL,
      stopLossPrice REAL NOT NULL,
      stopLossPct REAL NOT NULL,
      takeProfitPrice REAL NOT NULL,
      takeProfitPct REAL NOT NULL,
      maxLossDollars REAL NOT NULL,
      riskRewardRatio REAL NOT NULL,
      maxHoldDays INTEGER,
      aiConviction REAL NOT NULL,
      aiReasoning TEXT,
      aiModel TEXT,
      risks TEXT,
      urgency TEXT,
      exitConditions TEXT,
      technicalScore REAL,
      fundamentalScore REAL,
      sentimentScore REAL,
      accountType TEXT NOT NULL CHECK(accountType IN ('INVEST','ISA')),
      approvedAt TEXT,
      approvedBy TEXT,
      expiresAt TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trade_plans_symbol ON trade_plans(symbol, status);

    CREATE TABLE IF NOT EXISTS ai_research (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      query TEXT NOT NULL,
      symbols TEXT NOT NULL,
      results TEXT NOT NULL,
      aiModel TEXT,
      marketContext TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_ts ON ai_research(timestamp);

    CREATE TABLE IF NOT EXISTS model_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aiModel TEXT NOT NULL,
      symbol TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('BUY','SELL','HOLD')),
      conviction REAL NOT NULL,
      signalTimestamp TEXT NOT NULL,
      priceAtSignal REAL NOT NULL,
      priceAfter1d REAL,
      priceAfter5d REAL,
      priceAfter10d REAL,
      actualOutcome TEXT,
      actualReturnPct REAL,
      evaluatedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_model_perf ON model_performance(aiModel, signalTimestamp);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      eventType TEXT NOT NULL,
      category TEXT NOT NULL,
      symbol TEXT,
      summary TEXT NOT NULL,
      details TEXT,
      severity TEXT NOT NULL DEFAULT 'info'
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp, eventType);
  `);

  log.debug('All tables created/verified');
}
