/**
 * Database Speed Optimizations
 * Adds indexes, query optimizations, and performance improvements
 */

class DatabaseSpeedOptimizations {
  constructor(db) {
    this.db = db;
  }

  /**
   * Apply all speed optimizations
   */
  async applyAll() {
    console.log('[DB Optimization] Applying speed optimizations...');
    
    try {
      await this.createIndexes();
      await this.optimizeQueries();
      await this.enablePerformanceSettings();
      await this.createMaterializedViews();
      
      console.log('[DB Optimization] ✓ All optimizations applied');
      return { success: true };
    } catch (error) {
      console.error('[DB Optimization] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create indexes for frequently queried columns
   */
  async createIndexes() {
    console.log('[DB Optimization] Creating indexes...');

    const indexes = [
      // Session indexes
      'CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time DESC)',
      'CREATE INDEX IF NOT EXISTS idx_sessions_workspace_time ON sessions(workspace_path, start_time DESC)',
      
      // Event indexes
      'CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)',
      'CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_events_session_time ON events(session_id, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_path)',
      'CREATE INDEX IF NOT EXISTS idx_events_annotation ON events(annotation)',
      'CREATE INDEX IF NOT EXISTS idx_events_intent ON events(intent)',
      
      // Entry indexes
      'CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_entries_workspace ON entries(workspace_path)',
      'CREATE INDEX IF NOT EXISTS idx_entries_file_path ON entries(file_path)',
      
      // Prompt indexes
      'CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_conversation ON prompts(conversation_id)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_workspace ON prompts(workspace_path)',
      
      // JSON path indexes for commonly accessed JSON fields
      'CREATE INDEX IF NOT EXISTS idx_events_file_path ON events(json_extract(details, "$.file_path"))',
      'CREATE INDEX IF NOT EXISTS idx_events_operation ON events(json_extract(details, "$.operation"))',
      
      // Compound indexes for common query patterns
      'CREATE INDEX IF NOT EXISTS idx_events_session_type_time ON events(session_id, type, timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_session_time ON prompts(session_id, timestamp DESC)',
    ];

    for (const indexSQL of indexes) {
      try {
        await this.db.run(indexSQL);
      } catch (error) {
        // Index might already exist, that's okay
        console.log(`[DB Optimization] Index warning: ${error.message}`);
      }
    }

    console.log(`[DB Optimization] ✓ Created ${indexes.length} indexes`);
  }

  /**
   * Enable performance settings for SQLite
   */
  async enablePerformanceSettings() {
    console.log('[DB Optimization] Enabling performance settings...');

    const settings = [
      // Increase cache size (10MB)
      'PRAGMA cache_size = -10000',
      
      // Use WAL mode for better concurrency
      'PRAGMA journal_mode = WAL',
      
      // Faster synchronization
      'PRAGMA synchronous = NORMAL',
      
      // Keep temp tables in memory
      'PRAGMA temp_store = MEMORY',
      
      // Increase page size for better performance
      'PRAGMA page_size = 4096',
      
      // Enable automatic indexing for temp tables
      'PRAGMA automatic_index = ON',
      
      // Optimize for faster reads
      'PRAGMA query_only = OFF',
      
      // Memory-mapped I/O (256MB)
      'PRAGMA mmap_size = 268435456',
    ];

    for (const setting of settings) {
      try {
        await this.db.run(setting);
      } catch (error) {
        console.log(`[DB Optimization] Setting warning: ${error.message}`);
      }
    }

    console.log('[DB Optimization] ✓ Performance settings enabled');
  }

  /**
   * Optimize existing queries with better patterns
   */
  async optimizeQueries() {
    console.log('[DB Optimization] Running query optimizations...');

    // Analyze tables to update statistics
    const tables = ['sessions', 'events', 'entries', 'prompts'];
    
    for (const table of tables) {
      try {
        await this.db.run(`ANALYZE ${table}`);
      } catch (error) {
        console.log(`[DB Optimization] Analyze warning: ${error.message}`);
      }
    }

    // Vacuum to reclaim space and improve performance
    try {
      await this.db.run('PRAGMA optimize');
    } catch (error) {
      console.log(`[DB Optimization] Optimize warning: ${error.message}`);
    }

    console.log('[DB Optimization] ✓ Query optimizations complete');
  }

  /**
   * Create materialized views for common aggregations
   */
  async createMaterializedViews() {
    console.log('[DB Optimization] Creating materialized views...');

    // Session summary view
    const sessionSummaryView = `
      CREATE TABLE IF NOT EXISTS session_summary AS
      SELECT 
        s.id as session_id,
        s.workspace_path,
        s.start_time,
        s.end_time,
        COUNT(DISTINCT e.id) as event_count,
        COUNT(DISTINCT CASE WHEN e.type = 'code_change' THEN e.id END) as code_change_count,
        COUNT(DISTINCT p.id) as prompt_count,
        GROUP_CONCAT(DISTINCT e.type) as event_types,
        MAX(e.timestamp) as last_activity
      FROM sessions s
      LEFT JOIN events e ON s.id = e.session_id
      LEFT JOIN prompts p ON s.id = p.session_id
      GROUP BY s.id
    `;

    // Workspace activity view
    const workspaceActivityView = `
      CREATE TABLE IF NOT EXISTS workspace_activity AS
      SELECT
        workspace_path,
        DATE(start_time) as activity_date,
        COUNT(DISTINCT id) as session_count,
        SUM(event_count) as total_events
      FROM session_summary
      GROUP BY workspace_path, DATE(start_time)
    `;

    try {
      // Drop existing views first
      await this.db.run('DROP TABLE IF EXISTS session_summary');
      await this.db.run('DROP TABLE IF EXISTS workspace_activity');
      
      // Create new views
      await this.db.run(sessionSummaryView);
      await this.db.run(workspaceActivityView);
      
      // Create indexes on materialized views
      await this.db.run('CREATE INDEX IF NOT EXISTS idx_session_summary_workspace ON session_summary(workspace_path)');
      await this.db.run('CREATE INDEX IF NOT EXISTS idx_session_summary_time ON session_summary(start_time DESC)');
      await this.db.run('CREATE INDEX IF NOT EXISTS idx_workspace_activity_date ON workspace_activity(activity_date DESC)');
      
      console.log('[DB Optimization] ✓ Materialized views created');
    } catch (error) {
      console.log(`[DB Optimization] View warning: ${error.message}`);
    }
  }

  /**
   * Refresh materialized views (call periodically)
   */
  async refreshMaterializedViews() {
    console.log('[DB Optimization] Refreshing materialized views...');
    
    try {
      // Drop and recreate for now (could be optimized with incremental updates)
      await this.createMaterializedViews();
      console.log('[DB Optimization] ✓ Views refreshed');
    } catch (error) {
      console.error('[DB Optimization] Refresh error:', error);
    }
  }

  /**
   * Get optimization status
   */
  async getStatus() {
    const status = {
      indexes: [],
      settings: {},
      stats: {}
    };

    // Get list of indexes
    try {
      const indexes = await this.db.all(`
        SELECT name, tbl_name, sql 
        FROM sqlite_master 
        WHERE type = 'index' AND name LIKE 'idx_%'
        ORDER BY tbl_name, name
      `);
      status.indexes = indexes.map(i => ({ name: i.name, table: i.tbl_name }));
    } catch (error) {
      status.indexes_error = error.message;
    }

    // Get pragma settings
    try {
      const pragmas = ['cache_size', 'journal_mode', 'synchronous', 'page_size', 'mmap_size'];
      for (const pragma of pragmas) {
        const result = await this.db.get(`PRAGMA ${pragma}`);
        status.settings[pragma] = result[pragma];
      }
    } catch (error) {
      status.settings_error = error.message;
    }

    // Get database stats
    try {
      const pageCount = await this.db.get('PRAGMA page_count');
      const pageSize = await this.db.get('PRAGMA page_size');
      const freelistCount = await this.db.get('PRAGMA freelist_count');
      
      status.stats = {
        total_pages: pageCount.page_count,
        page_size: pageSize.page_size,
        size_bytes: pageCount.page_count * pageSize.page_size,
        size_mb: (pageCount.page_count * pageSize.page_size) / (1024 * 1024),
        free_pages: freelistCount.freelist_count,
        fragmentation: ((freelistCount.freelist_count / pageCount.page_count) * 100).toFixed(2) + '%'
      };
    } catch (error) {
      status.stats_error = error.message;
    }

    return status;
  }

  /**
   * Run maintenance tasks
   */
  async runMaintenance() {
    console.log('[DB Optimization] Running maintenance...');
    
    try {
      // Update statistics
      await this.db.run('ANALYZE');
      
      // Optimize queries
      await this.db.run('PRAGMA optimize');
      
      // Incremental vacuum (doesn't block)
      await this.db.run('PRAGMA incremental_vacuum(100)');
      
      // Refresh materialized views
      await this.refreshMaterializedViews();
      
      console.log('[DB Optimization] ✓ Maintenance complete');
      return { success: true };
    } catch (error) {
      console.error('[DB Optimization] Maintenance error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Explain query plan for debugging slow queries
   */
  async explainQuery(sql) {
    try {
      const plan = await this.db.all(`EXPLAIN QUERY PLAN ${sql}`);
      return plan;
    } catch (error) {
      return { error: error.message };
    }
  }
}

module.exports = DatabaseSpeedOptimizations;

