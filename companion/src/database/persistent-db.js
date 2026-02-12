const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const PostgresAdapter = require('./postgres-adapter');

/**
 * Persistent Database for Companion Service
 * Supports both SQLite (local) and PostgreSQL (cloud)
 */
class PersistentDB {
  constructor(dbPath = null) {
    // Determine database type from environment
    // Support both DATABASE_URL and NETLIFY_DATABASE_URL (from Netlify Neon extension)
    const databaseUrl = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
    const dbType = process.env.DATABASE_TYPE || (databaseUrl ? 'postgres' : 'sqlite');

    this.dbType = dbType;

    // Prefer the shared top-level data directory (../data/companion.db) if it exists,
    // otherwise fall back to the legacy src-local path (../data/companion.db relative to src).
    // This ensures the service uses the same populated database the CLI and existing installs use.
    if (dbPath) {
      this.dbPath = dbPath;
    } else {
      const legacyPath = path.join(__dirname, '../data/companion.db'); // src/data/companion.db
      const sharedPath = path.join(__dirname, '../../data/companion.db'); // data/companion.db

      if (fs.existsSync(sharedPath)) {
        this.dbPath = sharedPath;
      } else {
        this.dbPath = legacyPath;
      }
    }
    this.db = null;
    this.postgresAdapter = null;
    this._initPromise = null;

    // Initialize appropriate database adapter
    if (this.dbType === 'postgres' || databaseUrl) {
      console.log('[DB] Using PostgreSQL database');
      this.postgresAdapter = new PostgresAdapter(databaseUrl);
    } else {
      console.log('[DB] Using SQLite database');
    }
  }

  /**
   * Initialize database and create tables
   */
  async init() {
    if (this._initPromise) return this._initPromise;

    // Use PostgreSQL if configured
    if (this.postgresAdapter) {
      this._initPromise = this.postgresAdapter.init();
      return this._initPromise;
    }

    // Otherwise use SQLite
    this._initPromise = new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Failed to open database:', err);
          reject(err);
          return;
        }

        console.log(`[DB] Connected to SQLite database: ${this.dbPath}`);

        // Verify database has data
        this.db.get('SELECT COUNT(*) as count FROM entries', (err, row) => {
          if (!err && row) {
            const entryCount = row.count || 0;
            this.db.get('SELECT COUNT(*) as count FROM prompts', (err2, row2) => {
              if (!err2 && row2) {
                const promptCount = row2.count || 0;
                this.db.get('SELECT COUNT(*) as count FROM events', (err3, row3) => {
                  if (!err3 && row3) {
                    const eventCount = row3.count || 0;
                    const total = entryCount + promptCount + eventCount;
                    if (total > 0) {
                      console.log(
                        `[DB] Database contains: ${entryCount.toLocaleString()} entries, ${promptCount.toLocaleString()} prompts, ${eventCount.toLocaleString()} events`
                      );
                    } else {
                      console.warn(`[DB] Database is empty - no data found`);
                    }
                  }
                });
              }
            });
          }
        });

        // Enable foreign key constraints
        this.db.run('PRAGMA foreign_keys = ON');

        // Performance optimizations for SQLite
        this.db.run('PRAGMA journal_mode=WAL;'); // Write-Ahead Logging for better concurrency
        this.db.run('PRAGMA synchronous=NORMAL;'); // Faster than FULL, still safe
        this.db.run('PRAGMA cache_size=-64000;'); // 64MB cache (negative = KB)
        this.db.run('PRAGMA temp_store=MEMORY;'); // Store temp tables in memory
        this.db.run('PRAGMA mmap_size=268435456;'); // 256MB memory-mapped I/O
        console.log('[DB] SQLite performance optimizations enabled');

        // Create tables - wait for all to complete before resolving
        this.db.serialize(() => {
          const tables = [];

          // Entries table
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS entries (
                id INTEGER PRIMARY KEY,
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
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating entries table:', err);
                    rej(err);
                  } else {
                    // Add synced_at column in background
                    setImmediate(() => {
                      const SchemaHelpers = require('./schema-helpers.js');
                      const helpers = new SchemaHelpers(this);
                      helpers
                        .safeAddColumns('entries', [{ name: 'synced_at', type: 'TEXT' }], true)
                        .catch((err) => {
                          console.warn('[DB] Background synced_at column addition failed (non-critical):', err.message);
                        });
                    });
                    res();
                  }
                }
              );
            })
          );

          // Prompts table with rich metadata
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS prompts (
                id INTEGER PRIMARY KEY,
                timestamp TEXT,
                text TEXT,
                status TEXT,
                linked_entry_id INTEGER,
                source TEXT,
                workspace_id TEXT,
                workspace_path TEXT,
                workspace_name TEXT,
                composer_id TEXT,
                subtitle TEXT,
                lines_added INTEGER DEFAULT 0,
                lines_removed INTEGER DEFAULT 0,
                context_usage REAL DEFAULT 0,
                mode TEXT,
                model_type TEXT,
                model_name TEXT,
                force_mode TEXT,
                is_auto INTEGER DEFAULT 0,
                type TEXT,
                confidence TEXT,
                added_from_database INTEGER DEFAULT 0
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating prompts table:', err);
                    rej(err);
                  } else {
                    // Resolve immediately - don't block server startup on column additions
                    // Column additions will happen in background for large databases
                    res();

                    // Add new columns to existing table using safe helper (non-blocking)
                    // For large databases, this can take time, so we do it in background
                    setImmediate(() => {
                      const SchemaHelpers = require('./schema-helpers.js');
                      const helpers = new SchemaHelpers(this);

                      helpers
                        .safeAddColumns(
                          'prompts',
                          [
                            { name: 'workspace_id', type: 'TEXT' },
                            { name: 'workspace_path', type: 'TEXT' },
                            { name: 'workspace_name', type: 'TEXT' },
                            { name: 'composer_id', type: 'TEXT' },
                            { name: 'subtitle', type: 'TEXT' },
                            { name: 'lines_added', type: 'INTEGER', defaultValue: 0 },
                            { name: 'lines_removed', type: 'INTEGER', defaultValue: 0 },
                            { name: 'context_usage', type: 'REAL', defaultValue: 0 },
                            { name: 'mode', type: 'TEXT' },
                            { name: 'model_type', type: 'TEXT' },
                            { name: 'model_name', type: 'TEXT' },
                            { name: 'force_mode', type: 'TEXT' },
                            { name: 'is_auto', type: 'INTEGER', defaultValue: 0 },
                            { name: 'type', type: 'TEXT' },
                            { name: 'confidence', type: 'TEXT' },
                            { name: 'added_from_database', type: 'INTEGER', defaultValue: 0 },
                            // Context files tracking
                            { name: 'context_files_json', type: 'TEXT' },
                            { name: 'context_file_count', type: 'INTEGER', defaultValue: 0 },
                            {
                              name: 'context_file_count_explicit',
                              type: 'INTEGER',
                              defaultValue: 0,
                            },
                            { name: 'context_file_count_tabs', type: 'INTEGER', defaultValue: 0 },
                            { name: 'context_file_count_auto', type: 'INTEGER', defaultValue: 0 },
                            // Enhanced context tracking
                            { name: 'thinking_time', type: 'INTEGER', defaultValue: 0 },
                            { name: 'thinking_time_seconds', type: 'REAL', defaultValue: 0 },
                            { name: 'terminal_blocks_json', type: 'TEXT' },
                            { name: 'terminal_block_count', type: 'INTEGER', defaultValue: 0 },
                            { name: 'has_attachments', type: 'INTEGER', defaultValue: 0 },
                            { name: 'attachment_count', type: 'INTEGER', defaultValue: 0 },
                            // Conversation tracking
                            { name: 'conversation_id', type: 'TEXT' },
                            { name: 'conversation_index', type: 'INTEGER' },
                            { name: 'conversation_title', type: 'TEXT' },
                            // Message role and parent conversation
                            { name: 'message_role', type: 'TEXT' },
                            { name: 'parent_conversation_id', type: 'TEXT' },
                          ],
                          true
                        )
                        .then(() => {
                          // Create indexes for conversation queries after columns are added
                          this.db.run(
                            `CREATE INDEX IF NOT EXISTS idx_prompts_conversation ON prompts(conversation_id)`,
                            (idxErr) => {
                              if (idxErr && !idxErr.message.includes('already exists')) {
                                console.warn('Error creating prompts conversation index:', idxErr);
                              }
                            }
                          );
                          this.db.run(
                            `CREATE INDEX IF NOT EXISTS idx_prompts_workspace_conversation ON prompts(workspace_id, conversation_id)`,
                            (idxErr) => {
                              if (idxErr && !idxErr.message.includes('already exists')) {
                                console.warn(
                                  'Error creating prompts workspace_conversation index:',
                                  idxErr
                                );
                              }
                            }
                          );
                        })
                        .catch((err) => {
                          console.warn(
                            '[DB] Background column addition failed (non-critical):',
                            err.message
                          );
                        });
                    });
                    // Add synced_at column in background
                    setImmediate(() => {
                      const SchemaHelpers = require('./schema-helpers.js');
                      const helpers = new SchemaHelpers(this);
                      helpers
                        .safeAddColumns('prompts', [{ name: 'synced_at', type: 'TEXT' }], true)
                        .catch((err) => {
                          console.warn('[DB] Background synced_at column addition failed (non-critical):', err.message);
                        });
                    });
                  }
                }
              );
            })
          );

          // Conversations table (explicit conversation entity)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                workspace_path TEXT,
                title TEXT,
                status TEXT DEFAULT 'active',
                tags TEXT,
                metadata TEXT,
                created_at TEXT,
                updated_at TEXT,
                last_message_at TEXT,
                message_count INTEGER DEFAULT 0
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating conversations table:', err);
                    rej(err);
                  } else {
                    // Create indexes
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_conversations_workspace ON conversations(workspace_id)`,
                      (idxErr) => {
                        if (idxErr)
                          console.warn('Error creating conversations workspace index:', idxErr);
                      }
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status)`,
                      (idxErr) => {
                        if (idxErr)
                          console.warn('Error creating conversations status index:', idxErr);
                      }
                    );
                    res();
                  }
                }
              );
            })
          );

          // Conversation turns table (individual user/assistant messages with timing)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS conversation_turns (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                model_name TEXT,
                model_provider TEXT,
                prompt_tokens INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                total_tokens INTEGER DEFAULT 0,
                request_start_time INTEGER,
                request_end_time INTEGER,
                request_duration_ms INTEGER,
                first_token_time INTEGER,
                time_to_first_token_ms INTEGER,
                thinking_time INTEGER DEFAULT 0,
                thinking_time_seconds REAL DEFAULT 0,
                streaming BOOLEAN DEFAULT 0,
                context_files TEXT,
                referenced_files TEXT,
                code_blocks TEXT,
                metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating conversation_turns table:', err);
                    rej(err);
                  } else {
                    // Create indexes for efficient queries
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_turns_conversation ON conversation_turns(conversation_id)`,
                      (idxErr) => {
                        if (idxErr)
                          console.warn('Error creating turns conversation index:', idxErr);
                      }
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_turns_conversation_index ON conversation_turns(conversation_id, turn_index)`,
                      (idxErr) => {
                        if (idxErr)
                          console.warn('Error creating turns conversation_index index:', idxErr);
                      }
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_turns_role ON conversation_turns(role)`,
                      (idxErr) => {
                        if (idxErr) console.warn('Error creating turns role index:', idxErr);
                      }
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_turns_created_at ON conversation_turns(created_at)`,
                      (idxErr) => {
                        if (idxErr) console.warn('Error creating turns created_at index:', idxErr);
                      }
                    );
                    res();
                  }
                }
              );
            })
          );

          // Events table (for detailed event tracking)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                workspace_path TEXT,
                timestamp TEXT,
                type TEXT,
                details TEXT,
                annotation TEXT,
                intent TEXT,
                tags TEXT,
                ai_generated INTEGER DEFAULT 0
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating events table:', err);
                    rej(err);
                  } else {
                    // Add new columns if they don't exist using safe helper
                    const SchemaHelpers = require('./schema-helpers.js');
                    const helpers = new SchemaHelpers(this);
                    helpers.safeAddColumns(
                      'events',
                      [
                        { name: 'annotation', type: 'TEXT' },
                        { name: 'intent', type: 'TEXT' },
                        { name: 'tags', type: 'TEXT' },
                        { name: 'ai_generated', type: 'INTEGER', defaultValue: 0 },
                        { name: 'synced_at', type: 'TEXT' },
                      ],
                      true
                    );
                    res();
                  }
                }
              );
            })
          );

          // Context snapshots table for persistent context analytics
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS context_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id TEXT,
                timestamp INTEGER,
                file_count INTEGER DEFAULT 0,
                token_estimate INTEGER DEFAULT 0,
                truncated INTEGER DEFAULT 0,
                utilization_percent REAL DEFAULT 0,
                context_files TEXT,
                at_mentions TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating context_snapshots table:', err);
                    rej(err);
                  } else {
                    res();
                  }
                }
              );
            })
          );

          // Context changes table for tracking file additions/removals
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS context_changes (
                id TEXT PRIMARY KEY,
                prompt_id TEXT,
                event_id TEXT,
                task_id TEXT,
                session_id TEXT,
                timestamp INTEGER NOT NULL,
                previous_file_count INTEGER DEFAULT 0,
                current_file_count INTEGER DEFAULT 0,
                added_files TEXT,
                removed_files TEXT,
                unchanged_files TEXT,
                net_change INTEGER DEFAULT 0,
                metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating context_changes table:', err);
                    rej(err);
                  } else {
                    // Create indexes for faster queries
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_context_changes_prompt ON context_changes(prompt_id)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_context_changes_event ON context_changes(event_id)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_context_changes_task ON context_changes(task_id)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_context_changes_timestamp ON context_changes(timestamp)`,
                      () => {}
                    );
                    res();
                  }
                }
              );
            })
          );

          // Audit log table for import/export history
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                operation TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                workspace_id TEXT,
                user_id TEXT,
                details TEXT,
                status TEXT,
                error_message TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating audit_log table:', err);
                    rej(err);
                  } else {
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_audit_operation ON audit_log(operation_type)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`,
                      () => {}
                    );
                    res();
                  }
                }
              );
            })
          );

          // Terminal commands table
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS terminal_commands (
                id TEXT PRIMARY KEY,
                command TEXT NOT NULL,
                shell TEXT,
                source TEXT,
                timestamp INTEGER NOT NULL,
                workspace TEXT,
                output TEXT,
                exit_code INTEGER,
                duration INTEGER,
                error TEXT,
                linked_entry_id INTEGER,
                linked_prompt_id INTEGER,
                session_id TEXT
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating terminal_commands table:', err);
                    rej(err);
                  } else {
                    res();
                  }
                }
              );
            })
          );

          // Share links table for workspace sharing
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS share_links (
                id TEXT PRIMARY KEY,
                share_id TEXT UNIQUE NOT NULL,
                account_id TEXT,
                device_id TEXT,
                workspaces TEXT,
                abstraction_level INTEGER DEFAULT 1,
                filters TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                access_count INTEGER DEFAULT 0,
                last_accessed INTEGER,
                metadata TEXT
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating share_links table:', err);
                    rej(err);
                  } else {
                    // Add columns using safe helper
                    const SchemaHelpers = require('./schema-helpers.js');
                    const helpers = new SchemaHelpers(this);
                    helpers.safeAddColumns(
                      'share_links',
                      [
                        { name: 'account_id', type: 'TEXT' },
                        { name: 'device_id', type: 'TEXT' },
                      ],
                      true
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_share_links_expires ON share_links(expires_at)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_share_links_created ON share_links(created_at)`,
                      () => {}
                    );
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_share_links_account ON share_links(account_id)`,
                      () => {}
                    );
                    res();
                  }
                }
              );
            })
          );

          // NEW: Attachments table (for images and files)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS prompt_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                prompt_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                format TEXT,
                filename TEXT,
                data BLOB,
                thumbnail BLOB,
                size INTEGER,
                width INTEGER,
                height INTEGER,
                timestamp INTEGER,
                FOREIGN KEY (prompt_id) REFERENCES prompts(id)
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating attachments table:', err);
                    rej(err);
                  } else {
                    // Create index for faster lookups
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_attachments_prompt_id ON prompt_attachments(prompt_id)`,
                      () => {
                        res();
                      }
                    );
                  }
                }
              );
            })
          );

          // TODO tracking tables
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER,
                order_index INTEGER DEFAULT 0,
                session_id TEXT,
                prompts_while_active TEXT,
                files_modified TEXT
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating todos table:', err);
                    rej(err);
                  } else {
                    res();
                  }
                }
              );
            })
          );

          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS todo_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                todo_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                event_id INTEGER,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (todo_id) REFERENCES todos(id)
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating todo_events table:', err);
                    rej(err);
                  } else {
                    // Create indexes
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_todo_events_todo_id ON todo_events(todo_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_todos_session ON todos(session_id)`,
                              () => {
                                res();
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Schema config table (for custom field configurations)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS schema_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                field_name TEXT NOT NULL,
                field_type TEXT NOT NULL,
                display_name TEXT,
                description TEXT,
                enabled INTEGER DEFAULT 1,
                config_json TEXT,
                workspace_id TEXT,
                workspace_path TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(table_name, field_name, workspace_id)
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating schema_config table:', err);
                    rej(err);
                  } else {
                    // Add workspace columns using safe helper
                    const SchemaHelpers = require('./schema-helpers.js');
                    const helpers = new SchemaHelpers(this);

                    helpers
                      .safeAddColumns(
                        'schema_config',
                        [
                          { name: 'workspace_id', type: 'TEXT' },
                          { name: 'workspace_path', type: 'TEXT' },
                        ],
                        true
                      )
                      .then(() => {
                        res();
                      })
                      .catch((err) => {
                        console.warn(
                          '[DB] Error adding workspace columns to schema_config:',
                          err.message
                        );
                        res(); // Continue even if columns fail
                      });
                  }
                }
              );
            })
          );

          // Motifs table (Rung 6 - procedural patterns)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
          CREATE TABLE IF NOT EXISTS motifs (
            id TEXT PRIMARY KEY,
            pattern TEXT NOT NULL,
            sequence TEXT,
            dominant_intent TEXT,
            shape TEXT,
            frequency INTEGER DEFAULT 0,
            confidence REAL DEFAULT 0,
            data TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `,
                (err) => {
                  if (err) {
                    console.error('Error creating motifs table:', err);
                    rej(err);
                  } else {
                    // Create indexes
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_motif_intent ON motifs(dominant_intent)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_motif_shape ON motifs(shape)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_motif_frequency ON motifs(frequency)`,
                              () => {
                                res();
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Plot outputs table (for Jupyter notebook plots and script-generated plots)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
          CREATE TABLE IF NOT EXISTS plot_outputs (
            id TEXT PRIMARY KEY,
            plot_type TEXT NOT NULL,
            source_type TEXT NOT NULL,
            file_path TEXT,
            notebook_path TEXT,
            cell_index INTEGER,
            execution_count INTEGER,
            format TEXT,
            library TEXT,
            width INTEGER,
            height INTEGER,
            size INTEGER,
            perceptual_hash TEXT,
            thumbnail_path TEXT,
            is_regeneration INTEGER DEFAULT 0,
            original_plot_id TEXT,
            regeneration_count INTEGER DEFAULT 0,
            version_number INTEGER DEFAULT 1,
            changes_detected TEXT,
            similarity_to_original REAL,
            created_at TEXT,
            execution_timestamp TEXT,
            cell_source TEXT,
            script_path TEXT,
            workspace_path TEXT,
            FOREIGN KEY (original_plot_id) REFERENCES plot_outputs(id)
          )
        `,
                (err) => {
                  if (err) {
                    console.error('Error creating plot_outputs table:', err);
                    rej(err);
                  } else {
                    // Create indexes
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_plot_original ON plot_outputs(original_plot_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_plot_path ON plot_outputs(file_path)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_plot_notebook ON plot_outputs(notebook_path, cell_index)`,
                              () => {
                                this.db.run(
                                  `CREATE INDEX IF NOT EXISTS idx_plot_hash ON plot_outputs(perceptual_hash)`,
                                  () => {
                                    this.db.run(
                                      `CREATE INDEX IF NOT EXISTS idx_plot_workspace ON plot_outputs(workspace_path)`,
                                      () => {
                                        res();
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Rung 1: Token-level abstraction
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
          CREATE TABLE IF NOT EXISTS rung1_tokens (
            id TEXT PRIMARY KEY,
            diff_id TEXT,
            file_path TEXT,
            file_id TEXT,
            language TEXT,
            token_sequence TEXT,
            canonical_sequence TEXT,
            token_count INTEGER,
            identifier_count INTEGER,
            string_literal_count INTEGER,
            numeric_literal_count INTEGER,
            timestamp TEXT,
            workspace_path TEXT,
            linked_prompt_id TEXT,
            metadata TEXT
          )
        `,
                (err) => {
                  if (err) {
                    console.error('Error creating rung1_tokens table:', err);
                    rej(err);
                  } else {
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_rung1_file ON rung1_tokens(file_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_rung1_timestamp ON rung1_tokens(timestamp)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_rung1_language ON rung1_tokens(language)`,
                              () => {
                                res();
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Rung 2: Statement-level (semantic edit scripts)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
          CREATE TABLE IF NOT EXISTS rung2_edit_scripts (
            id TEXT PRIMARY KEY,
            diff_id TEXT,
            file_path TEXT,
            file_id TEXT,
            language TEXT,
            edit_operations TEXT,
            operation_count INTEGER,
            operation_types TEXT,
            ast_node_types TEXT,
            change_style TEXT,
            timestamp TEXT,
            workspace_path TEXT,
            linked_prompt_id TEXT,
            intent_category TEXT,
            metadata TEXT
          )
        `,
                (err) => {
                  if (err) {
                    console.error('Error creating rung2_edit_scripts table:', err);
                    rej(err);
                  } else {
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_rung2_file ON rung2_edit_scripts(file_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_rung2_timestamp ON rung2_edit_scripts(timestamp)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_rung2_intent ON rung2_edit_scripts(intent_category)`,
                              () => {
                                this.db.run(
                                  `CREATE INDEX IF NOT EXISTS idx_rung2_language ON rung2_edit_scripts(language)`,
                                  () => {
                                    res();
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Rung 3: Function-level representation
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
          CREATE TABLE IF NOT EXISTS rung3_function_changes (
            id TEXT PRIMARY KEY,
            diff_id TEXT,
            file_path TEXT,
            file_id TEXT,
            language TEXT,
            change_type TEXT,
            function_id TEXT,
            function_name TEXT,
            signature_before TEXT,
            signature_after TEXT,
            parameter_changes TEXT,
            return_type_changed INTEGER,
            callgraph_updates TEXT,
            docstring_changed INTEGER,
            timestamp TEXT,
            workspace_path TEXT,
            linked_prompt_id TEXT,
            intent_category TEXT,
            metadata TEXT
          )
        `,
                (err) => {
                  if (err) {
                    console.error('Error creating rung3_function_changes table:', err);
                    rej(err);
                  } else {
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_rung3_file ON rung3_function_changes(file_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_rung3_function ON rung3_function_changes(function_id)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_rung3_timestamp ON rung3_function_changes(timestamp)`,
                              () => {
                                this.db.run(
                                  `CREATE INDEX IF NOT EXISTS idx_rung3_change_type ON rung3_function_changes(change_type)`,
                                  () => {
                                    res();
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
          CREATE TABLE IF NOT EXISTS rung3_functions (
            id TEXT PRIMARY KEY,
            file_id TEXT,
            function_name TEXT,
            canonical_signature TEXT,
            parameter_count INTEGER,
            return_type TEXT,
            first_seen TEXT,
            last_modified TEXT,
            call_count INTEGER,
            metadata TEXT
          )
        `,
                (err) => {
                  if (err) {
                    console.error('Error creating rung3_functions table:', err);
                    rej(err);
                  } else {
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_rung3_func_file ON rung3_functions(file_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_rung3_func_signature ON rung3_functions(canonical_signature)`,
                          () => {
                            res();
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Whiteboards table (for saved whiteboard configurations)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS whiteboards (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                data TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating whiteboards table:', err);
                    rej(err);
                  } else {
                    res();
                  }
                }
              );
            })
          );

          // Local config table (for participant settings and research config)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS local_config (
                key TEXT PRIMARY KEY,
                value TEXT
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating local_config table:', err);
                    rej(err);
                  } else {
                    res();
                  }
                }
              );
            })
          );

          // Sync log table (for tracking research sync operations)
          tables.push(
            new Promise((res, rej) => {
              this.db.run(
                `
              CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_type TEXT NOT NULL,
                record_type TEXT NOT NULL,
                record_id INTEGER,
                record_uuid TEXT,
                rung INTEGER,
                status TEXT NOT NULL,
                error_message TEXT,
                synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
              )
            `,
                (err) => {
                  if (err) {
                    console.error('Error creating sync_log table:', err);
                    rej(err);
                  } else {
                    // Create indexes for sync log
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log(sync_type, record_type)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status)`,
                          () => {
                            this.db.run(
                              `CREATE INDEX IF NOT EXISTS idx_sync_log_synced_at ON sync_log(synced_at)`,
                              () => {
                                res();
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                }
              );
            })
          );

          // Create indexes for better query performance
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp)`);
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_entries_workspace ON entries(workspace_path)`
          );
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_entries_prompt_id ON entries(prompt_id)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_entries_file_path ON entries(file_path)`);
          // Composite index for common query pattern: workspace + timestamp ordering
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_entries_workspace_timestamp ON entries(workspace_path, timestamp DESC)`
          );

          this.db.run(`CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp)`);
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_prompts_linked_entry ON prompts(linked_entry_id)`
          );
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompts(status)`);
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_prompts_workspace ON prompts(workspace_path)`
          );
          // Composite index for common query pattern: workspace + timestamp ordering
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_prompts_workspace_timestamp ON prompts(workspace_path, timestamp DESC)`
          );

          this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);
          // Composite index for common query pattern: workspace + timestamp ordering
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_events_workspace_timestamp ON events(workspace_path, timestamp DESC)`
          );

          // Migration: Add new fields to rung tables
          this.migrateRungTables();
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`);

          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_terminal_timestamp ON terminal_commands(timestamp)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_terminal_workspace ON terminal_commands(workspace)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_terminal_exit_code ON terminal_commands(exit_code)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_terminal_session ON terminal_commands(session_id)`
          );

          // Composite indexes for common query patterns (better performance)
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_entries_workspace_timestamp ON entries(workspace_path, timestamp DESC)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_prompts_workspace_timestamp ON prompts(workspace_path, timestamp DESC)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_events_workspace_timestamp ON events(workspace_path, timestamp DESC)`
          );
          // Note: parent_conversation_id index is created after column is added via safeAddColumns
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_entries_file_timestamp ON entries(file_path, timestamp DESC)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp DESC)`
          );

          // NEW: Additional indexes for faster common queries
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp DESC)`
          );
          this.db.run(
            `CREATE INDEX IF NOT EXISTS idx_prompts_timestamp ON prompts(timestamp DESC)`
          );
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_entries_id ON entries(id DESC)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_prompts_id ON prompts(id DESC)`);

          console.log('[DB] Composite indexes created for optimized queries');

          // Wait for all tables to be created, but with a timeout to prevent hanging
          // For large databases, table creation can be slow, but we don't want to block server startup
          const tableCreationTimeout = setTimeout(() => {
            console.warn(
              '[DB] Table creation taking longer than expected, resolving init promise to allow server startup...'
            );
            console.warn('[DB] Tables will continue initializing in background');
            resolve(); // Resolve anyway so server can start
          }, 5000); // 5 second timeout

          Promise.all(tables)
            .then(() => {
              clearTimeout(tableCreationTimeout);
              resolve();
            })
            .catch((err) => {
              clearTimeout(tableCreationTimeout);
              console.error('[DB] Error creating some tables:', err.message);
              // Still resolve so server can start - missing tables can be created later
              console.warn('[DB] Resolving init promise anyway to allow server startup');
              resolve();
            });
        });
      });
    });

    return this._initPromise;
  }

  /**
   * Save an entry to the database
   */
  async saveEntry(entry) {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        const saved = await this.postgresAdapter.saveEntry(entry);
        return saved; // Returns { ...entry, id }
      } catch (error) {
        console.error('[DB] Error saving entry to PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO entries
        (id, session_id, workspace_path, file_path, source, before_code, after_code, notes, timestamp, tags, prompt_id, modelInfo, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        entry.id,
        entry.session_id,
        entry.workspace_path,
        entry.file_path,
        entry.source,
        entry.before_code || entry.before_content,
        entry.after_code || entry.after_content,
        entry.notes || entry.description,
        entry.timestamp,
        Array.isArray(entry.tags) ? JSON.stringify(entry.tags) : entry.tags,
        entry.prompt_id,
        typeof entry.modelInfo === 'object' ? JSON.stringify(entry.modelInfo) : entry.modelInfo,
        entry.type
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error saving entry:', err);
          reject(err);
        } else {
          resolve(entry);
        }
      });
    });
  }

  /**
   * Save a prompt to the database with full metadata
   */
  async savePrompt(prompt) {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        const id = await this.postgresAdapter.savePrompt(prompt);
        return { ...prompt, id };
      } catch (error) {
        console.error('[DB] Error saving prompt to PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      // Extract context files data
      const contextFiles = prompt.contextFiles || {
        files: [],
        count: 0,
        countBySource: { explicit: 0, tabs: 0, auto: 0 },
      };
      const contextFilesJson = JSON.stringify(contextFiles.files || []);

      // Extract terminal blocks
      const terminalBlocks = prompt.terminalBlocks || [];
      const terminalBlocksJson = JSON.stringify(terminalBlocks);

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO prompts
        (id, timestamp, text, status, linked_entry_id, source,
         workspace_id, workspace_path, workspace_name, composer_id, subtitle,
         lines_added, lines_removed, context_usage, mode, model_type, model_name,
         force_mode, is_auto, type, confidence, added_from_database,
         context_files_json, context_file_count, context_file_count_explicit,
         context_file_count_tabs, context_file_count_auto,
         thinking_time, thinking_time_seconds, terminal_blocks_json,
         terminal_block_count, has_attachments, attachment_count,
         conversation_title, message_role, parent_conversation_id,
         conversation_id, conversation_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Ensure conversation_id is set (use composerId or parentConversationId as fallback)
      const conversationId =
        prompt.conversationId || prompt.composerId || prompt.parentConversationId || null;

      stmt.run(
        prompt.id,
        prompt.timestamp,
        prompt.text || prompt.prompt || prompt.preview,
        prompt.status || 'captured',
        prompt.linked_entry_id || prompt.linkedEntryId || null,
        prompt.source || 'unknown',
        prompt.workspaceId || null,
        prompt.workspacePath || null,
        prompt.workspaceName || null,
        prompt.composerId || null,
        prompt.subtitle || null,
        prompt.linesAdded || 0,
        prompt.linesRemoved || 0,
        prompt.contextUsage || 0,
        prompt.mode || null,
        prompt.modelType || null,
        prompt.modelName || null,
        prompt.forceMode || null,
        prompt.isAuto ? 1 : 0,
        prompt.type || null,
        prompt.confidence || null,
        prompt.added_from_database ? 1 : 0,
        contextFilesJson,
        contextFiles.count || 0,
        contextFiles.countBySource?.explicit || 0,
        contextFiles.countBySource?.tabs || 0,
        contextFiles.countBySource?.auto || 0,
        prompt.thinkingTime || 0,
        prompt.thinkingTimeSeconds || 0,
        terminalBlocksJson,
        terminalBlocks.length || 0,
        prompt.hasAttachments ? 1 : 0,
        prompt.attachmentCount || 0,
        prompt.conversationTitle || null,
        prompt.messageRole || null,
        prompt.parentConversationId || null,
        conversationId,
        prompt.conversationIndex || null
      );

      // Update conversation if conversation_id is set
      if (conversationId && prompt.workspaceId) {
        this.updateConversationMetadata(
          conversationId,
          prompt.workspaceId,
          prompt.workspacePath,
          prompt.conversationTitle
        ).catch((err) => {
          console.warn('[DB] Could not update conversation metadata:', err.message);
        });
      }

      stmt.finalize((err) => {
        if (err) {
          console.error('Error saving prompt:', err);
          reject(err);
        } else {
          resolve(prompt);
        }
      });
    });
  }

  /**
   * Save an event to the database
   */
  async saveEvent(event) {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        const id = await this.postgresAdapter.saveEvent(event);
        return { ...event, id };
      } catch (error) {
        console.error('[DB] Error saving event to PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO events
        (id, session_id, workspace_path, timestamp, type, details, annotation, intent, tags, ai_generated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        event.id,
        event.session_id,
        event.workspace_path,
        event.timestamp,
        event.type,
        typeof event.details === 'object' ? JSON.stringify(event.details) : event.details,
        event.annotation || null,
        event.intent || null,
        Array.isArray(event.tags) ? JSON.stringify(event.tags) : event.tags || null,
        event.ai_generated ? 1 : 0
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error saving event:', err);
          reject(err);
        } else {
          resolve(event);
        }
      });
    });
  }

  /**
   * Get a single event by ID
   */
  async getEvent(eventId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM events WHERE id = ?`, [eventId], (err, row) => {
        if (err) {
          console.error('Error getting event:', err);
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ...row,
            details: row.details ? JSON.parse(row.details) : {},
            tags: row.tags ? JSON.parse(row.tags || '[]') : [],
            ai_generated: row.ai_generated === 1,
          });
        }
      });
    });
  }

  /**
   * Get all events for a session
   */
  async getEventsBySession(sessionId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`,
        [sessionId],
        (err, rows) => {
          if (err) {
            console.error('Error getting events by session:', err);
            reject(err);
          } else {
            resolve(
              rows.map((row) => ({
                ...row,
                details: row.details ? JSON.parse(row.details) : {},
                tags: row.tags ? JSON.parse(row.tags || '[]') : [],
                ai_generated: row.ai_generated === 1,
              }))
            );
          }
        }
      );
    });
  }

  /**
   * Get recent events
   */
  async getRecentEvents(limit = 50) {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        return await this.postgresAdapter.getRecentEvents(limit);
      } catch (error) {
        console.error('[DB] Error getting recent events from PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM events ORDER BY timestamp DESC LIMIT ?`, [limit], (err, rows) => {
        if (err) {
          console.error('Error getting recent events:', err);
          reject(err);
        } else {
          resolve(
            rows.map((row) => ({
              ...row,
              details: row.details ? JSON.parse(row.details) : {},
              tags: row.tags ? JSON.parse(row.tags || '[]') : [],
              ai_generated: row.ai_generated === 1,
            }))
          );
        }
      });
    });
  }

  /**
   * Save a terminal command to the database
   */
  async saveTerminalCommand(command) {
    await this.init();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO terminal_commands
        (id, command, shell, source, timestamp, workspace, output, exit_code, duration, error, linked_entry_id, linked_prompt_id, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        command.id,
        command.command,
        command.shell,
        command.source,
        command.timestamp,
        command.workspace,
        command.output,
        command.exitCode,
        command.duration,
        command.error,
        command.linkedEntryId || null,
        command.linkedPromptId || null,
        command.sessionId || null
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error saving terminal command:', err);
          reject(err);
        } else {
          resolve(command);
        }
      });
    });
  }

  /**
   * Get all terminal commands
   */
  async getAllTerminalCommands(limit = 500) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM terminal_commands ORDER BY timestamp DESC LIMIT ?`,
        [limit],
        (err, rows) => {
          if (err) {
            console.error('Error loading terminal commands:', err);
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  /**
   * Get terminal commands with filters
   */
  async getTerminalCommands(options = {}) {
    await this.init();

    const { limit = 100, source, since, workspace, exitCode } = options;
    let query = 'SELECT * FROM terminal_commands WHERE 1=1';
    const params = [];

    if (source) {
      query += ' AND source = ?';
      params.push(source);
    }

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }

    if (workspace) {
      query += ' AND workspace = ?';
      params.push(workspace);
    }

    if (exitCode !== undefined) {
      query += ' AND exit_code = ?';
      params.push(exitCode);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error querying terminal commands:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * Load all entries from the database
   */
  async getAllEntries() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM entries ORDER BY timestamp DESC`, (err, rows) => {
        if (err) {
          console.error('Error loading entries:', err);
          reject(err);
        } else {
          // Parse JSON fields
          const entries = rows.map((row) => ({
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : [],
            modelInfo: row.modelInfo ? JSON.parse(row.modelInfo) : null,
          }));
          resolve(entries);
        }
      });
    });
  }

  /**
   * Get total count of entries in database
   */
  async getTotalEntriesCount() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT COUNT(*) as count FROM entries`, [], (err, row) => {
        if (err) {
          console.error('Error counting entries:', err);
          reject(err);
        } else {
          resolve(row.count || 0);
        }
      });
    });
  }

  /**
   * Load recent entries from the database (with limit and offset for pagination)
   * OPTIMIZED: Uses database-level LIMIT/OFFSET instead of in-memory slicing
   */
  async getRecentEntries(limit = 500, entryId = null, offset = 0, workspace = null) {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        return await this.postgresAdapter.getRecentEntries(limit, entryId, offset, workspace);
      } catch (error) {
        console.error('[DB] Error getting recent entries from PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      let query, params;

      if (entryId !== null) {
        // Fetch specific entry by ID (used for TODO events) - OPTIMIZED with indexed lookup
        query = `
          SELECT
            id, session_id, workspace_path, file_path, source,
            notes, timestamp, tags, prompt_id, modelInfo, type
          FROM entries
          WHERE id = ?
          LIMIT 1
        `;
        params = [entryId];
      } else {
        // Exclude large fields (before_code, after_code) for performance
        // Only include metadata needed for activity list view
        // OPTIMIZATION: Use database-level LIMIT/OFFSET
        query = `
          SELECT
            id, session_id, workspace_path, file_path, source,
            notes, timestamp, tags, prompt_id, modelInfo, type
          FROM entries
        `;
        params = [];

        // Add workspace filter if provided
        if (workspace) {
          query += ` WHERE workspace_path = ?`;
          params.push(workspace);
        }

        query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error loading recent entries:', err);
          reject(err);
        } else {
          // Parse JSON fields
          const entries = rows.map((row) => ({
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : [],
            modelInfo: row.modelInfo ? JSON.parse(row.modelInfo) : null,
          }));
          resolve(entries);
        }
      });
    });
  }

  /**
   * Get entries within a time range (optionally filtered by workspace)
   */
  async getEntriesInTimeRange(since, until, workspacePath = null, limit = 100) {
    await this.init();

    return new Promise((resolve, reject) => {
      // Convert timestamps to ISO strings for TEXT column comparison
      const sinceISO = since ? new Date(since).toISOString() : null;
      const untilISO = until ? new Date(until).toISOString() : null;

      let query = `
        SELECT * FROM entries
        WHERE 1=1
      `;
      const params = [];

      if (sinceISO) {
        query += ` AND timestamp >= ?`;
        params.push(sinceISO);
      }
      if (untilISO) {
        query += ` AND timestamp <= ?`;
        params.push(untilISO);
      }

      if (workspacePath) {
        query += ` AND workspace_path = ?`;
        params.push(workspacePath);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error loading entries in time range:', err);
          reject(err);
        } else {
          const entries = rows.map((row) => ({
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : [],
            modelInfo: row.modelInfo ? JSON.parse(row.modelInfo) : null,
          }));
          resolve(entries);
        }
      });
    });
  }

  /**
   * Get entries with full code content (includes before_code and after_code)
   * Used for exports where structural edits are needed
   */
  async getEntriesWithCode(limit = 1000) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT
          id, session_id, workspace_path, file_path, source,
          before_code, after_code, notes, timestamp, tags, prompt_id, modelInfo, type
        FROM entries
        ORDER BY timestamp DESC
        LIMIT ?
      `,
        [limit],
        (err, rows) => {
          if (err) {
            console.error('Error loading entries with code:', err);
            reject(err);
          } else {
            // Parse JSON fields
            const entries = rows.map((row) => ({
              ...row,
              tags: row.tags ? JSON.parse(row.tags) : [],
              modelInfo: row.modelInfo ? JSON.parse(row.modelInfo) : null,
              before_content: row.before_code, // Alias for compatibility
              after_content: row.after_code, // Alias for compatibility
            }));
            resolve(entries);
          }
        }
      );
    });
  }

  /**
   * Get file contents for semantic analysis (includes after_code)
   */
  async getFileContents(limit = 500) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT
          id, file_path, after_code, timestamp
        FROM entries
        WHERE after_code IS NOT NULL
          AND after_code != ''
          AND file_path NOT LIKE '%.git/%'
        ORDER BY timestamp DESC
        LIMIT ?
      `,
        [limit],
        (err, rows) => {
          if (err) {
            console.error('Error loading file contents:', err);
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  /**
   * Load recent prompts from the database (with limit and offset for pagination)
   * OPTIMIZED: Uses database-level LIMIT/OFFSET instead of in-memory slicing
   */
  async getRecentPrompts(limit = 200, offset = 0, workspace = null) {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        return await this.postgresAdapter.getRecentPrompts(limit, offset, workspace);
      } catch (error) {
        console.error('[DB] Error getting recent prompts from PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      // OPTIMIZED: Use indexed columns only for faster query
      // Select only essential columns for initial load (avoid loading huge TEXT fields)
      let query = `SELECT
        id, timestamp, status, linked_entry_id, source,
        workspace_id, workspace_path, workspace_name, composer_id,
        subtitle, lines_added, lines_removed, context_usage,
        mode, model_type, model_name, force_mode, is_auto, type, confidence,
        added_from_database, conversation_id, conversation_index,
        conversation_title, message_role, parent_conversation_id,
        SUBSTR(text, 1, 500) as text
      FROM prompts`;
      const params = [];

      // Add workspace filter if provided (uses indexed column)
      if (workspace) {
        query += ` WHERE workspace_path = ?`;
        params.push(workspace);
      }

      // OPTIMIZED: Use indexed timestamp DESC for fast recent items
      query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error loading recent prompts:', err);
          reject(err);
        } else {
          // Map database column names (snake_case) to camelCase
          const mapped = rows.map((row) => this._mapPromptRow(row));
          resolve(mapped);
        }
      });
    });
  }

  /**
   * Map database row (snake_case) to camelCase object
   */
  _mapPromptRow(row) {
    return {
      ...row,
      // Map snake_case to camelCase
      linesAdded: row.lines_added,
      linesRemoved: row.lines_removed,
      contextUsage: row.context_usage,
      workspaceId: row.workspace_id,
      workspacePath: row.workspace_path,
      workspaceName: row.workspace_name,
      composerId: row.composer_id,
      modelType: row.model_type,
      modelName: row.model_name,
      forceMode: row.force_mode,
      isAuto: row.is_auto === 1 || row.is_auto === true,
      linkedEntryId: row.linked_entry_id,
      addedFromDatabase: row.added_from_database === 1 || row.added_from_database === true,
      // Context files
      contextFilesJson: row.context_files_json,
      contextFileCount: row.context_file_count,
      contextFileCountExplicit: row.context_file_count_explicit,
      contextFileCountTabs: row.context_file_count_tabs,
      contextFileCountAuto: row.context_file_count_auto,
      // Thinking time
      thinkingTime: row.thinking_time,
      thinkingTimeSeconds: row.thinking_time_seconds,
      // Terminal blocks
      terminalBlocksJson: row.terminal_blocks_json,
      terminalBlockCount: row.terminal_block_count,
      // Attachments
      hasAttachments: row.has_attachments === 1 || row.has_attachments === true,
      attachmentCount: row.attachment_count,
      // Threading
      conversationTitle: row.conversation_title,
      messageRole: row.message_role,
      parentConversationId: row.parent_conversation_id,
      // Parse JSON fields if present
      contextFiles: row.context_files_json ? JSON.parse(row.context_files_json) : [],
      terminalBlocks: row.terminal_blocks_json ? JSON.parse(row.terminal_blocks_json) : [],
    };
  }

  /**
   * Get maximum IDs from tables (for setting nextId without loading all data)
   */
  async getMaxIds() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(
        `
        SELECT
          (SELECT COALESCE(MAX(id), 0) FROM entries) as entryId,
          (SELECT COALESCE(MAX(id), 0) FROM prompts) as promptId
      `,
        (err, row) => {
          if (err) {
            console.error('Error getting max IDs:', err);
            reject(err);
          } else {
            resolve(row || { entryId: 0, promptId: 0 });
          }
        }
      );
    });
  }

  /**
   * Get prompts within a time range (for linking)
   */
  async getPromptsInTimeRange(since, until, limit = 100) {
    await this.init();

    return new Promise((resolve, reject) => {
      // Convert timestamps to ISO strings for TEXT column comparison
      const sinceISO = since ? new Date(since).toISOString() : null;
      const untilISO = until ? new Date(until).toISOString() : null;

      let query = `
        SELECT * FROM prompts
        WHERE 1=1
      `;
      const params = [];

      if (sinceISO) {
        query += ` AND timestamp >= ?`;
        params.push(sinceISO);
      }
      if (untilISO) {
        query += ` AND timestamp <= ?`;
        params.push(untilISO);
      }

      query += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error loading prompts in time range:', err);
          reject(err);
        } else {
          const mapped = rows.map((row) => this._mapPromptRow(row));
          resolve(mapped);
        }
      });
    });
  }

  /**
   * Load all prompts from the database
   */
  async getAllPrompts() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM prompts ORDER BY timestamp DESC`, (err, rows) => {
        if (err) {
          console.error('Error loading prompts:', err);
          reject(err);
        } else {
          // Map database column names (snake_case) to camelCase
          const mapped = rows.map((row) => this._mapPromptRow(row));
          resolve(mapped);
        }
      });
    });
  }

  /**
   * Load all events from the database
   */
  async getAllEvents() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(`SELECT * FROM events ORDER BY timestamp DESC`, (err, rows) => {
        if (err) {
          console.error('Error loading events:', err);
          reject(err);
        } else {
          resolve(
            rows.map((row) => ({
              ...row,
              details: row.details ? JSON.parse(row.details) : {},
              tags: row.tags ? JSON.parse(row.tags || '[]') : [],
              ai_generated: row.ai_generated === 1,
              // annotation field is already a string, no parsing needed
            }))
          );
        }
      });
    });
  }

  /**
   * Update an entry
   */
  async updateEntry(id, updates) {
    await this.init();

    const fields = Object.keys(updates)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = Object.values(updates);

    return new Promise((resolve, reject) => {
      this.db.run(`UPDATE entries SET ${fields} WHERE id = ?`, [...values, id], (err) => {
        if (err) {
          console.error('Error updating entry:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Update a prompt
   */
  async updatePrompt(id, updates) {
    await this.init();

    const fields = Object.keys(updates)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = Object.values(updates);

    return new Promise((resolve, reject) => {
      this.db.run(`UPDATE prompts SET ${fields} WHERE id = ?`, [...values, id], (err) => {
        if (err) {
          console.error('Error updating prompt:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get database statistics with linking information
   */
  async getStats() {
    await this.init();

    // Use PostgreSQL adapter if available
    if (this.postgresAdapter) {
      try {
        return await this.postgresAdapter.getStats();
      } catch (error) {
        console.error('[DB] Error getting stats from PostgreSQL:', error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      this.db.get(
        `
        SELECT
          (SELECT COUNT(*) FROM entries) as entries,
          (SELECT COUNT(*) FROM prompts) as prompts,
          (SELECT COUNT(*) FROM events) as events,
          (SELECT COUNT(*) FROM entries WHERE prompt_id IS NOT NULL) as linked_entries,
          (SELECT COUNT(*) FROM prompts WHERE linked_entry_id IS NOT NULL) as linked_prompts,
          (SELECT COUNT(DISTINCT session_id) FROM entries WHERE session_id IS NOT NULL) as unique_sessions
      `,
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            // Calculate percentages
            row.linked_entries_percent =
              row.entries > 0 ? ((row.linked_entries / row.entries) * 100).toFixed(2) : 0;
            row.linked_prompts_percent =
              row.prompts > 0 ? ((row.linked_prompts / row.prompts) * 100).toFixed(2) : 0;
            resolve(row);
          }
        }
      );
    });
  }

  /**
   * Get entries with their linked prompts
   */
  async getEntriesWithPrompts(limit = 100) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT
          e.*,
          p.text as prompt_text,
          p.status as prompt_status,
          p.mode as prompt_mode,
          p.model_name as prompt_model,
          p.lines_added as prompt_lines_added,
          p.lines_removed as prompt_lines_removed
        FROM entries e
        LEFT JOIN prompts p ON e.prompt_id = p.id
        ORDER BY e.timestamp DESC
        LIMIT ?
      `,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  /**
   * Get prompts with their linked entries
   */
  async getPromptsWithEntries(limit = 100) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT
          p.*,
          e.file_path as entry_file_path,
          e.timestamp as entry_timestamp,
          e.source as entry_source
        FROM prompts p
        LEFT JOIN entries e ON p.linked_entry_id = e.id
        ORDER BY p.timestamp DESC
        LIMIT ?
      `,
        [limit],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  /**
   * Get prompts that have linked_entry_id (for repair function)
   */
  async getPromptsWithLinkedEntries() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT * FROM prompts
        WHERE linked_entry_id IS NOT NULL
        ORDER BY timestamp DESC
      `,
        (err, rows) => {
          if (err) {
            console.error('Error loading prompts with linked entries:', err);
            reject(err);
          } else {
            const mapped = rows.map((row) => this._mapPromptRow(row));
            resolve(mapped);
          }
        }
      );
    });
  }

  /**
   * Get entry by ID (handles both numeric and UUID string IDs)
   */
  async getEntryById(entryId) {
    await this.init();

    return new Promise((resolve, reject) => {
      // Try both numeric ID and string ID (UUID)
      const query =
        typeof entryId === 'number'
          ? `SELECT * FROM entries WHERE id = ?`
          : `SELECT * FROM entries WHERE id = ? OR CAST(id AS TEXT) = ?`;
      const params = typeof entryId === 'number' ? [entryId] : [entryId, entryId];

      this.db.get(query, params, (err, row) => {
        if (err) {
          console.error('Error loading entry by ID:', err);
          reject(err);
        } else {
          if (!row) {
            resolve(null);
            return;
          }
          // Parse JSON fields
          const entry = {
            ...row,
            tags: row.tags ? JSON.parse(row.tags) : [],
            modelInfo: row.modelInfo ? JSON.parse(row.modelInfo) : null,
          };
          resolve(entry);
        }
      });
    });
  }

  /**
   * Validate database integrity
   */
  async validateIntegrity() {
    await this.init();

    return new Promise((resolve, reject) => {
      const checks = {
        orphaned_entry_prompts: 0,
        orphaned_prompt_entries: 0,
        null_timestamps: 0,
        duplicate_ids: 0,
      };

      // Check for orphaned references
      this.db.get(
        `
        SELECT COUNT(*) as count
        FROM entries
        WHERE prompt_id IS NOT NULL
          AND prompt_id NOT IN (SELECT id FROM prompts)
      `,
        (err, row) => {
          if (err) return reject(err);
          checks.orphaned_entry_prompts = row.count;

          this.db.get(
            `
          SELECT COUNT(*) as count
          FROM prompts
          WHERE linked_entry_id IS NOT NULL
            AND linked_entry_id NOT IN (SELECT id FROM entries)
        `,
            (err2, row2) => {
              if (err2) return reject(err2);
              checks.orphaned_prompt_entries = row2.count;

              // Check for null timestamps
              this.db.get(
                `
            SELECT
              (SELECT COUNT(*) FROM entries WHERE timestamp IS NULL) +
              (SELECT COUNT(*) FROM prompts WHERE timestamp IS NULL) +
              (SELECT COUNT(*) FROM events WHERE timestamp IS NULL) as count
          `,
                (err3, row3) => {
                  if (err3) return reject(err3);
                  checks.null_timestamps = row3.count;

                  resolve({
                    valid:
                      checks.orphaned_entry_prompts === 0 &&
                      checks.orphaned_prompt_entries === 0 &&
                      checks.null_timestamps === 0,
                    checks,
                  });
                }
              );
            }
          );
        }
      );
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('[SAVE] Database connection closed');
        }
      });
    }
  }
  /**
   * Save a context snapshot to the database
   */
  async saveContextSnapshot(snapshot) {
    await this.init();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO context_snapshots
        (prompt_id, timestamp, file_count, token_estimate, truncated, utilization_percent, context_files, at_mentions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        snapshot.promptId || null,
        snapshot.timestamp,
        snapshot.fileCount || 0,
        snapshot.tokenEstimate || 0,
        snapshot.truncated ? 1 : 0,
        snapshot.utilizationPercent || 0,
        JSON.stringify(snapshot.contextFiles || []),
        JSON.stringify(snapshot.atMentions || [])
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error saving context snapshot:', err);
          reject(err);
        } else {
          resolve(snapshot);
        }
      });
    });
  }

  /**
   * Get context snapshots with optional filtering
   */
  async getContextSnapshots(options = {}) {
    await this.init();

    const { limit = 100, since = 0 } = options;

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM context_snapshots
         WHERE timestamp >= ?
         ORDER BY timestamp DESC
         LIMIT ?`,
        [since, limit],
        (err, rows) => {
          if (err) {
            console.error('Error fetching context snapshots:', err);
            reject(err);
          } else {
            const snapshots = rows.map((row) => ({
              id: row.id,
              promptId: row.prompt_id,
              timestamp: row.timestamp,
              fileCount: row.file_count,
              tokenEstimate: row.token_estimate,
              truncated: row.truncated === 1,
              utilizationPercent: row.utilization_percent,
              contextFiles: JSON.parse(row.context_files || '[]'),
              atMentions: JSON.parse(row.at_mentions || '[]'),
              createdAt: row.created_at,
            }));
            resolve(snapshots);
          }
        }
      );
    });
  }

  /**
   * Get context analytics from stored snapshots
   */
  async getContextAnalytics() {
    await this.init();

    return new Promise((resolve, reject) => {
      // Get all context snapshots with actual data
      this.db.all(
        `SELECT context_files, at_mentions FROM context_snapshots
         WHERE (context_files IS NOT NULL AND context_files != '[]')
            OR (at_mentions IS NOT NULL AND at_mentions != '[]')`,
        (err, rows) => {
          if (err) {
            console.error('Error fetching context analytics:', err);
            reject(err);
            return;
          }

          let totalAtFiles = 0;
          let totalContextFiles = 0;
          let totalUIStates = 0;
          const atFileSet = new Set();

          rows.forEach((row) => {
            try {
              // Count @ mentions
              if (row.at_mentions) {
                const mentions = JSON.parse(row.at_mentions);
                if (Array.isArray(mentions)) {
                  totalAtFiles += mentions.length;
                  mentions.forEach((m) => atFileSet.add(m));
                }
              }

              // Count context files
              if (row.context_files) {
                const files = JSON.parse(row.context_files);
                if (Array.isArray(files)) {
                  totalContextFiles += files.length;
                } else if (files.attachedFiles || files.codebaseFiles) {
                  totalContextFiles +=
                    (files.attachedFiles?.length || 0) + (files.codebaseFiles?.length || 0);
                }
              }
            } catch (e) {
              // Skip malformed JSON
            }
          });

          resolve({
            totalAtFiles,
            totalContextFiles,
            totalUIStates,
            withContext: rows.length,
            uniqueAtFiles: atFileSet.size,
            totalSnapshots: rows.length,
          });
        }
      );
    });
  }

  /**
   * Save a context change record to the database
   */
  async saveContextChange(changeRecord) {
    await this.init();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO context_changes
        (id, prompt_id, event_id, task_id, session_id, timestamp,
         previous_file_count, current_file_count, added_files, removed_files,
         unchanged_files, net_change, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        changeRecord.id,
        changeRecord.promptId || null,
        changeRecord.eventId || null,
        changeRecord.taskId || null,
        changeRecord.sessionId || null,
        changeRecord.timestamp,
        changeRecord.previousFileCount || 0,
        changeRecord.currentFileCount || 0,
        JSON.stringify(changeRecord.addedFiles || []),
        JSON.stringify(changeRecord.removedFiles || []),
        JSON.stringify(changeRecord.unchangedFiles || []),
        changeRecord.netChange || 0,
        JSON.stringify(changeRecord.metadata || {})
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error saving context change:', err);
          reject(err);
        } else {
          resolve(changeRecord);
        }
      });
    });
  }

  /**
   * Get context changes with optional filtering
   */
  async getContextChanges(options = {}) {
    await this.init();

    const {
      promptId = null,
      eventId = null,
      taskId = null,
      sessionId = null,
      startTime = null,
      endTime = null,
      limit = 100,
    } = options;

    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM context_changes WHERE 1=1';
      const params = [];

      if (promptId) {
        query += ' AND prompt_id = ?';
        params.push(promptId);
      }

      if (eventId) {
        query += ' AND event_id = ?';
        params.push(eventId);
      }

      if (taskId) {
        query += ' AND task_id = ?';
        params.push(taskId);
      }

      if (sessionId) {
        query += ' AND session_id = ?';
        params.push(sessionId);
      }

      if (startTime) {
        query += ' AND timestamp >= ?';
        params.push(startTime);
      }

      if (endTime) {
        query += ' AND timestamp <= ?';
        params.push(endTime);
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error fetching context changes:', err);
          reject(err);
        } else {
          const changes = rows.map((row) => ({
            id: row.id,
            promptId: row.prompt_id,
            eventId: row.event_id,
            taskId: row.task_id,
            sessionId: row.session_id,
            timestamp: row.timestamp,
            previousFileCount: row.previous_file_count,
            currentFileCount: row.current_file_count,
            addedFiles: JSON.parse(row.added_files || '[]'),
            removedFiles: JSON.parse(row.removed_files || '[]'),
            unchangedFiles: JSON.parse(row.unchanged_files || '[]'),
            netChange: row.net_change,
            metadata: JSON.parse(row.metadata || '{}'),
            createdAt: row.created_at,
          }));
          resolve(changes);
        }
      });
    });
  }

  // ===================================
  // SCHEMA MANAGEMENT METHODS
  // ===================================

  /**
   * Get database schema information
   */
  async getSchema() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
        (err, tables) => {
          if (err) {
            console.error('Error fetching schema:', err);
            reject(err);
            return;
          }

          const schema = {
            tables: [],
            version: '1.0.0',
            timestamp: Date.now(),
          };

          // Get details for each table
          const tablePromises = tables.map((table) => {
            return new Promise((res, rej) => {
              this.db.all(`PRAGMA table_info(${table.name})`, (tableErr, columns) => {
                if (tableErr) {
                  rej(tableErr);
                } else {
                  res({
                    name: table.name,
                    columns: columns.map((col) => ({
                      name: col.name,
                      type: col.type,
                      notnull: col.notnull === 1,
                      defaultValue: col.dflt_value,
                      primaryKey: col.pk === 1,
                    })),
                  });
                }
              });
            });
          });

          Promise.all(tablePromises)
            .then((tableDetails) => {
              schema.tables = tableDetails;
              resolve(schema);
            })
            .catch(reject);
        }
      );
    });
  }

  /**
   * Get table schema
   */
  async getTableSchema(tableName) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
        if (err) {
          console.error(`Error fetching table schema for ${tableName}:`, err);
          reject(err);
        } else {
          resolve({
            name: tableName,
            columns: columns.map((col) => ({
              name: col.name,
              type: col.type,
              notnull: col.notnull === 1,
              defaultValue: col.dflt_value,
              primaryKey: col.pk === 1,
            })),
          });
        }
      });
    });
  }

  /**
   * Add a column to an existing table (uses safe helper)
   * @deprecated Use SchemaHelpers.safeAddColumn instead for better safety
   */
  async addColumn(tableName, columnDef) {
    const SchemaHelpers = require('./schema-helpers.js');
    const helpers = new SchemaHelpers(this);

    const { name, type, notnull = false, defaultValue = null } = columnDef;

    return helpers.safeAddColumn(tableName, name, type, {
      notNull: notnull,
      defaultValue,
    });
  }

  /**
   * Get schema helpers instance for safe schema operations
   */
  getSchemaHelpers() {
    const SchemaHelpers = require('./schema-helpers.js');
    return new SchemaHelpers(this);
  }

  /**
   * Create a custom field configuration
   * This stores metadata about custom fields without modifying the schema
   * Supports workspace scoping: workspace_id can be null for global configs
   */
  async saveCustomFieldConfig(config) {
    await this.init();

    // Create a table to store custom field configurations if it doesn't exist
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        CREATE TABLE IF NOT EXISTS schema_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          table_name TEXT NOT NULL,
          field_name TEXT NOT NULL,
          field_type TEXT NOT NULL,
          display_name TEXT,
          description TEXT,
          enabled INTEGER DEFAULT 1,
          config_json TEXT,
          workspace_id TEXT,
          workspace_path TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(table_name, field_name, workspace_id)
        )
      `,
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Add workspace columns using safe helper
          const SchemaHelpers = require('./schema-helpers.js');
          const helpers = new SchemaHelpers(this);

          helpers
            .safeAddColumns(
              'schema_config',
              [
                { name: 'workspace_id', type: 'TEXT' },
                { name: 'workspace_path', type: 'TEXT' },
              ],
              true
            )
            .then(() => {
              // Handle uniqueness: SQLite UNIQUE constraint allows multiple NULLs,
              // so we need to explicitly delete existing configs before inserting
              // This ensures only one config exists per (table_name, field_name, workspace_id) combination
              const workspaceId = config.workspaceId || null;

              // Delete existing config with same table, field, and workspace (including NULL for global)
              let deleteQuery = 'DELETE FROM schema_config WHERE table_name = ? AND field_name = ?';
              const deleteParams = [config.tableName, config.fieldName];

              if (workspaceId === null) {
                // Delete global configs (workspace_id IS NULL)
                deleteQuery += ' AND workspace_id IS NULL';
              } else {
                // Delete workspace-specific config
                deleteQuery += ' AND workspace_id = ?';
                deleteParams.push(workspaceId);
              }

              this.db.run(deleteQuery, deleteParams, (deleteErr) => {
                if (deleteErr) {
                  console.warn('Error deleting existing config before insert:', deleteErr);
                  // Continue anyway - INSERT OR REPLACE will handle it
                }

                // Now insert the new configuration
                const insertStmt = this.db.prepare(`
              INSERT INTO schema_config
              (table_name, field_name, field_type, display_name, description, enabled, config_json, workspace_id, workspace_path, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);

                insertStmt.run(
                  config.tableName,
                  config.fieldName,
                  config.fieldType,
                  config.displayName || config.fieldName,
                  config.description || '',
                  config.enabled !== false ? 1 : 0,
                  JSON.stringify(config.config || {}),
                  workspaceId,
                  config.workspacePath || null,
                  (insertErr) => {
                    if (insertErr) {
                      reject(insertErr);
                    } else {
                      insertStmt.finalize((finalizeErr) => {
                        if (finalizeErr) {
                          reject(finalizeErr);
                        } else {
                          resolve({ success: true, config });
                        }
                      });
                    }
                  }
                );
              });
            });
        }
      );
    });
  }

  /**
   * Get custom field configurations
   * Returns workspace-specific configs first, then falls back to global (workspace_id IS NULL) configs
   * @param {string|null} tableName - Optional table name filter
   * @param {string|null} workspaceId - Optional workspace ID to filter by
   * @param {boolean} includeGlobal - Whether to include global configs when workspaceId is provided (default: true)
   */
  async getCustomFieldConfigs(tableName = null, workspaceId = null, includeGlobal = true) {
    await this.init();

    return new Promise((resolve, reject) => {
      // Build query with workspace-aware logic
      // Priority: workspace-specific configs override global configs
      let query = `
        SELECT * FROM schema_config
        WHERE 1=1
      `;
      const params = [];

      if (tableName) {
        query += ' AND table_name = ?';
        params.push(tableName);
      }

      if (workspaceId) {
        if (includeGlobal) {
          // Get workspace-specific OR global (NULL) configs
          query += ' AND (workspace_id = ? OR workspace_id IS NULL)';
          params.push(workspaceId);
        } else {
          // Only workspace-specific configs
          query += ' AND workspace_id = ?';
          params.push(workspaceId);
        }
      } else {
        // If no workspace specified, get all configs (workspace-specific + global)
        // This maintains backward compatibility
      }

      query += ' ORDER BY table_name, field_name, workspace_id IS NULL, workspace_id';
      // This ordering ensures workspace-specific configs come before global ones

      this.db.all(query, params, (err, rows) => {
        if (err) {
          console.error('Error fetching custom field configs:', err);
          reject(err);
        } else {
          // Deduplicate: if both workspace-specific and global configs exist for same table+field,
          // prefer workspace-specific
          const configMap = new Map();

          rows.forEach((row) => {
            const key = `${row.table_name}:${row.field_name}`;
            const existing = configMap.get(key);

            // Prefer workspace-specific over global
            if (!existing || (row.workspace_id && !existing.workspaceId)) {
              configMap.set(key, {
                id: row.id,
                tableName: row.table_name,
                fieldName: row.field_name,
                fieldType: row.field_type,
                displayName: row.display_name,
                description: row.description,
                enabled: row.enabled === 1,
                config: JSON.parse(row.config_json || '{}'),
                workspaceId: row.workspace_id || null,
                workspacePath: row.workspace_path || null,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              });
            }
          });

          const configs = Array.from(configMap.values());
          resolve(configs);
        }
      });
    });
  }

  /**
   * Delete a custom field configuration
   * @param {string} tableName - Table name
   * @param {string} fieldName - Field name
   * @param {string|null} workspaceId - Optional workspace ID. If provided, only deletes workspace-specific config.
   *                                    If null, deletes global config or all matching configs if workspaceId not specified.
   */
  async deleteCustomFieldConfig(tableName, fieldName, workspaceId = null) {
    await this.init();

    return new Promise((resolve, reject) => {
      let query = 'DELETE FROM schema_config WHERE table_name = ? AND field_name = ?';
      const params = [tableName, fieldName];

      if (workspaceId !== null && workspaceId !== undefined) {
        // Delete only workspace-specific config
        query += ' AND workspace_id = ?';
        params.push(workspaceId);
      } else {
        // If workspaceId is null, delete global config (workspace_id IS NULL)
        // This allows deleting global configs explicitly
        query += ' AND workspace_id IS NULL';
      }

      this.db.run(query, params, (err) => {
        if (err) {
          console.error('Error deleting custom field config:', err);
          reject(err);
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  // ===================================
  // STATUS MESSAGE TRACKING METHODS
  // ===================================

  /**
   * Save a status message record
   */
  async saveStatusMessage(statusRecord) {
    await this.init();

    // Create status_messages table if it doesn't exist
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        CREATE TABLE IF NOT EXISTS status_messages (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          message TEXT NOT NULL,
          type TEXT,
          action TEXT,
          file_path TEXT,
          file_name TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `,
        (err) => {
          if (err && !err.message.includes('already exists')) {
            reject(err);
            return;
          }

          // Insert status message
          const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO status_messages
          (id, timestamp, message, type, action, file_path, file_name, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

          stmt.run(
            statusRecord.id,
            statusRecord.timestamp,
            statusRecord.message,
            statusRecord.type || null,
            statusRecord.action || null,
            statusRecord.filePath || null,
            statusRecord.fileName || null,
            JSON.stringify(statusRecord.metadata || {})
          );

          stmt.finalize((finalizeErr) => {
            if (finalizeErr) {
              reject(finalizeErr);
            } else {
              resolve({ success: true, statusRecord });
            }
          });
        }
      );
    });
  }

  /**
   * Get status messages with optional filtering
   */
  async getStatusMessages(options = {}) {
    await this.init();

    const { startTime = null, endTime = null, type = null, action = null, limit = 100 } = options;

    return new Promise((resolve, reject) => {
      // Check if table exists first
      this.db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='status_messages'",
        (tableErr, tableRow) => {
          if (tableErr) {
            console.error('Error checking status_messages table:', tableErr);
            reject(tableErr);
            return;
          }

          // If table doesn't exist, return empty array
          if (!tableRow) {
            console.warn(
              '[STATUS-MESSAGES] Table status_messages does not exist, returning empty array'
            );
            resolve([]);
            return;
          }

          let query = 'SELECT * FROM status_messages WHERE 1=1';
          const params = [];

          if (startTime) {
            query += ' AND timestamp >= ?';
            params.push(startTime);
          }

          if (endTime) {
            query += ' AND timestamp <= ?';
            params.push(endTime);
          }

          if (type) {
            query += ' AND type = ?';
            params.push(type);
          }

          if (action) {
            query += ' AND action = ?';
            params.push(action);
          }

          query += ' ORDER BY timestamp DESC LIMIT ?';
          params.push(limit);

          this.db.all(query, params, (err, rows) => {
            if (err) {
              console.error('Error fetching status messages:', err);
              reject(err);
            } else {
              const messages = rows.map((row) => {
                try {
                  return {
                    id: row.id,
                    timestamp: row.timestamp,
                    message: row.message,
                    type: row.type,
                    action: row.action,
                    filePath: row.file_path,
                    fileName: row.file_name,
                    metadata: JSON.parse(row.metadata || '{}'),
                    createdAt: row.created_at,
                  };
                } catch (parseErr) {
                  console.warn('[STATUS-MESSAGES] Error parsing row metadata:', parseErr);
                  return {
                    id: row.id,
                    timestamp: row.timestamp,
                    message: row.message,
                    type: row.type,
                    action: row.action,
                    filePath: row.file_path,
                    fileName: row.file_name,
                    metadata: {},
                    createdAt: row.created_at,
                  };
                }
              });
              resolve(messages);
            }
          });
        }
      );
    });
  }

  /**
   * Link status message to context change
   */
  async linkStatusToContextChange(statusId, contextChangeId) {
    await this.init();

    // Create linking table if it doesn't exist
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        CREATE TABLE IF NOT EXISTS status_context_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status_id TEXT NOT NULL,
          context_change_id TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(status_id, context_change_id)
        )
      `,
        (err) => {
          if (err && !err.message.includes('already exists')) {
            reject(err);
            return;
          }

          const stmt = this.db.prepare(`
          INSERT OR IGNORE INTO status_context_links (status_id, context_change_id)
          VALUES (?, ?)
        `);

          stmt.run(statusId, contextChangeId, (runErr) => {
            if (runErr) {
              reject(runErr);
            } else {
              resolve({ success: true });
            }
          });

          stmt.finalize();
        }
      );
    });
  }

  // ===================================
  // TODO TRACKING METHODS
  // ===================================

  /**
   * Save a new TODO
   */
  async saveTodo(todo) {
    await this.init();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO todos (
          content, status, created_at, order_index, session_id,
          prompts_while_active, files_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        todo.content,
        todo.status || 'pending',
        todo.created_at || Date.now(),
        todo.order_index || 0,
        todo.session_id || this._getCurrentSessionId(),
        JSON.stringify(todo.prompts_while_active || []),
        JSON.stringify(todo.files_modified || []),
        function (err) {
          if (err) {
            console.error('Error saving todo:', err);
            reject(err);
          } else {
            console.log(`[TODO] Saved: "${todo.content}" (ID: ${this.lastID})`);
            resolve(this.lastID);
          }
        }
      );
      stmt.finalize();
    });
  }

  /**
   * Update TODO status
   */
  async updateTodoStatus(todoId, status) {
    await this.init();

    const updates = { status };
    const now = Date.now();

    // Get current todo to check if started_at exists
    const todo = await this._getTodo(todoId);

    if (status === 'in_progress' && !todo.started_at) {
      updates.started_at = now;
    } else if (status === 'completed' && !todo.completed_at) {
      updates.completed_at = now;
    }

    return new Promise((resolve, reject) => {
      const fields = Object.keys(updates)
        .map((k) => `${k} = ?`)
        .join(', ');
      const values = Object.values(updates);

      this.db.run(`UPDATE todos SET ${fields} WHERE id = ?`, [...values, todoId], (err) => {
        if (err) {
          console.error('Error updating todo status:', err);
          reject(err);
        } else {
          console.log(`[TODO] Updated status for ID ${todoId}: ${status}`);
          resolve();
        }
      });
    });
  }

  /**
   * Get active TODO (in_progress)
   */
  async getActiveTodo() {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM todos WHERE status = 'in_progress' ORDER BY started_at DESC LIMIT 1`,
        (err, row) => {
          if (err) {
            console.error('Error getting active todo:', err);
            reject(err);
          } else {
            resolve(row ? this._mapTodoRow(row) : null);
          }
        }
      );
    });
  }

  /**
   * Get all TODOs for current session
   */
  async getCurrentSessionTodos() {
    await this.init();

    const sessionId = this._getCurrentSessionId();

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM todos WHERE session_id = ? ORDER BY order_index ASC, created_at ASC`,
        [sessionId],
        (err, rows) => {
          if (err) {
            console.error('Error getting session todos:', err);
            reject(err);
          } else {
            resolve(rows ? rows.map((r) => this._mapTodoRow(r)) : []);
          }
        }
      );
    });
  }

  /**
   * Link event to active TODO
   */
  async linkEventToTodo(eventType, eventId) {
    await this.init();

    const activeTodo = await this.getActiveTodo();
    if (!activeTodo) return null;

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO todo_events (todo_id, event_type, event_id, timestamp) VALUES (?, ?, ?, ?)`,
        [activeTodo.id, eventType, eventId, Date.now()],
        function (err) {
          if (err) {
            console.error('Error linking event to todo:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  /**
   * Add prompt to TODO's active prompts list
   */
  async addPromptToTodo(todoId, promptId) {
    await this.init();

    const todo = await this._getTodo(todoId);
    if (!todo) return;

    const prompts = JSON.parse(todo.prompts_while_active || '[]');
    if (!prompts.includes(promptId)) {
      prompts.push(promptId);

      return new Promise((resolve, reject) => {
        this.db.run(
          `UPDATE todos SET prompts_while_active = ? WHERE id = ?`,
          [JSON.stringify(prompts), todoId],
          (err) => {
            if (err) {
              console.error('Error adding prompt to todo:', err);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    }
  }

  /**
   * Add file to TODO's modified files list
   */
  async addFileToTodo(todoId, filePath) {
    await this.init();

    const todo = await this._getTodo(todoId);
    if (!todo) return;

    const files = JSON.parse(todo.files_modified || '[]');
    if (!files.includes(filePath)) {
      files.push(filePath);

      return new Promise((resolve, reject) => {
        this.db.run(
          `UPDATE todos SET files_modified = ? WHERE id = ?`,
          [JSON.stringify(files), todoId],
          (err) => {
            if (err) {
              console.error('Error adding file to todo:', err);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    }
  }

  /**
   * Get events for a TODO
   */
  async getTodoEvents(todoId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM todo_events WHERE todo_id = ? ORDER BY timestamp ASC`,
        [todoId],
        (err, rows) => {
          if (err) {
            console.error('Error getting todo events:', err);
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }

  /**
   * Get TODO by ID
   */
  async getTodoById(todoId) {
    await this.init();

    const todo = await this._getTodo(todoId);
    return todo ? this._mapTodoRow(todo) : null;
  }

  /**
   * Get prompt by ID (helper for enriching todo events)
   */
  async getPromptById(promptId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM prompts WHERE id = ?`, [promptId], (err, row) => {
        if (err) {
          console.error('Error getting prompt by ID:', err);
          reject(err);
        } else {
          resolve(row ? this._mapPromptRow(row) : null);
        }
      });
    });
  }

  /**
   * Helper: Map TODO row to camelCase object
   */
  _mapTodoRow(row) {
    return {
      id: row.id,
      content: row.content,
      status: row.status,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      orderIndex: row.order_index,
      sessionId: row.session_id,
      promptsWhileActive: JSON.parse(row.prompts_while_active || '[]'),
      filesModified: JSON.parse(row.files_modified || '[]'),
    };
  }

  /**
   * Helper: Get TODO from database
   */
  _getTodo(todoId) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM todos WHERE id = ?`, [todoId], (err, row) => {
        if (err) {
          console.error('Error getting todo:', err);
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  /**
   * Helper: Get current session ID (date-based)
   */
  _getCurrentSessionId() {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * Save or update a conversation
   */
  async saveConversation(conversation) {
    await this.init();

    return new Promise((resolve, reject) => {
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO conversations
        (id, workspace_id, workspace_path, title, status, tags, metadata,
         created_at, updated_at, last_message_at, message_count)
        VALUES (?, ?, ?, ?, ?, ?, ?,
                COALESCE(?, ?), ?, ?, ?)
      `);

      // If updating, preserve original created_at
      this.db.get(
        `SELECT created_at FROM conversations WHERE id = ?`,
        [conversation.id],
        (err, row) => {
          const createdAt = row ? row.created_at : now;

          stmt.run(
            conversation.id,
            conversation.workspaceId || conversation.workspace_id,
            conversation.workspacePath || conversation.workspace_path,
            conversation.title,
            conversation.status || 'active',
            conversation.tags ? JSON.stringify(conversation.tags) : null,
            conversation.metadata ? JSON.stringify(conversation.metadata) : null,
            createdAt,
            now,
            conversation.lastMessageAt || conversation.last_message_at || now,
            conversation.messageCount || conversation.message_count || 0
          );

          stmt.finalize((finalErr) => {
            if (finalErr) {
              console.error('Error saving conversation:', finalErr);
              reject(finalErr);
            } else {
              resolve(conversation);
            }
          });
        }
      );
    });
  }

  /**
   * Update conversation metadata (title, last message time, message count)
   */
  async updateConversationMetadata(conversationId, workspaceId, workspacePath, title) {
    await this.init();

    return new Promise((resolve, reject) => {
      // Get current message count
      this.db.get(
        `SELECT COUNT(*) as count FROM prompts WHERE conversation_id = ?`,
        [conversationId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          const messageCount = row ? row.count : 0;
          const now = new Date().toISOString();

          // Get or create conversation
          this.db.get(
            `SELECT * FROM conversations WHERE id = ?`,
            [conversationId],
            (getErr, existing) => {
              if (getErr) {
                reject(getErr);
                return;
              }

              if (existing) {
                // Update existing
                this.db.run(
                  `UPDATE conversations SET
                   title = COALESCE(?, title),
                   workspace_path = COALESCE(?, workspace_path),
                   last_message_at = ?,
                   message_count = ?,
                   updated_at = ?
                   WHERE id = ?`,
                  [title, workspacePath, now, messageCount, now, conversationId],
                  (updateErr) => {
                    if (updateErr) reject(updateErr);
                    else resolve();
                  }
                );
              } else {
                // Create new conversation
                this.db.run(
                  `INSERT INTO conversations
                   (id, workspace_id, workspace_path, title, status, created_at, updated_at, last_message_at, message_count)
                   VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
                  [conversationId, workspaceId, workspacePath, title, now, now, now, messageCount],
                  (insertErr) => {
                    if (insertErr) reject(insertErr);
                    else resolve();
                  }
                );
              }
            }
          );
        }
      );
    });
  }

  /**
   * Get conversations for a workspace
   */
  async getConversationsByWorkspace(workspaceId, limit = 100) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM conversations
         WHERE workspace_id = ?
         ORDER BY last_message_at DESC
         LIMIT ?`,
        [workspaceId, limit],
        (err, rows) => {
          if (err) {
            console.error('Error getting conversations:', err);
            reject(err);
          } else {
            resolve(
              rows.map((row) => ({
                id: row.id,
                workspaceId: row.workspace_id,
                workspacePath: row.workspace_path,
                title: row.title,
                status: row.status,
                tags: row.tags ? JSON.parse(row.tags) : [],
                metadata: row.metadata ? JSON.parse(row.metadata) : {},
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                lastMessageAt: row.last_message_at,
                messageCount: row.message_count,
              }))
            );
          }
        }
      );
    });
  }

  /**
   * Get conversation by ID
   */
  async getConversationById(conversationId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM conversations WHERE id = ?`, [conversationId], (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            id: row.id,
            workspaceId: row.workspace_id,
            workspacePath: row.workspace_path,
            title: row.title,
            status: row.status,
            tags: row.tags ? JSON.parse(row.tags) : [],
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            lastMessageAt: row.last_message_at,
            messageCount: row.message_count,
          });
        }
      });
    });
  }

  /**
   * Log an audit event
   */
  async logAuditEvent(operation, operationType, details = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO audit_log
        (operation, operation_type, target_type, target_id, workspace_id, user_id, details, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        operation,
        operationType, // 'import', 'export', 'delete', 'update', etc.
        details.targetType || null,
        details.targetId || null,
        details.workspaceId || null,
        details.userId || null,
        JSON.stringify(details),
        details.status || 'success',
        details.errorMessage || null
      );

      stmt.finalize((err) => {
        if (err) {
          console.error('Error logging audit event:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get audit log entries
   */
  async getAuditLog(options = {}) {
    await this.init();

    const { workspaceId, operationType, limit = 100, offset = 0 } = options;

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM audit_log WHERE 1=1`;
      const params = [];

      if (workspaceId) {
        query += ` AND workspace_id = ?`;
        params.push(workspaceId);
      }

      if (operationType) {
        query += ` AND operation_type = ?`;
        params.push(operationType);
      }

      query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(
            rows.map((row) => ({
              id: row.id,
              operation: row.operation,
              operationType: row.operation_type,
              targetType: row.target_type,
              targetId: row.target_id,
              workspaceId: row.workspace_id,
              userId: row.user_id,
              details: row.details ? JSON.parse(row.details) : {},
              status: row.status,
              errorMessage: row.error_message,
              createdAt: row.created_at,
            }))
          );
        }
      });
    });
  }

  /**
   * Save a share link
   */
  async saveShareLink(shareData) {
    await this.init();

    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO share_links
        (id, share_id, account_id, device_id, workspaces, abstraction_level, filters, created_at, expires_at, access_count, last_accessed, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        shareData.id || shareData.shareId,
        shareData.shareId,
        shareData.account_id || null,
        shareData.device_id || null,
        JSON.stringify(shareData.workspaces || []),
        shareData.abstractionLevel || 1,
        JSON.stringify(shareData.filters || {}),
        shareData.createdAt,
        shareData.expiresAt,
        shareData.accessCount || 0,
        shareData.lastAccessed || null,
        JSON.stringify(shareData.metadata || {}),
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(shareData);
          }
        }
      );

      stmt.finalize();
    });
  }

  /**
   * Get a share link by ID
   */
  async getShareLink(shareId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM share_links WHERE share_id = ?`, [shareId], (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            id: row.id,
            shareId: row.share_id,
            account_id: row.account_id || null,
            device_id: row.device_id || null,
            workspaces: JSON.parse(row.workspaces || '[]'),
            abstractionLevel: row.abstraction_level,
            filters: JSON.parse(row.filters || '{}'),
            createdAt: row.created_at,
            expiresAt: row.expires_at,
            accessCount: row.access_count,
            lastAccessed: row.last_accessed,
            metadata: JSON.parse(row.metadata || '{}'),
          });
        }
      });
    });
  }

  /**
   * Update a share link
   */
  async updateShareLink(shareId, updates) {
    await this.init();

    return new Promise((resolve, reject) => {
      const fields = [];
      const values = [];

      if (updates.accessCount !== undefined) {
        fields.push('access_count = ?');
        values.push(updates.accessCount);
      }
      if (updates.lastAccessed !== undefined) {
        fields.push('last_accessed = ?');
        values.push(updates.lastAccessed);
      }
      if (updates.workspaces !== undefined) {
        fields.push('workspaces = ?');
        values.push(JSON.stringify(updates.workspaces));
      }
      if (updates.filters !== undefined) {
        fields.push('filters = ?');
        values.push(JSON.stringify(updates.filters));
      }

      if (fields.length === 0) {
        resolve();
        return;
      }

      values.push(shareId);

      this.db.run(
        `UPDATE share_links SET ${fields.join(', ')} WHERE share_id = ?`,
        values,
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
   * Delete a share link
   */
  async deleteShareLink(shareId) {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM share_links WHERE share_id = ?`, [shareId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get all share links (optionally filtered by account_id)
   */
  async getAllShareLinks(accountId = null) {
    await this.init();

    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM share_links`;
      const params = [];

      if (accountId) {
        query += ` WHERE account_id = ?`;
        params.push(accountId);
      }

      query += ` ORDER BY created_at DESC`;

      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(
            rows.map((row) => ({
              id: row.id,
              shareId: row.share_id,
              account_id: row.account_id || null,
              device_id: row.device_id || null,
              workspaces: JSON.parse(row.workspaces || '[]'),
              abstractionLevel: row.abstraction_level,
              filters: JSON.parse(row.filters || '{}'),
              createdAt: row.created_at,
              expiresAt: row.expires_at,
              accessCount: row.access_count,
              lastAccessed: row.last_accessed,
              metadata: JSON.parse(row.metadata || '{}'),
            }))
          );
        }
      });
    });
  }

  /**
   * Migrate rung tables to add new fields
   */
  migrateRungTables() {
    const migrations = [
      // Rung 1: Add conversation_id, event_type, linking_confidence
      `ALTER TABLE rung1_tokens ADD COLUMN conversation_id TEXT`,
      `ALTER TABLE rung1_tokens ADD COLUMN event_type TEXT DEFAULT 'UNKNOWN'`,
      `ALTER TABLE rung1_tokens ADD COLUMN linking_confidence TEXT DEFAULT 'none'`,

      // Rung 2: Add conversation_id, event_type, linking_confidence
      `ALTER TABLE rung2_edit_scripts ADD COLUMN conversation_id TEXT`,
      `ALTER TABLE rung2_edit_scripts ADD COLUMN event_type TEXT DEFAULT 'UNKNOWN'`,
      `ALTER TABLE rung2_edit_scripts ADD COLUMN linking_confidence TEXT DEFAULT 'none'`,

      // Rung 3: Add conversation_id, event_type, linking_confidence
      `ALTER TABLE rung3_function_changes ADD COLUMN conversation_id TEXT`,
      `ALTER TABLE rung3_function_changes ADD COLUMN event_type TEXT DEFAULT 'UNKNOWN'`,
      `ALTER TABLE rung3_function_changes ADD COLUMN linking_confidence TEXT DEFAULT 'none'`,
    ];

    migrations.forEach((migration) => {
      this.db.run(migration, (err) => {
        // Ignore "duplicate column" errors (column already exists)
        if (err && !err.message.includes('duplicate column')) {
          console.warn(`[MIGRATION] Warning: ${err.message}`);
        }
      });
    });

    // Create new indexes for the new fields
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_rung1_conversation ON rung1_tokens(conversation_id)`,
      () => {
        this.db.run(
          `CREATE INDEX IF NOT EXISTS idx_rung1_event_type ON rung1_tokens(event_type)`,
          () => {
            this.db.run(
              `CREATE INDEX IF NOT EXISTS idx_rung2_conversation ON rung2_edit_scripts(conversation_id)`,
              () => {
                this.db.run(
                  `CREATE INDEX IF NOT EXISTS idx_rung2_event_type ON rung2_edit_scripts(event_type)`,
                  () => {
                    this.db.run(
                      `CREATE INDEX IF NOT EXISTS idx_rung3_conversation ON rung3_function_changes(conversation_id)`,
                      () => {
                        this.db.run(
                          `CREATE INDEX IF NOT EXISTS idx_rung3_event_type ON rung3_function_changes(event_type)`,
                          () => {
                            // Create table for tracking extraction timestamps (incremental updates)
                            this.db.run(
                              `
                  CREATE TABLE IF NOT EXISTS rung_extraction_timestamps (
                    workspace_path TEXT,
                    rung_type TEXT,
                    last_extraction_timestamp TEXT,
                    PRIMARY KEY (workspace_path, rung_type)
                  )
                `,
                              (err) => {
                                if (err) {
                                  console.warn(
                                    '[MIGRATION] Error creating extraction timestamps table:',
                                    err.message
                                  );
                                }
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  }

  // ==================== Historical Data Mining Methods ====================

  /**
   * Initialize historical data tables
   */
  async initHistoricalTables() {
    await this.init();
    const { HISTORICAL_TABLES, HISTORICAL_INDEXES } = require('./historical-schema');

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        const promises = [];

        // Create all historical tables
        for (const [tableName, createSQL] of Object.entries(HISTORICAL_TABLES)) {
          promises.push(
            new Promise((res, rej) => {
              this.db.run(createSQL, (err) => {
                if (err) {
                  console.error(`Error creating ${tableName}:`, err);
                  rej(err);
                } else {
                  console.log(`[DB] Created historical table: ${tableName}`);
                  res();
                }
              });
            })
          );
        }

        // Create indexes
        for (const indexSQL of HISTORICAL_INDEXES) {
          promises.push(
            new Promise((res, rej) => {
              this.db.run(indexSQL, (err) => {
                if (err) {
                  console.warn('Error creating historical index:', err);
                  // Don't fail on index errors
                  res();
                } else {
                  res();
                }
              });
            })
          );
        }

        Promise.all(promises).then(resolve).catch(reject);
      });
    });
  }

  /**
   * Save historical commit
   */
  async saveHistoricalCommit(commit) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO historical_commits (
          workspace_path, commit_hash, author, author_email, date, message,
          files_changed, insertions, deletions, file_changes, mined_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          commit.workspace_path,
          commit.commit_hash,
          commit.author,
          commit.author_email,
          commit.date,
          commit.message,
          commit.files_changed,
          commit.insertions,
          commit.deletions,
          JSON.stringify(commit.file_changes || []),
          commit.mined_at || Date.now(),
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Save historical branch
   */
  async saveHistoricalBranch(branch) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO historical_branches (
          workspace_path, branch_name, last_commit_date, last_author, mined_at
        ) VALUES (?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          branch.workspace_path,
          branch.branch_name,
          branch.last_commit_date,
          branch.last_author,
          branch.mined_at || Date.now(),
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Save historical diff
   */
  async saveHistoricalDiff(diff) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO historical_diffs (
          commit_hash, workspace_path, diff_content, mined_at
        ) VALUES (?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [diff.commit_hash, diff.workspace_path, diff.diff_content, diff.mined_at || Date.now()],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Save historical command
   */
  async saveHistoricalCommand(cmd) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO historical_commands (
          command, timestamp, source_file, shell, line_number, mined_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          cmd.command,
          cmd.timestamp,
          cmd.source_file,
          cmd.shell,
          cmd.line_number,
          cmd.mined_at || Date.now(),
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Save historical prompt
   */
  async saveHistoricalPrompt(prompt) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO historical_prompts (
          prompt_text, timestamp, source, confidence, context, log_file, line_number, mined_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          prompt.prompt_text,
          prompt.timestamp,
          prompt.source,
          prompt.confidence,
          prompt.context,
          prompt.log_file,
          prompt.line_number,
          prompt.mined_at || Date.now(),
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Save file timestamp
   */
  async saveFileTimestamp(file) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT OR REPLACE INTO file_timestamps (
          file_path, size, created_at, modified_at, accessed_at, is_directory, mined_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          file.file_path,
          file.size,
          file.created_at,
          file.modified_at,
          file.accessed_at,
          file.is_directory ? 1 : 0,
          file.mined_at || Date.now(),
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Save mining run record
   */
  async saveMiningRun(run) {
    await this.init();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO mining_runs (
          workspace_path, started_at, completed_at, duration_ms,
          git_commits, shell_commands, cursor_prompts, file_timestamps, errors, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(
        sql,
        [
          run.workspace_path,
          run.started_at,
          run.completed_at,
          run.duration_ms,
          run.git_commits || 0,
          run.shell_commands || 0,
          run.cursor_prompts || 0,
          run.file_timestamps || 0,
          JSON.stringify(run.errors || []),
          run.status || 'completed',
        ],
        (err) => {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  /**
   * Get historical commits
   */
  async getHistoricalCommits(filters = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM historical_commits WHERE 1=1';
      const params = [];

      if (filters.workspace) {
        sql += ' AND workspace_path = ?';
        params.push(filters.workspace);
      }

      if (filters.since) {
        sql += ' AND date >= ?';
        params.push(new Date(filters.since).getTime());
      }

      if (filters.until) {
        sql += ' AND date <= ?';
        params.push(new Date(filters.until).getTime());
      }

      if (filters.author) {
        sql += ' AND author LIKE ?';
        params.push(`%${filters.author}%`);
      }

      sql += ' ORDER BY date DESC';

      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else {
          // Parse JSON fields
          const commits = rows.map((row) => ({
            ...row,
            file_changes: JSON.parse(row.file_changes || '[]'),
          }));
          resolve(commits);
        }
      });
    });
  }

  /**
   * Get historical commands
   */
  async getHistoricalCommands(filters = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM historical_commands WHERE 1=1';
      const params = [];

      if (filters.since) {
        sql += ' AND timestamp >= ?';
        params.push(new Date(filters.since).getTime());
      }

      if (filters.until) {
        sql += ' AND timestamp <= ?';
        params.push(new Date(filters.until).getTime());
      }

      if (filters.shell) {
        sql += ' AND shell = ?';
        params.push(filters.shell);
      }

      sql += ' ORDER BY timestamp DESC';

      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Get historical prompts
   */
  async getHistoricalPrompts(filters = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM historical_prompts WHERE 1=1';
      const params = [];

      if (filters.since) {
        sql += ' AND timestamp >= ?';
        params.push(new Date(filters.since).getTime());
      }

      if (filters.until) {
        sql += ' AND timestamp <= ?';
        params.push(new Date(filters.until).getTime());
      }

      if (filters.minConfidence) {
        sql += ' AND confidence >= ?';
        params.push(filters.minConfidence);
      }

      sql += ' ORDER BY timestamp DESC';

      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Get mining runs history
   */
  async getMiningRuns(filters = {}) {
    await this.init();

    return new Promise((resolve, reject) => {
      let sql = 'SELECT * FROM mining_runs WHERE 1=1';
      const params = [];

      if (filters.workspace) {
        sql += ' AND workspace_path = ?';
        params.push(filters.workspace);
      }

      sql += ' ORDER BY started_at DESC';

      if (filters.limit) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else {
          const runs = rows.map((row) => ({
            ...row,
            errors: JSON.parse(row.errors || '[]'),
          }));
          resolve(runs);
        }
      });
    });
  }
}

module.exports = PersistentDB;
