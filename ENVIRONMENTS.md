# Environments Guide

Trader212 supports three operating modes to let you test safely before risking real capital.

## Overview

| Mode | Real API | Real Orders | Default |
|------|----------|-------------|---------|
| Demo + Dry-run | Demo account | Simulated | Yes |
| Demo + Live execution | Demo account | Demo orders | No |
| Live + Live execution | Live account | Real orders | No |

## Demo Mode (Default)

**Config:** `t212.environment = "demo"`

The bot connects to Trading212's demo (paper trading) environment. Your demo account has virtual funds, so even if execution is enabled, no real money is involved.

This is the default out of the box.

```
t212.environment  = "demo"
execution.dryRun  = true
```

### What works in demo mode

- Full pairlist discovery (demo has the same instruments as live)
- All data sources (Yahoo, Finnhub, Marketaux) work normally — they're not Trading212-specific
- Technical, fundamental, and sentiment analysis
- AI decision engine
- Risk guard validation
- Simulated order fills (dry-run)
- Dashboard and Telegram notifications

## Dry-Run Mode

**Config:** `execution.dryRun = true`

When dry-run is enabled, the execution engine simulates trades instead of placing real orders:

- **Buy signals**: The bot records a hypothetical entry at the current market price
- **Sell signals**: The bot records a hypothetical exit and calculates P&L
- **Stop-losses**: Monitored and triggered based on price data, but no real stop orders are placed
- **Logging**: All simulated trades are logged to the `trades` table with full detail

Dry-run works in both demo and live environments. It's useful for:

- Validating your configuration before going live
- Testing AI model performance on real market data
- Building a track record without risk

## Switching to Live

Before enabling live trading, complete this safety checklist:

### Safety Checklist

- [ ] Run in demo + dry-run for at least 2 weeks
- [ ] Review AI decision quality in the signals table
- [ ] Check AI model accuracy on the Analytics page or via `GET /api/model-stats`
- [ ] Verify risk guard limits are appropriate for your portfolio size
- [ ] Confirm stop-loss and position sizing settings
- [ ] Enable trade plan approval (`execution.requireApproval = true`) to review trades before execution
- [ ] Set up Telegram notifications so you're alerted on every trade
- [ ] Ensure your Trading212 live API key is configured
- [ ] Start with conservative limits (e.g., `risk.maxPositions = 2`, `risk.maxPositionSizePct = 0.05`)
- [ ] Familiarize yourself with the emergency stop button in the dashboard header bar
- [ ] Verify the daily loss limit (`risk.dailyLossLimitPct`) is set appropriately

### Enable live trading

1. Update `.env`:
   ```bash
   TRADING212_API_KEY=your_live_api_key_here
   ```

2. Update config (via dashboard or directly in DB):
   ```
   t212.environment       = "live"
   execution.dryRun       = false
   ```

3. Restart the bot:
   ```bash
   npm run dev
   ```

> **Warning:** Once `execution.dryRun` is `false` and `t212.environment` is `"live"`, the bot will place real orders with real money. Start with small position sizes and tight risk limits.

## Environment Variables Reference

### Secrets (`.env` only — never stored in DB)

| Variable | Required | Description |
|----------|----------|-------------|
| `TRADING212_API_KEY` | Yes | Trading212 API key (demo or live) |
| `ANTHROPIC_API_KEY` | If using Anthropic | Claude API key |
| `AI_PROVIDER` | No | AI provider override: `"anthropic"` \| `"ollama"` \| `"openai-compatible"` |
| `AI_OLLAMA_BASE_URL` | If using Ollama | Ollama server URL (default: http://localhost:11434) |
| `AI_OLLAMA_MODEL` | If using Ollama | Ollama model name (default: palmyra-fin) |
| `AI_OPENAI_COMPAT_BASE_URL` | If using OpenAI-compat | Base URL for OpenAI-compatible API |
| `AI_OPENAI_COMPAT_MODEL` | If using OpenAI-compat | Model name for OpenAI-compatible API |
| `AI_OPENAI_COMPAT_API_KEY` | If using OpenAI-compat | API key for OpenAI-compatible API |
| `FINNHUB_API_KEY` | Recommended | Finnhub.io API key (comma-separated for multiple keys) |
| `MARKETAUX_API_TOKEN` | Optional | Marketaux.com API token (comma-separated for multiple keys) |
| `TELEGRAM_BOT_TOKEN` | Optional | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Optional | Telegram chat ID |

### Server settings (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | 3001 | REST + WebSocket port |
| `NODE_ENV` | development | development or production |
| `LOG_LEVEL` | info | trace, debug, info, warn, error |
| `DB_PATH` | ./data/trader212.db | SQLite database file path |

### Runtime config (DB-backed, editable from dashboard)

All other settings are stored in the `config` database table and can be changed live without restarting. See [Architecture](ARCHITECTURE.md#config-system) for the full list.

## Data Source API Keys and Rate Limits

### Yahoo Finance

- **Key required:** No (unofficial API)
- **Rate limits:** Best-effort; the library handles throttling internally
- **Data:** OHLCV history, real-time quotes, fundamentals
- **Notes:** Most reliable data source. No signup required.

### Finnhub

- **Key required:** Yes (`FINNHUB_API_KEY`)
- **Free tier:** 60 API calls per minute
- **Data:** Real-time quotes, company news, earnings calendar, insider transactions
- **Signup:** [finnhub.io](https://finnhub.io) — free account
- **Config:** Toggle features individually via `data.finnhub.*` settings

### Marketaux

- **Key required:** Yes (`MARKETAUX_API_TOKEN`)
- **Free tier:** 100 API calls per day
- **Data:** News articles with sentiment scoring
- **Signup:** [marketaux.com](https://www.marketaux.com) — free account
- **Config:** `data.marketaux.maxCallsPerDay` (default: 100), `data.marketaux.priorityStocksCount` (default: 10 — only top stocks get Marketaux news to conserve API budget)

### AI Providers

| Provider | Cost | Latency | Quality |
|----------|------|---------|---------|
| Anthropic Claude | ~$0.01–0.05 per analysis | 2–10s | Highest |
| Ollama (local) | Free | 5–30s (depends on hardware) | Varies by model |
| OpenAI-compatible | Varies | Varies | Varies |

The bot defaults to Anthropic with `claude-sonnet-4-5-20250929`. For free local inference, install [Ollama](https://ollama.com) and pull a finance-tuned model:

```bash
ollama pull palmyra-fin
```

Then set `ai.provider = "ollama"` in the dashboard.
