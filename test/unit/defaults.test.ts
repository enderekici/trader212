import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS } from '../../src/config/defaults.js';
import type { ConfigDefault } from '../../src/config/defaults.js';

describe('config defaults', () => {
  it('exports a non-empty array of config defaults', () => {
    expect(Array.isArray(CONFIG_DEFAULTS)).toBe(true);
    expect(CONFIG_DEFAULTS.length).toBeGreaterThan(0);
  });

  it('each default has required properties', () => {
    for (const def of CONFIG_DEFAULTS) {
      expect(def).toHaveProperty('key');
      expect(def).toHaveProperty('value');
      expect(def).toHaveProperty('category');
      expect(def).toHaveProperty('description');
      expect(typeof def.key).toBe('string');
      expect(typeof def.value).toBe('string');
      expect(typeof def.category).toBe('string');
      expect(typeof def.description).toBe('string');
    }
  });

  it('all keys are unique', () => {
    const keys = CONFIG_DEFAULTS.map((d) => d.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it('all values are valid JSON', () => {
    for (const def of CONFIG_DEFAULTS) {
      expect(() => JSON.parse(def.value)).not.toThrow();
    }
  });

  it('includes expected categories', () => {
    const categories = new Set(CONFIG_DEFAULTS.map((d) => d.category));
    expect(categories.has('trading212')).toBe(true);
    expect(categories.has('pairlist')).toBe(true);
    expect(categories.has('dataSources')).toBe(true);
    expect(categories.has('analysis')).toBe(true);
    expect(categories.has('ai')).toBe(true);
    expect(categories.has('risk')).toBe(true);
    expect(categories.has('execution')).toBe(true);
    expect(categories.has('monitoring')).toBe(true);
  });

  it('includes specific expected keys', () => {
    const keys = CONFIG_DEFAULTS.map((d) => d.key);
    expect(keys).toContain('t212.environment');
    expect(keys).toContain('execution.dryRun');
    expect(keys).toContain('risk.maxPositions');
    expect(keys).toContain('ai.enabled');
    expect(keys).toContain('pairlist.maxPairs');
  });

  it('has correct value types for known keys', () => {
    const byKey = Object.fromEntries(CONFIG_DEFAULTS.map((d) => [d.key, d]));

    expect(JSON.parse(byKey['t212.environment'].value)).toBe('demo');
    expect(JSON.parse(byKey['execution.dryRun'].value)).toBe(true);
    expect(JSON.parse(byKey['risk.maxPositions'].value)).toBe(5);
    expect(JSON.parse(byKey['pairlist.filters'].value)).toBeInstanceOf(Array);
  });

  it('satisfies the ConfigDefault interface', () => {
    const first: ConfigDefault = CONFIG_DEFAULTS[0];
    expect(first.key).toBeDefined();
    expect(first.value).toBeDefined();
    expect(first.category).toBeDefined();
    expect(first.description).toBeDefined();
  });
});
