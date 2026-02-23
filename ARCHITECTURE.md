# Architecture

Technical deep-dive into the Trader212 autonomous trading bot.

## System Diagram

```
                          +------------------+
                          |    Scheduler     |
                          |   (node-cron)    |
                          |   14 jobs        |
                          +--------+---------+
                                   | triggers
        +--------------------------+---------------------------+
        v                          v                           v
+----------------+       +-------------------+       +------------------+
|    Pairlist    |       | Data Aggregator   |       |    Position      |
|    Pipeline    |       |                   |       |    Monitor       |
|                |       |  Yahoo Finance    |       |                  |
|  8 Filters     |------>|  Finnhub          |       |  Trailing Stop   |
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
                         |  Decision Engine  |                |
                         |  (Deterministic)  |                |
                         |                   |                |
                         |  4-Strategy       |                |
                         |  Consensus        |                |
                         |  Regime-Weighted  |                |
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
           |  SQLite  |   |  Telegram |   | + Express  |
           | Database |   |   Bot     |   | WebSocket  |
           | (23 tbl) |   |           |   | + Dashboard|
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
6. **SectorFilter** -- Whitelist/blacklist by sector (e.g., only Semiconductors, exclude Energy)
7. **PerformanceFilter** -- Filters by recent price performance (e.g., minimum 30-day return)
8. **MaxPairsFilter** -- Caps the final list at 30 stocks

Before filtering, the pipeline runs an **enrichment step** that batch-fetches price, volume, and market cap from Yahoo Finance quotes, and loads sector data from the fundamentals cache.

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

**Market Context (opt-in):**
- Market Breadth: percentage of symbols above SMA(50) and SMA(200), classified as oversold/neutral/overbought
- FOMC Calendar: proximity to Federal Reserve meetings (2024-2028), pre-FOMC window detection, FOMC day detection
- Breadth adjustments: dampen bullish scores 10% when breadth is oversold (divergence), boost 3% when overbought (confirmation), extra 15% dampening below 20% breadth
- FOMC adjustments: compress scores 15% toward neutral during pre-FOMC window, boost entry threshold by +0.05, optionally block entries on FOMC day
- Enabled via `enableMarketBreadth` and `enableFOMC` config flags in BacktestConfig

Each layer produces a normalized score (0-1). These are combined into a composite conviction score.

#### Portfolio Correlation Analysis

The `CorrelationAnalyzer` (`src/analysis/correlation.ts`) calculates Pearson correlation coefficients between daily returns of stocks:

- **Pre-trade check**: Before any BUY order, the correlation between the new stock and all existing positions is computed. If correlation exceeds `risk.maxCorrelation` (default: 0.85), a warning is logged to the audit log.
- **Full matrix**: The `GET /api/correlation` endpoint returns the full N x N correlation matrix for all held positions, used by the Analytics dashboard page.
- **Lookback**: Configurable via `risk.correlationLookbackDays` (default: 30 days of daily returns from the price cache).

### 4. Decision Engine

The `DecisionEngine` (`src/analysis/decision-engine.ts`) is a deterministic, zero-cost decision system that receives a `DecisionContext` containing:

- Current price and 25+ indicator values
- Fundamental metrics (P/E, margins, growth, debt)
- Recent news headlines with sentiment
- Historical signal context (last 5 decisions)
- Active positions and portfolio state
- Market context (SPY price/trend, VIX level)
- Risk parameters and constraints
- Market regime (bull/bear/sideways/volatile)

It applies a 4-strategy consensus with regime weighting:

| Strategy | Signals | Weight (bull/bear/sideways) |
|----------|---------|---------------------------|
| Mean Reversion | RSI, Stochastic, Williams %R, CCI, Bollinger, MFI | 15% / 25% / 30% |
| Trend Following | EMA alignment, ADX, MACD, SMA50/200 | 35% / 20% / 25% |
| Momentum | ROC, volume ratio, MFI | 30% / 25% / 20% |
| Breakout | Price vs support/resistance, volume, ADX | 20% / 30% / 25% |

Returns a `TradeDecision` with decision (BUY/SELL/HOLD), conviction score, reasoning, risks, suggested stop-loss/take-profit (ATR-based), and position sizing.

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

All data is persisted in a SQLite database via Drizzle ORM. 23 tables total.

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
| intendedPrice | REAL | Intended fill price |
| slippage | REAL | Slippage amount |
| dcaRound | INTEGER | DCA round number |
| journalNotes | TEXT | Inline journal notes |
| journalTags | TEXT | JSON array of tags |
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
| takeProfitOrderId | TEXT | Trading212 take-profit order ID |
| aiExitConditions | TEXT | AI-specified exit criteria |
| dcaCount | INTEGER | DCA round count (default 0) |
| totalInvested | REAL | Total invested amount |
| partialExitCount | INTEGER | Partial exit count (default 0) |
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
| sortinoRatio | REAL | Rolling Sortino ratio |
| calmarRatio | REAL | Calmar ratio |
| sqn | REAL | System Quality Number |
| expectancy | REAL | Trade expectancy |
| avgWin | REAL | Average winning trade |
| avgLoss | REAL | Average losing trade |
| currentDrawdown | REAL | Current drawdown level |
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

### `orders`

Order tracking and lifecycle management. Tracks each exchange order with full status history. Indexed on `(tradeId)`, `(positionId)`, and `(status, symbol)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| tradeId | INTEGER | FK to trades.id (null if trade not yet created) |
| positionId | INTEGER | FK to positions.id |
| symbol | TEXT | Stock symbol |
| side | TEXT | BUY, SELL |
| orderType | TEXT | market, limit, stop |
| status | TEXT | pending, open, filled, partially_filled, cancelled, expired, failed |
| requestedQuantity | REAL | Shares requested |
| filledQuantity | REAL | Shares filled (default: 0) |
| requestedPrice | REAL | Limit price (null for market orders) |
| filledPrice | REAL | Average fill price |
| stopPrice | REAL | Trigger price for stop orders |
| t212OrderId | TEXT | Trading212 exchange order ID |
| cancelReason | TEXT | Why order was cancelled |
| orderTag | TEXT | entry, exit, dca, stoploss, take_profit, partial_exit |
| replacedByOrderId | INTEGER | FK to orders.id (order replacement chain) |
| accountType | TEXT | INVEST, ISA |
| createdAt | TEXT | Order creation timestamp |
| updatedAt | TEXT | Last update timestamp |
| filledAt | TEXT | Fill completion timestamp |

### `conditional_orders`

Conditional order system for OCO, price triggers, and advanced order types. Indexed on `(status, symbol)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| symbol | TEXT | Stock symbol |
| triggerType | TEXT | price_above, price_below, time, indicator |
| triggerCondition | TEXT | JSON trigger condition |
| action | TEXT | JSON action: { type, shares, price?, ... } |
| status | TEXT | pending, triggered, executed, cancelled, expired |
| linkedOrderId | INTEGER | For OCO: the other order's id |
| ocoGroupId | TEXT | OCO group identifier |
| expiresAt | TEXT | Order expiration timestamp |
| createdAt | TEXT | Creation timestamp |
| triggeredAt | TEXT | Trigger execution timestamp |

### `pair_locks`

Pair locking system to prevent conflicting trades. Supports per-symbol and global locks. Indexed on `(symbol, active, lockEnd)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| symbol | TEXT | Stock symbol ('*' for global lock) |
| lockEnd | TEXT | ISO timestamp when lock expires |
| reason | TEXT | cooldown, stoploss_guard, max_drawdown, low_profit |
| side | TEXT | long, short, * (all sides) |
| active | BOOLEAN | Lock is currently active |
| createdAt | TEXT | Lock creation timestamp |

### `trade_journal`

Trade journal entries with notes and tags. Supports post-trade analysis and pattern identification. Indexed on `(symbol, createdAt)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| tradeId | INTEGER | FK to trades.id |
| positionId | INTEGER | FK to positions.id |
| symbol | TEXT | Stock symbol |
| note | TEXT | Journal entry text |
| tags | TEXT | JSON array of tags |
| createdAt | TEXT | Entry timestamp |

### `tax_lots`

Tax lot tracking for cost basis and wash sale detection. Supports FIFO/LIFO/HIFO accounting. Indexed on `(symbol, saleDate)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| symbol | TEXT | Stock symbol |
| shares | REAL | Number of shares |
| costBasis | REAL | Cost basis per share |
| purchaseDate | TEXT | Purchase timestamp |
| saleDate | TEXT | Sale timestamp (null if still held) |
| salePrice | REAL | Sale price per share |
| pnl | REAL | Realized P&L |
| holdingPeriod | TEXT | short (<1 year), long (≥1 year) |
| accountType | TEXT | INVEST, ISA |
| createdAt | TEXT | Lot creation timestamp |

### `webhook_configs`

Webhook configuration for external integrations (Discord, Slack, custom endpoints).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| name | TEXT | Webhook name |
| url | TEXT | Webhook URL |
| secret | TEXT | Webhook secret for signing |
| direction | TEXT | inbound, outbound |
| eventTypes | TEXT | JSON array of event types to trigger |
| active | BOOLEAN | Webhook is active |
| createdAt | TEXT | Configuration timestamp |

### `webhook_logs`

Webhook invocation history and debugging. Indexed on `(createdAt)`.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| webhookId | INTEGER | FK to webhook_configs.id |
| direction | TEXT | inbound, outbound |
| eventType | TEXT | Event type that triggered webhook |
| payload | TEXT | JSON payload sent/received |
| statusCode | INTEGER | HTTP status code |
| response | TEXT | Response from webhook |
| createdAt | TEXT | Invocation timestamp |

### `strategy_profiles`

Pre-configured strategy profile sets (conservative, balanced, aggressive, scalper, swing).

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Auto-increment primary key |
| name | TEXT | Profile name (unique) |
| description | TEXT | Profile description |
| config | TEXT | JSON object of config overrides |
| active | BOOLEAN | Profile is currently active |
| createdAt | TEXT | Profile creation timestamp |
| updatedAt | TEXT | Last update timestamp |

## Config System

All runtime configuration lives in the `config` table. The `ConfigManager` class:

1. Seeds defaults from `src/config/defaults.ts` on first run
2. Caches values in memory with typed getters (`getString`, `getNumber`, `getBoolean`, `getJSON`)
3. Writes changes back to the DB immediately
4. Exposes a REST API for the dashboard to read/write config
5. Emits WebSocket events on changes so the dashboard updates in real-time

Config categories: `trading212`, `pairlist`, `dataSources`, `analysis`, `ai`, `risk`, `execution`, `monitoring`.

Secrets (API keys, tokens) are **never** stored in the DB -- they remain in `.env` only.

## Environment Variables

All secrets and deployment-specific configuration are managed via `.env` file (never committed to git). Copy `.env.example` to `.env` and configure:

### Trading212 API

| Variable | Required | Description |
|----------|----------|-------------|
| `TRADING212_API_KEY` | **Yes** | Your Trading212 API key (demo or live). Get from Settings → API in Trading212 app |
| `T212_ENVIRONMENT` | No | `demo` (default) or `live`. Controls which Trading212 environment to use |
| `T212_ACCOUNT_TYPE` | No | `INVEST` (default) or `ISA`. Which account type to trade in |

### API Security

| Variable | Required | Description |
|----------|----------|-------------|
| `API_SECRET_KEY` | **Recommended** | Bearer token for REST API authentication. Required in production (`NODE_ENV=production`). Disabled if empty |
| `CORS_ORIGINS` | No | Comma-separated allowed origins. Default: `http://localhost:3000` |

### Data Sources

| Variable | Required | Description |
|----------|----------|-------------|
| `FINNHUB_API_KEY` | **Yes** | Finnhub API key(s). Supports comma-separated multiple keys for rotation (e.g., `key1,key2,key3`). Free tier: 60 calls/min |
| `MARKETAUX_API_TOKEN` | **Yes** | Marketaux API token(s). Supports comma-separated multiple tokens for rotation. Free tier: 100 calls/day |

### Telegram (Optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token from @BotFather. Enables Telegram notifications and commands |
| `TELEGRAM_CHAT_ID` | No | Your Telegram chat ID. Get by messaging bot and checking bot logs |

### Additional Data Sources (Optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `STEER_URL` | No | Steer headless browser URL for web research (default: `http://localhost:3010`) |

### Example .env File

```env
# Trading212
TRADING212_API_KEY=your_demo_key_here
T212_ENVIRONMENT=demo
T212_ACCOUNT_TYPE=INVEST

# API Security
API_SECRET_KEY=your_strong_random_key_here
CORS_ORIGINS=http://localhost:3000,http://your-vps-ip:3000

# Data Sources
FINNHUB_API_KEY=key1,key2,key3
MARKETAUX_API_TOKEN=token1,token2

# Telegram (optional)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=123456789
```

## Scheduler Jobs

The bot runs 11 scheduled jobs via node-cron:

| Job | Schedule | Market Hours Only | Description |
|-----|----------|-------------------|-------------|
| `pairlistRefresh` | Every N min (default: 30) | Yes | Refresh stock pairlist |
| `analysisLoop` | Every N min (default: 15) | Yes | Full analysis + decision engine on each stock |
| `positionMonitor` | Every N min (default: 5) | Yes | Update positions, trailing stops |
| `t212Sync` | Every N min (default: 10) | Yes | Sync positions with T212 API |
| `dailySummary` | Configurable time (default: 16:30 ET) | No | Daily Telegram summary |
| `preMarketAlert` | Configurable time (default: 09:00 ET) | No | Pre-market Telegram alert |
| `weeklyReport` | Fridays 5 PM ET | No | Weekly performance report |
| `offHoursNews` | Every N min (default: 60) | No | 24/7 news monitoring |
| `positionReEval` | Every N min (default: 30) | Yes | Decision engine re-evaluation of positions |
| `expirePlans` | Every 5 min | No | Expire old pending trade plans |
| `conditionalOrders` | Configurable interval | Yes | Monitor and trigger conditional orders |

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

## REST API Endpoints

The Express server exposes 55+ REST endpoints at `:3001/api/*`. All endpoints except `/api/status` require Bearer token authentication via `API_SECRET_KEY` env var.

### Status & Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Bot status, uptime, market status, environment, account type |
| GET | `/api/health` | Health check with API latency, error rates, queue depths |

### Portfolio & Positions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/portfolio` | Positions + cash + total value + P&L |
| GET | `/api/positions/:symbol/orders` | All orders for a specific position |

### Trades & Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trades` | Trade history with filters (symbol, from, to, side, limit, offset) |
| GET | `/api/trades/:id` | Single trade detail with full context |
| GET | `/api/orders` | List all orders with status filtering |
| GET | `/api/orders/:id` | Single order detail with lifecycle history |

### Signals & Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/signals` | Signal history with filters (symbol, from, to, limit, offset) |
| GET | `/api/signals/:symbol/latest` | Latest signal for a symbol with full indicator values |
| GET | `/api/signals/:symbol/history` | Signal history timeline for a symbol |
| GET | `/api/stock/:symbol` | Stock detail (latest signal + fundamentals + position) |

### Performance & Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/performance` | Aggregate metrics (win rate, Sharpe, Sortino, Calmar, max drawdown) |
| GET | `/api/performance/daily` | Daily performance metrics time series |
| GET | `/api/attribution` | Performance attribution (alpha, beta, sector contributions, factor exposures) |
| GET | `/regime` | Current market regime (bull/bear/sideways) with confidence scores |

### Pairlist

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pairlist` | Current pairlist with filter stats |
| GET | `/api/pairlist/history` | Pairlist snapshot history |
| POST | `/api/pairlist/static` | Add symbol to static pairlist (body: `{ symbol }`) |
| DELETE | `/api/pairlist/static/:symbol` | Remove symbol from static pairlist |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/config` | All config grouped by category |
| GET | `/api/config/:category` | Config for specific category (e.g., `risk`, `execution`) |
| PUT | `/api/config/:key` | Update config value (Zod validated) |

### Bot Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/control/pause` | Pause the bot (stops all trading activity) |
| POST | `/api/control/resume` | Resume the bot |
| POST | `/api/control/close/:symbol` | Close a position immediately |
| POST | `/api/control/analyze/:symbol` | Force analysis on a symbol |
| POST | `/api/control/refresh-pairlist` | Force pairlist refresh |
| POST | `/api/control/emergency-stop` | Emergency stop: close all positions + pause bot |

### Trade Plans

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/trade-plans` | List recent trade plans with approval status |
| POST | `/api/trade-plans/:id/approve` | Approve a pending trade plan |
| POST | `/api/trade-plans/:id/reject` | Reject a pending trade plan |

### AI & Research

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/research` | List AI research reports |
| POST | `/api/research/run` | Trigger manual AI research (body: `{ focus?, symbols? }`) |
| GET | `/api/model-stats` | AI model performance statistics (accuracy, win rates, avg returns) |

### Protections & Locks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/protections/locks` | List active pair locks |
| DELETE | `/api/protections/locks/:symbol` | Remove a pair lock |

### Audit & Logging

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit` | Audit log entries (query: `date`, `type`, `limit`) |
| GET | `/api/correlation` | Portfolio correlation matrix (Pearson correlation on daily returns) |

### Backtesting

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/backtest` | Run backtest (body: `{ strategy, startDate, endDate, symbols, capital, slippagePct?, spreadBps?, walkForward? }`) |

### Strategy Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/strategy-profiles` | List all strategy profiles (conservative, balanced, aggressive, scalper, swing) |
| POST | `/strategy-profiles/:name/activate` | Activate a strategy profile (applies config overrides) |

### Monte Carlo Simulation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/monte-carlo/simulate` | Run Monte Carlo portfolio simulation |

### Trade Journal

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/journal` | Get journal entries (query: `symbol`, `from`, `to`, `limit`) |
| POST | `/journal` | Create journal entry (body: `{ tradeId, notes, tags, mood, lessons }`) |
| GET | `/journal/search` | Search journal entries (query: `q`, `tags`) |
| GET | `/journal/insights` | Get journal insights and pattern analysis |

### Tax Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tax/summary` | Tax summary for a year (query: `year`) with wash sales, holding periods |
| GET | `/tax/harvest-candidates` | Tax-loss harvesting candidates with unrealized losses |

### Portfolio Optimization

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/portfolio/optimize` | Portfolio optimization suggestions (rebalancing, risk parity adjustments) |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/webhooks` | List webhook configurations |
| POST | `/webhooks` | Create webhook (body: `{ name, url, secret, eventTypes }`) |
| GET | `/webhooks/logs` | Webhook invocation history |

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

## Advanced Features

### Conditional Orders

Supports complex order types for advanced execution strategies:

- **OCO (One-Cancels-Other)**: Two linked orders where execution of one cancels the other (e.g., stop-loss + take-profit)
- **Bracket Orders**: Entry order with automatic stop-loss and take-profit orders
- **Trailing Stop**: Dynamic stop-loss that follows price at a fixed distance or percentage
- **If-Then Orders**: Conditional execution based on price triggers or indicator values

Managed via `src/execution/conditional-orders.ts` and `conditional_orders` database table.

### Dollar-Cost Averaging (DCA)

Build positions gradually over time with configurable intervals and amounts:

- Configure DCA rounds, intervals, and allocation per round
- Automatic execution at scheduled times
- Position averaging with cost basis tracking
- Supports both time-based and price-based DCA triggers

Managed via `src/execution/dca-manager.ts`.

### Partial Exit Management

Scale out of positions at multiple profit targets:

- Define multiple exit levels (e.g., 25% at +5%, 50% at +10%, 100% at +20%)
- Automatic execution as targets are reached
- Preserves runner for maximum profit potential
- Tracks partial exit history per position

Managed via `src/execution/partial-exit-manager.ts`.

### Pair Locks & Protections

Prevent conflicting trades and protect against adverse conditions:

- **Pair Locks**: Prevent trades on specific symbols for a duration
- **Cooldown Period**: Mandatory wait time after closing a position
- **Stoploss Guard**: Lock trading after N consecutive stoplosses
- **Max Drawdown Protection**: Pause trading when drawdown exceeds threshold
- **Low Profit Pairs**: Auto-lock underperforming symbols

Managed via `src/execution/pair-locks.ts` and `src/execution/protections.ts`.

### Exit Condition DSL

Custom exit logic using a simple domain-specific language:

```
rsi > 70 and macd_cross_down
or
price_below sma20 and volume > avg_volume * 2
```

Supports indicator values, price levels, volume, and logical operators. Evaluated in real-time during position monitoring.

Managed via `src/execution/exit-condition-dsl.ts`.

### Strategy Profiles

Pre-configured strategy sets for different trading styles:

- **Conservative**: Low risk, longer holds, strict stops
- **Balanced**: Moderate risk-reward, diversified approach
- **Aggressive**: Higher risk tolerance, faster exits
- **Scalper**: High-frequency, small profit targets
- **Swing**: Multi-day holds, wider stops

One-click activation applies full config overrides. Stored in `strategy_profiles` table.

Managed via `src/config/strategy-profiles.ts`.

### Tax Tracking & Optimization

Comprehensive tax lot tracking and optimization:

- **Cost Basis Tracking**: FIFO, LIFO, or HIFO accounting methods
- **Wash Sale Detection**: 30-day wash sale rule monitoring with warnings
- **Tax-Loss Harvesting**: Automatic identification of harvesting candidates
- **Holding Period Tracking**: Short-term vs. long-term capital gains classification
- **Annual Tax Reporting**: Detailed tax summaries by year

Managed via `src/monitoring/tax-tracker.ts` and `tax_lots` table.

### Trade Journal

Post-trade analysis and pattern identification:

- Add notes, tags, mood, and lessons to each trade
- Search journal entries by tags, symbols, or keywords
- Pattern analysis identifies common mistakes and successful setups
- Insights dashboard shows recurring themes
- Supports both manual entries and automated AI-generated insights

Managed via `src/monitoring/trade-journal.ts` and `trade_journal` table.

### Backtesting Engine

Full strategy backtesting with historical data:

- Historical data loading from Yahoo Finance
- Strategy execution simulation with realistic fills
- Performance reporting (Sharpe, Sortino, max drawdown, win rate)
- Walk-forward analysis support
- Market context integration (breadth + FOMC calendar) for signal-level score adjustments
- Dollar-volume universe selection with minimum price and history filters
- Comparison of multiple strategies side-by-side

Managed via `src/backtest/` directory.

### Market Regime Detection

Adaptive strategy based on market conditions:

- Identifies bull, bear, and sideways market regimes
- Uses multiple timeframe analysis and volatility measures
- Adjusts position sizing and stop-loss distances based on regime
- Historical regime tracking for pattern analysis

Managed via `src/analysis/regime-detector.ts`.

### Performance Attribution

Detailed breakdown of returns and risk factors:

- **Alpha**: Excess returns above benchmark (SPY)
- **Beta**: Portfolio correlation with market
- **Sector Contributions**: Returns attributed to each sector
- **Factor Exposures**: Value, growth, momentum, quality factors
- **Trade Attribution**: Performance breakdown by individual trades

Managed via `src/monitoring/attribution.ts`.

### Monte Carlo Simulation

Portfolio risk analysis through simulation:

- Runs thousands of portfolio simulations
- Probability distributions for returns and drawdown
- Value-at-Risk (VaR) and Conditional VaR (CVaR) calculations
- Stress testing against historical scenarios
- Confidence intervals for performance projections

Managed via `src/analysis/monte-carlo.ts`.

### Risk Parity Position Sizing

Equal risk contribution across portfolio:

- Calculates position sizes to equalize volatility contribution
- Rebalancing recommendations when risk becomes unbalanced
- Accounts for correlation between positions
- Dynamic adjustment based on market volatility

Managed via `src/execution/risk-parity.ts`.

### Social Sentiment Analysis

Aggregate sentiment from social media:

- **Reddit**: Wallstreetbets, investing, stocks subreddits
- **Twitter/X**: Real-time sentiment tracking
- **StockTwits**: Trader sentiment and volume spikes
- Sentiment scoring (-100 to +100) integrated into AI decision engine
- Historical sentiment tracking for pattern analysis

Managed via `src/data/social-sentiment.ts`.

### Web Research Integration

Fundamental data scraping via Steer headless browser:

- Scrapes Finviz for analyst targets, PEG ratio, short interest, institutional ownership
- Scrapes StockAnalysis.com for additional fundamental metrics
- Results cached with configurable TTL (`webResearch.cacheTtlHours`)
- Data fed into AI prompts as supplemental fundamental context
- Requires a running Steer instance at `STEER_URL` (optional, gracefully degrades)

Managed via `src/data/web-researcher.ts`.

### Webhooks

External integrations for notifications and automation:

- **Discord**: Trade alerts, daily summaries
- **Slack**: Team notifications, bot status
- **Custom Endpoints**: HTTP POST webhooks for any event
- Event filtering and payload customization
- Retry logic with exponential backoff
- Full invocation history in `webhook_logs` table

Managed via `src/api/webhooks.ts`.

## Source Structure

```
src/
+-- index.ts                  # Entry point, TradingBot class, all core loops
+-- config/
|   +-- defaults.ts           # Default config values
|   +-- manager.ts            # ConfigManager (DB-backed, live-updatable)
+-- db/
|   +-- index.ts              # Database connection
|   +-- schema.ts             # Drizzle schema (23 tables)
|   +-- repositories/
|       +-- config.ts         # Config data access
|       +-- positions.ts      # Positions data access
|       +-- trades.ts         # Trades data access
|       +-- signals.ts        # Signals data access
|       +-- cache.ts          # Cache data access
|       +-- metrics.ts        # Metrics data access
+-- pairlist/
|   +-- index.ts              # Pairlist module entry
|   +-- pipeline.ts           # Filter pipeline runner + enrichStocks()
|   +-- filters.ts            # Volume, Price, MarketCap, Volatility, Blacklist, Sector, Performance, MaxPairs
+-- data/
|   +-- data-aggregator.ts    # Orchestrates all data sources
|   +-- yahoo-finance.ts      # Yahoo Finance adapter
|   +-- finnhub.ts            # Finnhub adapter
|   +-- marketaux.ts          # Marketaux adapter
|   +-- ticker-mapper.ts      # Symbol <-> T212 ticker mapping
+-- execution/
|   +-- order-manager.ts      # Order placement + dry-run sim (with paper trading slippage)
|   +-- risk-guard.ts         # Pre-trade risk validation
|   +-- trade-planner.ts      # Trade plan creation and management
|   +-- approval-manager.ts   # Auto/manual trade approval flow
|   +-- position-tracker.ts   # Position monitoring, trailing stops, exit DSL
|   +-- partial-exit-manager.ts  # Partial position exits (scale out)
|   +-- conditional-orders.ts # OCO, Bracket, Trailing, If-Then orders
|   +-- dca-manager.ts        # Dollar-cost averaging
|   +-- pair-locks.ts         # Pair locking
|   +-- protections.ts        # Trading protections
|   +-- atr-stoploss.ts       # ATR-based stop-loss
|   +-- exit-condition-dsl.ts # Exit condition DSL parser + evaluator
|   +-- risk-parity.ts        # Risk parity position sizing
|   +-- roi-table.ts          # Time-based ROI targets
+-- analysis/
|   +-- decision-engine.ts    # Deterministic 4-strategy consensus decision engine
|   +-- analyzer.ts           # Analysis orchestrator
|   +-- correlation.ts        # Pearson correlation analyzer
|   +-- multi-timeframe.ts    # Weekly/monthly confluence scoring
|   +-- regime-detector.ts    # Bull/bear/sideways market regime
|   +-- market-breadth.ts    # Market breadth (% above SMA50/SMA200)
|   +-- sector-rotation.ts   # Sector rotation analysis
|   +-- monte-carlo.ts        # Monte Carlo portfolio simulation
|   +-- portfolio-optimizer.ts # Min-variance/max-Sharpe optimization
|   +-- technical/
|   |   +-- indicators.ts     # 25+ indicator calculations
|   |   +-- scorer.ts         # Technical score computation (configurable weights)
|   +-- fundamental/
|   |   +-- scorer.ts         # Fundamental score computation (configurable weights)
|   +-- sentiment/
|       +-- scorer.ts         # Sentiment score computation (configurable weights)
+-- monitoring/
|   +-- telegram.ts           # Telegram notifications + commands
|   +-- performance.ts        # Performance tracking + summaries
|   +-- audit-log.ts          # Audit log (session replay)
|   +-- attribution.ts        # Performance attribution (alpha, beta, factors)
|   +-- trade-journal.ts      # Trade journal with tags and notes
|   +-- tax-tracker.ts        # Tax lot tracking + wash sale detection
|   +-- report-generator.ts   # Scheduled reports (daily/weekly)
|   +-- health-metrics.ts     # System health monitoring
+-- data/
|   +-- data-aggregator.ts    # Orchestrates all data sources
|   +-- yahoo-finance.ts      # Yahoo Finance adapter
|   +-- finnhub.ts            # Finnhub adapter
|   +-- marketaux.ts          # Marketaux adapter
|   +-- ticker-mapper.ts      # Symbol <-> T212 ticker mapping
|   +-- social-sentiment.ts   # Social media sentiment aggregation
|   +-- steer-client.ts       # Steer headless browser client
|   +-- web-researcher.ts     # Web research via Steer
|   +-- price-streamer.ts     # Real-time price streaming
|   +-- fred.ts              # FRED economic data client
+-- api/
|   +-- server.ts             # Express REST API server
|   +-- routes.ts             # All REST endpoint definitions
|   +-- websocket.ts          # WebSocket server
|   +-- webhooks.ts           # Webhook system (Discord, Slack, custom)
|   +-- middleware/auth.ts     # Bearer token auth middleware
|   +-- trading212/
|       +-- client.ts         # Trading212 API client
|       +-- types.ts          # T212 type definitions
|       +-- errors.ts         # T212 error handling
+-- backtest/
|   +-- engine.ts             # Backtest engine (slippage/spread, market context)
|   +-- data-loader.ts        # Historical data loader (cacheOnly, date filtering)
|   +-- reporter.ts           # Backtest reporting + profitability gates
|   +-- types.ts              # Backtest types (MarketContext, BacktestConfig)
|   +-- walk-forward.ts       # Walk-forward out-of-sample validation
+-- config/
|   +-- defaults.ts           # Default config values
|   +-- manager.ts            # ConfigManager (DB-backed, live-updatable)
|   +-- schema-validator.ts   # Runtime config validation (Zod)
|   +-- strategy-profiles.ts  # Pre-configured strategy profiles
+-- utils/
|   +-- logger.ts             # Pino logger factory
|   +-- helpers.ts            # Shared utilities
|   +-- market-hours.ts       # US market hours logic
|   +-- holidays.ts           # NYSE holiday calendar (2024-2028)
|   +-- key-rotator.ts        # API key rotation
|   +-- circuit-breaker.ts    # Circuit breaker for external APIs
|   +-- error-handlers.ts     # Global error handlers
|   +-- fomc-calendar.ts     # FOMC meeting calendar (2024-2028)
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
