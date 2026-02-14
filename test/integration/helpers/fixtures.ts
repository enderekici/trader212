import { eq } from 'drizzle-orm';
import { getDb } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';

const now = () => new Date().toISOString();

export function insertTrade(
  overrides: Partial<typeof schema.trades.$inferInsert> = {},
): typeof schema.trades.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.trades.$inferInsert = {
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    side: 'BUY',
    shares: 10,
    entryPrice: 150.0,
    entryTime: now(),
    accountType: 'INVEST',
    aiModel: 'claude-test',
    convictionScore: 75,
    intendedPrice: 150.0,
    slippage: 0,
  };
  const values = { ...defaults, ...overrides };
  const result = db.insert(schema.trades).values(values).run();
  return db
    .select()
    .from(schema.trades)
    .where(eq(schema.trades.id, Number(result.lastInsertRowid)))
    .get()!;
}

export function insertPosition(
  overrides: Partial<typeof schema.positions.$inferInsert> = {},
): typeof schema.positions.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.positions.$inferInsert = {
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    shares: 10,
    entryPrice: 150.0,
    entryTime: now(),
    currentPrice: 155.0,
    pnl: 50.0,
    pnlPct: 0.033,
    stopLoss: 142.5,
    takeProfit: 165.0,
    accountType: 'INVEST',
    updatedAt: now(),
  };
  const values = { ...defaults, ...overrides };
  db.insert(schema.positions).values(values).run();
  return db.select().from(schema.positions).all().at(-1)!;
}

export function insertSignal(
  overrides: Partial<typeof schema.signals.$inferInsert> = {},
): typeof schema.signals.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.signals.$inferInsert = {
    timestamp: now(),
    symbol: 'AAPL',
    technicalScore: 72,
    sentimentScore: 65,
    fundamentalScore: 80,
    aiScore: 75,
    convictionTotal: 73,
    decision: 'BUY',
    aiReasoning: 'Test signal',
    aiModel: 'claude-test',
  };
  const values = { ...defaults, ...overrides };
  db.insert(schema.signals).values(values).run();
  return db.select().from(schema.signals).all().at(-1)!;
}

export function insertOrder(
  overrides: Partial<typeof schema.orders.$inferInsert> = {},
): typeof schema.orders.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.orders.$inferInsert = {
    symbol: 'AAPL',
    side: 'BUY',
    orderType: 'market',
    status: 'filled',
    requestedQuantity: 10,
    filledQuantity: 10,
    filledPrice: 150.0,
    orderTag: 'entry',
    accountType: 'INVEST',
    createdAt: now(),
  };
  const values = { ...defaults, ...overrides };
  db.insert(schema.orders).values(values).run();
  return db.select().from(schema.orders).all().at(-1)!;
}

export function insertAuditEntry(
  overrides: Partial<typeof schema.auditLog.$inferInsert> = {},
): typeof schema.auditLog.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.auditLog.$inferInsert = {
    timestamp: now(),
    eventType: 'trade',
    category: 'execution',
    summary: 'Test audit entry',
    severity: 'info',
  };
  const values = { ...defaults, ...overrides };
  db.insert(schema.auditLog).values(values).run();
  return db.select().from(schema.auditLog).all().at(-1)!;
}

export function insertDailyMetrics(
  overrides: Partial<typeof schema.dailyMetrics.$inferInsert> = {},
): typeof schema.dailyMetrics.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.dailyMetrics.$inferInsert = {
    date: new Date().toISOString().split('T')[0],
    totalPnl: 100,
    tradesCount: 5,
    winCount: 3,
    lossCount: 2,
    winRate: 0.6,
    portfolioValue: 10500,
    cashBalance: 5000,
  };
  const values = { ...defaults, ...overrides };
  db.insert(schema.dailyMetrics).values(values).run();
  return db.select().from(schema.dailyMetrics).all().at(-1)!;
}

export function insertPairlistHistory(
  symbols: string[],
): typeof schema.pairlistHistory.$inferSelect {
  const db = getDb();
  db.insert(schema.pairlistHistory)
    .values({
      timestamp: now(),
      symbols: JSON.stringify(symbols),
    })
    .run();
  return db.select().from(schema.pairlistHistory).all().at(-1)!;
}

export function insertTradePlan(
  overrides: Partial<typeof schema.tradePlans.$inferInsert> = {},
): typeof schema.tradePlans.$inferSelect {
  const db = getDb();
  const defaults: typeof schema.tradePlans.$inferInsert = {
    symbol: 'AAPL',
    t212Ticker: 'AAPL_US_EQ',
    status: 'pending',
    side: 'BUY',
    entryPrice: 150.0,
    shares: 10,
    positionValue: 1500,
    positionSizePct: 0.15,
    stopLossPrice: 142.5,
    stopLossPct: 0.05,
    takeProfitPrice: 165.0,
    takeProfitPct: 0.1,
    maxLossDollars: 75,
    riskRewardRatio: 2.0,
    aiConviction: 75,
    aiReasoning: 'Test plan',
    aiModel: 'claude-test',
    accountType: 'INVEST',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    createdAt: now(),
  };
  const values = { ...defaults, ...overrides };
  db.insert(schema.tradePlans).values(values).run();
  return db.select().from(schema.tradePlans).all().at(-1)!;
}
