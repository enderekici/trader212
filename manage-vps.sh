#!/bin/bash

# Configuration
# Load from deploy.config if it exists, otherwise use defaults
if [ -f "deploy.config" ]; then
  source deploy.config
else
  echo "Error: deploy.config not found!"
  echo "Please create deploy.config with:"
  echo "  SERVER=ubuntu@your-server-ip"
  echo "  SSH_KEY=\$HOME/path/to/your/key.pem"
  echo "  DEPLOY_DIR=/home/ubuntu/trader212"
  exit 1
fi

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

function show_help() {
  echo "Trader212 VPS Management Script"
  echo ""
  echo "Usage: ./manage-vps.sh [command]"
  echo ""
  echo "Commands:"
  echo "  logs        - View live logs"
  echo "  status      - Check service status"
  echo "  restart     - Restart all services"
  echo "  stop        - Stop all services"
  echo "  start       - Start all services"
  echo "  ssh         - SSH into the server"
  echo "  update      - Pull latest code and rebuild"
  echo "  backup      - Backup database"
  echo "  restore     - Restore database from backup"
  echo ""
}

function run_logs() {
  echo -e "${BLUE}📋 Viewing logs (Ctrl+C to exit)...${NC}"
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml logs -f"
}

function run_status() {
  echo -e "${BLUE}📊 Checking service status...${NC}"
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml ps"
  echo ""
  echo -e "${BLUE}🔍 Health check...${NC}"
  ssh -i "$SSH_KEY" "$SERVER" "curl -s http://localhost:3001/api/status | jq" || echo "API not responding"
}

function run_restart() {
  echo -e "${YELLOW}🔄 Restarting services...${NC}"
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml restart"
  echo -e "${GREEN}✅ Services restarted${NC}"
}

function run_stop() {
  echo -e "${RED}⏹️  Stopping services...${NC}"
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml stop"
  echo -e "${GREEN}✅ Services stopped${NC}"
}

function run_start() {
  echo -e "${GREEN}▶️  Starting services...${NC}"
  ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml up -d"
  echo -e "${GREEN}✅ Services started${NC}"
}

function run_ssh() {
  echo -e "${BLUE}🔐 Connecting to server...${NC}"
  ssh -i "$SSH_KEY" "$SERVER"
}

function run_update() {
  echo -e "${BLUE}🔄 Updating deployment...${NC}"
  ./deploy.sh
}

function run_backup() {
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="trader212_backup_${TIMESTAMP}.db"
  echo -e "${BLUE}💾 Backing up database...${NC}"
  scp -i "$SSH_KEY" "$SERVER:$DEPLOY_DIR/data/trader212.db" "./backups/$BACKUP_FILE"
  echo -e "${GREEN}✅ Backup saved to: ./backups/$BACKUP_FILE${NC}"
}

function run_restore() {
  if [ -z "$1" ]; then
    echo -e "${RED}❌ Please specify backup file${NC}"
    echo "Usage: ./manage-vps.sh restore <backup-file>"
    exit 1
  fi
  echo -e "${YELLOW}⚠️  This will overwrite the current database!${NC}"
  read -p "Are you sure? (yes/no): " confirm
  if [ "$confirm" = "yes" ]; then
    echo -e "${BLUE}📤 Restoring database from $1...${NC}"
    scp -i "$SSH_KEY" "$1" "$SERVER:$DEPLOY_DIR/data/trader212.db"
    echo -e "${GREEN}✅ Database restored${NC}"
    echo -e "${YELLOW}Restarting services...${NC}"
    run_restart
  else
    echo "Restore cancelled"
  fi
}

# Main
case "${1:-help}" in
  logs)
    run_logs
    ;;
  status)
    run_status
    ;;
  restart)
    run_restart
    ;;
  stop)
    run_stop
    ;;
  start)
    run_start
    ;;
  ssh)
    run_ssh
    ;;
  update)
    run_update
    ;;
  backup)
    run_backup
    ;;
  restore)
    run_restore "$2"
    ;;
  help|*)
    show_help
    ;;
esac
