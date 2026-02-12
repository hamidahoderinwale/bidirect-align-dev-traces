/**
 * Cloud Sync Service
 * Handles syncing local data to/from cloud account service
 */

const crypto = require('crypto');

class CloudSyncService {
  constructor(accountService, persistentDB, options = {}) {
    this.accountService = accountService;
    this.db = persistentDB;
    this.options = {
      syncInterval: 5 * 60 * 1000, // 5 minutes
      batchSize: 1000,
      encryptionEnabled: true,
      ...options,
    };

    this.syncInProgress = false;
    this.syncInterval = null;
    this.lastSyncTime = null;
  }

  /**
   * Start automatic syncing
   */
  async start() {
    if (this.syncInterval) {
      return; // Already started
    }

    // Check if sync is enabled
    const account = await this.accountService.getAccount();
    if (!account || !account.sync_enabled) {
      console.log('[CLOUD-SYNC] Sync disabled - account not configured or sync disabled');
      return;
    }

    console.log('[CLOUD-SYNC] Starting automatic sync...');

    // Initial sync
    await this.syncToCloud();

    // Set up periodic sync
    this.syncInterval = setInterval(() => {
      this.syncToCloud().catch((error) => {
        console.error('[CLOUD-SYNC] Periodic sync error:', error.message);
      });
    }, this.options.syncInterval);
  }

  /**
   * Stop automatic syncing
   */
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[CLOUD-SYNC] Automatic sync stopped');
    }
  }

  /**
   * Sync local data to cloud
   */
  async syncToCloud() {
    if (this.syncInProgress) {
      console.log('[CLOUD-SYNC] Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;

    try {
      const account = await this.accountService.getAccount();
      if (!account || !account.sync_enabled) {
        return { success: false, reason: 'Sync not enabled' };
      }

      const accessToken = await this.accountService.getAccessToken();
      if (!accessToken) {
        throw new Error('No access token available');
      }

      // Get last sync timestamp
      const lastSync = await this.accountService.getSyncState('last_sync_timestamp');
      const since = lastSync || 0;

      // Export data since last sync
      const data = await this.exportDataSince(since);

      if (!data || (data.events?.length === 0 && data.prompts?.length === 0)) {
        console.log('[CLOUD-SYNC] No new data to sync');
        this.lastSyncTime = Date.now();
        return { success: true, synced: 0 };
      }

      // Encrypt data if enabled
      const payload = this.options.encryptionEnabled
        ? await this.encryptData(data, account.account_id)
        : data;

      // Upload to cloud
      const accountServiceUrl = this.accountService.options.accountServiceUrl;
      const response = await fetch(`${accountServiceUrl}/api/sync/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          account_id: account.account_id,
          device_id: this.accountService.deviceId,
          data: payload,
          encrypted: this.options.encryptionEnabled,
          timestamp: Date.now(),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }

      const result = await response.json();

      // Update last sync timestamp
      await this.accountService.updateSyncState('last_sync_timestamp', Date.now());
      this.lastSyncTime = Date.now();

      const syncedCount = (data.events?.length || 0) + (data.prompts?.length || 0);
      console.log(`[CLOUD-SYNC] Successfully synced ${syncedCount} items to cloud`);

      return {
        success: true,
        synced: syncedCount,
        timestamp: this.lastSyncTime,
      };
    } catch (error) {
      console.error('[CLOUD-SYNC] Sync error:', error.message);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sync data from cloud to local
   */
  async syncFromCloud() {
    try {
      const account = await this.accountService.getAccount();
      if (!account) {
        throw new Error('No account found');
      }

      const accessToken = await this.accountService.getAccessToken();
      if (!accessToken) {
        throw new Error('No access token available');
      }

      // Get last sync timestamp
      const lastSync = await this.accountService.getSyncState('last_sync_timestamp');

      // Download from cloud
      const accountServiceUrl = this.accountService.options.accountServiceUrl;
      const url = `${accountServiceUrl}/api/sync/download?since=${lastSync || 0}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, synced: 0 }; // No data to sync
        }
        const error = await response.json();
        throw new Error(error.message || 'Download failed');
      }

      const result = await response.json();

      if (!result.data || result.data.length === 0) {
        return { success: true, synced: 0 };
      }

      // Decrypt if needed
      const data = result.encrypted
        ? await this.decryptData(result.data, account.account_id)
        : result.data;

      // Import data to local database
      const synced = await this.importData(data);

      console.log(`[CLOUD-SYNC] Successfully synced ${synced} items from cloud`);

      return {
        success: true,
        synced: synced,
      };
    } catch (error) {
      console.error('[CLOUD-SYNC] Download sync error:', error.message);
      throw error;
    }
  }

  /**
   * Export data since timestamp
   */
  async exportDataSince(since) {
    try {
      // Get events since timestamp
      const events = await this.db.all(
        `SELECT * FROM events WHERE timestamp > ? ORDER BY timestamp LIMIT ?`,
        [since, this.options.batchSize]
      );

      // Get prompts since timestamp
      const prompts = await this.db.all(
        `SELECT * FROM prompts WHERE timestamp > ? ORDER BY timestamp LIMIT ?`,
        [since, this.options.batchSize]
      );

      return {
        events: events || [],
        prompts: prompts || [],
        timestamp: Date.now(),
      };
    } catch (error) {
      console.error('[CLOUD-SYNC] Export error:', error.message);
      throw error;
    }
  }

  /**
   * Import data to local database
   */
  async importData(data) {
    let imported = 0;

    try {
      // Import events
      if (data.events && data.events.length > 0) {
        for (const event of data.events) {
          try {
            await this.db.run(
              `INSERT OR IGNORE INTO events (id, timestamp, type, data, workspace_id)
               VALUES (?, ?, ?, ?, ?)`,
              [
                event.id,
                event.timestamp,
                event.type,
                JSON.stringify(event.data),
                event.workspace_id,
              ]
            );
            imported++;
          } catch (error) {
            // Ignore duplicate errors
          }
        }
      }

      // Import prompts
      if (data.prompts && data.prompts.length > 0) {
        for (const prompt of data.prompts) {
          try {
            await this.db.run(
              `INSERT OR IGNORE INTO prompts (id, timestamp, text, response, workspace_id)
               VALUES (?, ?, ?, ?, ?)`,
              [prompt.id, prompt.timestamp, prompt.text, prompt.response, prompt.workspace_id]
            );
            imported++;
          } catch (error) {
            // Ignore duplicate errors
          }
        }
      }

      return imported;
    } catch (error) {
      console.error('[CLOUD-SYNC] Import error:', error.message);
      throw error;
    }
  }

  /**
   * Encrypt data using account ID as key derivation
   */
  async encryptData(data, accountId) {
    if (!this.options.encryptionEnabled) {
      return data;
    }

    try {
      // Derive encryption key from account ID
      const key = crypto
        .createHash('sha256')
        .update(accountId + process.env.ENCRYPTION_SALT || 'default-salt')
        .digest();

      const algorithm = 'aes-256-gcm';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, key, iv);

      const dataString = JSON.stringify(data);
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag();

      return {
        encrypted: true,
        algorithm: algorithm,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        data: encrypted,
      };
    } catch (error) {
      console.error('[CLOUD-SYNC] Encryption error:', error.message);
      throw error;
    }
  }

  /**
   * Decrypt data
   */
  async decryptData(encryptedData, accountId) {
    if (!encryptedData.encrypted) {
      return encryptedData;
    }

    try {
      // Derive decryption key from account ID
      const key = crypto
        .createHash('sha256')
        .update(accountId + process.env.ENCRYPTION_SALT || 'default-salt')
        .digest();

      const algorithm = encryptedData.algorithm || 'aes-256-gcm';
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (error) {
      console.error('[CLOUD-SYNC] Decryption error:', error.message);
      throw error;
    }
  }

  /**
   * Get sync status
   */
  async getSyncStatus() {
    const account = await this.accountService.getAccount();
    const lastSync = await this.accountService.getSyncState('last_sync_timestamp');

    return {
      enabled: account?.sync_enabled || false,
      authenticated: account !== null,
      last_sync: lastSync,
      sync_in_progress: this.syncInProgress,
      account_email: account?.email || null,
    };
  }
}

module.exports = CloudSyncService;
