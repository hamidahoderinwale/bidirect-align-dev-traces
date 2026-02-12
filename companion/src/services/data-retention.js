/**
 * Data Retention Service
 * Manages automatic cleanup of old data based on configurable retention policies
 */

class DataRetentionService {
  constructor(persistentDB) {
    this.db = persistentDB;
    this.isRunning = false;
    this.cleanupInterval = null;
    this.initialized = false;

    // Default retention policies (in days)
    this.defaultPolicies = {
      entries: { enabled: true, days: 90, deleteOrArchive: 'delete' },
      prompts: { enabled: true, days: 90, deleteOrArchive: 'delete' },
      events: { enabled: true, days: 60, deleteOrArchive: 'delete' },
      terminal_commands: { enabled: true, days: 30, deleteOrArchive: 'delete' },
      screenshots: { enabled: true, days: 14, deleteOrArchive: 'delete' },
      historical_commits: { enabled: false, days: 365, deleteOrArchive: 'archive' },
      historical_diffs: { enabled: true, days: 180, deleteOrArchive: 'delete' },
    };
  }

  /**
   * Initialize retention policy tables
   */
  async init() {
    if (this.initialized) return;

    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        await this.db.postgresAdapter.query(`
          CREATE TABLE IF NOT EXISTS retention_policies (
            id SERIAL PRIMARY KEY,
            table_name TEXT UNIQUE NOT NULL,
            enabled BOOLEAN DEFAULT true,
            retention_days INTEGER NOT NULL DEFAULT 90,
            delete_or_archive TEXT DEFAULT 'delete',
            last_cleanup TIMESTAMP,
            items_deleted INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await this.db.postgresAdapter.query(`
          CREATE TABLE IF NOT EXISTS retention_logs (
            id SERIAL PRIMARY KEY,
            table_name TEXT NOT NULL,
            items_deleted INTEGER DEFAULT 0,
            items_archived INTEGER DEFAULT 0,
            bytes_freed BIGINT DEFAULT 0,
            cleanup_duration_ms INTEGER,
            status TEXT DEFAULT 'success',
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Create archived_data table for archive mode
        await this.db.postgresAdapter.query(`
          CREATE TABLE IF NOT EXISTS archived_data (
            id SERIAL PRIMARY KEY,
            source_table TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            data_json TEXT NOT NULL,
            archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } else {
        // SQLite
        await this._runSqlite(`
          CREATE TABLE IF NOT EXISTS retention_policies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT UNIQUE NOT NULL,
            enabled INTEGER DEFAULT 1,
            retention_days INTEGER NOT NULL DEFAULT 90,
            delete_or_archive TEXT DEFAULT 'delete',
            last_cleanup TEXT,
            items_deleted INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await this._runSqlite(`
          CREATE TABLE IF NOT EXISTS retention_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            table_name TEXT NOT NULL,
            items_deleted INTEGER DEFAULT 0,
            items_archived INTEGER DEFAULT 0,
            bytes_freed INTEGER DEFAULT 0,
            cleanup_duration_ms INTEGER,
            status TEXT DEFAULT 'success',
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await this._runSqlite(`
          CREATE TABLE IF NOT EXISTS archived_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_table TEXT NOT NULL,
            source_id INTEGER NOT NULL,
            data_json TEXT NOT NULL,
            archived_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Create index for faster lookups
        await this._runSqlite(`
          CREATE INDEX IF NOT EXISTS idx_retention_logs_table ON retention_logs(table_name)
        `);
        await this._runSqlite(`
          CREATE INDEX IF NOT EXISTS idx_retention_logs_created ON retention_logs(created_at)
        `);
      }

      // Initialize default policies
      await this._initDefaultPolicies();

      this.initialized = true;
      console.log('[RETENTION] Data retention service initialized');
    } catch (error) {
      console.error('[RETENTION] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Helper to run SQLite commands
   */
  _runSqlite(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  /**
   * Helper to get SQLite rows
   */
  _getSqlite(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  /**
   * Helper to get all SQLite rows
   */
  _allSqlite(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Initialize default retention policies
   */
  async _initDefaultPolicies() {
    const dbType = this.db.dbType || 'sqlite';

    for (const [tableName, policy] of Object.entries(this.defaultPolicies)) {
      try {
        if (dbType === 'postgres') {
          await this.db.postgresAdapter.query(
            `
            INSERT INTO retention_policies (table_name, enabled, retention_days, delete_or_archive)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (table_name) DO NOTHING
          `,
            [tableName, policy.enabled, policy.days, policy.deleteOrArchive]
          );
        } else {
          await this._runSqlite(
            `
            INSERT OR IGNORE INTO retention_policies (table_name, enabled, retention_days, delete_or_archive)
            VALUES (?, ?, ?, ?)
          `,
            [tableName, policy.enabled ? 1 : 0, policy.days, policy.deleteOrArchive]
          );
        }
      } catch (error) {
        console.warn(`[RETENTION] Could not set default policy for ${tableName}:`, error.message);
      }
    }
  }

  /**
   * Get all retention policies
   */
  async getPolicies() {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      const result = await this.db.postgresAdapter.query(
        'SELECT * FROM retention_policies ORDER BY table_name'
      );
      return result.rows;
    } else {
      return await this._allSqlite('SELECT * FROM retention_policies ORDER BY table_name');
    }
  }

  /**
   * Update a retention policy
   */
  async updatePolicy(tableName, { enabled, retentionDays, deleteOrArchive }) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      await this.db.postgresAdapter.query(
        `
        UPDATE retention_policies 
        SET enabled = COALESCE($2, enabled),
            retention_days = COALESCE($3, retention_days),
            delete_or_archive = COALESCE($4, delete_or_archive),
            updated_at = CURRENT_TIMESTAMP
        WHERE table_name = $1
      `,
        [tableName, enabled, retentionDays, deleteOrArchive]
      );
    } else {
      const updates = [];
      const params = [];

      if (enabled !== undefined) {
        updates.push('enabled = ?');
        params.push(enabled ? 1 : 0);
      }
      if (retentionDays !== undefined) {
        updates.push('retention_days = ?');
        params.push(retentionDays);
      }
      if (deleteOrArchive !== undefined) {
        updates.push('delete_or_archive = ?');
        params.push(deleteOrArchive);
      }

      if (updates.length > 0) {
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(tableName);
        await this._runSqlite(
          `
          UPDATE retention_policies SET ${updates.join(', ')} WHERE table_name = ?
        `,
          params
        );
      }
    }

    console.log(`[RETENTION] Updated policy for ${tableName}`);
    return await this.getPolicy(tableName);
  }

  /**
   * Get a single policy
   */
  async getPolicy(tableName) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      const result = await this.db.postgresAdapter.query(
        'SELECT * FROM retention_policies WHERE table_name = $1',
        [tableName]
      );
      return result.rows[0];
    } else {
      return await this._getSqlite('SELECT * FROM retention_policies WHERE table_name = ?', [
        tableName,
      ]);
    }
  }

  /**
   * Run cleanup for a specific table
   */
  async cleanupTable(tableName, dryRun = false) {
    await this.init();
    const startTime = Date.now();
    const dbType = this.db.dbType || 'sqlite';

    const policy = await this.getPolicy(tableName);
    if (!policy || !policy.enabled) {
      return { tableName, skipped: true, reason: 'Policy disabled or not found' };
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);
    const cutoffISO = cutoffDate.toISOString();

    let itemsDeleted = 0;
    let itemsArchived = 0;
    let status = 'success';
    let errorMessage = null;

    try {
      // Get count of items to be deleted
      let countQuery, deleteQuery;

      // Different tables have different timestamp column names
      const timestampColumn = this._getTimestampColumn(tableName);

      if (dbType === 'postgres') {
        const countResult = await this.db.postgresAdapter.query(
          `
          SELECT COUNT(*) as count FROM ${tableName} WHERE ${timestampColumn} < $1
        `,
          [cutoffISO]
        );
        const toDelete = parseInt(countResult.rows[0].count);

        if (!dryRun && toDelete > 0) {
          if (policy.delete_or_archive === 'archive') {
            // Archive before deleting
            const archiveResult = await this.db.postgresAdapter.query(
              `
              INSERT INTO archived_data (source_table, source_id, data_json)
              SELECT '${tableName}', id, row_to_json(t)::text
              FROM ${tableName} t
              WHERE ${timestampColumn} < $1
            `,
              [cutoffISO]
            );
            itemsArchived = archiveResult.rowCount;
          }

          const deleteResult = await this.db.postgresAdapter.query(
            `
            DELETE FROM ${tableName} WHERE ${timestampColumn} < $1
          `,
            [cutoffISO]
          );
          itemsDeleted = deleteResult.rowCount;
        } else {
          itemsDeleted = toDelete;
        }
      } else {
        const countResult = await this._getSqlite(
          `
          SELECT COUNT(*) as count FROM ${tableName} WHERE ${timestampColumn} < ?
        `,
          [cutoffISO]
        );
        const toDelete = countResult?.count || 0;

        if (!dryRun && toDelete > 0) {
          if (policy.delete_or_archive === 'archive') {
            // Archive before deleting (SQLite doesn't have row_to_json, so we do it manually)
            const rowsToArchive = await this._allSqlite(
              `
              SELECT * FROM ${tableName} WHERE ${timestampColumn} < ?
            `,
              [cutoffISO]
            );

            for (const row of rowsToArchive) {
              await this._runSqlite(
                `
                INSERT INTO archived_data (source_table, source_id, data_json)
                VALUES (?, ?, ?)
              `,
                [tableName, row.id, JSON.stringify(row)]
              );
              itemsArchived++;
            }
          }

          const deleteResult = await this._runSqlite(
            `
            DELETE FROM ${tableName} WHERE ${timestampColumn} < ?
          `,
            [cutoffISO]
          );
          itemsDeleted = deleteResult.changes;
        } else {
          itemsDeleted = toDelete;
        }
      }

      // Update policy with last cleanup info
      if (!dryRun) {
        if (dbType === 'postgres') {
          await this.db.postgresAdapter.query(
            `
            UPDATE retention_policies 
            SET last_cleanup = CURRENT_TIMESTAMP, items_deleted = items_deleted + $2
            WHERE table_name = $1
          `,
            [tableName, itemsDeleted]
          );
        } else {
          await this._runSqlite(
            `
            UPDATE retention_policies 
            SET last_cleanup = CURRENT_TIMESTAMP, items_deleted = items_deleted + ?
            WHERE table_name = ?
          `,
            [itemsDeleted, tableName]
          );
        }
      }
    } catch (error) {
      status = 'error';
      errorMessage = error.message;
      console.error(`[RETENTION] Cleanup failed for ${tableName}:`, error);
    }

    const duration = Date.now() - startTime;

    // Log the cleanup operation
    if (!dryRun) {
      await this._logCleanup({
        tableName,
        itemsDeleted,
        itemsArchived,
        duration,
        status,
        errorMessage,
      });
    }

    return {
      tableName,
      itemsDeleted,
      itemsArchived,
      dryRun,
      duration,
      status,
      errorMessage,
      cutoffDate: cutoffISO,
      retentionDays: policy.retention_days,
    };
  }

  /**
   * Get timestamp column name for different tables
   */
  _getTimestampColumn(tableName) {
    const columnMap = {
      entries: 'timestamp',
      prompts: 'timestamp',
      events: 'timestamp',
      terminal_commands: 'timestamp',
      screenshots: 'created_at',
      historical_commits: 'mined_at',
      historical_diffs: 'mined_at',
      historical_commands: 'mined_at',
      historical_prompts: 'mined_at',
      file_timestamps: 'mined_at',
    };
    return columnMap[tableName] || 'timestamp';
  }

  /**
   * Log a cleanup operation
   */
  async _logCleanup({ tableName, itemsDeleted, itemsArchived, duration, status, errorMessage }) {
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        await this.db.postgresAdapter.query(
          `
          INSERT INTO retention_logs (table_name, items_deleted, items_archived, cleanup_duration_ms, status, error_message)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
          [tableName, itemsDeleted, itemsArchived, duration, status, errorMessage]
        );
      } else {
        await this._runSqlite(
          `
          INSERT INTO retention_logs (table_name, items_deleted, items_archived, cleanup_duration_ms, status, error_message)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
          [tableName, itemsDeleted, itemsArchived, duration, status, errorMessage]
        );
      }
    } catch (error) {
      console.error('[RETENTION] Failed to log cleanup:', error);
    }
  }

  /**
   * Run cleanup for all tables with enabled policies
   */
  async runFullCleanup(dryRun = false) {
    await this.init();
    console.log(`[RETENTION] Starting ${dryRun ? 'dry run' : 'full'} cleanup...`);

    const policies = await this.getPolicies();
    const results = [];

    for (const policy of policies) {
      if (policy.enabled) {
        const result = await this.cleanupTable(policy.table_name, dryRun);
        results.push(result);
      }
    }

    const totalDeleted = results.reduce((sum, r) => sum + (r.itemsDeleted || 0), 0);
    const totalArchived = results.reduce((sum, r) => sum + (r.itemsArchived || 0), 0);

    console.log(
      `[RETENTION] Cleanup complete. Deleted: ${totalDeleted}, Archived: ${totalArchived}`
    );

    return {
      success: true,
      dryRun,
      totalDeleted,
      totalArchived,
      results,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get cleanup history/logs
   */
  async getCleanupLogs(limit = 50) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      const result = await this.db.postgresAdapter.query(
        `
        SELECT * FROM retention_logs ORDER BY created_at DESC LIMIT $1
      `,
        [limit]
      );
      return result.rows;
    } else {
      return await this._allSqlite(
        `
        SELECT * FROM retention_logs ORDER BY created_at DESC LIMIT ?
      `,
        [limit]
      );
    }
  }

  /**
   * Get database size statistics
   */
  async getDatabaseStats() {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';
    const stats = {
      tables: {},
      totalRows: 0,
      estimatedSizeMB: 0,
    };

    const tables = [
      'entries',
      'prompts',
      'events',
      'terminal_commands',
      'screenshots',
      'archived_data',
    ];

    for (const table of tables) {
      try {
        let count;
        if (dbType === 'postgres') {
          const result = await this.db.postgresAdapter.query(
            `SELECT COUNT(*) as count FROM ${table}`
          );
          count = parseInt(result.rows[0].count);
        } else {
          const result = await this._getSqlite(`SELECT COUNT(*) as count FROM ${table}`);
          count = result?.count || 0;
        }
        stats.tables[table] = { rowCount: count };
        stats.totalRows += count;
      } catch (error) {
        stats.tables[table] = { rowCount: 0, error: error.message };
      }
    }

    // Get SQLite file size if applicable
    if (dbType === 'sqlite' && this.db.dbPath) {
      try {
        const fs = require('fs');
        const fileStat = fs.statSync(this.db.dbPath);
        stats.estimatedSizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);
      } catch (error) {
        stats.estimatedSizeMB = 'unknown';
      }
    }

    return stats;
  }

  /**
   * Start automatic cleanup scheduler
   */
  startScheduler(intervalHours = 24) {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;

    console.log(`[RETENTION] Starting cleanup scheduler (every ${intervalHours} hours)`);

    this.cleanupInterval = setInterval(async () => {
      try {
        await this.runFullCleanup(false);
      } catch (error) {
        console.error('[RETENTION] Scheduled cleanup failed:', error);
      }
    }, intervalMs);

    this.isRunning = true;
  }

  /**
   * Stop automatic cleanup scheduler
   */
  stopScheduler() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isRunning = false;
    console.log('[RETENTION] Cleanup scheduler stopped');
  }
}

module.exports = DataRetentionService;
