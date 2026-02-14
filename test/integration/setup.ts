import { afterEach, beforeAll } from 'vitest';
import { configManager } from '../../src/config/manager.js';
import { initDatabase } from '../../src/db/index.js';
import { resetAllTables } from './helpers/db-reset.js';

beforeAll(async () => {
  // Initialize in-memory SQLite for all integration tests
  initDatabase(':memory:');
  await configManager.seedDefaults();
  // Force dry-run mode for safety
  await configManager.set('execution.dryRun', true);
});

afterEach(() => {
  resetAllTables();
  configManager.invalidateCache();
  // Clean up env vars that tests may set
  delete process.env.API_SECRET_KEY;
});
