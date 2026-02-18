import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/db/schema.ts',
        'src/api/trading212/types.ts',
        'src/db/repositories/conditional-orders.ts',
        'src/db/repositories/tax-lots.ts',
        'src/execution/order-sync.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 83,
        statements: 90,
      },
    },
  },
});
