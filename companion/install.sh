#!/bin/bash
#
# Cursor Companion Service - Quick Installer
# Installs the companion service globally via npm or from GitHub
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║        Cursor Companion Service - Quick Installer              ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed!"
    print_info "Please install Node.js 18+ from: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_warning "Node.js version $NODE_VERSION detected. Version 18+ recommended."
else
    print_success "Node.js $(node -v) detected"
fi

# Check npm
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed!"
    exit 1
fi

print_info "Installing cursor-companion globally..."

# Try to install from npm first, fallback to GitHub
if npm install -g cursor-companion 2>/dev/null; then
    print_success "Installed from npm!"
else
    print_warning "Package not found on npm, installing from GitHub..."
    
    # Install from GitHub
    npm install -g "https://github.com/hamidahoderinwale/cursor-telemetry.git#main:components/activity-logger/companion" || {
        print_error "Failed to install from GitHub"
        print_info "Trying alternative method..."
        
        # Alternative: clone and link
        TEMP_DIR=$(mktemp -d)
        git clone --depth 1 https://github.com/hamidahoderinwale/cursor-telemetry.git "$TEMP_DIR" || {
            print_error "Failed to clone repository"
            exit 1
        }
        
        cd "$TEMP_DIR/components/activity-logger/companion"
        npm install
        npm link
        
        print_success "Installed via git clone + npm link"
    }
fi

# Verify installation
if command -v cursor-telemetry &> /dev/null; then
    print_success "Installation complete!"
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo "  1. Start the service: ${GREEN}cursor-telemetry start${NC}"
    echo "  2. Or use the startup script: ${GREEN}cursor-telemetry startup${NC}"
    echo "  3. Access dashboard: ${GREEN}http://localhost:43917/analytics-viz.html${NC}"
    echo ""
    echo -e "${CYAN}Useful commands:${NC}"
    echo "  ${GREEN}cursor-telemetry health${NC}     - Check service status"
    echo "  ${GREEN}cursor-telemetry stats${NC}      - View database statistics"
    echo "  ${GREEN}cursor-telemetry examples${NC}   - Show usage examples"
    echo ""
else
    print_error "Installation completed but 'cursor-telemetry' command not found"
    print_info "Try: npm link cursor-companion"
    exit 1
fi

