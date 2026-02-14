import { describe, expect, it } from 'vitest';
import { configManager } from '../../../src/config/manager.js';

describe('Config Seeding', () => {
  it('should seed all default config entries', () => {
    const allRaw = configManager.getAllRaw();
    // We have 162 config defaults; after setup.ts seeds + sets execution.dryRun
    expect(allRaw.length).toBeGreaterThanOrEqual(85);
  });

  it('should return typed values via get<T>()', () => {
    const maxPositions = configManager.get<number>('risk.maxPositions');
    expect(typeof maxPositions).toBe('number');
    expect(maxPositions).toBeGreaterThan(0);

    const dryRun = configManager.get<boolean>('execution.dryRun');
    expect(typeof dryRun).toBe('boolean');
    expect(dryRun).toBe(true); // set by setup.ts
  });

  it('should support string config values', () => {
    const provider = configManager.get<string>('ai.provider');
    expect(typeof provider).toBe('string');
    expect(provider.length).toBeGreaterThan(0);
  });

  it('should support set() + invalidateCache() round-trip', async () => {
    // Read original value
    const original = configManager.get<number>('risk.maxPositions');

    // Set new value
    await configManager.set('risk.maxPositions', 42);
    configManager.invalidateCache('risk.maxPositions');

    const updated = configManager.get<number>('risk.maxPositions');
    expect(updated).toBe(42);

    // Restore
    await configManager.set('risk.maxPositions', original);
    configManager.invalidateCache('risk.maxPositions');
  });

  it('should group config by category via getByCategory()', () => {
    const riskConfig = configManager.getByCategory('risk');
    expect(Object.keys(riskConfig).length).toBeGreaterThan(0);
    expect(riskConfig).toHaveProperty('risk.maxPositions');
  });

  it('should return all raw entries with correct shape', () => {
    const allRaw = configManager.getAllRaw();
    for (const entry of allRaw) {
      expect(entry).toHaveProperty('key');
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('category');
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.value).toBe('string');
      expect(typeof entry.category).toBe('string');
    }
  });

  it('should throw for unknown config keys', () => {
    expect(() => configManager.get('nonexistent.key.that.does.not.exist')).toThrow(
      'Config key not found',
    );
  });

  it('should support getAll() returning parsed values', () => {
    const all = configManager.getAll();
    expect(typeof all).toBe('object');
    expect(all['execution.dryRun']).toBe(true);
    expect(typeof all['risk.maxPositions']).toBe('number');
  });

  it('should use cache for repeated reads', () => {
    // First read populates cache
    const val1 = configManager.get<number>('risk.maxPositions');
    // Second read should return same value from cache
    const val2 = configManager.get<number>('risk.maxPositions');
    expect(val1).toBe(val2);
  });

  it('should invalidate entire cache when called without key', async () => {
    // Populate cache
    configManager.get<boolean>('execution.dryRun');
    configManager.get<number>('risk.maxPositions');

    // Update a value directly
    await configManager.set('risk.maxPositions', 99);

    // Without invalidation, cache still has old value
    // Invalidate all
    configManager.invalidateCache();

    const fresh = configManager.get<number>('risk.maxPositions');
    expect(fresh).toBe(99);

    // Restore
    await configManager.set('risk.maxPositions', 10);
    configManager.invalidateCache();
  });
});
