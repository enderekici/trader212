# Architecture

Technical deep-dive into the Trader212 autonomous trading bot.

## System Diagram

```
                          +------------------+
                          |    Scheduler     |
                          |   (node-cron)    |
                          |   12 jobs        |
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
                         |  (Pre-Entry Plan) |                |
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

## Data Flow

The bot operates in a pipeline that runs on configurable schedules:

### 1. Pairlist Discovery

The pairlist pipeline refreshes every 30 minutes (configurable via `pairlist.refreshMinutes`). It fetches all available instruments from Trading212, then applies a chain of filters:

1. **VolumeFilter** -- Keeps top N stocks by average daily volume (default: top 100 with >500K avg volume)
2. **PriceFilter** -- Removes stocks outside $5-$1,500 range
3. **MarketCapFilter** -- Requires minimum $2B market capitalization
4. **VolatilityFilter** -- Keeps stocks with 0.5%-10% daily volatility over 20 days
5. **BlacklistFilter** -- Removes manually blacklisted symbols
6. **MaxPairsFilter** -- Caps the final list at 30 stocks

The filter chain is configurable -- filters can be reordered, enabled, or disabled from the dashboard.

#### Pairlist Modes

The pipeline supports three modes, configured via `pairlist.mode`:

| Mode | Behavior |
|------|----------|
| `dynamic` (default) | All Trading212 US equities pass through the filter pipeline |
| `static` | Only symbols in `pairlist.staticSymbols` are used; filters are skipped |
| `hybrid` | Static symbols are always included, then dynamic symbols fill up to `pairlist.maxPairs` |

Static symbols can be managed via the dashboard or REST API:
- `POST /api/pairlist/static` -- Add a symbol
- `DELETE /api/pairlist/static/:symbol` -- Remove a symbol

### 2. Data Aggregation

For each stock in the pairlist, the data aggregator collects:

| Source | Data | Rate Limit |
|--------|------|-----------|
| Yahoo Finance | 365 days OHLCV, real-time quotes, fundamentals | Unofficial, best-effort |
| Finnhub | Real-time quotes, company news, earnings calendar, insider transactions | 60 calls/min (free) per key |
| Marketaux | News + sentiment for top 10 priority stocks | 100 calls/day (free) per key |

Data is cached in SQLite to minimize API calls and survive restarts.

#### API Key Rotation

Both Finnhub and Marketaux support multiple API keys via single comma-separated environment variables:

```bash
FINNHUB_API_KEY=key1,key2,key3        # 60 calls/min per key = 180 total
MARKETAUX_API_TOKEN=tok1,tok2          # 100 calls/day per key = 200 total
```

The `KeyRotator` class (`src/utils/key-rotator.ts`) implements round-robin key rotation with per-key rate limit tracking. When a key hits its rate limit, the rotator moves to the next key. Factory functions `createFinnhubRotator()` and `createMarketauxRotator()` handle env var parsing.

### 3. Analysis Engine

Three scoring layers run in parallel for each stock:

**Technical Analysis (25+ indicators):**
- Trend: SMA (20/50/200), EMA (12/26), MACD, Parabolic SAR, ADX
- Momentum: RSI, Stochastic, Williams %R, MFI, CCI, ROC
- Volatility: Bollinger Bands, ATR
- Volume: OBV, VWAP, Force Index, Volume Ratio
- Levels: Support/Resistance detection

**Fundamental Analysis:**
- P/E ratio and forward P/E
- Revenue growth (YoY), profit margin, operating margin
- Debt-to-equity, current ratio
- Earnings surprise, dividend yield, beta
- Insider transaction patterns

**Sentiment Analysis:**
- News headline aggregation and scoring
- Source-weighted sentiment (Finnhub + Marketaux)
- Earnings proximity warnings

Each layer produces a normalized score (0-1). These are combined into a composite conviction score.

#### Portfolio Correlation Analysis

The `CorrelationAnalyzer` (`src/analysis/correlation.ts`) calculates Pearson correlation coefficients between daily returns of stocks:

- **Pre-trade check**: Before any BUY order, the correlation between the new stock and all existing positions is computed. If correlation exceeds `risk.maxCorrelation` (default: 0.85), a warning is logged to the audit log.
- **Full matrix**: The `GET /api/correlation` endpoint returns the full N x N correlation matrix for all held positions, used by the Analytics dashboard page.
- **Lookback**: Configurable via `risk.correlationLookbackDays` (default: 30 days of daily returns from the price cache).

### 4. AI Decision Engine

The AI engine receives a structured prompt containing:

- Current price and 25+ indicator values
- Fundamental metrics
- Recent news headlines with sentiment
- Historical signal context (last 5 decisions)
- Active positions and portfolio state
- Market context (SPY price/trend, VIX level)
- Risk parameters and constraints

The AI returns a structured JSON response:

```json
{
  "decision": "BUY | SELL | HOLD",
  "conviction": 0.0 - 1.0,
  "reasoning": "...",
  "risks": ["risk1", "risk2"],
  "stopLossPct": 0.03,
  "takeProfitPct": 0.08,
  "positionSizePct": 0.10,
  "urgency": "immediate | today | no_rush",
  "exitConditions": "..."
}
```

**Multi-provider support:**

| Provider | Adapter | Configuration |
|----------|---------|--------------|
| Anthropic | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` + model selection |
| Ollama | HTTP client | Local URL + model name |
| OpenAI-compatible | HTTP client | Base URL + API key + model |

The provider is configurable at runtime via `ai.provider` in the config table.

#### AI Market Research

The `MarketResearcher` (`src/ai/market-research.ts`) runs scheduled research for stock discovery beyond the active pairlist:

- Triggered on a configurable schedule (`ai.research.intervalMinutes`, default: 120 min)
- Can also be triggered manually via `POST /api/research/run` with optional focus area and symbol list
- AI analyzes stocks and returns recommendations (strong_buy/buy/hold/sell/strong_sell) with conviction, catalysts, risks, target prices, and time horizons
- Results are stored in the `ai_research` table and viewable on the Research dashboard page
- Reports are listed via `GET /api/research`

#### Model Performance Tracking

The `ModelTracker` (`src/monitoring/model-tracker.ts`) evaluates AI accuracy over time:

- Every actionable AI prediction (BUY/SELL) is recorded in the `model_performance` table with the price at signal time
- A daily evaluation job (6 PM ET) checks pending predictions against actual price movements
- Tracks price after 1, 5, and 10 days; marks predictions as "correct" or "incorrect"
- Per-model statistics: total predictions, accuracy, buy/sell/hold accuracy, average return on buy/sell signals
- Viewable via `GET /api/model-stats`

### 5. Trade Plan / Pre-Entry Blueprint

When the AI issues a BUY or SELL signal, instead of executing immediately, a **Trade Plan** is created (`src/execution/trade-planner.ts`):

| Field | Description |
|-------|-------------|
| `symbol`, `t212Ticker` | Stock identification |
| `side` | BUY or SELL |
| `entryPrice` | Current market price |
| `shares` | Calculated from `positionSizePct * portfolioValue / price` |
| `positionValue`, `positionSizePct` | Dollar value and % of portfolio |
| `stopLossPrice`, `stopLossPct` | AI-suggested stop-loss |
| `takeProfitPrice`, `takeProfitPct` | AI-suggested take-profit |
| `maxLossDollars` | Maximum dollar loss if stop-loss hit |
| `riskRewardRatio` | Potential gain / potential loss |
| `maxHoldDays` | Maximum holding period (configurable) |
| `aiConviction` | AI conviction score |
| `aiReasoning`, `risks` | AI explanation and identified risks |
| `urgency`, `exitConditions` | Timing and exit criteria |
| `technicalScore`, `fundamentalScore`, `sentimentScore` | Analysis scores |
| `status` | pending -> approved/rejected/executed/expired |
| `expiresAt` | Plan expiration time |

Plans with insufficient risk/reward ratio (below `execution.minRiskRewardRatio`, default: 1.5) are rejected before creation.

### 6. Approval Manager

The `ApprovalManager` (`src/execution/approval-manager.ts`) controls the approval flow:

**Auto-Approve Mode** (`execution.requireApproval = false`):
- Plans are immediately approved with `approvedBy: "auto"` and executed

**Manual Approval Mode** (`execution.requireApproval = true`):
- Plans stay in "pending" status
- Sent to Telegram for human review
- Approvable via dashboard (`POST /api/trade-plans/:id/approve`) or Telegram (`/approve_<id>`)
- Rejectable via dashboard (`POST /api/trade-plans/:id/reject`) or Telegram (`/reject_<id>`)
- On timeout (`execution.approvalTimeoutMinutes`, default: 5):
  - If `execution.approvalAutoExecute = true`: auto-approved with `approvedBy: "auto-timeout"`
  - If `execution.approvalAutoExecute = false` (default): expired/rejected
- Expiry checked every 5 minutes by the `expirePlans` scheduler job

### 7. Risk Guard

Before any trade executes, the risk guard validates:

| Check | Default | Config Key |
|-------|---------|-----------|
| Max open positions | 5 | `risk.maxPositions` |
| Max position size | 15% of portfolio | `risk.maxPositionSizePct` |
| Stop-loss range | 1%-10% | `risk.minStopLossPct` / `risk.maxStopLossPct` |
| Max risk per trade | 2% | `risk.maxRiskPerTradePct` |
| Daily loss limit | 5% | `risk.dailyLossLimitPct` |
| Max drawdown alert | 10% | `risk.maxDrawdownAlertPct` |
| Sector concentration | 3 per sector | `risk.maxSectorConcentration` |
| Max correlation | 0.85 | `risk.maxCorrelation` |
| Correlation lookback | 30 days | `risk.correlationLookbackDays` |

If any check fails, the trade is blocked and the reason is logged to the audit log.

**Circuit Breaker / Emergency Stop:**
- Daily loss limit breach auto-pauses the bot and sends a Telegram alert
- Drawdown threshold breach sends an alert (but does not auto-pause)
- `POST /api/control/emergency-stop` immediately closes ALL positions and pauses the bot
- The dashboard header bar has a red "STOP" button that triggers the emergency stop with confirmation

### 8. Execution

The order manager handles the final step:

- **Live mode**: Places market orders via the Trading212 API, then sets stop-loss orders after a configurable delay (`execution.stopLossDelay`, default: 3000ms)
- **Dry-run mode** (default): Simulates order fills using current market prices, logs the hypothetical trade

After execution, the trade plan is marked as "executed" and the trade is recorded in the `trades` table.

### 9. Position Monitoring

The position monitor runs every 5 minutes (configurable via `execution.positionMonitorMinutes`):

1. **Price Updates** -- Fetches current prices for all open positions
2. **Trailing Stops** -- Updates trailing stop-loss for profitable positions
3. **Exit Conditions** -- Checks stop-loss, take-profit, and AI-specified exit conditions
4. **Auto-Close** -- Positions hitting exit conditions are automatically closed
5. **T212 Sync** -- Periodically syncs position state with Trading212 API

### 10. Position Re-evaluation

When enabled (`execution.reEvaluatePositions = true`), the bot periodically re-analyzes all open positions:

- Runs full technical + fundamental + sentiment analysis on each held stock
- Consults the AI for a fresh decision
- If the AI suggests SELL with conviction > 60:
  - Tightens the trailing stop to the AI's new suggested stop-loss level
  - Updates exit conditions with re-evaluation context
  - Logs to the audit log
- Interval configurable via `execution.reEvalIntervalMinutes` (default: 30)

### 11. 24/7 News Monitoring

When enabled (`data.newsMonitoring.enabled = true`), the bot monitors news even outside market hours:

- Only runs when the market is closed (the analysis loop handles market hours)
- Checks news for the top 10 stocks in the pairlist
- Caches news in the database for use when the market opens
- Interval configurable via `data.newsMonitoring.offHoursIntervalMinutes` (default: 60)

### 12. NYSE Holiday Calendar

The bot includes a full NYSE holiday and early close calendar for 2024-2028 (`src/utils/holidays.ts`):

- **Holidays**: New Year's, MLK Day, Presidents' Day, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas
- **Early Closes**: Day before Independence Day, day after Thanksgiving, Christmas Eve (when applicable)
- Functions: `isNYSEHoliday()`, `isNYSEEarlyClose()`, `getNYSECloseMinutes()`, `getNextTradingDay()`
- Market status includes holiday and early close flags displayed in the dashboard header bar

## Database Schema

All data is persisted in a SQLite database via Drizzle ORM. 15 tables total.

### `trades`

Completed trade history (both entries and exits).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| symbol | TEXT | Stock symbol (e.g., AAPL) |
| t212Ticker | TEXT | Trading212 instrument ticker |
| side | TEXT | BUY or SELL |
| shares | REAL | Number of shares |
| entryPrice | REAL | Entry fill price |
| exitPrice | REAL | Exit fill price (null if open) |
| pnl | REAL | Realized P&L |
| pnlPct | REAL | P&L as percentage |
| entryTime | TEXT | ISO 8601 UTC timestamp |
| exitTime | TEXT | ISO 8601 UTC timestamp |
| stopLoss | REAL | Stop-loss price |
| takeProfit | REAL | Take-profit price |
| exitReason | TEXT | Why the trade was closed |
| aiReasoning | TEXT | AI's rationale |
| convictionScore | REAL | AI conviction (0-1) |
| aiModel | TEXT | Model used for decision |
| accountType | TEXT | INVEST or ISA |
| createdAt | TEXT | Row creation timestamp |

### `signals`

Every analysis cycle records a signal row per stock.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| timestamp | TEXT | ISO 8601 UTC |
| symbol | TEXT | Stock symbol |
| rsi, macdValue, macdSignal, macdHistogram | REAL | MACD family |
| sma20, sma50, sma200 | REAL | Simple moving averages |
| ema12, ema26 | REAL | Exponential moving averages |
| bollingerUpper/Middle/Lower | REAL | Bollinger Bands |
| atr, adx | REAL | Volatility / trend strength |
| stochasticK, stochasticD | REAL | Stochastic oscillator |
| williamsR, mfi, cci | REAL | Momentum oscillators |
| obv, vwap | REAL | Volume indicators |
| parabolicSar, roc, forceIndex | REAL | Trend / momentum |
| volumeRatio | REAL | Current vs. average volume |
| supportLevel, resistanceLevel | REAL | Detected S/R levels |
| technicalScore | REAL | Composite technical score |
| sentimentScore | REAL | News sentiment score |
| fundamentalScore | REAL | Fundamental score |
| aiScore | REAL | AI conviction score |
| convictionTotal | REAL | Weighted total score |
| decision | TEXT | BUY, SELL, or HOLD |
| executed | INTEGER | Boolean: was this traded? |
| aiReasoning | TEXT | AI explanation |
| aiModel | TEXT | Model identifier |
| suggestedStopLossPct | REAL | AI-suggested stop-loss % |
| suggestedPositionSizePct | REAL | AI-suggested position size % |
| suggestedTakeProfitPct | REAL | AI-suggested take-profit % |
| extraIndicators | TEXT | JSON overflow for extra data |
| newsHeadlines | TEXT | JSON array of headlines |

### `positions`

Currently open positions.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| symbol | TEXT | Unique stock symbol |
| t212Ticker | TEXT | Trading212 ticker |
| shares | REAL | Shares held |
| entryPrice | REAL | Average entry price |
| entryTime | TEXT | ISO 8601 UTC |
| currentPrice | REAL | Latest known price |
| pnl | REAL | Unrealized P&L |
| pnlPct | REAL | Unrealized P&L % |
| stopLoss | REAL | Stop-loss price |
| trailingStop | REAL | Trailing stop price |
| takeProfit | REAL | Take-profit price |
| convictionScore | REAL | Entry conviction |
| stopOrderId | TEXT | Trading212 stop order ID |
| aiExitConditions | TEXT | AI-specified exit criteria |
| accountType | TEXT | INVEST or ISA |
| updatedAt | TEXT | Last update timestamp |

### `price_cache`

Cached OHLCV data. Indexed on `(symbol, timestamp)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| symbol | TEXT | Stock symbol |
| timestamp | TEXT | Bar timestamp |
| open, high, low, close | REAL | OHLC prices |
| volume | REAL | Volume |
| timeframe | TEXT | Default: 1d |

### `news_cache`

Cached news articles. Indexed on `(symbol, fetchedAt)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| symbol | TEXT | Stock symbol |
| title | TEXT | Headline |
| source | TEXT | News source |
| url | TEXT | Article URL |
| publishedAt | TEXT | Publication time |
| sentimentScore | REAL | Computed sentiment |
| fetchedAt | TEXT | When we fetched it |

### `earnings_calendar`

Upcoming and past earnings. Indexed on `(symbol, earningsDate)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| symbol | TEXT | Stock symbol |
| earningsDate | TEXT | Expected earnings date |
| estimate | REAL | EPS estimate |
| actual | REAL | Actual EPS |
| surprise | REAL | Surprise amount |
| fetchedAt | TEXT | Fetch timestamp |

### `insider_transactions`

Insider buying/selling activity. Indexed on `(symbol, fetchedAt)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| symbol | TEXT | Stock symbol |
| filingDate | TEXT | SEC filing date |
| transactionDate | TEXT | Transaction date |
| ownerName | TEXT | Insider name |
| transactionType | TEXT | Buy/Sell/etc. |
| shares | REAL | Shares transacted |
| pricePerShare | REAL | Price per share |
| totalValue | REAL | Total value |
| fetchedAt | TEXT | Fetch timestamp |

### `fundamental_cache`

Cached fundamental metrics. Indexed on `(symbol, fetchedAt)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| symbol | TEXT | Stock symbol |
| fetchedAt | TEXT | Fetch timestamp |
| peRatio, forwardPE | REAL | P/E ratios |
| revenueGrowthYoY | REAL | Year-over-year revenue growth |
| profitMargin, operatingMargin | REAL | Margins |
| debtToEquity, currentRatio | REAL | Balance sheet ratios |
| marketCap | REAL | Market capitalization |
| sector, industry | TEXT | Classification |
| earningsSurprise | REAL | Last surprise |
| dividendYield | REAL | Dividend yield |
| beta | REAL | Stock beta |

### `daily_metrics`

End-of-day portfolio performance snapshots.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| date | TEXT | Unique date (YYYY-MM-DD) |
| totalPnl | REAL | Day's total P&L |
| tradesCount | INTEGER | Trades that day |
| winCount, lossCount | INTEGER | Win/loss counts |
| winRate | REAL | Win rate (0-1) |
| maxDrawdown | REAL | Max intraday drawdown |
| sharpeRatio | REAL | Rolling Sharpe ratio |
| profitFactor | REAL | Gross profit / gross loss |
| portfolioValue | REAL | End-of-day value |
| cashBalance | REAL | Available cash |
| accountType | TEXT | Account type |

### `pairlist_history`

Audit trail of pairlist snapshots.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | TEXT | Snapshot timestamp |
| symbols | TEXT | JSON array of symbols |
| filterStats | TEXT | JSON per-filter counts |

### `config`

Runtime configuration (DB-backed, live-updatable).

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT | Primary key (dot-notation) |
| value | TEXT | JSON-encoded value |
| category | TEXT | Grouping category |
| description | TEXT | Human-readable description |
| updatedAt | TEXT | Last update timestamp |

### `trade_plans`

Pre-entry trade blueprints. Indexed on `(symbol, status)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| symbol | TEXT | Stock symbol |
| t212Ticker | TEXT | Trading212 ticker |
| status | TEXT | pending, approved, rejected, executed, expired |
| side | TEXT | BUY or SELL |
| entryPrice | REAL | Entry price at plan creation |
| shares | INTEGER | Number of shares |
| positionValue | REAL | Total position value |
| positionSizePct | REAL | Position as % of portfolio |
| stopLossPrice | REAL | Calculated stop-loss price |
| stopLossPct | REAL | Stop-loss percentage |
| takeProfitPrice | REAL | Calculated take-profit price |
| takeProfitPct | REAL | Take-profit percentage |
| maxLossDollars | REAL | Maximum dollar loss |
| riskRewardRatio | REAL | Risk/reward ratio |
| maxHoldDays | INTEGER | Maximum holding period |
| aiConviction | REAL | AI conviction score |
| aiReasoning | TEXT | AI explanation |
| aiModel | TEXT | AI model identifier |
| risks | TEXT | JSON array of identified risks |
| urgency | TEXT | immediate, today, no_rush |
| exitConditions | TEXT | AI exit criteria |
| technicalScore | REAL | Technical analysis score |
| fundamentalScore | REAL | Fundamental analysis score |
| sentimentScore | REAL | Sentiment analysis score |
| accountType | TEXT | INVEST or ISA |
| approvedAt | TEXT | Approval timestamp |
| approvedBy | TEXT | auto, manual, telegram, auto-timeout |
| expiresAt | TEXT | Plan expiration time |
| createdAt | TEXT | Plan creation timestamp |

### `ai_research`

AI market research reports. Indexed on `(timestamp)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| timestamp | TEXT | Research timestamp |
| query | TEXT | Research query/focus |
| symbols | TEXT | JSON array of analyzed symbols |
| results | TEXT | JSON array of research results |
| aiModel | TEXT | AI model used |
| marketContext | TEXT | JSON: SPY trend, VIX, sector rotation, themes |
| createdAt | TEXT | Row creation timestamp |

### `model_performance`

AI prediction tracking. Indexed on `(aiModel, signalTimestamp)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| aiModel | TEXT | AI model identifier |
| symbol | TEXT | Stock symbol |
| decision | TEXT | BUY, SELL, or HOLD |
| conviction | REAL | AI conviction at signal time |
| signalTimestamp | TEXT | When the prediction was made |
| priceAtSignal | REAL | Price when prediction was made |
| priceAfter1d | REAL | Price 1 day after signal |
| priceAfter5d | REAL | Price 5 days after signal |
| priceAfter10d | REAL | Price 10 days after signal |
| actualOutcome | TEXT | correct, incorrect, or pending |
| actualReturnPct | REAL | Actual return since signal |
| evaluatedAt | TEXT | When the evaluation was done |

### `audit_log`

Bot action audit trail / session replay. Indexed on `(timestamp, eventType)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| timestamp | TEXT | Event timestamp |
| eventType | TEXT | trade, signal, pairlist, config, error, control, research |
| category | TEXT | execution, analysis, risk, system, user |
| symbol | TEXT | Related stock symbol (nullable) |
| summary | TEXT | Human-readable summary |
| details | TEXT | JSON with full context |
| severity | TEXT | info, warn, error |

## Config System

All runtime configuration lives in the `config` table. The `ConfigManager` class:

1. Seeds defaults from `src/config/defaults.ts` on first run
2. Caches values in memory with typed getters (`getString`, `getNumber`, `getBoolean`, `getJSON`)
3. Writes changes back to the DB immediately
4. Exposes a REST API for the dashboard to read/write config
5. Emits WebSocket events on changes so the dashboard updates in real-time

Config categories: `trading212`, `pairlist`, `dataSources`, `analysis`, `ai`, `risk`, `execution`, `monitoring`.

Secrets (API keys, tokens) are **never** stored in the DB -- they remain in `.env` only.

## Scheduler Jobs

The bot runs 12 scheduled jobs via node-cron:

| Job | Schedule | Market Hours Only | Description |
|-----|----------|-------------------|-------------|
| `pairlistRefresh` | Every N min (default: 30) | Yes | Refresh stock pairlist |
| `analysisLoop` | Every N min (default: 15) | Yes | Full analysis + AI on each stock |
| `positionMonitor` | Every N min (default: 5) | Yes | Update positions, trailing stops |
| `t212Sync` | Every N min (default: 10) | Yes | Sync positions with T212 API |
| `dailySummary` | Configurable time (default: 16:30 ET) | No | Daily Telegram summary |
| `preMarketAlert` | Configurable time (default: 09:00 ET) | No | Pre-market Telegram alert |
| `weeklyReport` | Fridays 5 PM ET | No | Weekly performance report |
| `offHoursNews` | Every N min (default: 60) | No | 24/7 news monitoring |
| `positionReEval` | Every N min (default: 30) | Yes | AI re-evaluation of positions |
| `marketResearch` | Every N min (default: 120) | Yes | AI market research |
| `modelEvaluation` | Daily at 6 PM ET | No | Evaluate AI prediction accuracy |
| `expirePlans` | Every 5 min | No | Expire old pending trade plans |

Jobs marked "Market Hours Only" are skipped when the US market is closed (weekends, NYSE holidays).

## WebSocket Events

The Express server at `:3001` also hosts a WebSocket server for real-time updates:

| Event | Direction | Payload |
|-------|-----------|---------|
| `price_update` | Server -> Client | Real-time price data |
| `signal_generated` | Server -> Client | New analysis signal with scores |
| `trade_executed` | Server -> Client | Trade completed (symbol, side, shares, price) |
| `trade_plan_created` | Server -> Client | New trade plan awaiting approval |
| `position_update` | Server -> Client | Position P&L update |
| `pairlist_updated` | Server -> Client | New pairlist snapshot |
| `config_changed` | Server -> Client | Config value changed |
| `bot_status` | Server -> Client | Bot health/status changes |
| `alert` | Server -> Client | Alert/notification |
| `research_completed` | Server -> Client | AI research report finished |

## Web Dashboard

The dashboard is a Next.js 15 application (App Router) with Tailwind CSS v4:

**Layout:**
- Fixed sidebar with 9 navigation items
- Header bar with real-time status information:
  - Environment badge (DEMO in green, LIVE in red)
  - Account type badge (INVEST/ISA in blue)
  - Dry-run badge (yellow, only shown when active)
  - Bot status (RUNNING in green, PAUSED in yellow)
  - Market status with countdown timer (Open/Pre-Market/After Hours/Closed)
  - Holiday and early close indicators
  - Current ET time
  - Emergency stop button (red, with confirmation dialog)

**Pages (9 total):**
1. **Overview** (`/`) -- Portfolio summary, recent trades, signals
2. **Positions** (`/positions`) -- Open positions with live P&L
3. **Trades** (`/trades`) -- Trade history with filters
4. **Signals** (`/signals`) -- Signal history with indicators
5. **Pairlist** (`/pairlist`) -- Pairlist management
6. **Research** (`/research`) -- AI research reports
7. **Analytics** (`/analytics`) -- Performance metrics and charts
8. **Activity** (`/audit`) -- Audit log timeline
9. **Settings** (`/settings`) -- Config editor

**Key Components:**
- `StatusBadge` -- Color-coded status indicator
- `PnlDisplay` -- P&L with green/red coloring
- `StockChart` -- Price chart using lightweight-charts
- `ConfigEditor` -- Live config editor grouped by category

**Dependencies:** Next.js 15, React 19, Tailwind CSS v4, SWR, lucide-react, lightweight-charts, clsx, tailwind-merge.

## Source Structure

```
src/
+-- index.ts                  # Entry point, TradingBot class, all core loops
+-- config/
|   +-- defaults.ts           # Default config values
|   +-- manager.ts            # ConfigManager (DB-backed, live-updatable)
+-- db/
|   +-- index.ts              # Database connection
|   +-- schema.ts             # Drizzle schema (15 tables)
|   +-- repositories/
|       +-- config.ts         # Config data access
|       +-- positions.ts      # Positions data access
|       +-- trades.ts         # Trades data access
|       +-- signals.ts        # Signals data access
|       +-- cache.ts          # Cache data access
|       +-- metrics.ts        # Metrics data access
+-- pairlist/
|   +-- index.ts              # Pairlist module entry
|   +-- pipeline.ts           # Filter pipeline runner
|   +-- filters.ts            # Volume, Price, MarketCap, Volatility, Blacklist, MaxPairs
+-- data/
|   +-- data-aggregator.ts    # Orchestrates all data sources
|   +-- yahoo-finance.ts      # Yahoo Finance adapter
|   +-- finnhub.ts            # Finnhub adapter
|   +-- marketaux.ts          # Marketaux adapter
|   +-- ticker-mapper.ts      # Symbol <-> T212 ticker mapping
+-- ai/
|   +-- agent.ts              # AI orchestrator
|   +-- prompt-builder.ts     # Structured prompt construction
|   +-- decision-processor.ts # Parse + validate AI responses
|   +-- market-research.ts    # AI market research for stock discovery
|   +-- adapters/
|       +-- anthropic.ts      # Anthropic Claude adapter
|       +-- ollama.ts         # Ollama adapter
|       +-- openai-compat.ts  # OpenAI-compatible adapter
+-- execution/
|   +-- order-manager.ts      # Order placement + dry-run sim
|   +-- risk-guard.ts         # Pre-trade risk validation
|   +-- trade-planner.ts      # Trade plan creation and management
|   +-- approval-manager.ts   # Auto/manual trade approval flow
|   +-- position-tracker.ts   # Position monitoring and trailing stops
+-- analysis/
|   +-- analyzer.ts           # Analysis orchestrator
|   +-- correlation.ts        # Pearson correlation analyzer
|   +-- technical/
|   |   +-- indicators.ts     # 25+ indicator calculations
|   |   +-- scorer.ts         # Technical score computation
|   +-- fundamental/
|   |   +-- scorer.ts         # Fundamental score computation
|   +-- sentiment/
|       +-- scorer.ts         # Sentiment score computation
+-- monitoring/
|   +-- telegram.ts           # Telegram notifications + commands
|   +-- performance.ts        # Performance tracking + summaries
|   +-- model-tracker.ts      # AI model accuracy tracking
|   +-- audit-log.ts          # Audit log (session replay)
+-- api/
|   +-- server.ts             # Express REST API server
|   +-- routes.ts             # All REST endpoint definitions
|   +-- websocket.ts          # WebSocket server
|   +-- trading212/
|       +-- client.ts         # Trading212 API client
|       +-- types.ts          # T212 type definitions
|       +-- errors.ts         # T212 error handling
+-- utils/
|   +-- logger.ts             # Pino logger factory
|   +-- helpers.ts            # Shared utilities
|   +-- market-hours.ts       # US market hours logic
|   +-- holidays.ts           # NYSE holiday calendar (2024-2028)
|   +-- key-rotator.ts        # API key rotation
+-- bot/
    +-- scheduler.ts          # Cron job scheduler

web/
+-- app/
|   +-- layout.tsx            # Root layout (Sidebar + HeaderBar)
|   +-- page.tsx              # Overview dashboard
|   +-- positions/page.tsx    # Open positions
|   +-- trades/page.tsx       # Trade history
|   +-- signals/page.tsx      # Signal history
|   +-- pairlist/page.tsx     # Pairlist management
|   +-- research/page.tsx     # AI research reports
|   +-- analytics/page.tsx    # Performance analytics
|   +-- audit/page.tsx        # Activity / audit log
|   +-- settings/page.tsx     # Configuration editor
+-- components/
|   +-- sidebar.tsx           # Navigation sidebar
|   +-- header-bar.tsx        # Status header bar
|   +-- status-badge.tsx      # Status badge component
|   +-- pnl-display.tsx       # P&L display component
|   +-- stock-chart.tsx       # Price chart component
|   +-- config-editor.tsx     # Config editor component
+-- lib/
    +-- utils.ts              # cn() utility
    +-- api.ts                # API client (fetch wrapper)
    +-- websocket.ts          # WebSocket client for real-time updates
    +-- types.ts              # TypeScript types
```
