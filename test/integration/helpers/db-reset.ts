import { getDb } from '../../../src/db/index.js';
import * as schema from '../../../src/db/schema.js';

/**
 * Truncates all data tables (everything except `config`) between tests.
 * Config is preserved because it was seeded in beforeAll.
 */
export function resetAllTables(): void {
  const db = getDb();
  const tables = [
    schema.trades,
    schema.signals,
    schema.positions,
    schema.priceCache,
    schema.newsCache,
    schema.earningsCalendar,
    schema.insiderTransactions,
    schema.fundamentalCache,
    schema.dailyMetrics,
    schema.pairlistHistory,
    schema.tradePlans,
    schema.aiResearch,
    schema.modelPerformance,
    schema.auditLog,
    schema.pairLocks,
    schema.orders,
    schema.tradeJournal,
    schema.taxLots,
    schema.webhookConfigs,
    schema.webhookLogs,
    schema.strategyProfiles,
    schema.conditionalOrders,
  ];

  for (const table of tables) {
    db.delete(table).run();
  }
}
