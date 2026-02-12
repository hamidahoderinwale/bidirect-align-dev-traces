/**
 * Schema configuration API routes
 */

function createSchemaRoutes(deps) {
  const { app, persistentDB } = deps;

  app.get('/api/schema', async (req, res) => {
    try {
      const schema = await persistentDB.getSchema();
      res.json({ success: true, data: schema });
    } catch (error) {
      console.error('Error getting schema:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * Get all data types reference
   * GET /api/schema/data-types
   */
  app.get('/api/schema/data-types', async (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');

      // Try to read the DATA_TYPES.json file
      const dataTypesPath = path.join(__dirname, '../../../docs/DATABASE_SCHEMA.json');
      const dataTypesFile = path.join(__dirname, '../../../docs/DATA_TYPES.json');

      let dataTypes = null;
      try {
        if (fs.existsSync(dataTypesFile)) {
          dataTypes = JSON.parse(fs.readFileSync(dataTypesFile, 'utf8'));
        }
      } catch (e) {
        console.warn('Could not read DATA_TYPES.json:', e.message);
      }

      // If file doesn't exist, return a basic structure
      if (!dataTypes) {
        dataTypes = {
          itemTypes: {
            values: [
              'prompt',
              'event',
              'terminal',
              'conversation-turn',
              'status-message',
              'temporal-thread',
              'file-change-group',
              'commit-group',
            ],
          },
          eventTypes: {
            values: [
              'file_change',
              'code_change',
              'file_create',
              'file_delete',
              'file_rename',
              'state_create',
              'state_fork',
              'state_switch',
              'state_merge',
            ],
          },
          databaseTables: {
            tables: [
              'entries',
              'prompts',
              'events',
              'terminal_commands',
              'conversations',
              'conversation_turns',
              'tokens',
              'semantic_edit_scripts',
              'function_changes',
            ],
          },
          note: 'Full data types available in docs/DATA_TYPES.json',
        };
      }

      res.json({ success: true, data: dataTypes });
    } catch (error) {
      console.error('Error getting data types:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/schema/:tableName', async (req, res) => {
    try {
      const { tableName } = req.params;
      const tableSchema = await persistentDB.getTableSchema(tableName);
      res.json({ success: true, data: tableSchema });
    } catch (error) {
      console.error(`Error getting schema for table ${req.params.tableName}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/schema/:tableName/columns', async (req, res) => {
    try {
      const { tableName } = req.params;
      const columnDef = req.body;

      if (!columnDef.name || !columnDef.type) {
        return res.status(400).json({
          success: false,
          error: 'Column name and type are required',
        });
      }

      const result = await persistentDB.addColumn(tableName, columnDef);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error(`Error adding column to ${req.params.tableName}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/schema/config/fields', async (req, res) => {
    try {
      const { tableName, workspaceId, includeGlobal } = req.query;
      // Extract workspace context from query params
      // workspaceId can be passed explicitly, or extracted from workspace query param
      const workspace = workspaceId || req.query.workspace || null;
      const includeGlobalConfigs = includeGlobal !== 'false'; // Default to true

      const configs = await persistentDB.getCustomFieldConfigs(
        tableName || null,
        workspace || null,
        includeGlobalConfigs
      );
      res.json({ success: true, data: configs });
    } catch (error) {
      console.error('Error getting custom field configs:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/schema/config/fields', async (req, res) => {
    try {
      const config = req.body;

      if (!config.tableName || !config.fieldName || !config.fieldType) {
        return res.status(400).json({
          success: false,
          error: 'tableName, fieldName, and fieldType are required',
        });
      }

      // Extract workspace context from request
      // Priority: body.workspaceId > body.workspace > query.workspaceId > query.workspace
      const workspaceId =
        config.workspaceId ||
        req.body.workspaceId ||
        req.query.workspaceId ||
        req.query.workspace ||
        null;
      const workspacePath =
        config.workspacePath || req.body.workspacePath || req.query.workspacePath || null;

      // Add workspace context to config
      const configWithWorkspace = {
        ...config,
        workspaceId: workspaceId || null, // null means global config
        workspacePath: workspacePath || null,
      };

      const result = await persistentDB.saveCustomFieldConfig(configWithWorkspace);
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error saving custom field config:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/schema/config/fields/:tableName/:fieldName', async (req, res) => {
    try {
      const { tableName, fieldName } = req.params;

      // Extract workspace context from request
      // If workspaceId is provided, only delete workspace-specific config
      // If not provided (or null), delete global config
      const workspaceId =
        req.query.workspaceId ||
        req.query.workspace ||
        req.body.workspaceId ||
        req.body.workspace ||
        null;

      const result = await persistentDB.deleteCustomFieldConfig(
        tableName,
        fieldName,
        workspaceId || null
      );
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error deleting custom field config:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createSchemaRoutes;
