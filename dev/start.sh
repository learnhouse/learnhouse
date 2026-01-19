#!/bin/bash

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting LearnHouse Development Infrastructure...${NC}"

# Navigate to the root directory if the script is run from dev/
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ROOT_DIR="$( dirname "$SCRIPT_DIR" )"
cd "$ROOT_DIR"

# Check if docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${YELLOW}Error: Docker is not running. Please start Docker and try again.${NC}"
  exit 1
fi

# Start DB and Redis
echo -e "${BLUE}Starting Database and Redis containers...${NC}"
docker compose -f dev/docker-compose.yml up -d

# Wait for DB to be healthy
echo -n "Waiting for database to be ready"
until docker exec learnhouse-db-dev pg_isready -U learnhouse > /dev/null 2>&1; do
  echo -n "."
  sleep 1
done
echo -e "\n${GREEN}Infrastructure is ready! ✅${NC}"

# Offer to start the servers
echo -e "\n${BLUE}Do you want to start the development servers (API & Web)?${NC}"
read -p "This will start both and show logs. (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}Starting servers... (Press Ctrl+C to stop)${NC}"
    
    # Load nvm if available (for Node.js version management)
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
    
    # Use Node.js 20 if nvm is available
    if command -v nvm &> /dev/null; then
        nvm use 20 > /dev/null 2>&1 || true
    fi
    
    # Cleanup background processes on exit
    trap 'kill $(jobs -p) 2>/dev/null' EXIT

    # Start API
    (cd apps/api && uv run python app.py) &
    
    # Start Web (with nvm loaded in subshell)
    (export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" && nvm use 20 > /dev/null 2>&1; cd apps/web && pnpm dev) &

    # Wait for both to finish
    wait
else
    echo -e "\n${BLUE}Manual server start instructions:${NC}"
    echo -e "1. ${GREEN}Backend:${NC} cd apps/api && uv run python app.py"
    echo -e "2. ${GREEN}Frontend:${NC} source ~/.bashrc && cd apps/web && pnpm dev"
fi

echo -e "\n${GREEN}Happy coding! 🚀${NC}"

