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

All test files use a flat naming convention under `test/unit/` and `test/integration/`:

```
test/
+-- unit/                              # 91 fast, isolated unit tests (flat structure)
|   +-- # Config & DB
|   +-- manager.test.ts                # ConfigManager
|   +-- defaults.test.ts               # Config defaults
|   +-- schema-validator.test.ts       # Config schema validation
|   +-- db-index.test.ts               # Database connection
|   +-- db-schema.test.ts              # Drizzle schema
|   +-- db-config.test.ts              # Config repository
|   +-- db-cache.test.ts               # Cache repository
|   +-- db-positions.test.ts           # Positions repository
|   +-- db-trades.test.ts              # Trades repository
|   +-- db-signals.test.ts             # Signals repository
|   +-- db-metrics.test.ts             # Metrics repository
|   +-- orders-repository.test.ts      # Orders repository
|   +-- # Pairlist
|   +-- pairlist-filters.test.ts       # Individual filters (volume, price, etc.)
|   +-- pairlist-pipeline.test.ts      # Pipeline orchestration + enrichment
|   +-- pairlist-index.test.ts         # Module entry
|   +-- pairlist-performance-filter.test.ts  # Performance filter
|   +-- sector-filter.test.ts          # Sector whitelist/blacklist filter
|   +-- # Data Sources
|   +-- yahoo-finance.test.ts          # Yahoo Finance adapter
|   +-- finnhub.test.ts                # Finnhub adapter
|   +-- marketaux.test.ts              # Marketaux adapter
|   +-- data-aggregator.test.ts        # Data aggregation orchestrator
|   +-- ticker-mapper.test.ts          # Symbol mapping
|   +-- social-sentiment.test.ts       # Social sentiment aggregation
|   +-- steer-client.test.ts           # Steer headless browser client
|   +-- web-researcher.test.ts         # Web research via Steer
|   +-- price-streamer.test.ts         # Real-time price streaming
|   +-- # AI
|   +-- ai-agent.test.ts              # AI orchestrator + createAIAgent()
|   +-- ai-prompt-builder.test.ts      # Prompt construction
|   +-- ai-decision-processor.test.ts  # Decision parsing
|   +-- ai-market-research.test.ts     # AI market research
|   +-- ai-anthropic.test.ts           # Anthropic adapter
|   +-- ai-ollama.test.ts              # Ollama adapter
|   +-- ai-openai-compat.test.ts       # OpenAI-compatible adapter
|   +-- rules-engine.test.ts           # Rules-based decision engine
|   +-- self-improvement.test.ts       # AI self-improvement
|   +-- # Analysis
|   +-- analyzer.test.ts               # Analysis orchestrator
|   +-- technical-indicators.test.ts   # Technical indicators
|   +-- indicators-edge-cases.test.ts  # Indicator edge cases
|   +-- technical-scorer.test.ts       # Technical scoring
|   +-- fundamental-scorer.test.ts     # Fundamental scoring
|   +-- sentiment-scorer.test.ts       # Sentiment scoring
|   +-- correlation.test.ts            # Portfolio correlation
|   +-- multi-timeframe.test.ts        # Multi-timeframe analysis
|   +-- regime-detector.test.ts        # Market regime detection
|   +-- monte-carlo.test.ts            # Monte Carlo simulation
|   +-- portfolio-optimizer.test.ts    # Portfolio optimization
|   +-- # Execution
|   +-- order-manager.test.ts          # Order execution
|   +-- order-manager-orders.test.ts   # Order tracking
|   +-- order-replacer.test.ts         # Order replacement
|   +-- risk-guard.test.ts             # Risk validation
|   +-- trade-planner.test.ts          # Trade plan creation
|   +-- approval-manager.test.ts       # Approval flow
|   +-- position-tracker.test.ts       # Position monitoring + exit DSL
|   +-- partial-exit-manager.test.ts   # Partial exits
|   +-- conditional-orders.test.ts     # Conditional/OCO orders
|   +-- dca-manager.test.ts            # Dollar-cost averaging
|   +-- pair-locks.test.ts             # Pair locking
|   +-- atr-stoploss.test.ts           # ATR stop-loss
|   +-- exit-condition-dsl.test.ts     # Exit condition DSL
|   +-- risk-parity.test.ts            # Risk parity sizing
|   +-- roi-table.test.ts              # ROI table
|   +-- # Backtest
|   +-- backtest-engine.test.ts        # Backtest engine + slippage/spread
|   +-- backtest-data-loader.test.ts   # Historical data loading
|   +-- walk-forward.test.ts           # Walk-forward analysis
|   +-- # Monitoring
|   +-- audit-log.test.ts              # Audit log
|   +-- model-tracker.test.ts          # Model performance tracking
|   +-- performance.test.ts            # Performance tracker
|   +-- performance-metrics.test.ts    # Performance metrics
|   +-- attribution.test.ts            # Performance attribution
|   +-- trade-journal.test.ts          # Trade journal
|   +-- tax-tracker.test.ts            # Tax lot tracking
|   +-- report-generator.test.ts       # Scheduled reports
|   +-- health-metrics.test.ts         # System health monitoring
|   +-- webhooks.test.ts               # Webhook system
|   +-- # API & Server
|   +-- api-server.test.ts             # Express server setup
|   +-- api-routes.test.ts             # REST endpoint definitions
|   +-- api-websocket.test.ts          # WebSocket manager
|   +-- auth-middleware.test.ts        # Auth middleware
|   +-- telegram.test.ts               # Telegram notifications
|   +-- strategy-profiles.test.ts      # Strategy profile management
|   +-- # Utils
|   +-- helpers.test.ts                # Helper utilities
|   +-- market-hours.test.ts           # Market hours
|   +-- holidays.test.ts               # NYSE holiday calendar
|   +-- key-rotator.test.ts            # API key rotation
|   +-- circuit-breaker.test.ts        # Circuit breaker
|   +-- error-handlers.test.ts         # Error handlers
|   +-- logger.test.ts                 # Logger
|   +-- types.test.ts                  # Type tests
|   +-- errors.test.ts                 # Error types
|   +-- scheduler.test.ts              # Scheduler
|
+-- integration/                       # 21 integration tests (nested by domain)
    +-- api/
    |   +-- status.test.ts             # GET /api/status
    |   +-- auth.test.ts               # Auth middleware integration
    |   +-- portfolio.test.ts          # Portfolio endpoints
    |   +-- trades.test.ts             # Trade endpoints
    |   +-- signals.test.ts            # Signal endpoints
    |   +-- config.test.ts             # Config endpoints
    |   +-- control.test.ts            # Bot control endpoints
    |   +-- pairlist.test.ts           # Pairlist endpoints
    |   +-- trade-plans.test.ts        # Trade plan endpoints
    |   +-- audit.test.ts              # Audit endpoints
    |   +-- orders.test.ts             # Order endpoints
    +-- db/
    |   +-- schema-creation.test.ts    # DB schema creation
    |   +-- config-seeding.test.ts     # Config seeding
    |   +-- repositories.test.ts       # Repository integration
    |   +-- transactions.test.ts       # DB transactions
    +-- trade-flow/
    |   +-- plan-approve-execute.test.ts  # Full plan → approval → execution
    |   +-- plan-reject.test.ts        # Plan rejection flow
    |   +-- plan-expiry.test.ts        # Plan expiry
    |   +-- risk-guard.test.ts         # Risk guard integration
    +-- websocket/
        +-- broadcast.test.ts          # WebSocket broadcast
        +-- auth.test.ts               # WebSocket auth
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

The project enforces strict coverage thresholds:

```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  include: ['src/**/*.ts'],
  exclude: ['src/index.ts'],
  thresholds: {
    lines: 90,
    functions: 90,
    branches: 83,
    statements: 90,
  },
},
```

Coverage reports are generated in `coverage/`. Open `coverage/index.html` for the interactive report.

## Writing New Tests

### Conventions

1. **File naming**: `test/unit/<name>.test.ts` — flat structure, no subdirectories. Name mirrors the source module (e.g., `risk-guard.test.ts` for `src/execution/risk-guard.ts`)
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
npx vitest run test/unit/pairlist-filters.test.ts
```

### Debugging tests

```bash
# Run with verbose output
npx vitest run --reporter=verbose

# Run a specific test by name
npx vitest run -t "keeps stocks within price range"
```
