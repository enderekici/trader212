import { desc, eq, gte } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { auditLog } from '../db/schema.js';
import { safeJsonParse } from '../utils/helpers.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('audit-log');

export type AuditEventType =
  | 'trade'
  | 'signal'
  | 'pairlist'
  | 'config'
  | 'error'
  | 'control'
  | 'research';
export type AuditCategory = 'execution' | 'analysis' | 'risk' | 'system' | 'user';
export type AuditSeverity = 'info' | 'warn' | 'error';

export interface AuditEntry {
  id: number;
  timestamp: string;
  eventType: AuditEventType;
  category: AuditCategory;
  symbol: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  severity: AuditSeverity;
}

export class AuditLogger {
  log(params: {
    eventType: AuditEventType;
    category: AuditCategory;
    symbol?: string;
    summary: string;
    details?: Record<string, unknown>;
    severity?: AuditSeverity;
  }): void {
    try {
      const db = getDb();
      db.insert(auditLog)
        .values({
          timestamp: new Date().toISOString(),
          eventType: params.eventType,
          category: params.category,
          symbol: params.symbol ?? null,
          summary: params.summary,
          details: params.details ? JSON.stringify(params.details) : null,
          severity: params.severity ?? 'info',
        })
        .run();
    } catch (err) {
      // Don't let audit failures crash the bot
      log.error({ err }, 'Failed to write audit log');
    }
  }

  // Convenience methods
  logTrade(symbol: string, summary: string, details?: Record<string, unknown>): void {
    this.log({ eventType: 'trade', category: 'execution', symbol, summary, details });
  }

  logSignal(symbol: string, summary: string, details?: Record<string, unknown>): void {
    this.log({ eventType: 'signal', category: 'analysis', symbol, summary, details });
  }

  logRisk(
    summary: string,
    details?: Record<string, unknown>,
    severity: AuditSeverity = 'warn',
  ): void {
    this.log({ eventType: 'control', category: 'risk', summary, details, severity });
  }

  logConfig(summary: string, details?: Record<string, unknown>): void {
    this.log({ eventType: 'config', category: 'system', summary, details });
  }

  logError(summary: string, details?: Record<string, unknown>): void {
    this.log({ eventType: 'error', category: 'system', summary, details, severity: 'error' });
  }

  logControl(summary: string, details?: Record<string, unknown>): void {
    this.log({ eventType: 'control', category: 'user', summary, details });
  }

  logResearch(summary: string, details?: Record<string, unknown>): void {
    this.log({ eventType: 'research', category: 'analysis', summary, details });
  }

  /** Get audit entries for a specific day */
  getEntriesForDate(dateStr: string): AuditEntry[] {
    const db = getDb();
    const rows = db
      .select()
      .from(auditLog)
      .where(gte(auditLog.timestamp, `${dateStr}T00:00:00`))
      .orderBy(desc(auditLog.timestamp))
      .all();

    // Filter to just that day
    const nextDay = new Date(dateStr);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString();

    return rows.filter((r) => r.timestamp < nextDayStr).map(this.rowToEntry);
  }

  /** Get recent audit entries */
  getRecent(limit = 100): AuditEntry[] {
    const db = getDb();
    const rows = db.select().from(auditLog).orderBy(desc(auditLog.timestamp)).limit(limit).all();

    return rows.map(this.rowToEntry);
  }

  /** Get entries by event type */
  getByType(eventType: AuditEventType, limit = 50): AuditEntry[] {
    const db = getDb();
    const rows = db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, eventType))
      .orderBy(desc(auditLog.timestamp))
      .limit(limit)
      .all();

    return rows.map(this.rowToEntry);
  }

  /** Get entries for a specific symbol */
  getBySymbol(symbol: string, limit = 50): AuditEntry[] {
    const db = getDb();
    const rows = db
      .select()
      .from(auditLog)
      .where(eq(auditLog.symbol, symbol))
      .orderBy(desc(auditLog.timestamp))
      .limit(limit)
      .all();

    return rows.map(this.rowToEntry);
  }

  /** Generate a daily summary from audit entries */
  generateDailyReport(dateStr: string): string {
    const entries = this.getEntriesForDate(dateStr);

    const trades = entries.filter((e) => e.eventType === 'trade');
    const signals = entries.filter((e) => e.eventType === 'signal');
    const errors = entries.filter((e) => e.severity === 'error');
    const risks = entries.filter((e) => e.category === 'risk');

    const lines = [
      `Bot Activity Report: ${dateStr}`,
      '='.repeat(40),
      `Total Events: ${entries.length}`,
      `Trades: ${trades.length}`,
      `Signals Analyzed: ${signals.length}`,
      `Errors: ${errors.length}`,
      `Risk Alerts: ${risks.length}`,
      '',
    ];

    if (trades.length > 0) {
      lines.push('Trades:');
      for (const t of trades) {
        lines.push(
          `  ${t.timestamp.split('T')[1]?.split('.')[0] ?? ''} ${t.symbol ?? ''} - ${t.summary}`,
        );
      }
      lines.push('');
    }

    if (errors.length > 0) {
      lines.push('Errors:');
      for (const e of errors) {
        lines.push(`  ${e.timestamp.split('T')[1]?.split('.')[0] ?? ''} ${e.summary}`);
      }
      lines.push('');
    }

    if (risks.length > 0) {
      lines.push('Risk Alerts:');
      for (const r of risks) {
        lines.push(`  ${r.timestamp.split('T')[1]?.split('.')[0] ?? ''} ${r.summary}`);
      }
    }

    return lines.join('\n');
  }

  private rowToEntry(row: typeof auditLog.$inferSelect): AuditEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.eventType as AuditEventType,
      category: row.category as AuditCategory,
      symbol: row.symbol,
      summary: row.summary,
      details: row.details ? safeJsonParse<Record<string, unknown>>(row.details, {}) : null,
      severity: row.severity as AuditSeverity,
    };
  }
}

// Singleton for global use
let _auditLogger: AuditLogger | null = null;

export function getAuditLogger(): AuditLogger {
  if (!_auditLogger) {
    _auditLogger = new AuditLogger();
  }
  return _auditLogger;
}
