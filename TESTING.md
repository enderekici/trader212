# Testing Guide

Trader212 uses [Vitest](https://vitest.dev) for testing with v8 code coverage.

## Running Tests

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

## Test Structure

```
test/
+-- unit/                              # Fast, isolated unit tests
|   +-- config/
|   |   +-- manager.test.ts            # ConfigManager
|   +-- pairlist/
|   |   +-- filters.test.ts            # Individual filters
|   |   +-- pipeline.test.ts           # Pipeline orchestration
|   +-- data/
|   |   +-- yahoo-finance.test.ts
|   |   +-- finnhub.test.ts
|   |   +-- marketaux.test.ts
|   |   +-- data-aggregator.test.ts
|   +-- ai/
|   |   +-- prompt-builder.test.ts
|   |   +-- decision-processor.test.ts
|   |   +-- market-research.test.ts    # AI market research
|   |   +-- adapters/
|   |       +-- anthropic.test.ts
|   |       +-- ollama.test.ts
|   |       +-- openai-compat.test.ts
|   +-- execution/
|   |   +-- order-manager.test.ts
|   |   +-- risk-guard.test.ts
|   |   +-- trade-planner.test.ts      # Trade plan creation
|   |   +-- approval-manager.test.ts   # Approval flow
|   |   +-- position-tracker.test.ts   # Position monitoring
|   +-- analysis/
|   |   +-- correlation.test.ts        # Correlation analyzer
|   +-- monitoring/
|   |   +-- audit-log.test.ts          # Audit log
|   |   +-- model-tracker.test.ts      # Model performance tracking
|   +-- utils/
|       +-- helpers.test.ts
|       +-- market-hours.test.ts
|       +-- holidays.test.ts           # NYSE holiday calendar
|       +-- key-rotator.test.ts        # API key rotation
+-- integration/                       # Tests that use real DB / multiple modules
    +-- analysis-flow.test.ts
    +-- trade-lifecycle.test.ts        # Full plan -> approval -> execution flow
```

## Mocking External APIs

All external API calls are mocked in tests. Never make real HTTP requests in the test suite.

### Vitest mocking pattern

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinnhubClient } from '../../src/data/finnhub.js';

// Mock axios at module level
vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: vi.fn(),
    }),
  },
}));

describe('FinnhubClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches company news', async () => {
    // Arrange: set up mock response
    const mockGet = vi.fn().mockResolvedValue({
      data: [{ headline: 'AAPL earnings beat', source: 'Reuters' }],
    });

    // Act
    const client = new FinnhubClient({ get: mockGet } as any);
    const news = await client.getCompanyNews('AAPL');

    // Assert
    expect(news).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledWith(
      expect.stringContaining('/company-news'),
      expect.any(Object),
    );
  });
});
```

### Mocking the database

For unit tests, mock the Drizzle query layer:

```typescript
vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  },
}));
```

For integration tests, use an in-memory SQLite database:

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

const sqlite = new Database(':memory:');
const testDb = drizzle(sqlite);
```

## Coverage Thresholds

The project enforces **90% coverage** across all metrics:

```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/index.ts'],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 90,
    statements: 90,
  },
},
```

Coverage reports are generated in `coverage/`. Open `coverage/index.html` for the interactive report.

## Writing New Tests

### Conventions

1. **File naming**: `test/unit/<module>/<file>.test.ts` mirrors `src/<module>/<file>.ts`
2. **Describe blocks**: Use the class/function name as the top-level describe
3. **Test names**: Start with a verb — "returns", "throws", "filters", "calculates"
4. **AAA pattern**: Arrange → Act → Assert in every test
5. **No shared mutable state**: Reset mocks in `beforeEach`, don't rely on test ordering

### Example: testing a pairlist filter

```typescript
import { describe, it, expect } from 'vitest';
import { PriceFilter } from '../../src/pairlist/filters.js';

describe('PriceFilter', () => {
  const filter = new PriceFilter({ min: 5, max: 1500 });

  it('keeps stocks within price range', () => {
    const stocks = [
      { symbol: 'AAPL', price: 180 },
      { symbol: 'PENNY', price: 0.50 },
      { symbol: 'BRK.A', price: 600000 },
    ];

    const result = filter.apply(stocks);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('AAPL');
  });

  it('returns empty array when no stocks pass', () => {
    const stocks = [{ symbol: 'PENNY', price: 0.01 }];
    expect(filter.apply(stocks)).toEqual([]);
  });
});
```

### Running a single test file

```bash
npx vitest run test/unit/pairlist/filters.test.ts
```

### Debugging tests

```bash
# Run with verbose output
npx vitest run --reporter=verbose

# Run a specific test by name
npx vitest run -t "keeps stocks within price range"
```
