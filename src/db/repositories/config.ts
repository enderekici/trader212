import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { config } from '../schema.js';

export function getConfig(key: string) {
  const db = getDb();
  const row = db.select().from(config).where(eq(config.key, key)).get();
  if (!row) return undefined;
  return { ...row, value: JSON.parse(row.value) };
}

export function setConfig(key: string, value: unknown, category?: string, description?: string) {
  const db = getDb();
  const serialized = JSON.stringify(value);
  const existing = db.select().from(config).where(eq(config.key, key)).get();

  if (existing) {
    return db
      .update(config)
      .set({ value: serialized, updatedAt: new Date().toISOString() })
      .where(eq(config.key, key))
      .returning()
      .get();
  }

  return db
    .insert(config)
    .values({
      key,
      value: serialized,
      category: category ?? 'custom',
      description: description ?? null,
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

export function getAllConfig() {
  const db = getDb();
  const rows = db.select().from(config).all();
  return rows.map((row) => ({ ...row, value: JSON.parse(row.value) }));
}

export function getConfigByCategory(category: string) {
  const db = getDb();
  const rows = db.select().from(config).where(eq(config.category, category)).all();
  return rows.map((row) => ({ ...row, value: JSON.parse(row.value) }));
}

export function deleteConfig(key: string) {
  const db = getDb();
  return db.delete(config).where(eq(config.key, key)).run();
}
