import type { JournalEntry, TagCount } from '../db/repositories/journal.js';
import * as journalRepo from '../db/repositories/journal.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('trade-journal');

export type JournalEvent =
  | 'trade_open'
  | 'trade_close'
  | 'stop_loss'
  | 'take_profit'
  | 'dca'
  | 'partial_exit'
  | 'regime_change';

export interface AddNoteOptions {
  tradeId?: number;
  positionId?: number;
  tags?: string[];
}

export interface TradeTimelineEvent {
  timestamp: string;
  event: string;
  note: string;
  tags: string[] | null;
}

export interface JournalInsights {
  totalEntries: number;
  topTags: TagCount[];
  commonExitReasons: Array<{ reason: string; count: number }>;
  patterns: Array<{ pattern: string; occurrences: number }>;
  mostActiveSymbols: Array<{ symbol: string; count: number }>;
}

export interface ExportOptions {
  format: 'json' | 'csv';
}

/**
 * Trade Journal Manager - manages trade notes and annotations
 */
export class TradeJournalManager {
  /**
   * Add a manual journal note
   */
  addNote(symbol: string, note: string, options?: AddNoteOptions): JournalEntry {
    logger.info({ symbol, hasOptions: !!options }, 'Adding manual journal note');

    return journalRepo.addJournalEntry({
      symbol,
      note,
      tradeId: options?.tradeId,
      positionId: options?.positionId,
      tags: options?.tags,
    });
  }

  /**
   * Auto-generate journal entry for key events
   */
  autoAnnotate(
    symbol: string,
    event: JournalEvent,
    details: Record<string, unknown>,
  ): JournalEntry {
    const { note, tags } = this.generateEventNote(event, details);

    logger.info({ symbol, event, tags }, 'Auto-annotating trade event');

    return journalRepo.addJournalEntry({
      symbol,
      note,
      tradeId: details.tradeId as number | undefined,
      positionId: details.positionId as number | undefined,
      tags,
    });
  }

  /**
   * Generate note and tags for an event
   */
  private generateEventNote(
    event: JournalEvent,
    details: Record<string, unknown>,
  ): { note: string; tags: string[] } {
    const tags: string[] = [event];

    let note = '';

    switch (event) {
      case 'trade_open': {
        const { side, quantity, price, reasoning } = details;
        note = `Opened ${side} position: ${quantity} shares @ $${price}`;
        if (reasoning) {
          note += `\nReasoning: ${reasoning}`;
        }
        tags.push('entry');
        break;
      }

      case 'trade_close': {
        const { side, quantity, price, pnl, pnlPercent, reason } = details;
        note = `Closed ${side} position: ${quantity} shares @ $${price}`;
        if (pnl !== undefined) {
          note += `\nP&L: $${pnl} (${pnlPercent}%)`;
        }
        if (reason) {
          note += `\nReason: ${reason}`;
        }
        tags.push('exit');
        if ((pnl as number) > 0) {
          tags.push('winner');
        } else if ((pnl as number) < 0) {
          tags.push('loser');
        }
        break;
      }

      case 'stop_loss': {
        const { price, loss, lossPercent } = details;
        note = `Stop-loss triggered @ $${price}`;
        if (loss !== undefined) {
          note += `\nLoss: $${loss} (${lossPercent}%)`;
        }
        tags.push('exit', 'risk_management', 'loser');
        break;
      }

      case 'take_profit': {
        const { price, profit, profitPercent } = details;
        note = `Take-profit hit @ $${price}`;
        if (profit !== undefined) {
          note += `\nProfit: $${profit} (${profitPercent}%)`;
        }
        tags.push('exit', 'target_hit', 'winner');
        break;
      }

      case 'dca': {
        const { round, quantity, price, avgPrice } = details;
        note = `DCA round ${round}: added ${quantity} shares @ $${price}`;
        if (avgPrice !== undefined) {
          note += `\nNew avg: $${avgPrice}`;
        }
        tags.push('position_sizing', 'averaging_down');
        break;
      }

      case 'partial_exit': {
        const { quantity, price, remaining, pnl } = details;
        note = `Partial exit: sold ${quantity} shares @ $${price}`;
        if (remaining !== undefined) {
          note += `\nRemaining: ${remaining} shares`;
        }
        if (pnl !== undefined) {
          note += `\nP&L on exit: $${pnl}`;
        }
        tags.push('exit', 'partial');
        break;
      }

      case 'regime_change': {
        const { from, to, indicator } = details;
        note = `Market regime change detected: ${from} → ${to}`;
        if (indicator) {
          note += `\nIndicator: ${indicator}`;
        }
        tags.push('market_regime', 'macro');
        break;
      }

      default: {
        note = `Event: ${event}`;
        tags.push('unknown');
      }
    }

    return { note, tags };
  }

  /**
   * Get chronological timeline of events for a trade
   */
  getTradeTimeline(tradeId: number): TradeTimelineEvent[] {
    const entries = journalRepo.getEntriesForTrade(tradeId);

    return entries
      .map((entry) => ({
        timestamp: entry.createdAt,
        event: this.extractEventType(entry),
        note: entry.note,
        tags: entry.tags,
      }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Extract event type from journal entry tags
   */
  private extractEventType(entry: JournalEntry): string {
    if (!entry.tags || entry.tags.length === 0) {
      return 'note';
    }

    const eventTags = [
      'trade_open',
      'trade_close',
      'stop_loss',
      'take_profit',
      'dca',
      'partial_exit',
      'regime_change',
    ];

    for (const tag of entry.tags) {
      if (eventTags.includes(tag)) {
        return tag;
      }
    }

    return 'note';
  }

  /**
   * Get all journal entries for a symbol
   */
  getSymbolHistory(symbol: string, limit = 50): JournalEntry[] {
    return journalRepo.getEntriesForSymbol(symbol, limit);
  }

  /**
   * Search journal entries
   */
  search(query: string): JournalEntry[] {
    return journalRepo.searchEntries(query);
  }

  /**
   * Analyze journal for insights
   */
  getInsights(): JournalInsights {
    const allEntries = journalRepo.getRecentEntries(1000);
    const tagSummary = journalRepo.getTagSummary();

    // Top tags (limit to top 10)
    const topTags = tagSummary.slice(0, 10);

    // Common exit reasons
    const exitReasons = this.extractExitReasons(allEntries);

    // Pattern detection (simple keyword analysis)
    const patterns = this.detectPatterns(allEntries);

    // Most active symbols
    const symbolCounts = new Map<string, number>();
    for (const entry of allEntries) {
      symbolCounts.set(entry.symbol, (symbolCounts.get(entry.symbol) || 0) + 1);
    }

    const mostActiveSymbols = Array.from(symbolCounts.entries())
      .map(([symbol, count]) => ({ symbol, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalEntries: allEntries.length,
      topTags,
      commonExitReasons: exitReasons,
      patterns,
      mostActiveSymbols,
    };
  }

  /**
   * Extract common exit reasons from journal entries
   */
  private extractExitReasons(entries: JournalEntry[]): Array<{ reason: string; count: number }> {
    const reasonCounts = new Map<string, number>();

    const exitEntries = entries.filter(
      (e) => e.tags?.includes('exit') || e.tags?.includes('trade_close'),
    );

    for (const entry of exitEntries) {
      // Look for "Reason:" in the note
      const reasonMatch = entry.note.match(/Reason:\s*(.+)/i);
      if (reasonMatch) {
        const reason = reasonMatch[1].trim();
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }

      // Categorize by tags
      if (entry.tags?.includes('stop_loss')) {
        reasonCounts.set('Stop-loss hit', (reasonCounts.get('Stop-loss hit') || 0) + 1);
      }
      if (entry.tags?.includes('take_profit')) {
        reasonCounts.set('Take-profit target', (reasonCounts.get('Take-profit target') || 0) + 1);
      }
    }

    return Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Detect patterns in journal entries
   */
  private detectPatterns(entries: JournalEntry[]): Array<{ pattern: string; occurrences: number }> {
    const patterns: Array<{ pattern: string; occurrences: number }> = [];

    // Count DCA usage
    const dcaCount = entries.filter((e) => e.tags?.includes('dca')).length;
    if (dcaCount > 0) {
      patterns.push({ pattern: 'Dollar-cost averaging used', occurrences: dcaCount });
    }

    // Count partial exits
    const partialExitCount = entries.filter((e) => e.tags?.includes('partial')).length;
    if (partialExitCount > 0) {
      patterns.push({ pattern: 'Partial exits taken', occurrences: partialExitCount });
    }

    // Count regime changes
    const regimeChangeCount = entries.filter((e) => e.tags?.includes('regime_change')).length;
    if (regimeChangeCount > 0) {
      patterns.push({
        pattern: 'Market regime changes noted',
        occurrences: regimeChangeCount,
      });
    }

    // Winner vs loser ratio
    const winners = entries.filter((e) => e.tags?.includes('winner')).length;
    const losers = entries.filter((e) => e.tags?.includes('loser')).length;
    if (winners > 0 || losers > 0) {
      const winRate = winners / (winners + losers);
      patterns.push({
        pattern: `Win rate: ${(winRate * 100).toFixed(1)}%`,
        occurrences: winners + losers,
      });
    }

    return patterns;
  }

  /**
   * Export journal in specified format
   */
  exportJournal(format: 'json' | 'csv'): string {
    const entries = journalRepo.getRecentEntries(10000);

    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }

    // CSV format
    const headers = ['ID', 'Symbol', 'Trade ID', 'Position ID', 'Note', 'Tags', 'Created At'];
    const rows = entries.map((e) => [
      e.id.toString(),
      e.symbol,
      e.tradeId?.toString() ?? '',
      e.positionId?.toString() ?? '',
      `"${e.note.replace(/"/g, '""')}"`, // Escape quotes
      e.tags ? `"${e.tags.join(', ')}"` : '',
      e.createdAt,
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    return csv;
  }
}

// Singleton instance
let instance: TradeJournalManager | null = null;

/**
 * Get singleton TradeJournalManager instance
 */
export function getTradeJournalManager(): TradeJournalManager {
  if (!instance) {
    instance = new TradeJournalManager();
    logger.info('TradeJournalManager initialized');
  }
  return instance;
}
