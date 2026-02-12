/**
 * Authorization Middleware
 * Middleware for checking user permissions before accessing tools/endpoints
 */

function createAuthorizationMiddleware(authorizationService) {
  /**
   * Middleware to check if user has permission
   */
  function requirePermission(permission) {
    return async (req, res, next) => {
      try {
        // Get account from request (set by auth middleware)
        const accountId = req.account?.account_id;

        if (!accountId) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
        }

        const hasPermission = await authorizationService.hasPermission(accountId, permission);

        if (!hasPermission) {
          return res.status(403).json({
            success: false,
            error: `Permission denied: ${permission} required`,
          });
        }

        next();
      } catch (error) {
        console.error('[AUTHZ] Authorization check error:', error);
        res.status(500).json({
          success: false,
          error: 'Authorization check failed',
        });
      }
    };
  }

  /**
   * Middleware to check if user can access specific tool
   */
  function requireToolAccess(toolName) {
    return async (req, res, next) => {
      try {
        const accountId = req.account?.account_id;

        if (!accountId) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required',
          });
        }

        const canAccess = await authorizationService.canAccessTool(accountId, toolName);

        if (!canAccess) {
          return res.status(403).json({
            success: false,
            error: `Access denied: Tool '${toolName}' requires authorization`,
          });
        }

        next();
      } catch (error) {
        console.error('[AUTHZ] Tool access check error:', error);
        res.status(500).json({
          success: false,
          error: 'Tool access check failed',
        });
      }
    };
  }

  /**
   * Middleware to extract account from token
   */
  async function extractAccount(req, res, next) {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Try to get account from session/cookie if available
        // For now, skip if no auth header
        return next();
      }

      const token = authHeader.substring(7);

      // Get account by token (simplified - in production use JWT or proper token validation)
      const accountService = req.app.locals.accountService;
      if (accountService) {
        const account = await accountService.getAccount();
        if (account && account.access_token === token) {
          req.account = account;
        }
      }

      next();
    } catch (error) {
      console.error('[AUTHZ] Account extraction error:', error);
      next();
    }
  }

  return {
    requirePermission,
    requireToolAccess,
    extractAccount,
  };
}

module.exports = createAuthorizationMiddleware;
