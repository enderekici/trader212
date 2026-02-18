import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { researchWatchlist } from '../schema.js';

export interface WatchlistEntry {
  id: number;
  symbol: string;
  notes: string | null;
  addedAt: string;
}

export class ResearchWatchlistRepository {
  getAll(): WatchlistEntry[] {
    const db = getDb();
    const rows = db.select().from(researchWatchlist).all();
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      notes: r.notes ?? null,
      addedAt: r.addedAt,
    }));
  }

  add(symbol: string, notes?: string): WatchlistEntry {
    const db = getDb();
    const result = db
      .insert(researchWatchlist)
      .values({
        symbol: symbol.toUpperCase(),
        notes: notes ?? null,
        addedAt: new Date().toISOString(),
      })
      .returning()
      .get();
    return {
      id: result.id,
      symbol: result.symbol,
      notes: result.notes ?? null,
      addedAt: result.addedAt,
    };
  }

  remove(symbol: string): boolean {
    const db = getDb();
    const result = db
      .delete(researchWatchlist)
      .where(eq(researchWatchlist.symbol, symbol.toUpperCase()))
      .run();
    return result.changes > 0;
  }
}

let instance: ResearchWatchlistRepository | null = null;
export function getResearchWatchlistRepo(): ResearchWatchlistRepository {
  if (!instance) instance = new ResearchWatchlistRepository();
  return instance;
}
