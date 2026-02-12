/**
 * Motif Service Initialization
 * Initializes and registers the motif service (Rung 6) and routes
 */

const MotifService = require('./clio/motif/motif-service.js');
const createMotifRoutes = require('../routes/motifs.js');

/**
 * Initialize motif service and register routes
 */
function initializeMotifService(app, persistentDB, options = {}) {
  let motifService = null;

  try {
    motifService = new MotifService(persistentDB, {
      extractorOptions: {
        minClusterSize: options.minClusterSize || 10,
        similarityThreshold: options.similarityThreshold || 0.7,
        maxMotifLength: options.maxMotifLength || 20,
      },
    });

    console.log('[MOTIF] Motif service initialized');
  } catch (error) {
    console.warn('[MOTIF] Failed to initialize motif service:', error.message);
    motifService = null;
  }

  // Always register routes, even if service is null
  // Routes will return 503 if service is not available
  createMotifRoutes({
    app,
    persistentDB,
    motifService,
  });

  return motifService;
}

module.exports = initializeMotifService;
