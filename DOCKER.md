# Docker Deployment

Run Trader212 in containers with Docker and Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 20.10+
- [Docker Compose](https://docs.docker.com/compose/install/) v2+
- A configured `.env` file (see [Quick Start](QUICKSTART.md#step-2-configure-environment))

## Quick Start

```bash
# Build and start everything
docker compose up -d

# View logs
docker compose logs -f bot
docker compose logs -f web

# Stop
docker compose down
```

This starts two containers:

| Service | Port | Description |
|---------|------|-------------|
| `bot` | 3001 | Trading bot + REST API + WebSocket |
| `web` | 3000 | Next.js web dashboard |

## Building Images

### Bot image

```bash
# Build from project root
docker build -t trader212-bot .

# Run standalone
docker run -d \
  --name trader212-bot \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -p 3001:3001 \
  trader212-bot
```

### Web dashboard image

```bash
# Build from project root
docker build -f Dockerfile.web -t trader212-web .

# Run standalone
docker run -d \
  --name trader212-web \
  -e NEXT_PUBLIC_API_URL=http://localhost:3001 \
  -p 3000:3000 \
  trader212-web
```

## Docker Compose

The `docker-compose.yml` in the project root defines both services:

```yaml
services:
  bot:
    build: .
    env_file: .env
    volumes:
      - ./data:/app/data    # Persist SQLite database
    ports:
      - "3001:3001"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/status"]
      interval: 30s
      timeout: 10s
      retries: 3

  web:
    build:
      context: ./web
      dockerfile: ../Dockerfile.web
    environment:
      - NEXT_PUBLIC_API_URL=http://bot:3001
    ports:
      - "3000:3000"
    depends_on:
      - bot
    restart: unless-stopped
```

## Volume Mounts

| Mount | Purpose |
|-------|---------|
| `./data:/app/data` | SQLite database file. Persists trade history, signals, config, and cached data across container restarts. |

The `data/` directory is created automatically. Back it up regularly:

```bash
# Backup
cp data/trader212.db data/trader212.db.backup

# Or use sqlite3 .backup command for a safe online backup
sqlite3 data/trader212.db ".backup data/trader212.db.backup"
```

## Environment Variables

All environment variables are passed to the bot container via `--env-file .env`. The web container only needs `NEXT_PUBLIC_API_URL` to know where the bot API lives.

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `TRADING212_API_KEY` | Yes | Trading212 API key |
| `ANTHROPIC_API_KEY` | One AI provider required | Anthropic API key |
| `AI_PROVIDER` | No | AI provider: `"anthropic"` \| `"ollama"` \| `"openai-compatible"` |
| `AI_OLLAMA_BASE_URL` | If using Ollama | Ollama server URL (default: http://localhost:11434) |
| `AI_OLLAMA_MODEL` | If using Ollama | Ollama model name (default: palmyra-fin) |
| `AI_OPENAI_COMPAT_BASE_URL` | If using OpenAI-compat | OpenAI-compatible API base URL |
| `AI_OPENAI_COMPAT_MODEL` | If using OpenAI-compat | OpenAI-compatible model name |
| `AI_OPENAI_COMPAT_API_KEY` | If using OpenAI-compat | OpenAI-compatible API key |
| `FINNHUB_API_KEY` | Recommended | Finnhub key (comma-separated for multiple = higher rate limits) |
| `MARKETAUX_API_TOKEN` | No | Marketaux key (comma-separated for multiple = higher rate limits) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram notifications |
| `TELEGRAM_CHAT_ID` | No | Telegram chat ID |
| `API_PORT` | No | Bot API port (default: 3001) |
| `DB_PATH` | No | Database path (default: ./data/trader212.db) |
| `LOG_LEVEL` | No | Log level (default: info) |

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build

# Verify
docker compose ps
docker compose logs -f bot --tail 50
```

The SQLite database in `./data/` persists across rebuilds. Schema migrations run automatically on startup.

## Using Ollama in Docker

If you want to use Ollama for local AI instead of Anthropic, add it to your compose file:

```yaml
services:
  ollama:
    image: ollama/ollama
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"

  bot:
    # ... existing config ...
    environment:
      - AI_PROVIDER=ollama
      - AI_OLLAMA_BASE_URL=http://ollama:11434
    depends_on:
      - ollama

volumes:
  ollama_data:
```

Then set `ai.provider` to `"ollama"` in the dashboard config.

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs bot

# Verify .env file exists
ls -la .env

# Rebuild from scratch
docker compose build --no-cache
docker compose up -d
```

### Database permission errors

```bash
# Ensure data directory exists with correct permissions
mkdir -p data
chmod 755 data
```

### Bot can't reach external APIs

```bash
# Test DNS resolution from inside container
docker compose exec bot nslookup api.trading212.com

# Check network
docker compose exec bot curl -s https://finnhub.io/api/v1/quote?symbol=AAPL&token=test
```

### Health check failing

```bash
# Check if the API is responding
docker compose exec bot curl -f http://localhost:3001/api/status

# View health check logs
docker inspect --format='{{json .State.Health}}' trader212-bot-1 | jq
```

### Web dashboard can't connect to bot

The web container connects to the bot using Docker's internal DNS (`http://bot:3001`). If you're accessing the dashboard from your browser, CORS must allow `localhost:3000`. This is handled automatically by the bot's Express server.
