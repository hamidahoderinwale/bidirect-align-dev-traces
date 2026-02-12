/**
 * Route Registry
 * Central registry for all route modules organized by domain
 *
 * This provides a clean way to register all routes with proper organization
 */

const registerDataRoutes = require('./data');
const registerAnalyticsRoutes = require('./analytics');
const registerAIRoutes = require('./ai');
const registerSystemRoutes = require('./system');
const registerFeatureRoutes = require('./features');

/**
 * Register all routes organized by domain
 * @param {Object} app - Express app instance
 * @param {Object} deps - Dependencies object containing all services
 */
function registerAllRoutes(app, deps) {
  console.log('[ROUTES] Registering all routes...');

  // System routes first (health, status, etc.)
  registerSystemRoutes(app, deps);

  // Data routes (core data access)
  registerDataRoutes(app, deps);

  // Analytics routes (Rung1-3, module graph, etc.)
  registerAnalyticsRoutes(app, deps);

  // AI routes (embeddings, annotations, etc.)
  registerAIRoutes(app, deps);

  // Feature routes (states, sharing, etc.)
  registerFeatureRoutes(app, deps);

  console.log('[ROUTES] All routes registered successfully');
}

module.exports = {
  registerAllRoutes,
  registerDataRoutes,
  registerAnalyticsRoutes,
  registerAIRoutes,
  registerSystemRoutes,
  registerFeatureRoutes,
};
