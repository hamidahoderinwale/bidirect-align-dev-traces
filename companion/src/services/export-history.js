/**
 * Export History Service
 * Tracks all exports with metadata for audit and replay capabilities
 */

class ExportHistoryService {
  constructor(persistentDB) {
    this.db = persistentDB;
    this.initialized = false;
  }

  /**
   * Initialize export history tables
   */
  async init() {
    if (this.initialized) return;

    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        await this.db.postgresAdapter.query(`
          CREATE TABLE IF NOT EXISTS export_history (
            id SERIAL PRIMARY KEY,
            export_type TEXT NOT NULL,
            format TEXT DEFAULT 'json',
            rung TEXT DEFAULT 'clio',
            file_name TEXT,
            file_size_bytes BIGINT,
            item_count INTEGER DEFAULT 0,
            
            -- Filters used
            workspace_filter TEXT,
            time_range_start TIMESTAMP,
            time_range_end TIMESTAMP,
            data_sources TEXT,
            privacy_level TEXT,
            
            -- Request details
            request_params TEXT,
            client_info TEXT,
            
            -- Status
            status TEXT DEFAULT 'completed',
            error_message TEXT,
            duration_ms INTEGER,
            
            -- Timestamps
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
          )
        `);

        // Create indexes for faster queries
        await this.db.postgresAdapter.query(`
          CREATE INDEX IF NOT EXISTS idx_export_history_created ON export_history(created_at DESC)
        `);
        await this.db.postgresAdapter.query(`
          CREATE INDEX IF NOT EXISTS idx_export_history_type ON export_history(export_type)
        `);
      } else {
        // SQLite
        await this._runSqlite(`
          CREATE TABLE IF NOT EXISTS export_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            export_type TEXT NOT NULL,
            format TEXT DEFAULT 'json',
            rung TEXT DEFAULT 'clio',
            file_name TEXT,
            file_size_bytes INTEGER,
            item_count INTEGER DEFAULT 0,
            
            -- Filters used
            workspace_filter TEXT,
            time_range_start TEXT,
            time_range_end TEXT,
            data_sources TEXT,
            privacy_level TEXT,
            
            -- Request details
            request_params TEXT,
            client_info TEXT,
            
            -- Status
            status TEXT DEFAULT 'completed',
            error_message TEXT,
            duration_ms INTEGER,
            
            -- Timestamps
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
          )
        `);

        await this._runSqlite(`
          CREATE INDEX IF NOT EXISTS idx_export_history_created ON export_history(created_at DESC)
        `);
        await this._runSqlite(`
          CREATE INDEX IF NOT EXISTS idx_export_history_type ON export_history(export_type)
        `);
      }

      this.initialized = true;
      console.log('[EXPORT-HISTORY] Export history service initialized');
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to initialize:', error);
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
   * Log a new export operation
   * @param {Object} exportData - Export metadata
   * @returns {Object} Created export record
   */
  async logExport(exportData) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    const {
      exportType,
      format = 'json',
      rung = 'clio',
      fileName,
      fileSizeBytes,
      itemCount = 0,
      workspaceFilter,
      timeRangeStart,
      timeRangeEnd,
      dataSources,
      privacyLevel,
      requestParams,
      clientInfo,
      status = 'completed',
      errorMessage,
      durationMs,
    } = exportData;

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          `
          INSERT INTO export_history (
            export_type, format, rung, file_name, file_size_bytes, item_count,
            workspace_filter, time_range_start, time_range_end, data_sources, privacy_level,
            request_params, client_info, status, error_message, duration_ms, completed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)
          RETURNING *
        `,
          [
            exportType,
            format,
            rung,
            fileName,
            fileSizeBytes,
            itemCount,
            workspaceFilter ? JSON.stringify(workspaceFilter) : null,
            timeRangeStart,
            timeRangeEnd,
            dataSources ? JSON.stringify(dataSources) : null,
            privacyLevel,
            requestParams ? JSON.stringify(requestParams) : null,
            clientInfo ? JSON.stringify(clientInfo) : null,
            status,
            errorMessage,
            durationMs,
          ]
        );
        return result.rows[0];
      } else {
        const result = await this._runSqlite(
          `
          INSERT INTO export_history (
            export_type, format, rung, file_name, file_size_bytes, item_count,
            workspace_filter, time_range_start, time_range_end, data_sources, privacy_level,
            request_params, client_info, status, error_message, duration_ms, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [
            exportType,
            format,
            rung,
            fileName,
            fileSizeBytes,
            itemCount,
            workspaceFilter ? JSON.stringify(workspaceFilter) : null,
            timeRangeStart,
            timeRangeEnd,
            dataSources ? JSON.stringify(dataSources) : null,
            privacyLevel,
            requestParams ? JSON.stringify(requestParams) : null,
            clientInfo ? JSON.stringify(clientInfo) : null,
            status,
            errorMessage,
            durationMs,
          ]
        );

        return await this._getSqlite('SELECT * FROM export_history WHERE id = ?', [result.lastID]);
      }
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to log export:', error);
      throw error;
    }
  }

  /**
   * Get export history with pagination and filters
   * @param {Object} options - Query options
   * @returns {Object} Paginated export history
   */
  async getHistory(options = {}) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    const {
      limit = 50,
      offset = 0,
      exportType,
      format,
      status,
      startDate,
      endDate,
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = options;

    const conditions = [];
    const params = [];

    if (exportType) {
      conditions.push(
        dbType === 'postgres' ? `export_type = $${params.length + 1}` : 'export_type = ?'
      );
      params.push(exportType);
    }
    if (format) {
      conditions.push(dbType === 'postgres' ? `format = $${params.length + 1}` : 'format = ?');
      params.push(format);
    }
    if (status) {
      conditions.push(dbType === 'postgres' ? `status = $${params.length + 1}` : 'status = ?');
      params.push(status);
    }
    if (startDate) {
      conditions.push(
        dbType === 'postgres' ? `created_at >= $${params.length + 1}` : 'created_at >= ?'
      );
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(
        dbType === 'postgres' ? `created_at <= $${params.length + 1}` : 'created_at <= ?'
      );
      params.push(endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const validSortColumns = ['created_at', 'file_size_bytes', 'item_count', 'duration_ms'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
      if (dbType === 'postgres') {
        const countResult = await this.db.postgresAdapter.query(
          `SELECT COUNT(*) as total FROM export_history ${whereClause}`,
          params
        );
        const total = parseInt(countResult.rows[0].total);

        params.push(limit, offset);
        const dataResult = await this.db.postgresAdapter.query(
          `SELECT * FROM export_history ${whereClause} 
           ORDER BY ${sortColumn} ${order} 
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );

        return {
          success: true,
          data: dataResult.rows.map(this._parseJsonFields),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
          },
        };
      } else {
        const countResult = await this._getSqlite(
          `SELECT COUNT(*) as total FROM export_history ${whereClause}`,
          params
        );
        const total = countResult?.total || 0;

        params.push(limit, offset);
        const data = await this._allSqlite(
          `SELECT * FROM export_history ${whereClause} 
           ORDER BY ${sortColumn} ${order} 
           LIMIT ? OFFSET ?`,
          params
        );

        return {
          success: true,
          data: data.map(this._parseJsonFields),
          pagination: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
          },
        };
      }
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to get history:', error);
      throw error;
    }
  }

  /**
   * Parse JSON fields in export record
   */
  _parseJsonFields(record) {
    const jsonFields = ['workspace_filter', 'data_sources', 'request_params', 'client_info'];
    const parsed = { ...record };

    for (const field of jsonFields) {
      if (parsed[field] && typeof parsed[field] === 'string') {
        try {
          parsed[field] = JSON.parse(parsed[field]);
        } catch {
          // Keep as string if parsing fails
        }
      }
    }

    return parsed;
  }

  /**
   * Get a single export record by ID
   */
  async getById(id) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'SELECT * FROM export_history WHERE id = $1',
          [id]
        );
        return result.rows[0] ? this._parseJsonFields(result.rows[0]) : null;
      } else {
        const record = await this._getSqlite('SELECT * FROM export_history WHERE id = ?', [id]);
        return record ? this._parseJsonFields(record) : null;
      }
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to get export by ID:', error);
      throw error;
    }
  }

  /**
   * Delete old export history records
   * @param {number} olderThanDays - Delete records older than this many days
   */
  async cleanup(olderThanDays = 90) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    const cutoffISO = cutoffDate.toISOString();

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'DELETE FROM export_history WHERE created_at < $1',
          [cutoffISO]
        );
        console.log(`[EXPORT-HISTORY] Cleaned up ${result.rowCount} old export records`);
        return { deleted: result.rowCount };
      } else {
        const result = await this._runSqlite('DELETE FROM export_history WHERE created_at < ?', [
          cutoffISO,
        ]);
        console.log(`[EXPORT-HISTORY] Cleaned up ${result.changes} old export records`);
        return { deleted: result.changes };
      }
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to cleanup:', error);
      throw error;
    }
  }

  /**
   * Get export statistics
   */
  async getStats() {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(`
          SELECT 
            COUNT(*) as total_exports,
            COUNT(DISTINCT export_type) as export_types_used,
            SUM(file_size_bytes) as total_bytes_exported,
            SUM(item_count) as total_items_exported,
            AVG(duration_ms) as avg_duration_ms,
            COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_exports,
            COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_exports,
            MIN(created_at) as first_export,
            MAX(created_at) as last_export
          FROM export_history
        `);
        return result.rows[0];
      } else {
        return await this._getSqlite(`
          SELECT 
            COUNT(*) as total_exports,
            COUNT(DISTINCT export_type) as export_types_used,
            SUM(file_size_bytes) as total_bytes_exported,
            SUM(item_count) as total_items_exported,
            AVG(duration_ms) as avg_duration_ms,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful_exports,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed_exports,
            MIN(created_at) as first_export,
            MAX(created_at) as last_export
          FROM export_history
        `);
      }
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to get stats:', error);
      throw error;
    }
  }

  /**
   * Get exports grouped by type
   */
  async getByType() {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(`
          SELECT 
            export_type,
            COUNT(*) as count,
            SUM(file_size_bytes) as total_bytes,
            SUM(item_count) as total_items,
            MAX(created_at) as last_export
          FROM export_history
          GROUP BY export_type
          ORDER BY count DESC
        `);
        return result.rows;
      } else {
        return await this._allSqlite(`
          SELECT 
            export_type,
            COUNT(*) as count,
            SUM(file_size_bytes) as total_bytes,
            SUM(item_count) as total_items,
            MAX(created_at) as last_export
          FROM export_history
          GROUP BY export_type
          ORDER BY count DESC
        `);
      }
    } catch (error) {
      console.error('[EXPORT-HISTORY] Failed to get by type:', error);
      throw error;
    }
  }
}

module.exports = ExportHistoryService;
