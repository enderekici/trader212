# Trader212 - Autonomous AI Trading Bot

[![CI](https://github.com/enderekici/trader212/actions/workflows/ci.yml/badge.svg)](https://github.com/enderekici/trader212/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/enderekici/trader212/branch/main/graph/badge.svg)](https://codecov.io/gh/enderekici/trader212)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org)

An autonomous, AI-powered stock trading bot for the [Trading212](https://www.trading212.com) platform. It dynamically discovers tradeable stocks, runs technical/fundamental/sentiment analysis, consults an AI decision engine, enforces risk management rules, and executes trades -- all without manual intervention.

## Features

### Core Trading Pipeline
- **Dynamic Pairlist Pipeline** -- Automatically discovers and filters stocks through 6 configurable stages (volume, price, market cap, volatility, blacklist, max pairs)
- **Pairlist Modes** -- Dynamic (auto-discover), Static (user-specified symbols), or Hybrid (static + dynamic up to max)
- **Multi-Source Data Layer** -- Aggregates OHLCV, quotes, news, earnings, and insider data from Yahoo Finance, Finnhub, and Marketaux
- **25+ Technical Indicators** -- RSI, MACD, Bollinger Bands, ADX, Stochastic, MFI, CCI, OBV, VWAP, Parabolic SAR, support/resistance, and more
- **Fundamental & Sentiment Analysis** -- P/E, revenue growth, profit margins, debt ratios, insider activity, news sentiment scoring
- **AI Decision Engine** -- Multi-provider support (Anthropic Claude, Ollama, OpenAI-compatible) with structured prompt building and conviction scoring

### Trade Planning & Execution
- **Trade Plan / Pre-Entry Blueprint** -- Every trade starts as a detailed plan with position sizing, stop-loss, take-profit, R:R ratio, AI risks, urgency, and exit conditions
- **Approval Manager** -- Configurable auto-approve or manual approval via dashboard or Telegram; plans expire after a timeout (auto-execute or reject)
- **Risk Guard** -- Position sizing, stop-loss enforcement, daily loss limits, sector concentration caps, drawdown alerts
- **Portfolio Correlation Analysis** -- Pearson correlation matrix detects highly correlated positions before entry
- **Execution Engine** -- Real order placement via Trading212 API with dry-run simulation mode
- **Position Re-evaluation** -- AI periodically re-analyzes held positions and tightens trailing stops

### Monitoring & Intelligence
- **AI Market Research** -- Scheduled AI-driven stock discovery beyond the active pairlist, stored as research reports
- **Model Performance Tracking** -- Records every AI prediction and evaluates accuracy over time (1d, 5d, 10d horizons)
- **Audit Log / Session Replay** -- Every bot action logged with event type, category, severity, and full context
- **24/7 News Monitoring** -- Off-hours news fetching at reduced frequency for pre-market preparation
- **NYSE Holiday Calendar** -- Full 2024-2028 holiday and early close awareness
- **Emergency Stop / Circuit Breaker** -- One-click stop that closes all positions and pauses the bot; auto-triggers on daily loss limit breach

### Dashboard & Notifications
- **Real-Time Web Dashboard** -- Next.js 15 frontend with 9 pages, live WebSocket updates, and interactive charts
- **Header Bar** -- Environment badge (demo/live), account type, dry-run indicator, bot status, market status with countdown, holiday/early close flags, emergency stop button
- **Telegram Notifications** -- Trade alerts, daily summaries, pre-market reports, weekly reports, and bot commands
- **DB-Backed Configuration** -- All runtime settings stored in SQLite, editable live from the dashboard

### Infrastructure
- **API Key Rotation** -- Single comma-separated env var per service (FINNHUB_API_KEY, MARKETAUX_API_TOKEN); round-robin rotation with per-key rate tracking
- **12 Scheduler Jobs** -- Pairlist refresh, analysis loop, position monitor, T212 sync, daily/weekly reports, news monitoring, position re-eval, AI research, model evaluation, plan expiry
- **15+ REST Endpoints** -- Full CRUD for trades, signals, positions, config, pairlist, research, audit, correlation, and bot control
- **10 WebSocket Events** -- Real-time streaming of prices, trades, signals, positions, status, plans, and research
- **Docker Ready** -- Multi-stage Dockerfiles for bot and web, docker-compose for one-command deployment

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-username/trader212.git && cd trader212

# 2. Copy and configure environment variables
cp .env.example .env   # then edit .env with your API keys

# 3. Install dependencies
npm install

# 4. Start the bot (demo mode + dry-run by default)
npm run dev
```

The bot starts in **demo mode** with **dry-run enabled** -- no real money is at risk. Open `http://localhost:3001` for the API, or see the [Quick Start Guide](QUICKSTART.md) for the full walkthrough.

For the web dashboard:

```bash
cd web && npm install && npm run dev
# Open http://localhost:3000
```

## Architecture

```
                          +------------------+
                          |    Scheduler     |
                          |  (12 cron jobs)  |
                          +--------+---------+
                                   | triggers
        +--------------------------+---------------------------+
        v                          v                           v
+----------------+       +-------------------+       +------------------+
|    Pairlist    |       | Data Aggregator   |       |    Position      |
|    Pipeline    |       |                   |       |    Monitor       |
|                |       |  Yahoo Finance    |       |                  |
|  6 Filters     |------>|  Finnhub          |       |  Trailing Stop   |
|  3 Modes       | pairs |  Marketaux        |       |  Re-evaluation   |
|  (dyn/stat/hyb)|       +--------+----------+       +--------+---------+
+----------------+                | data                      |
                                  v                           |
                         +-------------------+                |
                         | Analysis Engine   |                |
                         |                   |                |
                         |  Technical (25+)  |                |
                         |  Fundamental      |                |
                         |  Sentiment        |                |
                         |  Correlation      |                |
                         +--------+----------+                |
                                  | scores                    |
                                  v                           |
                         +-------------------+                |
                         |  AI Decision      |                |
                         |    Engine         |                |
                         |                   |                |
                         |  Prompt Builder   |                |
                         |  Multi-Provider   |                |
                         |  Decision Proc.   |                |
                         +--------+----------+                |
                                  | BUY/SELL/HOLD             |
                                  v                           |
                         +-------------------+                |
                         |  Trade Planner    |                |
                         |  Pre-Entry Plan   |                |
                         +--------+----------+                |
                                  |                           |
                                  v                           |
                         +-------------------+                |
                         | Approval Manager  |                |
                         | (auto or manual)  |                |
                         +--------+----------+                |
                                  |                           |
                                  v                           |
                         +-------------------+                |
                         |   Risk Guard     |<----------------+
                         |                   |
                         |  Position Limit   |
                         |  Correlation Chk  |
                         |  Stop-Loss Range  |
                         |  Daily Loss       |
                         |  Sector Conc.     |
                         +--------+----------+
                                  | approved
                                  v
                         +-------------------+
                         | Order Manager     |
                         |                   |
                         |  Trading212 API   |
                         |  Dry-Run Sim.     |
                         +--------+----------+
                                  |
                  +---------------+---------------+
                  v               v               v
           +----------+   +-----------+   +------------+
           |  SQLite  |   |  Telegram |   | WebSocket  |
           | Database |   |   Bot     |   | + Express  |
           | (15 tbl) |   |           |   | + Dashboard|
           +----------+   +-----------+   +------------+
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20+, ESM TypeScript |
| Database | SQLite via better-sqlite3, Drizzle ORM (15 tables) |
| AI | Anthropic SDK, Ollama, OpenAI-compatible |
| Data | Yahoo Finance, Finnhub, Marketaux |
| Indicators | technicalindicators |
| API | Express, WebSocket (ws), 15+ REST endpoints |
| Web | Next.js 15 (App Router), Tailwind CSS v4, lucide-react, lightweight-charts, SWR |
| Notifications | node-telegram-bot-api |
| Build | tsup, tsx (dev) |
| Testing | Vitest, v8 coverage (90% threshold) |
| Linting | Biome |
| Validation | Zod |

## Dashboard Pages (9 total)

| Page | Route | Description |
|------|-------|-------------|
| Overview | `/` | Portfolio summary, recent trades, active signals, P&L chart |
| Positions | `/positions` | Open positions with real-time P&L updates |
| Trades | `/trades` | Full trade history with filters and AI reasoning |
| Signals | `/signals` | Signal history with indicator values and scores |
| Pairlist | `/pairlist` | Current pairlist, static symbol management, filter stats |
| Research | `/research` | AI market research reports and stock discovery |
| Analytics | `/analytics` | Performance metrics, win rate, Sharpe ratio, drawdown |
| Activity | `/audit` | Audit log timeline with event filtering |
| Settings | `/settings` | Live config editor grouped by category |

The layout includes a fixed sidebar for navigation and a header bar showing environment (demo/live), account type (INVEST/ISA), dry-run status, bot status (running/paused), market status with countdown timer, holiday/early close indicators, current ET time, and an emergency stop button.

## API Endpoints

### Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Bot status, uptime, market status |
| GET | `/api/portfolio` | Positions + cash + total value |
| GET | `/api/trades` | Trade history (filterable) |
| GET | `/api/trades/:id` | Single trade detail |
| GET | `/api/signals` | Signal history (filterable) |
| GET | `/api/signals/:symbol/latest` | Latest signal for symbol |
| GET | `/api/signals/:symbol/history` | Signal history for symbol |
| GET | `/api/performance` | Aggregate performance metrics |
| GET | `/api/performance/daily` | Daily performance history |
| GET | `/api/pairlist` | Current pairlist |
| GET | `/api/pairlist/history` | Pairlist snapshots |
| GET | `/api/stock/:symbol` | Stock detail |
| GET | `/api/config` | All config by category |
| GET | `/api/config/:category` | Config for category |
| GET | `/api/trade-plans` | Recent trade plans |
| GET | `/api/research` | AI research reports |
| GET | `/api/model-stats` | AI model performance |
| GET | `/api/audit` | Audit log entries |
| GET | `/api/correlation` | Portfolio correlation matrix |

### Control
| Method | Endpoint | Description |
|--------|----------|-------------|
| PUT | `/api/config/:key` | Update config value |
| POST | `/api/control/pause` | Pause the bot |
| POST | `/api/control/resume` | Resume the bot |
| POST | `/api/control/close/:symbol` | Close a position |
| POST | `/api/control/analyze/:symbol` | Run analysis on symbol |
| POST | `/api/control/refresh-pairlist` | Force pairlist refresh |
| POST | `/api/control/emergency-stop` | Emergency stop |
| POST | `/api/trade-plans/:id/approve` | Approve trade plan |
| POST | `/api/trade-plans/:id/reject` | Reject trade plan |
| POST | `/api/research/run` | Trigger AI research |
| POST | `/api/pairlist/static` | Add static symbol |
| DELETE | `/api/pairlist/static/:symbol` | Remove static symbol |

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start](QUICKSTART.md) | 5-minute setup guide |
| [Architecture](ARCHITECTURE.md) | System design deep-dive |
| [Docker](DOCKER.md) | Container deployment |
| [Testing](TESTING.md) | Test suite guide |
| [Environments](ENVIRONMENTS.md) | Demo, dry-run, and live modes |
| [Changelog](CHANGELOG.md) | Release history |

## License

[MIT](LICENSE) -- Copyright 2026 Ender Ekici
