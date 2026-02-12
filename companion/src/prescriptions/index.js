/**
 * Prescription System - Main Entry Point
 *
 * Exports all prescription modules and provides initialization function.
 */

const { initializePrescriptionSchema, CATEGORIES, SCOPES, SOURCES } = require('./schema');
const PrescriptionManager = require('./manager');
const PrescriptionInjector = require('./injector');
const PrescriptionDetector = require('./detector');
const createPrescriptionAPI = require('./api');

/**
 * Initialize the prescription system
 * @param {object} db - SQLite database instance
 * @param {object} app - Express app instance (optional, for auto-mounting routes)
 * @returns {object} Prescription system components
 */
function initializePrescriptionSystem(db, app = null) {
  // Initialize schema
  const schemaInitialized = initializePrescriptionSchema(db);

  if (!schemaInitialized) {
    console.error('Failed to initialize prescription schema');
    return null;
  }

  // Create manager
  const manager = new PrescriptionManager(db);

  // Create injector
  const injector = new PrescriptionInjector(manager);

  // Create detector
  const detector = new PrescriptionDetector(db, manager);

  // Create API router
  const apiRouter = createPrescriptionAPI(manager, injector, detector);

  // Auto-mount routes if app provided
  if (app) {
    app.use('/api/prescriptions', apiRouter);
    console.log('Prescription API mounted at /api/prescriptions');
  }

  console.log('Prescription system initialized');

  return {
    manager,
    injector,
    detector,
    apiRouter,
    constants: {
      CATEGORIES,
      SCOPES,
      SOURCES,
    },
  };
}

module.exports = {
  initializePrescriptionSystem,
  PrescriptionManager,
  PrescriptionInjector,
  PrescriptionDetector,
  createPrescriptionAPI,
  CATEGORIES,
  SCOPES,
  SOURCES,
};
