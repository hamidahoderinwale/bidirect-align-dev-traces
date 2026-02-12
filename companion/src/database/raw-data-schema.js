/**
 * Raw Data Database Schema
 * Persistent storage for system resources, git data, and IDE state
 */

class RawDataSchema {
  constructor(persistentDB) {
    this.db = persistentDB;
  }

  /**
   * Create tables for raw data storage
   */
  async createTables() {
    if (this.db.postgresAdapter) {
      return this.createPostgresTables();
    }
    return this.createSQLiteTables();
  }

  async createSQLiteTables() {
    return new Promise((resolve, reject) => {
      const tables = [];

      // System Resources table
      tables.push(
        new Promise((res, rej) => {
          this.db.db.run(
            `
            CREATE TABLE IF NOT EXISTS system_resources (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              memory_rss INTEGER,
              memory_heap_total INTEGER,
              memory_heap_used INTEGER,
              memory_external INTEGER,
              memory_array_buffers INTEGER,
              cpu_user INTEGER,
              cpu_system INTEGER,
              system_load_avg_1 REAL,
              system_load_avg_5 REAL,
              system_load_avg_15 REAL,
              system_cpu_cores INTEGER,
              system_free_memory INTEGER,
              system_total_memory INTEGER,
              system_uptime INTEGER,
              system_platform TEXT,
              system_arch TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `,
            (err) => {
              if (err) {
                console.error('[RAW-DATA-SCHEMA] Error creating system_resources table:', err);
                rej(err);
              } else {
                // Create indexes
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_system_resources_timestamp ON system_resources(timestamp DESC)`,
                  () => {}
                );
                res();
              }
            }
          );
        })
      );

      // Git Data table
      tables.push(
        new Promise((res, rej) => {
          this.db.db.run(
            `
            CREATE TABLE IF NOT EXISTS git_data (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              workspace_path TEXT,
              branch TEXT,
              status_json TEXT,
              commit_hash TEXT,
              commit_message TEXT,
              files_changed INTEGER,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `,
            (err) => {
              if (err) {
                console.error('[RAW-DATA-SCHEMA] Error creating git_data table:', err);
                rej(err);
              } else {
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_git_data_timestamp ON git_data(timestamp DESC)`,
                  () => {}
                );
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_git_data_workspace ON git_data(workspace_path)`,
                  () => {}
                );
                res();
              }
            }
          );
        })
      );

      // AppleScript/IDE State table
      tables.push(
        new Promise((res, rej) => {
          this.db.db.run(
            `
            CREATE TABLE IF NOT EXISTS apple_script_state (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              workspace_path TEXT,
              is_active INTEGER DEFAULT 0,
              window_count INTEGER,
              process_name TEXT,
              app_state_json TEXT,
              editor_state_json TEXT,
              debug_state_json TEXT,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `,
            (err) => {
              if (err) {
                console.error('[RAW-DATA-SCHEMA] Error creating apple_script_state table:', err);
                rej(err);
              } else {
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_apple_script_timestamp ON apple_script_state(timestamp DESC)`,
                  () => {}
                );
                res();
              }
            }
          );
        })
      );

      // Cursor Database Conversations (parsed) table
      tables.push(
        new Promise((res, rej) => {
          this.db.db.run(
            `
            CREATE TABLE IF NOT EXISTS cursor_db_conversations (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              conversation_id TEXT UNIQUE,
              workspace_path TEXT,
              title TEXT,
              conversation_data_json TEXT,
              message_count INTEGER DEFAULT 0,
              created_at TEXT DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `,
            (err) => {
              if (err) {
                console.error('[RAW-DATA-SCHEMA] Error creating cursor_db_conversations table:', err);
                rej(err);
              } else {
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_cursor_db_conv_timestamp ON cursor_db_conversations(timestamp DESC)`,
                  () => {}
                );
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_cursor_db_conv_id ON cursor_db_conversations(conversation_id)`,
                  () => {}
                );
                res();
              }
            }
          );
        })
      );

      // Logs table
      tables.push(
        new Promise((res, rej) => {
          this.db.db.run(
            `
            CREATE TABLE IF NOT EXISTS cursor_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp INTEGER NOT NULL,
              log_path TEXT,
              log_name TEXT,
              log_size INTEGER,
              modified_time TEXT,
              log_type TEXT DEFAULT 'cursor',
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
          `,
            (err) => {
              if (err) {
                console.error('[RAW-DATA-SCHEMA] Error creating cursor_logs table:', err);
                rej(err);
              } else {
                this.db.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_cursor_logs_timestamp ON cursor_logs(timestamp DESC)`,
                  () => {}
                );
                res();
              }
            }
          );
        })
      );

      Promise.all(tables)
        .then(() => {
          console.log('[RAW-DATA-SCHEMA] All raw data tables created successfully');
          resolve();
        })
        .catch(reject);
    });
  }

  async createPostgresTables() {
    // PostgreSQL schema would go here if needed
    // For now, we'll use SQLite as the primary storage
    console.log('[RAW-DATA-SCHEMA] PostgreSQL tables not yet implemented, using SQLite');
    return this.createSQLiteTables();
  }

  /**
   * Get table statistics
   */
  async getTableStats() {
    if (this.db.postgresAdapter) {
      // PostgreSQL stats would go here
      return {};
    }

    return new Promise((resolve) => {
      const stats = {};
      const tables = [
        'system_resources',
        'git_data',
        'apple_script_state',
        'cursor_db_conversations',
        'cursor_logs',
      ];

      let completed = 0;
      tables.forEach((table) => {
        this.db.db.get(`SELECT COUNT(*) as count FROM ${table}`, (err, row) => {
          if (!err && row) {
            stats[table] = row.count || 0;
          } else {
            stats[table] = 0;
          }
          completed++;
          if (completed === tables.length) {
            resolve(stats);
          }
        });
      });
    });
  }
}

module.exports = RawDataSchema;

