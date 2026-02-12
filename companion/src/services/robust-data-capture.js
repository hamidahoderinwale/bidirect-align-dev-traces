/**
 * Robust Data Capture Service
 * 
 * Provides persistent storage for all raw data with:
 * - Automatic persistence to database
 * - Data retention policies
 * - Incremental sync with deduplication
 * - Migration from in-memory arrays
 * - Improved error handling and recovery
 */

const RawDataSchema = require('../database/raw-data-schema');

class RobustDataCaptureService {
  constructor(persistentDB, rawData = null) {
    this.db = persistentDB;
    this.rawData = rawData; // Keep reference for migration
    this.schema = new RawDataSchema(persistentDB);
    
    // Configuration
    this.config = {
      // Retention policies (in days)
      retention: {
        systemResources: 30, // Keep 30 days of system resources
        gitData: 90, // Keep 90 days of git data
        appleScript: 7, // Keep 7 days of IDE state
        cursorDbConversations: 365, // Keep 1 year of conversations
        logs: 30, // Keep 30 days of logs
      },
      // Batch sizes for bulk operations
      batchSize: {
        insert: 100,
        cleanup: 1000,
      },
      // Migration settings
      migration: {
        enabled: true,
        batchSize: 500,
      },
    };

    // State tracking
    this.migrationComplete = {
      systemResources: false,
      gitData: false,
      appleScript: false,
      cursorDbConversations: false,
      logs: false,
    };

    this.lastCleanup = {
      systemResources: 0,
      gitData: 0,
      appleScript: 0,
      cursorDbConversations: 0,
      logs: 0,
    };

    // Cleanup interval: once per hour
    this.cleanupInterval = 60 * 60 * 1000;
  }

  /**
   * Initialize the service
   */
  async init() {
    try {
      await this.schema.createTables();
      console.log('[ROBUST-CAPTURE] Database schema initialized');

      // Run migration if enabled and rawData is available
      if (this.config.migration.enabled && this.rawData) {
        await this.migrateInMemoryData();
      }

      // Schedule periodic cleanup
      this.scheduleCleanup();

      return true;
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Initialization error:', error);
      return false;
    }
  }

  /**
   * Capture system resources with persistence
   */
  async captureSystemResources(resourceData) {
    try {
      if (!this.db.db) {
        console.warn('[ROBUST-CAPTURE] Database not initialized, skipping persistence');
        return;
      }

      const query = `
        INSERT INTO system_resources (
          timestamp, memory_rss, memory_heap_total, memory_heap_used,
          memory_external, memory_array_buffers, cpu_user, cpu_system,
          system_load_avg_1, system_load_avg_5, system_load_avg_15,
          system_cpu_cores, system_free_memory, system_total_memory,
          system_uptime, system_platform, system_arch
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        resourceData.timestamp,
        resourceData.memory?.rss || null,
        resourceData.memory?.heapTotal || null,
        resourceData.memory?.heapUsed || null,
        resourceData.memory?.external || null,
        resourceData.memory?.arrayBuffers || null,
        resourceData.cpu?.user || null,
        resourceData.cpu?.system || null,
        resourceData.system?.loadAverage?.[0] || null,
        resourceData.system?.loadAverage?.[1] || null,
        resourceData.system?.loadAverage?.[2] || null,
        resourceData.system?.cpuCores || null,
        resourceData.system?.freeMemory || null,
        resourceData.system?.totalMemory || null,
        resourceData.system?.uptime || null,
        resourceData.system?.platform || null,
        resourceData.system?.arch || null,
      ];

      return new Promise((resolve, reject) => {
        this.db.db.run(query, values, (err) => {
          if (err) {
            console.error('[ROBUST-CAPTURE] Error saving system resources:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Error in captureSystemResources:', error);
      // Don't throw - allow in-memory fallback
    }
  }

  /**
   * Capture git data with persistence
   */
  async captureGitData(gitData) {
    try {
      if (!this.db.db) return;

      const query = `
        INSERT INTO git_data (
          timestamp, workspace_path, branch, status_json, commit_hash, commit_message, files_changed
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        gitData.timestamp,
        gitData.workspace_path || null,
        gitData.branch || null,
        JSON.stringify(gitData.status || []),
        gitData.commit_hash || null,
        gitData.commit_message || null,
        gitData.files_changed || (gitData.status ? gitData.status.length : 0),
      ];

      return new Promise((resolve, reject) => {
        this.db.db.run(query, values, (err) => {
          if (err) {
            console.error('[ROBUST-CAPTURE] Error saving git data:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Error in captureGitData:', error);
    }
  }

  /**
   * Capture AppleScript/IDE state with persistence
   */
  async captureAppleScriptState(stateData) {
    try {
      if (!this.db.db) return;

      const query = `
        INSERT INTO apple_script_state (
          timestamp, workspace_path, is_active, window_count, process_name,
          app_state_json, editor_state_json, debug_state_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        stateData.timestamp,
        stateData.workspace_path || null,
        stateData.isActive ? 1 : 0,
        stateData.windowCount || null,
        stateData.processName || null,
        JSON.stringify(stateData.appState || {}),
        JSON.stringify(stateData.editorState || {}),
        JSON.stringify(stateData.debugState || {}),
      ];

      return new Promise((resolve, reject) => {
        this.db.db.run(query, values, (err) => {
          if (err) {
            console.error('[ROBUST-CAPTURE] Error saving AppleScript state:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Error in captureAppleScriptState:', error);
    }
  }

  /**
   * Capture Cursor DB conversation with persistence
   */
  async captureCursorDbConversation(conversationData) {
    try {
      if (!this.db.db) return;

      const query = `
        INSERT OR REPLACE INTO cursor_db_conversations (
          conversation_id, timestamp, workspace_path, title, conversation_data_json, message_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;

      const values = [
        conversationData.id || conversationData.conversation_id,
        conversationData.timestamp || Date.now(),
        conversationData.workspace_path || null,
        conversationData.title || null,
        JSON.stringify(conversationData),
        conversationData.message_count || conversationData.turns?.length || 0,
      ];

      return new Promise((resolve, reject) => {
        this.db.db.run(query, values, (err) => {
          if (err) {
            console.error('[ROBUST-CAPTURE] Error saving Cursor DB conversation:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Error in captureCursorDbConversation:', error);
    }
  }

  /**
   * Capture log data with persistence
   */
  async captureLogData(logData) {
    try {
      if (!this.db.db) return;

      const query = `
        INSERT INTO cursor_logs (
          timestamp, log_path, log_name, log_size, modified_time, log_type
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      const values = [
        logData.timestamp || Date.now(),
        logData.path || null,
        logData.name || null,
        logData.size || null,
        logData.modified ? new Date(logData.modified).toISOString() : null,
        logData.type || 'cursor',
      ];

      return new Promise((resolve, reject) => {
        this.db.db.run(query, values, (err) => {
          if (err) {
            console.error('[ROBUST-CAPTURE] Error saving log data:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Error in captureLogData:', error);
    }
  }

  /**
   * Migrate in-memory data to database
   */
  async migrateInMemoryData() {
    if (!this.rawData) {
      console.log('[ROBUST-CAPTURE] No in-memory data to migrate');
      return;
    }

    console.log('[ROBUST-CAPTURE] Starting migration of in-memory data to database...');

    // Migrate system resources
    if (this.rawData.systemResources && this.rawData.systemResources.length > 0) {
      await this.migrateSystemResources();
    }

    // Migrate git data
    if (this.rawData.gitData?.status && this.rawData.gitData.status.length > 0) {
      await this.migrateGitData();
    }

    // Migrate AppleScript state
    if (this.rawData.appleScript?.appState && this.rawData.appleScript.appState.length > 0) {
      await this.migrateAppleScriptState();
    }

    // Migrate Cursor DB conversations
    if (this.rawData.cursorDatabase?.conversations && this.rawData.cursorDatabase.conversations.length > 0) {
      await this.migrateCursorDbConversations();
    }

    // Migrate logs
    if (this.rawData.logs?.cursor && this.rawData.logs.cursor.length > 0) {
      await this.migrateLogs();
    }

    console.log('[ROBUST-CAPTURE] Migration complete');
  }

  async migrateSystemResources() {
    if (this.migrationComplete.systemResources) return;

    const batchSize = this.config.migration.batchSize;
    const resources = this.rawData.systemResources;
    let migrated = 0;

    for (let i = 0; i < resources.length; i += batchSize) {
      const batch = resources.slice(i, i + batchSize);
      const promises = batch.map((r) => this.captureSystemResources(r));
      await Promise.allSettled(promises);
      migrated += batch.length;
    }

    console.log(`[ROBUST-CAPTURE] Migrated ${migrated} system resource entries`);
    this.migrationComplete.systemResources = true;
  }

  async migrateGitData() {
    if (this.migrationComplete.gitData) return;

    const batchSize = this.config.migration.batchSize;
    const gitEntries = this.rawData.gitData.status;
    let migrated = 0;

    for (let i = 0; i < gitEntries.length; i += batchSize) {
      const batch = gitEntries.slice(i, i + batchSize);
      const promises = batch.map((g) => this.captureGitData(g));
      await Promise.allSettled(promises);
      migrated += batch.length;
    }

    console.log(`[ROBUST-CAPTURE] Migrated ${migrated} git data entries`);
    this.migrationComplete.gitData = true;
  }

  async migrateAppleScriptState() {
    if (this.migrationComplete.appleScript) return;

    const batchSize = this.config.migration.batchSize;
    const states = this.rawData.appleScript.appState;
    let migrated = 0;

    for (let i = 0; i < states.length; i += batchSize) {
      const batch = states.slice(i, i + batchSize);
      const promises = batch.map((s) => this.captureAppleScriptState(s));
      await Promise.allSettled(promises);
      migrated += batch.length;
    }

    console.log(`[ROBUST-CAPTURE] Migrated ${migrated} AppleScript state entries`);
    this.migrationComplete.appleScript = true;
  }

  async migrateCursorDbConversations() {
    if (this.migrationComplete.cursorDbConversations) return;

    const conversations = this.rawData.cursorDatabase.conversations;
    let migrated = 0;

    for (const conv of conversations) {
      await this.captureCursorDbConversation(conv);
      migrated++;
    }

    console.log(`[ROBUST-CAPTURE] Migrated ${migrated} Cursor DB conversations`);
    this.migrationComplete.cursorDbConversations = true;
  }

  async migrateLogs() {
    if (this.migrationComplete.logs) return;

    const logs = this.rawData.logs.cursor;
    let migrated = 0;

    for (const log of logs) {
      await this.captureLogData(log);
      migrated++;
    }

    console.log(`[ROBUST-CAPTURE] Migrated ${migrated} log entries`);
    this.migrationComplete.logs = true;
  }

  /**
   * Cleanup old data based on retention policies
   */
  async cleanupOldData() {
    const now = Date.now();
    const oneHourAgo = now - this.cleanupInterval;

    // Only run cleanup once per hour
    if (now - this.lastCleanup.systemResources < this.cleanupInterval) {
      return;
    }

    console.log('[ROBUST-CAPTURE] Starting data cleanup...');

    try {
      // Cleanup system resources
      await this.cleanupTable('system_resources', 'timestamp', this.config.retention.systemResources);
      this.lastCleanup.systemResources = now;

      // Cleanup git data
      await this.cleanupTable('git_data', 'timestamp', this.config.retention.gitData);
      this.lastCleanup.gitData = now;

      // Cleanup AppleScript state
      await this.cleanupTable('apple_script_state', 'timestamp', this.config.retention.appleScript);
      this.lastCleanup.appleScript = now;

      // Cleanup logs
      await this.cleanupTable('cursor_logs', 'timestamp', this.config.retention.logs);
      this.lastCleanup.logs = now;

      // Note: cursor_db_conversations are kept longer (365 days) and cleaned less frequently
      if (now - this.lastCleanup.cursorDbConversations > this.cleanupInterval * 24) {
        await this.cleanupTable('cursor_db_conversations', 'timestamp', this.config.retention.cursorDbConversations);
        this.lastCleanup.cursorDbConversations = now;
      }

      console.log('[ROBUST-CAPTURE] Data cleanup complete');
    } catch (error) {
      console.error('[ROBUST-CAPTURE] Error during cleanup:', error);
    }
  }

  async cleanupTable(tableName, timestampColumn, retentionDays) {
    if (!this.db.db) return;

    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `DELETE FROM ${tableName} WHERE ${timestampColumn} < ?`,
        [cutoffTime],
        function (err) {
          if (err) {
            console.error(`[ROBUST-CAPTURE] Error cleaning up ${tableName}:`, err);
            reject(err);
          } else {
            if (this.changes > 0) {
              console.log(`[ROBUST-CAPTURE] Cleaned up ${this.changes} old entries from ${tableName}`);
            }
            resolve(this.changes);
          }
        }
      );
    });
  }

  /**
   * Schedule periodic cleanup
   */
  scheduleCleanup() {
    // Run cleanup every hour
    setInterval(() => {
      this.cleanupOldData().catch((err) => {
        console.error('[ROBUST-CAPTURE] Scheduled cleanup error:', err);
      });
    }, this.cleanupInterval);

    // Run initial cleanup after 5 minutes
    setTimeout(() => {
      this.cleanupOldData().catch((err) => {
        console.error('[ROBUST-CAPTURE] Initial cleanup error:', err);
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Get data from database with pagination
   */
  async getSystemResources(limit = 1000, since = null) {
    if (!this.db.db) return [];

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM system_resources`;
      const params = [];

      if (since) {
        query += ` WHERE timestamp >= ?`;
        params.push(since);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          // Convert rows back to original format
          const formatted = rows.map((row) => ({
            timestamp: row.timestamp,
            memory: {
              rss: row.memory_rss,
              heapTotal: row.memory_heap_total,
              heapUsed: row.memory_heap_used,
              external: row.memory_external,
              arrayBuffers: row.memory_array_buffers,
            },
            cpu: {
              user: row.cpu_user,
              system: row.cpu_system,
            },
            system: {
              loadAverage: [row.system_load_avg_1, row.system_load_avg_5, row.system_load_avg_15],
              cpuCores: row.system_cpu_cores,
              freeMemory: row.system_free_memory,
              totalMemory: row.system_total_memory,
              uptime: row.system_uptime,
              platform: row.system_platform,
              arch: row.system_arch,
            },
          }));
          resolve(formatted);
        }
      });
    });
  }

  async getGitData(limit = 50, since = null) {
    if (!this.db.db) return [];

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM git_data`;
      const params = [];

      if (since) {
        query += ` WHERE timestamp >= ?`;
        params.push(since);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const formatted = rows.map((row) => ({
            timestamp: row.timestamp,
            workspace_path: row.workspace_path,
            branch: row.branch,
            status: JSON.parse(row.status_json || '[]'),
            commit_hash: row.commit_hash,
            commit_message: row.commit_message,
            files_changed: row.files_changed,
          }));
          resolve(formatted);
        }
      });
    });
  }

  async getAppleScriptState(limit = 1000, since = null) {
    if (!this.db.db) return [];

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM apple_script_state`;
      const params = [];

      if (since) {
        query += ` WHERE timestamp >= ?`;
        params.push(since);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const formatted = rows.map((row) => ({
            timestamp: row.timestamp,
            workspace_path: row.workspace_path,
            isActive: row.is_active === 1,
            windowCount: row.window_count,
            processName: row.process_name,
            appState: JSON.parse(row.app_state_json || '{}'),
            editorState: JSON.parse(row.editor_state_json || '{}'),
            debugState: JSON.parse(row.debug_state_json || '{}'),
          }));
          resolve(formatted);
        }
      });
    });
  }

  async getCursorDbConversations(limit = 20, since = null) {
    if (!this.db.db) return [];

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM cursor_db_conversations`;
      const params = [];

      if (since) {
        query += ` WHERE timestamp >= ?`;
        params.push(since);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const formatted = rows.map((row) => ({
            id: row.conversation_id,
            timestamp: row.timestamp,
            workspace_path: row.workspace_path,
            title: row.title,
            ...JSON.parse(row.conversation_data_json || '{}'),
            message_count: row.message_count,
          }));
          resolve(formatted);
        }
      });
    });
  }

  async getLogs(limit = 50, since = null) {
    if (!this.db.db) return [];

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM cursor_logs`;
      const params = [];

      if (since) {
        query += ` WHERE timestamp >= ?`;
        params.push(since);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const formatted = rows.map((row) => ({
            timestamp: row.timestamp,
            path: row.log_path,
            name: row.log_name,
            size: row.log_size,
            modified: row.modified_time,
            type: row.log_type,
          }));
          resolve(formatted);
        }
      });
    });
  }
}

module.exports = RobustDataCaptureService;

