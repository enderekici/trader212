# Quick Start Guide

Get Trader212 running in under 5 minutes.

## Prerequisites

| Requirement | Notes |
|------------|-------|
| **Node.js 20+** | Required. Check with `node -v` |
| Trading212 account | Demo or live. Get API key from Settings → API |
| Finnhub API key | Free at [finnhub.io](https://finnhub.io) — 60 calls/min |
| Anthropic API key | Or use Ollama for free local AI |

**Optional:**
- Docker & Docker Compose (for containerized deployment)
- Telegram bot token (for notifications — create via [@BotFather](https://t.me/BotFather))
- Marketaux API token (additional news source — [marketaux.com](https://www.marketaux.com))

## Step 1: Clone & Install

```bash
git clone https://github.com/your-username/trader212.git
cd trader212
npm install
```

## Step 2: Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```bash
# Required
TRADING212_API_KEY=your_trading212_api_key_here

# At least one AI provider
ANTHROPIC_API_KEY=sk-ant-...                    # Option A: Anthropic
AI_PROVIDER="ollama"                             # Option B: Ollama (free, local)
AI_OLLAMA_BASE_URL="http://localhost:11434"      # Option B: Ollama server URL

# At least one data source key
FINNHUB_API_KEY=your_finnhub_key_here

# Optional but recommended
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
MARKETAUX_API_TOKEN=your_marketaux_token
```

> **Tip:** The bot starts in demo mode with dry-run enabled. No real money is at risk until you explicitly change the config.

## Step 3: Start the Bot

```bash
npm run dev
```

You should see output like:

```
[09:30:00] INFO: Database initialized at ./data/trader212.db
[09:30:00] INFO: Config seeded with 60+ defaults
[09:30:00] INFO: Trading212 client connected (DEMO)
[09:30:00] INFO: Pairlist pipeline starting...
[09:30:02] INFO: Pairlist: 30 stocks selected from 3,500 instruments
[09:30:02] INFO: Analysis scheduler started (every 15 min)
[09:30:02] INFO: API server listening on :3001
[09:30:02] INFO: Bot is running. Mode: DEMO | Dry-run: ON
```

## Step 4: Open the Dashboard

Navigate to **http://localhost:3001** in your browser for the REST API.

The web dashboard (when running) is at **http://localhost:3000** and shows:
- Live pairlist with current scores
- Open positions with real-time P&L
- Trade history with AI reasoning
- Signal chart with indicator overlays
- Configuration panel (edit all settings live)

To start the web dashboard separately:

```bash
cd web && npm install && npm run dev
```

## Step 5: Verify Everything Works

Check these endpoints to confirm the bot is healthy:

```bash
# Bot status (environment, market status, uptime)
curl http://localhost:3001/api/status

# Current pairlist
curl http://localhost:3001/api/pairlist

# Latest signals
curl http://localhost:3001/api/signals

# Open positions
curl http://localhost:3001/api/portfolio

# Trade plans (pending/approved/executed)
curl http://localhost:3001/api/trade-plans

# AI research reports
curl http://localhost:3001/api/research

# AI model performance
curl http://localhost:3001/api/model-stats

# Audit log (recent bot actions)
curl http://localhost:3001/api/audit

# Portfolio correlation matrix
curl http://localhost:3001/api/correlation

# Configuration
curl http://localhost:3001/api/config
```

If you configured Telegram, send `/status` to your bot -- it should reply with the current state.

## What Happens Next

The bot will automatically:

1. **Every 30 min** -- Refresh the pairlist (discover new stocks, drop stale ones)
2. **Every 15 min** -- Run full analysis on each stock (technical + fundamental + sentiment + AI)
3. **Every 5 min** -- Monitor open positions (update trailing stops, check exits)
4. **Every 30 min** -- Re-evaluate open positions with AI (tighten stops if needed)
5. **Every 60 min (off-hours)** -- Monitor news for top stocks even when market is closed
6. **Every 2 hours** -- Run AI market research for new stock opportunities
7. **Daily at 16:30 ET** -- Send a daily summary via Telegram
8. **Daily at 6 PM ET** -- Evaluate AI model prediction accuracy
9. **Pre-market at 09:00 ET** -- Send a pre-market alert with top opportunities
10. **Friday 5 PM ET** -- Send weekly performance report

## Troubleshooting

### Bot won't start

- Ensure Node.js 20+ is installed: `node -v`
- Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
- Check `.env` file exists and has at least `TRADING212_API_KEY`

### "API key invalid" errors

- Trading212 keys are environment-specific — a demo key won't work if `t212.environment` is set to `live`
- Finnhub free tier is limited to 60 calls/min; the bot respects this automatically
- Anthropic keys start with `sk-ant-`

### No stocks in pairlist

- Check that Trading212 API key has access to equity instruments
- Pairlist filters may be too aggressive — try increasing `pairlist.maxPairs` or lowering `pairlist.marketCap.minBillions`
- If running outside US market hours, cached data from the last session is used

### Database errors

- The `data/` directory is created automatically. If you see permission errors, ensure the bot can write to `./data/`
- To reset the database, stop the bot and delete `./data/trader212.db` — it will be recreated on next start

### Telegram not working

- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`
- Send any message to the bot first (Telegram requires this to allow the bot to message you)
- Get your chat ID by sending a message to [@userinfobot](https://t.me/userinfobot)

## Next Steps

- Read the [Architecture](ARCHITECTURE.md) docs for the technical deep-dive
- See [Environments](ENVIRONMENTS.md) to understand demo vs. live modes
- Check [Docker](DOCKER.md) for containerized deployment
