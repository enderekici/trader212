# Implementation Plan — trader212 improvements
> Single source of truth for all agents and future sessions.
> Update status markers as work completes.

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Done

---

## Phase 1 — Data Layer

### 1A — Yahoo Finance fixes & extra fields [x]
File: `src/data/yahoo-finance.ts`

Bugs to fix:
- P/E: use `result.summaryDetail?.trailingPE` instead of `currentPrice / trailingEPS`
- marketCap: use `result.summaryDetail?.marketCap ?? result.price?.marketCap` (not enterpriseValue)

New fields to extract (already in quoteSummary response, zero extra calls):
Add to `FundamentalData` interface and populate:
```ts
analystTargetPrice: number | null      // financialData.targetMeanPrice
analystConsensus: string | null        // financialData.recommendationKey  ("buy","hold","sell",etc)
analystCount: number | null            // financialData.numberOfAnalystOpinions
shortInterestPct: number | null        // defaultKeyStatistics.shortPercentOfFloat (multiply by 100)
institutionalOwnershipPct: number | null // defaultKeyStatistics.heldPercentInstitutions * 100
pegRatio: number | null                // defaultKeyStatistics.pegRatio
epsEstimateNextQ: number | null        // earningsHistory.history[last].epsEstimate (next quarter)
revenueGrowthYoY: number | null        // financialData.revenueGrowth (already fetched, keep)
roe: number | null                     // financialData.returnOnEquity * 100
roa: number | null                     // financialData.returnOnAssets * 100
freeCashflow: number | null            // financialData.freeCashflow
```

Also add `recommendationTrend` to modules list and extract:
```ts
analystBuy: number | null              // recommendationTrend.trend[0].strongBuy + buy
analystSell: number | null             // recommendationTrend.trend[0].strongSell + sell
```

New method `getIntradayCandles(symbol, intervalMinutes=5, hours=6.5)`:
- Use axios to `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`
  with params `interval=5m`, `range=1d`, `includePrePost=false`
- Return `OHLCVCandle[]` (same interface, date = ISO string)
- Used by VWAP fix in indicators.ts

Test file: `test/unit/yahoo-finance.test.ts` — update existing tests, add new field tests

---

### 1B — FINRA short volume data source [x]
New file: `src/data/finra.ts`

```ts
export interface FinraShortData {
  symbol: string;
  shortVolume: number;
  totalVolume: number;
  shortVolumePct: number  // shortVolume/totalVolume * 100
  date: string            // YYYY-MM-DD
  fetchedAt: string
}

export class FinraClient {
  // Download https://cdn.finra.org/equity/regsho/daily/CNMSshvol{YYYYMMDD}.txt
  // pipe-delimited: Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market
  // Aggregate rows by symbol (multiple markets), cache in memory keyed by date string
  // getShortData(symbols: string[]): Promise<Map<string, FinraShortData>>
  // - try today first, if empty (pre-market) try yesterday
  // - graceful degradation: return empty Map on any error
  async getShortData(symbols: string[]): Promise<Map<string, FinraShortData>>
}
```

Test file: `test/unit/finra.test.ts` (new) — mock axios, test parsing, graceful degradation

---

### 1C — StockTwits client [x]
New file: `src/data/stocktwits.ts`

```ts
export interface StockTwitsData {
  symbol: string
  bullishCount: number
  bearishCount: number
  totalMessages: number
  watchlistCount: number
  sentimentRatio: number   // bullish/(bullish+bearish), 0-1, null if no tagged msgs
  fetchedAt: string
}

export class StockTwitsClient {
  // GET https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json
  // No auth needed for public stream (30 msgs returned)
  // Count messages where entities.sentiment.basic == "Bullish" or "Bearish"
  // watchlistCount from symbol.watchlist_count
  // Graceful: return null on any error (rate-limited, symbol not found, etc.)
  async getSymbolData(symbol: string): Promise<StockTwitsData | null>
  async getBatch(symbols: string[]): Promise<Map<string, StockTwitsData>>
  // getBatch: sequential with 200ms delay between requests to avoid rate-limit
}
```

Test file: `test/unit/stocktwits.test.ts` (new) — mock fetch, test parsing, null on error

---

### 1D/E — Intraday VWAP fix + performance metrics [x]
File: `src/analysis/technical/indicators.ts`

VWAP fix:
- `computeVWAP(candles)` currently uses daily candles → wrong
- Add optional `intradayCandles?: OHLCVCandle[]` param to `computeAllIndicators()`
- If provided and has ≥ 5 bars, use those for VWAP; else fallback to last daily candle typical price

Performance metrics (replace Steer):
- Add to indicators output (compute from existing daily candles array):
```ts
perfWeek: number | null    // (close[-1] - close[-6]) / close[-6] * 100  (5 trading days back)
perfMonth: number | null   // (close[-1] - close[-22]) / close[-22] * 100
perfQuarter: number | null // (close[-1] - close[-66]) / close[-66] * 100
perfYear: number | null    // (close[-1] - close[-253]) / close[-253] * 100
relativeVolume: number | null  // today volume / avg(volume[-20:]) 
```

---

### 1F — Data layer bug fixes [x]

**Finnhub shared rate limiter** (`src/data/finnhub.ts`):
- Move `callTimestamps: number[]` to module-level (outside class)
- All FinnhubClient instances share the same array
- This prevents two instances from each making 60/min = 120/min total

**Marketaux budget persistence** (`src/data/marketaux.ts`):
- Replace `callsToday` + `budgetResetDate` in-memory vars with DB persistence
- On init: read from `config` table key `_internal.marketaux.callsToday` and `_internal.marketaux.budgetDate`
- On each call: increment and write back via `configManager.set()`
- On date change: reset to 0 and update date key
- Import configManager (already available)

**SQLite fundamental cache wiring** (`src/db/repositories/cache.ts` + `src/data/data-aggregator.ts`):
- `fundamentalCache` table already exists in schema.ts
- Check `cache.ts` — confirm `getFundamentals(symbol)` / `setFundamentals(symbol, data, ttlHours)` exist
- In `data-aggregator.ts`, before calling `yahooClient.getFundamentals()`, check cache; after fetching, write cache
- Cache TTL: 24h for fundamentals

**Marketaux relevance filtering** (`src/data/marketaux.ts`):
- In `getNews()`, after receiving articles, filter: `relevanceScore >= 0.3` (or configurable threshold)
- Articles with null relevanceScore pass through

**Marketaux in research path** (`src/data/data-aggregator.ts`):
- `getResearchData()` currently skips Marketaux. Add Marketaux news call there too.

---

### 1G — Delete Steer/web-researcher [x]
Files to DELETE:
- `src/data/steer-client.ts`
- `src/data/web-researcher.ts`

Files to update (remove all imports/references):
- `src/data/data-aggregator.ts` — remove WebResearcher, remove `webResearch` field from return type
- `src/ai/market-research.ts` — remove WebResearcher import/usage
- `src/ai/prompt-builder.ts` — remove `webResearch` section from prompt (or keep field in AIContext optional)
- `src/index.ts` — remove Steer setup code
- `src/api/routes.ts` — remove any steer/web-research references
- Test files: delete `test/unit/steer-client.test.ts`, `test/unit/web-researcher.test.ts` if they exist

Replace webResearch data in AIContext with new computed fields from Yahoo + FINRA:
```ts
// AIContext.webResearch now populated from:
// analystTargetPrice, analystConsensus, analystCount → yahoo fundamentals
// shortInterestPct, institutionalOwnershipPct, pegRatio → yahoo fundamentals  
// perfWeek/Month/Quarter/Year, relativeVolume → computed from candles (Phase 1D)
// epsEstimateNextQ → yahoo fundamentals
// revenueEstimateNextQ → yahooFundamentals.financialData.revenueEstimate (if available)
```

---

### 1H — PriceStreamer → WebSocket forwarding [x]
File: `src/api/websocket.ts` + `src/index.ts`

In `src/index.ts` where PriceStreamer is set up (look for `priceStreamer.start()`):
```ts
priceStreamer.on('price_update', (update) => {
  wsManager.broadcast('price_update', update)
})
```

Confirm `wsManager.broadcast('price_update', ...)` matches the `price_update` event type in `websocket.ts`.

---

## Phase 2 — AI Provider Redesign

### 2A — ModelProfile type + unified adapter [x]

New interface in `src/ai/adapters/openai-compat.ts` (expand it):
```ts
export interface ModelProfile {
  id: string           // unique name, e.g. "claude-primary"
  baseUrl: string      // e.g. "https://api.anthropic.com/v1"
  model: string        // e.g. "claude-opus-4-5"
  apiKey: string       // DB-stored or env fallback
  weight: number       // 1-10, used by consensus weighted voting
  enabled: boolean
  timeoutSeconds?: number
}
```

Adapter changes:
- `OpenAICompatibleAdapter` constructor now accepts optional `ModelProfile`
- If profile provided: use profile.baseUrl/model/apiKey/timeout
- If no profile: fall back to current config keys (`ai.openaiCompat.*`) for backward compat
- `rawChat()` same pattern

Config keys (add to `src/config/defaults.ts`):
```
ai.models          → JSON string of ModelProfile[]  default: "[]"
ai.primaryModel    → string  default: ""  (id of primary model, empty = use legacy config)
ai.consensus.enabled → boolean  default: false
ai.consensus.mode    → string   default: "weighted"  ("majority"|"weighted"|"unanimous")
ai.consensus.minAgree → number  default: 2
```

Keep existing keys for backward compat (don't delete yet):
`ai.provider`, `ai.model`, `ai.ollama.*`, `ai.openaiCompat.*`

### 2B — ConsensusEngine [x]
New file: `src/ai/consensus.ts`

```ts
export type ConsensusMode = 'majority' | 'weighted' | 'unanimous'

export class ConsensusEngine {
  constructor(private profiles: ModelProfile[], private mode: ConsensusMode, private minAgree: number) {}
  
  async analyze(context: AIContext): Promise<AIDecision | null>
  // - call all enabled profiles in parallel (Promise.allSettled)
  // - majority: count BUY/SELL/HOLD votes; pick winner if count >= minAgree
  // - weighted: sum weights per decision; pick highest weighted sum
  // - unanimous: all must agree; else return null
  // - merge conviction: weighted average of conviction scores from agreeing models
  // - merge reasoning: concatenate with model id prefix
  // - merge risks: union of all risk arrays (dedupe)
  // - stop loss / position size / take profit: average of agreeing models
  
  async rawChat(system: string, user: string): Promise<string>
  // use first enabled profile only
}
```

Test file: `test/unit/consensus.test.ts` (new)

### 2C — Simplify agent.ts [x]
File: `src/ai/agent.ts`

New `createAIAgent()` logic:
```ts
export function createAIAgent(): AIAgent {
  const provider = configManager.get<string>('ai.provider')
  
  // New path: named model profiles
  const primaryId = configManager.get<string>('ai.primaryModel')
  const modelsJson = configManager.get<string>('ai.models')
  const models: ModelProfile[] = safeParseJson(modelsJson, [])
  
  if (configManager.get<boolean>('ai.consensus.enabled') && models.filter(m => m.enabled).length > 1) {
    const mode = configManager.get<string>('ai.consensus.mode') as ConsensusMode
    const minAgree = configManager.get<number>('ai.consensus.minAgree')
    return new ConsensusEngine(models.filter(m => m.enabled), mode, minAgree)
  }
  
  if (primaryId) {
    const profile = models.find(m => m.id === primaryId && m.enabled)
    if (profile) return new OpenAICompatibleAdapter(profile)
  }
  
  // Legacy fallback (existing behaviour)
  if (provider === 'rules') return new RulesEngine()
  if (provider === 'ollama') return new OllamaAdapter()           // keep for now
  if (provider === 'openai-compatible') return new OpenAICompatibleAdapter()
  return new AnthropicAdapter()                                    // keep for now
}
```

`getActiveModelName()`: add case for primaryId profile.

### 2D — New API endpoints [x]
Add to `src/api/routes.ts`:
```
GET  /api/ai/models         → return parsed ai.models config as JSON array
POST /api/ai/models         → save ModelProfile[] to ai.models config key
POST /api/ai/test           → body: { profileId } → run rawChat("ping","reply pong") → { ok, latencyMs, error? }
GET  /api/setup/status      → return { configured: bool } based on whether ai.models has ≥1 enabled model OR ai.provider is set to non-default
```

---

## Phase 3 — Research Page Redesign

### 3A — DB changes [x]
File: `src/db/schema.ts`

Add table:
```ts
export const researchWatchlist = sqliteTable('research_watchlist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull().unique(),
  notes: text('notes'),
  addedAt: text('added_at').notNull(),
})
```

Add column to `aiResearch`:
```ts
status: text('status').notNull().default('pending')  // 'pending'|'completed'|'rejected'|'watching'
```

Run `npm run db:generate` and `npm run db:migrate` after changes.

### 3B — market-research.ts fixes [x]
File: `src/ai/market-research.ts`

1. Remove WebResearcher import/usage
2. Fix `sectorRotation` + `keyThemes` parsing — currently requested in prompt but never parsed from response
   - In `parseResearchResponse()`, extract `sectorRotation: string[]` and `keyThemes: string[]` from JSON
   - Store in aiResearch table `insights` JSON field (or add columns — check schema)
3. Fix unused `_topCount`, `_requestedSymbols` params (remove underscore, actually use them or remove)
4. Delete dead `SymbolSnapshot` interface

### 3C — Research API endpoints [x]
Add to `src/api/routes.ts`:
```
GET    /api/research/watchlist           → list research_watchlist rows
POST   /api/research/watchlist           → body: {symbol, notes?} → add to watchlist
DELETE /api/research/watchlist/:symbol   → remove from watchlist
POST   /api/research/screen              → body: {symbols?: string[], sector?: string} → run screener using cached fundamentals from DB
                                           returns array of {symbol, peRatio, marketCap, sector, score, ...}
POST   /api/research/ideas/:id/status    → body: {status: 'watching'|'rejected'|'completed'} → update aiResearch.status
```

### 3D — Frontend research page [x]
File: `web/app/research/page.tsx` — full rewrite to 3-tab layout:

**Tab 1: Watchlist**
- List symbols from `/api/research/watchlist`  
- Add symbol input + Add button
- Per-row: symbol, notes, date added, remove button
- Click row → fetch `/api/stock/:symbol` and show mini panel (price, analyst target, score)

**Tab 2: Screener**
- Trigger POST `/api/research/screen` with optional sector filter
- Shows table: Symbol | Sector | Market Cap | P/E | Analyst Target | Score
- Sortable columns, "Add to Watchlist" button per row
- Shows "Last updated: <timestamp>" from cached data

**Tab 3: Trade Ideas** (existing `/api/research` reports, renamed)
- List AI research reports (title, symbols, created_at, status badge)  
- Status buttons: Watching / Rejected / Completed
- "Run New Research" button with optional focus/symbols input
- Market context section: sector rotation + key themes from latest report

Also update `web/lib/api.ts` and `web/lib/types.ts` with new endpoint methods and types.

---

## Phase 4 — Setup Wizard + HelpTooltips

### 4A — HelpTooltip component [x]
New file: `web/components/HelpTooltip.tsx`
```tsx
// Props: content: string, position?: 'top'|'bottom'|'left'|'right'
// Renders a small '?' circle button
// On hover/click: shows tooltip bubble with content
// Pure Tailwind, no external library
```

### 4B — Help content [x]
New file: `web/lib/help-content.ts`
~90 strings covering every config key, each page section, each dashboard widget.
Keys match config keys where applicable (e.g., `'analysis.rsi.oversold'`).

### 4C — Setup Wizard [x]
New files: `web/components/wizard/`
- `WizardContext.tsx` — React context: currentStep, goNext, goBack, formData, setField, skip
- `SetupWizard.tsx` — Modal overlay (fixed, full screen backdrop), renders active step, progress dots
- `steps/Welcome.tsx` — Welcome message, Beginner/Advanced mode toggle
- `steps/T212Connection.tsx` — API key input, "Test Connection" button hitting `/api/status`
- `steps/DryRun.tsx` — Dry run toggle explanation
- `steps/AIProvider.tsx` — Use `AIModelsEditor` component (see below)
- `steps/RiskLimits.tsx` — Max position %, daily loss limit sliders
- `steps/Pairlist.tsx` — Dynamic/static/hybrid mode picker, initial symbols input
- `steps/Notifications.tsx` — Telegram token + chat ID inputs
- `steps/StrategyProfile.tsx` — Pick from 5 profiles (conservative/balanced/aggressive/scalper/swing)
- `steps/Review.tsx` — Summary of all choices, "Launch Bot" button → POST `/api/control/resume`

Each step saves to `/api/config/:key` on "Next" click.

### 4D — AIModelsEditor component [x]
New file: `web/components/AIModelsEditor.tsx`
- Lists ModelProfile[] (fetched from `/api/ai/models`)
- Add/remove profiles
- Per-profile: id, baseUrl, model, apiKey (password input), weight slider, enabled toggle
- "Test" button per profile → POST `/api/ai/test` with profileId, shows latency or error
- Used inside wizard Step 4 AND in settings page config editor

### 4E — Wire wizard into layout [x]
File: `web/app/layout.tsx`
- On mount: fetch `/api/setup/status`
- If `configured === false`: render `<SetupWizard />`
- After wizard completes: set a localStorage key `setup_complete` so it doesn't re-show

File: `web/components/sidebar.tsx`
- Add "Setup Guide" link at bottom that re-opens wizard (clears localStorage key)

### 4F — Tooltips on all pages [x]
Add `<HelpTooltip content={HELP.keyName} />` next to:
- Every config row in settings page
- Section headers on analytics, signals, positions, pairlist, audit pages
- Dashboard widgets (P&L, positions count, etc.)

---

## Tests & CI

### Backend test coverage requirements [x]
All new/modified files need ≥90% coverage (target 100% on new files):
- `test/unit/finra.test.ts` — NEW
- `test/unit/stocktwits.test.ts` — NEW  
- `test/unit/consensus.test.ts` — NEW
- `test/unit/yahoo-finance.test.ts` — UPDATE (new fields, intraday method)
- `test/unit/finnhub.test.ts` — UPDATE (shared rate limiter)
- `test/unit/marketaux.test.ts` — UPDATE (DB persistence of budget)
- `test/unit/ai-agent.test.ts` — UPDATE (new model profile path, consensus path)
- `test/unit/ai-openai-compat.test.ts` — UPDATE (ModelProfile injection)
- `test/unit/ai-market-research.test.ts` — UPDATE (no WebResearcher, parsed fields)
- `test/unit/data-aggregator.test.ts` — UPDATE (new sources, removed steer)
- Delete: `test/unit/steer-client.test.ts`, `test/unit/web-researcher.test.ts` (if exist)
- Delete: `test/unit/ai-anthropic.test.ts`, `test/unit/ai-ollama.test.ts` (if exist, adapters kept for compat so only delete tests if adapters deleted)

### CI [x]
File: `.github/workflows/ci.yml`
- Verify Node version is 24 (not 20)
- If currently 20, change to `node-version: '24'`

---

## File Map (quick reference)

| Action | File |
|--------|------|
| MODIFY | src/data/yahoo-finance.ts |
| NEW    | src/data/finra.ts |
| NEW    | src/data/stocktwits.ts |
| MODIFY | src/data/data-aggregator.ts |
| MODIFY | src/data/finnhub.ts |
| MODIFY | src/data/marketaux.ts |
| MODIFY | src/data/social-sentiment.ts |
| MODIFY | src/data/price-streamer.ts |
| DELETE | src/data/steer-client.ts |
| DELETE | src/data/web-researcher.ts |
| MODIFY | src/analysis/technical/indicators.ts |
| MODIFY | src/ai/agent.ts |
| MODIFY | src/ai/adapters/openai-compat.ts |
| NEW    | src/ai/consensus.ts |
| MODIFY | src/ai/market-research.ts |
| MODIFY | src/ai/prompt-builder.ts |
| MODIFY | src/db/schema.ts |
| MODIFY | src/db/repositories/cache.ts |
| MODIFY | src/config/defaults.ts |
| MODIFY | src/config/schema-validator.ts |
| MODIFY | src/api/routes.ts |
| MODIFY | src/api/websocket.ts |
| MODIFY | src/index.ts |
| NEW    | web/components/HelpTooltip.tsx |
| NEW    | web/components/AIModelsEditor.tsx |
| NEW    | web/components/wizard/WizardContext.tsx |
| NEW    | web/components/wizard/SetupWizard.tsx |
| NEW    | web/components/wizard/steps/ (9 files) |
| MODIFY | web/app/layout.tsx |
| MODIFY | web/app/research/page.tsx |
| MODIFY | web/components/sidebar.tsx |
| MODIFY | web/components/config-editor.tsx |
| NEW    | web/lib/help-content.ts |
| MODIFY | web/lib/api.ts |
| MODIFY | web/lib/types.ts |

---

## Verification Commands
```bash
npm run typecheck          # must pass
npm run lint               # must pass (biome)
npm run test:coverage      # lines/functions/statements ≥90, branches ≥83
npm run build              # must pass
cd web && npm run build    # must pass
```
