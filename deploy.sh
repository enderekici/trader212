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
  echo "  GHCR_TOKEN=your_github_token (optional, for private repos)"
  exit 1
fi

echo "🚀 Deploying Trader212 Bot to VPS..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Create deployment directory on server
echo -e "${BLUE}📁 Creating deployment directory on server...${NC}"
ssh -i "$SSH_KEY" "$SERVER" "mkdir -p $DEPLOY_DIR"

# Step 2: Copy compose file and .env
echo -e "${BLUE}📦 Copying configuration files...${NC}"
scp -i "$SSH_KEY" docker-compose.prod.yml "$SERVER:$DEPLOY_DIR/"

echo -e "${YELLOW}⚠️  Checking .env file...${NC}"
if [ -f .env ]; then
  echo -e "${BLUE}📋 Copying .env file...${NC}"
  scp -i "$SSH_KEY" .env "$SERVER:$DEPLOY_DIR/.env"
else
  echo -e "${YELLOW}⚠️  No .env file found locally. You'll need to create it on the server.${NC}"
fi

# Step 3: Pull images and start services on server
echo -e "${BLUE}🐳 Pulling images and starting services...${NC}"
ssh -i "$SSH_KEY" "$SERVER" << ENDSSH
cd $DEPLOY_DIR

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
  sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)" -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
fi

# Login to GHCR if token provided
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "Logging in to GitHub Container Registry..."
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u enderekici --password-stdin
fi

# Stop existing containers
echo "Stopping existing containers..."
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

# Pull latest images
echo "Pulling latest images from GHCR..."
docker-compose -f docker-compose.prod.yml pull

# Start services
echo "Starting services..."
docker-compose -f docker-compose.prod.yml up -d

echo "Waiting for services to be healthy..."
sleep 10

# Show status
docker-compose -f docker-compose.prod.yml ps
ENDSSH

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo ""
echo -e "${YELLOW}To view logs:${NC}"
echo "  ssh -i $SSH_KEY $SERVER 'cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml logs -f'"
echo ""
echo -e "${YELLOW}To check status:${NC}"
echo "  ssh -i $SSH_KEY $SERVER 'cd $DEPLOY_DIR && docker-compose -f docker-compose.prod.yml ps'"
