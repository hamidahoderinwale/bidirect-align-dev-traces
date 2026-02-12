/**
 * Remote Sync Service
 * Syncs local telemetry data to research server with privacy filtering
 */

const PrivacyFilter = require('./privacy-filter');

class RemoteSyncService {
  constructor(persistentDB, config) {
    this.persistentDB = persistentDB;
    this.config = config;
    this.serverUrl = config.serverUrl || process.env.RESEARCH_SERVER_URL;
    this.participantId = config.participantId || process.env.RESEARCH_PARTICIPANT_ID;
    this.consentRung = config.consentRung || parseInt(process.env.RESEARCH_RUNG) || 5;
    this.syncInterval = config.syncInterval || parseInt(process.env.RESEARCH_SYNC_INTERVAL) || 300000; // 5 minutes
    this.enabled = config.enabled !== false && this.serverUrl && this.participantId;
    
    this.privacyFilter = new PrivacyFilter(this.consentRung);
    this.syncTimer = null;
    this.syncInProgress = false;
    this.lastSyncTime = null;
    this.syncStats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      totalRecordsSynced: 0,
      lastError: null,
    };
  }

  /**
   * Start periodic sync
   */
  start() {
    if (!this.enabled) {
      console.log('[RESEARCH] Remote sync disabled - not starting');
      return;
    }

    console.log(`[RESEARCH] Starting remote sync service`);
    console.log(`[RESEARCH] Server: ${this.serverUrl}`);
    console.log(`[RESEARCH] Participant ID: ${this.participantId ? this.participantId.substring(0, 8) + '...' : 'none'}`);
    console.log(`[RESEARCH] Consent Rung: ${this.consentRung} (${this.privacyFilter.rungName})`);
    console.log(`[RESEARCH] Sync Interval: ${this.syncInterval / 1000}s`);

    // Initial sync if configured
    if (this.config.syncOnStartup !== false) {
      setTimeout(() => this.sync(), 5000); // Wait 5 seconds for DB to be ready
    }

    // Set up periodic sync
    this.syncTimer = setInterval(() => {
      this.sync();
    }, this.syncInterval);
  }

  /**
   * Stop periodic sync
   */
  stop() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
      console.log('[RESEARCH] Remote sync service stopped');
    }
  }

  /**
   * Get unsync'd entries
   */
  async getUnsyncedEntries(limit = 100) {
    if (!this.persistentDB) return [];
    
    return new Promise((resolve, reject) => {
      this.persistentDB.db.all(
        `SELECT * FROM entries WHERE synced_at IS NULL ORDER BY timestamp ASC LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get unsync'd prompts
   */
  async getUnsyncedPrompts(limit = 100) {
    if (!this.persistentDB) return [];
    
    return new Promise((resolve, reject) => {
      this.persistentDB.db.all(
        `SELECT * FROM prompts WHERE synced_at IS NULL ORDER BY timestamp ASC LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get unsync'd events
   */
  async getUnsyncedEvents(limit = 100) {
    if (!this.persistentDB) return [];
    
    return new Promise((resolve, reject) => {
      this.persistentDB.db.all(
        `SELECT * FROM events WHERE synced_at IS NULL ORDER BY timestamp ASC LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Mark entries as synced
   */
  async markEntriesSynced(entryIds) {
    if (!this.persistentDB || !entryIds || entryIds.length === 0) return;
    
    const now = new Date().toISOString();
    const placeholders = entryIds.map(() => '?').join(',');
    
    return new Promise((resolve, reject) => {
      this.persistentDB.db.run(
        `UPDATE entries SET synced_at = ? WHERE id IN (${placeholders})`,
        [now, ...entryIds],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Mark prompts as synced
   */
  async markPromptsSynced(promptIds) {
    if (!this.persistentDB || !promptIds || !promptIds.length === 0) return;
    
    const now = new Date().toISOString();
    const placeholders = promptIds.map(() => '?').join(',');
    
    return new Promise((resolve, reject) => {
      this.persistentDB.db.run(
        `UPDATE prompts SET synced_at = ? WHERE id IN (${placeholders})`,
        [now, ...promptIds],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Mark events as synced
   */
  async markEventsSynced(eventIds) {
    if (!this.persistentDB || !eventIds || eventIds.length === 0) return;
    
    const now = new Date().toISOString();
    const placeholders = eventIds.map(() => '?').join(',');
    
    return new Promise((resolve, reject) => {
      this.persistentDB.db.run(
        `UPDATE events SET synced_at = ? WHERE id IN (${placeholders})`,
        [now, ...eventIds],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Upload data to research server
   */
  async uploadToServer(data) {
    if (!this.serverUrl || !this.participantId) {
      throw new Error('Research server URL or participant ID not configured');
    }

    const response = await fetch(`${this.serverUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Participant-ID': this.participantId,
      },
      body: JSON.stringify({
        data: data,
        rung: this.consentRung,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Research server error: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Perform sync operation
   */
  async sync() {
    if (!this.enabled) {
      return;
    }

    if (this.syncInProgress) {
      console.log('[RESEARCH] Sync already in progress, skipping...');
      return;
    }

    this.syncInProgress = true;
    this.syncStats.totalSyncs++;

    try {
      console.log('[RESEARCH] Starting sync...');

      // Get unsync'd data
      const entries = await this.getUnsyncedEntries(50);
      const prompts = await this.getUnsyncedPrompts(50);
      const events = await this.getUnsyncedEvents(50);

      const totalRecords = entries.length + prompts.length + events.length;

      if (totalRecords === 0) {
        console.log('[RESEARCH] No unsync'd data found');
        this.syncInProgress = false;
        return;
      }

      console.log(`[RESEARCH] Found ${entries.length} entries, ${prompts.length} prompts, ${events.length} events to sync`);

      // Filter data for privacy
      const filteredEntries = this.privacyFilter.filterBatch(entries, 'entry');
      const filteredPrompts = this.privacyFilter.filterBatch(prompts, 'prompt');
      const filteredEvents = this.privacyFilter.filterBatch(events, 'event');

      // Upload to server
      const uploadData = {
        entries: filteredEntries,
        prompts: filteredPrompts,
        events: filteredEvents,
      };

      const result = await this.uploadToServer(uploadData);

      // Mark as synced
      if (entries.length > 0) {
        await this.markEntriesSynced(entries.map(e => e.id));
      }
      if (prompts.length > 0) {
        await this.markPromptsSynced(prompts.map(p => p.id));
      }
      if (events.length > 0) {
        await this.markEventsSynced(events.map(e => e.id));
      }

      this.syncStats.successfulSyncs++;
      this.syncStats.totalRecordsSynced += totalRecords;
      this.lastSyncTime = new Date().toISOString();

      console.log(`[RESEARCH] Sync successful: ${totalRecords} records synced`);
      console.log(`[RESEARCH] Server response:`, result);

    } catch (error) {
      this.syncStats.failedSyncs++;
      this.syncStats.lastError = error.message;
      console.error('[RESEARCH] Sync failed:', error.message);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Get sync statistics
   */
  getStats() {
    return {
      ...this.syncStats,
      enabled: this.enabled,
      lastSyncTime: this.lastSyncTime,
      serverUrl: this.serverUrl,
      participantId: this.participantId ? this.participantId.substring(0, 8) + '...' : null,
      consentRung: this.consentRung,
    };
  }
}

module.exports = RemoteSyncService;

