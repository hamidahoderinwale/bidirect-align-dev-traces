#!/bin/bash

# Helper script to start the companion service
# This can be used by the UI or run manually

COMPANION_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_FILE="$COMPANION_DIR/com.cursor.companion.plist"
IS_MACOS=$(uname -s | grep -i darwin)

echo "Starting Cursor Companion Service..."

# Check if service is already running
if curl -s http://localhost:43917/health > /dev/null 2>&1; then
    echo "✓ Companion service is already running"
    exit 0
fi

# Method 1: Use launchctl on macOS if plist exists
if [ -n "$IS_MACOS" ] && [ -f "$PLIST_FILE" ]; then
    echo "Attempting to start via launchctl..."
    
    USER_ID=$(id -u)
    SERVICE_NAME="gui/$USER_ID/com.cursor.companion"
    
    # Check if already bootstrapped (new method)
    if launchctl list "$SERVICE_NAME" > /dev/null 2>&1; then
        launchctl kickstart "$SERVICE_NAME"
        echo "✓ Started existing launchctl service"
    else
        # Bootstrap and start (new method, replaces 'load')
        launchctl bootstrap "gui/$USER_ID" "$PLIST_FILE" 2>/dev/null
        if [ $? -eq 0 ]; then
            launchctl kickstart "$SERVICE_NAME"
            echo "✓ Bootstrapped and started launchctl service"
        else
            # Fallback to old method if bootstrap fails
            echo "⚠ Bootstrap failed, trying legacy load method..."
            launchctl load "$PLIST_FILE" 2>/dev/null
            launchctl start com.cursor.companion 2>/dev/null
        fi
    fi
    
    # Wait a moment and check
    sleep 3
    if curl -s http://localhost:43917/health > /dev/null 2>&1; then
        echo "✓ Service is now running"
        exit 0
    else
        echo "⚠ Service may still be starting. Check logs: $COMPANION_DIR/companion.log"
        echo "   You can also start manually: cd $COMPANION_DIR && node src/index.js"
    fi
fi

# Method 2: Start directly with Node
echo "Starting service directly with Node..."
cd "$COMPANION_DIR"

if [ ! -f "src/index.js" ]; then
    echo "✗ Error: src/index.js not found"
    exit 1
fi

# Start in background
nohup node src/index.js > companion.log 2> companion.error.log &
COMPANION_PID=$!

echo "✓ Started companion service (PID: $COMPANION_PID)"
echo "  Logs: $COMPANION_DIR/companion.log"
echo "  Health: http://localhost:43917/health"

# Wait a moment and verify
sleep 3
if curl -s http://localhost:43917/health > /dev/null 2>&1; then
    echo "✓ Service is running successfully"
    exit 0
else
    echo "⚠ Service may still be starting. Check logs for errors."
    exit 1
fi

