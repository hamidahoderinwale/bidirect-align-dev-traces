/**
 * Workspace Sharing Service
 * Handles generation of shareable links and workspace data sharing
 * Supports both account-based and anonymous sharing
 */

const crypto = require('crypto');

class SharingService {
  constructor(persistentDB, accountService = null) {
    this.persistentDB = persistentDB;
    this.accountService = accountService;
    // In-memory store for shareable links (in production, use Redis or database)
    this.shareLinks = new Map();
    // Link expiration: 7 days
    this.linkExpirationMs = 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Generate unique share ID
   */
  generateShareId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Create a shareable link for workspace data
   * @param {Object} options - Sharing options
   * @param {string[]} options.workspaces - Workspace paths to share
   * @param {string} options.rung - Privacy rung (clio, module_graph, functions, semantic_edits, tokens)
   * @param {number} options.abstractionLevel - Privacy level (0-3) - legacy, use rung instead
   * @param {Object} options.filters - Export filters (date range, types, etc.)
   * @param {number} options.expirationDays - Link expiration in days (default: 7)
   * @param {string} options.account_id - Account ID (optional, for account-based sharing)
   * @param {string} options.device_id - Device ID (optional, for account-based sharing)
   * @param {string} options.name - Custom name for the share link
   * @returns {Object} Share link info
   */
  async createShareLink(options) {
    const {
      workspaces = [],
      rung = 'clio',
      abstractionLevel = null, // Legacy support
      filters = {},
      expirationDays = 7,
      name = null,
      account_id = null,
      device_id = null,
    } = options;

    // Map abstractionLevel to rung if rung not provided (backward compatibility)
    let finalRung = rung;
    if (!rung && abstractionLevel !== null) {
      const rungMap = { 0: 'tokens', 1: 'functions', 2: 'module_graph', 3: 'clio' };
      finalRung = rungMap[abstractionLevel] || 'clio';
    }

    // If account service is available, try to get account info
    let finalAccountId = account_id;
    let finalDeviceId = device_id;

    if (this.accountService && !finalAccountId) {
      try {
        const account = await this.accountService.getAccount();
        if (account && account.account_id) {
          finalAccountId = account.account_id;
          finalDeviceId = this.accountService.deviceId || device_id;
        }
      } catch (error) {
        // Account not available, continue with anonymous sharing
      }
    }

    const shareId = this.generateShareId();
    const expiresAt =
      expirationDays === 0 ? null : Date.now() + expirationDays * 24 * 60 * 60 * 1000;

    const shareData = {
      id: shareId,
      shareId, // Alias for compatibility
      account_id: finalAccountId,
      device_id: finalDeviceId,
      workspaces,
      rung: finalRung,
      abstractionLevel: abstractionLevel !== null ? abstractionLevel : null, // Keep for backward compat
      filters,
      name,
      createdAt: Date.now(),
      expiresAt,
      accessCount: 0,
      lastAccessed: null,
    };

    // Store share link
    this.shareLinks.set(shareId, shareData);

    // Also persist to database for durability
    try {
      await this.persistentDB.saveShareLink(shareData);
    } catch (err) {
      console.warn('[SHARING] Could not persist share link:', err.message);
    }

    return {
      success: true,
      shareId,
      shareUrl: `/api/share/${shareId}`,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      qrCode: null, // Could generate QR code here
    };
  }

  /**
   * Get share link data
   * @param {string} shareId - Share link ID
   * @returns {Object|null} Share link data or null if not found/expired
   */
  async getShareLink(shareId) {
    // Check in-memory cache first
    let shareData = this.shareLinks.get(shareId);

    // If not in cache, try database
    if (!shareData) {
      try {
        shareData = await this.persistentDB.getShareLink(shareId);
        if (shareData) {
          this.shareLinks.set(shareId, shareData);
        }
      } catch (err) {
        console.warn('[SHARING] Could not load share link from DB:', err.message);
      }
    }

    if (!shareData) {
      return null;
    }

    // Check expiration (only if expiresAt is set)
    if (shareData.expiresAt && Date.now() > shareData.expiresAt) {
      this.shareLinks.delete(shareId);
      try {
        await this.persistentDB.deleteShareLink(shareId);
      } catch (err) {
        // Ignore
      }
      return null;
    }

    // Update access stats
    shareData.accessCount++;
    shareData.lastAccessed = Date.now();
    this.shareLinks.set(shareId, shareData);

    try {
      await this.persistentDB.updateShareLink(shareId, {
        accessCount: shareData.accessCount,
        lastAccessed: shareData.lastAccessed,
      });
    } catch (err) {
      // Ignore
    }

    return shareData;
  }

  /**
   * Delete a share link
   * @param {string} shareId - Share link ID
   * @param {string} accountId - Optional account ID for authorization check
   */
  async deleteShareLink(shareId, accountId = null) {
    // If account ID provided, verify ownership
    if (accountId) {
      const shareData = await this.getShareLink(shareId);
      if (shareData && shareData.account_id && shareData.account_id !== accountId) {
        throw new Error('Unauthorized: You can only delete your own share links');
      }
    }

    this.shareLinks.delete(shareId);
    try {
      await this.persistentDB.deleteShareLink(shareId);
    } catch (err) {
      console.warn('[SHARING] Could not delete share link from DB:', err.message);
      throw err;
    }
  }

  /**
   * List all share links (for management)
   * @param {string} accountId - Optional account ID to filter by
   * @returns {Array} List of share links
   */
  async listShareLinks(accountId = null) {
    try {
      const links = await this.persistentDB.getAllShareLinks(accountId);
      return links.filter((link) => !link.expiresAt || Date.now() < link.expiresAt);
    } catch (err) {
      // Fallback to in-memory
      const allLinks = Array.from(this.shareLinks.values());
      let filtered = allLinks.filter((link) => !link.expiresAt || Date.now() < link.expiresAt);

      // Filter by account if specified
      if (accountId) {
        filtered = filtered.filter((link) => link.account_id === accountId);
      }

      return filtered;
    }
  }

  /**
   * Clean up expired links
   */
  async cleanupExpiredLinks() {
    const now = Date.now();
    const expired = [];

    for (const [shareId, shareData] of this.shareLinks.entries()) {
      if (now > shareData.expiresAt) {
        expired.push(shareId);
      }
    }

    for (const shareId of expired) {
      this.shareLinks.delete(shareId);
      try {
        await this.persistentDB.deleteShareLink(shareId);
      } catch (err) {
        // Ignore
      }
    }

    if (expired.length > 0) {
      console.log(`[SHARING] Cleaned up ${expired.length} expired share links`);
    }
  }
}

module.exports = SharingService;
