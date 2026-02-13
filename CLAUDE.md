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
  - `src/db/` - Database layer
    - `index.ts` - Database connection (better-sqlite3 + drizzle-orm)
    - `schema.ts` - Drizzle schema (15 tables)
    - `repositories/` - Data access: config.ts, positions.ts, trades.ts, signals.ts, cache.ts, metrics.ts
  - `src/pairlist/` - Dynamic pairlist pipeline with 6 filters + static/hybrid modes
    - `index.ts` - Module entry, `createPairlistPipeline()` factory
    - `pipeline.ts` - Filter pipeline runner
    - `filters.ts` - VolumeFilter, PriceFilter, MarketCapFilter, VolatilityFilter, BlacklistFilter, MaxPairsFilter
  - `src/data/` - Data sources
    - `data-aggregator.ts` - Orchestrates all data sources, returns StockData
    - `yahoo-finance.ts` - Yahoo Finance adapter (OHLCV, quotes, fundamentals)
    - `finnhub.ts` - Finnhub adapter (quotes, news, earnings, insiders)
    - `marketaux.ts` - Marketaux adapter (news + sentiment)
    - `ticker-mapper.ts` - Symbol <-> Trading212 ticker mapping
  - `src/ai/` - AI decision engine
    - `agent.ts` - AI orchestrator, AIAgent interface, createAIAgent() factory
    - `prompt-builder.ts` - Structured prompt construction for AI
    - `decision-processor.ts` - Parse + validate AI JSON responses
    - `market-research.ts` - MarketResearcher: scheduled AI research for stock discovery
    - `adapters/` - Provider adapters
      - `anthropic.ts` - Anthropic Claude adapter (@anthropic-ai/sdk)
      - `ollama.ts` - Ollama adapter (HTTP client)
      - `openai-compat.ts` - OpenAI-compatible adapter (HTTP client)
  - `src/execution/` - Trade execution
    - `order-manager.ts` - OrderManager: executeBuy(), executeClose(), dry-run simulation
    - `risk-guard.ts` - RiskGuard: validateTrade(), checkDailyLoss(), checkDrawdown()
    - `trade-planner.ts` - TradePlanner: createPlan(), approvePlan(), rejectPlan(), formatPlanMessage()
    - `approval-manager.ts` - ApprovalManager: processNewPlan() (auto/manual), checkExpiredPlans()
    - `position-tracker.ts` - PositionTracker: updatePositions(), updateTrailingStops(), checkExitConditions(), syncWithT212()
  - `src/analysis/` - Analysis engines
    - `analyzer.ts` - Main analysis orchestrator
    - `technical/indicators.ts` - 25+ technical indicators computation
    - `technical/scorer.ts` - analyzeTechnicals(), scoreTechnicals()
    - `fundamental/scorer.ts` - scoreFundamentals()
    - `sentiment/scorer.ts` - scoreSentiment()
    - `correlation.ts` - CorrelationAnalyzer: pearsonCorrelation, checkCorrelationWithPortfolio(), getPortfolioCorrelationMatrix()
  - `src/monitoring/` - Monitoring and notifications
    - `telegram.ts` - TelegramNotifier: sendMessage(), sendAlert(), sendTradeNotification(), registerCommands()
    - `performance.ts` - PerformanceTracker: generateDailySummary(), generateWeeklySummary(), saveDailyMetrics(), getMetrics()
    - `model-tracker.ts` - ModelTracker: recordPrediction(), evaluatePendingPredictions(), getModelStats()
    - `audit-log.ts` - AuditLogger: logTrade(), logSignal(), logRisk(), logConfig(), logError(), logControl(), logResearch(), getRecent(), getByType(), getBySymbol(), getEntriesForDate(), generateDailyReport()
  - `src/api/` - HTTP + WebSocket
    - `server.ts` - ApiServer: Express app setup, CORS whitelist, JSON parsing, auth middleware, rate limiting, starts HTTP + WS
    - `routes.ts` - All REST endpoint definitions (15+ endpoints), Zod input validation on mutation endpoints
    - `websocket.ts` - WebSocketManager: broadcast(), 10 event types
    - `middleware/auth.ts` - Bearer token auth middleware (`API_SECRET_KEY` env var); skips `/api/status`; disabled if no key set
    - `trading212/client.ts` - Trading212 API client
    - `trading212/types.ts` - Trading212 type definitions
    - `trading212/errors.ts` - Trading212 error handling
  - `src/utils/` - Utilities
    - `logger.ts` - Pino logger factory: createLogger('module-name')
    - `helpers.ts` - formatCurrency(), formatPercent(), and shared utilities
    - `market-hours.ts` - getMarketTimes(), isUSMarketOpen(), getMarketStatus()
    - `holidays.ts` - NYSE holiday calendar 2024-2028, isNYSEHoliday(), isNYSEEarlyClose(), getNYSECloseMinutes(), getNextTradingDay()
    - `key-rotator.ts` - KeyRotator class, createFinnhubRotator(), createMarketauxRotator()
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
- **Model Performance Tracking**: records every AI prediction in `model_performance` table; daily evaluation job compares predicted direction to actual price movement (1d, 5d, 10d); computes per-model accuracy, buy/sell/hold accuracy, avg returns
- **Portfolio Correlation Analysis**: Pearson correlation on daily returns between positions; warns when new trade is highly correlated (> `risk.maxCorrelation`) with existing positions; full matrix endpoint for dashboard
- **Emergency Stop / Circuit Breaker**: POST `/api/control/emergency-stop` closes all positions and pauses bot; also triggers on daily loss limit breach via `riskGuard.checkDailyLoss()`; header bar has a red STOP button

## Database
SQLite via better-sqlite3 + drizzle-orm. 15 tables: trades, signals, positions, price_cache, news_cache, earnings_calendar, insider_transactions, fundamental_cache, daily_metrics, pairlist_history, config, trade_plans, ai_research, model_performance, audit_log.

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

## Scheduler Jobs (12 total)
1. `pairlistRefresh` - Refresh pairlist (configurable interval, market hours only)
2. `analysisLoop` - Full analysis on each stock (configurable interval, market hours only)
3. `positionMonitor` - Update positions, trailing stops, exit checks (configurable interval, market hours only)
4. `t212Sync` - Sync positions with Trading212 API (configurable interval, market hours only)
5. `dailySummary` - Send daily Telegram summary (configurable time, weekdays)
6. `preMarketAlert` - Send pre-market alert (configurable time, weekdays)
7. `weeklyReport` - Send weekly Telegram report (Fridays 5 PM ET)
8. `offHoursNews` - 24/7 news monitoring at reduced frequency (only outside market hours)
9. `positionReEval` - AI re-evaluation of open positions (configurable interval, market hours only)
10. `marketResearch` - AI market research (configurable interval, market hours only)
11. `modelEvaluation` - Evaluate pending AI predictions (daily at 6 PM ET)
12. `expirePlans` - Expire old trade plans (every 5 minutes, always)

## REST API Endpoints (15+)
- GET `/api/status` - Bot status, uptime, market status, environment, account type
- GET `/api/portfolio` - Positions + cash + total value + P&L
- GET `/api/trades` - Trade history with filters (symbol, from, to, side, limit, offset)
- GET `/api/trades/:id` - Single trade detail
- GET `/api/signals` - Signal history with filters (symbol, from, to, limit, offset)
- GET `/api/signals/:symbol/latest` - Latest signal for a symbol
- GET `/api/signals/:symbol/history` - Signal history for a symbol
- GET `/api/performance` - Aggregate performance metrics (win rate, Sharpe, drawdown, etc.)
- GET `/api/performance/daily` - Daily performance metrics history
- GET `/api/pairlist` - Current pairlist
- GET `/api/pairlist/history` - Pairlist snapshot history
- GET `/api/stock/:symbol` - Stock detail (latest signal + fundamentals + position)
- GET `/api/config` - All config grouped by category
- GET `/api/config/:category` - Config for a specific category
- PUT `/api/config/:key` - Update a config value
- POST `/api/control/pause` - Pause the bot
- POST `/api/control/resume` - Resume the bot
- POST `/api/control/close/:symbol` - Close a position
- POST `/api/control/analyze/:symbol` - Run analysis on a symbol
- POST `/api/control/refresh-pairlist` - Force pairlist refresh
- POST `/api/control/emergency-stop` - Emergency stop (close all, pause)
- GET `/api/trade-plans` - List recent trade plans
- POST `/api/trade-plans/:id/approve` - Approve a pending trade plan
- POST `/api/trade-plans/:id/reject` - Reject a pending trade plan
- GET `/api/research` - List AI research reports
- POST `/api/research/run` - Trigger manual AI research (body: { focus?, symbols? })
- GET `/api/model-stats` - AI model performance statistics
- POST `/api/pairlist/static` - Add a symbol to static pairlist (body: { symbol })
- DELETE `/api/pairlist/static/:symbol` - Remove a symbol from static pairlist
- GET `/api/audit` - Audit log entries (query: date?, type?, limit?)
- GET `/api/correlation` - Portfolio correlation matrix

## WebSocket Events (10 types)
- `price_update` - Real-time price data
- `trade_executed` - Trade completed
- `signal_generated` - New analysis signal
- `pairlist_updated` - New pairlist snapshot
- `bot_status` - Bot health/status changes
- `config_changed` - Config value changed
- `position_update` - Position P&L update
- `alert` - Alert/notification
- `trade_plan_created` - New trade plan awaiting approval
- `research_completed` - AI research report finished

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
