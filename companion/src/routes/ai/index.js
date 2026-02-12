/**
 * AI Routes
 * Routes for AI services: embeddings, chat, annotations, etc.
 */

const createAIRoutes = require('../ai');
const createAnnotationRoutes = require('../annotations');

/**
 * Register all AI-related routes
 */
function registerAIRoutes(app, deps) {
  createAIRoutes(deps);
  createAnnotationRoutes(deps);

  console.log('[ROUTES] Registered AI routes: ai, annotations');
}

module.exports = registerAIRoutes;
