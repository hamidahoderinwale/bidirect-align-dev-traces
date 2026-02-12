/**
 * Feature Routes
 * Routes for specific features: states, sharing, whiteboard, todos, terminal, etc.
 */

const createStateRoutes = require('../states');
const createSharingRoutes = require('../sharing');
const createWhiteboardRoutes = require('../whiteboard');
const createTodosRoutes = require('../todos');
const createTerminalRoutes = require('../terminal');
const createScreenshotRoutes = require('../screenshots');
const createPlotRoutes = require('../plots');
const createIDEStateRoutes = require('../ide-state');
const createExportImportRoutes = require('../export-import');
const createMCPRoutes = require('../mcp');

/**
 * Register all feature-related routes
 */
function registerFeatureRoutes(app, deps) {
  createStateRoutes(deps);
  createSharingRoutes(deps);
  createWhiteboardRoutes(deps);
  createTodosRoutes(deps);
  createTerminalRoutes(deps);
  createScreenshotRoutes(deps);
  createPlotRoutes(deps);
  createIDEStateRoutes(deps);
  createExportImportRoutes(deps);

  // MCP routes are optional
  if (deps.config?.enable_mcp) {
    createMCPRoutes(deps);
  }

  console.log(
    '[ROUTES] Registered feature routes: states, sharing, whiteboard, todos, terminal, screenshots, plots, ide-state, export-import, mcp'
  );
}

module.exports = registerFeatureRoutes;
