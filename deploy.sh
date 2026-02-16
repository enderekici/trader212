#!/bin/bash
set -e

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

echo "🚀 Deploying Trader212 Bot to VPS..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Build Docker images locally
echo -e "${BLUE}🔨 Building Docker images locally...${NC}"
docker-compose -f docker-compose.prod.yml build --no-cache

# Step 2: Save images to tar files
echo -e "${BLUE}💾 Saving Docker images...${NC}"
docker save trader212-trader212-bot:latest | gzip > /tmp/trader212-bot.tar.gz
docker save trader212-trader212-web:latest | gzip > /tmp/trader212-web.tar.gz

# Step 3: Create deployment directory on server
echo -e "${BLUE}📁 Creating deployment directory on server...${NC}"
ssh -i "$SSH_KEY" "$SERVER" "mkdir -p $DEPLOY_DIR"

# Step 4: Copy Docker images and compose file
echo -e "${BLUE}📦 Copying Docker images to server...${NC}"
scp -i "$SSH_KEY" /tmp/trader212-bot.tar.gz "$SERVER:/tmp/"
scp -i "$SSH_KEY" /tmp/trader212-web.tar.gz "$SERVER:/tmp/"
scp -i "$SSH_KEY" docker-compose.prod.yml "$SERVER:$DEPLOY_DIR/"

# Step 5: Copy .env file
echo -e "${YELLOW}⚠️  Checking .env file...${NC}"
if [ -f .env ]; then
  echo -e "${BLUE}📋 Copying .env file...${NC}"
  scp -i "$SSH_KEY" .env "$SERVER:$DEPLOY_DIR/.env"
else
  echo -e "${YELLOW}⚠️  No .env file found locally. You'll need to create it on the server.${NC}"
fi

# Step 6: Load images and start services on server
echo -e "${BLUE}🐳 Loading images and starting services...${NC}"
ssh -i "$SSH_KEY" "$SERVER" << 'ENDSSH'
cd /home/ubuntu/trader212

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  sudo usermod -aG docker ubuntu
  echo "Docker installed. You may need to log out and back in."
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null; then
  echo "Installing Docker Compose..."
  sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

# Stop existing containers
echo "Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

# Load Docker images
echo "Loading Docker images..."
docker load < /tmp/trader212-bot.tar.gz
docker load < /tmp/trader212-web.tar.gz

# Clean up image files
rm /tmp/trader212-bot.tar.gz /tmp/trader212-web.tar.gz

# Start services
echo "Starting services..."
docker-compose -f docker-compose.prod.yml up -d

echo "Waiting for services to be healthy..."
sleep 10

# Show status
docker-compose -f docker-compose.prod.yml ps
ENDSSH

# Clean up local temp files
rm /tmp/trader212-bot.tar.gz /tmp/trader212-web.tar.gz

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo -e "${YELLOW}To view logs:${NC}"
echo "  ssh -i $SSH_KEY $SERVER 'cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml logs -f'"
echo ""
echo -e "${YELLOW}To check status:${NC}"
echo "  ssh -i $SSH_KEY $SERVER 'cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml ps'"
