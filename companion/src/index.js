#!/usr/bin/env node

const path = require('path');
const DBSizeGuard = require('./utils/db-size-guard.js');

// Load environment variables from .env file (if available)
// In production (Render, Railway, Docker, etc.), environment variables are set directly
// and .env files are not needed
const isProduction = process.env.NODE_ENV === 'production';
const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_NAME;
const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;

if (!isProduction && !isRender && !isRailway) {
  // Only try to load .env in development
  const primaryEnvPath = process.env.HOME
    ? path.join(process.env.HOME, 'new_cursor', '.env')
    : null;
  const companionEnvPath = path.resolve(__dirname, '../.env');
  const workspaceEnvPath = path.resolve(__dirname, '../../../../../.env');

  let envLoaded = false;

  // Try primary location first
  if (primaryEnvPath) {
    const primaryResult = require('dotenv').config({ path: primaryEnvPath });
    if (!primaryResult.error) {
      console.log(`[ENV] ✓ Loaded .env from primary location: ${primaryEnvPath}`);
      envLoaded = true;
    }
  }

  // Fallback to companion directory if primary not found
  if (!envLoaded) {
    const companionResult = require('dotenv').config({ path: companionEnvPath });
    if (!companionResult.error) {
      console.log(`[ENV] ✓ Loaded .env from companion directory: ${companionEnvPath}`);
      envLoaded = true;
    }
  }

  // Fallback to workspace root calculation if neither found
  if (!envLoaded) {
    const workspaceResult = require('dotenv').config({ path: workspaceEnvPath });
    if (!workspaceResult.error) {
      console.log(`[ENV] ✓ Loaded .env from calculated workspace root: ${workspaceEnvPath}`);
    } else {
      console.log(`[ENV] No .env file found - using environment variables directly`);
    }
  }
} else {
  console.log(`[ENV] Production mode - using environment variables directly`);
}

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const NodeCache = require('node-cache');
const http = require('http');
const chokidar = require('chokidar');
const fs = require('fs');
const crypto = require('crypto');
const lunr = require('lunr'); // Import lunr
// Import the new queue system and clipboard monitor
const { queue: queueSystem } = require('./utils/queue.js');
const { clipboardMonitor } = require('./monitors/clipboardMonitor.js');

// Initialize query cache (30 second TTL, check every 60s for expired)
const queryCache = new NodeCache({
  stdTTL: 30,
  checkperiod: 60,
  useClones: false, // Better performance, less memory
});

// Initialize Redis cache for high-performance caching (falls back to NodeCache if Redis unavailable)
const RedisCache = require('./utils/redis-cache.js');
const redisCache = new RedisCache({
  ttl: 60, // Default 60 seconds
  prefix: 'cursor:', // Namespace prefix
});

// Initialize stats table for denormalized statistics
const StatsTable = require('./database/stats-table.js');

// Enhanced raw data capture modules
const os = require('os');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import IDE state capture service
const IDEStateCapture = require('./monitors/ide-state-capture.js');

// Import prompt capture system
const PromptCaptureSystem = require('./capture/prompt-capture-system.js');

// Import Cursor database parser
const CursorDatabaseParser = require('./database/cursor-db-parser.js');

// Import screenshot monitor
const ScreenshotMonitor = require('./monitors/screenshot-monitor.js');

// Import image processor and plot services
const ImageProcessor = require('./processors/image-processor.js');
const PlotService = require('./services/plot-service.js');
const PlotFileMonitor = require('./monitors/plot-file-monitor.js');

// Import persistent database
const PersistentDB = require('./database/persistent-db.js');

// Import schema migrations
const SchemaMigrations = require('./database/schema-migrations.js');

// Import analytics modules
const ContextAnalyzer = require('./analytics/context-analyzer.js');
const ContextChangeTracker = require('./analytics/context-change-tracker.js');
const ErrorTracker = require('./analytics/error-tracker.js');
const ProductivityTracker = require('./analytics/productivity-tracker.js');
const AbstractionEngine = require('./analytics/abstraction-engine.js');

// Import monitor modules
const StatusMessageTracker = require('./monitors/status-message-tracker.js');
const TerminalMonitor = require('./monitors/terminal-monitor.js');

// Import service modules
const DataCaptureService = require('./services/data-capture.js');
const SessionManager = require('./services/session-manager.js');
const createFileWatcherService = require('./services/file-watcher-service.js');
const createDbRepairService = require('./services/db-repair.js');
const createStartupService = require('./services/startup.js');
const WorkspaceDiscoveryService = require('./services/workspace-discovery.js');

// Import utility modules
const { extractModelInfo } = require('./utils/model-detector.js');
const { getPerformanceMonitor } = require('./utils/performance-monitor.js');
const CacheInvalidationManager = require('./utils/cache-invalidation.js');

// Import route modules
const createCoreRoutes = require('./routes/core.js');
const createWorkspaceRoutes = require('./routes/workspace.js');
const createRawDataRoutes = require('./routes/raw-data.js');
const createIDEStateRoutes = require('./routes/ide-state.js');
const createAnalyticsRoutes = require('./routes/analytics.js');
const createEnhancedAnalyticsRoutes = require('./routes/analytics-enhanced.js');
const createDatabaseRoutes = require('./routes/database.js');
const createSchemaRoutes = require('./routes/schema.js');
const createTerminalRoutes = require('./routes/terminal.js');
const createTodosRoutes = require('./routes/todos.js');
const createStatusRoutes = require('./routes/status.js');
const createActivityRoutes = require('./routes/activity.js');
const createScreenshotRoutes = require('./routes/screenshots.js');
const createPromptRoutes = require('./routes/prompts.js');
const createMiscRoutes = require('./routes/misc.js');
const createFileContentsRoutes = require('./routes/file-contents.js');
const createMCPRoutes = require('./routes/mcp.js');
const createOptimizationRoutes = require('./routes/optimization.js');
const createExportImportRoutes = require('./routes/export-import.js');
const createSharingRoutes = require('./routes/sharing.js');
const createHistoricalMiningRoutes = require('./routes/historical-mining.js');
const createCombinedTimelineRoutes = require('./routes/combined-timeline.js');
const createHuggingFaceRoutes = require('./routes/huggingface.js');
const setupAccountRoutes = require('./routes/account.js');
const createWhiteboardRoutes = require('./routes/whiteboard.js');
const createAIRoutes = require('./routes/ai.js');
const createConversationRoutes = require('./routes/conversations.js');
const createAnnotationRoutes = require('./routes/annotations.js');
const createStateRoutes = require('./routes/states.js');
const createPlotRoutes = require('./routes/plots.js');
const createPermissionRoutes = require('./routes/permissions.js');
const { createGraphPrecomputeRoutes } = require('./routes/graph-precompute.js');
const initializeMotifService = require('./services/motif-service-init.js');
const PermissionChecker = require('./services/permission-checker.js');
const SharingService = require('./services/sharing-service.js');
const HistoricalMiningService = require('./services/historical-mining-service.js');
const HuggingFaceUploadService = require('./services/huggingface-upload-service.js');
const AutomaticMiningScheduler = require('./services/automatic-mining-scheduler.js');
const CombinedTimelineService = require('./services/combined-timeline-service.js');
const ConversationManager = require('./services/conversation-manager.js');
const ConversationCapture = require('./services/conversation-capture.js');
const ConversationContext = require('./services/conversation-context.js');

// Import new system services
const DataRetentionService = require('./services/data-retention.js');
const ExportHistoryService = require('./services/export-history.js');
const UserPreferencesService = require('./services/user-preferences.js');

// Import new system routes
const { createRetentionRoutes } = require('./routes/system/retention.js');
const { createExportHistoryRoutes } = require('./routes/system/export-history.js');
const { createPreferencesRoutes } = require('./routes/system/preferences.js');

// New architecture components (available for gradual migration)
const serviceContainer = require('./core/service-container.js');
const DataAccessService = require('./services/data-access/data-access-service.js');
// const { registerAllRoutes } = require('./routes/index.js'); // Uncomment when ready to migrate

// Initialize persistent database
const persistentDB = new PersistentDB();
// DB size guard for gating heavy operations (Rung2, repairs, etc.)
const dbSizeGuard = new DBSizeGuard(persistentDB.dbPath);

// Initialize schema migrations
const schemaMigrations = new SchemaMigrations(persistentDB);

// Initialize sharing service (will be updated with account service after routes setup)
let sharingService = new SharingService(persistentDB);
const huggingFaceUploadService = new HuggingFaceUploadService();

// Initialize historical mining service
const historicalMiningService = new HistoricalMiningService(persistentDB, {
  gitHistoryDays: 365,
  includeDiffs: false,
  maxCommits: 10000,
  verbose: true,
});

// Initialize automatic mining scheduler
const automaticMiningScheduler = new AutomaticMiningScheduler(
  historicalMiningService,
  persistentDB,
  {
    enableAutoMining: process.env.AUTO_MINING_ENABLED !== 'false',
    mineOnWorkspaceDetection: true,
    scheduleWeeklyBackfill: true,
    weeklyBackfillDay: 0, // Sunday
    weeklyBackfillHour: 2, // 2 AM
  }
);

// Initialize automatic Hugging Face sync service
const AutomaticHuggingFaceSyncService = require('./services/automatic-hf-sync-service.js');
const automaticHfSyncService = new AutomaticHuggingFaceSyncService(
  persistentDB,
  huggingFaceUploadService,
  {
    enabled: process.env.HF_AUTO_SYNC_ENABLED === 'true',
    syncInterval: process.env.HF_SYNC_INTERVAL || '0 */6 * * *', // Every 6 hours
    privacyLevel: process.env.HF_SYNC_PRIVACY_LEVEL || 'clio',
    includeCode: process.env.HF_SYNC_INCLUDE_CODE !== 'false',
    includePrompts: process.env.HF_SYNC_INCLUDE_PROMPTS !== 'false',
    anonymize: process.env.HF_SYNC_ANONYMIZE !== 'false',
    maxSamples: parseInt(process.env.HF_SYNC_MAX_SAMPLES) || 10000,
    incrementalSync: process.env.HF_SYNC_INCREMENTAL !== 'false',
    autoCleanup: process.env.HF_SYNC_AUTO_CLEANUP !== 'false',
  }
);

// Initialize stats table (initialized later after persistentDB is ready)
let statsTable = null;

// Initialize new system services
const dataRetentionService = new DataRetentionService(persistentDB);
const exportHistoryService = new ExportHistoryService(persistentDB);
const userPreferencesService = new UserPreferencesService(persistentDB);

// Initialize combined timeline service
const combinedTimelineService = new CombinedTimelineService(persistentDB);

// Initialize analytics trackers
const contextAnalyzer = new ContextAnalyzer(persistentDB);
const contextChangeTracker = new ContextChangeTracker(persistentDB);
const statusMessageTracker = new StatusMessageTracker(persistentDB);
const errorTracker = new ErrorTracker();
const productivityTracker = new ProductivityTracker();

// Initialize data access control (will be configured after config is loaded)
let dataAccessControl = null;

// Procedural knowledge builder (optional - will be initialized later if enabled)
let proceduralKnowledgeBuilder = null;

const terminalMonitor = new TerminalMonitor({
  captureOutput: false, // Don't execute commands, just monitor
  debug: false,
});

const abstractionEngine = new AbstractionEngine();

// Simple in-memory database for companion service (with persistent backup)
const db = {
  _entries: [],
  _prompts: [],
  nextId: 1,

  get entries() {
    return this._entries;
  },
  set entries(val) {
    this._entries = val;
  },

  get prompts() {
    return this._prompts;
  },
  set prompts(val) {
    this._prompts = val;
  },

  async add(table, data) {
    const item = { ...data, id: this.nextId++ };
    this[table].push(item);

    // Persist to disk
    try {
      if (table === 'entries') {
        await persistentDB.saveEntry(item);
        // Notify procedural knowledge builder
        if (
          proceduralKnowledgeBuilder &&
          typeof proceduralKnowledgeBuilder.notifyDataCaptured === 'function'
        ) {
          proceduralKnowledgeBuilder.notifyDataCaptured('entries', 1);
        }
      } else if (table === 'prompts') {
        await persistentDB.savePrompt(item);
        // Notify procedural knowledge builder
        if (
          proceduralKnowledgeBuilder &&
          typeof proceduralKnowledgeBuilder.notifyDataCaptured === 'function'
        ) {
          proceduralKnowledgeBuilder.notifyDataCaptured('prompts', 1);
        }
      }
    } catch (error) {
      console.error(`Error persisting ${table} item:`, error);
    }

    return item;
  },

  async update(table, id, updates) {
    const index = this[table].findIndex((item) => item.id === id);
    if (index >= 0) {
      this[table][index] = { ...this[table][index], ...updates };

      // Persist to disk
      try {
        if (table === 'entries') {
          await persistentDB.updateEntry(id, updates);
        } else if (table === 'prompts') {
          await persistentDB.updatePrompt(id, updates);
        }
      } catch (error) {
        console.error(`Error updating ${table} item:`, error);
      }

      return this[table][index];
    }
    return null;
  },
};

const PORT = process.env.PORT || 43917;
// Railway and other cloud platforms need 0.0.0.0 to accept external connections
const HOST = process.env.HOST || (isRailway || isRender || isProduction ? '0.0.0.0' : 'localhost');
const app = express();
const { Server } = require('socket.io');

// Create HTTP server and Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Track active conversation streams (defined early for use in broadcast functions)
const conversationStreams = new Map();

// Real-time broadcast function with cache invalidation
function broadcastUpdate(type, data) {
  io.emit('activityUpdate', { type, data });

  // Invalidate relevant caches when data changes (using tag-based invalidation)
  if (type === 'file-change' || type === 'new-entry') {
    invalidateCacheByTag('activity', 'entries', 'events');
    invalidateCache('context_');
    invalidateCache('productivity_');
  } else if (type === 'prompt' || type === 'ai-interaction') {
    invalidateCacheByTag('activity', 'prompts');
    invalidateCache('context_');
  } else if (type === 'error') {
    invalidateCache('error_');
  }
}

// Helper function to broadcast conversation updates to subscribed clients
function broadcastConversationUpdate(conversationId, data) {
  const stream = conversationStreams.get(conversationId);
  if (stream && stream.subscribers) {
    stream.subscribers.forEach((socketId) => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.emit('conversation-stream', {
          conversation_id: conversationId,
          data: data,
          timestamp: Date.now(),
        });
      }
    });

    // Update stream stats
    stream.messageCount++;
  }
}

// Middleware
// OPTIMIZATION: Enhanced compression with better settings for large payloads
app.use(
  compression({
    level: 6, // Balance between compression and CPU (1-9, 6 is good default)
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
      // Compress JSON and text responses
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);
// CORS configuration - explicitly allow all origins and methods
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false, // No credentials needed for local API
  })
);

// Handle preflight requests
app.options('*', cors());

// Performance monitoring middleware
const performanceMonitor = getPerformanceMonitor({
  enabled: process.env.PERFORMANCE_MONITORING !== 'false', // Enabled by default
  logSlowRequests: true,
  slowRequestThreshold: parseInt(process.env.SLOW_REQUEST_THRESHOLD) || 1000, // 1 second
  logSlowQueries: true,
  slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD) || 100, // 100ms
  monitorMemory: true,
  memoryInterval: parseInt(process.env.MEMORY_MONITOR_INTERVAL) || 60000, // 1 minute
});
app.use(performanceMonitor.requestMiddleware());

app.use(express.json({ limit: '10mb' })); // Increase JSON payload limit

// Serve static files from public directory with explicit MIME types and caching
const publicPath = path.join(__dirname, '../../public');
app.use(
  express.static(publicPath, {
    maxAge: '1h', // Cache static assets for 1 hour
    etag: true, // Enable ETags for cache validation
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css');
      } else if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      }
      // Add cache headers for immutable assets
      if (filePath.includes('/lib/') || filePath.includes('/dist/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  })
);
console.log(`[FILE] Serving static files from: ${publicPath}`);

let ideStateCapture = new IDEStateCapture(); // Changed from const to let
ideStateCapture.start(); // Start capturing IDE state

// Initialize Cursor database parser
let cursorDbParser = new CursorDatabaseParser();

// Initialize screenshot monitor
// Initialize image processor
const imageProcessor = new ImageProcessor({
  thumbnailDir: path.join(__dirname, '../data/thumbnails'),
});

// Initialize plot service
const plotService = new PlotService(persistentDB, {
  imageProcessor: imageProcessor,
});

// Initialize screenshot monitor with image processor
let screenshotMonitor = new ScreenshotMonitor({
  imageProcessor: imageProcessor,
  processImages: true,
});

// Initialize plot file monitor
let plotFileMonitor = new PlotFileMonitor(plotService, {
  commonDirs: [
    'plots',
    'figures',
    'images',
    'output',
    'results',
    'visualizations',
    'charts',
    'graphs',
  ],
});

// Set up terminal command plot detection
terminalMonitor.removeAllListeners('command');
terminalMonitor.on('command', async (commandRecord) => {
  if (!plotService) return;

  try {
    const command = commandRecord.command || '';
    const workspace = commandRecord.workspace || process.cwd();

    // Detect Python scripts that might generate plots
    if (command.includes('python') || command.includes('python3')) {
      // Extract script path from command
      const scriptMatch = command.match(/python(?:3)?\s+([^\s]+\.py)/);
      if (scriptMatch) {
        const scriptPath = path.isAbsolute(scriptMatch[1])
          ? scriptMatch[1]
          : path.join(workspace, scriptMatch[1]);

        if (fs.existsSync(scriptPath)) {
          // Read script and detect plot patterns
          const scriptContent = fs.readFileSync(scriptPath, 'utf8');
          const result = await plotService.detectPlotsFromCode(scriptContent, scriptPath, {
            workspacePath: workspace,
          });

          if (result.success && result.detectedPaths.length > 0) {
            console.log(
              `[PLOT] Detected ${result.detectedPaths.length} plot patterns in terminal command: ${command}`
            );
          }
        }
      }
    }

    // Detect Jupyter notebook execution
    if (command.includes('jupyter') && command.includes('.ipynb')) {
      const notebookMatch = command.match(/([^\s]+\.ipynb)/);
      if (notebookMatch) {
        const notebookPath = path.isAbsolute(notebookMatch[1])
          ? notebookMatch[1]
          : path.join(workspace, notebookMatch[1]);

        if (fs.existsSync(notebookPath)) {
          // Process notebook for plots after a delay (to allow execution to complete)
          setTimeout(async () => {
            const result = await plotService.processNotebook(notebookPath, {
              workspacePath: workspace,
              autoTrack: true,
            });

            if (result.success && result.count > 0) {
              console.log(
                `[PLOT] Extracted ${result.count} plots from executed notebook: ${notebookMatch[1]}`
              );
            }
          }, 5000); // Wait 5 seconds for notebook execution
        }
      }
    }
  } catch (error) {
    console.warn(`[PLOT] Error detecting plots from terminal command: ${error.message}`);
  }
});

// Start screenshot monitoring with callback
screenshotMonitor.start((action, screenshotData) => {
  // Link screenshots to recent prompts/events
  if (action === 'added') {
    console.log(`Screenshot captured: ${screenshotData.fileName}`);

    // Find prompts/events near this time
    const recentPrompts = db.prompts.filter((p) => {
      const promptTime = new Date(p.timestamp).getTime();
      const screenshotTime = new Date(screenshotData.timestamp).getTime();
      return Math.abs(screenshotTime - promptTime) <= 5 * 60 * 1000; // 5 minutes
    });

    // Link screenshot to prompts
    recentPrompts.forEach((prompt) => {
      screenshotMonitor.linkScreenshotToEvent(screenshotData.id, prompt.id, 'prompt');
    });
  }
});

// IDE state routes are now handled by route modules (see above)

// Simple in-memory storage with numeric sequence cursor
let entries = [];
let events = [];
let sequence = 0;
let queue = []; // { seq, kind: 'entry'|'event', payload }

let lunrIndex; // Lunr index instance
let indexedDocs = []; // Array to store documents added to the index

// Enhanced raw data storage
let rawData = {
  fileSystem: {
    changes: [],
    access: [],
    structure: [],
  },
  systemResources: [],
  gitData: {
    status: [],
    commits: [],
    changes: [],
  },
  cursorDatabase: {
    conversations: [],
    chatHistory: [],
    fileContexts: [],
  },
  appleScript: {
    appState: [],
    editorState: [],
    debugState: [],
  },
  logs: {
    cursor: [],
    extensions: [],
    errors: [],
  },
};

// Initialize session manager (pass cursorDbParser so it can use UI state)
const sessionManager = new SessionManager(cursorDbParser);

// Wrapper functions for backward compatibility
function createNewSession() {
  return sessionManager.createNewSession();
}

function checkSessionTimeout() {
  sessionManager.checkSessionTimeout();
}

function updateActivityTime() {
  sessionManager.updateActivityTime();
}

async function detectWorkspace(filePath) {
  return await sessionManager.detectWorkspace(filePath);
}

function getWorkspaceSession(workspacePath) {
  return sessionManager.getWorkspaceSession(workspacePath);
}

function updateWorkspaceData(workspacePath, entry, event) {
  sessionManager.updateWorkspaceData(workspacePath, entry, event);
}

// Helper for current workspace path (used by various capture functions)
function getCurrentWorkspace() {
  return sessionManager.currentWorkspace || process.cwd();
}

// Expose for route modules
const currentWorkspace = () => sessionManager.currentWorkspace;
const workspaceSessions = sessionManager.workspaceSessions;
const workspaceData = sessionManager.workspaceData;
const knownWorkspaces = sessionManager.knownWorkspaces;
const activeSession = () => sessionManager.activeSession;

// Privacy filtering functions
function shouldCaptureData(content, type) {
  if (!privacyConfig.enabled || !privacyConfig.consentGiven) {
    return true; // Capture everything if privacy not enabled
  }

  // Check sensitivity level
  if (privacyConfig.sensitivityLevel === 'high' && type === 'clipboard') {
    return false; // Don't capture clipboard for high sensitivity
  }

  return true;
}

function applyPrivacyRedaction(content) {
  if (!privacyConfig.enabled || !privacyConfig.consentGiven) {
    return content; // No redaction if privacy not enabled
  }

  let redactedContent = content;

  // Redact names
  if (privacyConfig.redactNames) {
    redactedContent = redactedContent.replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g, '[NAME]');
  }

  // Redact emails
  if (privacyConfig.redactEmails) {
    redactedContent = redactedContent.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      '[EMAIL]'
    );
  }

  // Redact numbers
  if (privacyConfig.redactNumbers) {
    redactedContent = redactedContent.replace(/\b\d+(?:\.\d+)?\b/g, '[NUMBER]');
  }

  // Redact file paths
  if (privacyConfig.redactFilePaths) {
    redactedContent = redactedContent.replace(
      /(?:[a-zA-Z]:)?[\\\/](?:[^\\\/\n]+[\\\/])*[^\\\/\n]*/g,
      '[FILEPATH]'
    );
  }

  // Redact JWT tokens and secrets
  if (privacyConfig.redactJwtSecrets) {
    // Redact full JWT tokens (header.payload.signature)
    redactedContent = redactedContent.replace(
      /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b/g,
      '[JWT_TOKEN]'
    );

    // Redact JWT/JWST secrets in environment variables or assignments
    redactedContent = redactedContent.replace(
      /(?:jwt|jwst)[_-]?(?:secret|key|token|signing[_-]?key)[=:]\s*['"`]([^'"`]{20,})['"`]/gi,
      (match, secret) => {
        const prefix = match.substring(0, match.indexOf(secret));
        return prefix + '[JWT_SECRET]' + match.substring(match.indexOf(secret) + secret.length);
      }
    );

    // Redact high entropy strings that could be JWT secrets (32-512 chars, base64url-like)
    redactedContent = redactedContent.replace(/\b([A-Za-z0-9+/]{32,512})={0,2}\b/g, (match) => {
      // Only redact if it looks like a secret (high entropy, not part of a larger structure)
      // Skip if it's part of a URL, email, or other known pattern
      if (
        !match.includes('@') &&
        !match.includes('://') &&
        !match.includes('/') &&
        match.length >= 32 &&
        match.length <= 512
      ) {
        return '[JWT_SECRET]';
      }
      return match;
    });
  }

  return redactedContent;
}

// Enqueue function for reliable queuing
function enqueue(kind, payload) {
  // Apply privacy filtering
  if (!shouldCaptureData(payload.content || payload.data || '', kind)) {
    console.log(` Privacy filter blocked ${kind} capture`);
    return;
  }

  // Apply privacy redaction
  if (payload.content) {
    payload.content = applyPrivacyRedaction(payload.content);
  }
  if (payload.data) {
    payload.data = applyPrivacyRedaction(payload.data);
  }

  const item = { seq: ++sequence, kind, payload };
  queue.push(item);

  // Also maintain the old arrays for backward compatibility
  if (kind === 'entry') {
    entries.push(payload);
  } else if (kind === 'event') {
    events.push(payload);
    // Persist events to disk
    persistentDB
      .saveEvent(payload)
      .then(() => {
        // Notify procedural knowledge builder
        if (
          proceduralKnowledgeBuilder &&
          typeof proceduralKnowledgeBuilder.notifyDataCaptured === 'function'
        ) {
          proceduralKnowledgeBuilder.notifyDataCaptured('events', 1);
        }
      })
      .catch((err) => console.error('Error persisting event:', err.message));

    // Annotate event asynchronously (non-blocking)
    if (process.env.OPENROUTER_API_KEY) {
      setTimeout(async () => {
        try {
          const EventAnnotationService = require('./services/event-annotation-service.js');
          const annotationService = new EventAnnotationService();

          // Get recent events for context
          const recentEvents = events.slice(-5).filter((e) => e.id !== payload.id);

          const annotation = await annotationService.annotateEvent(payload, {
            recentEvents,
          });

          if (annotation) {
            // Update event with annotation
            payload.annotation = annotation;
            payload.ai_generated = true;
            await persistentDB.saveEvent(payload);

            // Broadcast update
            broadcastUpdate('event-annotated', { eventId: payload.id, annotation });
          }
        } catch (error) {
          // Silently fail - annotation is optional
          console.debug('[ANNOTATION] Could not annotate event:', error.message);
        }
      }, 100); // Small delay to avoid blocking
    }
  }

  console.log(`� Enqueued ${kind} #${sequence}: ${payload.id || payload.type}`);
  updateLunrIndex(item); // Update Lunr index with the new item
}

// Lunr indexing functions
function addToLunrIndex(item) {
  if (!lunrIndex) return;

  let doc = {};
  if (item.kind === 'entry') {
    doc = {
      id: item.payload.id,
      content:
        item.payload.prompt +
        ' ' +
        item.payload.response +
        ' ' +
        item.payload.before_code +
        ' ' +
        item.payload.after_code,
      filePath: item.payload.file_path,
      type: 'entry',
    };
  } else if (item.kind === 'event') {
    doc = {
      id: item.payload.id,
      content: item.payload.details ? JSON.stringify(item.payload.details) : '',
      filePath: item.payload.details ? JSON.parse(item.payload.details).file_path : '',
      type: item.payload.type,
    };
  }

  if (doc.id) {
    indexedDocs.push(doc); // Keep track of indexed documents for retrieval
    console.log(`[SEARCH] Added ${item.kind} ${item.payload.id} to Lunr index.`);
  }
}

function buildLunrIndex() {
  lunrIndex = lunr(function () {
    this.ref('id');
    this.field('content');
    this.field('filePath');
    this.field('type');
  });

  // Add existing entries and events to the index
  entries.forEach((entry) => {
    addToLunrIndex({
      kind: 'entry',
      payload: entry,
    });
  });

  events.forEach((event) => {
    addToLunrIndex({
      kind: 'event',
      payload: event,
    });
  });

  console.log(
    `[SEARCH] Lunr index built with ${entries.length} entries and ${events.length} events.`
  );
}

function updateLunrIndex(item) {
  // In Lunr 2.x, we need to rebuild the index when adding new documents
  // This is not ideal for performance, but it's the only way with this version
  try {
    buildLunrIndex();
    console.log(`[SEARCH] Rebuilt Lunr index with new ${item.kind} ${item.payload.id}.`);
  } catch (error) {
    console.error('Error rebuilding Lunr index:', error);
  }
}

// File watcher state
// File watcher is now handled by fileWatcherService (see above)

// Enhanced data capture intervals
let captureIntervals = {
  systemResources: null,
  gitStatus: null,
  appleScript: null,
  cursorDatabase: null,
  logs: null,
};

// IDE state capture service

// Prompt capture system
// promptCaptureSystem will be initialized later in startRawDataCapture

// System resource monitoring - resilient to permission errors
let systemResourceErrorLogged = false;
let robustDataCapture = null; // Will be initialized in startRawDataCapture

async function captureSystemResources() {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Wrap potentially permission-blocked calls in try-catch
    let loadAvg = [0, 0, 0];
    let cpuCores = 1;
    let freeMemory = 0;
    let totalMemory = 0;
    let uptime = 0;

    try {
      loadAvg = os.loadavg();
    } catch (e) {
      /* sandboxed */
    }
    try {
      cpuCores = os.cpus().length;
    } catch (e) {
      /* sandboxed */
    }
    try {
      freeMemory = os.freemem();
    } catch (e) {
      /* sandboxed */
    }
    try {
      totalMemory = os.totalmem();
    } catch (e) {
      /* sandboxed */
    }
    try {
      uptime = os.uptime();
    } catch (e) {
      /* sandboxed - EPERM on macOS sandbox */
    }

    const resourceData = {
      timestamp: Date.now(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      system: {
        loadAverage: loadAvg,
        cpuCores: cpuCores,
        freeMemory: freeMemory,
        totalMemory: totalMemory,
        uptime: uptime,
        platform: os.platform(),
        arch: os.arch(),
      },
    };

    // Store in memory (for backward compatibility)
    rawData.systemResources.push(resourceData);
    if (rawData.systemResources.length > 1000) {
      rawData.systemResources = rawData.systemResources.slice(-1000);
    }

    // Persist to database using robust capture service
    if (robustDataCapture) {
      robustDataCapture.captureSystemResources(resourceData).catch((err) => {
        // Silent fail - don't spam logs
        if (!systemResourceErrorLogged) {
          console.warn('[DATA] Failed to persist system resources to database:', err.message);
        }
      });
    }

    console.log(
      `[DATA] Captured system resources: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB memory`
    );
  } catch (error) {
    // Only log the error once to avoid spam
    if (!systemResourceErrorLogged) {
      systemResourceErrorLogged = true;
      console.warn(
        '[DATA] System resource capture limited due to sandbox restrictions. Grant Cursor Full Disk Access in System Settings > Privacy & Security.'
      );
    }
  }
}

// Git data capture
async function captureGitData() {
  try {
    // Get git status
    const { stdout: gitStatus } = await execAsync('git status --porcelain');
    const { stdout: gitBranch } = await execAsync('git branch --show-current');
    const { stdout: gitLog } = await execAsync('git log --oneline -10');

    const gitData = {
      timestamp: Date.now(),
      workspace_path: getCurrentWorkspace(),
      branch: gitBranch.trim(),
      status: gitStatus
        .trim()
        .split('\n')
        .filter((line) => line),
      recentCommits: gitLog
        .trim()
        .split('\n')
        .filter((line) => line),
    };

    // Store in memory (for backward compatibility)
    rawData.gitData.status.push(gitData);
    if (rawData.gitData.status.length > 100) {
      rawData.gitData.status = rawData.gitData.status.slice(-100);
    }

    // Persist to database using robust capture service
    if (robustDataCapture) {
      robustDataCapture.captureGitData(gitData).catch((err) => {
        // Silent fail
      });
    }

    console.log(`[NOTE] Captured git data: branch ${gitBranch.trim()}`);
  } catch (error) {
    console.warn('Git data capture failed (not a git repository?):', error.message);
  }
}

// AppleScript circuit breaker state
const appleScriptCircuitBreaker = {
  failures: 0,
  maxFailures: 3,
  disabled: false,
  disabledAt: null,
  cooldownMs: 5 * 60 * 1000, // 5 minutes
  errorLogged: false,

  isAvailable() {
    if (!this.disabled) return true;

    // Check if cooldown period has passed
    if (this.disabledAt && Date.now() - this.disabledAt > this.cooldownMs) {
      this.disabled = false;
      this.failures = 0;
      this.errorLogged = false;
      console.log('[APPLE] AppleScript circuit breaker reset, will retry');
      return true;
    }
    return false;
  },

  recordFailure(error) {
    this.failures++;
    if (this.failures >= this.maxFailures && !this.disabled) {
      this.disabled = true;
      this.disabledAt = Date.now();
      if (!this.errorLogged) {
        this.errorLogged = true;
        console.warn(
          `[APPLE] AppleScript disabled after ${this.failures} failures. ` +
            `Will retry in ${this.cooldownMs / 60000} minutes. ` +
            `To fix: Grant Terminal/Node accessibility permissions in System Preferences > Privacy & Security > Accessibility`
        );
      }
    }
  },

  recordSuccess() {
    if (this.failures > 0) {
      this.failures = 0;
      this.disabled = false;
      this.errorLogged = false;
    }
  },
};

// AppleScript integration for Cursor state
async function captureCursorAppState() {
  // Check circuit breaker before attempting
  if (!appleScriptCircuitBreaker.isAvailable()) {
    return;
  }

  try {
    const script = `
      tell application "System Events"
        set cursorProcess to first process whose name is "Cursor"
        if exists cursorProcess then
          set isActive to frontmost of cursorProcess
          set windowCount to count of windows of cursorProcess
          return {isActive, windowCount}
        else
          return {false, 0}
        end if
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const [isActive, windowCount] = stdout
      .trim()
      .split(',')
      .map((v) => v.trim());

    const appState = {
      timestamp: Date.now(),
      workspace_path: getCurrentWorkspace(),
      isActive: isActive === 'true',
      windowCount: parseInt(windowCount) || 0,
      processName: 'Cursor',
    };

    // Store in memory (for backward compatibility)
    rawData.appleScript.appState.push(appState);
    if (rawData.appleScript.appState.length > 500) {
      rawData.appleScript.appState = rawData.appleScript.appState.slice(-500);
    }

    // Persist to database using robust capture service
    if (robustDataCapture) {
      robustDataCapture.captureAppleScriptState(appState).catch((err) => {
        // Silent fail
      });
    }

    // Record success
    appleScriptCircuitBreaker.recordSuccess();
    console.log(`[APPLE] Captured Cursor app state: active=${isActive}, windows=${windowCount}`);
  } catch (error) {
    // Record failure for circuit breaker (only logs once)
    appleScriptCircuitBreaker.recordFailure(error);
  }
}

// Cursor database monitoring
async function captureCursorDatabase() {
  try {
    const possiblePaths = [
      path.join(process.env.HOME || '', 'Library/Application Support/Cursor/User/workspaceStorage'),
      path.join(process.env.HOME || '', 'Library/Application Support/Cursor/User/globalStorage'),
      path.join(process.env.HOME || '', 'Library/Application Support/Cursor/logs'),
    ];

    for (const basePath of possiblePaths) {
      if (fs.existsSync(basePath)) {
        const dbFiles = findSQLiteFiles(basePath);
        if (dbFiles.length > 0) {
          const dbPath = dbFiles[0];
          console.log(`[DATA] Found Cursor database: ${dbPath}`);

          // Try to read basic database info
          try {
            const { stdout: tableInfo } = await execAsync(`sqlite3 "${dbPath}" ".tables"`);
            const tables = tableInfo
              .trim()
              .split(/\s+/)
              .filter((t) => t);

            const dbInfo = {
              timestamp: Date.now(),
              path: dbPath,
              tables: tables,
              size: fs.statSync(dbPath).size,
            };

            // Store in memory (for backward compatibility)
            rawData.cursorDatabase.conversations.push(dbInfo);
            if (rawData.cursorDatabase.conversations.length > 50) {
              rawData.cursorDatabase.conversations =
                rawData.cursorDatabase.conversations.slice(-50);
            }

            // Persist to database using robust capture service
            if (robustDataCapture) {
              // Store as a conversation entry (using path as ID)
              const conversationData = {
                id: `db_${path.basename(dbPath)}_${Date.now()}`,
                timestamp: dbInfo.timestamp,
                workspace_path: getCurrentWorkspace(),
                title: `Cursor DB: ${path.basename(dbPath)}`,
                ...dbInfo,
                message_count: 0,
              };
              robustDataCapture.captureCursorDbConversation(conversationData).catch((err) => {
                // Silent fail
              });
            }

            console.log(`[DATA] Captured Cursor database info: ${tables.length} tables`);
            break;
          } catch (dbError) {
            console.warn('Could not read Cursor database:', dbError.message);
          }
        }
      }
    }
  } catch (error) {
    console.warn('Cursor database capture failed:', error.message);
  }
}

/**
 * NEW: Sync prompts from Cursor's database to persistent storage
 * Extracts prompts from aiService.prompts and aiService.generations
 * and saves them to the companion.db for persistence and linking
 */
const syncedPromptIds = new Set(); // Track which prompts we've already saved
let syncInProgress = false; // Prevent concurrent sync operations
let initialSyncComplete = false; // Only do full sync once on startup

/**
 * Extract context files from prompt text (@ mentions)
 */
function extractContextFilesFromPrompt(prompt) {
  const files = [];
  
  // Get text from prompt
  const text = prompt.text || '';
  
  // Extract @ mentions (e.g., @filename.js, @path/to/file.py)
  const atMentionPattern = /@([^\s,;:()[\]{}'"]+(?:\.[a-zA-Z0-9]+)?)/g;
  let match;
  
  while ((match = atMentionPattern.exec(text)) !== null) {
    const file = match[1];
    // Filter out common false positives
    if (file && file.length > 0 && !file.startsWith('http') && !file.includes('@')) {
      files.push({
        path: file,
        type: 'explicit',
        source: 'at_mention'
      });
    }
  }
  
  // Return context files object matching expected structure
  return {
    files: files,
    count: files.length,
    countBySource: {
      explicit: files.length,
      tabs: 0,
      auto: 0
    }
  };
}

async function syncPromptsFromCursorDB(forceFullSync = false) {
  // Prevent concurrent syncs
  if (syncInProgress) {
    console.log('[SYNC] Skipping - sync already in progress');
    return;
  }

  // After initial sync, use incremental sync (only check for new prompts)
  // unless forceFullSync is true
  if (initialSyncComplete && syncedPromptIds.size > 0 && !forceFullSync) {
    // For incremental sync, we'll still check but only process new prompts
    // This allows continuous capture of new prompts
    console.log('[SYNC] Using incremental sync mode (checking for new prompts only)');
  }

  syncInProgress = true;

  try {
    console.log('[SYNC] Starting prompt sync cycle...');

    // Extract prompts directly without enrichment for faster sync
    const startTime = Date.now();

    // Direct extraction without expensive enrichment
    const aiServiceMessages = await cursorDbParser.extractAllAIServiceData();
    const prompts = aiServiceMessages || [];

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[SYNC] Extracted ${prompts.length} prompts from Cursor DB in ${duration}s`);

    if (prompts.length === 0) {
      console.log('[SYNC] No prompts to sync');
      return;
    }

    let newPrompts = 0;
    let skippedPrompts = 0;
    const promptsToSave = [];

    // Filter and prepare prompts (fast, in-memory only)
    for (const prompt of prompts) {
      // Create a unique ID based on content and timestamp
      const promptId =
        prompt.id ||
        `${prompt.composerId || ''}_${prompt.timestamp || Date.now()}_${prompt.messageRole || 'user'}`;

      // Skip if already synced (this is the incremental check)
      if (syncedPromptIds.has(promptId)) {
        skippedPrompts++;
        continue;
      }

      // Prepare prompt for database storage
      const dbPrompt = {
        id: db.nextId++,
        timestamp: prompt.timestamp || Date.now(),
        text: prompt.text || '',
        status: prompt.status || 'captured',
        source: prompt.source || 'cursor-database',
        workspaceId: prompt.workspaceId,
        workspacePath: prompt.workspacePath,
        workspaceName: prompt.workspaceName,
        composerId: prompt.composerId,
        subtitle: prompt.subtitle,
        // Context usage - prefer direct value, then calculated
        contextUsage: prompt.contextUsage || prompt.context_usage || 0,
        // Model information - prefer actual model over original
        mode: prompt.mode,
        modelType: prompt.modelType,
        modelName: prompt.modelName || prompt.model || prompt.originalModel || null,
        originalModel: prompt.originalModel || prompt.model || null, // Store original (might be "auto")
        isAuto:
          prompt.isAuto !== undefined
            ? prompt.isAuto
            : prompt.modelName?.toLowerCase().includes('auto') ||
              prompt.model?.toLowerCase().includes('auto'),
        forceMode: prompt.forceMode,
        type: prompt.type || 'unknown',
        confidence: prompt.confidence || 'high',
        added_from_database: true,
        // Threading fields
        conversationTitle: prompt.conversationTitle,
        messageRole: prompt.messageRole, // 'user' or 'assistant'
        parentConversationId: prompt.parentConversationId,
        // Thinking time
        thinkingTimeSeconds: prompt.thinkingTimeSeconds,
        // Token information
        promptTokens: prompt.promptTokens || null,
        completionTokens: prompt.completionTokens || null,
        totalTokens: prompt.totalTokens || null,
        contextWindowSize: prompt.contextWindowSize || null,
        // Context data - extract @ mentions from prompt text
        contextFiles: extractContextFilesFromPrompt(prompt),
        terminalBlocks: prompt.terminalBlocks || [],
        hasAttachments: prompt.hasAttachments || false,
        attachmentCount: prompt.attachmentCount || 0,
      };

      promptsToSave.push({ promptId, dbPrompt });
      syncedPromptIds.add(promptId);
    }

    // Batch save to database (if any new prompts)
    if (promptsToSave.length > 0) {
      console.log(`[SYNC] Saving ${promptsToSave.length} prompts to database...`);

      for (const { promptId, dbPrompt } of promptsToSave) {
        try {
          await persistentDB.savePrompt(dbPrompt);
          newPrompts++;

          // Notify procedural knowledge builder
          if (
            proceduralKnowledgeBuilder &&
            typeof proceduralKnowledgeBuilder.notifyDataCaptured === 'function'
          ) {
            proceduralKnowledgeBuilder.notifyDataCaptured('prompts', 1);
          }

        } catch (saveError) {
          console.warn(`[SYNC] Error saving prompt ${promptId}:`, saveError.message);
          syncedPromptIds.delete(promptId); // Remove from cache if save failed
        }
      }
    }

    console.log(
      `[SYNC] Sync complete: ${newPrompts} new, ${skippedPrompts} skipped, ${syncedPromptIds.size} total tracked (${prompts.length} available in Cursor DB)`
    );

    // Mark initial sync as complete (but continue incremental syncs)
    if (!initialSyncComplete && syncedPromptIds.size > 0) {
      initialSyncComplete = true;
      console.log('[SYNC] Initial sync complete - continuing with incremental syncs every 30s');
    }
  } catch (error) {
    console.error('[SYNC] Error syncing prompts from Cursor database:', error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    syncInProgress = false; // Release lock
  }
}

// Log file monitoring
async function captureLogData() {
  try {
    const logPaths = [
      path.join(process.env.HOME || '', 'Library/Application Support/Cursor/logs'),
      path.join(process.env.HOME || '', 'Library/Logs/Cursor'),
    ];

    for (const logPath of logPaths) {
      if (fs.existsSync(logPath)) {
        const logFiles = fs
          .readdirSync(logPath)
          .filter((file) => file.endsWith('.log'))
          .slice(-5); // Get last 5 log files

        for (const logFile of logFiles) {
          const fullPath = path.join(logPath, logFile);
          const stats = fs.statSync(fullPath);

          const logInfo = {
            timestamp: Date.now(),
            path: fullPath,
            size: stats.size,
            modified: stats.mtime,
            name: logFile,
            type: 'cursor',
          };

          // Store in memory (for backward compatibility)
          rawData.logs.cursor.push(logInfo);
          if (rawData.logs.cursor.length > 100) {
            rawData.logs.cursor = rawData.logs.cursor.slice(-100);
          }

          // Persist to database using robust capture service
          if (robustDataCapture) {
            robustDataCapture.captureLogData(logInfo).catch((err) => {
              // Silent fail
            });
          }
        }

        console.log(`Captured log data: ${logFiles.length} files`);
        break;
      }
    }
  } catch (error) {
    console.warn('Log capture failed:', error.message);
  }
}

// Helper function to find SQLite files
function findSQLiteFiles(dir) {
  const files = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...findSQLiteFiles(fullPath));
      } else if (item.endsWith('.db') || item.endsWith('.sqlite') || item.endsWith('.sqlite3')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors
  }
  return files;
}

// Start raw data capture intervals
async function startRawDataCapture() {
  console.log('[LAUNCH] Starting enhanced raw data capture...');

  // Initialize robust data capture service for persistent storage
  try {
    const RobustDataCaptureService = require('./services/robust-data-capture');
    robustDataCapture = new RobustDataCaptureService(persistentDB, rawData);
    await robustDataCapture.init();
    console.log('[LAUNCH] Robust data capture service initialized with persistent storage');
  } catch (error) {
    console.error('[LAUNCH] Failed to initialize robust data capture service:', error);
    // Continue without robust capture - fallback to in-memory only
  }

  // Initialize IDE state capture
  ideStateCapture = new IDEStateCapture();
  ideStateCapture.start(2000); // Capture every 2 seconds

  // Initialize prompt capture system
  promptCaptureSystem = new PromptCaptureSystem();

  // Start status message tracking
  statusMessageTracker.start(2000); // Check every 2 seconds

  // Link status messages to context changes
  statusMessageTracker.on('fileRead', async (data) => {
    // Try to find recent context changes that might be related
    try {
      const recentChanges = await persistentDB.getContextChanges({
        startTime: data.timestamp - 5000, // 5 seconds before
        endTime: data.timestamp + 5000, // 5 seconds after
        limit: 10,
      });

      // Link to context changes that added this file
      for (const change of recentChanges) {
        if (change.addedFiles && change.addedFiles.includes(data.filePath)) {
          await persistentDB.linkStatusToContextChange(data.statusId, change.id);
          console.log(`[STATUS] Linked "Read ${data.filePath}" to context change ${change.id}`);
        }
      }
    } catch (error) {
      console.warn('Error linking status to context change:', error);
    }
  });

  // System resources every 5 seconds
  captureIntervals.systemResources = setInterval(captureSystemResources, 5000);

  // Git data every 30 seconds
  captureIntervals.gitStatus = setInterval(captureGitData, 30000);

  // AppleScript every 2 seconds
  captureIntervals.appleScript = setInterval(captureCursorAppState, 2000);

  // Cursor database every 5 seconds
  captureIntervals.cursorDatabase = setInterval(captureCursorDatabase, 5000);

  // Logs every 60 seconds
  captureIntervals.logs = setInterval(captureLogData, 60000);

  // NEW: Sync prompts from Cursor database every 30 seconds
  captureIntervals.promptSync = setInterval(syncPromptsFromCursorDB, 30000);

  // Initial capture
  captureSystemResources();
  captureGitData();
  captureCursorAppState();
  captureCursorDatabase();
  captureLogData();
  syncPromptsFromCursorDB(); // Initial sync

  console.log('[SUCCESS] Enhanced raw data capture started');
}

// Load configuration
let config;
let privacyConfig = {
  enabled: false,
  redactionLevel: 0.5,
  sensitivityLevel: 'medium',
  redactNames: true,
  redactNumbers: true,
  redactEmails: true,
  redactFilePaths: false,
  redactJwtSecrets: true,
  consentGiven: false,
};

try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  console.log(' Loaded configuration from config.json');
} catch (error) {
  console.log(' Using default configuration');
  config = {
    root_dir: process.cwd(),
    ignore: [
      'node_modules/**',
      'dist/**',
      '.git/**',
      '.cursor/**',
      '**/node_modules/**',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/*.log',
      '**/coverage/**',
      '**/build/**',
      '**/tmp/**',
      '**/temp/**',
    ],
    diff_threshold: 12,
    enable_clipboard: false,
  };
}

// Initialize data access control service
const DataAccessControl = require('./services/data-access-control');
dataAccessControl = new DataAccessControl(config);
if (config.data_access_control?.enabled) {
  console.log('[ACCESS] Data access control enabled');
  console.log(
    `[ACCESS] Allowed data sources: ${config.data_access_control.allowed_data_sources?.join(', ') || 'all'}`
  );
  if (config.data_access_control.allowed_workspaces) {
    console.log(
      `[ACCESS] Allowed workspaces: ${config.data_access_control.allowed_workspaces.join(', ')}`
    );
  } else {
    console.log('[ACCESS] All workspaces allowed');
  }
} else {
  console.log('[ACCESS] Data access control disabled - all data accessible');
}

// Initialize research sync service (if enabled, now that config is loaded)
let remoteSyncService = null;
if (config.research?.enabled || process.env.RESEARCH_ENABLED === 'true') {
  try {
    const RemoteSyncService = require('./services/research/remote-sync');
    const researchConfig = {
      enabled: config.research?.enabled || process.env.RESEARCH_ENABLED === 'true',
      serverUrl: config.research?.serverUrl || process.env.RESEARCH_SERVER_URL,
      participantId: config.research?.participantId || process.env.RESEARCH_PARTICIPANT_ID,
      consentRung: config.research?.consentRung || parseInt(process.env.RESEARCH_RUNG) || 5,
      syncInterval:
        config.research?.syncInterval || parseInt(process.env.RESEARCH_SYNC_INTERVAL) || 300000,
      syncOnStartup: config.research?.syncOnStartup !== false,
    };
    remoteSyncService = new RemoteSyncService(persistentDB, researchConfig);
  } catch (error) {
    console.warn('[RESEARCH] Failed to initialize remote sync service:', error.message);
  }
}

// Initialize workspace discovery service for global operation
const workspaceDiscovery = new WorkspaceDiscoveryService(config);

// Support automatic workspace detection
const autoDetect = config.auto_detect_workspaces !== false;
const watchCursorWorkspaces = config.watch_cursor_workspaces !== false;

console.log(' Configuration:', {
  service_mode: config.service_mode || 'global',
  auto_detect: autoDetect,
  watch_cursor_workspaces: watchCursorWorkspaces,
  ignore_count: config.ignore?.length || 0,
  diff_threshold: config.diff_threshold,
});

// Initialize workspace discovery
let workspacesToWatch = config.workspace_roots || [];
(async () => {
  try {
    const discoveredPaths = await workspaceDiscovery.initialize();
    workspacesToWatch = discoveredPaths;
    console.log(`[WORKSPACE] Discovered ${discoveredPaths.length} workspaces from Cursor storage`);
    discoveredPaths.slice(0, 5).forEach((p) => console.log(`  - ${p}`));
    if (discoveredPaths.length > 5) {
      console.log(`  ... and ${discoveredPaths.length - 5} more`);
    }
  } catch (err) {
    console.warn('[WORKSPACE] Workspace discovery failed, using config:', err.message);
  }
})();

// Set initial workspace (will be detected dynamically from file paths)
sessionManager.currentWorkspace = config.root_dir || os.homedir();
console.log('[TARGET] Running in global mode - auto-detecting workspaces from Cursor');
console.log('[DATA] All workspaces from Cursor storage will be monitored');

// Initialize data capture service (will be initialized later)
let dataCaptureService;

// ===================================
// Performance: Cache Utilities
// ===================================

// Initialize cache invalidation manager
const cacheInvalidationManager = new CacheInvalidationManager(queryCache);

// Cache invalidation helper (backward compatible)
function invalidateCache(pattern) {
  const count = cacheInvalidationManager.invalidateByPattern(pattern);
  if (count > 0) {
    console.log(`[CACHE] Invalidated ${count} entries matching: ${pattern}`);
  }
}

// Enhanced cache invalidation by tag
function invalidateCacheByTag(...tags) {
  const count = cacheInvalidationManager.invalidateTags(...tags);
  if (count > 0) {
    console.log(`[CACHE] Invalidated ${count} entries by tags: ${tags.join(', ')}`);
  }
}

// Cache wrapper for async functions
async function withCache(key, ttl, asyncFn) {
  const cached = queryCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await asyncFn();
  queryCache.set(key, result, ttl || 30);
  return result;
}

// Initialize route modules
createCoreRoutes({
  app,
  db,
  queue,
  sequence,
  rawData,
  queueSystem,
  clipboardMonitor,
  queryCache,
  dataAccessControl,
  robustDataCapture, // Pass robust capture service for database stats
});

createWorkspaceRoutes({
  app,
  persistentDB,
  cursorDbParser,
  workspaceData,
  workspaceSessions,
  knownWorkspaces,
  entries,
  workspaceDiscovery,
});

createRawDataRoutes({
  app,
  rawData,
  robustDataCapture, // Pass robust capture service for database queries
});

createIDEStateRoutes({
  app,
  ideStateCapture,
});

createAnalyticsRoutes({
  app,
  persistentDB,
  contextAnalyzer,
  contextChangeTracker,
  errorTracker,
  productivityTracker,
  queryCache,
});

// Register enhanced analytics routes
createEnhancedAnalyticsRoutes({
  app,
  persistentDB,
});

createDatabaseRoutes({
  app,
  persistentDB,
});

createSchemaRoutes({
  app,
  persistentDB,
});

createWhiteboardRoutes({
  app,
  persistentDB,
});

createTerminalRoutes({
  app,
  persistentDB,
  terminalMonitor,
});

const todosRoutes = createTodosRoutes({
  app,
  persistentDB,
  broadcastUpdate,
});

// Initialize services
const fileWatcherService = createFileWatcherService({
  config,
  detectWorkspace,
  getWorkspaceSession,
  checkSessionTimeout,
  updateActivityTime,
  updateWorkspaceData,
  queueSystem,
  db,
  persistentDB,
  productivityTracker,
  io,
  broadcastUpdate,
  enqueue,
  getCurrentActiveTodo: todosRoutes.getCurrentActiveTodo,
  plotService,
});

const dbRepairService = createDbRepairService({
  persistentDB,
});

const startupService = createStartupService({
  persistentDB,
  schemaMigrations,
  db,
  dbRepairService,
  server,
  PORT,
  HOST,
  config,
  startFileWatcher,
  clipboardMonitor,
  terminalMonitor,
  errorTracker,
  startRawDataCapture,
  buildLunrIndex,
  checkSessionTimeout,
  cursorDbParser,
  contextAnalyzer,
  contextChangeTracker,
  productivityTracker,
  todosRoutes,
  activeSession,
  proceduralKnowledgeBuilder: null, // Will be initialized later
  historicalMiningService,
  automaticMiningScheduler,
  automaticHfSyncService,
});

createStatusRoutes({
  app,
  persistentDB,
});

createActivityRoutes({
  app,
  persistentDB,
  sequence,
  queryCache,
  redisCache, // Add Redis cache for performance
  calculateDiff: fileWatcherService.calculateDiff.bind(fileWatcherService),
  cursorDbParser,
  dataAccessControl,
});

// Graph pre-computation routes (for Explorer)
createGraphPrecomputeRoutes({
  app,
  persistentDB,
  cache: redisCache || queryCache,
});

createScreenshotRoutes({
  app,
  screenshotMonitor,
});

createPlotRoutes({
  app,
  plotService,
});

createPromptRoutes({
  app,
  db,
  persistentDB,
  getCurrentWorkspace: currentWorkspace,
  getCurrentActiveTodo: todosRoutes.getCurrentActiveTodo,
});

createMiscRoutes({
  app,
  queue,
  sequence,
  entries,
  events,
  lunrIndex,
  indexedDocs,
  config,
  privacyConfig,
  clipboardMonitor,
});

createFileContentsRoutes({
  app,
  persistentDB,
});

createMCPRoutes({
  app,
  persistentDB,
  db,
  checkSessionTimeout,
  updateActivityTime,
  detectWorkspace,
  getWorkspaceSession,
  getCurrentWorkspace: currentWorkspace,
  updateWorkspaceData,
  enqueue,
  broadcastUpdate,
  broadcastConversationUpdate,
  conversationStreams,
});

// Register optimization routes
createOptimizationRoutes({
  app,
  persistentDB,
});

// Motif service and routes (Rung 6) - Initialize before use
const motifService = initializeMotifService(app, persistentDB, {
  minClusterSize: 10,
  similarityThreshold: 0.7,
  maxMotifLength: 20,
});

// Module Graph service and routes (File-level abstraction) - Initialize before use
const ModuleGraphService = require('./services/module-graph/module-graph-service.js');
const createModuleGraphRoutes = require('./routes/module-graph.js');
let moduleGraphService = null;
try {
  moduleGraphService = new ModuleGraphService(cursorDbParser);
  createModuleGraphRoutes({
    app,
    moduleGraphService,
  });
  console.log('[MODULE-GRAPH] Module graph service initialized');
} catch (error) {
  console.warn('[MODULE-GRAPH] Failed to initialize module graph service:', error.message);
}

// Rung 1 service and routes (Token-level abstraction) - Initialize before use
const Rung1Service = require('./services/rung1/rung1-service.js');
const createRung1Routes = require('./routes/rung1.js');
let rung1Service = null;
try {
  rung1Service = new Rung1Service(cursorDbParser, persistentDB);
  createRung1Routes({
    app,
    rung1Service,
  });
  console.log('[RUNG1] Rung 1 service initialized');
} catch (error) {
  console.warn('[RUNG1] Failed to initialize Rung 1 service:', error.message);
}

// Rung 2 service and routes (Statement-level semantic edit scripts) - Initialize before use
const Rung2Service = require('./services/rung2/rung2-service.js');
const createRung2Routes = require('./routes/rung2.js');
let rung2Service = null;
try {
  rung2Service = new Rung2Service(cursorDbParser, persistentDB);
  createRung2Routes({
    app,
    rung2Service,
  });
  console.log('[RUNG2] Rung 2 service initialized successfully');

  // Perform initial extraction in the background after a delay.
  // For large databases this is skipped to avoid long blocking work.
  setTimeout(async () => {
    if (dbSizeGuard.shouldSkipOperation('rung2_initial_extraction')) {
      console.warn('[RUNG2] Skipping initial data extraction due to large database size.');
      return;
    }
    try {
      console.log('[RUNG2] Performing initial data extraction (batched)...');
      const initialScripts = await rung2Service.extractEditScripts(null, {
        forceRefresh: false,
      });
      console.log(
        `[RUNG2] Initial extraction complete: ${initialScripts.length} edit scripts loaded`
      );
    } catch (extractError) {
      console.warn('[RUNG2] Initial extraction warning:', extractError.message);
    }
  }, 5000); // 5 second delay to ensure DB is ready
} catch (error) {
  console.warn('[RUNG2] Failed to initialize Rung 2 service:', error.message);
}

// Rung 3 service and routes (Function-level representation) - Initialize before use
const Rung3Service = require('./services/rung3/rung3-service.js');
const createRung3Routes = require('./routes/rung3.js');
let rung3Service = null;
try {
  rung3Service = new Rung3Service(cursorDbParser, persistentDB);
  createRung3Routes({
    app,
    rung3Service,
  });
  console.log('[RUNG3] Rung 3 service initialized');
} catch (error) {
  console.warn('[RUNG3] Failed to initialize Rung 3 service:', error.message);
}

createExportImportRoutes({
  app,
  persistentDB,
  db,
  abstractionEngine,
  schemaMigrations,
  dataAccessControl,
  motifService,
  moduleGraphService,
  rung1Service,
  rung2Service,
  rung3Service,
  exportHistoryService,
  robustDataCapture, // Pass robust capture service for raw data export
  rawData, // Pass rawData for fallback
  cursorDbParser, // Pass cursorDbParser for workspace fetching
});

// Account routes (authentication, cloud sync) - setup first to get account service
const accountServiceInstance = setupAccountRoutes(app, persistentDB, {
  accountServiceUrl: process.env.ACCOUNT_SERVICE_URL || 'https://api.cursor-telemetry.com',
  localMode: process.env.ACCOUNT_LOCAL_MODE === 'true',
});

// Update sharing service with account service reference
if (accountServiceInstance) {
  sharingService = new SharingService(persistentDB, accountServiceInstance);
}

// Sharing routes (now with account service support)
createSharingRoutes({
  app,
  sharingService,
  persistentDB,
  cursorDbParser,
  accountService: accountServiceInstance,
  huggingFaceUploadService,
  automaticHfSyncService,
  automaticMiningScheduler,
});

// Historical mining routes
createHistoricalMiningRoutes({
  app,
  historicalMiningService,
  persistentDB,
});

// Combined timeline routes
createCombinedTimelineRoutes({
  app,
  combinedTimelineService,
});

// Initialize conversation services
const conversationManager = new ConversationManager(persistentDB);
const conversationCapture = new ConversationCapture(persistentDB, conversationManager);
const conversationContext = ConversationContext;

// Initialize ClioService for RAG pipeline and privacy-preserving patterns
let clioService = null;
try {
  const { ClioService } = require('./services/clio');
  clioService = new ClioService(persistentDB, {
    minClusterSize: 5,
    similarityThreshold: 0.7,
  });

  // Register Clio routes
  const createClioRoutes = require('./routes/clio.js');
  const clioRouter = createClioRoutes({ persistentDB, clioService });
  app.use('/api/clio', clioRouter);

  console.log('[CLIO] ClioService initialized with API routes at /api/clio');
} catch (error) {
  console.warn('[CLIO] ClioService not available:', error.message);
}

// Conversation routes
createConversationRoutes({
  app,
  persistentDB,
  conversationManager,
  conversationCapture,
  conversationContext,
  clioService,
});

// AI routes (OpenRouter embeddings and chat)
createAIRoutes({
  app,
});

// Hugging Face routes (export and upload)
createHuggingFaceRoutes({
  app,
  persistentDB,
  automaticHfSyncService, // Pass sync service to routes
});

// Annotation routes (event annotation, intent classification, state summarization)
createAnnotationRoutes({
  app,
  persistentDB,
});

// State management routes (natural language commands, fork/merge, semantic search)
createStateRoutes({
  app,
  persistentDB,
});

// Initialize and register permission checker routes
const permissionChecker = new PermissionChecker();
createPermissionRoutes({
  app,
  permissionChecker,
});

// Register new system management routes
createRetentionRoutes({
  app,
  dataRetentionService,
});

createExportHistoryRoutes({
  app,
  exportHistoryService,
});

createPreferencesRoutes({
  app,
  userPreferencesService,
});

console.log('[ROUTES] Registered system management routes: retention, export-history, preferences');

// Health check
app.get('/health', async (req, res) => {
  const queueStats = queueSystem.getStats();
  const clipboardStats = clipboardMonitor.getStats();
  const cacheStats = queryCache.getStats();
  const perfMetrics = performanceMonitor.getMetrics();

  // Get Redis cache stats
  const redisStats = await redisCache.getStats();

  // No caching for health check
  res.set('Cache-Control', 'no-cache');

  // Get raw data stats from database if available, otherwise use in-memory
  let rawDataStats = {
    systemResources: rawData.systemResources.length,
    gitData: rawData.gitData.status.length,
    cursorDatabase: rawData.cursorDatabase.conversations.length,
    appleScript: rawData.appleScript.appState.length,
    logs: rawData.logs.cursor.length,
    source: 'memory',
  };

  if (robustDataCapture) {
    try {
      const stats = await robustDataCapture.schema.getTableStats();
      rawDataStats = {
        systemResources: stats.system_resources || rawData.systemResources.length,
        gitData: stats.git_data || rawData.gitData.status.length,
        cursorDatabase: stats.cursor_db_conversations || rawData.cursorDatabase.conversations.length,
        appleScript: stats.apple_script_state || rawData.appleScript.appState.length,
        logs: stats.cursor_logs || rawData.logs.cursor.length,
        source: 'database',
        memory_fallback: {
          systemResources: rawData.systemResources.length,
          gitData: rawData.gitData.status.length,
          cursorDatabase: rawData.cursorDatabase.conversations.length,
          appleScript: rawData.appleScript.appState.length,
          logs: rawData.logs.cursor.length,
        },
      };
    } catch (error) {
      // Fallback to in-memory stats if database query fails
      console.warn('[HEALTH] Failed to get database stats, using in-memory:', error.message);
    }
  }

  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    entries: db.entries.length,
    prompts: db.prompts.length,
    queue_length: queue.length,
    sequence: sequence,
    queue_stats: queueStats,
    clipboard_stats: clipboardStats,
    raw_data_stats: rawDataStats,
    cache_stats: {
      keys: queryCache.keys().length,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hits / (cacheStats.hits + cacheStats.misses) || 0,
      redis: redisStats,
    },
    performance: {
      requests: perfMetrics.requests,
      queries: perfMetrics.queries,
      memory: {
        heapUsed: Math.round(perfMetrics.memory.current.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(perfMetrics.memory.current.heapTotal / 1024 / 1024) + 'MB',
        rss: Math.round(perfMetrics.memory.current.rss / 1024 / 1024) + 'MB',
      },
      uptime: Math.round(perfMetrics.uptime) + 's',
    },
  });
});

// Performance metrics endpoint
app.get('/api/performance', (req, res) => {
  const metrics = performanceMonitor.getMetrics();
  res.json(metrics);
});

// Get queue
app.get('/queue', (req, res) => {
  const since = Number(req.query.since || 0);

  console.log(`� Queue request: since=${since}, queue_length=${queue.length}`);

  const newItems = queue.filter((item) => item.seq > since);
  const newEntries = newItems.filter((item) => item.kind === 'entry').map((item) => item.payload);
  const newEvents = newItems.filter((item) => item.kind === 'event').map((item) => item.payload);

  console.log(
    `� Queue response: ${newEntries.length} entries, ${newEvents.length} events since seq ${since}`
  );

  // Use all available data for comprehensive analysis
  const limitedEntries = newEntries; // No limit - use all entries
  const limitedEvents = newEvents; // No limit - use all events

  // Use full content for comprehensive analysis
  const cleanedEntries = limitedEntries.map((entry) => ({
    ...entry,
    content: entry.content || '', // Use full content
    before_code: entry.before_code || '',
    after_code: entry.after_code || '',
  }));

  const cleanedEvents = limitedEvents.map((event) => ({
    ...event,
    details: event.details ? JSON.stringify(JSON.parse(event.details || '{}')) : '{}',
  }));

  res.json({
    entries: cleanedEntries,
    events: cleanedEvents,
    cursor: sequence,
  });
});

// Multi-workspace API endpoints
// Get conversations for a workspace
app.get('/api/workspaces/:workspaceId/conversations', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const limit = parseInt(req.query.limit) || 100;

    const conversations = await persistentDB.getConversationsByWorkspace(workspaceId, limit);

    res.json({
      success: true,
      data: conversations,
      count: conversations.length,
    });
  } catch (error) {
    console.error('Error getting conversations:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get audit log
app.get('/api/audit-log', async (req, res) => {
  try {
    const options = {
      workspaceId: req.query.workspaceId || null,
      operationType: req.query.operationType || null,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0,
    };

    const auditLog = await persistentDB.getAuditLog(options);

    res.json({
      success: true,
      data: auditLog,
      count: auditLog.length,
    });
  } catch (error) {
    console.error('Error getting audit log:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/workspaces', async (req, res) => {
  try {
    // Get ALL workspaces from Cursor (including old/stale ones)
    const allCursorWorkspaces = await cursorDbParser.getAllWorkspaces();

    // Get prompt data to enrich workspace info
    const cursorData = await cursorDbParser.getAllData();

    // Build workspace list from Cursor database first (this is the source of truth)
    const workspaces = allCursorWorkspaces.map((ws) => {
      // Count prompts for this workspace
      const wsPrompts = cursorData.prompts.filter((p) => p.workspaceId === ws.id);

      // Check if we have activity data for this workspace
      const activityData = workspaceData.get(ws.path);

      return {
        id: ws.id,
        path: ws.path || `Unknown (${ws.id.substring(0, 8)})`,
        name: ws.name,
        entries: activityData?.entries?.length || 0,
        events: activityData?.events?.length || 0,
        promptCount: wsPrompts.length,
        lastActivity: activityData?.lastActivity || ws.lastAccessed,
        lastAccessed: ws.lastAccessed,
        created: ws.created,
        sessionId: workspaceSessions.get(ws.path),
        active: activityData ? true : false,
        exists: ws.exists,
        fromCursorDb: true,
      };
    });

    // Add any workspaces from knownWorkspaces that weren't in Cursor DB
    Array.from(knownWorkspaces).forEach((wsPath) => {
      if (!workspaces.find((w) => w.path === wsPath)) {
        const activityData = workspaceData.get(wsPath);
        workspaces.push({
          path: wsPath,
          name: wsPath.split('/').pop() || 'Unknown',
          entries: activityData?.entries?.length || 0,
          events: activityData?.events?.length || 0,
          promptCount: 0,
          lastActivity: activityData?.lastActivity || null,
          sessionId: workspaceSessions.get(wsPath),
          active: activityData ? true : false,
          exists: true,
          fromCursorDb: false,
        });
      }
    });

    // Sort by lastActivity/lastAccessed (most recent first)
    workspaces.sort((a, b) => {
      const aTime = a.lastActivity || a.lastAccessed || 0;
      const bTime = b.lastActivity || b.lastAccessed || 0;
      return new Date(bTime) - new Date(aTime);
    });

    res.json(workspaces);
  } catch (error) {
    console.error('Error getting workspaces:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/workspace/:workspacePath/activity', (req, res) => {
  const { workspacePath } = req.params;
  const data = workspaceData.get(workspacePath);
  if (!data) {
    return res.status(404).json({ error: 'Workspace not found' });
  }
  res.json({
    entries: data.entries,
    events: data.events,
    lastActivity: data.lastActivity,
  });
});

app.get('/api/workspace/:workspacePath/sessions', (req, res) => {
  const { workspacePath } = req.params;
  const workspaceEntries = entries.filter((entry) => entry.workspace_path === workspacePath);
  const sessionIds = [...new Set(workspaceEntries.map((entry) => entry.session_id))];
  res.json(sessionIds);
});

// Raw data and IDE state routes are now handled by route modules (see above)

// ===================================
// NEW ANALYTICS ENDPOINTS
// ===================================

// Activity routes are now handled by activity routes module (see route initialization above)

// Helper to resolve Git object hash to actual content/name
function resolveGitObject(hash, filePath) {
  if (!hash || hash.length !== 40) return null;

  try {
    // Try to get the type and content of the Git object
    const typeResult = execSync(`git cat-file -t ${hash} 2>/dev/null`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();

    if (typeResult === 'blob') {
      // It's a file - try to find its name from git show
      const showResult = execSync(
        `git show --name-only --format="" ${hash} 2>/dev/null || echo ""`,
        {
          encoding: 'utf-8',
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'ignore'],
        }
      ).trim();

      if (showResult) {
        return showResult.split('\n')[0]; // First line is the filename
      }
    } else if (typeResult === 'commit') {
      // It's a commit - get the commit message subject
      const commitMsg = execSync(`git log --format=%s -n 1 ${hash} 2>/dev/null || echo ""`, {
        encoding: 'utf-8',
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      return commitMsg ? `Commit: ${commitMsg}` : `Commit ${hash.substring(0, 7)}`;
    } else if (typeResult === 'tree') {
      return `Tree ${hash.substring(0, 7)}`;
    }
  } catch (error) {
    // Git command failed, object doesn't exist in repo
    return null;
  }

  return null;
}

// Helper to decode git ref files
function decodeGitRef(filePath, content) {
  // For files like .git/refs/heads/master or .git/HEAD
  if (filePath.includes('.git/refs/heads/')) {
    const branch = filePath.split('.git/refs/heads/').pop();
    return `Branch ref: ${branch}`;
  }
  if (filePath.includes('.git/refs/remotes/')) {
    const remote = filePath.split('.git/refs/remotes/').pop();
    return `Remote ref: ${remote}`;
  }
  if (filePath.endsWith('.git/HEAD')) {
    // Parse HEAD content
    const match = content.match(/ref: refs\/heads\/(\w+)/);
    if (match) {
      return `HEAD -> ${match[1]}`;
    }
  }
  if (filePath.endsWith('.git/ORIG_HEAD') || filePath.endsWith('.git/FETCH_HEAD')) {
    const type = filePath.split('/').pop();
    return `Git ${type}`;
  }

  return null;
}

// Screenshot and prompt routes are now handled by route modules (see route initialization above)

// API endpoint to repair database links
app.post('/api/repair/links', async (req, res) => {
  try {
    console.log('[API] Repair links request received');
    const result = await dbRepairService.repairDatabaseLinks();
    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API] Error in repair links:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Export/import routes are now handled by export-import routes module (see route initialization above)

// Debug endpoint to force enqueue test data
app.post('/debug/enqueue', (req, res) => {
  const entry = {
    id: crypto.randomUUID(),
    session_id: 'debug',
    timestamp: new Date().toISOString(),
    source: 'mcp',
    file_path: 'debug.txt',
    prompt: 'Hello',
    response: 'World',
    before_code: null,
    after_code: null,
  };
  enqueue('entry', entry);

  const event = {
    id: crypto.randomUUID(),
    session_id: 'debug',
    timestamp: entry.timestamp,
    type: 'entry_created',
    details: '{}',
  };
  enqueue('event', event);

  res.json({ success: true, entry, event });
});

function startFileWatcher() {
  fileWatcherService.start();
}

// Socket.IO connection handling with conversation streaming
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Track client's subscribed conversation streams
  const clientStreams = new Set();

  // Send initial data when client connects
  socket.emit('initial-data', {
    entries: db.entries,
    prompts: db.prompts,
    queue: queueSystem.getQueue(),
    ideState: ideStateCapture ? ideStateCapture.getLatestState() : null,
    activeStreams: Array.from(conversationStreams.keys()),
    timestamp: Date.now(),
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Clean up client streams
    clientStreams.clear();
  });

  // Subscribe to conversation stream
  socket.on('subscribe-conversation', (conversationId) => {
    if (conversationId) {
      clientStreams.add(conversationId);
      console.log(`[WS] Client ${socket.id} subscribed to conversation: ${conversationId}`);

      // Enable streaming for this conversation if not already enabled
      if (!conversationStreams.has(conversationId)) {
        conversationStreams.set(conversationId, {
          id: conversationId,
          enabled: true,
          startTime: Date.now(),
          messageCount: 0,
          subscribers: new Set([socket.id]),
        });
      } else {
        conversationStreams.get(conversationId).subscribers.add(socket.id);
      }

      socket.emit('conversation-subscribed', { conversation_id: conversationId });
    }
  });

  // Unsubscribe from conversation stream
  socket.on('unsubscribe-conversation', (conversationId) => {
    if (conversationId && clientStreams.has(conversationId)) {
      clientStreams.delete(conversationId);
      console.log(`[WS] Client ${socket.id} unsubscribed from conversation: ${conversationId}`);

      const stream = conversationStreams.get(conversationId);
      if (stream && stream.subscribers) {
        stream.subscribers.delete(socket.id);
        if (stream.subscribers.size === 0) {
          conversationStreams.delete(conversationId);
        }
      }

      socket.emit('conversation-unsubscribed', { conversation_id: conversationId });
    }
  });

  // Handle client requests for specific data
  socket.on('request-data', async (dataType) => {
    try {
      switch (dataType) {
        case 'entries':
          socket.emit('entries-update', db.entries);
          break;
        case 'prompts':
          socket.emit('prompts-update', db.prompts);
          break;
        case 'queue':
          socket.emit('queue-update', queueSystem.getQueue());
          break;
        case 'ide-state':
          socket.emit('ide-state-update', ideStateCapture.getLatestState());
          break;
        case 'conversations':
          // Get all conversations from prompts
          const conversations = {};
          (db.prompts || []).forEach((prompt) => {
            if (prompt.conversation_id) {
              if (!conversations[prompt.conversation_id]) {
                conversations[prompt.conversation_id] = {
                  id: prompt.conversation_id,
                  title: prompt.conversation_title,
                  messages: [],
                };
              }
              conversations[prompt.conversation_id].messages.push(prompt);
            }
          });
          socket.emit('conversations-update', Object.values(conversations));
          break;
        case 'all':
          socket.emit('full-update', {
            entries: db.entries,
            prompts: db.prompts,
            queue: queueSystem.getQueue(),
            ideState: ideStateCapture.getLatestState(),
            activeStreams: Array.from(conversationStreams.keys()),
            timestamp: Date.now(),
          });
          break;
      }
    } catch (error) {
      socket.emit('error', { message: `Failed to fetch ${dataType}`, error: error.message });
    }
  });

  // Send current data to newly connected client
  socket.emit('initial-data', {
    entries: db.entries,
    events: events,
    queue: queue,
    activeStreams: Array.from(conversationStreams.keys()),
  });
});

// Start the server
// Server startup moved to end of file to avoid duplicate

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n Shutting down companion service...');

  // Stop automatic mining scheduler
  if (automaticMiningScheduler && typeof automaticMiningScheduler.stop === 'function') {
    automaticMiningScheduler.stop();
    console.log(' Automatic mining scheduler stopped');
  }

  // Stop automatic Hugging Face sync service
  if (automaticHfSyncService && typeof automaticHfSyncService.stop === 'function') {
    automaticHfSyncService.stop();
    console.log(' Automatic Hugging Face sync service stopped');
  }

  // Stop research sync service
  if (remoteSyncService && typeof remoteSyncService.stop === 'function') {
    remoteSyncService.stop();
    console.log(' Research sync service stopped');
  }

  // Stop file watcher service
  if (fileWatcherService && typeof fileWatcherService.stop === 'function') {
    fileWatcherService.stop();
  }

  clipboardMonitor.stop();

  // Clear capture intervals
  Object.values(captureIntervals).forEach((interval) => {
    if (interval) clearInterval(interval);
  });

  // Stop IDE state capture
  if (ideStateCapture) {
    ideStateCapture.stop();
  }

  // Stop screenshot monitor
  if (screenshotMonitor) {
    screenshotMonitor.stop();
  }

  if (plotFileMonitor) {
    plotFileMonitor.stop();
  }

  if (global.plotFileMonitors) {
    global.plotFileMonitors.forEach((monitor) => monitor.stop());
    global.plotFileMonitors.clear();
  }

  server.close(() => {
    console.log(' Companion service stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n Shutting down companion service...');

  // Stop automatic mining scheduler
  if (automaticMiningScheduler && typeof automaticMiningScheduler.stop === 'function') {
    automaticMiningScheduler.stop();
  }

  // Stop automatic Hugging Face sync service
  if (automaticHfSyncService && typeof automaticHfSyncService.stop === 'function') {
    automaticHfSyncService.stop();
  }

  // Stop research sync service
  if (remoteSyncService && typeof remoteSyncService.stop === 'function') {
    remoteSyncService.stop();
  }

  // Stop file watcher service
  if (fileWatcherService && typeof fileWatcherService.stop === 'function') {
    fileWatcherService.stop();
  }

  clipboardMonitor.stop();

  // Clear capture intervals
  Object.values(captureIntervals).forEach((interval) => {
    if (interval) clearInterval(interval);
  });

  // Stop IDE state capture
  if (ideStateCapture) {
    ideStateCapture.stop();
  }

  // Stop screenshot monitor
  if (screenshotMonitor) {
    screenshotMonitor.stop();
  }

  if (plotFileMonitor) {
    plotFileMonitor.stop();
  }

  if (global.plotFileMonitors) {
    global.plotFileMonitors.forEach((monitor) => monitor.stop());
    global.plotFileMonitors.clear();
  }

  server.close(() => {
    console.log(' Companion service stopped');
    process.exit(0);
  });
});

// Wrapper for database repair service
async function repairDatabaseLinks() {
  return await dbRepairService.repairDatabaseLinks();
}

// Start the server
startupService.startServer().then(() => {
  // Start research sync service after server is ready
  if (remoteSyncService) {
    remoteSyncService.start();
  }
}).catch((error) => {
  console.error('Failed to start server:', error);
});
