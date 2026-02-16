# CLAUDE.md

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
    - `schema.ts` - Drizzle schema (23 tables)
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
  - `src/pairlist/` - Dynamic pairlist pipeline with 6 filters + static/hybrid modes
    - `index.ts` - Module entry, `createPairlistPipeline()` factory
    - `pipeline.ts` - Filter pipeline runner
    - `filters.ts` - VolumeFilter, PriceFilter, MarketCapFilter, VolatilityFilter, BlacklistFilter, MaxPairsFilter
  - `src/data/` - Data sources
    - `data-aggregator.ts` - Orchestrates all data sources, returns StockData
    - `yahoo-finance.ts` - Yahoo Finance adapter (OHLCV, quotes, fundamentals)
    - `finnhub.ts` - Finnhub adapter (quotes, news, earnings, insiders)
    - `marketaux.ts` - Marketaux adapter (news + sentiment)
    - `social-sentiment.ts` - Social media sentiment aggregation (Reddit, Twitter, StockTwits)
    - `web-researcher.ts` - Web research via Perplexity API for deep stock analysis
    - `steer-client.ts` - Steer market data client (alternative data provider)
    - `price-streamer.ts` - Real-time price streaming via WebSocket
    - `ticker-mapper.ts` - Symbol <-> Trading212 ticker mapping
  - `src/ai/` - AI decision engine
    - `agent.ts` - AI orchestrator, AIAgent interface, createAIAgent() factory
    - `prompt-builder.ts` - Structured prompt construction for AI
    - `decision-processor.ts` - Parse + validate AI JSON responses
    - `market-research.ts` - MarketResearcher: scheduled AI research for stock discovery
    - `self-improvement.ts` - AI self-improvement system: analyzes past decisions, identifies patterns, updates strategies
    - `adapters/` - Provider adapters
      - `anthropic.ts` - Anthropic Claude adapter (@anthropic-ai/sdk)
      - `ollama.ts` - Ollama adapter (HTTP client)
      - `openai-compat.ts` - OpenAI-compatible adapter (HTTP client)
  - `src/execution/` - Trade execution
    - `order-manager.ts` - OrderManager: executeBuy(), executeClose(), dry-run simulation
    - `order-replacer.ts` - Order modification and replacement logic
    - `order-sync.ts` - Sync orders with Trading212 API
    - `risk-guard.ts` - RiskGuard: validateTrade(), checkDailyLoss(), checkDrawdown()
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
    - `technical/scorer.ts` - analyzeTechnicals(), scoreTechnicals()
    - `fundamental/scorer.ts` - scoreFundamentals()
    - `sentiment/scorer.ts` - scoreSentiment()
    - `correlation.ts` - CorrelationAnalyzer: pearsonCorrelation, checkCorrelationWithPortfolio(), getPortfolioCorrelationMatrix()
    - `multi-timeframe.ts` - Multi-timeframe analysis (weekly/monthly confluence scoring)
    - `regime-detector.ts` - Market regime detection (bull/bear/sideways/volatile)
    - `monte-carlo.ts` - Monte Carlo simulation for portfolio risk scenarios
    - `portfolio-optimizer.ts` - Portfolio optimization (min-variance/max-Sharpe)
  - `src/monitoring/` - Monitoring and notifications
    - `telegram.ts` - TelegramNotifier: sendMessage(), sendAlert(), sendTradeNotification(), registerCommands()
    - `performance.ts` - PerformanceTracker: generateDailySummary(), generateWeeklySummary(), saveDailyMetrics(), getMetrics()
    - `model-tracker.ts` - ModelTracker: recordPrediction(), evaluatePendingPredictions(), getModelStats()
    - `audit-log.ts` - AuditLogger: logTrade(), logSignal(), logRisk(), logConfig(), logError(), logControl(), logResearch(), getRecent(), getByType(), getBySymbol(), getEntriesForDate(), generateDailyReport()
    - `report-generator.ts` - Automated report generation (daily, weekly, monthly performance reports)
    - `attribution.ts` - Performance attribution analysis (alpha, beta, sector contributions)
    - `trade-journal.ts` - Trade journal with tags, notes, and insights
    - `tax-tracker.ts` - Tax lot tracking, wash sale detection, tax-loss harvesting
    - `health-metrics.ts` - System health monitoring (API latency, error rates, queue depths)
  - `src/api/` - HTTP + WebSocket
    - `server.ts` - ApiServer: Express app setup, CORS whitelist, JSON parsing, auth middleware, rate limiting, starts HTTP + WS
    - `routes.ts` - All REST endpoint definitions (60+ endpoints), Zod input validation on mutation endpoints
    - `websocket.ts` - WebSocketManager: broadcast(), 10 event types
    - `webhooks.ts` - Webhook system for external integrations (Discord, Slack, custom endpoints)
    - `middleware/auth.ts` - Bearer token auth middleware (`API_SECRET_KEY` env var); skips `/api/status`; disabled if no key set
    - `trading212/client.ts` - Trading212 API client
    - `trading212/types.ts` - Trading212 type definitions
    - `trading212/errors.ts` - Trading212 error handling
  - `src/backtest/` - Backtesting engine
    - `engine.ts` - Backtesting engine: runs strategies on historical data
    - `data-loader.ts` - Historical data loader for backtests
    - `reporter.ts` - Backtest result reporting and visualization
    - `types.ts` - Backtest-specific type definitions
  - `src/utils/` - Utilities
    - `logger.ts` - Pino logger factory: createLogger('module-name')
    - `helpers.ts` - formatCurrency(), formatPercent(), and shared utilities
    - `market-hours.ts` - getMarketTimes(), isUSMarketOpen(), getMarketStatus()
    - `holidays.ts` - NYSE holiday calendar 2024-2028, isNYSEHoliday(), isNYSEEarlyClose(), getNYSECloseMinutes(), getNextTradingDay()
    - `key-rotator.ts` - KeyRotator class, createFinnhubRotator(), createMarketauxRotator()
    - `circuit-breaker.ts` - Circuit breaker pattern for external API calls
    - `error-handlers.ts` - Global error handlers for uncaught exceptions and unhandled rejections
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
    - `research/page.tsx` - AI market research reports
    - `analytics/page.tsx` - Performance analytics
    - `audit/page.tsx` - Activity / audit log
    - `settings/page.tsx` - Configuration editor
  - `web/components/` - Shared components
    - `sidebar.tsx` - Navigation sidebar (9 nav items)
    - `header-bar.tsx` - Top bar: environment badge, account type, dry-run badge, bot status, market status with countdown, holiday/early close indicators, current ET time, emergency stop button
    - `status-badge.tsx` - Color-coded status badge (running/paused/open/closed)
    - `pnl-display.tsx` - P&L display with color coding
    - `stock-chart.tsx` - Price chart (lightweight-charts)
    - `config-editor.tsx` - Live config editor
  - `web/lib/` - Shared libraries
    - `utils.ts` - cn() (clsx + tailwind-merge)
    - `api.ts` - API client (fetch wrapper for REST endpoints)
    - `websocket.ts` - WebSocket client for real-time updates
    - `types.ts` - TypeScript types for API responses
- `data/` - SQLite database (gitignored)
- `test/` - Vitest tests (unit/ and integration/)

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
Pairlist Pipeline -> Data Aggregation -> Analysis (Technical + Fundamental + Sentiment) -> AI Decision -> Trade Planner -> Approval -> Risk Guard -> Execution -> Position Re-evaluation -> Monitoring

Key flows:
- **Trade Plan / Pre-Entry Blueprint**: AI decision creates a plan (position size, stops, targets, R:R ratio, risks, urgency, exit conditions) stored in `trade_plans` table -> approval flow -> execution
- **Approval Manager**: configurable via `execution.requireApproval` -- auto-approve or manual approval via dashboard/Telegram. Plans expire after `execution.approvalTimeoutMinutes`; on timeout either auto-execute or reject per `execution.approvalAutoExecute` setting
- **Position Re-evaluation**: AI periodically re-analyzes held positions; if SELL conviction > 60, tightens trailing stops and updates exit conditions
- **24/7 News Monitoring**: off-hours news fetching at reduced frequency (`data.newsMonitoring.offHoursIntervalMinutes`) for pre-market prep; only runs outside market hours
- **AI Market Research**: scheduled AI research for stock discovery beyond the active pairlist; stores reports in `ai_research` table
- **AI Self-Improvement**: analyzes past decisions, identifies patterns (e.g., "overtrading tech stocks" or "poor exits in volatile conditions"), generates insights, updates internal strategies
- **Model Performance Tracking**: records every AI prediction in `model_performance` table; daily evaluation job compares predicted direction to actual price movement (1d, 5d, 10d); computes per-model accuracy, buy/sell/hold accuracy, avg returns
- **Portfolio Correlation Analysis**: Pearson correlation on daily returns between positions; warns when new trade is highly correlated (> `risk.maxCorrelation`) with existing positions; full matrix endpoint for dashboard
- **Emergency Stop / Circuit Breaker**: POST `/api/control/emergency-stop` closes all positions and pauses bot; also triggers on daily loss limit breach via `riskGuard.checkDailyLoss()`; header bar has a red STOP button
- **Conditional Orders**: supports OCO (One-Cancels-Other), Bracket (entry + SL + TP), Trailing Stop, If-Then orders
- **DCA (Dollar-Cost Averaging)**: builds positions over time with configurable intervals and amounts
- **Partial Exits**: scale out of positions at multiple targets (e.g., 25% at 5%, 50% at 10%, 100% at 20%)
- **Exit Condition DSL**: custom exit logic using a simple DSL (e.g., `rsi > 70 and macd_cross_down`)
- **Strategy Profiles**: pre-configured strategy sets (conservative, balanced, aggressive, scalper, swing) that can be activated with one click
- **Tax-Loss Harvesting**: automatically identifies candidates for tax-loss harvesting; tracks wash sales; supports FIFO/LIFO/HIFO
- **Trade Journal**: records notes, tags, mood, and lessons for each trade; generates insights on common mistakes and patterns
- **Backtesting**: full backtesting engine with historical data loader and reporting
- **Webhooks**: send trade notifications and alerts to Discord, Slack, or custom endpoints
- **Market Regime Detection**: identifies bull/bear/sideways market regimes and adjusts strategy parameters accordingly
- **Performance Attribution**: breaks down returns by alpha, beta, sector contributions, and factor exposures
- **Social Sentiment**: aggregates sentiment from Reddit, Twitter, StockTwits for additional signal
- **Web Research**: deep research via Perplexity API for fundamental analysis and news context

## Database
SQLite via better-sqlite3 + drizzle-orm. 23 tables:
- **Core**: `config`, `positions`, `trades`, `signals`, `orders`
- **Caching**: `priceCache`, `newsCache`, `fundamentalCache`, `earningsCalendar`, `insiderTransactions`
- **AI/Analysis**: `aiResearch`, `modelPerformance`, `auditLog`
- **Execution**: `tradePlans`, `conditionalOrders`, `pairLocks`
- **Monitoring**: `dailyMetrics`, `pairlistHistory`, `tradeJournal`, `taxLots`
- **Webhooks**: `webhookConfigs`, `webhookLogs`
- **Strategy**: `strategyProfiles`

## Pairlist Modes
- `dynamic` (default): T212 US equities -> filter pipeline (volume, price, market cap, volatility, blacklist, max pairs)
- `static`: user-specified symbols only (skip filters), managed via `pairlist.staticSymbols` config and POST/DELETE `/api/pairlist/static` endpoints
- `hybrid`: static symbols always included + filtered dynamic symbols up to maxPairs

## API Key Rotation
Finnhub and Marketaux support multiple API keys via single comma-separated env vars: `FINNHUB_API_KEY` and `MARKETAUX_API_TOKEN` (e.g. `FINNHUB_API_KEY=key1,key2,key3`). `KeyRotator` in `src/utils/key-rotator.ts` handles round-robin rotation with per-key rate tracking. Factory functions `createFinnhubRotator()` and `createMarketauxRotator()` parse the env vars.

## Market Hours
NYSE hours with holiday awareness (2024-2028 calendar in `src/utils/holidays.ts`). Includes early close detection. `getMarketTimes()` returns full market status (open/pre/after/closed) with countdown timers, holiday flag, and early close flag. Used by scheduler to skip market-hours-only jobs.

## AI Providers
Three adapters in `src/ai/adapters/`: anthropic.ts, ollama.ts, openai-compat.ts. Selected at runtime via `ai.provider` config key. Market research uses the same provider via `src/ai/market-research.ts`.

## Scheduler Jobs (14 total)
1. `pairlistRefresh` - Refresh pairlist (configurable interval, market hours only)
2. `analysisLoop` - Full analysis on each stock (configurable interval, market hours only)
3. `positionMonitor` - Update positions, trailing stops, exit checks (configurable interval, market hours only)
4. `t212Sync` - Sync positions with Trading212 API (configurable interval, market hours only)
5. `dailySummary` - Send daily Telegram summary (configurable time, weekdays)
6. `preMarketAlert` - Send pre-market alert (configurable time, weekdays)
7. `weeklyReport` - Send weekly Telegram report (Fridays 5 PM ET)
8. `offHoursNews` - Weekday news monitoring at reduced frequency (handler skips market hours; conditional on `data.newsMonitoring.enabled`)
9. `positionReEval` - AI re-evaluation of open positions (configurable interval, market hours only; conditional on `execution.reEvaluatePositions`)
10. `marketResearch` - AI market research (configurable interval, market hours only; conditional on `ai.research.enabled`)
11. `modelEvaluation` - Evaluate pending AI predictions (daily at 6 PM ET)
12. `expirePlans` - Expire old trade plans + cleanup expired pair locks (every 5 minutes, always)
13. `conditionalOrders` - Monitor and trigger conditional orders (configurable interval, market hours only; conditional on `conditionalOrders.enabled`)
14. `aiSelfImprovement` - AI self-improvement feedback loop (daily at 6:30 PM ET; conditional on `aiSelfImprovement.enabled`)

## REST API Endpoints (60+)

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

### AI & Research
- GET `/api/research` - List AI research reports
- POST `/api/research/run` - Trigger manual AI research (body: { focus?, symbols? })
- GET `/api/model-stats` - AI model performance statistics

### Protections & Locks
- GET `/api/protections/locks` - List pair locks
- DELETE `/api/protections/locks/:symbol` - Remove a pair lock

### Audit & Logging
- GET `/api/audit` - Audit log entries (query: date?, type?, limit?)
- GET `/api/correlation` - Portfolio correlation matrix

### Backtesting
- POST `/api/backtest` - Run a backtest (body: { strategy, startDate, endDate, symbols, capital })

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

### AI Self-Improvement
- GET `/ai/feedback` - AI self-improvement feedback
- GET `/ai/calibration` - AI calibration curve
- GET `/ai/model-comparison` - AI model comparison

### Risk Parity
- GET `/risk-parity/rebalance` - Risk parity rebalance suggestions

## WebSocket Events (10 types defined, 7 actively emitted)
- `bot_status` - Bot health/status changes
- `trade_executed` - Trade completed
- `signal_generated` - New analysis signal
- `pairlist_updated` - New pairlist snapshot
- `position_update` - Position P&L update
- `trade_plan_created` - New trade plan awaiting approval
- `research_completed` - AI research report finished
- `price_update` - Real-time price data (reserved, not yet emitted)
- `config_changed` - Config value changed (reserved, not yet emitted)
- `alert` - Alert/notification (reserved, not yet emitted)

## API Security
- **Authentication**: Bearer token via `API_SECRET_KEY` env var. Middleware in `src/api/middleware/auth.ts`. Skips `/api/status` (health check). Disabled if env var is empty/unset.
- **CORS**: Whitelist via `CORS_ORIGINS` env var (comma-separated, default: `http://localhost:3000`).
- **Rate Limiting**: `express-rate-limit` — 100 req/min general, 10 req/min on `/api/control/*` and `/api/config/*`.
- **Input Validation**: Zod schemas on `PUT /api/config/:key`, `POST /api/pairlist/static`, `POST /api/research/run`.
- **Dashboard Auth**: Next.js server-side API proxy at `web/app/api/[...path]/route.ts` reads `API_SECRET_KEY` from server env and forwards it as Bearer token to the backend. No secrets are exposed to the client bundle.

## Docker
- `docker compose up` — starts bot (port 3001) + web dashboard (port 3000)
- `docker compose build` — builds both images
- **Files**: `Dockerfile` (bot), `Dockerfile.web` (Next.js dashboard), `docker-compose.yml`, `.dockerignore`
- **Bot image**: multi-stage build, `node:24-alpine`, `tsup` bundle, `NODE_ENV=production` set in Dockerfile. Builder stage uses `apk add python3 make g++` for `better-sqlite3` native compilation
- **Web image**: multi-stage build, `node:24-alpine`, Next.js standalone output. `API_URL` and `API_SECRET_KEY` are runtime env vars (not build args) — the server-side proxy reads them at request time
- **Healthcheck**: bot uses Node.js `fetch()` against `/api/status` (not curl — `node:24-alpine` has no curl)
- **Volumes**: `./data:/app/data` for SQLite persistence
- **Environment**: `.env` file is passed via `env_file:` for secrets/config. `NODE_ENV` is NOT in `.env` — Dockerfiles own it (set to `production`). For local dev, `NODE_ENV` is left unset (defaults to dev mode).
- **Web depends on bot**: `depends_on: bot: condition: service_healthy` — web waits for bot healthcheck
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
