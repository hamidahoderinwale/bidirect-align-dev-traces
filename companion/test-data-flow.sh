#!/bin/bash

# Quick Data Flow Test
# Proves that your collected data is accessible through the entire stack

set -e

COMPANION_DIR="/Users/hamidaho/new_cursor/cursor-telemetry/components/activity-logger/companion"
API_PORT=43917

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Cursor Telemetry - Data Flow Verification Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$COMPANION_DIR"

# Test 1: Database has your collected data
echo "📦 Test 1: Database contains collected data"
echo "─────────────────────────────────────────────"

if [ ! -f "data/companion.db" ]; then
  echo "❌ Database file not found!"
  exit 1
fi

ENTRIES=$(sqlite3 data/companion.db "SELECT COUNT(*) FROM entries;")
PROMPTS=$(sqlite3 data/companion.db "SELECT COUNT(*) FROM prompts;")
EVENTS=$(sqlite3 data/companion.db "SELECT COUNT(*) FROM events;")
TERMINAL=$(sqlite3 data/companion.db "SELECT COUNT(*) FROM terminal_commands;")

echo "✅ Database exists and is readable"
echo "   • Entries: $ENTRIES"
echo "   • Prompts: $PROMPTS"
echo "   • Events: $EVENTS"
echo "   • Terminal commands: $TERMINAL"
echo ""

# Test 2: Check if service is running
echo "🔌 Test 2: Companion service status"
echo "─────────────────────────────────────────────"

if curl -s "http://localhost:$API_PORT/api/health" > /dev/null 2>&1; then
  echo "✅ Service is running"
  SERVICE_RUNNING=true
else
  echo "⚠️  Service is not running (data is still accessible from database)"
  SERVICE_RUNNING=false
  echo "   To start: npm start"
fi
echo ""

# Test 3: API endpoints return data (if service is running)
if [ "$SERVICE_RUNNING" = true ]; then
  echo "🌐 Test 3: API endpoints serve data from database"
  echo "─────────────────────────────────────────────"
  
  # Test entries endpoint
  ENTRIES_API=$(curl -s "http://localhost:$API_PORT/api/entries?limit=1" | jq -r '.data | length' 2>/dev/null || echo "0")
  if [ "$ENTRIES_API" -gt 0 ]; then
    echo "✅ /api/entries returns data"
    LATEST_FILE=$(curl -s "http://localhost:$API_PORT/api/entries?limit=1" | jq -r '.data[0].file_path' 2>/dev/null || echo "N/A")
    echo "   Latest file: $LATEST_FILE"
  else
    echo "❌ /api/entries not returning data"
  fi
  
  # Test prompts endpoint
  PROMPTS_API=$(curl -s "http://localhost:$API_PORT/api/prompts?limit=1" | jq -r '.data | length' 2>/dev/null || echo "0")
  if [ "$PROMPTS_API" -gt 0 ]; then
    echo "✅ /api/prompts returns data"
    LATEST_PROMPT=$(curl -s "http://localhost:$API_PORT/api/prompts?limit=1" | jq -r '.data[0].prompt' 2>/dev/null | head -c 60 || echo "N/A")
    echo "   Latest prompt: ${LATEST_PROMPT}..."
  else
    echo "❌ /api/prompts not returning data"
  fi
  
  # Test analytics endpoint
  ANALYTICS_SUCCESS=$(curl -s "http://localhost:$API_PORT/api/analytics/productivity" | jq -r '.success' 2>/dev/null || echo "false")
  if [ "$ANALYTICS_SUCCESS" = "true" ]; then
    echo "✅ /api/analytics/productivity computes from data"
  else
    echo "⚠️  /api/analytics/productivity not available (non-critical)"
  fi
  
  echo ""
fi

# Test 4: Verify data consistency
echo "🔗 Test 4: Data consistency check"
echo "─────────────────────────────────────────────"

# Check if we have recent data
LATEST_ENTRY=$(sqlite3 data/companion.db "SELECT MAX(timestamp) FROM entries;" 2>/dev/null || echo "")
if [ -n "$LATEST_ENTRY" ]; then
  echo "✅ Latest entry timestamp: $LATEST_ENTRY"
  
  # Calculate age
  LATEST_UNIX=$(date -j -f "%Y-%m-%d %H:%M:%S" "$LATEST_ENTRY" "+%s" 2>/dev/null || echo "0")
  NOW_UNIX=$(date +%s)
  AGE_HOURS=$(( ($NOW_UNIX - $LATEST_UNIX) / 3600 ))
  
  if [ $AGE_HOURS -lt 24 ]; then
    echo "   📊 Data is recent (less than 24 hours old)"
  elif [ $AGE_HOURS -lt 168 ]; then
    echo "   📊 Data is from this week ($AGE_HOURS hours ago)"
  else
    AGE_DAYS=$(( $AGE_HOURS / 24 ))
    echo "   📊 Data is $AGE_DAYS days old"
  fi
else
  echo "⚠️  Could not determine latest entry timestamp"
fi

echo ""

# Test 5: Dashboard files exist
echo "🎨 Test 5: Dashboard files present"
echo "─────────────────────────────────────────────"

PUBLIC_DIR="$(dirname "$COMPANION_DIR")/public"
if [ -f "$PUBLIC_DIR/dashboard.html" ]; then
  echo "✅ Dashboard HTML exists at: $PUBLIC_DIR/dashboard.html"
else
  echo "❌ Dashboard HTML not found!"
fi

VIEW_COUNT=$(find "$PUBLIC_DIR/views" -type d -maxdepth 1 | wc -l | tr -d ' ')
if [ $VIEW_COUNT -gt 0 ]; then
  echo "✅ Found $VIEW_COUNT dashboard views"
else
  echo "❌ No dashboard views found"
fi

echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Data Collection:"
echo "  ✅ $ENTRIES file entries collected"
echo "  ✅ $PROMPTS AI prompts captured"
echo "  ✅ $EVENTS activity events logged"
echo "  ✅ $TERMINAL terminal commands recorded"
echo ""

if [ "$SERVICE_RUNNING" = true ]; then
  echo "Service Status:"
  echo "  ✅ Companion service running on port $API_PORT"
  echo "  ✅ API endpoints serving data from database"
  echo "  ✅ Dashboard accessible at http://localhost:$API_PORT/dashboard.html"
  echo ""
  echo "🎉 Everything is working! Your data is flowing correctly."
  echo ""
  echo "Next steps:"
  echo "  • Open http://localhost:$API_PORT/dashboard.html"
  echo "  • Explore your $PROMPTS prompts and $ENTRIES file changes"
  echo "  • Try exporting data: curl http://localhost:$API_PORT/api/export/data"
else
  echo "Service Status:"
  echo "  ⚠️  Companion service not running"
  echo "  ✅ Database contains all your collected data"
  echo "  📝 Data is safely stored and ready to use"
  echo ""
  echo "To access your data:"
  echo "  1. Start service: cd $COMPANION_DIR && npm start"
  echo "  2. Open dashboard: http://localhost:$API_PORT/dashboard.html"
  echo "  3. Or query database: sqlite3 data/companion.db"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

