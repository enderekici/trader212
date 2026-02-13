import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  t212Ticker: text('t212Ticker').notNull(),
  side: text('side', { enum: ['BUY', 'SELL'] }).notNull(),
  shares: real('shares').notNull(),
  entryPrice: real('entryPrice').notNull(),
  exitPrice: real('exitPrice'),
  pnl: real('pnl'),
  pnlPct: real('pnlPct'),
  entryTime: text('entryTime').notNull(),
  exitTime: text('exitTime'),
  stopLoss: real('stopLoss'),
  takeProfit: real('takeProfit'),
  exitReason: text('exitReason'),
  aiReasoning: text('aiReasoning'),
  convictionScore: real('convictionScore'),
  aiModel: text('aiModel'),
  accountType: text('accountType', { enum: ['INVEST', 'ISA'] }).notNull(),
  createdAt: text('createdAt').default('CURRENT_TIMESTAMP'),
});

export const signals = sqliteTable('signals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull(),
  symbol: text('symbol').notNull(),
  rsi: real('rsi'),
  macdValue: real('macdValue'),
  macdSignal: real('macdSignal'),
  macdHistogram: real('macdHistogram'),
  sma20: real('sma20'),
  sma50: real('sma50'),
  sma200: real('sma200'),
  ema12: real('ema12'),
  ema26: real('ema26'),
  bollingerUpper: real('bollingerUpper'),
  bollingerMiddle: real('bollingerMiddle'),
  bollingerLower: real('bollingerLower'),
  atr: real('atr'),
  adx: real('adx'),
  stochasticK: real('stochasticK'),
  stochasticD: real('stochasticD'),
  williamsR: real('williamsR'),
  mfi: real('mfi'),
  cci: real('cci'),
  obv: real('obv'),
  vwap: real('vwap'),
  parabolicSar: real('parabolicSar'),
  roc: real('roc'),
  forceIndex: real('forceIndex'),
  volumeRatio: real('volumeRatio'),
  supportLevel: real('supportLevel'),
  resistanceLevel: real('resistanceLevel'),
  technicalScore: real('technicalScore'),
  sentimentScore: real('sentimentScore'),
  fundamentalScore: real('fundamentalScore'),
  aiScore: real('aiScore'),
  convictionTotal: real('convictionTotal'),
  decision: text('decision', { enum: ['BUY', 'SELL', 'HOLD'] }),
  executed: integer('executed', { mode: 'boolean' }).default(false),
  aiReasoning: text('aiReasoning'),
  aiModel: text('aiModel'),
  suggestedStopLossPct: real('suggestedStopLossPct'),
  suggestedPositionSizePct: real('suggestedPositionSizePct'),
  suggestedTakeProfitPct: real('suggestedTakeProfitPct'),
  extraIndicators: text('extraIndicators'),
  newsHeadlines: text('newsHeadlines'),
});

export const positions = sqliteTable('positions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull().unique(),
  t212Ticker: text('t212Ticker').notNull(),
  shares: real('shares').notNull(),
  entryPrice: real('entryPrice').notNull(),
  entryTime: text('entryTime').notNull(),
  currentPrice: real('currentPrice'),
  pnl: real('pnl'),
  pnlPct: real('pnlPct'),
  stopLoss: real('stopLoss'),
  trailingStop: real('trailingStop'),
  takeProfit: real('takeProfit'),
  convictionScore: real('convictionScore'),
  stopOrderId: text('stopOrderId'),
  aiExitConditions: text('aiExitConditions'),
  accountType: text('accountType', { enum: ['INVEST', 'ISA'] }).notNull(),
  updatedAt: text('updatedAt'),
});

export const priceCache = sqliteTable(
  'price_cache',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    timestamp: text('timestamp').notNull(),
    open: real('open'),
    high: real('high'),
    low: real('low'),
    close: real('close'),
    volume: real('volume'),
    timeframe: text('timeframe').default('1d'),
  },
  (table) => [index('idx_price_symbol_ts').on(table.symbol, table.timestamp)],
);

export const newsCache = sqliteTable(
  'news_cache',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    title: text('title').notNull(),
    source: text('source'),
    url: text('url'),
    publishedAt: text('publishedAt'),
    sentimentScore: real('sentimentScore'),
    fetchedAt: text('fetchedAt').notNull(),
  },
  (table) => [index('idx_news_symbol').on(table.symbol, table.fetchedAt)],
);

export const earningsCalendar = sqliteTable(
  'earnings_calendar',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    earningsDate: text('earningsDate').notNull(),
    estimate: real('estimate'),
    actual: real('actual'),
    surprise: real('surprise'),
    fetchedAt: text('fetchedAt').notNull(),
  },
  (table) => [index('idx_earnings_symbol').on(table.symbol, table.earningsDate)],
);

export const insiderTransactions = sqliteTable(
  'insider_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    filingDate: text('filingDate'),
    transactionDate: text('transactionDate'),
    ownerName: text('ownerName'),
    transactionType: text('transactionType'),
    shares: real('shares'),
    pricePerShare: real('pricePerShare'),
    totalValue: real('totalValue'),
    fetchedAt: text('fetchedAt').notNull(),
  },
  (table) => [index('idx_insider_symbol').on(table.symbol, table.fetchedAt)],
);

export const fundamentalCache = sqliteTable(
  'fundamental_cache',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    fetchedAt: text('fetchedAt').notNull(),
    peRatio: real('peRatio'),
    forwardPE: real('forwardPE'),
    revenueGrowthYoY: real('revenueGrowthYoY'),
    profitMargin: real('profitMargin'),
    operatingMargin: real('operatingMargin'),
    debtToEquity: real('debtToEquity'),
    currentRatio: real('currentRatio'),
    marketCap: real('marketCap'),
    sector: text('sector'),
    industry: text('industry'),
    earningsSurprise: real('earningsSurprise'),
    dividendYield: real('dividendYield'),
    beta: real('beta'),
  },
  (table) => [index('idx_fund_symbol').on(table.symbol, table.fetchedAt)],
);

export const dailyMetrics = sqliteTable('daily_metrics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull().unique(),
  totalPnl: real('totalPnl'),
  tradesCount: integer('tradesCount'),
  winCount: integer('winCount'),
  lossCount: integer('lossCount'),
  winRate: real('winRate'),
  maxDrawdown: real('maxDrawdown'),
  sharpeRatio: real('sharpeRatio'),
  profitFactor: real('profitFactor'),
  portfolioValue: real('portfolioValue'),
  cashBalance: real('cashBalance'),
  accountType: text('accountType'),
});

export const pairlistHistory = sqliteTable('pairlist_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text('timestamp').notNull(),
  symbols: text('symbols').notNull(),
  filterStats: text('filterStats'),
});

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  category: text('category').notNull(),
  description: text('description'),
  updatedAt: text('updatedAt').default('CURRENT_TIMESTAMP'),
});

// ── Trade Plans (pre-entry blueprints) ──────────────────────────────────
export const tradePlans = sqliteTable(
  'trade_plans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    symbol: text('symbol').notNull(),
    t212Ticker: text('t212Ticker').notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected', 'executed', 'expired'] })
      .notNull()
      .default('pending'),
    side: text('side', { enum: ['BUY', 'SELL'] }).notNull(),
    entryPrice: real('entryPrice').notNull(),
    shares: integer('shares').notNull(),
    positionValue: real('positionValue').notNull(),
    positionSizePct: real('positionSizePct').notNull(),
    stopLossPrice: real('stopLossPrice').notNull(),
    stopLossPct: real('stopLossPct').notNull(),
    takeProfitPrice: real('takeProfitPrice').notNull(),
    takeProfitPct: real('takeProfitPct').notNull(),
    maxLossDollars: real('maxLossDollars').notNull(),
    riskRewardRatio: real('riskRewardRatio').notNull(),
    maxHoldDays: integer('maxHoldDays'),
    aiConviction: real('aiConviction').notNull(),
    aiReasoning: text('aiReasoning'),
    aiModel: text('aiModel'),
    risks: text('risks'), // JSON array
    urgency: text('urgency'),
    exitConditions: text('exitConditions'),
    technicalScore: real('technicalScore'),
    fundamentalScore: real('fundamentalScore'),
    sentimentScore: real('sentimentScore'),
    accountType: text('accountType', { enum: ['INVEST', 'ISA'] }).notNull(),
    approvedAt: text('approvedAt'),
    approvedBy: text('approvedBy'), // 'auto' | 'manual' | 'telegram'
    expiresAt: text('expiresAt'),
    createdAt: text('createdAt').notNull(),
  },
  (table) => [index('idx_trade_plans_symbol').on(table.symbol, table.status)],
);

// ── AI Market Research ──────────────────────────────────────────────────
export const aiResearch = sqliteTable(
  'ai_research',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text('timestamp').notNull(),
    query: text('query').notNull(),
    symbols: text('symbols').notNull(), // JSON array of analyzed symbols
    results: text('results').notNull(), // JSON array of research results
    aiModel: text('aiModel'),
    marketContext: text('marketContext'), // JSON: SPY, VIX, sector performance
    createdAt: text('createdAt').notNull(),
  },
  (table) => [index('idx_research_ts').on(table.timestamp)],
);

// ── AI Model Performance Tracking ───────────────────────────────────────
export const modelPerformance = sqliteTable(
  'model_performance',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    aiModel: text('aiModel').notNull(),
    symbol: text('symbol').notNull(),
    decision: text('decision', { enum: ['BUY', 'SELL', 'HOLD'] }).notNull(),
    conviction: real('conviction').notNull(),
    signalTimestamp: text('signalTimestamp').notNull(),
    priceAtSignal: real('priceAtSignal').notNull(),
    priceAfter1d: real('priceAfter1d'),
    priceAfter5d: real('priceAfter5d'),
    priceAfter10d: real('priceAfter10d'),
    actualOutcome: text('actualOutcome'), // 'correct' | 'incorrect' | 'pending'
    actualReturnPct: real('actualReturnPct'),
    evaluatedAt: text('evaluatedAt'),
  },
  (table) => [index('idx_model_perf').on(table.aiModel, table.signalTimestamp)],
);

// ── Bot Audit Log (session replay) ──────────────────────────────────────
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text('timestamp').notNull(),
    eventType: text('eventType').notNull(), // 'trade' | 'signal' | 'pairlist' | 'config' | 'error' | 'control' | 'research'
    category: text('category').notNull(), // 'execution' | 'analysis' | 'risk' | 'system' | 'user'
    symbol: text('symbol'),
    summary: text('summary').notNull(),
    details: text('details'), // JSON with full context
    severity: text('severity', { enum: ['info', 'warn', 'error'] })
      .notNull()
      .default('info'),
  },
  (table) => [index('idx_audit_ts').on(table.timestamp, table.eventType)],
);
