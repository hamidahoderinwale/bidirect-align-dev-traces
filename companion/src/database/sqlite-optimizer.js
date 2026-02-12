/**
 * SQLite Performance Optimizer
 * Applies performance optimizations for large databases
 */

class SQLiteOptimizer {
  constructor(db) {
    this.db = db;
  }

  /**
   * Apply all performance optimizations
   */
  async optimize() {
    console.log('[SQLITE-OPT] Applying performance optimizations...');

    try {
      await this.enableWAL();
      await this.optimizeSettings();
      await this.createPerformanceIndexes();

      console.log('[SQLITE-OPT] All optimizations applied');
    } catch (error) {
      console.warn('[SQLITE-OPT] Some optimizations failed:', error.message);
    }
  }

  /**
   * Enable WAL (Write-Ahead Logging) mode for better concurrency
   */
  async enableWAL() {
    return new Promise((resolve, reject) => {
      this.db.run('PRAGMA journal_mode = WAL;', (err) => {
        if (err) {
          console.warn('[SQLITE-OPT] Could not enable WAL mode:', err.message);
          reject(err);
        } else {
          console.log('[SQLITE-OPT] WAL mode enabled');
          resolve();
        }
      });
    });
  }

  /**
   * Optimize SQLite settings for large databases
   */
  async optimizeSettings() {
    const pragmas = [
      'PRAGMA synchronous = NORMAL;', // Faster writes, still safe
      'PRAGMA temp_store = MEMORY;', // Use memory for temp tables
      'PRAGMA mmap_size = 30000000000;', // 30GB memory mapping
      'PRAGMA page_size = 4096;', // Optimal page size
      'PRAGMA cache_size = -64000;', // 64MB cache
      'PRAGMA locking_mode = NORMAL;', // Allow concurrent access
    ];

    for (const pragma of pragmas) {
      try {
        await new Promise((resolve, reject) => {
          this.db.run(pragma, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } catch (error) {
        console.warn(`[SQLITE-OPT] Pragma failed: ${pragma}`, error.message);
      }
    }

    console.log('[SQLITE-OPT] Performance settings applied');
  }

  /**
   * Create indexes for common query patterns
   */
  async createPerformanceIndexes() {
    const indexes = [
      // Events table
      'CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);',
      'CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_path);',
      'CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);',
      'CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, timestamp DESC);',

      // Entries table
      'CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp DESC);',
      'CREATE INDEX IF NOT EXISTS idx_entries_file ON entries(file_path);',
      'CREATE INDEX IF NOT EXISTS idx_entries_workspace ON entries(workspace_path);',

      // Prompts table
      'CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp DESC);',
      'CREATE INDEX IF NOT EXISTS idx_prompts_workspace ON prompts(workspace);',
      'CREATE INDEX IF NOT EXISTS idx_prompts_conversation ON prompts(conversation_id);',

      // Conversations table
      'CREATE INDEX IF NOT EXISTS idx_conversations_started ON conversations(started_at DESC);',
    ];

    let created = 0;
    for (const indexSQL of indexes) {
      try {
        await new Promise((resolve, reject) => {
          this.db.run(indexSQL, (err) => {
            if (err) reject(err);
            else {
              created++;
              resolve();
            }
          });
        });
      } catch (error) {
        // Index might already exist, which is fine
        if (!error.message.includes('already exists')) {
          console.warn(`[SQLITE-OPT] Index creation warning:`, error.message);
        }
      }
    }

    console.log(`[SQLITE-OPT] Created/verified ${created} performance indexes`);
  }

  /**
   * Analyze database for query optimization
   */
  async analyze() {
    return new Promise((resolve, reject) => {
      this.db.run('ANALYZE;', (err) => {
        if (err) {
          console.warn('[SQLITE-OPT] ANALYZE failed:', err.message);
          reject(err);
        } else {
          console.log('[SQLITE-OPT] Database analyzed for query optimization');
          resolve();
        }
      });
    });
  }

  /**
   * Vacuum database to reclaim space (WARNING: Can take a long time on large DBs)
   */
  async vacuum() {
    console.log(
      '[SQLITE-OPT] Running VACUUM (this may take several minutes for large databases)...'
    );
    return new Promise((resolve, reject) => {
      this.db.run('VACUUM;', (err) => {
        if (err) {
          console.warn('[SQLITE-OPT] VACUUM failed:', err.message);
          reject(err);
        } else {
          console.log('[SQLITE-OPT] Database vacuumed successfully');
          resolve();
        }
      });
    });
  }
}

module.exports = SQLiteOptimizer;
