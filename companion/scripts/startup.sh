#!/bin/bash

# Cursor Telemetry Companion Service - Startup Script
# This script starts the service with proper error handling

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
COMPANION_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}🚀 Starting Cursor Telemetry Companion Service...${NC}\n"

# Change to companion directory
cd "$COMPANION_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}⚠ node_modules not found. Running npm install...${NC}"
  npm install
  echo ""
fi

# Check if database directory exists
if [ ! -d "data" ]; then
  echo -e "${YELLOW}⚠ Creating data directory...${NC}"
  mkdir -p data
  echo ""
fi

# Check if config.json exists
if [ ! -f "config.json" ]; then
  echo -e "${YELLOW}⚠ config.json not found. Creating default config...${NC}"
  cat > config.json << 'EOF'
{
  "port": 43917,
  "host": "0.0.0.0",
  "workspace_roots": ["/Users/$USER"],
  "auto_detect_workspaces": true,
  "ignore": [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "__pycache__",
    "*.pyc",
    ".DS_Store"
  ],
  "enable_clipboard": true,
  "enable_screenshots": false,
  "screenshot_interval": 300000,
  "mining": {
    "auto_enabled": false,
    "git_history_days": 365,
    "weekly_backfill": false
  }
}
EOF
  echo -e "${GREEN}✓ Created default config.json${NC}"
  echo -e "  Edit config.json to configure your workspaces"
  echo ""
fi

# Check if port 43917 is already in use
if lsof -Pi :43917 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
  echo -e "${RED}✗ Port 43917 is already in use${NC}"
  echo -e "  Kill the existing process with: ${YELLOW}pkill -f 'node src/index.js'${NC}"
  echo -e "  Or run health check: ${YELLOW}node health-check.js${NC}"
  exit 1
fi

echo -e "${GREEN}✓ All checks passed${NC}\n"
echo -e "${BLUE}Starting service on http://localhost:43917${NC}"
echo -e "${BLUE}Dashboard will be available at http://localhost:43917/dashboard.html${NC}"
echo -e "\n${YELLOW}Press Ctrl+C to stop${NC}\n"
echo "─────────────────────────────────────────────────────────────"

# Start the service
node src/index.js

