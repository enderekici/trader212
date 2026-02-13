# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-13

### Added
- **Trade Plan / Pre-Entry Blueprint**: Every trade now creates a detailed plan (position sizing, stops, targets, R:R ratio, risks, urgency, exit conditions) stored in the `trade_plans` table before execution
- **Approval Manager**: Configurable auto-approve or manual approval via dashboard/Telegram; plans expire after timeout with auto-execute or reject behavior
- **AI Market Research**: Scheduled AI-driven stock discovery beyond the active pairlist; stored as structured reports with recommendations, catalysts, risks, and target prices
- **Model Performance Tracking**: Records every AI prediction and evaluates accuracy over time against actual price movements at 1d, 5d, and 10d horizons
- **Audit Log / Session Replay**: Comprehensive logging of all bot actions (trades, signals, pairlist changes, config updates, errors, control actions, research) with event type, category, severity, and full JSON context
- **Portfolio Correlation Analysis**: Pearson correlation matrix between held positions; pre-trade correlation check warns on highly correlated entries; full matrix endpoint for the dashboard
- **API Key Rotation**: Single comma-separated env var per service (`FINNHUB_API_KEY`, `MARKETAUX_API_TOKEN`) with round-robin rotation and per-key rate tracking via `KeyRotator`
- **Pairlist Modes**: Support for `dynamic` (default), `static` (user-specified symbols only), and `hybrid` (static + dynamic) pairlist modes with REST endpoints for static symbol management
- **24/7 News Monitoring**: Off-hours news fetching at reduced frequency for pre-market preparation; only runs outside market hours
- **Position Re-evaluation**: AI periodically re-analyzes held positions and tightens trailing stops when conviction shifts
- **NYSE Holiday Calendar**: Full 2024-2028 holiday and early close calendar with `isNYSEHoliday()`, `isNYSEEarlyClose()`, `getNYSECloseMinutes()`, and `getNextTradingDay()`
- **Emergency Stop / Circuit Breaker**: `POST /api/control/emergency-stop` closes all positions and pauses bot; auto-triggers on daily loss limit breach; dashboard header has a red STOP button
- **Dashboard Header Bar**: Real-time header showing environment badge (demo/live), account type, dry-run status, bot status, market status with countdown, holiday/early close indicators, current ET time, and emergency stop button
- New REST endpoints: `/api/control/emergency-stop`, `/api/trade-plans`, `/api/trade-plans/:id/approve`, `/api/trade-plans/:id/reject`, `/api/research`, `/api/research/run`, `/api/model-stats`, `/api/pairlist/static`, `/api/pairlist/static/:symbol`, `/api/audit`, `/api/correlation`
- New WebSocket events: `trade_plan_created`, `research_completed`
- New database tables: `trade_plans`, `ai_research`, `model_performance`, `audit_log`
- New scheduler jobs: `offHoursNews`, `positionReEval`, `marketResearch`, `modelEvaluation`, `expirePlans` (total: 12 jobs)
- Dashboard Research page for viewing AI research reports
- Dashboard Activity page for viewing the audit log timeline
- `StatusBadge`, `PnlDisplay`, `StockChart`, `ConfigEditor`, `HeaderBar` dashboard components
- Telegram commands: `/approve_<id>`, `/reject_<id>` for trade plan approval

### Changed
- Trade execution now goes through Trade Planner -> Approval Manager -> Risk Guard -> Order Manager (previously skipped planning/approval)
- Risk guard now includes correlation check before BUY orders
- Scheduler expanded from 7 to 12 jobs
- REST API expanded from ~10 to 15+ endpoints
- WebSocket events expanded from 6 to 10 types
- Database schema expanded from 11 to 15 tables

## [1.0.0] - 2026-02-13

### Added
- Initial release
- Dynamic pairlist pipeline with 6 configurable filters (volume, price, market cap, volatility, blacklist, max pairs)
- Multi-source data layer (Yahoo Finance, Finnhub, Marketaux)
- 25+ technical indicators with composite scoring (RSI, MACD, Bollinger Bands, ADX, Stochastic, MFI, CCI, OBV, VWAP, and more)
- Fundamental analysis (P/E, revenue growth, margins, debt ratios, insider activity)
- Sentiment analysis from aggregated news sources
- AI decision engine with multi-provider support (Anthropic Claude, Ollama, OpenAI-compatible)
- Structured prompt building with historical signal context
- Execution engine with dry-run simulation mode
- Risk guard with configurable safety limits (position sizing, stop-loss, daily loss limits, sector concentration)
- Real-time web dashboard (Next.js) with WebSocket updates
- Telegram notifications and commands (trade alerts, daily summaries, pre-market reports)
- SQLite database with Drizzle ORM and full data persistence
- DB-backed runtime configuration, live-editable from the dashboard
- Express REST API with WebSocket event streaming
- Docker support with multi-stage builds and docker-compose
- CI pipeline with lint, typecheck, and test stages
- Comprehensive documentation (architecture, quickstart, environments, testing, Docker)
