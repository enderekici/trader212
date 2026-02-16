# Trader212 Bot - VPS Deployment Guide

## Prerequisites

- VPS with Ubuntu
- SSH access with key file
- Docker and Docker Compose (will be installed automatically)
- VPN connection between local and VPS
- `.env` file with your API keys

## Quick Start

### 1. Configure Deployment

```bash
# Copy the example config
cp deploy.config.example deploy.config

# Edit with your VPS details
nano deploy.config
# Set:
#   SERVER=ubuntu@your-vps-ip
#   SSH_KEY=$HOME/path/to/your/key.pem
#   DEPLOY_DIR=/home/ubuntu/trader212
#   GHCR_TOKEN=your_github_token (optional, only if repo is private)
```

### 2. Initial Deployment

```bash
# Make scripts executable
chmod +x deploy.sh manage-vps.sh

# Deploy to VPS
./deploy.sh
```

This will:
- Pull pre-built Docker images from GitHub Container Registry
- Install Docker and Docker Compose (if needed)
- Start the bot and web dashboard

**Note:** Images are automatically built by GitHub Actions CI and pushed to GHCR. No local Docker or building required!

### 3. Access Your Bot

After deployment:
- **Web Dashboard:** http://YOUR_VPS_IP:3000
- **API:** http://YOUR_VPS_IP:3001
- **Health Check:** http://YOUR_VPS_IP:3001/api/status

## Management Commands

Use `./manage-vps.sh` for all management tasks:

```bash
# View live logs
./manage-vps.sh logs

# Check service status
./manage-vps.sh status

# Restart services
./manage-vps.sh restart

# Stop all services
./manage-vps.sh stop

# Start services
./manage-vps.sh start

# SSH into server
./manage-vps.sh ssh

# Update code and rebuild
./manage-vps.sh update

# Backup database
./manage-vps.sh backup

# Restore database
./manage-vps.sh restore backups/trader212_backup_YYYYMMDD_HHMMSS.db
```

## Environment Variables

Make sure your `.env` file includes:

```bash
# Trading212 API
TRADING212_API_KEY=your_api_key_here

# API Security
API_SECRET_KEY=your_secret_key_here

# AI Provider (choose one)
# For Anthropic:
ANTHROPIC_API_KEY=your_anthropic_key

# For local LLM:
OPENAI_COMPAT_BASE_URL=http://10.0.0.5:1234/v1
OPENAI_COMPAT_API_KEY=not-needed
OPENAI_COMPAT_MODEL=llama-3-8b-instruct-finance-rag

# Data Sources
FINNHUB_API_KEY=key1,key2,key3  # Multiple keys comma-separated
MARKETAUX_API_TOKEN=token1,token2,token3

# Telegram (optional)
TELEGRAM_BOT_TOKEN=your_telegram_token
TELEGRAM_CHAT_ID=your_chat_id

# CORS (for web dashboard)
CORS_ORIGINS=http://YOUR_VPS_IP:3000,http://localhost:3000
```

## Monitoring

### Check Logs
```bash
# Live logs (all services)
./manage-vps.sh logs

# Or SSH and check specific service
ssh -i ~/Documents/personal/ocnKey.pem ubuntu@144.24.180.184
cd /home/ubuntu/trader212
docker-compose -f docker-compose.prod.yml logs -f bot
docker-compose -f docker-compose.prod.yml logs -f web
```

### Check Status
```bash
./manage-vps.sh status
```

### Check Bot API
```bash
curl http://YOUR_VPS_IP:3001/api/status
curl http://YOUR_VPS_IP:3001/api/portfolio
curl http://YOUR_VPS_IP:3001/api/pairlist
```

## Database Backups

### Automatic Backups
Create a cron job on the VPS:

```bash
# SSH into server
./manage-vps.sh ssh

# Add cron job (daily at 2 AM)
crontab -e

# Add this line:
0 2 * * * cd /home/ubuntu/trader212 && cp data/trader212.db data/backups/trader212_$(date +\%Y\%m\%d).db
```

### Manual Backup
```bash
./manage-vps.sh backup
```

Backups are saved to `./backups/` directory locally.

### Restore Backup
```bash
./manage-vps.sh restore backups/trader212_backup_20260216_120000.db
```

## Updating the Bot

### Deploy New Code
```bash
# Commit and push changes
git add .
git commit -m "Your changes"
git push

# Pull and deploy on VPS
./manage-vps.sh ssh
cd /home/ubuntu/trader212
git pull
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

Or use the update command:
```bash
./manage-vps.sh update
```

## Troubleshooting

### Services won't start
```bash
# Check logs
./manage-vps.sh logs

# Check Docker status
./manage-vps.sh ssh
docker ps -a
```

### Database is locked
```bash
# Restart services
./manage-vps.sh restart
```

### Out of disk space
```bash
./manage-vps.sh ssh

# Clean old Docker images
docker system prune -a

# Check disk usage
df -h
du -sh /home/ubuntu/trader212/data
```

### VPN Connection Issues
If you can't access the dashboard:
1. Check VPN connection is active
2. Try accessing via VPN IP if different
3. Check firewall rules: `sudo ufw status`

## Security Checklist

- [ ] Strong API_SECRET_KEY set
- [ ] Firewall configured (only allow 3000, 3001 from VPN)
- [ ] SSH key-only authentication
- [ ] .env file not committed to git
- [ ] Regular backups enabled
- [ ] Monitor logs for unusual activity

## Firewall Setup (Optional)

```bash
./manage-vps.sh ssh

# Enable UFW
sudo ufw allow ssh
sudo ufw allow from 10.0.0.0/24 to any port 3000
sudo ufw allow from 10.0.0.0/24 to any port 3001
sudo ufw enable
```

## Resource Usage

Monitor resource usage:
```bash
./manage-vps.sh ssh

# Check CPU/Memory
htop

# Check Docker stats
docker stats

# Check disk
df -h
```

## Support

For issues:
1. Check logs: `./manage-vps.sh logs`
2. Check status: `./manage-vps.sh status`
3. Review this guide
4. Check GitHub issues: https://github.com/enderekici/trader212/issues
