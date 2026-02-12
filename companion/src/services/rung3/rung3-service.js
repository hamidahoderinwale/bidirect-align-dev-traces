/**
 * Rung 3 Service
 * Function-level representation
 */

const ModuleGraphExtractor = require('../module-graph/module-graph-extractor');
const Rung3ChangeDetector = require('./rung3-change-detector');

class Rung3Service {
  constructor(cursorDbParser = null, persistentDB = null) {
    this.extractor = new ModuleGraphExtractor(cursorDbParser);
    this.changeDetector = new Rung3ChangeDetector();
    this.persistentDB = persistentDB;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000;
  }

  /**
   * Extract and process function changes for a workspace
   */
  async extractFunctionChanges(workspacePath = null, options = {}) {
    const cacheKey = `functions_${workspacePath || 'global'}`;
    const cached = this.cache.get(cacheKey);

    // Check cache
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout && !options.forceRefresh) {
      return cached.data;
    }

    // Try to load from database first
    if (this.persistentDB && !options.forceRefresh) {
      const dbChanges = await this.loadFunctionChangesFromDB(workspacePath);
      const dbFunctions = await this.loadFunctionsFromDB(workspacePath);
      if (dbChanges.length > 0 || dbFunctions.length > 0) {
        const data = {
          changes: dbChanges,
          functions: dbFunctions,
          callGraph: await this.buildCallGraphFromDB(workspacePath),
        };
        this.cache.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });
        return data;
      }
    }

    // Extract file metadata from Cursor DB
    let extractedData;
    try {
      extractedData = await this.extractor.extractAll(workspacePath);
    } catch (error) {
      console.error('[RUNG3] Error extracting data from Cursor database:', error);
      throw new Error(`Failed to extract data from Cursor database: ${error.message}`);
    }

    if (!extractedData || !extractedData.fileMetadata) {
      console.warn('[RUNG3] No file metadata extracted from Cursor database');
      return { changes: [], functions: [], callGraph: { nodes: [], edges: [] } };
    }

    const { fileMetadata } = extractedData;

    if (!fileMetadata || Object.keys(fileMetadata).length === 0) {
      console.warn('[RUNG3] No file metadata found in extracted data');
      return { changes: [], functions: [], callGraph: { nodes: [], edges: [] } };
    }

    // Process all diffs
    const allChanges = [];
    const allFunctions = [];
    const callGraphs = [];
    let totalDiffs = 0;
    let validDiffs = 0;
    let invalidDiffs = 0;

    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      if (metadata.diffs && metadata.diffs.length > 0) {
        totalDiffs += metadata.diffs.length;

        // Filter diffs that have both originalTextLines and modifiedTextLines for function change detection
        const validDiffsForFile = metadata.diffs.filter((diff) => {
          const hasOriginal = diff.originalTextLines && diff.originalTextLines.length > 0;
          const hasModified = diff.modifiedTextLines && diff.modifiedTextLines.length > 0;
          if (!hasOriginal || !hasModified) {
            invalidDiffs++;
            console.warn(
              `[RUNG3] Skipping diff for ${filePath}: missing ${!hasOriginal ? 'original' : 'modified'} text lines`
            );
            return false;
          }
          validDiffs++;
          return true;
        });

        if (validDiffsForFile.length > 0) {
          try {
            const result = this.changeDetector.processDiffs(validDiffsForFile, filePath, workspacePath);
            allChanges.push(...result.changes);
            allFunctions.push(...result.functions);
            if (result.callGraph) {
              callGraphs.push(result.callGraph);
            }
          } catch (error) {
            console.error(`[RUNG3] Error processing diffs for ${filePath}:`, error.message);
          }
        }
      }
    }

    console.log(
      `[RUNG3] Extraction summary: ${totalDiffs} total diffs, ${validDiffs} valid, ${invalidDiffs} invalid, ${allChanges.length} changes, ${allFunctions.length} functions generated`
    );

    // Merge call graphs
    const mergedCallGraph = this.mergeCallGraphs(callGraphs);

    const data = {
      changes: allChanges,
      functions: allFunctions,
      callGraph: mergedCallGraph,
    };

    // Persist to database
    if (this.persistentDB && allChanges.length > 0) {
      await this.persistFunctionChanges(allChanges);
    }
    if (this.persistentDB && allFunctions.length > 0) {
      await this.persistFunctions(allFunctions);
    }

    // Cache result
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * Get function changes with filters
   */
  async getFunctionChanges(workspacePath = null, filters = {}) {
    // Try database first
    let changes = [];
    if (this.persistentDB) {
      try {
        changes = await this.loadFunctionChangesFromDB(workspacePath);
      } catch (error) {
        console.warn('[RUNG3] Error loading function changes from database:', error.message);
      }
    }

    // If no database changes, extract from Cursor DB
    if (changes.length === 0) {
      try {
        const data = await this.extractFunctionChanges(workspacePath);
        changes = data.changes;
      } catch (error) {
        console.error('[RUNG3] Error extracting function changes:', error);
        // Return empty array instead of throwing - allows UI to show helpful message
        return [];
      }
    }

    let filtered = changes;

    // Apply filters
    if (filters.language) {
      filtered = filtered.filter((c) => c.language === filters.language);
    }

    if (filters.filePath) {
      filtered = filtered.filter((c) => c.filePath === filters.filePath);
    }

    if (filters.changeType) {
      filtered = filtered.filter((c) => c.changeType === filters.changeType);
    }

    if (filters.since) {
      filtered = filtered.filter((c) => c.timestamp >= filters.since);
    }

    if (filters.until) {
      filtered = filtered.filter((c) => c.timestamp <= filters.until);
    }

    return filtered;
  }

  /**
   * Get function change by ID
   */
  async getFunctionChange(id) {
    if (this.persistentDB) {
      return await this.loadFunctionChangeFromDB(id);
    }
    const data = await this.extractFunctionChanges();
    return data.changes.find((c) => c.id === id) || null;
  }

  /**
   * Get functions with filters
   */
  async getFunctions(workspacePath = null, filters = {}) {
    // Try database first
    let functions = [];
    if (this.persistentDB) {
      try {
        functions = await this.loadFunctionsFromDB(workspacePath);
      } catch (error) {
        console.warn('[RUNG3] Error loading functions from database:', error.message);
      }
    }

    // If no database functions, extract from Cursor DB
    if (functions.length === 0) {
      try {
        const data = await this.extractFunctionChanges(workspacePath);
        functions = data.functions;
      } catch (error) {
        console.error('[RUNG3] Error extracting functions:', error);
        // Return empty array instead of throwing - allows UI to show helpful message
        return [];
      }
    }

    let filtered = functions;

    // Apply filters
    if (filters.filePath) {
      filtered = filtered.filter((f) => f.fileId === this.generateFileId(filters.filePath));
    }

    if (filters.language) {
      // Would need to join with changes to get language
    }

    return filtered;
  }

  /**
   * Get call graph
   */
  async getCallGraph(workspacePath = null, filePath = null) {
    try {
      // Try database first
      if (this.persistentDB) {
        try {
          const callGraph = await this.buildCallGraphFromDB(workspacePath, filePath);
          if (callGraph && (callGraph.nodes?.length > 0 || callGraph.edges?.length > 0)) {
            return callGraph;
          }
        } catch (error) {
          console.warn('[RUNG3] Error loading call graph from database:', error.message);
        }
      }

      // If no database call graph, extract from Cursor DB
      const data = await this.extractFunctionChanges(workspacePath);
      return data.callGraph || { nodes: [], edges: [] };
    } catch (error) {
      console.error('[RUNG3] Error getting call graph:', error);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Get function change statistics
   */
  async getFunctionStats(workspacePath = null) {
    const changes = await this.getFunctionChanges(workspacePath);

    const stats = {
      total: changes.length,
      byChangeType: {},
      byLanguage: {},
    };

    for (const change of changes) {
      stats.byChangeType[change.changeType] = (stats.byChangeType[change.changeType] || 0) + 1;
      stats.byLanguage[change.language] = (stats.byLanguage[change.language] || 0) + 1;
    }

    return stats;
  }

  /**
   * Merge multiple call graphs
   */
  mergeCallGraphs(callGraphs) {
    const merged = {
      nodes: [],
      edges: [],
    };

    const nodeMap = new Map();
    const edgeSet = new Set();

    for (const graph of callGraphs) {
      for (const node of graph.nodes || []) {
        if (!nodeMap.has(node.id)) {
          nodeMap.set(node.id, node);
          merged.nodes.push(node);
        }
      }

      for (const edge of graph.edges || []) {
        const edgeKey = `${edge.source}->${edge.target}`;
        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey);
          merged.edges.push(edge);
        }
      }
    }

    return merged;
  }

  /**
   * Persist function changes to database
   */
  async persistFunctionChanges(changes) {
    if (!this.persistentDB) return;

    try {
      await this.persistentDB.init();

      for (const change of changes) {
        await new Promise((resolve, reject) => {
          this.persistentDB.db.run(
            `INSERT OR REPLACE INTO rung3_function_changes (
              id, diff_id, file_path, file_id, language, change_type,
              function_id, function_name, signature_before, signature_after,
              parameter_changes, return_type_changed, callgraph_updates,
              docstring_changed, timestamp, workspace_path, linked_prompt_id,
              intent_category, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              change.id,
              change.diffId || null,
              change.filePath || null,
              change.fileId || null,
              change.language || 'unknown',
              change.changeType,
              change.functionId || null,
              change.functionName || null,
              change.signatureBefore || null,
              change.signatureAfter || null,
              change.parameterChanges || null,
              change.returnTypeChanged ? 1 : 0,
              change.callgraphUpdates || null,
              change.docstringChanged ? 1 : 0,
              new Date(change.timestamp || Date.now()).toISOString(),
              change.workspacePath || null,
              change.linkedPromptId || null,
              change.intentCategory || null,
              JSON.stringify(change.metadata || {}),
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    } catch (error) {
      console.warn('[RUNG3] Failed to persist function changes:', error.message);
    }
  }

  /**
   * Persist functions to database
   */
  async persistFunctions(functions) {
    if (!this.persistentDB) return;

    try {
      await this.persistentDB.init();

      for (const func of functions) {
        await new Promise((resolve, reject) => {
          this.persistentDB.db.run(
            `INSERT OR REPLACE INTO rung3_functions (
              id, file_id, function_name, canonical_signature,
              parameter_count, return_type, first_seen, last_modified,
              call_count, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              func.id,
              func.fileId || null,
              func.functionName || null,
              func.canonicalSignature || null,
              func.parameterCount || 0,
              func.returnType || 'unknown',
              new Date(func.firstSeen || Date.now()).toISOString(),
              new Date(func.lastModified || Date.now()).toISOString(),
              func.callCount || 0,
              JSON.stringify(func.metadata || {}),
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    } catch (error) {
      console.warn('[RUNG3] Failed to persist functions:', error.message);
    }
  }

  /**
   * Load function changes from database
   */
  async loadFunctionChangesFromDB(workspacePath = null) {
    if (!this.persistentDB) return [];

    try {
      await this.persistentDB.init();

      return new Promise((resolve, reject) => {
        const query = workspacePath
          ? `SELECT * FROM rung3_function_changes WHERE workspace_path = ? ORDER BY timestamp DESC`
          : `SELECT * FROM rung3_function_changes ORDER BY timestamp DESC`;

        const params = workspacePath ? [workspacePath] : [];

        this.persistentDB.db.all(query, params, (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const changes = rows.map((row) => ({
            id: row.id,
            diffId: row.diff_id,
            filePath: row.file_path,
            fileId: row.file_id,
            language: row.language,
            changeType: row.change_type,
            functionId: row.function_id,
            functionName: row.function_name,
            signatureBefore: row.signature_before ? JSON.parse(row.signature_before) : null,
            signatureAfter: row.signature_after ? JSON.parse(row.signature_after) : null,
            parameterChanges: row.parameter_changes ? JSON.parse(row.parameter_changes) : null,
            returnTypeChanged: row.return_type_changed === 1,
            callgraphUpdates: row.callgraph_updates ? JSON.parse(row.callgraph_updates) : null,
            docstringChanged: row.docstring_changed === 1,
            timestamp: row.timestamp,
            workspacePath: row.workspace_path,
            linkedPromptId: row.linked_prompt_id,
            intentCategory: row.intent_category,
            metadata: JSON.parse(row.metadata || '{}'),
          }));

          resolve(changes);
        });
      });
    } catch (error) {
      console.warn('[RUNG3] Failed to load function changes from database:', error.message);
      return [];
    }
  }

  /**
   * Load single function change from database
   */
  async loadFunctionChangeFromDB(id) {
    if (!this.persistentDB) return null;

    try {
      await this.persistentDB.init();

      return new Promise((resolve, reject) => {
        this.persistentDB.db.get(
          `SELECT * FROM rung3_function_changes WHERE id = ?`,
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
              changeType: row.change_type,
              functionId: row.function_id,
              functionName: row.function_name,
              signatureBefore: row.signature_before ? JSON.parse(row.signature_before) : null,
              signatureAfter: row.signature_after ? JSON.parse(row.signature_after) : null,
              parameterChanges: row.parameter_changes ? JSON.parse(row.parameter_changes) : null,
              returnTypeChanged: row.return_type_changed === 1,
              callgraphUpdates: row.callgraph_updates ? JSON.parse(row.callgraph_updates) : null,
              docstringChanged: row.docstring_changed === 1,
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
      console.warn('[RUNG3] Failed to load function change from database:', error.message);
      return null;
    }
  }

  /**
   * Load functions from database
   */
  async loadFunctionsFromDB(workspacePath = null) {
    if (!this.persistentDB) return [];

    try {
      await this.persistentDB.init();

      return new Promise((resolve, reject) => {
        // Note: workspace filtering would need to join with function_changes table
        const query = `SELECT * FROM rung3_functions ORDER BY last_modified DESC`;

        this.persistentDB.db.all(query, [], (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const functions = rows.map((row) => ({
            id: row.id,
            fileId: row.file_id,
            functionName: row.function_name,
            canonicalSignature: row.canonical_signature,
            parameterCount: row.parameter_count,
            returnType: row.return_type,
            firstSeen: row.first_seen,
            lastModified: row.last_modified,
            callCount: row.call_count,
            metadata: JSON.parse(row.metadata || '{}'),
          }));

          resolve(functions);
        });
      });
    } catch (error) {
      console.warn('[RUNG3] Failed to load functions from database:', error.message);
      return [];
    }
  }

  /**
   * Build call graph from database
   */
  async buildCallGraphFromDB(workspacePath = null, filePath = null) {
    if (!this.persistentDB) return { nodes: [], edges: [] };

    try {
      await this.persistentDB.init();

      // Load functions as nodes
      const functions = await this.loadFunctionsFromDB(workspacePath);
      const nodes = functions.map((func) => ({
        id: func.id,
        name: func.functionName,
        fileId: func.fileId,
        signature: func.canonicalSignature,
        parameterCount: func.parameterCount,
        returnType: func.returnType,
      }));

      // Load call graph updates from changes
      const changes = await this.loadFunctionChangesFromDB(workspacePath);
      const edges = [];
      const edgeSet = new Set();

      for (const change of changes) {
        if (change.callgraphUpdates && change.callgraphUpdates.added_calls) {
          for (const call of change.callgraphUpdates.added_calls) {
            const edgeKey = `${call.source}->${call.target}`;
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              edges.push({
                source: call.source,
                target: call.target,
                type: 'CALL',
                line: call.line,
              });
            }
          }
        }
      }

      return { nodes, edges };
    } catch (error) {
      console.warn('[RUNG3] Failed to build call graph from database:', error.message);
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Generate file ID
   */
  generateFileId(filePath) {
    let hash = 0;
    for (let i = 0; i < filePath.length; i++) {
      const char = filePath.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `FILE_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Clear cache
   */
  clearCache(workspacePath = null) {
    if (workspacePath) {
      this.cache.delete(`functions_${workspacePath}`);
    } else {
      this.cache.clear();
    }
  }
}

module.exports = Rung3Service;
