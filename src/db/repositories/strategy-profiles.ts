import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { strategyProfiles } from '../schema.js';

export interface StrategyProfileData {
  name: string;
  description?: string;
  config: Record<string, unknown>;
  active?: boolean;
}

export interface StrategyProfile {
  id: number;
  name: string;
  description: string | null;
  config: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export function createProfile(data: StrategyProfileData): number {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db
    .insert(strategyProfiles)
    .values({
      name: data.name,
      description: data.description ?? null,
      config: JSON.stringify(data.config),
      active: data.active ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: strategyProfiles.id })
    .get();

  return result.id;
}

export function getProfile(id: number): StrategyProfile | undefined {
  const db = getDb();
  return db.select().from(strategyProfiles).where(eq(strategyProfiles.id, id)).get();
}

export function getProfileByName(name: string): StrategyProfile | undefined {
  const db = getDb();
  return db.select().from(strategyProfiles).where(eq(strategyProfiles.name, name)).get();
}

export function getActiveProfile(): StrategyProfile | undefined {
  const db = getDb();
  return db.select().from(strategyProfiles).where(eq(strategyProfiles.active, true)).get();
}

export function getAllProfiles(): StrategyProfile[] {
  const db = getDb();
  return db.select().from(strategyProfiles).all();
}

export function updateProfile(
  id: number,
  data: Partial<Omit<StrategyProfileData, 'active'>>,
): void {
  const db = getDb();
  const now = new Date().toISOString();

  const updates: Record<string, unknown> = {
    updatedAt: now,
  };

  if (data.name !== undefined) {
    updates.name = data.name;
  }
  if (data.description !== undefined) {
    updates.description = data.description;
  }
  if (data.config !== undefined) {
    updates.config = JSON.stringify(data.config);
  }

  db.update(strategyProfiles).set(updates).where(eq(strategyProfiles.id, id)).run();
}

export function activateProfile(id: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Deactivate all profiles first
  db.update(strategyProfiles).set({ active: false, updatedAt: now }).run();

  // Activate the target profile
  db.update(strategyProfiles)
    .set({ active: true, updatedAt: now })
    .where(eq(strategyProfiles.id, id))
    .run();
}

export function deactivateProfile(id: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.update(strategyProfiles)
    .set({ active: false, updatedAt: now })
    .where(eq(strategyProfiles.id, id))
    .run();
}

export function deleteProfile(id: number): void {
  const db = getDb();
  db.delete(strategyProfiles).where(eq(strategyProfiles.id, id)).run();
}
