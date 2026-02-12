/**
 * System Routes
 * Routes for system operations: health, status, schema, core utilities, etc.
 */

const createCoreRoutes = require('../core');
const createStatusRoutes = require('../status');
const createSchemaRoutes = require('../schema');
const createMiscRoutes = require('../misc');
const { createRetentionRoutes } = require('./retention');
const { createExportHistoryRoutes } = require('./export-history');
const { createPreferencesRoutes } = require('./preferences');

/**
 * Register all system-related routes
 */
function registerSystemRoutes(app, deps) {
  createCoreRoutes(deps);
  createStatusRoutes(deps);
  createSchemaRoutes(deps);
  createMiscRoutes(deps);

  // New system management routes
  createRetentionRoutes(deps);
  createExportHistoryRoutes(deps);
  createPreferencesRoutes(deps);

  console.log(
    '[ROUTES] Registered system routes: core, status, schema, misc, retention, export-history, preferences'
  );
}

module.exports = registerSystemRoutes;
