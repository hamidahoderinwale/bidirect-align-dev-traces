/**
 * Analytics Routes
 * Routes for analytics and abstraction services: Rung1-3, Module Graph, Motifs, Clio, etc.
 */

const createAnalyticsRoutes = require('../analytics');
const createRung1Routes = require('../rung1');
const createRung2Routes = require('../rung2');
const createRung3Routes = require('../rung3');
const createModuleGraphRoutes = require('../module-graph');
const createMotifRoutes = require('../motifs');
const createClioRoutes = require('../clio');

/**
 * Register all analytics-related routes
 */
function registerAnalyticsRoutes(app, deps) {
  createAnalyticsRoutes(deps);

  // Rung services are conditionally registered (may not be available)
  if (deps.rung1Service) {
    createRung1Routes({ app, rung1Service: deps.rung1Service });
  }

  if (deps.rung2Service) {
    createRung2Routes({ app, rung2Service: deps.rung2Service });
  }

  if (deps.rung3Service) {
    createRung3Routes({ app, rung3Service: deps.rung3Service });
  }

  if (deps.moduleGraphService) {
    createModuleGraphRoutes({ app, moduleGraphService: deps.moduleGraphService });
  }

  if (deps.motifService) {
    createMotifRoutes({ app, motifService: deps.motifService });
  }

  // Clio routes (privacy-preserving workflow patterns)
  if (deps.clioService) {
    const clioRouter = createClioRoutes(deps);
    app.use('/api/clio', clioRouter);
    console.log('[ROUTES] Registered Clio routes at /api/clio');
  }

  console.log(
    '[ROUTES] Registered analytics routes: analytics, rung1-3, module-graph, motifs, clio'
  );
}

module.exports = registerAnalyticsRoutes;
