import * as profileRepo from '../db/repositories/strategy-profiles.js';
import { createLogger } from '../utils/logger.js';
import { configManager } from './manager.js';

const log = createLogger('strategy-profiles');

export interface ProfileConfigChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ProfileSummary {
  id: number;
  name: string;
  description: string | null;
  active: boolean;
  configKeys: string[];
  createdAt: string;
  updatedAt: string | null;
}

// Built-in preset configurations
const PRESET_CONSERVATIVE: Record<string, unknown> = {
  'risk.maxPositions': 3,
  'risk.maxPositionSizePct': 0.1,
  'risk.maxStopLossPct': 0.05,
  'risk.maxDailyLossPct': 0.03,
  'risk.maxDailyTrades': 5,
  'execution.minRiskRewardRatio': 3.0,
  'ai.minConvictionScore': 80,
};

const PRESET_AGGRESSIVE: Record<string, unknown> = {
  'risk.maxPositions': 8,
  'risk.maxPositionSizePct': 0.25,
  'risk.maxStopLossPct': 0.12,
  'risk.maxDailyLossPct': 0.1,
  'risk.maxDailyTrades': 15,
  'execution.minRiskRewardRatio': 1.5,
  'ai.minConvictionScore': 60,
};

const PRESET_SCALP: Record<string, unknown> = {
  'risk.maxPositions': 10,
  'risk.maxPositionSizePct': 0.08,
  'risk.maxStopLossPct': 0.03,
  'risk.maxDailyLossPct': 0.05,
  'risk.maxDailyTrades': 20,
  'execution.minRiskRewardRatio': 2.0,
  'execution.maxHoldDays': 3,
  'exit.roiEnabled': true,
  'ai.minConvictionScore': 70,
};

const PRESET_SWING: Record<string, unknown> = {
  'risk.maxPositions': 4,
  'risk.maxPositionSizePct': 0.2,
  'risk.maxStopLossPct': 0.15,
  'risk.maxDailyTrades': 5,
  'execution.minRiskRewardRatio': 2.0,
  'execution.maxHoldDays': 30,
  'exit.roiEnabled': true,
  'exit.roiTable': { '0': 0.2, '1440': 0.12, '4320': 0.08, '10080': 0.04, '20160': 0.02 },
  'partialExit.enabled': true,
  'partialExit.tiers': [
    { pctGain: 0.05, sellPct: 0.25 },
    { pctGain: 0.1, sellPct: 0.5 },
    { pctGain: 0.2, sellPct: 1.0 },
  ],
  'analysis.confluenceEnabled': true,
  'analysis.confluenceMinSignals': 2,
  'multiTimeframe.enabled': true,
  'analysis.intervalMinutes': 30,
  'ai.minConvictionScore': 70,
};

const PRESET_BALANCED: Record<string, unknown> = {
  'risk.maxPositions': 5,
  'risk.maxPositionSizePct': 0.15,
  'risk.maxStopLossPct': 0.1,
  'risk.maxDailyTrades': 8,
  'execution.minRiskRewardRatio': 1.5,
  'execution.maxHoldDays': 14,
  'partialExit.enabled': true,
  'partialExit.tiers': [
    { pctGain: 0.05, sellPct: 0.33 },
    { pctGain: 0.1, sellPct: 0.5 },
  ],
  'ai.minConvictionScore': 65,
};

export class StrategyProfileManager {
  async applyProfile(name: string): Promise<ProfileConfigChange[]> {
    log.info({ name }, 'Applying strategy profile');

    // Fetch the profile
    const profile = profileRepo.getProfileByName(name);
    if (!profile) {
      throw new Error(`Strategy profile not found: ${name}`);
    }

    // Parse the config
    let profileConfig: Record<string, unknown>;
    try {
      profileConfig = JSON.parse(profile.config);
    } catch (err) {
      log.error({ name, err }, 'Failed to parse profile config');
      throw new Error(`Invalid profile config for ${name}`);
    }

    // Apply each config override and track changes
    const changes: ProfileConfigChange[] = [];
    for (const [key, newValue] of Object.entries(profileConfig)) {
      try {
        const oldValue = configManager.get(key);
        await configManager.set(key, newValue);
        changes.push({ key, oldValue, newValue });
      } catch (err) {
        log.error({ key, newValue, err }, 'Failed to apply config override');
        throw new Error(`Failed to apply config key ${key}: ${err}`);
      }
    }

    // Mark this profile as active (and deactivate others)
    profileRepo.activateProfile(profile.id);

    log.info({ name, changesCount: changes.length }, 'Strategy profile applied');
    return changes;
  }

  async removeProfile(): Promise<void> {
    log.info('Removing active strategy profile');

    const activeProfile = profileRepo.getActiveProfile();
    if (!activeProfile) {
      log.warn('No active profile to remove');
      return;
    }

    // Deactivate the profile (does NOT revert config)
    profileRepo.deactivateProfile(activeProfile.id);

    log.info({ profileName: activeProfile.name }, 'Strategy profile deactivated');
  }

  async createPreset(name: string, description?: string): Promise<number> {
    log.info({ name }, 'Creating profile preset from current config');

    // Snapshot the current config
    const currentConfig = configManager.getAll();

    // Create the profile
    const profileId = profileRepo.createProfile({
      name,
      description,
      config: currentConfig,
      active: false,
    });

    log.info(
      { name, profileId, configKeysCount: Object.keys(currentConfig).length },
      'Profile preset created',
    );
    return profileId;
  }

  getActiveProfileName(): string | null {
    const activeProfile = profileRepo.getActiveProfile();
    return activeProfile ? activeProfile.name : null;
  }

  listProfiles(): ProfileSummary[] {
    const profiles = profileRepo.getAllProfiles();
    return profiles.map((p) => {
      let configKeys: string[] = [];
      try {
        const config = JSON.parse(p.config);
        configKeys = Object.keys(config);
      } catch (err) {
        log.error({ profileId: p.id, err }, 'Failed to parse profile config');
      }

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        active: p.active,
        configKeys,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  }

  async seedBuiltinPresets(): Promise<void> {
    log.info('Seeding built-in strategy presets');

    const presets = [
      {
        name: 'Conservative',
        description:
          'Low-risk strategy: small positions, tight stops, high R:R, high conviction only',
        config: PRESET_CONSERVATIVE,
      },
      {
        name: 'Aggressive',
        description: 'High-risk strategy: large positions, wide stops, lower R:R, more trades',
        config: PRESET_AGGRESSIVE,
      },
      {
        name: 'Scalp',
        description: 'Short-term strategy: many small positions, quick exits, ROI enabled',
        config: PRESET_SCALP,
      },
      {
        name: 'Swing',
        description:
          'Multi-day holds: wide stops, ROI table with multi-day windows, partial exits at 5%/10%/20%, confluence gate, multi-timeframe',
        config: PRESET_SWING,
      },
      {
        name: 'Balanced',
        description:
          'Moderate risk/reward: 5 positions, 15% max size, 10% stop, partial exits at 5%/10%',
        config: PRESET_BALANCED,
      },
    ];

    for (const preset of presets) {
      const existing = profileRepo.getProfileByName(preset.name);
      if (!existing) {
        profileRepo.createProfile({
          name: preset.name,
          description: preset.description,
          config: preset.config,
          active: false,
        });
        log.info({ name: preset.name }, 'Built-in preset created');
      }
    }

    log.info('Built-in presets seeded');
  }
}

// Singleton instance
let instance: StrategyProfileManager | null = null;

export function getStrategyProfileManager(): StrategyProfileManager {
  if (!instance) {
    instance = new StrategyProfileManager();
  }
  return instance;
}
