import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { config } from '../db/schema.js';
import { createLogger } from '../utils/logger.js';
import { CONFIG_DEFAULTS } from './defaults.js';

const log = createLogger('config');

export class ConfigManager {
  private cache = new Map<string, { value: unknown; expiresAt: number }>();
  private cacheTTL = 30_000;

  async seedDefaults(): Promise<void> {
    const db = getDb();
    for (const def of CONFIG_DEFAULTS) {
      const existing = db.select().from(config).where(eq(config.key, def.key)).get();
      if (!existing) {
        db.insert(config)
          .values({
            key: def.key,
            value: def.value,
            category: def.category,
            description: def.description,
            updatedAt: new Date().toISOString(),
          })
          .run();
      }
    }
    log.info(`Config seeded with ${CONFIG_DEFAULTS.length} defaults`);
  }

  get<T>(key: string): T {
    const envOverride = this.getEnvOverride(key);
    if (envOverride !== undefined) return envOverride as T;

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value as T;
    }

    const db = getDb();
    const row = db.select().from(config).where(eq(config.key, key)).get();
    if (row) {
      const parsed = JSON.parse(row.value);
      this.cache.set(key, { value: parsed, expiresAt: Date.now() + this.cacheTTL });
      return parsed as T;
    }

    const def = CONFIG_DEFAULTS.find((d) => d.key === key);
    if (def) {
      return JSON.parse(def.value) as T;
    }

    throw new Error(`Config key not found: ${key}`);
  }

  async set(key: string, value: unknown): Promise<void> {
    const db = getDb();
    const serialized = JSON.stringify(value);
    const existing = db.select().from(config).where(eq(config.key, key)).get();

    if (existing) {
      db.update(config)
        .set({ value: serialized, updatedAt: new Date().toISOString() })
        .where(eq(config.key, key))
        .run();
    } else {
      const def = CONFIG_DEFAULTS.find((d) => d.key === key);
      db.insert(config)
        .values({
          key,
          value: serialized,
          category: def?.category || 'custom',
          description: def?.description || '',
          updatedAt: new Date().toISOString(),
        })
        .run();
    }

    this.cache.delete(key);
    log.info({ key, value }, 'Config updated');
  }

  getAll(): Record<string, unknown> {
    const db = getDb();
    const rows = db.select().from(config).all();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  }

  getByCategory(category: string): Record<string, unknown> {
    const db = getDb();
    const rows = db.select().from(config).where(eq(config.category, category)).all();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      result[row.key] = JSON.parse(row.value);
    }
    return result;
  }

  getAllRaw(): Array<{ key: string; value: string; category: string; description: string | null }> {
    const db = getDb();
    return db.select().from(config).all();
  }

  invalidateCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Converts a config key to an environment variable name.
   * e.g. "t212.environment" → "T212_ENVIRONMENT"
   *      "risk.maxPositions" → "RISK_MAX_POSITIONS"
   *      "ai.openaiCompat.baseUrl" → "AI_OPENAI_COMPAT_BASE_URL"
   *      "pairlist.volume.minAvgDailyVolume" → "PAIRLIST_VOLUME_MIN_AVG_DAILY_VOLUME"
   */
  private configKeyToEnvVar(key: string): string {
    return key
      .replace(/\./g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toUpperCase();
  }

  /**
   * Check for an environment variable override for any config key.
   * The env var name is derived from the config key:
   *   "t212.environment" → T212_ENVIRONMENT
   *   "execution.dryRun" → EXECUTION_DRY_RUN
   *   "risk.maxPositions" → RISK_MAX_POSITIONS
   *
   * Values are parsed as JSON when possible, otherwise used as raw strings.
   */
  private getEnvOverride(key: string): unknown | undefined {
    const envName = this.configKeyToEnvVar(key);
    const envValue = process.env[envName];

    if (envValue === undefined) return undefined;

    // Try to parse as JSON (handles numbers, booleans, arrays, objects)
    try {
      return JSON.parse(envValue);
    } catch {
      // If not valid JSON, return as string
      return envValue;
    }
  }
}

export const configManager = new ConfigManager();
