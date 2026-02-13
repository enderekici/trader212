import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { positions } from '../schema.js';

export type PositionInsert = typeof positions.$inferInsert;
export type PositionUpdate = Partial<Omit<PositionInsert, 'symbol'>>;

export function upsertPosition(data: PositionInsert) {
  const db = getDb();
  const existing = db.select().from(positions).where(eq(positions.symbol, data.symbol)).get();

  if (existing) {
    return db
      .update(positions)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(positions.symbol, data.symbol))
      .returning()
      .get();
  }

  return db
    .insert(positions)
    .values({ ...data, updatedAt: new Date().toISOString() })
    .returning()
    .get();
}

export function updatePosition(symbol: string, data: PositionUpdate) {
  const db = getDb();
  return db
    .update(positions)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(positions.symbol, symbol))
    .returning()
    .get();
}

export function removePosition(symbol: string) {
  const db = getDb();
  return db.delete(positions).where(eq(positions.symbol, symbol)).run();
}

export function getAllPositions() {
  const db = getDb();
  return db.select().from(positions).all();
}

export function getPosition(symbol: string) {
  const db = getDb();
  return db.select().from(positions).where(eq(positions.symbol, symbol)).get();
}
