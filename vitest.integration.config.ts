import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['test/integration/setup.ts'],
    pool: 'forks',
    minForks: 1,
    maxForks: 1,
    testTimeout: 15000,
    passWithNoTests: true,
  },
});
