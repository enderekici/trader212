import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { positions } from '../schema.js';

export type PositionInsert = typeof positions.$inferInsert;
export type PositionUpdate = Partial<Omit<PositionInsert, 'symbol'>>;

/**
 * Error thrown when an optimistic locking version mismatch is detected.
 * This means the position was modified by another concurrent operation
 * between the time it was read and the time the update was attempted.
 */
export class StaleVersionError extends Error {
  readonly symbol: string;
  readonly expectedVersion: number;

  constructor(symbol: string, expectedVersion: number) {
    super(
      `Stale version for position ${symbol}: expected version ${expectedVersion} but row was already updated`,
    );
    this.name = 'StaleVersionError';
    this.symbol = symbol;
    this.expectedVersion = expectedVersion;
  }
}

export function upsertPosition(data: PositionInsert) {
  const db = getDb();
  const existing = db.select().from(positions).where(eq(positions.symbol, data.symbol)).get();

  if (existing) {
    return db
      .update(positions)
      .set({ ...data, version: sql`version + 1`, updatedAt: new Date().toISOString() })
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

/**
 * Update a position by symbol, with optional optimistic locking.
 *
 * @param symbol - The stock symbol to update
 * @param data - Fields to update
 * @param expectedVersion - If provided, the update will only succeed if the
 *   current version in the DB matches this value. On mismatch, throws StaleVersionError.
 *   The version column is always incremented on every update regardless.
 */
export function updatePosition(symbol: string, data: PositionUpdate, expectedVersion?: number) {
  const db = getDb();

  const whereClause =
    expectedVersion !== undefined
      ? and(eq(positions.symbol, symbol), eq(positions.version, expectedVersion))
      : eq(positions.symbol, symbol);

  const result = db
    .update(positions)
    .set({ ...data, version: sql`version + 1`, updatedAt: new Date().toISOString() })
    .where(whereClause)
    .run();

  if (expectedVersion !== undefined && result.changes === 0) {
    throw new StaleVersionError(symbol, expectedVersion);
  }

  // Return the updated row
  return db.select().from(positions).where(eq(positions.symbol, symbol)).get();
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
