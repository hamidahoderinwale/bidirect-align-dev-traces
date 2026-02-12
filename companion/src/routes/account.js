/**
 * Account Routes
 * API endpoints for account management, OAuth, and authorization
 */

const crypto = require('crypto');
const AccountService = require('../services/account/account-service');
const CloudSyncService = require('../services/account/cloud-sync-service');
const OAuthService = require('../services/account/oauth-service');
const AuthorizationService = require('../services/account/authorization-service');
const createAuthorizationMiddleware = require('../middleware/authorization-middleware');

function setupAccountRoutes(app, persistentDB, options = {}) {
  // Initialize services
  const accountService = new AccountService(persistentDB, options);
  const cloudSyncService = new CloudSyncService(accountService, persistentDB, options);
  const oauthService = new OAuthService(persistentDB, options);
  const authorizationService = new AuthorizationService(persistentDB, options);

  // Link services
  accountService.setOAuthService(oauthService);
  accountService.setAuthorizationService(authorizationService);

  // Store services in app locals for middleware access
  app.locals.accountService = accountService;
  app.locals.authorizationService = authorizationService;

  // Create authorization middleware
  const authz = createAuthorizationMiddleware(authorizationService);

  // Return account service instance for use by other services
  // This allows sharing service to access account info

  // Start cloud sync if account is configured
  accountService.getAccount().then((account) => {
    if (account && account.sync_enabled) {
      cloudSyncService.start().catch((error) => {
        console.error('[ACCOUNT] Failed to start cloud sync:', error.message);
      });
    }
  });

  /**
   * GET /api/account/status
   * Get current account status
   */
  app.get('/api/account/status', async (req, res) => {
    try {
      const account = await accountService.getAccount();

      // Try to get sync status, but don't fail if it errors
      let syncStatus = {
        enabled: false,
        authenticated: account !== null,
        last_sync: null,
        sync_in_progress: false,
        account_email: account?.email || null,
      };

      try {
        syncStatus = await cloudSyncService.getSyncStatus();
      } catch (syncError) {
        console.warn('[ACCOUNT] Error getting sync status:', syncError.message);
        // Use default sync status if getSyncStatus fails
      }

      res.json({
        success: true,
        authenticated: account !== null,
        account: account
          ? {
              account_id: account.account_id,
              email: account.email,
              sync_enabled: account.sync_enabled,
            }
          : null,
        sync: syncStatus,
      });
    } catch (error) {
      console.error('[ACCOUNT] Error getting account status:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/register
   * Register new account
   */
  app.post('/api/account/register', async (req, res) => {
    try {
      const { email, password, device_name } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required',
        });
      }

      const result = await accountService.register(email, password, device_name);

      // Start cloud sync if not in local mode
      if (result.success && !result.local_mode) {
        await cloudSyncService.start();
      }

      res.json({
        success: true,
        account: {
          account_id: result.account_id,
          email: result.email,
        },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/login
   * Login to account
   */
  app.post('/api/account/login', async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required',
        });
      }

      const result = await accountService.authenticate(email, password);

      // Start cloud sync if not in local mode
      if (result.success && !result.local_mode) {
        await cloudSyncService.start();
      }

      res.json({
        success: true,
        account: {
          account_id: result.account_id,
          email: result.email,
        },
      });
    } catch (error) {
      res.status(401).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/logout
   * Logout from account
   */
  app.post('/api/account/logout', async (req, res) => {
    try {
      cloudSyncService.stop();
      await accountService.logout();

      res.json({
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/sync/enable
   * Enable cloud sync
   */
  app.post('/api/account/sync/enable', async (req, res) => {
    try {
      const account = await accountService.getAccount();
      if (!account) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }

      // Update sync enabled in database
      await persistentDB.run('UPDATE accounts SET sync_enabled = 1 WHERE account_id = ?', [
        account.account_id,
      ]);

      // Start sync service
      await cloudSyncService.start();

      res.json({
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/sync/disable
   * Disable cloud sync
   */
  app.post('/api/account/sync/disable', async (req, res) => {
    try {
      cloudSyncService.stop();

      const account = await accountService.getAccount();
      if (account) {
        await persistentDB.run('UPDATE accounts SET sync_enabled = 0 WHERE account_id = ?', [
          account.account_id,
        ]);
      }

      res.json({
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/sync/now
   * Trigger manual sync
   */
  app.post('/api/account/sync/now', async (req, res) => {
    try {
      const account = await accountService.getAccount();
      if (!account) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }

      const { direction = 'both' } = req.body;

      let result = {};

      if (direction === 'up' || direction === 'both') {
        result.upload = await cloudSyncService.syncToCloud();
      }

      if (direction === 'down' || direction === 'both') {
        result.download = await cloudSyncService.syncFromCloud();
      }

      res.json({
        success: true,
        sync: result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/account/sync/status
   * Get sync status
   */
  app.get('/api/account/sync/status', async (req, res) => {
    try {
      const status = await cloudSyncService.getSyncStatus();
      res.json({
        success: true,
        ...status,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/account/oauth/providers
   * Get available OAuth providers
   */
  app.get('/api/account/oauth/providers', async (req, res) => {
    try {
      const providers = oauthService.getAvailableProviders();
      res.json({
        success: true,
        providers: providers.map((provider) => ({
          id: provider,
          name: oauthService.providers[provider].name,
        })),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/account/oauth/authorize/:provider
   * Initiate OAuth authorization flow
   */
  app.get('/api/account/oauth/authorize/:provider', async (req, res) => {
    try {
      const { provider } = req.params;
      const { client_id, redirect_uri, scope } = req.query;

      const redirectUri =
        redirect_uri || `${oauthService.options.baseUrl}/api/account/oauth/callback/${provider}`;
      const scopes = scope ? scope.split(' ') : null;

      const { url, state } = oauthService.getAuthorizationUrl(
        provider,
        redirectUri,
        client_id,
        scopes
      );

      // Store state in cookie for verification
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 10 * 60 * 1000, // 10 minutes
      });

      res.json({
        success: true,
        authorization_url: url,
        state: state,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/account/oauth/authorize/:provider
   * Alternative endpoint that redirects directly (for browser)
   */
  app.post('/api/account/oauth/authorize/:provider', async (req, res) => {
    try {
      const { provider } = req.params;
      const { client_id, redirect_uri, scope } = req.body;

      const redirectUri =
        redirect_uri || `${oauthService.options.baseUrl}/api/account/oauth/callback/${provider}`;
      const scopes = scope ? scope.split(' ') : null;

      const { url, state } = oauthService.getAuthorizationUrl(
        provider,
        redirectUri,
        client_id,
        scopes
      );

      // Store state in cookie
      res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 10 * 60 * 1000,
      });

      // Redirect to OAuth provider
      res.redirect(url);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/account/oauth/callback/:provider
   * Handle OAuth callback
   */
  app.get('/api/account/oauth/callback/:provider', async (req, res) => {
    try {
      const { provider } = req.params;
      const { code, state, error } = req.query;

      if (error) {
        return res.redirect(`/dashboard.html?oauth_error=${encodeURIComponent(error)}`);
      }

      if (!code || !state) {
        return res.redirect('/dashboard.html?oauth_error=missing_parameters');
      }

      // Verify state
      const stateData = await oauthService.verifyState(state);
      if (stateData.provider !== provider) {
        return res.redirect('/dashboard.html?oauth_error=invalid_state');
      }

      // Exchange code for tokens
      const redirectUri =
        stateData.redirectUri ||
        `${oauthService.options.baseUrl}/api/account/oauth/callback/${provider}`;
      const tokenData = await oauthService.exchangeCode(provider, code, redirectUri);

      // Authenticate/create account with OAuth
      const result = await accountService.authenticateWithOAuth(
        provider,
        tokenData.user_info,
        tokenData
      );

      // Start cloud sync if not in local mode
      if (result.success && !result.local_mode) {
        await cloudSyncService.start();
      }

      // Redirect to dashboard with success
      const redirectUrl = `/dashboard.html?oauth_success=true&provider=${provider}&email=${encodeURIComponent(tokenData.user_info.email)}`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error('[OAUTH] Callback error:', error);
      res.redirect(`/dashboard.html?oauth_error=${encodeURIComponent(error.message)}`);
    }
  });

  /**
   * POST /api/account/oauth/token
   * Token endpoint for OAuth clients (OAuth 2.0 token exchange)
   */
  app.post('/api/account/oauth/token', async (req, res) => {
    try {
      const { grant_type, code, client_id, client_secret, redirect_uri } = req.body;

      if (grant_type !== 'authorization_code') {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code grant type is supported',
        });
      }

      // Verify client
      const client = await oauthService.verifyClient(client_id, client_secret);
      if (!client) {
        return res.status(401).json({
          error: 'invalid_client',
          error_description: 'Invalid client credentials',
        });
      }

      // In a full implementation, you would verify the authorization code here
      // For now, return a token (simplified)
      const account = await accountService.getAccount();
      if (!account) {
        return res.status(401).json({
          error: 'invalid_grant',
          error_description: 'No authenticated account',
        });
      }

      // Generate access token for client
      const accessToken = crypto.randomBytes(32).toString('hex');
      const expiresIn = 3600; // 1 hour

      res.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
        scope: 'read_files read_analytics',
      });
    } catch (error) {
      console.error('[OAUTH] Token endpoint error:', error);
      res.status(500).json({
        error: 'server_error',
        error_description: error.message,
      });
    }
  });

  /**
   * POST /api/account/oauth/register
   * Register OAuth client (for MCP server integration)
   */
  app.post('/api/account/oauth/register', authz.requirePermission('admin'), async (req, res) => {
    try {
      const account = await accountService.getAccount();
      if (!account) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const { name, redirect_uris, scopes } = req.body;

      if (!name || !redirect_uris || !Array.isArray(redirect_uris)) {
        return res.status(400).json({
          success: false,
          error: 'name and redirect_uris are required',
        });
      }

      const client = await oauthService.registerClient(
        name,
        redirect_uris,
        scopes || ['read_files', 'read_analytics'],
        account.account_id
      );

      res.json({
        success: true,
        client: client,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/account/permissions
   * Get current user's permissions
   */
  app.get('/api/account/permissions', async (req, res) => {
    try {
      const account = await accountService.getAccount();
      if (!account) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      const permissions = await authorizationService.getAccountPermissions(account.account_id);
      const roles = await authorizationService.getAccountRoles(account.account_id);
      const accessibleTools = await authorizationService.getAccessibleTools(account.account_id);

      res.json({
        success: true,
        permissions: permissions,
        roles: roles,
        accessible_tools: accessibleTools,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/account/tools
   * Get available tools and access status
   */
  app.get('/api/account/tools', async (req, res) => {
    try {
      const account = await accountService.getAccount();
      const allTools = authorizationService.getAvailableTools();

      const toolsWithAccess = await Promise.all(
        allTools.map(async (tool) => {
          const canAccess = account
            ? await authorizationService.canAccessTool(account.account_id, tool.name)
            : false;

          return {
            ...tool,
            accessible: canAccess,
          };
        })
      );

      res.json({
        success: true,
        tools: toolsWithAccess,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  console.log('[ROUTES] Account routes initialized with OAuth and authorization');

  // Return services for use by other modules
  return {
    accountService,
    oauthService,
    authorizationService,
  };
}

module.exports = setupAccountRoutes;
