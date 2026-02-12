/**
 * PostgreSQL Adapter for PersistentDB
 * Provides PostgreSQL support for cloud deployments
 * OPTIMIZED: Uses connection pooling for better performance
 */

const ConnectionPool = require('./connection-pool');

class PostgresAdapter {
  constructor(connectionString) {
    // Support both DATABASE_URL and NETLIFY_DATABASE_URL (from Netlify Neon extension)
    this.connectionString = connectionString || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    this.pool = null;
    this._initPromise = null;
  }

  /**
   * Initialize PostgreSQL connection pool
   */
  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      if (!this.connectionString) {
        throw new Error('DATABASE_URL not provided for PostgreSQL');
      }

      // Parse SSL requirements from connection string
      const sslConfig = this.connectionString.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false;

      // Use optimized connection pool
      this.pool = new ConnectionPool(this.connectionString, {
        max: 20, // Maximum pool size - handles more concurrent requests
        min: 2, // Keep 2 connections warm
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 2000,
        ssl: sslConfig,
      });

      // Initialize pool
      await this.pool.init();

      // Create tables if they don't exist
      await this.createTables();
    })();

    return this._initPromise;
  }

  /**
   * Create all required tables
   */
  async createTables() {
    const queries = [
      // Entries table
      `CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        session_id TEXT,
        workspace_path TEXT,
        file_path TEXT,
        source TEXT,
        before_code TEXT,
        after_code TEXT,
        notes TEXT,
        timestamp TEXT,
        tags TEXT,
        prompt_id INTEGER,
        modelInfo TEXT,
        type TEXT
      )`,

      // Prompts table
      `CREATE TABLE IF NOT EXISTS prompts (
        id SERIAL PRIMARY KEY,
        timestamp TEXT,
        text TEXT,
        workspace_id TEXT,
        workspace_path TEXT,
        workspace_name TEXT,
        source TEXT,
        status TEXT,
        mode TEXT,
        model_type TEXT,
        model_name TEXT,
        context_usage INTEGER,
        context_file_count INTEGER,
        conversation_id TEXT,
        conversation_title TEXT,
        message_role TEXT,
        parent_conversation_id TEXT,
        composer_id TEXT,
        lines_added INTEGER,
        lines_removed INTEGER,
        thinking_time REAL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        context_window_size INTEGER,
        context_files_json TEXT,
        terminal_blocks_json TEXT,
        has_attachments BOOLEAN,
        attachment_count INTEGER,
        added_from_database BOOLEAN
      )`,

      // Events table
      `CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        session_id TEXT,
        workspace_path TEXT,
        timestamp TEXT,
        type TEXT,
        details TEXT,
        annotation TEXT,
        ai_generated BOOLEAN,
        tags TEXT,
        intent TEXT,
        source TEXT,
        file_path TEXT
      )`,

      // Terminal commands table
      `CREATE TABLE IF NOT EXISTS terminal_commands (
        id SERIAL PRIMARY KEY,
        timestamp TEXT,
        command TEXT,
        workspace TEXT,
        shell TEXT,
        source TEXT,
        exit_code INTEGER,
        duration INTEGER,
        output TEXT,
        error TEXT,
        linked_entry_id INTEGER,
        linked_prompt_id INTEGER
      )`,

      // Context snapshots table
      `CREATE TABLE IF NOT EXISTS context_snapshots (
        id SERIAL PRIMARY KEY,
        timestamp TEXT,
        prompt_id INTEGER,
        current_file_count INTEGER,
        added_files_json TEXT,
        removed_files_json TEXT,
        net_change INTEGER
      )`,

      // Motifs table (for procedural knowledge)
      `CREATE TABLE IF NOT EXISTS motifs (
        id TEXT PRIMARY KEY,
        data JSONB,
        frequency INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )`,

      // Workspaces table
      `CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        path TEXT UNIQUE,
        name TEXT,
        last_activity TEXT
      )`,
    ];

    // Create indexes for better performance
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_entries_workspace ON entries(workspace_path)',
      'CREATE INDEX IF NOT EXISTS idx_entries_prompt_id ON entries(prompt_id)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_workspace ON prompts(workspace_path)',
      'CREATE INDEX IF NOT EXISTS idx_prompts_conversation ON prompts(conversation_id)',
      'CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_events_workspace ON events(workspace_path)',
      'CREATE INDEX IF NOT EXISTS idx_terminal_timestamp ON terminal_commands(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_context_prompt_id ON context_snapshots(prompt_id)',
    ];

    try {
      // Create tables
      for (const query of queries) {
        await this.pool.query(query);
      }

      // Create indexes
      for (const indexQuery of indexes) {
        await this.pool.query(indexQuery);
      }

      console.log('[DB] PostgreSQL tables and indexes created');
    } catch (error) {
      console.error('[DB] Error creating PostgreSQL tables:', error);
      throw error;
    }
  }

  /**
   * Save entry
   */
  async saveEntry(entry) {
    // Use INSERT ... ON CONFLICT for upsert behavior (like SQLite's INSERT OR REPLACE)
    const query = entry.id
      ? `
        INSERT INTO entries (
          id, session_id, workspace_path, file_path, source, before_code, after_code,
          notes, timestamp, tags, prompt_id, modelInfo, type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (id) DO UPDATE SET
          session_id = EXCLUDED.session_id,
          workspace_path = EXCLUDED.workspace_path,
          file_path = EXCLUDED.file_path,
          source = EXCLUDED.source,
          before_code = EXCLUDED.before_code,
          after_code = EXCLUDED.after_code,
          notes = EXCLUDED.notes,
          timestamp = EXCLUDED.timestamp,
          tags = EXCLUDED.tags,
          prompt_id = EXCLUDED.prompt_id,
          modelInfo = EXCLUDED.modelInfo,
          type = EXCLUDED.type
        RETURNING id
      `
      : `
        INSERT INTO entries (
          session_id, workspace_path, file_path, source, before_code, after_code,
          notes, timestamp, tags, prompt_id, modelInfo, type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `;

    const values = entry.id
      ? [
          entry.id,
          entry.session_id || null,
          entry.workspace_path || null,
          entry.file_path || null,
          entry.source || null,
          entry.before_code || entry.before_content || null,
          entry.after_code || entry.after_content || null,
          entry.notes || entry.description || null,
          entry.timestamp || new Date().toISOString(),
          typeof entry.tags === 'string' ? entry.tags : JSON.stringify(entry.tags || []),
          entry.prompt_id || null,
          typeof entry.modelInfo === 'string'
            ? entry.modelInfo
            : JSON.stringify(entry.modelInfo || {}),
          entry.type || null,
        ]
      : [
          entry.session_id || null,
          entry.workspace_path || null,
          entry.file_path || null,
          entry.source || null,
          entry.before_code || entry.before_content || null,
          entry.after_code || entry.after_content || null,
          entry.notes || entry.description || null,
          entry.timestamp || new Date().toISOString(),
          typeof entry.tags === 'string' ? entry.tags : JSON.stringify(entry.tags || []),
          entry.prompt_id || null,
          typeof entry.modelInfo === 'string'
            ? entry.modelInfo
            : JSON.stringify(entry.modelInfo || {}),
          entry.type || null,
        ];

    const result = await this.pool.query(query, values);
    const savedId = result.rows[0].id;
    return { ...entry, id: savedId };
  }

  /**
   * Save prompt
   */
  async savePrompt(prompt) {
    // Use INSERT ... ON CONFLICT for upsert behavior
    const query = prompt.id
      ? `
        INSERT INTO prompts (
          id, timestamp, text, workspace_id, workspace_path, workspace_name, source, status,
          mode, model_type, model_name, context_usage, context_file_count,
          conversation_id, conversation_title, message_role, parent_conversation_id,
          composer_id, lines_added, lines_removed, thinking_time,
          prompt_tokens, completion_tokens, total_tokens, context_window_size,
          context_files_json, terminal_blocks_json, has_attachments, attachment_count,
          added_from_database
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
        )
        ON CONFLICT (id) DO UPDATE SET
          timestamp = EXCLUDED.timestamp,
          text = EXCLUDED.text,
          workspace_id = EXCLUDED.workspace_id,
          workspace_path = EXCLUDED.workspace_path,
          workspace_name = EXCLUDED.workspace_name,
          source = EXCLUDED.source,
          status = EXCLUDED.status,
          mode = EXCLUDED.mode,
          model_type = EXCLUDED.model_type,
          model_name = EXCLUDED.model_name,
          context_usage = EXCLUDED.context_usage,
          context_file_count = EXCLUDED.context_file_count,
          conversation_id = EXCLUDED.conversation_id,
          conversation_title = EXCLUDED.conversation_title,
          message_role = EXCLUDED.message_role,
          parent_conversation_id = EXCLUDED.parent_conversation_id,
          composer_id = EXCLUDED.composer_id,
          lines_added = EXCLUDED.lines_added,
          lines_removed = EXCLUDED.lines_removed,
          thinking_time = EXCLUDED.thinking_time,
          prompt_tokens = EXCLUDED.prompt_tokens,
          completion_tokens = EXCLUDED.completion_tokens,
          total_tokens = EXCLUDED.total_tokens,
          context_window_size = EXCLUDED.context_window_size,
          context_files_json = EXCLUDED.context_files_json,
          terminal_blocks_json = EXCLUDED.terminal_blocks_json,
          has_attachments = EXCLUDED.has_attachments,
          attachment_count = EXCLUDED.attachment_count,
          added_from_database = EXCLUDED.added_from_database
        RETURNING id
      `
      : `
        INSERT INTO prompts (
          timestamp, text, workspace_id, workspace_path, workspace_name, source, status,
          mode, model_type, model_name, context_usage, context_file_count,
          conversation_id, conversation_title, message_role, parent_conversation_id,
          composer_id, lines_added, lines_removed, thinking_time,
          prompt_tokens, completion_tokens, total_tokens, context_window_size,
          context_files_json, terminal_blocks_json, has_attachments, attachment_count,
          added_from_database
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
        RETURNING id
      `;

    const values = [
      prompt.timestamp || new Date().toISOString(),
      prompt.text || '',
      prompt.workspace_id || prompt.workspaceId || null,
      prompt.workspace_path || prompt.workspacePath || null,
      prompt.workspace_name || prompt.workspaceName || null,
      prompt.source || 'cursor',
      prompt.status || 'captured',
      prompt.mode || null,
      prompt.model_type || prompt.modelType || null,
      prompt.model_name || prompt.modelName || null,
      prompt.context_usage || prompt.contextUsage || 0,
      prompt.context_file_count || prompt.contextFileCount || 0,
      prompt.conversation_id || prompt.conversationId || null,
      prompt.conversation_title || prompt.conversationTitle || null,
      prompt.message_role || prompt.messageRole || null,
      prompt.parent_conversation_id || prompt.parentConversationId || null,
      prompt.composer_id || prompt.composerId || null,
      prompt.lines_added || prompt.linesAdded || 0,
      prompt.lines_removed || prompt.linesRemoved || 0,
      prompt.thinking_time || prompt.thinkingTime || prompt.thinkingTimeSeconds || null,
      prompt.prompt_tokens || prompt.promptTokens || null,
      prompt.completion_tokens || prompt.completionTokens || null,
      prompt.total_tokens || prompt.totalTokens || null,
      prompt.context_window_size || prompt.contextWindowSize || null,
      typeof prompt.contextFiles === 'string'
        ? prompt.contextFiles
        : JSON.stringify(prompt.contextFiles || []),
      typeof prompt.terminalBlocks === 'string'
        ? prompt.terminalBlocks
        : JSON.stringify(prompt.terminalBlocks || []),
      prompt.has_attachments || prompt.hasAttachments || false,
      prompt.attachment_count || prompt.attachmentCount || 0,
      prompt.added_from_database || false,
    ];

    const result = await this.pool.query(query, values);
    const savedId = result.rows[0].id;
    return { ...prompt, id: savedId };
  }

  /**
   * Save event
   */
  async saveEvent(event) {
    // Use INSERT ... ON CONFLICT for upsert behavior
    const query = event.id
      ? `
        INSERT INTO events (
          id, session_id, workspace_path, timestamp, type, details, annotation,
          ai_generated, tags, intent, source, file_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          session_id = EXCLUDED.session_id,
          workspace_path = EXCLUDED.workspace_path,
          timestamp = EXCLUDED.timestamp,
          type = EXCLUDED.type,
          details = EXCLUDED.details,
          annotation = EXCLUDED.annotation,
          ai_generated = EXCLUDED.ai_generated,
          tags = EXCLUDED.tags,
          intent = EXCLUDED.intent,
          source = EXCLUDED.source,
          file_path = EXCLUDED.file_path
        RETURNING id
      `
      : `
        INSERT INTO events (
          session_id, workspace_path, timestamp, type, details, annotation,
          ai_generated, tags, intent, source, file_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `;

    const values = event.id
      ? [
          event.id,
          event.session_id || null,
          event.workspace_path || null,
          event.timestamp || new Date().toISOString(),
          event.type || 'activity',
          typeof event.details === 'string' ? event.details : JSON.stringify(event.details || {}),
          event.annotation || null,
          event.ai_generated || false,
          typeof event.tags === 'string' ? event.tags : JSON.stringify(event.tags || []),
          event.intent || null,
          event.source || null,
          event.file_path || null,
        ]
      : [
          event.session_id || null,
          event.workspace_path || null,
          event.timestamp || new Date().toISOString(),
          event.type || 'activity',
          typeof event.details === 'string' ? event.details : JSON.stringify(event.details || {}),
          event.annotation || null,
          event.ai_generated || false,
          typeof event.tags === 'string' ? event.tags : JSON.stringify(event.tags || []),
          event.intent || null,
          event.source || null,
          event.file_path || null,
        ];

    const result = await this.pool.query(query, values);
    const savedId = result.rows[0].id;
    return { ...event, id: savedId };
  }

  /**
   * Get recent entries
   */
  async getRecentEntries(limit = 500, entryId = null, offset = 0, workspace = null) {
    let query = 'SELECT * FROM entries';
    const conditions = [];
    const values = [];
    let paramCount = 1;

    if (entryId) {
      conditions.push(`id > $${paramCount++}`);
      values.push(entryId);
    }

    if (workspace) {
      conditions.push(`workspace_path = $${paramCount++}`);
      values.push(workspace);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    values.push(limit, offset);

    const result = await this.pool.query(query, values);
    return result.rows.map((row) => this.normalizeEntry(row));
  }

  /**
   * Get recent prompts
   */
  async getRecentPrompts(limit = 200, offset = 0, workspace = null) {
    let query = 'SELECT * FROM prompts';
    const values = [];
    let paramCount = 1;

    if (workspace) {
      query += ` WHERE workspace_path = $${paramCount++}`;
      values.push(workspace);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    values.push(limit, offset);

    const result = await this.pool.query(query, values);
    return result.rows.map((row) => this.normalizePrompt(row));
  }

  /**
   * Get recent events
   */
  async getRecentEvents(limit = 50) {
    const query = 'SELECT * FROM events ORDER BY timestamp DESC LIMIT $1';
    const result = await this.pool.query(query, [limit]);
    return result.rows.map((row) => this.normalizeEvent(row));
  }

  /**
   * Normalize entry from database
   */
  normalizeEntry(row) {
    return {
      ...row,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags,
      modelInfo:
        typeof row.modelinfo === 'string' ? JSON.parse(row.modelinfo || '{}') : row.modelinfo,
    };
  }

  /**
   * Normalize prompt from database
   */
  normalizePrompt(row) {
    return {
      ...row,
      contextFiles:
        typeof row.context_files_json === 'string'
          ? JSON.parse(row.context_files_json || '[]')
          : row.context_files_json,
      terminalBlocks:
        typeof row.terminal_blocks_json === 'string'
          ? JSON.parse(row.terminal_blocks_json || '[]')
          : row.terminal_blocks_json,
    };
  }

  /**
   * Normalize event from database
   */
  normalizeEvent(row) {
    return {
      ...row,
      details: typeof row.details === 'string' ? JSON.parse(row.details || '{}') : row.details,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : row.tags,
    };
  }

  /**
   * Get database stats
   */
  async getStats() {
    const [entriesResult, promptsResult, eventsResult] = await Promise.all([
      this.pool.query('SELECT COUNT(*) FROM entries'),
      this.pool.query('SELECT COUNT(*) FROM prompts'),
      this.pool.query('SELECT COUNT(*) FROM events'),
    ]);

    return {
      entries: parseInt(entriesResult.rows[0].count),
      prompts: parseInt(promptsResult.rows[0].count),
      events: parseInt(eventsResult.rows[0].count),
    };
  }

  /**
   * Close connection pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = PostgresAdapter;
