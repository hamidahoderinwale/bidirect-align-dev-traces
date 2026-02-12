/**
 * Denormalized Stats Table
 * Pre-computed statistics for ultra-fast dashboard queries
 */

class StatsTable {
  constructor(db) {
    this.db = db;
    this.initialized = false;
  }

  /**
   * Initialize the stats table
   */
  async init() {
    if (this.initialized) return;

    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      await this.db.adapter.query(`
        CREATE TABLE IF NOT EXISTS daily_stats (
          date DATE PRIMARY KEY,
          total_entries INTEGER DEFAULT 0,
          total_prompts INTEGER DEFAULT 0,
          total_events INTEGER DEFAULT 0,
          total_terminal_commands INTEGER DEFAULT 0,
          avg_context_usage REAL DEFAULT 0,
          avg_chars_added REAL DEFAULT 0,
          avg_chars_deleted REAL DEFAULT 0,
          top_workspace TEXT,
          top_file TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await this.db.adapter.query(`
        CREATE TABLE IF NOT EXISTS global_stats (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      // SQLite
      this.db.db.run(`
        CREATE TABLE IF NOT EXISTS daily_stats (
          date TEXT PRIMARY KEY,
          total_entries INTEGER DEFAULT 0,
          total_prompts INTEGER DEFAULT 0,
          total_events INTEGER DEFAULT 0,
          total_terminal_commands INTEGER DEFAULT 0,
          avg_context_usage REAL DEFAULT 0,
          avg_chars_added REAL DEFAULT 0,
          avg_chars_deleted REAL DEFAULT 0,
          top_workspace TEXT,
          top_file TEXT,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);

      this.db.db.run(`
        CREATE TABLE IF NOT EXISTS global_stats (
          key TEXT PRIMARY KEY,
          value TEXT,
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
    }

    this.initialized = true;
  }

  /**
   * Update daily stats (call this periodically via cron)
   */
  async updateDailyStats(date = new Date()) {
    await this.init();

    const dateStr = date.toISOString().split('T')[0];
    const dbType = this.db.dbType || 'sqlite';

    try {
      // Get counts
      const entriesCount = await this.db.getTotalEntriesCount();
      const promptsResult = await (dbType === 'postgres'
        ? this.db.adapter.query('SELECT COUNT(*) as count FROM prompts')
        : new Promise((resolve) => {
            this.db.db.get('SELECT COUNT(*) as count FROM prompts', (err, row) => {
              resolve({ rows: [row || { count: 0 }] });
            });
          }));
      const promptsCount =
        dbType === 'postgres' ? promptsResult.rows[0].count : promptsResult.rows[0].count;

      // Get averages
      const avgContextResult = await (dbType === 'postgres'
        ? this.db.adapter.query(
            'SELECT AVG(context_usage) as avg FROM prompts WHERE context_usage IS NOT NULL'
          )
        : new Promise((resolve) => {
            this.db.db.get(
              'SELECT AVG(context_usage) as avg FROM prompts WHERE context_usage IS NOT NULL',
              (err, row) => {
                resolve({ rows: [row || { avg: 0 }] });
              }
            );
          }));
      const avgContext =
        dbType === 'postgres' ? avgContextResult.rows[0].avg : avgContextResult.rows[0].avg;

      // Get averages for chars
      const avgCharsResult = await (dbType === 'postgres'
        ? this.db.adapter.query(`
            SELECT
              AVG(CAST(after_code_length AS REAL) - CAST(before_code_length AS REAL)) as avg_added,
              AVG(CAST(before_code_length AS REAL) - CAST(after_code_length AS REAL)) as avg_deleted
            FROM entries
            WHERE after_code_length IS NOT NULL
              AND before_code_length IS NOT NULL
          `)
        : new Promise((resolve) => {
            this.db.db.get(
              `
              SELECT
                AVG(CAST(after_code_length AS REAL) - CAST(before_code_length AS REAL)) as avg_added,
                AVG(CAST(before_code_length AS REAL) - CAST(after_code_length AS REAL)) as avg_deleted
              FROM entries
              WHERE after_code_length IS NOT NULL
                AND before_code_length IS NOT NULL
            `,
              (err, row) => {
                resolve({ rows: [row || { avg_added: 0, avg_deleted: 0 }] });
              }
            );
          }));
      const avgAdded =
        dbType === 'postgres' ? avgCharsResult.rows[0].avg_added : avgCharsResult.rows[0].avg_added;
      const avgDeleted =
        dbType === 'postgres'
          ? avgCharsResult.rows[0].avg_deleted
          : avgCharsResult.rows[0].avg_deleted;

      // Get top workspace
      const topWorkspaceResult = await (dbType === 'postgres'
        ? this.db.adapter.query(`
            SELECT workspace_path, COUNT(*) as count
            FROM entries
            WHERE workspace_path IS NOT NULL
            GROUP BY workspace_path
            ORDER BY count DESC
            LIMIT 1
          `)
        : new Promise((resolve) => {
            this.db.db.get(
              `
              SELECT workspace_path, COUNT(*) as count
              FROM entries
              WHERE workspace_path IS NOT NULL
              GROUP BY workspace_path
              ORDER BY count DESC
              LIMIT 1
            `,
              (err, row) => {
                resolve({ rows: [row || { workspace_path: null }] });
              }
            );
          }));
      const topWorkspace =
        dbType === 'postgres'
          ? topWorkspaceResult.rows[0]?.workspace_path
          : topWorkspaceResult.rows[0]?.workspace_path;

      // Get top file
      const topFileResult = await (dbType === 'postgres'
        ? this.db.adapter.query(`
            SELECT file_path, COUNT(*) as count
            FROM entries
            WHERE file_path IS NOT NULL
            GROUP BY file_path
            ORDER BY count DESC
            LIMIT 1
          `)
        : new Promise((resolve) => {
            this.db.db.get(
              `
              SELECT file_path, COUNT(*) as count
              FROM entries
              WHERE file_path IS NOT NULL
              GROUP BY file_path
              ORDER BY count DESC
              LIMIT 1
            `,
              (err, row) => {
                resolve({ rows: [row || { file_path: null }] });
              }
            );
          }));
      const topFile =
        dbType === 'postgres' ? topFileResult.rows[0]?.file_path : topFileResult.rows[0]?.file_path;

      // Upsert stats
      if (dbType === 'postgres') {
        await this.db.adapter.query(
          `
          INSERT INTO daily_stats
            (date, total_entries, total_prompts, avg_context_usage, avg_chars_added, avg_chars_deleted, top_workspace, top_file, updated_at)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (date) DO UPDATE SET
            total_entries = $2,
            total_prompts = $3,
            avg_context_usage = $4,
            avg_chars_added = $5,
            avg_chars_deleted = $6,
            top_workspace = $7,
            top_file = $8,
            updated_at = NOW()
        `,
          [
            dateStr,
            entriesCount,
            promptsCount,
            avgContext || 0,
            avgAdded || 0,
            avgDeleted || 0,
            topWorkspace,
            topFile,
          ]
        );
      } else {
        this.db.db.run(
          `
          INSERT OR REPLACE INTO daily_stats
            (date, total_entries, total_prompts, avg_context_usage, avg_chars_added, avg_chars_deleted, top_workspace, top_file, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        `,
          [
            dateStr,
            entriesCount,
            promptsCount,
            avgContext || 0,
            avgAdded || 0,
            avgDeleted || 0,
            topWorkspace,
            topFile,
          ]
        );
      }

      console.log(`[STATS] Updated daily stats for ${dateStr}`);
      return true;
    } catch (error) {
      console.error('[STATS] Failed to update daily stats:', error);
      return false;
    }
  }

  /**
   * Get daily stats (ultra-fast)
   */
  async getDailyStats(date = new Date()) {
    await this.init();

    const dateStr = date.toISOString().split('T')[0];
    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      const result = await this.db.adapter.query('SELECT * FROM daily_stats WHERE date = $1', [
        dateStr,
      ]);
      return result.rows[0] || null;
    } else {
      return new Promise((resolve) => {
        this.db.db.get('SELECT * FROM daily_stats WHERE date = ?', [dateStr], (err, row) => {
          resolve(row || null);
        });
      });
    }
  }

  /**
   * Set global stat
   */
  async setGlobalStat(key, value) {
    await this.init();

    const dbType = this.db.dbType || 'sqlite';
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);

    if (dbType === 'postgres') {
      await this.db.adapter.query(
        `
        INSERT INTO global_stats (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = $2,
          updated_at = NOW()
      `,
        [key, valueStr]
      );
    } else {
      this.db.db.run(
        `
        INSERT OR REPLACE INTO global_stats (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
      `,
        [key, valueStr]
      );
    }
  }

  /**
   * Get global stat
   */
  async getGlobalStat(key) {
    await this.init();

    const dbType = this.db.dbType || 'sqlite';

    if (dbType === 'postgres') {
      const result = await this.db.adapter.query('SELECT value FROM global_stats WHERE key = $1', [
        key,
      ]);
      const valueStr = result.rows[0]?.value;
      if (!valueStr) return null;
      try {
        return JSON.parse(valueStr);
      } catch {
        return valueStr;
      }
    } else {
      return new Promise((resolve) => {
        this.db.db.get('SELECT value FROM global_stats WHERE key = ?', [key], (err, row) => {
          if (!row || !row.value) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(row.value));
          } catch {
            resolve(row.value);
          }
        });
      });
    }
  }
}

module.exports = StatsTable;
