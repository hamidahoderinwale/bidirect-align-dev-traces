/**
 * User Preferences Service
 * Syncs user preferences between frontend localStorage and backend database
 * Provides persistence, backup, and cross-device sync capabilities
 */

class UserPreferencesService {
  constructor(persistentDB) {
    this.db = persistentDB;
    this.initialized = false;

    // Default preferences schema
    this.defaultPreferences = {
      // Theme and Display
      theme: 'system',
      accentColor: '#6366f1',
      compactMode: false,
      showAnimations: true,

      // Dashboard
      dashboard: {
        defaultView: 'home',
        refreshInterval: 30000,
        showTrends: true,
        collapsedSections: [],
      },

      // Export Settings
      export: {
        defaultFormat: 'json',
        defaultPrivacyLevel: 'clio',
        includeMetadata: true,
        prettyPrint: true,
        autoCompress: false,
      },

      // Notifications
      notifications: {
        enabled: true,
        soundEnabled: false,
        showExportComplete: true,
        showCleanupComplete: true,
      },

      // Data Display
      display: {
        dateFormat: 'relative',
        timezone: 'local',
        codeTheme: 'github-dark',
        maxCodePreviewLines: 10,
      },

      // Privacy
      privacy: {
        defaultAbstractionLevel: 'clio',
        hideFilePaths: false,
        hideUsernames: false,
      },

      // Advanced
      advanced: {
        debugMode: false,
        showRawData: false,
        autoSync: true,
        syncInterval: 60000,
      },
    };
  }

  /**
   * Initialize preferences table
   */
  async init() {
    if (this.initialized) return;

    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        await this.db.postgresAdapter.query(`
          CREATE TABLE IF NOT EXISTS user_preferences (
            id SERIAL PRIMARY KEY,
            user_id TEXT DEFAULT 'default',
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            value_type TEXT DEFAULT 'string',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            synced_from TEXT,
            UNIQUE(user_id, category, key)
          )
        `);

        // Create index for faster lookups
        await this.db.postgresAdapter.query(`
          CREATE INDEX IF NOT EXISTS idx_preferences_user_cat ON user_preferences(user_id, category)
        `);

        // Preferences sync log for conflict resolution
        await this.db.postgresAdapter.query(`
          CREATE TABLE IF NOT EXISTS preferences_sync_log (
            id SERIAL PRIMARY KEY,
            user_id TEXT DEFAULT 'default',
            action TEXT NOT NULL,
            category TEXT,
            key TEXT,
            old_value TEXT,
            new_value TEXT,
            source TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } else {
        // SQLite
        await this._runSqlite(`
          CREATE TABLE IF NOT EXISTS user_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT DEFAULT 'default',
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT,
            value_type TEXT DEFAULT 'string',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            synced_from TEXT,
            UNIQUE(user_id, category, key)
          )
        `);

        await this._runSqlite(`
          CREATE INDEX IF NOT EXISTS idx_preferences_user_cat ON user_preferences(user_id, category)
        `);

        await this._runSqlite(`
          CREATE TABLE IF NOT EXISTS preferences_sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT DEFAULT 'default',
            action TEXT NOT NULL,
            category TEXT,
            key TEXT,
            old_value TEXT,
            new_value TEXT,
            source TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }

      this.initialized = true;
      console.log('[PREFERENCES] User preferences service initialized');
    } catch (error) {
      console.error('[PREFERENCES] Failed to initialize:', error);
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
   * Parse value based on type
   */
  _parseValue(value, valueType) {
    if (value === null || value === undefined) return null;

    switch (valueType) {
      case 'boolean':
        return value === 'true' || value === true;
      case 'number':
        return Number(value);
      case 'object':
      case 'array':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  /**
   * Determine value type
   */
  _getValueType(value) {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    return 'string';
  }

  /**
   * Get a single preference
   */
  async get(category, key, userId = 'default') {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      let row;
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'SELECT value, value_type FROM user_preferences WHERE user_id = $1 AND category = $2 AND key = $3',
          [userId, category, key]
        );
        row = result.rows[0];
      } else {
        row = await this._getSqlite(
          'SELECT value, value_type FROM user_preferences WHERE user_id = ? AND category = ? AND key = ?',
          [userId, category, key]
        );
      }

      if (!row) {
        // Return default if exists
        const defaults = this.defaultPreferences[category];
        if (defaults && key in defaults) {
          return defaults[key];
        }
        return null;
      }

      return this._parseValue(row.value, row.value_type);
    } catch (error) {
      console.error('[PREFERENCES] Failed to get preference:', error);
      throw error;
    }
  }

  /**
   * Set a single preference
   */
  async set(category, key, value, userId = 'default', source = 'api') {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    const valueType = this._getValueType(value);
    const valueStr =
      valueType === 'object' || valueType === 'array' ? JSON.stringify(value) : String(value);

    try {
      // Get old value for sync log
      const oldValue = await this.get(category, key, userId);

      if (dbType === 'postgres') {
        await this.db.postgresAdapter.query(
          `
          INSERT INTO user_preferences (user_id, category, key, value, value_type, synced_from, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, category, key) DO UPDATE SET
            value = $4,
            value_type = $5,
            synced_from = $6,
            updated_at = CURRENT_TIMESTAMP
        `,
          [userId, category, key, valueStr, valueType, source]
        );

        // Log the change
        await this.db.postgresAdapter.query(
          `
          INSERT INTO preferences_sync_log (user_id, action, category, key, old_value, new_value, source)
          VALUES ($1, 'set', $2, $3, $4, $5, $6)
        `,
          [userId, category, key, JSON.stringify(oldValue), valueStr, source]
        );
      } else {
        await this._runSqlite(
          `
          INSERT INTO user_preferences (user_id, category, key, value, value_type, synced_from, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (user_id, category, key) DO UPDATE SET
            value = excluded.value,
            value_type = excluded.value_type,
            synced_from = excluded.synced_from,
            updated_at = CURRENT_TIMESTAMP
        `,
          [userId, category, key, valueStr, valueType, source]
        );

        await this._runSqlite(
          `
          INSERT INTO preferences_sync_log (user_id, action, category, key, old_value, new_value, source)
          VALUES (?, 'set', ?, ?, ?, ?, ?)
        `,
          [userId, category, key, JSON.stringify(oldValue), valueStr, source]
        );
      }

      return { category, key, value, updated: true };
    } catch (error) {
      console.error('[PREFERENCES] Failed to set preference:', error);
      throw error;
    }
  }

  /**
   * Get all preferences for a user
   */
  async getAll(userId = 'default') {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      let rows;
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'SELECT category, key, value, value_type, updated_at FROM user_preferences WHERE user_id = $1',
          [userId]
        );
        rows = result.rows;
      } else {
        rows = await this._allSqlite(
          'SELECT category, key, value, value_type, updated_at FROM user_preferences WHERE user_id = ?',
          [userId]
        );
      }

      // Build nested preferences object, starting with defaults
      const preferences = JSON.parse(JSON.stringify(this.defaultPreferences));

      for (const row of rows) {
        if (!preferences[row.category]) {
          preferences[row.category] = {};
        }
        preferences[row.category][row.key] = this._parseValue(row.value, row.value_type);
      }

      return preferences;
    } catch (error) {
      console.error('[PREFERENCES] Failed to get all preferences:', error);
      throw error;
    }
  }

  /**
   * Get preferences for a specific category
   */
  async getCategory(category, userId = 'default') {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      let rows;
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'SELECT key, value, value_type, updated_at FROM user_preferences WHERE user_id = $1 AND category = $2',
          [userId, category]
        );
        rows = result.rows;
      } else {
        rows = await this._allSqlite(
          'SELECT key, value, value_type, updated_at FROM user_preferences WHERE user_id = ? AND category = ?',
          [userId, category]
        );
      }

      // Start with defaults
      const categoryPrefs = { ...(this.defaultPreferences[category] || {}) };

      for (const row of rows) {
        categoryPrefs[row.key] = this._parseValue(row.value, row.value_type);
      }

      return categoryPrefs;
    } catch (error) {
      console.error('[PREFERENCES] Failed to get category:', error);
      throw error;
    }
  }

  /**
   * Bulk set preferences (for syncing from frontend)
   */
  async bulkSet(preferences, userId = 'default', source = 'sync') {
    await this.init();

    const results = [];

    for (const [category, categoryPrefs] of Object.entries(preferences)) {
      if (typeof categoryPrefs === 'object' && categoryPrefs !== null) {
        for (const [key, value] of Object.entries(categoryPrefs)) {
          try {
            const result = await this.set(category, key, value, userId, source);
            results.push(result);
          } catch (error) {
            results.push({ category, key, error: error.message });
          }
        }
      }
    }

    return {
      success: true,
      updated: results.filter((r) => r.updated).length,
      failed: results.filter((r) => r.error).length,
      results,
    };
  }

  /**
   * Delete a preference (reset to default)
   */
  async delete(category, key, userId = 'default') {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        await this.db.postgresAdapter.query(
          'DELETE FROM user_preferences WHERE user_id = $1 AND category = $2 AND key = $3',
          [userId, category, key]
        );
      } else {
        await this._runSqlite(
          'DELETE FROM user_preferences WHERE user_id = ? AND category = ? AND key = ?',
          [userId, category, key]
        );
      }

      return { deleted: true, category, key };
    } catch (error) {
      console.error('[PREFERENCES] Failed to delete preference:', error);
      throw error;
    }
  }

  /**
   * Reset all preferences to defaults
   */
  async resetAll(userId = 'default') {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'DELETE FROM user_preferences WHERE user_id = $1',
          [userId]
        );
        return { reset: true, deleted: result.rowCount };
      } else {
        const result = await this._runSqlite('DELETE FROM user_preferences WHERE user_id = ?', [
          userId,
        ]);
        return { reset: true, deleted: result.changes };
      }
    } catch (error) {
      console.error('[PREFERENCES] Failed to reset preferences:', error);
      throw error;
    }
  }

  /**
   * Get sync log for debugging/conflict resolution
   */
  async getSyncLog(userId = 'default', limit = 50) {
    await this.init();
    const dbType = this.db.dbType || 'sqlite';

    try {
      if (dbType === 'postgres') {
        const result = await this.db.postgresAdapter.query(
          'SELECT * FROM preferences_sync_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
          [userId, limit]
        );
        return result.rows;
      } else {
        return await this._allSqlite(
          'SELECT * FROM preferences_sync_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
          [userId, limit]
        );
      }
    } catch (error) {
      console.error('[PREFERENCES] Failed to get sync log:', error);
      throw error;
    }
  }

  /**
   * Export preferences as JSON (for backup)
   */
  async export(userId = 'default') {
    const preferences = await this.getAll(userId);
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      userId,
      preferences,
    };
  }

  /**
   * Import preferences from JSON (for restore)
   */
  async import(data, userId = 'default', overwrite = false) {
    if (!data || !data.preferences) {
      throw new Error('Invalid preferences data');
    }

    if (overwrite) {
      await this.resetAll(userId);
    }

    return await this.bulkSet(data.preferences, userId, 'import');
  }

  /**
   * Get default preferences schema
   */
  getDefaults() {
    return JSON.parse(JSON.stringify(this.defaultPreferences));
  }
}

module.exports = UserPreferencesService;
