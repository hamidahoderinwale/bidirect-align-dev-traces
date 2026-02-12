/**
 * Service Container / Dependency Injection Container
 *
 * Central registry for all services in the companion service.
 * Provides dependency injection, lifecycle management, and service discovery.
 *
 * This consolidates service initialization and makes dependencies explicit.
 */

class ServiceContainer {
  constructor() {
    this.services = new Map();
    this.initialized = new Set();
    this.initPromises = new Map();
  }

  /**
   * Register a service
   * @param {string} name - Service name
   * @param {Function|Object} factory - Factory function or service instance
   * @param {Array<string>} dependencies - List of dependency service names
   */
  register(name, factory, dependencies = []) {
    if (this.services.has(name)) {
      console.warn(`[SERVICE-CONTAINER] Service '${name}' already registered, overwriting`);
    }

    this.services.set(name, {
      factory,
      dependencies,
      instance: null,
      initialized: false,
    });

    console.log(
      `[SERVICE-CONTAINER] Registered service: ${name} (dependencies: ${dependencies.join(', ') || 'none'})`
    );
  }

  /**
   * Register a singleton service instance
   * @param {string} name - Service name
   * @param {Object} instance - Service instance
   */
  registerInstance(name, instance) {
    this.services.set(name, {
      factory: null,
      dependencies: [],
      instance,
      initialized: true,
    });

    this.initialized.add(name);
    console.log(`[SERVICE-CONTAINER] Registered singleton instance: ${name}`);
  }

  /**
   * Get a service instance (lazy initialization)
   * @param {string} name - Service name
   * @returns {Object} Service instance
   */
  get(name) {
    const service = this.services.get(name);

    if (!service) {
      throw new Error(`[SERVICE-CONTAINER] Service '${name}' not registered`);
    }

    // Return existing instance if already initialized
    if (service.initialized && service.instance) {
      return service.instance;
    }

    // Initialize if not already initialized
    if (!this.initialized.has(name)) {
      this.initializeService(name);
    }

    return service.instance;
  }

  /**
   * Initialize a service and its dependencies
   * @param {string} name - Service name
   */
  initializeService(name) {
    // Check if already initialized
    if (this.initialized.has(name)) {
      return this.services.get(name).instance;
    }

    // Check if initialization is in progress (circular dependency detection)
    if (this.initPromises.has(name)) {
      console.warn(`[SERVICE-CONTAINER] Circular dependency detected for '${name}'`);
      return this.initPromises.get(name);
    }

    const service = this.services.get(name);
    if (!service) {
      throw new Error(`[SERVICE-CONTAINER] Service '${name}' not registered`);
    }

    // If it's a singleton instance, return it
    if (service.instance && service.initialized) {
      return service.instance;
    }

    // Create initialization promise
    const initPromise = (async () => {
      try {
        // Initialize dependencies first
        const dependencyInstances = {};
        for (const depName of service.dependencies) {
          dependencyInstances[depName] = this.initializeService(depName);
        }

        // Wait for all dependencies to be ready
        await Promise.all(Object.values(dependencyInstances));

        // Create service instance
        if (typeof service.factory === 'function') {
          // Factory function - call with dependencies
          service.instance = await service.factory(dependencyInstances);
        } else if (service.factory) {
          // Already an instance
          service.instance = service.factory;
        } else {
          throw new Error(`[SERVICE-CONTAINER] No factory or instance for service '${name}'`);
        }

        service.initialized = true;
        this.initialized.add(name);

        console.log(`[SERVICE-CONTAINER] Initialized service: ${name}`);
        return service.instance;
      } catch (error) {
        console.error(`[SERVICE-CONTAINER] Failed to initialize service '${name}':`, error);
        throw error;
      } finally {
        this.initPromises.delete(name);
      }
    })();

    this.initPromises.set(name, initPromise);
    return initPromise;
  }

  /**
   * Check if a service is registered
   * @param {string} name - Service name
   * @returns {boolean}
   */
  has(name) {
    return this.services.has(name);
  }

  /**
   * Check if a service is initialized
   * @param {string} name - Service name
   * @returns {boolean}
   */
  isInitialized(name) {
    return this.initialized.has(name);
  }

  /**
   * Get all registered service names
   * @returns {Array<string>}
   */
  getRegisteredServices() {
    return Array.from(this.services.keys());
  }

  /**
   * Get all initialized service names
   * @returns {Array<string>}
   */
  getInitializedServices() {
    return Array.from(this.initialized);
  }

  /**
   * Clear all services (for testing)
   */
  clear() {
    this.services.clear();
    this.initialized.clear();
    this.initPromises.clear();
  }
}

// Export singleton instance
const serviceContainer = new ServiceContainer();

module.exports = serviceContainer;
module.exports.ServiceContainer = ServiceContainer;
