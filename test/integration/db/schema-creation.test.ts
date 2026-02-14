import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb } from '../../../src/db/index.js';

describe('Schema Creation', () => {
  const expectedTables = [
    'trades',
    'signals',
    'positions',
    'price_cache',
    'news_cache',
    'earnings_calendar',
    'insider_transactions',
    'fundamental_cache',
    'daily_metrics',
    'pairlist_history',
    'config',
    'trade_plans',
    'ai_research',
    'model_performance',
    'audit_log',
    'pair_locks',
    'orders',
    'trade_journal',
    'tax_lots',
    'webhook_configs',
    'webhook_logs',
    'strategy_profiles',
    'conditional_orders',
  ];

  it('should create all 23 tables', () => {
    const db = getDb();
    const rows = db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const tableNames = rows.map((r) => r.name).sort();

    for (const table of expectedTables) {
      expect(tableNames, `Missing table: ${table}`).toContain(table);
    }
    expect(tableNames.length).toBe(23);
  });

  it('should create key indexes', () => {
    const db = getDb();
    const rows = db.all<{ name: string; tbl_name: string }>(
      sql`SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`,
    );
    const indexNames = rows.map((r) => r.name);

    const expectedIndexes = [
      'idx_price_symbol_ts',
      'idx_news_symbol',
      'idx_earnings_symbol',
      'idx_insider_symbol',
      'idx_fund_symbol',
      'idx_trade_plans_symbol',
      'idx_research_ts',
      'idx_model_perf',
      'idx_pair_locks_symbol',
      'idx_orders_trade',
      'idx_orders_position',
      'idx_orders_status',
      'idx_journal_symbol',
      'idx_tax_lots_symbol',
      'idx_webhook_logs_ts',
      'idx_cond_orders_status',
      'idx_audit_ts',
    ];

    for (const idx of expectedIndexes) {
      expect(indexNames, `Missing index: ${idx}`).toContain(idx);
    }
  });

  it('should enforce CHECK constraints on trades.side', () => {
    const db = getDb();
    expect(() => {
      db.run(
        sql`INSERT INTO trades (symbol, t212Ticker, side, shares, entryPrice, entryTime, intendedPrice, slippage, accountType)
            VALUES ('AAPL', 'AAPL_US_EQ', 'INVALID', 10, 150, '2024-01-01T00:00:00Z', 150, 0, 'INVEST')`,
      );
    }).toThrow();
  });

  it('should enforce CHECK constraints on positions.accountType', () => {
    const db = getDb();
    expect(() => {
      db.run(
        sql`INSERT INTO positions (symbol, t212Ticker, shares, entryPrice, entryTime, accountType)
            VALUES ('AAPL', 'AAPL_US_EQ', 10, 150, '2024-01-01T00:00:00Z', 'INVALID')`,
      );
    }).toThrow();
  });

  it('should enforce UNIQUE constraint on positions.symbol', () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO positions (symbol, t212Ticker, shares, entryPrice, entryTime, accountType)
          VALUES ('TEST_UNIQUE', 'TEST_US_EQ', 10, 150, '2024-01-01T00:00:00Z', 'INVEST')`,
    );
    expect(() => {
      db.run(
        sql`INSERT INTO positions (symbol, t212Ticker, shares, entryPrice, entryTime, accountType)
            VALUES ('TEST_UNIQUE', 'TEST_US_EQ', 5, 160, '2024-01-02T00:00:00Z', 'INVEST')`,
      );
    }).toThrow();
  });

  it('should enforce UNIQUE constraint on daily_metrics.date', () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO daily_metrics (date, totalPnl, tradesCount, winCount, lossCount, winRate, portfolioValue, cashBalance)
          VALUES ('2024-01-01', 100, 5, 3, 2, 0.6, 10500, 5000)`,
    );
    expect(() => {
      db.run(
        sql`INSERT INTO daily_metrics (date, totalPnl, tradesCount, winCount, lossCount, winRate, portfolioValue, cashBalance)
            VALUES ('2024-01-01', 200, 10, 6, 4, 0.6, 11000, 4000)`,
      );
    }).toThrow();
  });

  it('should enforce config.key as PRIMARY KEY (unique)', () => {
    const db = getDb();
    // Config table is already seeded, try inserting a duplicate key
    expect(() => {
      db.run(
        sql`INSERT INTO config (key, value, category) VALUES ('execution.dryRun', '"true"', 'execution')`,
      );
    }).toThrow();
  });
});
