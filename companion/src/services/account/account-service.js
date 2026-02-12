/**
 * Account Service
 * Handles user authentication, account management, and device registration
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

class AccountService {
  constructor(persistentDB, options = {}) {
    this.db = persistentDB;
    this.options = {
      accountServiceUrl: process.env.ACCOUNT_SERVICE_URL || 'https://api.cursor-telemetry.com',
      localMode: process.env.ACCOUNT_LOCAL_MODE === 'true',
      ...options,
    };

    // In-memory cache for account info
    this.accountCache = null;
    this.deviceId = this.getOrCreateDeviceId();

    // Initialize account tables
    this.initializeTables();
  }

  /**
   * Get or create device ID (unique per machine)
   */
  getOrCreateDeviceId() {
    const deviceIdPath = path.join(process.cwd(), 'data', '.device-id');

    try {
      if (require('fs').existsSync(deviceIdPath)) {
        return require('fs').readFileSync(deviceIdPath, 'utf8').trim();
      }
    } catch (error) {
      // Ignore errors, will create new ID
    }

    // Generate new device ID
    const deviceId = crypto.randomBytes(16).toString('hex');

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(deviceIdPath);
      if (!require('fs').existsSync(dataDir)) {
        require('fs').mkdirSync(dataDir, { recursive: true });
      }
      require('fs').writeFileSync(deviceIdPath, deviceId, 'utf8');
    } catch (error) {
      console.warn('[ACCOUNT] Could not save device ID:', error.message);
    }

    return deviceId;
  }

  /**
   * Initialize account-related database tables
   */
  async initializeTables() {
    const createAccountsTable = `
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at INTEGER,
        device_id TEXT,
        device_name TEXT,
        created_at INTEGER,
        last_synced_at INTEGER,
        sync_enabled INTEGER DEFAULT 0
      )
    `;

    const createSyncStateTable = `
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      )
    `;

    try {
      await this.db.run(createAccountsTable);
      await this.db.run(createSyncStateTable);
      console.log('[ACCOUNT] Account tables initialized');
    } catch (error) {
      console.error('[ACCOUNT] Failed to initialize tables:', error.message);
    }
  }

  /**
   * Register or login user
   */
  async authenticate(email, password) {
    if (this.options.localMode) {
      // Local mode: create account locally
      return this.createLocalAccount(email, password);
    }

    try {
      // Call account service API
      const response = await fetch(`${this.options.accountServiceUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, device_id: this.deviceId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Authentication failed');
      }

      const data = await response.json();
      await this.saveAccountTokens(data);

      return {
        success: true,
        account_id: data.account_id,
        email: data.email,
        access_token: data.access_token,
      };
    } catch (error) {
      console.error('[ACCOUNT] Authentication error:', error.message);
      throw error;
    }
  }

  /**
   * Register new account
   */
  async register(email, password, deviceName) {
    if (this.options.localMode) {
      return this.createLocalAccount(email, password, deviceName);
    }

    try {
      const response = await fetch(`${this.options.accountServiceUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          device_id: this.deviceId,
          device_name: deviceName || this.getDeviceName(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Registration failed');
      }

      const data = await response.json();
      await this.saveAccountTokens(data);

      return {
        success: true,
        account_id: data.account_id,
        email: data.email,
        access_token: data.access_token,
      };
    } catch (error) {
      console.error('[ACCOUNT] Registration error:', error.message);
      throw error;
    }
  }

  /**
   * Create local account (for offline/local mode)
   */
  async createLocalAccount(email, password, deviceName) {
    const accountId = crypto.randomBytes(16).toString('hex');
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

    // Generate local access token
    const accessToken = crypto.randomBytes(32).toString('hex');

    await this.db.run(
      `INSERT OR REPLACE INTO accounts 
       (account_id, email, access_token, device_id, device_name, created_at, sync_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        email,
        accessToken,
        this.deviceId,
        deviceName || this.getDeviceName(),
        Date.now(),
        0, // Local mode: sync disabled
      ]
    );

    return {
      success: true,
      account_id: accountId,
      email: email,
      access_token: accessToken,
      local_mode: true,
    };
  }

  /**
   * Save account tokens to database
   */
  async saveAccountTokens(data) {
    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : Date.now() + 24 * 60 * 60 * 1000; // Default 24 hours

    await this.db.run(
      `INSERT OR REPLACE INTO accounts 
       (account_id, email, access_token, refresh_token, token_expires_at, device_id, device_name, last_synced_at, sync_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.account_id,
        data.email,
        data.access_token,
        data.refresh_token || null,
        expiresAt,
        this.deviceId,
        data.device_name || this.getDeviceName(),
        Date.now(),
        1, // Sync enabled
      ]
    );

    this.accountCache = {
      account_id: data.account_id,
      email: data.email,
      access_token: data.access_token,
      expires_at: expiresAt,
    };
  }

  /**
   * Get current account info
   */
  async getAccount() {
    if (this.accountCache) {
      return this.accountCache;
    }

    try {
      const row = await this.db.get(
        'SELECT account_id, email, access_token, token_expires_at, sync_enabled FROM accounts WHERE device_id = ?',
        [this.deviceId]
      );

      if (row) {
        this.accountCache = {
          account_id: row.account_id,
          email: row.email,
          access_token: row.access_token,
          expires_at: row.token_expires_at,
          sync_enabled: row.sync_enabled === 1,
        };
        return this.accountCache;
      }
    } catch (error) {
      console.error('[ACCOUNT] Error getting account:', error.message);
    }

    return null;
  }

  /**
   * Check if account is authenticated
   */
  async isAuthenticated() {
    const account = await this.getAccount();
    if (!account) return false;

    // Check if token is expired
    if (account.expires_at && account.expires_at < Date.now()) {
      // Try to refresh token
      try {
        await this.refreshToken();
        return true;
      } catch (error) {
        return false;
      }
    }

    return true;
  }

  /**
   * Refresh access token
   */
  async refreshToken() {
    const account = await this.getAccount();
    if (!account) throw new Error('No account found');

    if (this.options.localMode) {
      // Local mode: no refresh needed
      return account;
    }

    try {
      const row = await this.db.get('SELECT refresh_token FROM accounts WHERE account_id = ?', [
        account.account_id,
      ]);

      if (!row || !row.refresh_token) {
        throw new Error('No refresh token available');
      }

      const response = await fetch(`${this.options.accountServiceUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refresh_token: row.refresh_token,
          device_id: this.deviceId,
        }),
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();
      await this.saveAccountTokens(data);

      return this.accountCache;
    } catch (error) {
      console.error('[ACCOUNT] Token refresh error:', error.message);
      throw error;
    }
  }

  /**
   * Get access token for API calls
   */
  async getAccessToken() {
    const account = await this.getAccount();
    if (!account) return null;

    // Check if token needs refresh
    if (account.expires_at && account.expires_at < Date.now()) {
      await this.refreshToken();
      return this.accountCache?.access_token;
    }

    return account.access_token;
  }

  /**
   * Logout (clear local account data)
   */
  async logout() {
    try {
      await this.db.run('DELETE FROM accounts WHERE device_id = ?', [this.deviceId]);
      this.accountCache = null;
      return { success: true };
    } catch (error) {
      console.error('[ACCOUNT] Logout error:', error.message);
      throw error;
    }
  }

  /**
   * Get device name
   */
  getDeviceName() {
    const os = require('os');
    return `${os.hostname()} (${os.platform()})`;
  }

  /**
   * Update sync state
   */
  async updateSyncState(key, value) {
    await this.db.run(
      'INSERT OR REPLACE INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)',
      [key, JSON.stringify(value), Date.now()]
    );
  }

  /**
   * Get sync state
   */
  async getSyncState(key) {
    const row = await this.db.get('SELECT value FROM sync_state WHERE key = ?', [key]);
    if (row) {
      try {
        return JSON.parse(row.value);
      } catch (error) {
        return row.value;
      }
    }
    return null;
  }

  /**
   * Register or login with OAuth provider
   */
  async authenticateWithOAuth(provider, userInfo, oauthTokens) {
    if (this.options.localMode) {
      return this.createLocalAccountFromOAuth(provider, userInfo, oauthTokens);
    }

    try {
      // Check if account exists with this email
      const existingAccount = await this.db.get('SELECT account_id FROM accounts WHERE email = ?', [
        userInfo.email,
      ]);

      let accountId;
      let isNewAccount = false;

      if (existingAccount) {
        // Existing account - login
        accountId = existingAccount.account_id;
      } else {
        // New account - register
        accountId = crypto.randomBytes(16).toString('hex');
        isNewAccount = true;
      }

      // Create or update account with OAuth info
      const accessToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

      await this.db.run(
        `INSERT OR REPLACE INTO accounts 
         (account_id, email, access_token, token_expires_at, device_id, device_name, created_at, sync_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          userInfo.email,
          accessToken,
          expiresAt,
          this.deviceId,
          this.getDeviceName(),
          isNewAccount
            ? Date.now()
            : (
                await this.db.get('SELECT created_at FROM accounts WHERE account_id = ?', [
                  accountId,
                ])
              )?.created_at || Date.now(),
          1, // Sync enabled for OAuth accounts
        ]
      );

      // Save OAuth tokens if oauthService is available
      if (this.oauthService) {
        await this.oauthService.saveOAuthTokens(accountId, provider, oauthTokens, userInfo);
      }

      // Assign default role to new accounts
      if (isNewAccount && this.authorizationService) {
        await this.authorizationService.assignRole(accountId, 'user');
      }

      this.accountCache = {
        account_id: accountId,
        email: userInfo.email,
        access_token: accessToken,
        expires_at: expiresAt,
        sync_enabled: true,
        oauth_provider: provider,
      };

      return {
        success: true,
        account_id: accountId,
        email: userInfo.email,
        access_token: accessToken,
        is_new_account: isNewAccount,
      };
    } catch (error) {
      console.error('[ACCOUNT] OAuth authentication error:', error.message);
      throw error;
    }
  }

  /**
   * Create local account from OAuth (for local mode)
   */
  async createLocalAccountFromOAuth(provider, userInfo, oauthTokens) {
    const accountId = crypto.randomBytes(16).toString('hex');
    const accessToken = crypto.randomBytes(32).toString('hex');

    await this.db.run(
      `INSERT OR REPLACE INTO accounts 
       (account_id, email, access_token, device_id, device_name, created_at, sync_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        userInfo.email,
        accessToken,
        this.deviceId,
        this.getDeviceName(),
        Date.now(),
        0, // Local mode: sync disabled
      ]
    );

    // Save OAuth tokens if oauthService is available
    if (this.oauthService) {
      await this.oauthService.saveOAuthTokens(accountId, provider, oauthTokens, userInfo);
    }

    // Assign default role
    if (this.authorizationService) {
      await this.authorizationService.assignRole(accountId, 'user');
    }

    return {
      success: true,
      account_id: accountId,
      email: userInfo.email,
      access_token: accessToken,
      local_mode: true,
    };
  }

  /**
   * Set OAuth service reference
   */
  setOAuthService(oauthService) {
    this.oauthService = oauthService;
  }

  /**
   * Set authorization service reference
   */
  setAuthorizationService(authorizationService) {
    this.authorizationService = authorizationService;
  }
}

module.exports = AccountService;
