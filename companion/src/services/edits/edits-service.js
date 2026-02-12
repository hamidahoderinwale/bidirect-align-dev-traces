/**
 * Rung 2 Service
 * Statement-level (semantic edit scripts) abstraction
 */

const ModuleGraphExtractor = require('../module-graph/module-graph-extractor');
const SemanticExtractor = require('./semantic-extractor');

class EditsService {
  constructor(cursorDbParser = null, persistentDB = null) {
    this.extractor = new ModuleGraphExtractor(cursorDbParser);
    this.semanticExtractor = new SemanticExtractor();
    this.persistentDB = persistentDB;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000;
  }

  /**
   * Extract and process edit scripts for a workspace
   */
  async extractEditScripts(workspacePath = null, options = {}) {
    const cacheKey = `scripts_${workspacePath || 'global'}`;
    const cached = this.cache.get(cacheKey);

    // Check cache
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout && !options.forceRefresh) {
      return cached.scripts;
    }

    // Try to load from database first
    if (this.persistentDB && !options.forceRefresh) {
      const dbScripts = await this.loadEditScriptsFromDB(workspacePath);
      if (dbScripts && dbScripts.length > 0) {
        this.cache.set(cacheKey, {
          scripts: dbScripts,
          timestamp: Date.now(),
        });
        return dbScripts;
      }
    }

    // Extract file metadata from Cursor DB
    let extractedData;
    try {
      extractedData = await this.extractor.extractAll(workspacePath);
    } catch (error) {
      console.error('[RUNG2] Error extracting data from Cursor database:', error);
      throw new Error(`Failed to extract data from Cursor database: ${error.message}`);
    }

    if (!extractedData || !extractedData.fileMetadata) {
      console.warn('[RUNG2] No file metadata extracted from Cursor database');
      return [];
    }

    const { fileMetadata } = extractedData;

    if (!fileMetadata || Object.keys(fileMetadata).length === 0) {
      console.warn('[RUNG2] No file metadata found in extracted data');
      return [];
    }

    // Process all diffs
    const allScripts = [];
    let totalDiffs = 0;
    let validDiffs = 0;
    let invalidDiffs = 0;

    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      if (metadata.diffs && metadata.diffs.length > 0) {
        totalDiffs += metadata.diffs.length;

        // Filter diffs that have both originalTextLines and modifiedTextLines
        const validDiffsForFile = metadata.diffs.filter((diff) => {
          const hasOriginal = diff.originalTextLines && diff.originalTextLines.length > 0;
          const hasModified = diff.modifiedTextLines && diff.modifiedTextLines.length > 0;
          if (!hasOriginal || !hasModified) {
            invalidDiffs++;
            console.warn(
              `[RUNG2] Skipping diff for ${filePath}: missing ${!hasOriginal ? 'original' : 'modified'} text lines`
            );
            return false;
          }
          validDiffs++;
          return true;
        });

        if (validDiffsForFile.length > 0) {
          try {
            const scripts = this.semanticExtractor.extractEditScripts(
              validDiffsForFile,
              filePath,
              workspacePath
            );
            allScripts.push(...scripts);
          } catch (error) {
            console.error(`[RUNG2] Error extracting edit scripts from ${filePath}:`, error.message);
          }
        }
      }
    }

    console.log(
      `[RUNG2] Extraction summary: ${totalDiffs} total diffs, ${validDiffs} valid, ${invalidDiffs} invalid, ${allScripts.length} scripts generated`
    );

    // Persist to database
    if (this.persistentDB && allScripts.length > 0) {
      await this.persistEditScripts(allScripts);
    }

    // Cache result
    this.cache.set(cacheKey, {
      scripts: allScripts,
      timestamp: Date.now(),
    });

    return allScripts;
  }

  /**
   * Get edit scripts with filters
   */
  async getEditScripts(workspacePath = null, filters = {}) {
    // Try database first
    let scripts = [];
    if (this.persistentDB) {
      try {
        scripts = await this.loadEditScriptsFromDB(workspacePath);
      } catch (error) {
        console.warn('[RUNG2] Error loading edit scripts from database:', error.message);
      }
    }

    // If no database scripts, extract from Cursor DB
    if (scripts.length === 0) {
      try {
        scripts = await this.extractEditScripts(workspacePath);
      } catch (error) {
        console.error('[RUNG2] Error extracting edit scripts:', error);
        // Return empty array instead of throwing - allows UI to show helpful message
        return [];
      }
    }

    let filtered = scripts;

    // Apply filters
    if (filters.language) {
      filtered = filtered.filter((s) => s.language === filters.language);
    }

    if (filters.filePath) {
      filtered = filtered.filter((s) => s.filePath === filters.filePath);
    }

    if (filters.since) {
      filtered = filtered.filter((s) => s.timestamp >= filters.since);
    }

    if (filters.until) {
      filtered = filtered.filter((s) => s.timestamp <= filters.until);
    }

    return filtered;
  }

  /**
   * Get edit script by ID
   */
  async getEditScript(id) {
    if (this.persistentDB) {
      return await this.loadEditScriptFromDB(id);
    }
    const scripts = await this.extractEditScripts();
    return scripts.find((s) => s.id === id) || null;
  }

  /**
   * Get operation types with frequencies
   */
  async getOperationTypes(workspacePath = null) {
    const scripts = await this.getEditScripts(workspacePath);
    const operationTypes = {};

    for (const script of scripts) {
      if (script.operationTypes) {
        for (const [opType, count] of Object.entries(script.operationTypes)) {
          operationTypes[opType] = (operationTypes[opType] || 0) + count;
        }
      }
    }

    return operationTypes;
  }

  /**
   * Persist edit scripts to database
   */
  async persistEditScripts(scripts) {
    if (!this.persistentDB) return;

    try {
      await this.persistentDB.init();

      for (const script of scripts) {
        await new Promise((resolve, reject) => {
          this.persistentDB.db.run(
            `INSERT OR REPLACE INTO rung2_edit_scripts (
              id, diff_id, file_path, file_id, language, edit_operations,
              operation_count, operation_types, ast_node_types, change_style,
              timestamp, workspace_path, linked_prompt_id, intent_category, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              script.id,
              script.diffId || null,
              script.filePath || null,
              script.fileId || null,
              script.language || 'unknown',
              JSON.stringify(script.editOperations || []),
              script.operationCount || 0,
              JSON.stringify(script.operationTypes || {}),
              JSON.stringify(script.astNodeTypes || {}),
              script.changeStyle || 'mixed',
              new Date(script.timestamp || Date.now()).toISOString(),
              script.workspacePath || null,
              script.linkedPromptId || null,
              script.intentCategory || null,
              JSON.stringify(script.metadata || {}),
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    } catch (error) {
      console.warn('[RUNG2] Failed to persist edit scripts:', error.message);
    }
  }

  /**
   * Load edit scripts from database
   */
  async loadEditScriptsFromDB(workspacePath = null) {
    if (!this.persistentDB) return [];

    try {
      await this.persistentDB.init();

      return new Promise((resolve, reject) => {
        const query = workspacePath
          ? `SELECT * FROM rung2_edit_scripts WHERE workspace_path = ? ORDER BY timestamp DESC`
          : `SELECT * FROM rung2_edit_scripts ORDER BY timestamp DESC`;

        const params = workspacePath ? [workspacePath] : [];

        this.persistentDB.db.all(query, params, (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const scripts = rows.map((row) => ({
            id: row.id,
            diffId: row.diff_id,
            filePath: row.file_path,
            fileId: row.file_id,
            language: row.language,
            editOperations: JSON.parse(row.edit_operations || '[]'),
            operationCount: row.operation_count,
            operationTypes: JSON.parse(row.operation_types || '{}'),
            astNodeTypes: JSON.parse(row.ast_node_types || '{}'),
            changeStyle: row.change_style,
            timestamp: row.timestamp,
            workspacePath: row.workspace_path,
            linkedPromptId: row.linked_prompt_id,
            intentCategory: row.intent_category,
            metadata: JSON.parse(row.metadata || '{}'),
          }));

          resolve(scripts);
        });
      });
    } catch (error) {
      console.warn('[RUNG2] Failed to load edit scripts from database:', error.message);
      return [];
    }
  }

  /**
   * Load single edit script from database
   */
  async loadEditScriptFromDB(id) {
    if (!this.persistentDB) return null;

    try {
      await this.persistentDB.init();

      return new Promise((resolve, reject) => {
        this.persistentDB.db.get(
          `SELECT * FROM rung2_edit_scripts WHERE id = ?`,
          [id],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }

            if (!row) {
              resolve(null);
              return;
            }

            resolve({
              id: row.id,
              diffId: row.diff_id,
              filePath: row.file_path,
              fileId: row.file_id,
              language: row.language,
              editOperations: JSON.parse(row.edit_operations || '[]'),
              operationCount: row.operation_count,
              operationTypes: JSON.parse(row.operation_types || '{}'),
              astNodeTypes: JSON.parse(row.ast_node_types || '{}'),
              changeStyle: row.change_style,
              timestamp: row.timestamp,
              workspacePath: row.workspace_path,
              linkedPromptId: row.linked_prompt_id,
              intentCategory: row.intent_category,
              metadata: JSON.parse(row.metadata || '{}'),
            });
          }
        );
      });
    } catch (error) {
      console.warn('[RUNG2] Failed to load edit script from database:', error.message);
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache(workspacePath = null) {
    if (workspacePath) {
      this.cache.delete(`scripts_${workspacePath}`);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = EditsService;
