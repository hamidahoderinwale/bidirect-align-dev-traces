/**
 * Database management API routes
 */

function createDatabaseRoutes(deps) {
  const { app, persistentDB } = deps;

  app.get('/api/database/stats', async (req, res) => {
    try {
      const stats = await persistentDB.getStats();
      const integrity = await persistentDB.validateIntegrity();

      // Get database file size
      const fs = require('fs');
      const path = require('path');
      let fileSize = 0;
      let fileSizeFormatted = '0 B';

      try {
        const dbPath = persistentDB.dbPath || path.join(__dirname, '../../data/companion.db');
        if (fs.existsSync(dbPath)) {
          const stats_fs = fs.statSync(dbPath);
          fileSize = stats_fs.size;

          // Format file size
          const units = ['B', 'KB', 'MB', 'GB', 'TB'];
          let size = fileSize;
          let unitIndex = 0;
          while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
          }
          fileSizeFormatted = `${size.toFixed(2)} ${units[unitIndex]}`;
        }
      } catch (err) {
        console.warn('Could not get database file size:', err.message);
      }

      // Calculate total traces (entries + prompts + events)
      const totalTraces = (stats.entries || 0) + (stats.prompts || 0) + (stats.events || 0);

      res.json({
        success: true,
        stats: {
          ...stats,
          totalTraces,
          fileSize,
          fileSizeFormatted,
        },
        integrity,
      });
    } catch (error) {
      console.error('Error getting database stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/database/entries-with-prompts', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const entries = await persistentDB.getEntriesWithPrompts(limit);

      res.json({
        success: true,
        data: entries,
        count: entries.length,
      });
    } catch (error) {
      console.error('Error getting entries with prompts:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/database/prompts-with-entries', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const prompts = await persistentDB.getPromptsWithEntries(limit);

      res.json({
        success: true,
        data: prompts,
        count: prompts.length,
      });
    } catch (error) {
      console.error('Error getting prompts with entries:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/prompts/:id/context-files', async (req, res) => {
    try {
      const { id } = req.params;

      const prompts = await persistentDB.getAllPrompts();
      const prompt = prompts.find((p) => p.id == id);

      if (!prompt) {
        return res.status(404).json({
          success: false,
          error: 'Prompt not found',
        });
      }

      let contextFiles = [];
      let counts = { total: 0, explicit: 0, tabs: 0, auto: 0 };

      if (prompt.context_files_json) {
        try {
          contextFiles = JSON.parse(prompt.context_files_json);
        } catch (e) {
          console.warn('Error parsing context files JSON:', e.message);
        }
      }

      counts = {
        total: prompt.context_file_count || contextFiles.length || 0,
        explicit: prompt.context_file_count_explicit || 0,
        tabs: prompt.context_file_count_tabs || 0,
        auto: prompt.context_file_count_auto || 0,
      };

      res.json({
        success: true,
        promptId: parseInt(id),
        promptText: prompt.text,
        mode: prompt.mode,
        contextUsage: prompt.context_usage,
        fileCount: counts.total,
        counts: counts,
        files: contextFiles,
      });
    } catch (error) {
      console.error('Error getting prompt context files:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createDatabaseRoutes;
