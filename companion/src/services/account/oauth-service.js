/**
 * OAuth Service
 * Handles OAuth 2.0 authentication flows with authorization support
 * Based on Cloudflare MCP OAuth pattern, adapted for Express.js
 */

const crypto = require('crypto');

class OAuthService {
  constructor(persistentDB, options = {}) {
    this.db = persistentDB;
    this.options = {
      baseUrl: process.env.BASE_URL || process.env.COMPANION_BASE_URL || 'http://localhost:43917',
      cookieEncryptionKey:
        process.env.COOKIE_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex'),
      ...options,
    };

    // OAuth providers configuration
    this.providers = {
      github: {
        name: 'GitHub',
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        userInfoUrl: 'https://api.github.com/user',
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        scopes: ['user:email'],
      },
      google: {
        name: 'Google',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        scopes: ['openid', 'email', 'profile'],
      },
    };

    // Initialize OAuth tables
    this.initializeTables();
  }

  /**
   * Initialize OAuth-related database tables
   */
  async initializeTables() {
    const createOAuthStateTable = `
      CREATE TABLE IF NOT EXISTS oauth_state (
        state TEXT PRIMARY KEY,
        provider TEXT,
        redirect_uri TEXT,
        client_id TEXT,
        created_at INTEGER,
        expires_at INTEGER
      )
    `;

    const createOAuthTokensTable = `
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        account_id TEXT PRIMARY KEY,
        provider TEXT,
        provider_user_id TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at INTEGER,
        user_info TEXT,
        created_at INTEGER,
        FOREIGN KEY (account_id) REFERENCES accounts(account_id)
      )
    `;

    const createOAuthClientsTable = `
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_secret TEXT,
        name TEXT,
        redirect_uris TEXT,
        scopes TEXT,
        created_at INTEGER,
        account_id TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(account_id)
      )
    `;

    try {
      await this.db.run(createOAuthStateTable);
      await this.db.run(createOAuthTokensTable);
      await this.db.run(createOAuthClientsTable);
      console.log('[OAUTH] OAuth tables initialized');
    } catch (error) {
      console.error('[OAUTH] Failed to initialize tables:', error.message);
    }
  }

  /**
   * Generate OAuth state token
   */
  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Store OAuth state
   */
  async storeState(state, provider, redirectUri, clientId = null) {
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    await this.db.run(
      'INSERT OR REPLACE INTO oauth_state (state, provider, redirect_uri, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [state, provider, redirectUri, clientId, Date.now(), expiresAt]
    );

    return state;
  }

  /**
   * Verify and consume OAuth state
   */
  async verifyState(state) {
    const row = await this.db.get(
      'SELECT provider, redirect_uri, client_id, expires_at FROM oauth_state WHERE state = ?',
      [state]
    );

    if (!row) {
      throw new Error('Invalid OAuth state');
    }

    if (row.expires_at < Date.now()) {
      await this.db.run('DELETE FROM oauth_state WHERE state = ?', [state]);
      throw new Error('OAuth state expired');
    }

    // Consume state (delete it)
    await this.db.run('DELETE FROM oauth_state WHERE state = ?', [state]);

    return {
      provider: row.provider,
      redirectUri: row.redirect_uri,
      clientId: row.client_id,
    };
  }

  /**
   * Get authorization URL for provider
   */
  getAuthorizationUrl(provider, redirectUri, clientId = null, scopes = null) {
    const config = this.providers[provider];
    if (!config) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    if (!config.clientId) {
      throw new Error(
        `${config.name} OAuth not configured. Please set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET environment variables.`
      );
    }

    const state = this.generateState();
    this.storeState(state, provider, redirectUri, clientId);

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      scope: (scopes || config.scopes).join(' '),
      state: state,
      response_type: 'code',
    });

    // Google uses additional parameter
    if (provider === 'google') {
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    }

    return {
      url: `${config.authUrl}?${params.toString()}`,
      state: state,
    };
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(provider, code, redirectUri) {
    const config = this.providers[provider];
    if (!config) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    // Exchange code for token
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokenData = await tokenResponse.json();

    // Get user info
    const userInfo = await this.getUserInfo(provider, tokenData.access_token);

    return {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenData.expires_in,
      user_info: userInfo,
    };
  }

  /**
   * Get user info from provider
   */
  async getUserInfo(provider, accessToken) {
    const config = this.providers[provider];
    if (!config) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    const response = await fetch(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user info');
    }

    const userInfo = await response.json();

    // Normalize user info across providers
    return {
      id: userInfo.id || userInfo.sub,
      email: userInfo.email,
      name: userInfo.name || userInfo.login,
      avatar: userInfo.avatar_url || userInfo.picture,
      provider: provider,
      raw: userInfo,
    };
  }

  /**
   * Save OAuth tokens for account
   */
  async saveOAuthTokens(accountId, provider, tokenData, userInfo) {
    const expiresAt = tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : Date.now() + 24 * 60 * 60 * 1000; // Default 24 hours

    await this.db.run(
      `INSERT OR REPLACE INTO oauth_tokens 
       (account_id, provider, provider_user_id, access_token, refresh_token, token_expires_at, user_info, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        provider,
        userInfo.id,
        tokenData.access_token,
        tokenData.refresh_token || null,
        expiresAt,
        JSON.stringify(userInfo),
        Date.now(),
      ]
    );
  }

  /**
   * Get OAuth tokens for account
   */
  async getOAuthTokens(accountId) {
    const row = await this.db.get(
      'SELECT provider, access_token, refresh_token, token_expires_at, user_info FROM oauth_tokens WHERE account_id = ?',
      [accountId]
    );

    if (!row) {
      return null;
    }

    return {
      provider: row.provider,
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expires_at: row.token_expires_at,
      user_info: JSON.parse(row.user_info),
    };
  }

  /**
   * Register OAuth client (for MCP server integration)
   */
  async registerClient(name, redirectUris, scopes, accountId) {
    const clientId = crypto.randomBytes(16).toString('hex');
    const clientSecret = crypto.randomBytes(32).toString('hex');

    await this.db.run(
      `INSERT INTO oauth_clients (client_id, client_secret, name, redirect_uris, scopes, account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        clientSecret,
        name,
        JSON.stringify(redirectUris),
        JSON.stringify(scopes),
        accountId,
        Date.now(),
      ]
    );

    return {
      client_id: clientId,
      client_secret: clientSecret,
      name: name,
    };
  }

  /**
   * Verify OAuth client
   */
  async verifyClient(clientId, clientSecret) {
    const row = await this.db.get(
      'SELECT client_id, client_secret, account_id, scopes FROM oauth_clients WHERE client_id = ?',
      [clientId]
    );

    if (!row) {
      return null;
    }

    if (clientSecret && row.client_secret !== clientSecret) {
      return null;
    }

    return {
      client_id: row.client_id,
      account_id: row.account_id,
      scopes: JSON.parse(row.scopes || '[]'),
    };
  }

  /**
   * Get available providers
   */
  getAvailableProviders() {
    return Object.keys(this.providers).filter((provider) => {
      const config = this.providers[provider];
      return config.clientId && config.clientSecret;
    });
  }
}

module.exports = OAuthService;
