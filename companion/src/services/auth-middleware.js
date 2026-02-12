/**
 * API Authentication Middleware
 * Protects API endpoints with API key authentication
 */

const crypto = require('crypto');

class AuthMiddleware {
  constructor(options = {}) {
    // Load API keys from environment or generate one
    this.apiKeys = new Set();
    this.failedAttempts = new Map(); // Track failed attempts for rate limiting
    this.auditLog = options.auditLog || null; // Optional audit logging function
    this.maxFailedAttempts = options.maxFailedAttempts || 5;
    this.lockoutDuration = options.lockoutDuration || 15 * 60 * 1000; // 15 minutes
    this.rateLimitWindow = options.rateLimitWindow || 60 * 1000; // 1 minute
    this.rateLimitMax = options.rateLimitMax || 100; // Max requests per window

    // Load from environment
    const envKeys = process.env.API_KEYS?.split(',').filter((k) => k) || [];
    envKeys.forEach((key) => this.apiKeys.add(key.trim()));

    // In production, require explicit configuration
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && this.apiKeys.size === 0 && process.env.PUBLIC_API !== 'true') {
      throw new Error(
        'SECURITY ERROR: No API keys configured in production. ' +
        'Set API_KEYS environment variable or PUBLIC_API=true'
      );
    }

    // If no keys provided and PUBLIC_API is not true, generate one (dev only)
    if (this.apiKeys.size === 0 && process.env.PUBLIC_API !== 'true' && !isProduction) {
      const generatedKey = crypto.randomBytes(32).toString('hex');
      this.apiKeys.add(generatedKey);
      console.log('\nWARNING: No API keys configured!');
      console.log('Generated temporary API key:', generatedKey);
      console.log('Add to .env file: API_KEYS=' + generatedKey);
      console.log('');
    }

    // Check if authentication is required
    this.requireAuth = process.env.REQUIRE_AUTH === 'true' || process.env.API_KEYS;

    if (!this.requireAuth) {
      console.log('API authentication is DISABLED (set REQUIRE_AUTH=true to enable)');
    } else {
      console.log(`API authentication ENABLED (${this.apiKeys.size} keys configured)`);
    }

    // Clean up old failed attempts periodically
    setInterval(() => this._cleanupFailedAttempts(), 60 * 1000); // Every minute
  }

  /**
   * Extract API key from request (prioritizes headers over query params)
   */
  _extractApiKey(req) {
    // Prefer headers (more secure)
    if (req.headers['x-api-key']) {
      return req.headers['x-api-key'];
    }

    // Parse Authorization header properly
    const authHeader = req.headers['authorization'];
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        return parts[1];
      }
      // Fallback: try simple replacement for backwards compatibility
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
    }

    // Query parameter (less secure - consider deprecating)
    // Only allow in non-production or if explicitly enabled
    const allowQueryParam =
      process.env.NODE_ENV !== 'production' ||
      process.env.ALLOW_QUERY_API_KEY === 'true';

    if (allowQueryParam && req.query?.api_key) {
      console.warn('[AUTH] API key provided via query parameter (insecure)');
      return req.query.api_key;
    }

    return null;
  }

  /**
   * Check rate limiting for an IP address
   */
  _checkRateLimit(ip) {
    const now = Date.now();
    const key = `rate_limit_${ip}`;

    if (!this.failedAttempts.has(key)) {
      this.failedAttempts.set(key, { count: 0, resetAt: now + this.rateLimitWindow });
      return true;
    }

    const limit = this.failedAttempts.get(key);

    if (now > limit.resetAt) {
      limit.count = 0;
      limit.resetAt = now + this.rateLimitWindow;
      return true;
    }

    if (limit.count >= this.rateLimitMax) {
      return false;
    }

    limit.count++;
    return true;
  }

  /**
   * Record failed authentication attempt
   */
  _recordFailedAttempt(ip, apiKey) {
    const key = `failed_${ip}`;
    const now = Date.now();

    if (!this.failedAttempts.has(key)) {
      this.failedAttempts.set(key, { count: 1, firstAttempt: now, lockedUntil: null });
    } else {
      const record = this.failedAttempts.get(key);
      record.count++;

      // Lock out after max failed attempts
      if (record.count >= this.maxFailedAttempts && !record.lockedUntil) {
        record.lockedUntil = now + this.lockoutDuration;
        if (this.auditLog) {
          this.auditLog('security', `IP ${ip} locked out after ${record.count} failed attempts`);
        }
      }
    }

    // Log failed attempt
    if (this.auditLog) {
      const maskedKey = apiKey ? `${apiKey.substring(0, 8)}...` : 'none';
      this.auditLog('auth_failure', `Failed auth attempt from ${ip} with key ${maskedKey}`);
    }
  }

  /**
   * Check if IP is locked out
   */
  _isLockedOut(ip) {
    const key = `failed_${ip}`;
    const record = this.failedAttempts.get(key);

    if (!record || !record.lockedUntil) {
      return false;
    }

    if (Date.now() < record.lockedUntil) {
      return true;
    }

    // Lockout expired, reset
    record.count = 0;
    record.lockedUntil = null;
    return false;
  }

  /**
   * Clean up old failed attempt records
   */
  _cleanupFailedAttempts() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, record] of this.failedAttempts.entries()) {
      if (key.startsWith('failed_') && record.lockedUntil && now > record.lockedUntil + this.lockoutDuration) {
        keysToDelete.push(key);
      } else if (key.startsWith('rate_limit_') && now > record.resetAt + this.rateLimitWindow) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.failedAttempts.delete(key));
  }

  /**
   * Express middleware for API key authentication
   */
  authenticate = (req, res, next) => {
    // Skip auth if not required
    if (!this.requireAuth) {
      return next();
    }

    // Enforce HTTPS in production
    if (process.env.NODE_ENV === 'production' && req.protocol !== 'https' && !req.secure) {
      return res.status(403).json({
        error: 'HTTPS required',
        message: 'API keys must be sent over HTTPS in production',
      });
    }

    // Get client IP for rate limiting
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

    // Check rate limiting
    if (!this._checkRateLimit(clientIp)) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.',
      });
    }

    // Check if IP is locked out
    if (this._isLockedOut(clientIp)) {
      return res.status(429).json({
        error: 'Account temporarily locked',
        message: 'Too many failed authentication attempts. Please try again later.',
      });
    }

    // Extract API key (prioritizes headers)
    const apiKey = this._extractApiKey(req);

    if (!apiKey) {
      this._recordFailedAttempt(clientIp, null);
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide an API key via X-API-Key header or Authorization: Bearer header',
      });
    }

    // Validate API key
    if (!this.apiKeys.has(apiKey)) {
      this._recordFailedAttempt(clientIp, apiKey);
      return res.status(403).json({
        error: 'Invalid API key',
        message: 'The provided API key is not valid',
      });
    }

    // Authentication successful
    if (this.auditLog) {
      this.auditLog('auth_success', `Successful auth from ${clientIp}`);
    }

    // Clear failed attempts on success
    const failedKey = `failed_${clientIp}`;
    if (this.failedAttempts.has(failedKey)) {
      this.failedAttempts.delete(failedKey);
    }

    next();
  };

  /**
   * Express middleware for optional authentication
   * Allows both authenticated and unauthenticated requests
   */
  optionalAuth = (req, res, next) => {
    const apiKey = this._extractApiKey(req);

    if (apiKey && this.apiKeys.has(apiKey)) {
      req.authenticated = true;
      if (this.auditLog) {
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        this.auditLog('auth_optional', `Optional auth success from ${clientIp}`);
      }
    } else {
      req.authenticated = false;
    }

    next();
  };

  /**
   * Generate a new API key with optional metadata
   */
  generateKey(metadata = {}) {
    const newKey = crypto.randomBytes(32).toString('hex');
    this.apiKeys.add(newKey);

    if (this.auditLog) {
      this.auditLog('key_generated', `New API key generated: ${newKey.substring(0, 8)}...`);
    }

    return newKey;
  }

  /**
   * Revoke an API key
   */
  revokeKey(apiKey) {
    const revoked = this.apiKeys.delete(apiKey);

    if (revoked && this.auditLog) {
      this.auditLog('key_revoked', `API key revoked: ${apiKey.substring(0, 8)}...`);
    }

    return revoked;
  }

  /**
   * List all API keys (hashed for security)
   */
  listKeys() {
    return Array.from(this.apiKeys).map((key) => ({
      key: key.substring(0, 8) + '...' + key.substring(key.length - 8),
      hash: crypto.createHash('sha256').update(key).digest('hex').substring(0, 16),
      fullHash: crypto.createHash('sha256').update(key).digest('hex'),
    }));
  }

  /**
   * Get authentication statistics
   */
  getStats() {
    const failedCounts = Array.from(this.failedAttempts.entries())
      .filter(([key]) => key.startsWith('failed_'))
      .map(([, record]) => record.count);

    return {
      totalKeys: this.apiKeys.size,
      totalFailedAttempts: failedCounts.reduce((sum, count) => sum + count, 0),
      lockedOutIPs: Array.from(this.failedAttempts.entries())
        .filter(([key, record]) => key.startsWith('failed_') && record.lockedUntil && Date.now() < record.lockedUntil)
        .length,
    };
  }
}

module.exports = AuthMiddleware;
