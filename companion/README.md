# Cursor Companion Service

A privacy-preserving telemetry service for Cursor IDE that captures developer workflows, enables workflow analytics, and provides APIs for research and personalization.

## 🚀 Quick Install

### Option 1: npm (Recommended)

```bash
npm install -g cursor-companion
cursor-telemetry start
```

### Option 2: One-Line Installer

```bash
curl -fsSL https://raw.githubusercontent.com/hamidahoderinwale/cursor-telemetry/main/scripts/install-companion.sh | bash
```

### Option 3: From Source

```bash
git clone https://github.com/hamidahoderinwale/cursor-telemetry.git
cd cursor-telemetry/components/activity-logger/companion
npm install
npm start
```

## 📋 Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **Cursor IDE** (for telemetry capture)
- **Optional**: Redis (for caching), PostgreSQL (for production)

## ⚙️ Configuration

After installation, configure the service:

```bash
# Copy example config
cp env.example .env

# Edit configuration
nano .env  # or use your preferred editor
```

### Key Settings

```env
# Server Configuration
HOST=127.0.0.1
PORT=43917

# Optional: AI Features
OPENROUTER_API_KEY=your_key_here  # For semantic search
HF_TOKEN=your_token_here           # For model features

# Privacy Settings
PRIVACY_ENABLED=false
REDACT_NAMES=true
REDACT_EMAILS=true
```

## 🎯 Usage

### Start the Service

```bash
# Using npm global install
cursor-telemetry start

# Or from source directory
npm start

# Or using startup script
./scripts/startup.sh
```

### Access the Dashboard

Once running, open your browser to:
- **Analytics Dashboard**: http://localhost:43917/analytics-viz.html
- **MCP Search**: http://localhost:43917/mcp-search-dashboard.html
- **Health Check**: http://localhost:43917/health

### CLI Commands

```bash
# Check service health
cursor-telemetry health

# View database statistics
cursor-telemetry stats

# Export data
cursor-telemetry export json --limit 1000 -o data.json

# Export to Hugging Face
cursor-telemetry hf export --privacy clio --max 10000

# List privacy rungs
cursor-telemetry rungs list

# Show examples
cursor-telemetry examples
```

## 🔐 Privacy Levels (Rungs)

The service supports multiple privacy abstraction levels:

- **clio** (⭐⭐⭐⭐⭐) - Workflow patterns only (highest privacy)
- **module_graph** (⭐⭐⭐⭐) - File dependencies
- **functions** (⭐⭐⭐) - Function-level changes
- **semantic_edits** (⭐⭐) - Semantic edit operations
- **tokens** (⭐) - Tokens with PII redaction

Export at any level:
```bash
cursor-telemetry rungs export clio -o workflow-patterns.json
```

## 📊 Features

- **Real-time Telemetry Capture**: File changes, prompts, terminal commands
- **Privacy-Preserving Representations**: Multiple abstraction levels
- **Workflow Analytics**: Activity patterns, productivity metrics
- **MCP Integration**: Natural language workflow search
- **Data Export**: JSON, CSV, Hugging Face formats
- **RESTful API**: Full programmatic access

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run tests
npm test

# Format code
npm run format

# Check code quality
npm run check
```

## 📡 API Endpoints

### Analytics
- `GET /api/analytics/activity-over-time` - Activity timeline
- `GET /api/analytics/event-types` - Event type distribution
- `GET /api/analytics/model-usage` - AI model usage stats
- `GET /api/analytics/productivity` - Productivity metrics
- `GET /api/analytics/file-network` - File co-occurrence network

### Data Export
- `GET /api/export/database` - Export database as JSON
- `GET /api/export/csv` - Export as CSV
- `GET /api/huggingface/export` - Export in Hugging Face format

### MCP Search
- `POST /api/mcp/search_workflows` - Natural language workflow search
- `POST /api/mcp/retrieve_similar_sessions` - Find similar sessions
- `POST /api/mcp/query_by_intent` - Search by developer intent

See full API documentation at `/api/docs` when service is running.

## 🔧 Troubleshooting

### Service won't start

```bash
# Check if port is already in use
lsof -i :43917

# Kill existing process
pkill -f "node src/index.js"

# Check logs
tail -f companion.log
```

### Database issues

```bash
# Check database size
cursor-telemetry stats

# Shrink database (removes old data)
npm run shrink-db

# Reset database (⚠️ deletes all data)
rm src/data/companion.db
```

### Permission errors

```bash
# Make scripts executable
chmod +x scripts/*.sh
chmod +x cli.js
```

## 📚 Documentation

- [Implementation Summary](./IMPLEMENTATION_SUMMARY.md)
- [MCP Search & Optimization](./MCP_SEARCH_AND_OPTIMIZATION.md)
- [API Documentation](http://localhost:43917/api/docs) (when running)

## 🤝 Contributing

Contributions welcome! Please see the main repository for contribution guidelines.

## 📄 License

MIT License - see LICENSE file for details

## 🔗 Links

- **GitHub**: https://github.com/hamidahoderinwale/cursor-telemetry
- **Author**: [Hamidah Oderinwale](https://hamidah.me/)
- **Dashboard**: http://localhost:43917/analytics-viz.html

## 💬 Support

For issues and questions:
- Open an issue on GitHub
- Check the [troubleshooting](#-troubleshooting) section
- Review the [documentation](#-documentation)

