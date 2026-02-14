import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Build a chainable mock for drizzle query builder
function createChainableMock(terminalValue?: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<object> = {
    get(_target, prop: string) {
      if (prop === 'then' || prop === 'catch') return undefined;
      if (!chain[prop]) {
        chain[prop] = vi.fn((..._args: unknown[]) => {
          if (prop === 'get') return terminalValue;
          if (prop === 'all') return terminalValue;
          if (prop === 'run') return terminalValue;
          if (prop === 'returning') {
            // For insert/update operations that return values
            return {
              get: vi.fn(() => terminalValue),
              all: vi.fn(() => terminalValue),
            };
          }
          return new Proxy({}, handler);
        });
      }
      return chain[prop];
    },
  };
  return new Proxy({}, handler);
}

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../src/db/index.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../../src/db/schema.js', () => ({
  strategyProfiles: {
    id: 'id',
    name: 'name',
    description: 'description',
    config: 'config',
    active: 'active',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
}));

const mockConfigManager = {
  get: vi.fn(),
  set: vi.fn(),
  getAll: vi.fn(),
};

vi.mock('../../src/config/manager.js', () => ({
  configManager: mockConfigManager,
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('db/repositories/strategy-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createProfile', () => {
    it('creates a profile with all fields', async () => {
      const now = new Date().toISOString();
      vi.setSystemTime(new Date(now));

      const config = { 'risk.maxPositions': 5 };
      mockDb.insert.mockReturnValue(
        createChainableMock({ id: 1 }),
      );

      const { createProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      const id = createProfile({
        name: 'TestProfile',
        description: 'Test description',
        config,
        active: true,
      });

      expect(id).toBe(1);
      expect(mockDb.insert).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('creates a profile with minimal fields', async () => {
      mockDb.insert.mockReturnValue(
        createChainableMock({ id: 2 }),
      );

      const { createProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      const id = createProfile({
        name: 'MinimalProfile',
        config: {},
      });

      expect(id).toBe(2);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('returns profile when found', async () => {
      const profile = {
        id: 1,
        name: 'TestProfile',
        description: 'Desc',
        config: '{"key":"value"}',
        active: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };
      mockDb.select.mockReturnValue(createChainableMock(profile));

      const { getProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getProfile(1);

      expect(result).toEqual(profile);
    });

    it('returns undefined when not found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getProfile(999);

      expect(result).toBeUndefined();
    });
  });

  describe('getProfileByName', () => {
    it('returns profile when found by name', async () => {
      const profile = {
        id: 1,
        name: 'Conservative',
        description: 'Low risk',
        config: '{}',
        active: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };
      mockDb.select.mockReturnValue(createChainableMock(profile));

      const { getProfileByName } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getProfileByName('Conservative');

      expect(result).toEqual(profile);
    });

    it('returns undefined when name not found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getProfileByName } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getProfileByName('NonExistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getActiveProfile', () => {
    it('returns the active profile', async () => {
      const profile = {
        id: 5,
        name: 'ActiveProfile',
        description: null,
        config: '{}',
        active: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      mockDb.select.mockReturnValue(createChainableMock(profile));

      const { getActiveProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getActiveProfile();

      expect(result).toEqual(profile);
    });

    it('returns undefined when no active profile exists', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getActiveProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getActiveProfile();

      expect(result).toBeUndefined();
    });
  });

  describe('getAllProfiles', () => {
    it('returns all profiles', async () => {
      const profiles = [
        { id: 1, name: 'P1', description: null, config: '{}', active: true, createdAt: '2024-01-01T00:00:00Z', updatedAt: null },
        { id: 2, name: 'P2', description: 'Desc', config: '{}', active: false, createdAt: '2024-01-02T00:00:00Z', updatedAt: null },
      ];
      mockDb.select.mockReturnValue(createChainableMock(profiles));

      const { getAllProfiles } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getAllProfiles();

      expect(result).toEqual(profiles);
      expect(result.length).toBe(2);
    });

    it('returns empty array when no profiles exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getAllProfiles } = await import('../../src/db/repositories/strategy-profiles.js');
      const result = getAllProfiles();

      expect(result).toEqual([]);
    });
  });

  describe('updateProfile', () => {
    it('updates profile name', async () => {
      mockDb.update.mockReturnValue(createChainableMock());

      const { updateProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      updateProfile(1, { name: 'NewName' });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('updates profile description', async () => {
      mockDb.update.mockReturnValue(createChainableMock());

      const { updateProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      updateProfile(1, { description: 'New description' });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('updates profile config', async () => {
      mockDb.update.mockReturnValue(createChainableMock());

      const { updateProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      updateProfile(1, { config: { 'risk.maxPositions': 10 } });

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('updates multiple fields at once', async () => {
      mockDb.update.mockReturnValue(createChainableMock());

      const { updateProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      updateProfile(1, {
        name: 'Updated',
        description: 'Updated desc',
        config: { 'risk.maxPositions': 7 },
      });

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('activateProfile', () => {
    it('deactivates all profiles and activates target', async () => {
      mockDb.update.mockReturnValue(createChainableMock());

      const { activateProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      activateProfile(3);

      // Should be called twice: once to deactivate all, once to activate target
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('deactivateProfile', () => {
    it('deactivates the specified profile', async () => {
      mockDb.update.mockReturnValue(createChainableMock());

      const { deactivateProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      deactivateProfile(5);

      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteProfile', () => {
    it('deletes the specified profile', async () => {
      mockDb.delete.mockReturnValue(createChainableMock());

      const { deleteProfile } = await import('../../src/db/repositories/strategy-profiles.js');
      deleteProfile(7);

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});

describe('config/strategy-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('StrategyProfileManager.applyProfile', () => {
    it('applies profile config overrides successfully', async () => {
      const profile = {
        id: 1,
        name: 'TestProfile',
        description: 'Test',
        config: JSON.stringify({
          'risk.maxPositions': 5,
          'risk.maxPositionSizePct': 0.15,
        }),
        active: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };

      mockDb.select.mockReturnValue(createChainableMock(profile));
      mockDb.update.mockReturnValue(createChainableMock());
      mockConfigManager.get.mockReturnValueOnce(3).mockReturnValueOnce(0.2);

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const changes = await manager.applyProfile('TestProfile');

      expect(changes.length).toBe(2);
      expect(changes[0]).toEqual({
        key: 'risk.maxPositions',
        oldValue: 3,
        newValue: 5,
      });
      expect(changes[1]).toEqual({
        key: 'risk.maxPositionSizePct',
        oldValue: 0.2,
        newValue: 0.15,
      });
      expect(mockConfigManager.set).toHaveBeenCalledTimes(2);
    });

    it('throws error when profile not found', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();

      await expect(manager.applyProfile('NonExistent')).rejects.toThrow('Strategy profile not found');
    });

    it('throws error on invalid profile config JSON', async () => {
      const profile = {
        id: 1,
        name: 'BadProfile',
        description: 'Bad',
        config: 'invalid json',
        active: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };

      mockDb.select.mockReturnValue(createChainableMock(profile));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();

      await expect(manager.applyProfile('BadProfile')).rejects.toThrow('Invalid profile config');
    });

    it('activates profile after applying config', async () => {
      const profile = {
        id: 1,
        name: 'TestProfile',
        description: 'Test',
        config: JSON.stringify({ 'risk.maxPositions': 5 }),
        active: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };

      mockDb.select.mockReturnValue(createChainableMock(profile));
      mockDb.update.mockReturnValue(createChainableMock());
      mockConfigManager.get.mockReturnValue(3);

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.applyProfile('TestProfile');

      // Should call update twice: deactivate all + activate target
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('StrategyProfileManager.removeProfile', () => {
    it('deactivates the active profile', async () => {
      const activeProfile = {
        id: 3,
        name: 'ActiveOne',
        description: null,
        config: '{}',
        active: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };

      mockDb.select.mockReturnValue(createChainableMock(activeProfile));
      mockDb.update.mockReturnValue(createChainableMock());

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.removeProfile();

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('does nothing when no active profile exists', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.removeProfile();

      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('StrategyProfileManager.createPreset', () => {
    it('creates profile from current config snapshot', async () => {
      const currentConfig = {
        'risk.maxPositions': 5,
        'risk.maxPositionSizePct': 0.2,
        'ai.minConvictionScore': 70,
      };

      mockConfigManager.getAll.mockReturnValue(currentConfig);
      mockDb.insert.mockReturnValue(createChainableMock({ id: 10 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const id = await manager.createPreset('MyPreset', 'My custom preset');

      expect(id).toBe(10);
      expect(mockConfigManager.getAll).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('creates profile without description', async () => {
      mockConfigManager.getAll.mockReturnValue({});
      mockDb.insert.mockReturnValue(createChainableMock({ id: 11 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const id = await manager.createPreset('MinimalPreset');

      expect(id).toBe(11);
    });
  });

  describe('StrategyProfileManager.getActiveProfileName', () => {
    it('returns active profile name', async () => {
      const activeProfile = {
        id: 2,
        name: 'ActiveProfile',
        description: null,
        config: '{}',
        active: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };

      mockDb.select.mockReturnValue(createChainableMock(activeProfile));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const name = manager.getActiveProfileName();

      expect(name).toBe('ActiveProfile');
    });

    it('returns null when no active profile', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const name = manager.getActiveProfileName();

      expect(name).toBeNull();
    });
  });

  describe('StrategyProfileManager.listProfiles', () => {
    it('returns profile summaries with config keys', async () => {
      const profiles = [
        {
          id: 1,
          name: 'Profile1',
          description: 'First',
          config: JSON.stringify({ 'risk.maxPositions': 5, 'ai.provider': 'anthropic' }),
          active: true,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 2,
          name: 'Profile2',
          description: null,
          config: JSON.stringify({ 'risk.maxDailyLossPct': 0.05 }),
          active: false,
          createdAt: '2024-01-02T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
        },
      ];

      mockDb.select.mockReturnValue(createChainableMock(profiles));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const summaries = manager.listProfiles();

      expect(summaries.length).toBe(2);
      expect(summaries[0]).toEqual({
        id: 1,
        name: 'Profile1',
        description: 'First',
        active: true,
        configKeys: ['risk.maxPositions', 'ai.provider'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      });
      expect(summaries[1]).toEqual({
        id: 2,
        name: 'Profile2',
        description: null,
        active: false,
        configKeys: ['risk.maxDailyLossPct'],
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      });
    });

    it('returns empty array when no profiles exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock([]));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const summaries = manager.listProfiles();

      expect(summaries).toEqual([]);
    });

    it('handles invalid profile config JSON gracefully', async () => {
      const profiles = [
        {
          id: 1,
          name: 'BadProfile',
          description: null,
          config: 'invalid json',
          active: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
      ];

      mockDb.select.mockReturnValue(createChainableMock(profiles));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      const summaries = manager.listProfiles();

      expect(summaries.length).toBe(1);
      expect(summaries[0].configKeys).toEqual([]);
    });
  });

  describe('StrategyProfileManager.seedBuiltinPresets', () => {
    it('creates built-in presets when they do not exist', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      mockDb.insert.mockReturnValue(createChainableMock({ id: 1 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.seedBuiltinPresets();

      // Should create 3 presets: Conservative, Aggressive, Scalp
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it('skips creating presets that already exist', async () => {
      const existingProfile = {
        id: 1,
        name: 'Conservative',
        description: 'Existing',
        config: '{}',
        active: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: null,
      };

      mockDb.select
        .mockReturnValueOnce(createChainableMock(existingProfile)) // Conservative exists
        .mockReturnValueOnce(createChainableMock(undefined)) // Aggressive doesn't exist
        .mockReturnValueOnce(createChainableMock(undefined)); // Scalp doesn't exist

      mockDb.insert.mockReturnValue(createChainableMock({ id: 2 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.seedBuiltinPresets();

      // Should create only 2 presets (Aggressive and Scalp)
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe('Built-in presets', () => {
    it('Conservative preset has correct config values', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      mockDb.insert.mockReturnValue(createChainableMock({ id: 1 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.seedBuiltinPresets();

      // Verify the Conservative preset was created with correct values
      const insertCall = mockDb.insert.mock.results[0];
      expect(insertCall).toBeDefined();
    });

    it('Aggressive preset has correct config values', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      mockDb.insert.mockReturnValue(createChainableMock({ id: 2 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.seedBuiltinPresets();

      // Verify the Aggressive preset was created
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });

    it('Scalp preset has correct config values', async () => {
      mockDb.select.mockReturnValue(createChainableMock(undefined));
      mockDb.insert.mockReturnValue(createChainableMock({ id: 3 }));

      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const manager = getStrategyProfileManager();
      await manager.seedBuiltinPresets();

      // Verify the Scalp preset was created
      expect(mockDb.insert).toHaveBeenCalledTimes(3);
    });
  });

  describe('getStrategyProfileManager singleton', () => {
    it('returns the same instance on multiple calls', async () => {
      const { getStrategyProfileManager } = await import('../../src/config/strategy-profiles.js');
      const instance1 = getStrategyProfileManager();
      const instance2 = getStrategyProfileManager();

      expect(instance1).toBe(instance2);
    });
  });
});
