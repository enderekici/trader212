import { desc, eq, like } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { getDb } from '../index.js';
import { tradeJournal } from '../schema.js';

const logger = createLogger('journal-repository');

export interface JournalEntry {
  id: number;
  tradeId: number | null;
  positionId: number | null;
  symbol: string;
  note: string;
  tags: string[] | null;
  createdAt: string;
}

export interface AddJournalEntryParams {
  tradeId?: number;
  positionId?: number;
  symbol: string;
  note: string;
  tags?: string[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * Add a journal entry
 */
export function addJournalEntry(params: AddJournalEntryParams): JournalEntry {
  const db = getDb();
  const now = new Date().toISOString();

  const insertData = {
    tradeId: params.tradeId ?? null,
    positionId: params.positionId ?? null,
    symbol: params.symbol,
    note: params.note,
    tags: params.tags ? JSON.stringify(params.tags) : null,
    createdAt: now,
  };

  const result = db.insert(tradeJournal).values(insertData).returning().get();

  logger.info(
    { symbol: params.symbol, entryId: result.id, tags: params.tags },
    'Journal entry added',
  );

  return {
    ...result,
    tags: result.tags ? JSON.parse(result.tags) : null,
  };
}

/**
 * Get all journal entries for a specific trade
 */
export function getEntriesForTrade(tradeId: number): JournalEntry[] {
  const db = getDb();
  const entries = db
    .select()
    .from(tradeJournal)
    .where(eq(tradeJournal.tradeId, tradeId))
    .orderBy(desc(tradeJournal.createdAt))
    .all();

  return entries.map((entry) => ({
    ...entry,
    tags: entry.tags ? JSON.parse(entry.tags) : null,
  }));
}

/**
 * Get journal entries for a specific symbol
 */
export function getEntriesForSymbol(symbol: string, limit = 50): JournalEntry[] {
  const db = getDb();
  const entries = db
    .select()
    .from(tradeJournal)
    .where(eq(tradeJournal.symbol, symbol))
    .orderBy(desc(tradeJournal.createdAt))
    .limit(limit)
    .all();

  return entries.map((entry) => ({
    ...entry,
    tags: entry.tags ? JSON.parse(entry.tags) : null,
  }));
}

/**
 * Get most recent journal entries
 */
export function getRecentEntries(limit = 100): JournalEntry[] {
  const db = getDb();
  const entries = db
    .select()
    .from(tradeJournal)
    .orderBy(desc(tradeJournal.createdAt))
    .limit(limit)
    .all();

  return entries.map((entry) => ({
    ...entry,
    tags: entry.tags ? JSON.parse(entry.tags) : null,
  }));
}

/**
 * Search journal entries by text query
 */
export function searchEntries(query: string): JournalEntry[] {
  const db = getDb();
  const searchPattern = `%${query}%`;

  const entries = db
    .select()
    .from(tradeJournal)
    .where(like(tradeJournal.note, searchPattern))
    .orderBy(desc(tradeJournal.createdAt))
    .all();

  return entries.map((entry) => ({
    ...entry,
    tags: entry.tags ? JSON.parse(entry.tags) : null,
  }));
}

/**
 * Get entries by tag
 */
export function getEntriesByTag(tag: string): JournalEntry[] {
  const db = getDb();
  const searchPattern = `%"${tag}"%`;

  const entries = db
    .select()
    .from(tradeJournal)
    .where(like(tradeJournal.tags, searchPattern))
    .orderBy(desc(tradeJournal.createdAt))
    .all();

  return entries.map((entry) => ({
    ...entry,
    tags: entry.tags ? JSON.parse(entry.tags) : null,
  }));
}

/**
 * Delete a journal entry
 */
export function deleteEntry(id: number): boolean {
  const db = getDb();

  try {
    db.delete(tradeJournal).where(eq(tradeJournal.id, id)).run();
    logger.info({ entryId: id }, 'Journal entry deleted');
    return true;
  } catch (error) {
    logger.error({ error, entryId: id }, 'Failed to delete journal entry');
    return false;
  }
}

/**
 * Get tag frequency counts
 */
export function getTagSummary(): TagCount[] {
  const db = getDb();
  const entries = db.select().from(tradeJournal).all();

  const tagCounts = new Map<string, number>();

  for (const entry of entries) {
    if (entry.tags) {
      try {
        const tags = JSON.parse(entry.tags) as string[];
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      } catch {
        // Skip invalid JSON
      }
    }
  }

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}
