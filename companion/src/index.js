#!/usr/bin/env node

const path = require('path');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const NodeCache = require('node-cache');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');

// Load environment variables
require('dotenv').config();

// Core dependencies
const PersistentDB = require('./database/persistent-db.js');
const CursorDatabaseParser = require('./database/cursor-db-parser.js');
const IDEStateCapture = require('./monitors/ide-state-capture.js');
const PromptCaptureSystem = require('./capture/prompt-capture-system.js');
const TerminalMonitor = require('./monitors/terminal-monitor.js');
const createFileWatcherService = require('./services/file-watcher-service.js');
const WorkspaceDiscoveryService = require('./services/workspace-discovery.js');
const { queue: queueSystem } = require('./utils/queue.js');
const AbstractionEngine = require('./services/abstraction/abstraction-engine.js');

// Routes
const createCoreRoutes = require('./routes/core.js');
const createWorkspaceRoutes = require('./routes/workspace.js');
const createRawDataRoutes = require('./routes/raw-data.js');
const createIDEStateRoutes = require('./routes/ide-state.js');
const createDatabaseRoutes = require('./routes/database.js');
const createTerminalRoutes = require('./routes/terminal.js');
const createStatusRoutes = require('./routes/status.js');
const createActivityRoutes = require('./routes/activity.js');
const createPromptRoutes = require('./routes/prompts.js');
const createFileContentsRoutes = require('./routes/file-contents.js');
const createMCPRoutes = require('./routes/mcp.js');
const createExportImportRoutes = require('./routes/export-import.js');
const createHuggingFaceRoutes = require('./routes/huggingface.js');
const createRung1Routes = require('./routes/rung1.js');
const createRung2Routes = require('./routes/rung2.js');
const createRung3Routes = require('./routes/rung3.js');

// Services
const TokensService = require('./services/tokens/tokens-service.js');
const EditsService = require('./services/edits/edits-service.js');
const FunctionsService = require('./services/functions/functions-service.js');
const RobustDataCaptureService = require('./services/robust-data-capture');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Cache
const queryCache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

// Initialize Database
const persistentDB = new PersistentDB();
const cursorDbParser = new CursorDatabaseParser();
const abstractionEngine = new AbstractionEngine();

// In-memory DB for backward compatibility
const db = {
  _entries: [],
  _prompts: [],
  nextId: 1,
  get entries() { return this._entries; },
  set entries(val) { this._entries = val; },
  get prompts() { return this._prompts; },
  set prompts(val) { this._prompts = val; },
  async add(table, data) {
    const item = { ...data, id: this.nextId++ };
    this[table].push(item);
    try {
      if (table === 'entries') await persistentDB.saveEntry(item);
      else if (table === 'prompts') await persistentDB.savePrompt(item);
    } catch (e) { console.error(`Error persisting ${table}:`, e); }
    return item;
  }
};

// Raw Data Fallback
const rawData = {
  systemResources: [],
  gitData: { status: [] },
  cursorDatabase: { conversations: [] },
  appleScript: { appState: [] },
  logs: { cursor: [] }
};

// Initialize Monitors
const terminalMonitor = new TerminalMonitor({ captureOutput: false });
const ideStateCapture = new IDEStateCapture();
const workspaceDiscovery = new WorkspaceDiscoveryService();

// Enqueue Helper
let sequence = 0;
const queue = [];
function enqueue(kind, payload) {
  const item = { seq: ++sequence, kind, payload };
  queue.push(item);
  if (kind === 'entry') db.entries.push(payload);
  else if (kind === 'event') {
    db._prompts.push(payload); // legacy
    persistentDB.saveEvent(payload).catch(e => console.error('Event save error:', e));
  }
  io.emit('activityUpdate', { type: kind, data: payload });
}

// Initialize Services
let robustDataCapture = new RobustDataCaptureService(persistentDB, rawData);
const tokensService = new TokensService(cursorDbParser, persistentDB);
const editsService = new EditsService(cursorDbParser, persistentDB);
const functionsService = new FunctionsService(cursorDbParser, persistentDB);

const fileWatcherService = createFileWatcherService({
  db,
  persistentDB,
  queueSystem,
  enqueue,
  io,
  broadcastUpdate: (type, data) => io.emit('activityUpdate', { type, data })
});

// Setup Routes
const deps = {
  app, db, persistentDB, cursorDbParser, queryCache, queue, sequence,
  rawData, queueSystem, robustDataCapture, terminalMonitor, ideStateCapture,
  tokensService, editsService, functionsService, abstractionEngine
};

createCoreRoutes(deps);
createWorkspaceRoutes(deps);
createRawDataRoutes(deps);
createIDEStateRoutes(deps);
createDatabaseRoutes(deps);
createTerminalRoutes(deps);
createStatusRoutes(deps);
createActivityRoutes({ ...deps, calculateDiff: fileWatcherService.calculateDiff.bind(fileWatcherService) });
createPromptRoutes({ ...deps, getCurrentWorkspace: () => os.homedir() });
createFileContentsRoutes(deps);
createMCPRoutes({ ...deps, getCurrentWorkspace: () => os.homedir(), broadcastUpdate: (type, data) => io.emit('activityUpdate', { type, data }) });
createExportImportRoutes(deps);
createHuggingFaceRoutes(deps);
createRung1Routes(deps);
createRung2Routes(deps);
createRung3Routes(deps);

// Start Capture
async function startCapture() {
  console.log('[COMPANION] Starting capture...');
  await robustDataCapture.init();
  ideStateCapture.start(2000);
  fileWatcherService.start();

  // Basic intervals
  setInterval(() => {
    // Sync logic (simplified)
    cursorDbParser.extractAllAIServiceData().then(prompts => {
      (prompts || []).forEach(p => {
        // Simple incremental sync
        if (!db.prompts.find(existing => existing.id === p.id)) {
          db.add('prompts', p);
        }
      });
    });
  }, 30000);
}

// Socket.IO
io.on('connection', (socket) => {
  socket.emit('initial-data', { entries: db.entries, prompts: db.prompts });
});

// Start Server
const PORT = process.env.PORT || 43917;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[COMPANION] Bare bone terminal version running on port ${PORT}`);
  startCapture();
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});
