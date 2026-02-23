# CLAUDE.md

## WARNING
Obey the following instructions:
- Never commit secrets (API keys, tokens) to the repository.
- Never commit anything without full ci(linter etc.) run and all tests passing.

## Project Overview
Autonomous AI trading bot for Trading212. ESM TypeScript, Node.js 24+.

## Commands

### Backend (root `package.json`)
- `npm run dev` - Start bot in development mode (tsx watch)
- `npm run build` - Build with tsup
- `npm run start` - Run production build (`node dist/index.js`)
- `npm run test` - Run tests with vitest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with v8 coverage (90% threshold)
- `npm run lint` - Lint with biome
- `npm run lint:fix` - Lint and auto-fix with biome
- `npm run format` - Format with biome
- `npm run typecheck` - Type check with tsc --noEmit
- `npm run db:generate` - Generate drizzle migrations
- `npm run db:migrate` - Run drizzle migrations

### Frontend (`web/package.json`)
- `npm run dev` - Start Next.js dev server on port 3000
- `npm run build` - Build Next.js for production
- `npm run start` - Run production Next.js on port 3000
- `npm run lint` - Lint with next lint

## Project Structure
- `src/` - Bot backend (ESM TypeScript)
  - `src/index.ts` - Entry point: TradingBot class, scheduler setup, all core loops
  - `src/config/` - ConfigManager (DB-backed, live-updatable) and defaults
    - `manager.ts` - Singleton ConfigManager: seed, get, set, getByCategory, getAllRaw, invalidateCache
    - `defaults.ts` - Default config values seeded on first run
    - `schema-validator.ts` - Runtime config validation with Zod
    - `strategy-profiles.ts` - Pre-configured strategy profiles (conservative, balanced, aggressive, scalper, swing)
  - `src/db/` - Database layer
    - `index.ts` - Database connection (better-sqlite3 + drizzle-orm)
    - `schema.ts` - Drizzle schema (22 tables)
    - `repositories/` - Data access layers
      - `cache.ts` - Price, news, earnings, insider, fundamental caching
      - `config.ts` - Configuration CRUD
      - `positions.ts` - Position tracking
      - `trades.ts` - Trade history
      - `signals.ts` - Signal history
      - `metrics.ts` - Daily performance metrics
      - `orders.ts` - Order management and tracking
      - `conditional-orders.ts` - Conditional order logic (OCO, Trailing, etc.)
      - `journal.ts` - Trade journal entries with tags and notes
      - `strategy-profiles.ts` - Strategy profile management
      - `tax-lots.ts` - Tax lot tracking for FIFO/LIFO/HIFO
      - `webhooks.ts` - Webhook configuration and logs
  - `src/pairlist/` - Dynamic pairlist pipeline with 8 filters + static/hybrid modes
    - `index.ts` - Module entry, `createPairlistPipeline()` factory
    - `pipeline.ts` - Filter pipeline runner with `enrichStocks()` (Yahoo Finance batch quotes)
    - `filters.ts` - VolumeFilter, PriceFilter, MarketCapFilter, VolatilityFilter, BlacklistFilter, MaxPairsFilter, PerformanceFilter, SectorFilter
  - `src/data/` - Data sources
    - `data-aggregator.ts` - Orchestrates all data sources, returns StockData
    - `yahoo-finance.ts` - Yahoo Finance adapter (OHLCV, quotes, fundamentals)
    - `finnhub.ts` - Finnhub adapter (quotes, news, earnings, insiders)
    - `marketaux.ts` - Marketaux adapter (news + sentiment)
    - `social-sentiment.ts` - Social media sentiment aggregation (Reddit, Twitter, StockTwits)
    - `stocktwits.ts` - StockTwitsClient: fetches StockTwits symbol stream data directly
    - `finra.ts` - FinraClient: fetches FINRA short interest/volume data from cdn.finra.org
    - `price-streamer.ts` - Real-time price streaming via WebSocket
    - `fred.ts` - FRED (Federal Reserve Economic Data) client
    - `ticker-mapper.ts` - Symbol <-> Trading212 ticker mapping
  - `src/analysis/decision-engine.ts` - DecisionEngine: deterministic regime-weighted 4-strategy consensus (mean-reversion, trend-following, momentum, breakout) with fundamental quality/value/growth scoring, volatility risk adjustment, ATR-based stop/take-profit. Types: DecisionContext, TradeDecision. Constant: DECISION_ENGINE_MODEL_NAME.
  - `src/execution/` - Trade execution
    - `order-manager.ts` - OrderManager: executeBuy(), executeClose(), dry-run simulation
    - `order-replacer.ts` - Order modification and replacement logic
    - `order-sync.ts` - Sync orders with Trading212 API
    - `risk-guard.ts` - RiskGuard: validateTrade(), checkDailyLoss() (graduated 4-tier response: normal/reduce/pause_day/emergency), checkDrawdown(), checkWeeklyLoss(), getLosingStreakMultiplier() (exponential 0.8^streak for streaks>=5), getPositionSizeMultiplier()
    - `trade-planner.ts` - TradePlanner: createPlan(), approvePlan(), rejectPlan(), formatPlanMessage()
    - `approval-manager.ts` - ApprovalManager: processNewPlan() (auto/manual), checkExpiredPlans()
    - `position-tracker.ts` - PositionTracker: updatePositions(), updateTrailingStops(), checkExitConditions(), syncWithT212()
    - `partial-exit-manager.ts` - Partial position exit management (scale out)
    - `conditional-orders.ts` - Conditional order execution (OCO, If-Then, Trailing, Bracket)
    - `dca-manager.ts` - Dollar-cost averaging for building positions
    - `pair-locks.ts` - Pair locking to prevent conflicting trades on same symbol
    - `protections.ts` - Trading protections (cooldown, max drawdown, losing streak limits)
    - `atr-stoploss.ts` - ATR-based dynamic stop-loss calculator
    - `exit-condition-dsl.ts` - Domain-specific language for exit conditions (e.g., "rsi > 70 and macd_cross_down")
    - `risk-parity.ts` - Risk parity position sizing across portfolio
    - `roi-table.ts` - Time-based ROI targets (e.g., 2% at 1h, 5% at 4h, 10% at 1d)
  - `src/analysis/` - Analysis engines
    - `analyzer.ts` - Main analysis orchestrator
    - `technical/indicators.ts` - 25+ technical indicators computation
    - `technical/strategies.ts` - 4 modular strategy scorers for backtesting: scoreMeanReversion(), scoreTrendFollowing(), scoreMomentum(), scoreBreakout() — each returns { strategy, direction, strength, confidence, reasons }. Used by both TS backtest engine and Rust grid search, scoreMultiStrategyWithContext() — context-aware scorer applying market breadth and FOMC adjustments
    - `technical/scorer.ts` - analyzeTechnicals(), scoreTechnicals()
    - `fundamental/scorer.ts` - scoreFundamentals()
    - `sentiment/scorer.ts` - scoreSentiment()
    - `correlation.ts` - CorrelationAnalyzer: pearsonCorrelation, checkCorrelationWithPortfolio(), getPortfolioCorrelationMatrix()
    - `multi-timeframe.ts` - Multi-timeframe analysis (weekly/monthly confluence scoring)
    - `regime-detector.ts` - Market regime detection (bull/bear/sideways/volatile)
    - `monte-carlo.ts` - Monte Carlo simulation for portfolio risk scenarios
    - `portfolio-optimizer.ts` - Portfolio optimization (min-variance/max-Sharpe)
    - `market-breadth.ts` - Market breadth calculation (% symbols above SMA50/SMA200)
    - `sector-rotation.ts` - Sector rotation analysis
  - `src/monitoring/` - Monitoring and notifications
    - `telegram.ts` - TelegramNotifier: sendMessage(), sendAlert(), sendTradeNotification(), registerCommands()
    - `performance.ts` - PerformanceTracker: generateDailySummary(), generateWeeklySummary(), saveDailyMetrics(), getMetrics()
    - `audit-log.ts` - AuditLogger: logTrade(), logSignal(), logRisk(), logConfig(), logError(), logControl(), logResearch(), getRecent(), getByType(), getBySymbol(), getEntriesForDate(), generateDailyReport()
    - `report-generator.ts` - Automated report generation (daily, weekly, monthly performance reports)
    - `attribution.ts` - Performance attribution analysis (alpha, beta, sector contributions)
    - `trade-journal.ts` - Trade journal with tags, notes, and insights
    - `tax-tracker.ts` - Tax lot tracking, wash sale detection, tax-loss harvesting
    - `health-metrics.ts` - System health monitoring (API latency, error rates, queue depths)
  - `src/api/` - HTTP + WebSocket
    - `server.ts` - ApiServer: Express app setup, CORS whitelist, JSON parsing, auth middleware, rate limiting, starts HTTP + WS
    - `routes.ts` - All REST endpoint definitions (55+ endpoints), Zod input validation on mutation endpoints
    - `websocket.ts` - WebSocketManager: broadcast(), 9 event types
    - `webhooks.ts` - Webhook system for external integrations (Discord, Slack, custom endpoints)
    - `middleware/auth.ts` - Bearer token auth middleware (`API_SECRET_KEY` env var); skips `/api/status`; disabled if no key set
    - `trading212/client.ts` - Trading212 API client
    - `trading212/types.ts` - Trading212 type definitions
    - `trading212/errors.ts` - Trading212 error handling
  - `src/backtest/` - Backtesting engine
    - `engine.ts` - Backtesting engine: runs strategies on historical data (with slippage/spread modeling, market context precomputation for breadth and FOMC)
    - `data-loader.ts` - Historical data loader for backtests (supports cacheOnly mode for offline backtests, endDateMs for date range filtering)
    - `reporter.ts` - Backtest result reporting, visualization, and profitability gates (6 acceptance criteria: WF OOS CAGR>0%, profit factor>=1.4, Sharpe>=1.0, max DD<=18%, Monte Carlo P25>0, win rate>=45%)
    - `types.ts` - Backtest-specific type definitions (including MarketContext interface)
    - `walk-forward.ts` - Walk-forward analysis: rolling train/test windows for out-of-sample validation
  - `src/utils/` - Utilities
    - `logger.ts` - Pino logger factory: createLogger('module-name')
    - `helpers.ts` - formatCurrency(), formatPercent(), and shared utilities
    - `market-hours.ts` - getMarketTimes(), isUSMarketOpen(), getMarketStatus()
    - `holidays.ts` - NYSE holiday calendar 2024-2028, isNYSEHoliday(), isNYSEEarlyClose(), getNYSECloseMinutes(), getNextTradingDay()
    - `key-rotator.ts` - KeyRotator class, createFinnhubRotator(), createMarketauxRotator()
    - `circuit-breaker.ts` - Circuit breaker pattern for external API calls
    - `error-handlers.ts` - Global error handlers for uncaught exceptions and unhandled rejections
    - `fomc-calendar.ts` - FOMC meeting calendar and proximity detection (2024-2028)
  - `src/bot/` - Scheduler
    - `scheduler.ts` - Scheduler class, minutesToWeekdayCron(), timeToCron()
- `web/` - Next.js 15 dashboard (App Router, Tailwind CSS v4, lucide-react icons)
  - `web/app/` - Pages (App Router)
    - `layout.tsx` - Root layout with Sidebar + HeaderBar
    - `page.tsx` - Overview dashboard
    - `positions/page.tsx` - Open positions
    - `trades/page.tsx` - Trade history
    - `signals/page.tsx` - Signal history
    - `pairlist/page.tsx` - Pairlist management (dynamic/static/hybrid)
    - `analytics/page.tsx` - Performance analytics
    - `audit/page.tsx` - Activity / audit log
    - `settings/page.tsx` - Configuration editor
  - `web/components/` - Shared components
    - `sidebar.tsx` - Navigation sidebar (8 nav items)
    - `header-bar.tsx` - Top bar: environment badge, account type, dry-run badge, bot status, market status with countdown, holiday/early close indicators, current ET time, emergency stop button
    - `status-badge.tsx` - Color-coded status badge (running/paused/open/closed)
    - `pnl-display.tsx` - P&L display with color coding
    - `stock-chart.tsx` - Price chart (lightweight-charts)
    - `config-editor.tsx` - Live config editor
    - `HelpTooltip.tsx` - Contextual help tooltip component
  - `web/lib/` - Shared libraries
    - `utils.ts` - cn() (clsx + tailwind-merge)
    - `api.ts` - API client (fetch wrapper for REST endpoints)
    - `websocket.ts` - WebSocket client for real-time updates
    - `types.ts` - TypeScript types for API responses
- `data/` - SQLite database (gitignored)
- `test/` - Vitest tests (89 test files, 2911 tests total)
- `tools/` - Performance-critical tooling
  - `tools/grid-search/` - Rust parallel grid search over backtest parameters (101,376 combos in ~9s)
    - `src/main.rs` - CLI, orchestration, CSV I/O, analysis tables, `--no-context` flag for A/B comparison
    - `src/data.rs` - JSON data loader, common date intersection
    - `src/indicators.rs` - 28 technical indicators (pure Rust, no dependencies)
    - `src/candlesticks.rs` - 19 candlestick pattern detections
    - `src/strategies.rs` - Multi-Strategy (4 strategies, 38 sub-signals) and Legacy scorer
    - `src/simulation.rs` - Portfolio simulation engine (SoA position tracking, market context adjustments)
    - `src/fomc.rs` - FOMC meeting calendar (Rust port, 2024-2028 dates)

## Key Conventions
- ESM modules with .js import extensions in source files
- pino for logging via `createLogger('module-name')` from `src/utils/logger.ts`
- drizzle-orm for all database queries; schema in `src/db/schema.ts`
- ConfigManager for all runtime config -- DB-backed, reads/writes to `config` table
- Secrets (API keys) stay in `.env` only, never in DB
- All timestamps in UTC ISO 8601 format
- Zod for runtime validation of external data (API input validation on mutation endpoints)
- biome for linting and formatting (not eslint/prettier)
- vitest for testing (not jest)
- Singleton pattern for AuditLogger (`getAuditLogger()`)
- Trade execution goes through Trade Planner -> Approval Manager -> Risk Guard -> Order Manager
- `NODE_ENV` is NOT in `.env` -- it is a deployment concern owned by Dockerfiles / launch commands. Locally it defaults to `undefined` (dev mode); Docker sets `production`.

## Architecture
Pairlist Pipeline (with enrichment) -> Data Aggregation -> Analysis (Technical + Fundamental + Sentiment) -> Confluence Gate -> Decision Engine -> Conviction Gate -> Trade Planner -> Approval -> Risk Guard -> Execution -> Position Re-evaluation (with Exit DSL) -> Monitoring

Key flows:
- **Decision Engine**: Deterministic 4-strategy consensus (mean-reversion, trend-following, momentum, breakout) with regime weighting, fundamental quality/value/growth scoring, and volatility risk adjustment. Zero cost, fully reproducible. Located at `src/analysis/decision-engine.ts`.
- **Trade Plan / Pre-Entry Blueprint**: Decision engine creates a plan (position size, stops, targets, R:R ratio, risks, urgency, exit conditions) stored in `trade_plans` table -> approval flow -> execution
- **Approval Manager**: configurable via `execution.requireApproval` -- auto-approve or manual approval via dashboard/Telegram. Plans expire after `execution.approvalTimeoutMinutes`; on timeout either auto-execute or reject per `execution.approvalAutoExecute` setting
- **Position Re-evaluation**: Decision engine periodically re-analyzes held positions; if SELL conviction > 60, tightens trailing stops and updates exit conditions
- **24/7 News Monitoring**: off-hours news fetching at reduced frequency (`data.newsMonitoring.offHoursIntervalMinutes`) for pre-market prep; only runs outside market hours
- **Portfolio Correlation Analysis**: Pearson correlation on daily returns between positions; warns when new trade is highly correlated (> `risk.maxCorrelation`) with existing positions; full matrix endpoint for dashboard
- **Graduated Loss Response**: RiskGuard uses 4-tier daily loss response instead of binary stop: normal (0-1% loss), reduce (1-2%, halves position size), pause_day (2-3%, pauses trading), emergency (>3%, full stop). Weekly >5% loss triggers emergency stop requiring manual restart. Losing streak >=5 uses exponential reduction (0.8^streak, floor 10%)
- **Emergency Stop / Circuit Breaker**: POST `/api/control/emergency-stop` closes all positions and pauses bot; also triggers on daily loss limit breach via `riskGuard.checkDailyLoss()`; header bar has a red STOP button
- **Conditional Orders**: supports OCO (One-Cancels-Other), Bracket (entry + SL + TP), Trailing Stop, If-Then orders
- **DCA (Dollar-Cost Averaging)**: builds positions over time with configurable intervals and amounts
- **Partial Exits**: scale out of positions at multiple targets (e.g., 25% at 5%, 50% at 10%, 100% at 20%)
- **Exit Condition DSL**: custom exit logic using a simple DSL (e.g., `rsi > 70 and macd_cross_down`)
- **Strategy Profiles**: pre-configured strategy sets (conservative, balanced, aggressive, scalper, swing) that can be activated with one click
- **Tax-Loss Harvesting**: automatically identifies candidates for tax-loss harvesting; tracks wash sales; supports FIFO/LIFO/HIFO
- **Trade Journal**: records notes, tags, mood, and lessons for each trade; generates insights on common mistakes and patterns
- **Backtesting**: full backtesting engine with historical data loader (cacheOnly offline mode), reporting with 6 profitability gates, transaction cost modeling (slippage/spread), and walk-forward out-of-sample validation
- **Market Context**: market context integration: opt-in market breadth (% above SMA50) and FOMC calendar (proximity detection, entry blocking) applied as score adjustments during signal generation
- **Grid Search** (Rust): High-performance parallel grid search at `tools/grid-search/`. Pre-computes score matrices once per strategy, then runs 50,688 parameter combos per strategy in parallel via rayon. Multi-Strategy uses 4 regime-weighted strategies with 38 sub-signals (mean-reversion: RSI, Bollinger, Z-score, Stochastic, Williams %R, Keltner, CMF, candlesticks, VWAP; trend-following: EMA alignment, ADX, ROC, EMA200, volume, Ichimoku, Supertrend, TRIX, market structure; momentum: ROC dual, RSI zones, volume, OBV, MFI, AO, Force Index, Elder Ray, ADL; breakout: Donchian, volume surge, ATR expansion, ADX, BB bandwidth, squeeze, S/R breaks, Ichimoku cloud, Keltner expansion). Best config (Sharpe 1.69): entry 0.3, SL 12%, TP 20%, 10 positions, 25% size. Supports market context (breadth + FOMC) with --no-context flag for A/B comparison
- **Webhooks**: send trade notifications and alerts to Discord, Slack, or custom endpoints
- **Market Regime Detection**: identifies bull/bear/sideways market regimes and adjusts strategy parameters accordingly
- **Performance Attribution**: breaks down returns by alpha, beta, sector contributions, and factor exposures
- **Social Sentiment**: aggregates sentiment from Reddit, Twitter, StockTwits for additional signal
- **Web Research** (optional): Finviz/StockAnalysis scraping via Steer headless browser; requires external Steer instance at `STEER_URL`, gracefully skipped if unavailable

## Database
SQLite via better-sqlite3 + drizzle-orm. WAL mode enabled. 22 tables:
- **Core**: `config`, `positions` (version column for optimistic locking), `trades`, `signals` (indexed on symbol+timestamp), `orders` (version column for optimistic locking)
- **Caching**: `priceCache`, `newsCache`, `fundamentalCache`, `earningsCalendar`, `insiderTransactions`
- **Analysis**: `auditLog`
- **Execution**: `tradePlans`, `conditionalOrders`, `pairLocks`
- **Monitoring**: `dailyMetrics`, `pairlistHistory`, `tradeJournal`, `taxLots`
- **Webhooks**: `webhookConfigs`, `webhookLogs`
- **Strategy**: `strategyProfiles`

## Pairlist Modes
- `dynamic` (default): T212 US equities -> enrichment (Yahoo Finance quotes) -> filter pipeline (volume, price, market cap, volatility, blacklist, sector, performance, max pairs)
- `static`: user-specified symbols only (skip filters), managed via `pairlist.staticSymbols` config and POST/DELETE `/api/pairlist/static` endpoints
- `hybrid`: static symbols always included + filtered dynamic symbols up to maxPairs

## API Key Rotation
Finnhub and Marketaux support multiple API keys via single comma-separated env vars: `FINNHUB_API_KEY` and `MARKETAUX_API_TOKEN` (e.g. `FINNHUB_API_KEY=key1,key2,key3`). `KeyRotator` in `src/utils/key-rotator.ts` handles round-robin rotation with per-key rate tracking. Factory functions `createFinnhubRotator()` and `createMarketauxRotator()` parse the env vars.

## Market Hours
NYSE hours with holiday awareness (2024-2028 calendar in `src/utils/holidays.ts`). Includes early close detection. `getMarketTimes()` returns full market status (open/pre/after/closed) with countdown timers, holiday flag, and early close flag. Used by scheduler to skip market-hours-only jobs.

## Scheduler Jobs (11 total)
1. `pairlistRefresh` - Refresh pairlist (configurable interval, market hours only)
2. `analysisLoop` - Full analysis on each stock (configurable interval, market hours only)
3. `positionMonitor` - Update positions, trailing stops, exit checks (configurable interval, market hours only)
4. `t212Sync` - Sync positions with Trading212 API (configurable interval, market hours only)
5. `dailySummary` - Send daily Telegram summary (configurable time, weekdays)
6. `preMarketAlert` - Send pre-market alert (configurable time, weekdays)
7. `weeklyReport` - Send weekly Telegram report (Fridays 5 PM ET)
8. `offHoursNews` - Weekday news monitoring at reduced frequency (handler skips market hours; conditional on `data.newsMonitoring.enabled`)
9. `positionReEval` - Decision engine re-evaluation of open positions (configurable interval, market hours only; conditional on `execution.reEvaluatePositions`)
10. `expirePlans` - Expire old trade plans + cleanup expired pair locks (every 5 minutes, always)
11. `conditionalOrders` - Monitor and trigger conditional orders (configurable interval, market hours only; conditional on `conditionalOrders.enabled`)

## REST API Endpoints (55+)

### Status & Health
- GET `/api/status` - Bot status, uptime, market status, environment, account type
- GET `/api/health` - Health check endpoint

### Portfolio & Positions
- GET `/api/portfolio` - Positions + cash + total value + P&L
- GET `/api/positions/:symbol/orders` - Orders for a specific position

### Trades & Orders
- GET `/api/trades` - Trade history with filters (symbol, from, to, side, limit, offset)
- GET `/api/trades/:id` - Single trade detail
- GET `/api/orders` - List all orders
- GET `/api/orders/:id` - Single order detail

### Signals & Analysis
- GET `/api/signals` - Signal history with filters (symbol, from, to, limit, offset)
- GET `/api/signals/:symbol/latest` - Latest signal for a symbol
- GET `/api/signals/:symbol/history` - Signal history for a symbol
- GET `/api/stock/:symbol` - Stock detail (latest signal + fundamentals + position)

### Performance & Analytics
- GET `/api/performance` - Aggregate performance metrics (win rate, Sharpe, drawdown, etc.)
- GET `/api/performance/daily` - Daily performance metrics history
- GET `/attribution` - Performance attribution analysis
- GET `/regime` - Market regime detection

### Pairlist
- GET `/api/pairlist` - Current pairlist
- GET `/api/pairlist/history` - Pairlist snapshot history
- GET `/api/pairlist/static` - List static pairlist symbols
- POST `/api/pairlist/static` - Add a symbol to static pairlist (body: { symbol })
- DELETE `/api/pairlist/static/:symbol` - Remove a symbol from static pairlist

### Configuration
- GET `/api/config` - All config grouped by category
- GET `/api/config/:category` - Config for a specific category
- PUT `/api/config/:key` - Update a config value

### Bot Control
- POST `/api/control/pause` - Pause the bot
- POST `/api/control/resume` - Resume the bot
- POST `/api/control/close/:symbol` - Close a position
- POST `/api/control/analyze/:symbol` - Run analysis on a symbol
- POST `/api/control/refresh-pairlist` - Force pairlist refresh
- POST `/api/control/emergency-stop` - Emergency stop (close all, pause)

### Trade Plans
- GET `/api/trade-plans` - List recent trade plans
- POST `/api/trade-plans/:id/approve` - Approve a pending trade plan
- POST `/api/trade-plans/:id/reject` - Reject a pending trade plan

### Protections & Locks
- GET `/api/protections/locks` - List pair locks
- DELETE `/api/protections/locks/:symbol` - Remove a pair lock

### Audit & Logging
- GET `/api/audit` - Audit log entries (query: date?, type?, limit?)
- GET `/api/correlation` - Portfolio correlation matrix

### Backtesting
- POST `/api/backtest` - Run a backtest (body: { strategy, startDate, endDate, symbols, capital, slippagePct?, spreadBps?, walkForward?: { windows, trainRatio }, enableMarketBreadth?, enableFOMC?, fomcBlockEntries?, fomcEntryThresholdBoost? })

### Strategy Profiles
- GET `/strategy-profiles` - List strategy profiles
- POST `/strategy-profiles/:name/activate` - Activate a strategy profile

### Monte Carlo Simulation
- POST `/monte-carlo/simulate` - Run Monte Carlo simulation

### Trade Journal
- GET `/journal` - Get journal entries (query: symbol?, from?, to?, limit?)
- POST `/journal` - Create journal entry (body: { tradeId, notes, tags, mood, lessons })
- GET `/journal/search` - Search journal entries (query: q, tags?)
- GET `/journal/insights` - Get journal insights and patterns

### Tax Management
- GET `/tax/summary` - Tax summary for a year (query: year)
- GET `/tax/harvest-candidates` - Tax-loss harvesting candidates

### Portfolio Optimization
- GET `/portfolio/optimize` - Portfolio optimization suggestions

### Reports
- GET `/reports/daily` - Daily performance report (text/markdown/json)
- GET `/reports/weekly` - Weekly performance report (text/markdown/json)

### Conditional Orders
- GET `/conditional-orders` - List conditional orders
- POST `/conditional-orders` - Create a conditional order
- POST `/conditional-orders/oco` - Create an OCO (One-Cancels-Other) pair
- DELETE `/conditional-orders/:id` - Cancel a conditional order

### Risk Parity
- GET `/risk-parity/rebalance` - Risk parity rebalance suggestions

## WebSocket Events (9 types defined, 6 actively emitted)
- `bot_status` - Bot health/status changes
- `trade_executed` - Trade completed
- `signal_generated` - New analysis signal
- `pairlist_updated` - New pairlist snapshot
- `position_update` - Position P&L update
- `trade_plan_created` - New trade plan awaiting approval
- `price_update` - Real-time price data (reserved, not yet emitted)
- `config_changed` - Config value changed (reserved, not yet emitted)
- `alert` - Alert/notification (reserved, not yet emitted)

## API Security
- **Authentication**: Bearer token via `API_SECRET_KEY` env var. Middleware in `src/api/middleware/auth.ts`. Skips `/api/status` (health check). Disabled if env var is empty/unset.
- **CORS**: Whitelist via `CORS_ORIGINS` env var (comma-separated, default: `http://localhost:3000`).
- **Rate Limiting**: `express-rate-limit` — 100 req/min general, 10 req/min on `/api/control/*` and `/api/config/*`.
- **Input Validation**: Zod schemas on `PUT /api/config/:key`, `POST /api/pairlist/static`.
- **Dashboard Auth**: Next.js server-side API proxy at `web/app/api/[...path]/route.ts` reads `API_SECRET_KEY` from server env and forwards it as Bearer token to the backend. No secrets are exposed to the client bundle.

## Docker
- `docker compose up` — starts all 3 services: bot (port 3001), web dashboard (port 3000), steer headless browser (port 3010 internal)
- `docker compose build` — builds all images
- **Files**: `Dockerfile` (bot), `Dockerfile.web` (Next.js dashboard), `docker-compose.yml` (dev, builds locally), `docker-compose.prod.yml` (production, pulls from GHCR), `.dockerignore`
- **Three services**: `bot` (trading engine), `web` (Next.js dashboard), `steer` (headless browser for web research via `ghcr.io/enderekici/steer:main`)
- **Startup order**: steer must be healthy → bot starts → bot must be healthy → web starts
- **Bot image**: multi-stage build, `node:24-alpine`, `tsup` bundle, `NODE_ENV=production` set in Dockerfile. Builder stage uses `apk add python3 make g++` for `better-sqlite3` native compilation
- **Web image**: multi-stage build, `node:24-alpine`, Next.js standalone output. `API_URL` and `API_SECRET_KEY` are runtime env vars (not build args) — the server-side proxy reads them at request time
- **Healthcheck**: bot uses Node.js `fetch()` against `/api/status` (not curl — `node:24-alpine` has no curl)
- **Volumes**: `./data:/app/data` for SQLite persistence
- **Environment**: `.env` file is passed via `env_file:` for secrets/config. `NODE_ENV` is NOT in `.env` — Dockerfiles own it (set to `production`). For local dev, `NODE_ENV` is left unset (defaults to dev mode).
- **Prod compose**: uses pre-built GHCR images (`ghcr.io/enderekici/trader212:main` / `:main-web`), sets `HOSTNAME=0.0.0.0` on web, adds `extra_hosts: host.docker.internal:host-gateway` on bot
- **API Proxy**: `web/app/api/[...path]/route.ts` proxies all `/api/*` requests to the backend, injecting Bearer token server-side. No build args needed for API config

## Audit Log
All bot actions logged to `audit_log` table via `getAuditLogger()` singleton. Event types: trade, signal, pairlist, config, error, control, research. Categories: execution, analysis, risk, system, user. Severity levels: info, warn, error. Viewable on Activity page in dashboard. Supports daily report generation.

## Telegram Commands
- `/status` - Bot status, portfolio, market info
- `/pause` - Pause trading
- `/resume` - Resume trading
- `/close <symbol>` - Close a position
- `/positions` - List open positions
- `/performance` - Performance metrics
- `/pairlist` - Current pairlist
- `/approve_<id>` - Approve a trade plan
- `/reject_<id>` - Reject a trade plan
