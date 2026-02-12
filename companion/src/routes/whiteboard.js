/**
 * Whiteboard API routes - Configurable analytics queries
 */

function createWhiteboardRoutes(deps) {
  const { app, persistentDB } = deps;

  /**
   * Execute a SQL query against telemetry data
   * POST /api/whiteboard/query
   */
  app.post('/api/whiteboard/query', async (req, res) => {
    try {
      const { sql } = req.body;

      if (!sql || typeof sql !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'SQL query is required',
        });
      }

      // Sanitize SQL - only allow SELECT statements
      const sanitized = sql.trim().toUpperCase();
      if (!sanitized.startsWith('SELECT')) {
        return res.status(400).json({
          success: false,
          error: 'Only SELECT queries are allowed',
        });
      }

      // Block dangerous operations
      const dangerous = [
        'DROP',
        'DELETE',
        'UPDATE',
        'INSERT',
        'ALTER',
        'CREATE',
        'TRUNCATE',
        'EXEC',
        'EXECUTE',
      ];
      for (const keyword of dangerous) {
        if (sanitized.includes(keyword)) {
          return res.status(400).json({
            success: false,
            error: `Operation ${keyword} is not allowed`,
          });
        }
      }

      // Execute query using persistentDB
      await persistentDB.init();

      if (!persistentDB.db) {
        throw new Error('Database not initialized');
      }

      const results = await new Promise((resolve, reject) => {
        persistentDB.db.all(sql, [], (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          // Get column names from first row or from PRAGMA
          let columns = [];
          if (rows && rows.length > 0) {
            columns = Object.keys(rows[0]);
          } else {
            // Try to get columns from query
            const columnMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
            if (columnMatch) {
              columns = columnMatch[1].split(',').map((c) => {
                const trimmed = c.trim();
                // Handle AS aliases
                const parts = trimmed.split(/\s+AS\s+/i);
                return parts.length > 1 ? parts[1].trim() : parts[0].trim();
              });
            }
          }

          resolve({
            columns,
            rows: rows || [],
            count: rows ? rows.length : 0,
          });
        });
      });

      res.json({
        success: true,
        results,
      });
    } catch (error) {
      console.error('Error executing whiteboard query:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Save a whiteboard
   * POST /api/whiteboard/save
   */
  app.post('/api/whiteboard/save', async (req, res) => {
    try {
      const { name, whiteboard } = req.body;

      if (!name || !whiteboard) {
        return res.status(400).json({
          success: false,
          error: 'Name and whiteboard data are required',
        });
      }

      await persistentDB.init();

      // Create whiteboards table if it doesn't exist
      await new Promise((resolve, reject) => {
        persistentDB.db.run(
          `
          CREATE TABLE IF NOT EXISTS whiteboards (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            whiteboard_json TEXT NOT NULL,
            workspace_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `,
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      const crypto = require('crypto');
      const id = crypto.randomUUID();
      const whiteboardJson = JSON.stringify(whiteboard);

      await new Promise((resolve, reject) => {
        if (!persistentDB.db) {
          reject(new Error('Database not initialized'));
          return;
        }

        persistentDB.db.run(
          `
          INSERT INTO whiteboards (id, name, whiteboard_json, workspace_id, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [id, name, whiteboardJson, whiteboard.workspaceId || null],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      res.json({
        success: true,
        id,
        name,
      });
    } catch (error) {
      console.error('Error saving whiteboard:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * List saved whiteboards
   * GET /api/whiteboard/list
   */
  app.get('/api/whiteboard/list', async (req, res) => {
    try {
      await persistentDB.init();

      const whiteboards = await new Promise((resolve, reject) => {
        persistentDB.db.all(
          `
          SELECT id, name, workspace_id, created_at, updated_at
          FROM whiteboards
          ORDER BY updated_at DESC
        `,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });

      res.json({
        success: true,
        whiteboards,
      });
    } catch (error) {
      console.error('Error listing whiteboards:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Load a whiteboard
   * GET /api/whiteboard/load?id=...
   */
  app.get('/api/whiteboard/load', async (req, res) => {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Whiteboard ID is required',
        });
      }

      await persistentDB.init();

      if (!persistentDB.db) {
        throw new Error('Database not initialized');
      }

      const whiteboard = await new Promise((resolve, reject) => {
        persistentDB.db.get(
          `
          SELECT id, name, whiteboard_json, workspace_id, created_at, updated_at
          FROM whiteboards
          WHERE id = ?
        `,
          [id],
          (err, row) => {
            if (err) reject(err);
            else if (!row) reject(new Error('Whiteboard not found'));
            else {
              try {
                const whiteboardData = JSON.parse(row.whiteboard_json || '{}');
                resolve({
                  id: row.id,
                  name: row.name,
                  workspace_id: row.workspace_id,
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                  whiteboard: whiteboardData,
                });
              } catch (parseErr) {
                reject(new Error('Invalid whiteboard data'));
              }
            }
          }
        );
      });

      res.json({
        success: true,
        whiteboard,
      });
    } catch (error) {
      console.error('Error loading whiteboard:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Delete a whiteboard
   * DELETE /api/whiteboard?id=...
   */
  app.delete('/api/whiteboard', async (req, res) => {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          success: false,
          error: 'Whiteboard ID is required',
        });
      }

      await persistentDB.init();

      if (!persistentDB.db) {
        throw new Error('Database not initialized');
      }

      await new Promise((resolve, reject) => {
        persistentDB.db.run(
          `
          DELETE FROM whiteboards
          WHERE id = ?
        `,
          [id],
          function (err) {
            if (err) reject(err);
            else resolve({ deleted: this.changes });
          }
        );
      });

      res.json({
        success: true,
      });
    } catch (error) {
      console.error('Error deleting whiteboard:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get schema information for query builder
   * GET /api/whiteboard/schema
   */
  app.get('/api/whiteboard/schema', async (req, res) => {
    try {
      await persistentDB.init();

      if (!persistentDB.db) {
        throw new Error('Database not initialized');
      }

      // Get table schemas
      const tables = await new Promise((resolve, reject) => {
        persistentDB.db.all(
          `
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []).map((r) => r.name));
          }
        );
      });

      const schema = {};

      for (const table of tables) {
        try {
          const columns = await new Promise((resolve, reject) => {
            // PRAGMA doesn't support parameterized queries, but table names are from sqlite_master
            persistentDB.db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
              if (err) reject(err);
              else
                resolve(
                  (rows || []).map((r) => ({
                    name: r.name,
                    type: r.type,
                    notnull: r.notnull,
                    dflt_value: r.dflt_value,
                    pk: r.pk === 1,
                  }))
                );
            });
          });

          schema[table] = {
            columns: columns || [],
            description: getTableDescription(table),
          };
        } catch (tableError) {
          console.warn(`Error getting schema for table ${table}:`, tableError);
          // Continue with other tables
        }
      }

      res.json({
        success: true,
        schema,
      });
    } catch (error) {
      console.error('Error getting schema:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

// Helper to get table descriptions
function getTableDescription(table) {
  const descriptions = {
    events: 'File change events and activity',
    prompts: 'AI prompts and interactions',
    entries: 'Code change entries with before/after',
    conversations: 'AI conversation threads',
    terminal_commands: 'Terminal command history',
    schema_config: 'Custom field configurations',
  };
  return descriptions[table] || 'Telemetry data table';
}

module.exports = createWhiteboardRoutes;
