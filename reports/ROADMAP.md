# Trader212 Bot — Implementation Plan

**Updated:** 2026-02-15
**Sources:** Claude analysis, Freqtrade feature comparison, production roadmap review

Items marked [DONE] are already implemented and tested.

---

## Phase 1: Critical Safety (Week 1-2)

### Execution Safety
- [DONE] Add UNIQUE constraint on `positions.symbol` in schema.ts + index.ts raw SQL
- [DONE] Scheduler job mutex — skip-if-running to prevent overlapping analysis loops
- [DONE] `process.on('unhandledRejection')` handler with alerting
- [DONE] Fail startup if `NODE_ENV=production` and `API_SECRET_KEY` is empty
- [ ] Data quality gate — minimum indicator threshold before AI analysis proceeds
- [ ] Wrap trade execution in saga/compensation pattern (rollback on partial failure)

### Config & Validation
- [DONE] Config schema validation — Zod schemas per config key, validate on set()

---

## Phase 2: Performance & Execution Hardening (Week 3-4)

### Analysis Pipeline
- [DONE] Parallelize analysis loop with `p-limit(5)` bounded concurrency
- [DONE] Pre-fetch shared context (portfolio cash, market data, SPY/VIX) once per cycle
- [ ] Batch DB queries in `buildAIContext()` — pre-load all positions, signals, fundamentals

### Trading Quality
- [DONE] ATR-based dynamic stop-loss (instead of fixed percentage)

### Monitoring
- [DONE] Health metrics endpoint — job durations, data source health, system metrics
- [DONE] Real-time price streaming — high-frequency polling for held positions
- [DONE] Exit condition DSL — structured, evaluatable exit conditions replacing text

---

## Phase 3: Protections & Risk (Week 5-6)

_Inspired by Freqtrade's battle-tested protection system. These prevent catastrophic losses during adverse conditions._

### Protections System
- [DONE] **StoplossGuard** — stop trading a pair (or globally) after N consecutive stoploss hits in a lookback window. Configurable: `lookbackCandles`, `tradeLimit`, `stopDurationCandles`, `onlyPerPair`
- [DONE] **CooldownPeriod** — prevent re-entry on a pair for N candles after exit. Avoids whipsaw re-entries
- [DONE] **LowProfitPairs** — auto-lock pairs where recent trades average below a profit threshold. Per-pair rolling window
- [DONE] **MaxDrawdown protection** — enhanced version: track realized+unrealized drawdown over a rolling window, pause trading when exceeded, wait for recovery period before resuming

### Advanced Stoploss
- [ ] **Stepped profit-locking stoploss** — e.g. at +20% profit lock +7%, at +25% lock +15%, at +40% lock +25%. Configurable tiers array in trade plan
- [ ] **Trailing stop with positive offset** — only start trailing after reaching a profit threshold (e.g. trail at -2% only after +3% reached). Prevents premature trailing activation
- [ ] **Time-based stoploss tightening** — wider stops for new positions (allow setup to develop), progressively tighter as hold duration increases

### Pairlist Filters
- [DONE] **PerformanceFilter** — sort/remove pairs by recent trading performance (rolling window). Self-healing pairlist that drops consistently losing symbols
- [ ] **SpreadFilter** — remove pairs where bid-ask spread exceeds threshold. Prevents slippage on illiquid stocks
- [ ] **AgeFilter** — skip newly listed stocks (min days listed). Avoid IPO price discovery volatility

---

## Phase 4: Infrastructure (Week 7-10)

### External API Resilience
- [DONE] **Circuit breaker** for each external API (Yahoo, Finnhub, Marketaux, T212). Open after N failures, half-open after timeout, auto-close on recovery. Failover to cached/stale data with warning
- [ ] **Dead letter queue** for failed trades — retry 3x with exponential backoff, then queue for manual review
- [ ] Order idempotency keys to prevent duplicate placement

### Database

### API & Security

---

## Phase 5: Trading Strategy (Week 11-14)

### Risk Management
- [ ] Graduated daily loss response (50% size at 1x, 75% at 1.5x, stop at 2x)
- [ ] 60-day rolling correlation with 5-day short-term overlay
- [ ] Dynamic position sizing via Kelly Criterion (using Monte Carlo, already in codebase)
- [ ] VIX-based portfolio heat reduction (scale down all positions in elevated VIX)
- [ ] Guarantee sector data population in risk guard checks

### Edge Positioning (from Freqtrade)
- [ ] **Win rate calculator** — per-pair historical win rate by stoploss level from trade history
- [ ] **Expectancy filter** — only enter trades with positive expectancy based on historical data
- [ ] **Data-driven position sizing** — `size = (account * allowedRisk) / stopDistance`, sized by actual edge

### Execution Quality
- [ ] Smart limit orders — place at mid-price, escalate aggression over time
- [ ] Position monitor adaptive frequency (5s in high-vol, 60s in calm markets)
- [ ] Approval timeout repricing — auto-reprice stale plans instead of rejecting

### Signal Quality
- [ ] Regime-aware technical scoring — weight shift by market regime (regime detector already exists)
- [ ] Multi-timeframe confirmation gate (daily trend must confirm intraday signal, multi-timeframe analyzer already exists)

---

## Phase 6: Architecture (Month 4-5)

### Orchestration Refactoring
- [ ] Split `src/index.ts` (2000+ lines) into smaller service modules
- [ ] Integration tests for startup, scheduler jobs, and control callbacks
- [ ] Circuit breaker pattern for external API dependencies

### Broker Abstraction
- [ ] Define `IBroker` interface: `placeOrder()`, `getPositions()`, `getAccountInfo()`, `cancelOrder()`
- [ ] Refactor T212 client as first `IBroker` implementation
- [ ] Broker-specific order type mapping (market, limit, stop-limit)

### Backtesting Framework
- [ ] Integrate backtesting engine with live data pipeline
- [ ] Walk-forward analysis capability
- [ ] Paper trading environment for strategy validation
- [ ] Compare backtest results vs actual fills (slippage analysis)

---

## Quick Reference

| Phase | Focus | Items | Timeline |
|-------|-------|-------|----------|
| 1 | Critical Safety | 7 | Week 1-2 |
| 2 | Performance | 8 | Week 3-4 |
| 3 | Protections & Risk | 10 | Week 5-6 |
| 4 | Infrastructure | 11 | Week 7-10 |
| 5 | Trading Strategy | 11 | Week 11-14 |
| 6 | Architecture | 8 | Month 4-5 |
| **Total** | | **55** | |

---

## Success Metrics

- Zero unauthenticated access in production
- No overlapping scheduler job runs
- Analysis cycle < 60 seconds for 50-stock pairlist
- p95 API response time < 200ms for analytics endpoints
- AI cost < $200/month at 50-stock scale
- Zero duplicate positions from race conditions
- Daily automated backup with < 1 hour RTO
- 95%+ test coverage on execution layer
- No trading after 4 consecutive stoploss hits (StoplossGuard active)
- Positive expectancy verified before every entry (Edge Positioning active)
