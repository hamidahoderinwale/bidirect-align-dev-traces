/**
 * Export/Import API routes
 */

function createExportImportRoutes(deps) {
  const {
    app,
    persistentDB,
    db,
    abstractionEngine,
    schemaMigrations,
    dataAccessControl,
    motifService,
    moduleGraphService,
    rung1Service,
    rung2Service,
    rung3Service,
    exportHistoryService,
    robustDataCapture,
    rawData,
    cursorDbParser,
  } = deps;

  // Helper to log exports
  async function logExportToHistory(exportData) {
    if (!exportHistoryService) return;
    try {
      await exportHistoryService.logExport(exportData);
    } catch (err) {
      console.warn('[EXPORT] Failed to log export to history:', err.message);
    }
  }

  const RUNG_HIERARCHY = ['clio', 'module_graph', 'functions', 'semantic_edits', 'tokens'];

  const normalizeListParam = (value) => {
    if (!value) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
      .flatMap((item) => {
        if (typeof item !== 'string') return [];
        return item
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
      })
      .filter(Boolean);
  };

  const parseWorkspaceFiltersFromQuery = (query) => {
    const workspaces = normalizeListParam(query.workspace);
    const workspacePaths = normalizeListParam(query.workspace_path);
    return [...new Set([...workspaces, ...workspacePaths])];
  };

  const parseTraceTypesFromQuery = (query) => {
    if (!query) return [];
    if (query.traceTypes) return normalizeListParam(query.traceTypes);
    if (query.traceType) return normalizeListParam(query.traceType);
    return [];
  };

  const parseTimestampParam = (value) => {
    if (!value) return null;
    const raw = Array.isArray(value) ? value[0] : value;
    if (raw === undefined || raw === null || raw === '') return null;
    if (!isNaN(raw)) {
      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    }
    const date = new Date(raw);
    return isNaN(date.getTime()) ? null : date.getTime();
  };

  const calculateDiffStats = (before, after) => {
    if (!before && !after) {
      return { linesAdded: 0, linesRemoved: 0, charsAdded: 0, charsDeleted: 0 };
    }
    const beforeLines = (before || '').split('\n');
    const afterLines = (after || '').split('\n');
    const charsAdded = (after || '').length;
    const charsDeleted = (before || '').length;
    const linesAdded = Math.max(0, afterLines.length - beforeLines.length);
    const linesRemoved = Math.max(0, beforeLines.length - afterLines.length);
    return { linesAdded, linesRemoved, charsAdded, charsDeleted };
  };

  // Streaming export handler for large datasets
  async function handleStreamingExport(req, res, options) {
    const {
      limit,
      includeAllFields,
      since,
      until,
      excludeEvents,
      excludePrompts,
      excludeTerminal,
      excludeContext,
      excludeMotifs,
      excludeModuleGraph,
      excludeRung1,
      excludeRung2,
      excludeRung3,
      noCodeDiffs,
      noLinkedData,
      noTemporalChunks,
      abstractionLevel,
      abstractPrompts,
      extractPatterns,
      fieldFilter, // Pass field filter from main handler
      rung1PIIOptions, // PII redaction options for Rung 1
      rung1FuzzSemanticExpressiveness, // Semantic expressiveness fuzzing option for Rung 1
    } = options;

    try {
      // Set headers for streaming
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Transfer-Encoding', 'chunked');

      // Helper function to filter by date range
      const filterByDateRange = (items) => {
        if (!since && !until) return items;
        return items.filter((item) => {
          const itemTime = new Date(item.timestamp).getTime();
          if (since && itemTime < since) return false;
          if (until && itemTime > until) return false;
          return true;
        });
      };

      // Helper to filter object fields based on config (if fieldFilter provided)
      const filterFields = (obj, tableName) => {
        if (!fieldFilter || !fieldFilter.has(tableName)) return obj; // No config = export all
        const tableConfig = fieldFilter.get(tableName);
        const filtered = {};
        for (const [key, value] of Object.entries(obj)) {
          const enabled = tableConfig.get(key);
          if (enabled === undefined || enabled === true) {
            // Field not configured or enabled = include it
            filtered[key] = value;
          }
          // If enabled === false, exclude the field
        }
        return filtered;
      };

      // Helper to write JSON chunk
      const writeChunk = (chunk) => {
        res.write(chunk);
      };

      // Helper to abstract entry if needed
      const processEntry = (entry) => {
        if (abstractionLevel > 0 && abstractionEngine) {
          return abstractionEngine.abstractEntry(entry, abstractionLevel);
        }
        return entry;
      };

      // Helper to abstract prompt if needed
      const processPrompt = (prompt) => {
        if (abstractionLevel > 0 && abstractionEngine) {
          return abstractionEngine.abstractPrompt(prompt, abstractionLevel);
        }
        return prompt;
      };

      // Start writing JSON structure
      writeChunk('{\n  "success": true,\n  "data": {\n');

      // Get current schema version
      let schemaVersion = '1.0.0';
      try {
        const schema = await persistentDB.getSchema();
        schemaVersion = schema.version || '1.0.0';
      } catch (err) {
        console.warn('[EXPORT] Could not get schema version:', err.message);
      }

      // Write metadata first (small, can load all at once)
      const metadata = {
        exportedAt: new Date().toISOString(),
        version: '2.5',
        schema_version: schemaVersion,
        exportFormat: 'structured',
        exportLimit: limit,
        fullExport: includeAllFields,
        dateRange: {
          since: since ? new Date(since).toISOString() : null,
          until: until ? new Date(until).toISOString() : null,
        },
        filters: {
          excludeEvents,
          excludePrompts,
          excludeTerminal,
          excludeContext,
          noCodeDiffs,
          noLinkedData,
          noTemporalChunks,
        },
        streaming: true,
        organization: 'Structured format with clear sections',
      };
      writeChunk(
        `    "metadata": ${JSON.stringify(metadata, null, 2).split('\n').join('\n    ')},\n`
      );

      // Stream entries in batches
      // Store fetched data for stats calculation
      let allEntries = [];
      let allPrompts = [];
      let allTerminalCommands = [];
      let allContextSnapshots = [];

      console.log(`[EXPORT] excludeEvents=${excludeEvents}, excludePrompts=${excludePrompts}, noCodeDiffs=${noCodeDiffs}`);

      if (!excludeEvents) {
        writeChunk('    "entries": [\n');
        const batchSize = 100; // Process 100 entries at a time
        let processedCount = 0;
        let firstEntry = true;

        // Get entries - use time range filtering if dates are provided
        if (since || until) {
          // Get all entries in time range at once (more efficient for date filtering)
          allEntries = await persistentDB.getEntriesInTimeRange(
            since || 0,
            until || Date.now(),
            null,
            limit
          );
        } else {
          // Get entries with code - fetch up to limit at once
          // getEntriesWithCode already supports limit, so we can fetch directly
          allEntries = await persistentDB.getEntriesWithCode(limit);
          console.log(`[EXPORT] Fetched ${allEntries.length} entries using getEntriesWithCode`);
        }

        console.log(`[EXPORT] Fetched ${allEntries.length} entries from database`);

        // Filter entries by date range if needed
        let filteredEntries = allEntries;
        if (since || until) {
          filteredEntries = allEntries.filter((entry) => {
            const itemTime = new Date(entry.timestamp).getTime();
            if (since && itemTime < since) return false;
            if (until && itemTime > until) return false;
            return true;
          });
          console.log(`[EXPORT] Filtered to ${filteredEntries.length} entries after date range filter`);
        }

        // Process entries
        for (const entry of filteredEntries) {
          if (processedCount >= limit) break;

          if (!firstEntry) writeChunk(',\n');
          firstEntry = false;

          // Enrich entry
          const diff = calculateDiffStats(
            entry.before_code || entry.before_content,
            entry.after_code || entry.after_content
          );
          const enriched = {
            ...entry,
            diff_stats: {
              lines_added: diff.linesAdded,
              lines_removed: diff.linesRemoved,
              chars_added: diff.charsAdded,
              chars_deleted: diff.charsDeleted,
              has_diff: !!(entry.before_code || entry.after_code),
            },
          };

          // Only exclude code diffs if explicitly requested
          // By default, code diffs are included
          if (noCodeDiffs) {
            // Remove code fields entirely if noCodeDiffs is true
            delete enriched.before_code;
            delete enriched.after_code;
            delete enriched.before_content;
            delete enriched.after_content;
          } else {
            // Ensure code fields are present (even if empty)
            enriched.before_code = entry.before_code || entry.before_content || '';
            enriched.after_code = entry.after_code || entry.after_content || '';
            enriched.before_content = enriched.before_code;
            enriched.after_content = enriched.after_code;
          }

          // Apply abstraction
          const processed = processEntry(enriched);

          // Filter fields based on schema config (entries table)
          const filtered = filterFields(processed, 'entries');

          writeChunk('      ' + JSON.stringify(filtered).split('\n').join('\n      '));
          processedCount++;

          // Flush periodically
          if (processedCount % (batchSize * 10) === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }

        // Ensure we close the array properly even if no entries were written
        if (firstEntry) {
          // No entries were written, write empty array
          writeChunk('],\n');
        } else {
          writeChunk('\n    ],\n');
        }
      } else {
        writeChunk('    "entries": [],\n');
      }

      // Stream prompts in batches
      if (!excludePrompts) {
        writeChunk('    "prompts": [\n');
        const batchSize = 100;
        let processedCount = 0;
        let firstPrompt = true;

        // Use time range filtering if dates are provided
        if (since || until) {
          // Get all prompts in time range at once (more efficient for date filtering)
          allPrompts = await persistentDB.getPromptsInTimeRange(
            since || 0,
            until || Date.now(),
            limit
          );
        } else {
          // Get recent prompts in batches
          for (let offset = 0; offset < limit; offset += batchSize) {
            const batchLimit = Math.min(batchSize, limit - offset);
            const batch = await persistentDB.getRecentPrompts(batchLimit);
            allPrompts.push(...batch);
            if (allPrompts.length >= limit) break;
          }
          allPrompts = allPrompts.slice(0, limit);
        }

        console.log(`[EXPORT] Fetched ${allPrompts.length} prompts from database`);

        // Filter prompts by date range if needed
        let filteredPrompts = allPrompts;
        if (since || until) {
          filteredPrompts = allPrompts.filter((prompt) => {
            const itemTime = new Date(prompt.timestamp).getTime();
            if (since && itemTime < since) return false;
            if (until && itemTime > until) return false;
            return true;
          });
          console.log(`[EXPORT] Filtered to ${filteredPrompts.length} prompts after date range filter`);
        }

        // Process prompts
        for (const prompt of filteredPrompts) {
          if (processedCount >= limit) break;

          if (!firstPrompt) writeChunk(',\n');
          firstPrompt = false;

          const processed = processPrompt(prompt);

          // Filter fields based on schema config (prompts table)
          const filtered = filterFields(processed, 'prompts');

          writeChunk('      ' + JSON.stringify(filtered).split('\n').join('\n      '));
          processedCount++;

          // Flush periodically
          if (processedCount % (batchSize * 10) === 0) {
            await new Promise((resolve) => setImmediate(resolve));
          }
        }

        // Ensure we close the array properly even if no prompts were written
        if (firstPrompt) {
          // No prompts were written, write empty array
          writeChunk('],\n');
        } else {
          writeChunk('\n    ],\n');
        }
      } else {
        writeChunk('    "prompts": [],\n');
      }

      // Stream terminal commands (smaller, can batch)
      if (!excludeTerminal) {
        writeChunk('    "terminal_commands": [\n');
        allTerminalCommands = await persistentDB.getAllTerminalCommands(Math.min(limit, 10000));
        const filteredCommands = filterByDateRange(allTerminalCommands);
        console.log(`[EXPORT] Fetched ${allTerminalCommands.length} terminal commands from database`);
        let firstCmd = true;

        for (const cmd of filteredCommands.slice(0, limit)) {
          if (!firstCmd) writeChunk(',\n');
          firstCmd = false;

          // Filter fields based on schema config (terminal_commands table)
          const filtered = filterFields(cmd, 'terminal_commands');

          writeChunk('      ' + JSON.stringify(filtered).split('\n').join('\n      '));
        }

        writeChunk('\n    ],\n');
      } else {
        writeChunk('    "terminal_commands": [],\n');
      }

      // Context snapshots (smaller dataset)
      if (!excludeContext) {
        writeChunk('    "context_snapshots": [\n');
        allContextSnapshots = await persistentDB.getContextSnapshots({
          since: since || 0,
          limit: Math.min(limit, 10000),
        });
        const filteredSnapshots = filterByDateRange(allContextSnapshots);
        console.log(`[EXPORT] Fetched ${allContextSnapshots.length} context snapshots from database`);
        let firstSnapshot = true;

        for (const snapshot of filteredSnapshots.slice(0, limit)) {
          if (!firstSnapshot) writeChunk(',\n');
          firstSnapshot = false;

          // Filter fields based on schema config (context_snapshots table)
          const filtered = filterFields(snapshot, 'context_snapshots');

          writeChunk('      ' + JSON.stringify(filtered).split('\n').join('\n      '));
        }

        writeChunk('\n    ],\n');
      } else {
        writeChunk('    "context_snapshots": [],\n');
      }

      // Context analytics (small, can load all)
      const contextAnalytics = await persistentDB.getContextAnalytics();
      writeChunk(
        `    "context_analytics": ${JSON.stringify(contextAnalytics).split('\n').join('\n    ')},\n`
      );

      // Stream Procedural Clio: Motifs (Rung 6)
      if (!excludeMotifs && motifService) {
        writeChunk('    "proceduralClio": {\n');
        writeChunk('      "version": "1.0",\n');
        writeChunk('      "rung": 6,\n');
        writeChunk(
          '      "description": "Recurring procedural patterns (motifs) extracted from canonical workflow DAGs",\n'
        );
        writeChunk('      "motifs": [\n');
        try {
          const motifs = await motifService.getMotifs({});
          let firstMotif = true;

          for (const motif of motifs) {
            if (!firstMotif) writeChunk(',\n');
            firstMotif = false;

            const motifData = {
              id: motif.id,
              pattern: motif.pattern,
              sequence: motif.sequence || [],
              dominant_intent: motif.dominantIntent,
              shape: motif.shape,
              frequency: motif.frequency,
              confidence: motif.confidence,
              intents: motif.intents || {},
              stats: motif.stats || {},
              privacy: motif.privacy || {},
              created_at: motif.created_at || null,
              updated_at: motif.updated_at || null,
            };

            writeChunk('      ' + JSON.stringify(motifData).split('\n').join('\n      '));
          }
        } catch (error) {
          console.warn('[EXPORT] Failed to stream motifs:', error.message);
        }
        writeChunk('\n      ],\n');
        writeChunk(
          '      "note": "Only motifs (Rung 6) are exported. Full Clio clusters, facets, and canonical DAGs are computed on-demand and not persisted."\n'
        );
        writeChunk('    },\n');
      } else {
        writeChunk(
          '    "proceduralClio": { "motifs": [], "note": "Motifs excluded from export" },\n'
        );
      }

      // Module Graph (Rung 4 - File-level abstraction)
      if (!excludeModuleGraph && moduleGraphService) {
        writeChunk('    "moduleGraph": {\n');
        writeChunk('      "version": "1.0",\n');
        writeChunk('      "rung": 4,\n');
        writeChunk(
          '      "description": "Content-free, compositional module graph with typed signals (imports, calls, context, navigation, tools)",\n'
        );
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;
          const graph = await moduleGraphService.getModuleGraph(workspace, { forceRefresh: false });

          writeChunk(
            '      "nodes": ' +
              JSON.stringify(graph.nodes || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "edges": ' +
              JSON.stringify(graph.edges || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "events": ' +
              JSON.stringify(graph.events || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "hierarchy": ' +
              JSON.stringify(graph.hierarchy || {})
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "metadata": ' +
              JSON.stringify(graph.metadata || {})
                .split('\n')
                .join('\n      ') +
              '\n'
          );
        } catch (error) {
          console.warn('[EXPORT] Failed to export module graph:', error.message);
          writeChunk('      "error": "' + error.message.replace(/"/g, '\\"') + '"\n');
        }
        writeChunk('    },\n');
      } else {
        writeChunk('    "moduleGraph": { "note": "Module graph excluded from export" },\n');
      }

      // Functions: Function-level representation (Medium Privacy)
      if (!excludeRung3 && rung3Service) {
        writeChunk('    "functions": {\n');
        writeChunk('      "version": "1.0",\n');
        writeChunk('      "level": "functions",\n');
        writeChunk('      "description": "Function-level changes and callgraph updates",\n');
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;
          const changes = await rung3Service.getFunctionChanges(workspace, {});
          const functions = await rung3Service.getFunctions(workspace, {});
          const callgraph = await rung3Service.getCallGraph(workspace);
          const stats = await rung3Service.getFunctionStats(workspace);

          writeChunk(
            '      "functionChanges": ' +
              JSON.stringify(changes || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "functions": ' +
              JSON.stringify(functions || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "callgraph": ' +
              JSON.stringify(callgraph || {})
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "stats": ' +
              JSON.stringify(stats || {})
                .split('\n')
                .join('\n      ') +
              '\n'
          );
        } catch (error) {
          console.warn('[EXPORT] Failed to export Rung 3:', error.message);
          writeChunk('      "error": "' + error.message.replace(/"/g, '\\"') + '"\n');
        }
        writeChunk('    },\n');
      } else {
        writeChunk('    "functions": { "note": "Functions excluded from export" },\n');
      }

      // Semantic Edits: Statement-level (semantic edit scripts) (Low Privacy)
      if (!excludeRung2 && rung2Service) {
        writeChunk('    "semantic_edits": {\n');
        writeChunk('      "version": "1.0",\n');
        writeChunk('      "level": "semantic_edits",\n');
        writeChunk('      "description": "Semantic edit scripts from AST differencing",\n');
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;
          const scripts = await rung2Service.getEditScripts(workspace, {});
          const operations = await rung2Service.getOperationTypes(workspace);

          writeChunk(
            '      "editScripts": ' +
              JSON.stringify(scripts || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "operations": ' +
              JSON.stringify(operations || {})
                .split('\n')
                .join('\n      ') +
              '\n'
          );
        } catch (error) {
          console.warn('[EXPORT] Failed to export Rung 2:', error.message);
          writeChunk('      "error": "' + error.message.replace(/"/g, '\\"') + '"\n');
        }
        writeChunk('    },\n');
      } else {
        writeChunk('    "semantic_edits": { "note": "Semantic edits excluded from export" },\n');
      }

      // Tokens: Token-level abstraction (Lowest Privacy)
      if (!excludeRung1 && rung1Service) {
        writeChunk('    "tokens": {\n');
        writeChunk('      "version": "1.0",\n');
        writeChunk('      "level": "tokens",\n');
        writeChunk(
          '      "description": "Token-level abstraction with canonicalized identifiers",\n'
        );
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;

          // Parse PII options from query params or options object
          const piiOptions = rung1PIIOptions || {
            redactEmails: req.query.rung1_redact_emails !== 'false',
            redactNames: req.query.rung1_redact_names !== 'false',
            redactNumbers: req.query.rung1_redact_numbers !== 'false',
            redactUrls: req.query.rung1_redact_urls !== 'false',
            redactIpAddresses: req.query.rung1_redact_ip_addresses !== 'false',
            redactFilePaths: req.query.rung1_redact_file_paths !== 'false',
            redactJwtSecrets: req.query.rung1_redact_jwt_secrets !== 'false',
            redactAllStrings: req.query.rung1_redact_all_strings !== 'false',
            redactAllNumbers: req.query.rung1_redact_all_numbers !== 'false',
          };

          // Parse fuzzing option from query params or options object
          const fuzzSemanticExpressiveness =
            rung1FuzzSemanticExpressiveness !== undefined
              ? rung1FuzzSemanticExpressiveness
              : req.query.rung1_fuzz_semantic_expressiveness === 'true';

          // Temporarily update Rung 1 service with options
          const originalPIIOptions = { ...rung1Service.piiOptions };
          const originalFuzzOption = rung1Service.fuzzSemanticExpressiveness;
          rung1Service.updatePIIOptions(piiOptions);
          rung1Service.setFuzzSemanticExpressiveness(fuzzSemanticExpressiveness);

          // Get tokens with options applied
          const tokens = await rung1Service.getTokens(workspace, {});
          const stats = await rung1Service.getTokenStats(workspace);

          // Restore original options
          rung1Service.updatePIIOptions(originalPIIOptions);
          rung1Service.setFuzzSemanticExpressiveness(originalFuzzOption);

          writeChunk(
            '      "tokens": ' +
              JSON.stringify(tokens || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "stats": ' +
              JSON.stringify(stats || {})
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "piiOptions": ' + JSON.stringify(piiOptions).split('\n').join('\n      ') + ',\n'
          );
          writeChunk(
            '      "fuzzSemanticExpressiveness": ' +
              JSON.stringify(fuzzSemanticExpressiveness) +
              '\n'
          );
        } catch (error) {
          console.warn('[EXPORT] Failed to export Rung 1:', error.message);
          writeChunk('      "error": "' + error.message.replace(/"/g, '\\"') + '"\n');
        }
        writeChunk('    },\n');
      } else {
        writeChunk('    "tokens": { "note": "Tokens excluded from export" },\n');
      }

      // Workspaces (small) - fetch from cursorDbParser if available
      let workspaces = [];
      try {
        if (cursorDbParser) {
          const allCursorWorkspaces = await cursorDbParser.getAllWorkspaces();
          workspaces = allCursorWorkspaces.map((ws) => ({
            id: ws.id,
            path: ws.path || `Unknown (${ws.id.substring(0, 8)})`,
            name: ws.name,
            lastAccessed: ws.lastAccessed ? new Date(ws.lastAccessed).toISOString() : null,
            created: ws.created ? new Date(ws.created).toISOString() : null,
            exists: ws.exists || false,
          }));
          console.log(`[EXPORT] Fetched ${workspaces.length} workspaces from cursorDbParser`);
        } else {
          // Fallback to db.workspaces if cursorDbParser not available
          workspaces = db.workspaces || [];
          console.log(`[EXPORT] Using ${workspaces.length} workspaces from db.workspaces`);
        }
      } catch (error) {
        console.warn('[EXPORT] Failed to fetch workspaces:', error.message);
        workspaces = db.workspaces || [];
      }
      writeChunk(
        `    "workspaces": ${JSON.stringify(workspaces)
          .split('\n')
          .join('\n    ')},\n`
      );

      // Raw Data (system resources, git, IDE state) - optional
      const includeRawData = req.query.include_raw_data === 'true';
      if (includeRawData) {
        writeChunk('    "raw_data": {\n');
        try {
          let rawDataExport = {
            systemResources: [],
            gitData: [],
            appleScript: [],
            cursorDatabase: [],
            logs: [],
          };

          // Get raw data from database if available, otherwise from memory
          if (robustDataCapture) {
            try {
              const rawLimit = Math.min(parseInt(req.query.raw_data_limit) || 1000, 10000);
              rawDataExport.systemResources = await robustDataCapture.getSystemResources(rawLimit);
              rawDataExport.gitData = await robustDataCapture.getGitData(Math.min(rawLimit, 500));
              rawDataExport.appleScript = await robustDataCapture.getAppleScriptState(rawLimit);
              rawDataExport.cursorDatabase = await robustDataCapture.getCursorDbConversations(Math.min(rawLimit, 100));
              rawDataExport.logs = await robustDataCapture.getLogs(Math.min(rawLimit, 100));
              rawDataExport.source = 'database';
            } catch (dbError) {
              console.warn('[EXPORT] Failed to get raw data from database, using in-memory:', dbError.message);
              // Fall through to in-memory
            }
          }

          // Fallback to in-memory if database not available or failed
          if (!rawDataExport.source && rawData) {
            const rawLimit = parseInt(req.query.raw_data_limit) || 1000;
            rawDataExport.systemResources = (rawData.systemResources || []).slice(-rawLimit);
            rawDataExport.gitData = (rawData.gitData?.status || []).slice(-Math.min(rawLimit, 500));
            rawDataExport.appleScript = (rawData.appleScript?.appState || []).slice(-rawLimit);
            rawDataExport.cursorDatabase = (rawData.cursorDatabase?.conversations || []).slice(-Math.min(rawLimit, 100));
            rawDataExport.logs = (rawData.logs?.cursor || []).slice(-Math.min(rawLimit, 100));
            rawDataExport.source = 'memory';
          }

          writeChunk(
            '      "systemResources": ' +
              JSON.stringify(rawDataExport.systemResources || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "gitData": ' +
              JSON.stringify(rawDataExport.gitData || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "appleScript": ' +
              JSON.stringify(rawDataExport.appleScript || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "cursorDatabase": ' +
              JSON.stringify(rawDataExport.cursorDatabase || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "logs": ' +
              JSON.stringify(rawDataExport.logs || [])
                .split('\n')
                .join('\n      ') +
              ',\n'
          );
          writeChunk(
            '      "source": "' + (rawDataExport.source || 'unknown') + '",\n'
          );
          writeChunk(
            '      "note": "Raw data includes system metrics, git status, IDE state, and logs. Use ?include_raw_data=true to include in export."\n'
          );
        } catch (error) {
          console.warn('[EXPORT] Failed to export raw data:', error.message);
          writeChunk('      "error": "' + error.message.replace(/"/g, '\\"') + '"\n');
        }
        writeChunk('    },\n');
      } else {
        writeChunk('    "raw_data": { "note": "Raw data excluded. Use ?include_raw_data=true to include system resources, git data, IDE state, and logs." },\n');
      }

      // Stats (computed from actual fetched and filtered data)
      // Calculate unique sessions from entries (group by session_id)
      const uniqueSessions = new Set();
      const finalEntries = allEntries.filter((entry) => {
        if (since || until) {
          const itemTime = new Date(entry.timestamp).getTime();
          if (since && itemTime < since) return false;
          if (until && itemTime > until) return false;
        }
        return true;
      });
      finalEntries.forEach((entry) => {
        if (entry.session_id) uniqueSessions.add(entry.session_id);
      });

      const finalPrompts = allPrompts.filter((prompt) => {
        if (since || until) {
          const itemTime = new Date(prompt.timestamp).getTime();
          if (since && itemTime < since) return false;
          if (until && itemTime > until) return false;
        }
        return true;
      });

      const stats = {
        sessions: uniqueSessions.size,
        fileChanges: finalEntries.length,
        aiInteractions: finalPrompts.length,
        totalActivities: finalEntries.length + finalPrompts.length + allTerminalCommands.length,
        terminalCommands: allTerminalCommands.length,
        contextSnapshots: allContextSnapshots.length,
        avgContextUsage: contextAnalytics.avgContextUtilization || 0,
      };
      console.log(`[EXPORT] Calculated stats from filtered data:`, stats);
      writeChunk(`    "stats": ${JSON.stringify(stats).split('\n').join('\n    ')}\n`);

      // Close JSON
      writeChunk('\n  }\n}');

      res.end();
      console.log(`[STREAM] Streaming export completed`);
    } catch (error) {
      console.error('Error in streaming export:', error);
      // Try to close JSON properly on error
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      } else {
        res.write(`\n  "error": "${error.message.replace(/"/g, '\\"')}"\n}`);
        res.end();
      }
    }
  }

  // Export preview endpoint - returns counts and size estimates without generating full export
  app.get('/api/export/preview', async (req, res) => {
    try {
      const { rung, format, workspace, timeRange, limit, dataSource } = req.query;

      // Parse data sources
      const requestedSources = dataSource
        ? Array.isArray(dataSource)
          ? dataSource
          : [dataSource]
        : ['traces', 'prompts', 'conversations', 'terminal', 'code'];

      // Parse workspace filters
      const workspaceFilters = parseWorkspaceFiltersFromQuery(req.query);

      // Calculate time range
      let since = null;
      let until = null;
      if (timeRange && timeRange !== 'all') {
        const now = Date.now();
        const ranges = {
          today: 24 * 60 * 60 * 1000,
          week: 7 * 24 * 60 * 60 * 1000,
          month: 30 * 24 * 60 * 60 * 1000,
        };
        if (ranges[timeRange]) {
          since = new Date(now - ranges[timeRange]);
        }
      }

      // Also check since/until query params
      if (req.query.since) {
        since = parseTimestampParam(req.query.since);
        if (since) since = new Date(since);
      }
      if (req.query.until) {
        until = parseTimestampParam(req.query.until);
        if (until) until = new Date(until);
      }

      const counts = {
        prompts: 0,
        traces: 0,
        conversations: 0,
        terminal: 0,
        code: 0,
        total: 0,
      };

      let totalSize = 0;

      // Count prompts
      if (requestedSources.includes('prompts')) {
        try {
          const sinceTs = since ? since.getTime() : 0;
          const untilTs = until ? until.getTime() : Date.now();
          const prompts = await persistentDB.getPromptsInTimeRange(
            sinceTs,
            untilTs,
            limit ? parseInt(limit) : 1000
          );
          counts.prompts = prompts.length;
          totalSize += JSON.stringify(prompts).length;
        } catch (err) {
          console.warn('[EXPORT-PREVIEW] Error counting prompts:', err.message);
        }
      }

      // Count code entries (file changes)
      if (requestedSources.includes('code') || requestedSources.includes('traces')) {
        try {
          const sinceTs = since ? since.getTime() : 0;
          const untilTs = until ? until.getTime() : Date.now();
          const workspacePath = workspaceFilters.length > 0 ? workspaceFilters[0] : null;
          const entries = await persistentDB.getEntriesInTimeRange(
            sinceTs,
            untilTs,
            workspacePath,
            limit ? parseInt(limit) : 1000
          );
          counts.code = entries.length;
          counts.traces = entries.length; // Entries are also traces
          totalSize += JSON.stringify(entries).length;
        } catch (err) {
          console.warn('[EXPORT-PREVIEW] Error counting entries:', err.message);
        }
      }

      // Count terminal commands
      if (requestedSources.includes('terminal')) {
        try {
          const terminal = await persistentDB.getTerminalCommands({
            limit: limit ? parseInt(limit) : 1000,
          });
          // Filter by date range if provided
          let filtered = terminal;
          if (since || until) {
            filtered = terminal.filter((cmd) => {
              const cmdTime = new Date(cmd.timestamp || cmd.created_at).getTime();
              if (since && cmdTime < since.getTime()) return false;
              if (until && cmdTime > until.getTime()) return false;
              return true;
            });
          }
          counts.terminal = filtered.length;
          totalSize += JSON.stringify(filtered).length;
        } catch (err) {
          console.warn('[EXPORT-PREVIEW] Error counting terminal:', err.message);
        }
      }

      counts.total = Object.values(counts).reduce((sum, count) => sum + count, 0);

      res.json({
        success: true,
        counts,
        estimatedSize: totalSize,
        filters: {
          rung: rung || 'clio',
          format: format || 'json',
          timeRange: timeRange || 'all',
          workspaces: workspaceFilters,
          dataSources: requestedSources,
        },
      });
    } catch (error) {
      console.error('[EXPORT-PREVIEW] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // JSON export with rung-aware controls
  app.get('/api/export/data', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 25000);
      const rungParam = Array.isArray(req.query.rung) ? req.query.rung[0] : req.query.rung;
      const rung = (rungParam || 'clio').toLowerCase();

      if (!RUNG_HIERARCHY.includes(rung)) {
        return res.status(400).json({
          success: false,
          error: `Invalid rung. Must be one of: ${RUNG_HIERARCHY.join(', ')}`,
        });
      }

      const traceTypesFilter = parseTraceTypesFromQuery(req.query);
      const hasTraceTypeFilter = traceTypesFilter.length > 0;
      const normalizedTraceTypes = (
        hasTraceTypeFilter ? traceTypesFilter : ['prompt', 'code', 'interaction', 'terminal']
      ).map((type) => type.toLowerCase());

      const includePrompt = normalizedTraceTypes.includes('prompt');
      const includeCode = normalizedTraceTypes.includes('code');
      const includeInteraction = normalizedTraceTypes.includes('interaction');
      const includeTerminal = normalizedTraceTypes.includes('terminal');

      const rungIndex = RUNG_HIERARCHY.indexOf(rung);
      const includesRung = (name) => RUNG_HIERARCHY.indexOf(name) <= rungIndex;

      const since = parseTimestampParam(req.query.since);
      const until = parseTimestampParam(req.query.until);

      const options = {
        limit,
        includeAllFields: req.query.full === 'true',
        since,
        until,
        excludeEvents: !(includeCode || includeInteraction),
        excludePrompts: !includePrompt,
        excludeTerminal: !includeTerminal,
        excludeContext: req.query.include_context === 'false',
        excludeMotifs: !includesRung('clio'),
        excludeModuleGraph: !includesRung('module_graph'),
        excludeRung1: !includesRung('tokens'),
        excludeRung2: !includesRung('semantic_edits'),
        excludeRung3: !includesRung('functions'),
        noCodeDiffs: req.query.no_code_diffs === 'true',
        noLinkedData: req.query.no_linked_data === 'true',
        noTemporalChunks: req.query.no_temporal_chunks === 'true',
        abstractionLevel: parseInt(
          req.query.abstraction_level || req.query.abstractionLevel || '0',
          10
        ),
        abstractPrompts:
          req.query.abstract_prompts === 'true' || req.query.abstractPrompts === 'true',
        extractPatterns:
          req.query.extract_patterns === 'true' || req.query.extractPatterns === 'true',
      };

      const filenameParts = ['cursor-export', rung];
      const workspaceFilters = parseWorkspaceFiltersFromQuery(req.query);
      if (workspaceFilters.length === 1) {
        filenameParts.push(workspaceFilters[0].split('/').pop());
      }
      const filename = `${filenameParts.filter(Boolean).join('-')}-${Date.now()}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      await handleStreamingExport(req, res, options);
    } catch (error) {
      console.error('[EXPORT] JSON export failed:', error);
      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  });

  // Database export with streaming support
  app.get('/api/export/database', async (req, res) => {
    try {
      console.log(' Export request received');

      // Check if streaming is requested
      const useStreaming = req.query.stream === 'true' || req.query.streaming === 'true';
      const streamThreshold = parseInt(req.query.stream_threshold) || 5000; // Stream if > 5000 items

      // Parse query parameters
      const limit = parseInt(req.query.limit) || 1000;
      const includeAllFields = req.query.full === 'true';

      // Get custom field configurations for export filtering
      let fieldConfigs = [];
      try {
        fieldConfigs = await persistentDB.getCustomFieldConfigs(null, null, true);
        console.log(
          `[EXPORT] Loaded ${fieldConfigs.length} field configurations for export filtering`
        );
      } catch (err) {
        console.warn('[EXPORT] Could not load field configs, exporting all fields:', err.message);
      }

      // Build field filter map: table -> field -> enabled
      const fieldFilter = new Map();
      fieldConfigs.forEach((config) => {
        if (!fieldFilter.has(config.table_name)) {
          fieldFilter.set(config.table_name, new Map());
        }
        fieldFilter.get(config.table_name).set(config.field_name, config.enabled === 1);
      });

      // Helper to filter object fields based on config
      const filterFields = (obj, tableName) => {
        if (!fieldFilter.has(tableName)) return obj; // No config = export all
        const tableConfig = fieldFilter.get(tableName);
        const filtered = {};
        for (const [key, value] of Object.entries(obj)) {
          const enabled = tableConfig.get(key);
          if (enabled === undefined || enabled === true) {
            // Field not configured or enabled = include it
            filtered[key] = value;
          }
          // If enabled === false, exclude the field
        }
        return filtered;
      };

      // Parse date strings - handle both ISO date strings (YYYY-MM-DD) and timestamps
      let since = null;
      let until = null;
      if (req.query.since) {
        // If it's a number, treat as timestamp; otherwise parse as date string
        if (!isNaN(req.query.since) && req.query.since.length > 10) {
          since = parseInt(req.query.since);
        } else {
          // ISO date string (YYYY-MM-DD) - convert to timestamp
          const date = new Date(req.query.since);
          since = date.getTime();
        }
      }
      if (req.query.until) {
        // If it's a number, treat as timestamp; otherwise parse as date string
        if (!isNaN(req.query.until) && req.query.until.length > 10) {
          until = parseInt(req.query.until);
        } else {
          // ISO date string (YYYY-MM-DD) - add end of day
          const date = new Date(req.query.until + 'T23:59:59.999Z');
          until = date.getTime();
        }
      }

      // Type filters
      const excludeEvents = req.query.exclude_events === 'true';
      const excludePrompts = req.query.exclude_prompts === 'true';
      const excludeTerminal = req.query.exclude_terminal === 'true';
      const excludeContext = req.query.exclude_context === 'true';
      const excludeMotifs = req.query.exclude_motifs === 'true';
      const excludeModuleGraph = req.query.exclude_module_graph === 'true';
      const excludeRung1 = req.query.exclude_rung1 === 'true';
      const excludeRung2 = req.query.exclude_rung2 === 'true';
      const excludeRung3 = req.query.exclude_rung3 === 'true';

      // Options
      const noCodeDiffs = req.query.no_code_diffs === 'true';
      const noLinkedData = req.query.no_linked_data === 'true';
      const noTemporalChunks = req.query.no_temporal_chunks === 'true';

      // Abstraction level (new)
      const abstractionLevel = parseInt(
        req.query.abstraction_level || req.query.abstractionLevel || '0'
      );
      const abstractPrompts =
        req.query.abstract_prompts === 'true' || req.query.abstractPrompts === 'true';
      const extractPatterns =
        req.query.extract_patterns === 'true' || req.query.extractPatterns === 'true';

      console.log(
        `[EXPORT] Limit: ${limit}, Since: ${since ? new Date(since).toISOString() : 'all'}, Until: ${until ? new Date(until).toISOString() : 'all'}`
      );
      console.log(
        `[EXPORT] Exclude: events=${excludeEvents}, prompts=${excludePrompts}, terminal=${excludeTerminal}, context=${excludeContext}, motifs=${excludeMotifs}, moduleGraph=${excludeModuleGraph}, rung1=${excludeRung1}, rung2=${excludeRung2}, rung3=${excludeRung3}`
      );
      console.log(
        `[EXPORT] Abstraction Level: ${abstractionLevel}, Abstract Prompts: ${abstractPrompts}, Extract Patterns: ${extractPatterns}`
      );
      console.log(
        `[EXPORT] Streaming: ${useStreaming || limit > streamThreshold} (threshold: ${streamThreshold})`
      );

      // Parse Rung 1 PII options from query params
      const rung1PIIOptions = {
        redactEmails: req.query.rung1_redact_emails !== 'false',
        redactNames: req.query.rung1_redact_names !== 'false',
        redactNumbers: req.query.rung1_redact_numbers !== 'false',
        redactUrls: req.query.rung1_redact_urls !== 'false',
        redactIpAddresses: req.query.rung1_redact_ip_addresses !== 'false',
        redactFilePaths: req.query.rung1_redact_file_paths !== 'false',
        redactJwtSecrets: req.query.rung1_redact_jwt_secrets !== 'false',
        redactAllStrings: req.query.rung1_redact_all_strings !== 'false',
        redactAllNumbers: req.query.rung1_redact_all_numbers !== 'false',
      };

      // Parse semantic expressiveness fuzzing option
      const rung1FuzzSemanticExpressiveness =
        req.query.rung1_fuzz_semantic_expressiveness === 'true';

      // Use streaming for large exports or if explicitly requested
      if (useStreaming || limit > streamThreshold) {
        return handleStreamingExport(req, res, {
          limit,
          includeAllFields,
          since,
          until,
          excludeEvents,
          excludePrompts,
          excludeTerminal,
          excludeContext,
          excludeMotifs,
          excludeModuleGraph,
          excludeRung1,
          excludeRung2,
          excludeRung3,
          noCodeDiffs,
          noLinkedData,
          noTemporalChunks,
          abstractionLevel,
          abstractPrompts,
          extractPatterns,
          fieldFilter, // Pass field filter to streaming handler
          rung1PIIOptions, // Pass PII options to streaming handler
          rung1FuzzSemanticExpressiveness, // Pass fuzzing option to streaming handler
        });
      }

      // Helper function to filter by date range
      const filterByDateRange = (items) => {
        if (!since && !until) return items;
        return items.filter((item) => {
          const itemTime = new Date(item.timestamp).getTime();
          if (since && itemTime < since) return false;
          if (until && itemTime > until) return false;
          return true;
        });
      };

      // Gather data from database with limits and filters
      const promises = [];

      if (!excludeEvents) {
        // Use time range filtering if dates are provided, otherwise get entries with code
        if (since || until) {
          promises.push(
            persistentDB.getEntriesInTimeRange(
              since || 0,
              until || Date.now(),
              null,
              Math.min(limit, 10000)
            )
          );
        } else {
          promises.push(persistentDB.getEntriesWithCode(Math.min(limit, 10000)));
        }
      } else {
        promises.push(Promise.resolve([]));
      }

      if (!excludePrompts) {
        // Use time range filtering if dates are provided, otherwise get recent prompts
        if (since || until) {
          promises.push(
            persistentDB.getPromptsInTimeRange(
              since || 0,
              until || Date.now(),
              Math.min(limit, 10000)
            )
          );
        } else {
          promises.push(persistentDB.getRecentPrompts(Math.min(limit, 10000)));
        }
      } else {
        promises.push(Promise.resolve([]));
      }

      if (!excludeEvents) {
        promises.push(persistentDB.getAllEvents());
      } else {
        promises.push(Promise.resolve([]));
      }

      if (!excludeTerminal) {
        promises.push(persistentDB.getAllTerminalCommands(Math.min(limit, 10000)));
      } else {
        promises.push(Promise.resolve([]));
      }

      if (!excludeContext) {
        promises.push(
          persistentDB.getContextSnapshots({ since: since || 0, limit: Math.min(limit, 10000) })
        );
      } else {
        promises.push(Promise.resolve([]));
      }

      if (!excludeMotifs && motifService) {
        promises.push(motifService.getMotifs({}));
      } else {
        promises.push(Promise.resolve([]));
      }

      promises.push(persistentDB.getContextAnalytics());

      const [
        entries,
        prompts,
        events,
        terminalCommands,
        contextSnapshots,
        motifs,
        contextAnalytics,
      ] = await Promise.all(promises);

      // Apply date range filtering
      let filteredEntries = filterByDateRange(entries);
      let filteredPrompts = filterByDateRange(prompts);
      let filteredEvents = filterByDateRange(events);
      let filteredTerminalCommands = filterByDateRange(terminalCommands);
      let filteredContextSnapshots = filterByDateRange(contextSnapshots);
      let filteredMotifs = filterByDateRange(motifs);

      // Apply workspace and data source filtering if access control is enabled
      const workspace = req.query.workspace || req.query.workspace_path || null;
      if (dataAccessControl) {
        filteredEntries = dataAccessControl.applyFilters(filteredEntries, { workspace });
        filteredPrompts = dataAccessControl.applyFilters(filteredPrompts, { workspace });
        filteredEvents = dataAccessControl.applyFilters(filteredEvents, { workspace });
        filteredTerminalCommands = dataAccessControl.applyFilters(filteredTerminalCommands, {
          workspace,
        });
        filteredContextSnapshots = dataAccessControl.applyFilters(filteredContextSnapshots, {
          workspace,
        });
      }

      // Enrich entries with diff stats and ensure code diffs are included
      const enrichedEntries = filteredEntries.map((entry) => {
        const diff = calculateDiffStats(
          entry.before_code || entry.before_content,
          entry.after_code || entry.after_content
        );
        const enriched = {
          ...entry,
          // Add computed diff stats
          diff_stats: {
            lines_added: diff.linesAdded,
            lines_removed: diff.linesRemoved,
            chars_added: diff.charsAdded,
            chars_deleted: diff.charsDeleted,
            has_diff: !!(entry.before_code || entry.after_code),
          },
        };

        // Only include code diffs if requested
        if (!noCodeDiffs) {
          enriched.before_code = entry.before_code || entry.before_content || '';
          enriched.after_code = entry.after_code || entry.after_content || '';
          enriched.before_content = entry.before_code || entry.before_content || '';
          enriched.after_content = entry.after_code || entry.after_content || '';
        } else {
          // Remove code content but keep metadata
          enriched.before_code = '';
          enriched.after_code = '';
          enriched.before_content = '';
          enriched.after_content = '';
        }

        return enriched;
      });

      // Create linked data structure: group prompts with their code changes
      const linkedData = [];
      const unlinkedEntries = [];
      const unlinkedPrompts = [];

      // Build lookup maps for fast access
      const promptMap = new Map(filteredPrompts.map((p) => [p.id, p]));
      const entryMap = new Map(enrichedEntries.map((e) => [e.id, e]));

      // Only build linked data if requested
      if (!noLinkedData) {
        // Group linked prompts and entries
        enrichedEntries.forEach((entry) => {
          if (entry.prompt_id) {
            const prompt = promptMap.get(entry.prompt_id);
            if (prompt) {
              linkedData.push({
                type: 'prompt_with_code_change',
                prompt: prompt,
                code_change: entry,
                linked_at: entry.timestamp,
                relationship: {
                  prompt_id: prompt.id,
                  entry_id: entry.id,
                  link_type: 'entry_to_prompt',
                },
              });
            } else {
              unlinkedEntries.push(entry);
            }
          } else {
            unlinkedEntries.push(entry);
          }
        });

        // Add prompts that link to entries (reverse direction)
        filteredPrompts.forEach((prompt) => {
          if (prompt.linked_entry_id || prompt.linkedEntryId) {
            const entryId = prompt.linked_entry_id || prompt.linkedEntryId;
            const entry = entryMap.get(entryId);
            // Only add if not already in linkedData
            const alreadyLinked = linkedData.some(
              (link) => link.prompt.id === prompt.id && link.code_change.id === entryId
            );
            if (entry && !alreadyLinked) {
              linkedData.push({
                type: 'prompt_with_code_change',
                prompt: prompt,
                code_change: entry,
                linked_at: prompt.timestamp,
                relationship: {
                  prompt_id: prompt.id,
                  entry_id: entry.id,
                  link_type: 'prompt_to_entry',
                },
              });
            }
          } else if (!linkedData.some((link) => link.prompt.id === prompt.id)) {
            unlinkedPrompts.push(prompt);
          }
        });
      } else {
        // If no linked data requested, mark all as unlinked
        enrichedEntries.forEach((entry) => {
          if (!entry.prompt_id) {
            unlinkedEntries.push(entry);
          }
        });
        filteredPrompts.forEach((prompt) => {
          if (!prompt.linked_entry_id && !prompt.linkedEntryId) {
            unlinkedPrompts.push(prompt);
          }
        });
      }

      // Sort linked data by timestamp
      linkedData.sort((a, b) => new Date(b.linked_at) - new Date(a.linked_at));

      // ============================================
      // NEW: Create temporal chunks/sessions
      // Groups prompts, code changes, and metadata by time proximity
      // ============================================
      const temporalChunks = [];
      const timeWindowMs = 5 * 60 * 1000; // 5 minutes

      // Combine all items with timestamps for temporal grouping
      const allTemporalItems = [
        ...enrichedEntries.map((e) => ({
          type: 'code_change',
          item: e,
          timestamp: new Date(e.timestamp).getTime(),
          file_path: e.file_path,
          workspace_path: e.workspace_path,
          model_info: e.modelInfo || null,
          diff_stats: e.diff_stats,
          before_code: e.before_code,
          after_code: e.after_code,
          prompt_id: e.prompt_id,
          metadata: {
            source: e.source,
            session_id: e.session_id,
            tags: e.tags || [],
            notes: e.notes,
            type: e.type,
          },
        })),
        ...filteredPrompts.map((p) => ({
          type: 'prompt',
          item: p,
          timestamp: new Date(p.timestamp).getTime(),
          file_path: null, // Prompts don't have file_path directly
          workspace_path: p.workspace_path,
          model_info: {
            model_type: p.model_type || p.modelType,
            model_name: p.model_name || p.modelName,
          },
          diff_stats: null,
          before_code: null,
          after_code: null,
          prompt_id: p.id,
          metadata: {
            source: p.source,
            mode: p.mode,
            workspace_id: p.workspace_id,
            workspace_name: p.workspace_name,
            composer_id: p.composer_id,
            context_usage: p.context_usage || p.contextUsage,
            context_file_count: p.context_file_count || p.contextFileCount,
            lines_added: p.lines_added || p.linesAdded,
            lines_removed: p.lines_removed || p.linesRemoved,
            conversation_title: p.conversation_title || p.conversationTitle,
            message_role: p.message_role || p.messageRole,
            thinking_time: p.thinking_time || p.thinkingTime,
          },
        })),
        ...filteredTerminalCommands.map((cmd) => ({
          type: 'terminal_command',
          item: cmd,
          timestamp: new Date(cmd.timestamp).getTime(),
          file_path: null,
          workspace_path: cmd.workspace,
          model_info: null,
          diff_stats: null,
          before_code: null,
          after_code: null,
          prompt_id: null,
          metadata: {
            command: cmd.command,
            exit_code: cmd.exit_code,
            shell: cmd.shell,
            source: cmd.source,
            duration: cmd.duration,
            linked_entry_id: cmd.linked_entry_id,
            linked_prompt_id: cmd.linked_prompt_id,
          },
        })),
      ].filter((item) => item.timestamp > 0); // Filter invalid timestamps

      // Sort by timestamp
      allTemporalItems.sort((a, b) => a.timestamp - b.timestamp);

      // Group into temporal chunks
      let currentChunk = null;
      allTemporalItems.forEach((item) => {
        if (!currentChunk || item.timestamp - currentChunk.end_time > timeWindowMs) {
          // Start new chunk
          if (currentChunk) {
            temporalChunks.push(currentChunk);
          }
          currentChunk = {
            id: `chunk-${item.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
            start_time: item.timestamp,
            end_time: item.timestamp,
            duration_seconds: 0,
            workspace_paths: new Set(),
            files_changed: new Set(),
            models_used: new Set(),
            items: [],
            summary: {
              prompts: 0,
              code_changes: 0,
              terminal_commands: 0,
              total_lines_added: 0,
              total_lines_removed: 0,
              total_chars_added: 0,
              total_chars_deleted: 0,
            },
          };
        }

        // Add item to current chunk
        currentChunk.items.push(item);
        currentChunk.end_time = Math.max(currentChunk.end_time, item.timestamp);
        currentChunk.duration_seconds = Math.round(
          (currentChunk.end_time - currentChunk.start_time) / 1000
        );

        // Track workspace
        if (item.workspace_path) {
          currentChunk.workspace_paths.add(item.workspace_path);
        }

        // Track files
        if (item.file_path) {
          currentChunk.files_changed.add(item.file_path);
        }

        // Track models
        if (item.model_info) {
          const modelName = item.model_info.model_name || item.model_info.modelName;
          const modelType = item.model_info.model_type || item.model_info.modelType;
          if (modelName || modelType) {
            currentChunk.models_used.add(
              modelType && modelName
                ? `${modelType}/${modelName}`
                : modelName || modelType || 'Unknown'
            );
          }
        }

        // Update summary
        if (item.type === 'prompt') currentChunk.summary.prompts++;
        if (item.type === 'code_change') {
          currentChunk.summary.code_changes++;
          if (item.diff_stats) {
            currentChunk.summary.total_lines_added += item.diff_stats.lines_added || 0;
            currentChunk.summary.total_lines_removed += item.diff_stats.lines_removed || 0;
            currentChunk.summary.total_chars_added += item.diff_stats.chars_added || 0;
            currentChunk.summary.total_chars_deleted += item.diff_stats.chars_deleted || 0;
          }
        }
        if (item.type === 'terminal_command') currentChunk.summary.terminal_commands++;
      });

      // Add final chunk
      if (currentChunk) {
        temporalChunks.push(currentChunk);
      }

      // Convert Sets to Arrays for JSON serialization and add linked relationships
      const enrichedChunks = temporalChunks.map((chunk) => {
        // Find linked relationships within this chunk
        const relationships = [];
        chunk.items.forEach((item) => {
          if (item.type === 'code_change' && item.prompt_id) {
            const linkedPrompt = chunk.items.find(
              (i) => i.type === 'prompt' && i.prompt_id === item.prompt_id
            );
            if (linkedPrompt) {
              relationships.push({
                type: 'prompt_to_code',
                prompt_id: item.prompt_id,
                code_change_id: item.item.id,
                time_gap_seconds: Math.abs((item.timestamp - linkedPrompt.timestamp) / 1000),
              });
            }
          }
        });

        return {
          ...chunk,
          start_time: new Date(chunk.start_time).toISOString(),
          end_time: new Date(chunk.end_time).toISOString(),
          workspace_paths: Array.from(chunk.workspace_paths),
          files_changed: Array.from(chunk.files_changed),
          models_used: Array.from(chunk.models_used),
          relationships: relationships,
          // Include full items with all metadata
          items: chunk.items.map((i) => ({
            type: i.type,
            id: i.item.id,
            timestamp: new Date(i.timestamp).toISOString(),
            // Code change metadata
            ...(i.type === 'code_change'
              ? {
                  file_path: i.file_path,
                  before_code: i.before_code,
                  after_code: i.after_code,
                  diff_stats: i.diff_stats,
                  model_info: i.model_info,
                  prompt_id: i.prompt_id,
                  metadata: i.metadata,
                }
              : {}),
            // Prompt metadata
            ...(i.type === 'prompt'
              ? {
                  text: i.item.text || i.item.prompt || i.item.content,
                  workspace_path: i.workspace_path,
                  model_info: i.model_info,
                  metadata: i.metadata,
                }
              : {}),
            // Terminal command metadata
            ...(i.type === 'terminal_command'
              ? {
                  command: i.metadata.command,
                  workspace_path: i.workspace_path,
                  exit_code: i.metadata.exit_code,
                  metadata: i.metadata,
                }
              : {}),
          })),
        };
      });

      // Get current schema version
      let schemaVersion = '1.0.0';
      try {
        const schema = await persistentDB.getSchema();
        schemaVersion = schema.version || '1.0.0';
      } catch (err) {
        console.warn('[EXPORT] Could not get schema version:', err.message);
      }

      // Get module graph data (Rung 4) if not excluded
      let moduleGraphData = null;
      if (!excludeModuleGraph && moduleGraphService) {
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;
          const graph = await moduleGraphService.getModuleGraph(workspace, { forceRefresh: false });
          moduleGraphData = {
            version: '1.0',
            rung: 4,
            description:
              'Content-free, compositional module graph with typed signals (imports, calls, context, navigation, tools)',
            nodes: graph.nodes || [],
            edges: graph.edges || [],
            events: graph.events || [],
            hierarchy: graph.hierarchy || {},
            metadata: graph.metadata || {},
          };
        } catch (error) {
          console.warn('[EXPORT] Failed to export module graph:', error.message);
          moduleGraphData = { error: error.message };
        }
      } else if (excludeModuleGraph) {
        moduleGraphData = { note: 'Module graph excluded from export' };
      } else {
        moduleGraphData = { note: 'Module graph service not available' };
      }

      // Get Functions data (Function-level representation) - Medium Privacy
      let rung3Data = null;
      if (!excludeRung3 && rung3Service) {
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;
          const changes = await rung3Service.getFunctionChanges(workspace, {});
          const functions = await rung3Service.getFunctions(workspace, {});
          const callgraph = await rung3Service.getCallGraph(workspace);
          const stats = await rung3Service.getFunctionStats(workspace);
          rung3Data = {
            version: '1.0',
            level: 'functions',
            description: 'Function-level changes and callgraph updates',
            functionChanges: changes || [],
            functions: functions || [],
            callgraph: callgraph || {},
            stats: stats || {},
          };
        } catch (error) {
          console.warn('[EXPORT] Failed to export Functions:', error.message);
          rung3Data = { error: error.message };
        }
      } else if (excludeRung3) {
        rung3Data = { note: 'Functions excluded from export' };
      } else {
        rung3Data = { note: 'Functions service not available' };
      }

      // Get Semantic Edits data (Statement-level semantic edit scripts) - Low Privacy
      let rung2Data = null;
      if (!excludeRung2 && rung2Service) {
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;
          const scripts = await rung2Service.getEditScripts(workspace, {});
          const operations = await rung2Service.getOperationTypes(workspace);
          rung2Data = {
            version: '1.0',
            level: 'semantic_edits',
            description: 'Semantic edit scripts from AST differencing',
            editScripts: scripts || [],
            operations: operations || {},
          };
        } catch (error) {
          console.warn('[EXPORT] Failed to export Semantic Edits:', error.message);
          rung2Data = { error: error.message };
        }
      } else if (excludeRung2) {
        rung2Data = { note: 'Semantic edits excluded from export' };
      } else {
        rung2Data = { note: 'Semantic edits service not available' };
      }

      // Get Tokens data (Token-level abstraction) - Lowest Privacy
      let rung1Data = null;
      if (!excludeRung1 && rung1Service) {
        try {
          const workspace = req.query.workspace || req.query.workspace_path || null;

          // Use PII options parsed earlier (or parse from query params if not available)
          const piiOptions = rung1PIIOptions || {
            redactEmails: req.query.rung1_redact_emails !== 'false',
            redactNames: req.query.rung1_redact_names !== 'false',
            redactNumbers: req.query.rung1_redact_numbers !== 'false',
            redactUrls: req.query.rung1_redact_urls !== 'false',
            redactIpAddresses: req.query.rung1_redact_ip_addresses !== 'false',
            redactFilePaths: req.query.rung1_redact_file_paths !== 'false',
            redactJwtSecrets: req.query.rung1_redact_jwt_secrets !== 'false',
            redactAllStrings: req.query.rung1_redact_all_strings !== 'false',
            redactAllNumbers: req.query.rung1_redact_all_numbers !== 'false',
          };

          // Use fuzzing option parsed earlier (or parse from query params if not available)
          const fuzzSemanticExpressiveness =
            rung1FuzzSemanticExpressiveness !== undefined
              ? rung1FuzzSemanticExpressiveness
              : req.query.rung1_fuzz_semantic_expressiveness === 'true';

          // Temporarily update Tokens service with options
          const originalPIIOptions = { ...rung1Service.piiOptions };
          const originalFuzzOption = rung1Service.fuzzSemanticExpressiveness;
          rung1Service.updatePIIOptions(piiOptions);
          rung1Service.setFuzzSemanticExpressiveness(fuzzSemanticExpressiveness);

          // Get tokens with options applied
          const tokens = await rung1Service.getTokens(workspace, {});
          const stats = await rung1Service.getTokenStats(workspace);

          // Restore original options
          rung1Service.updatePIIOptions(originalPIIOptions);
          rung1Service.setFuzzSemanticExpressiveness(originalFuzzOption);

          rung1Data = {
            version: '1.0',
            level: 'tokens',
            description: 'Token-level abstraction with canonicalized identifiers',
            tokens: tokens || [],
            stats: stats || {},
            piiOptions: piiOptions, // Include applied PII options in export
            fuzzSemanticExpressiveness: fuzzSemanticExpressiveness, // Include fuzzing option in export
          };
        } catch (error) {
          console.warn('[EXPORT] Failed to export Tokens:', error.message);
          rung1Data = { error: error.message };
        }
      } else if (excludeRung1) {
        rung1Data = { note: 'Tokens excluded from export' };
      } else {
        rung1Data = { note: 'Tokens service not available' };
      }

      // Get in-memory data with improved, organized structure
      const exportData = {
        // ============================================
        // METADATA SECTION - Export information and configuration
        // ============================================
        metadata: {
          // Export identification
          exportedAt: new Date().toISOString(),
          version: '2.5', // Bumped for better organization
          schema_version: schemaVersion,
          exportFormat: 'structured', // 'structured' or 'flat' (for backward compatibility)

          // Export configuration
          exportLimit: limit,
          fullExport: includeAllFields,
          dateRange: {
            since: since ? new Date(since).toISOString() : null,
            until: until ? new Date(until).toISOString() : null,
          },
          filters: {
            excludeEvents,
            excludePrompts,
            excludeTerminal,
            excludeContext,
            excludeMotifs,
            excludeModuleGraph,
            noCodeDiffs,
            noLinkedData,
            noTemporalChunks,
          },

          // Data counts (quick reference)
          counts: {
            entries: enrichedEntries.length,
            prompts: filteredPrompts.length,
            events: filteredEvents.length,
            terminalCommands: filteredTerminalCommands.length,
            contextSnapshots: filteredContextSnapshots.length,
            motifs: filteredMotifs.length,
            proceduralClio: {
              motifs: filteredMotifs.length,
              rung: 6,
            },
            linkedPairs: linkedData.length,
            temporalChunks: noTemporalChunks ? 0 : enrichedChunks.length,
            workspaces: (db.workspaces || []).length,
          },

          // Export notes
          note: limit < 10000 ? 'Limited export - use ?limit=10000 for more data' : 'Full export',
          organization: 'Structured format with clear sections for easy navigation',
        },

        // ============================================
        // CORE DATA SECTION - Primary data arrays
        // Organized by data type for easy access
        // ============================================
        data: {
          // File/Code changes (entries)
          codeChanges: enrichedEntries.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            file_path: e.file_path || e.filePath,
            workspace_path: e.workspace_path || e.workspacePath,
            type: e.type || 'file_change',
            source: e.source,
            session_id: e.session_id || e.sessionId,
            prompt_id: e.prompt_id || e.promptId, // Link to prompt if available
            diff_stats: e.diff_stats,
            // Code content (only if not excluded)
            ...(noCodeDiffs
              ? {}
              : {
                  before_code: e.before_code || e.before_content || '',
                  after_code: e.after_code || e.after_content || '',
                }),
            // Additional metadata
            tags: e.tags || [],
            notes: e.notes,
            modelInfo: e.modelInfo || e.model_info,
          })),

          // AI Prompts
          prompts: filteredPrompts.map((p) => ({
            id: p.id,
            timestamp: p.timestamp,
            text: p.text || p.prompt || p.content || p.preview || '',
            workspace_path: p.workspace_path || p.workspacePath,
            workspace_id: p.workspace_id || p.workspaceId,
            source: p.source || 'cursor',
            mode: p.mode,
            linked_entry_id: p.linked_entry_id || p.linkedEntryId, // Link to code change if available
            // Model information
            model_type: p.model_type || p.modelType,
            model_name: p.model_name || p.modelName,
            // Context information
            context_usage: p.context_usage || p.contextUsage || 0,
            context_file_count: p.context_file_count || p.contextFileCount || 0,
            // Conversation metadata
            conversation_id: p.conversation_id || p.conversationId,
            conversation_title: p.conversation_title || p.conversationTitle,
            message_role: p.message_role || p.messageRole,
            // Additional metadata
            lines_added: p.lines_added || p.linesAdded || 0,
            lines_removed: p.lines_removed || p.linesRemoved || 0,
            thinking_time: p.thinking_time || p.thinkingTime,
            composer_id: p.composer_id || p.composerId,
          })),

          // Activity Events (general activity tracking)
          events: filteredEvents.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            type: e.type || 'activity',
            workspace_path: e.workspace_path || e.workspacePath,
            session_id: e.session_id || e.sessionId,
            details: e.details || {},
            // Include AI-generated annotations if available
            ...(e.annotation
              ? { annotation: e.annotation, ai_generated: e.ai_generated || false }
              : {}),
            // Include other event metadata
            ...(e.tags
              ? { tags: typeof e.tags === 'string' ? JSON.parse(e.tags || '[]') : e.tags }
              : {}),
            ...(e.intent ? { intent: e.intent } : {}),
            ...(e.source ? { source: e.source } : {}),
            ...(e.file_path ? { file_path: e.file_path } : {}),
          })),

          // Terminal Commands
          terminalCommands: filteredTerminalCommands.map((cmd) => ({
            id: cmd.id,
            timestamp: cmd.timestamp,
            command: cmd.command,
            workspace: cmd.workspace || cmd.workspace_path,
            shell: cmd.shell,
            source: cmd.source,
            exit_code: cmd.exit_code || cmd.exitCode,
            duration: cmd.duration,
            output: cmd.output,
            error: cmd.error,
            linked_entry_id: cmd.linked_entry_id || cmd.linkedEntryId,
            linked_prompt_id: cmd.linked_prompt_id || cmd.linkedPromptId,
          })),

          // Context Snapshots
          contextSnapshots: filteredContextSnapshots.map((snapshot) => ({
            id: snapshot.id,
            timestamp: snapshot.timestamp,
            prompt_id: snapshot.prompt_id || snapshot.promptId,
            file_count: snapshot.current_file_count || snapshot.currentFileCount || 0,
            added_files: snapshot.addedFiles || [],
            removed_files: snapshot.removedFiles || [],
            net_change: snapshot.netChange || 0,
          })),

          // Procedural Clio: Motifs (Rung 6 - Procedural Patterns)
          // These are recurring procedural patterns extracted from canonical workflow DAGs
          proceduralClio: {
            version: '1.0',
            rung: 6,
            description:
              'Recurring procedural patterns (motifs) extracted from canonical workflow DAGs',
            motifs: filteredMotifs.map((motif) => ({
              id: motif.id,
              pattern: motif.pattern,
              sequence: motif.sequence || [],
              dominant_intent: motif.dominantIntent,
              shape: motif.shape,
              frequency: motif.frequency,
              confidence: motif.confidence,
              intents: motif.intents || {},
              stats: motif.stats || {},
              privacy: motif.privacy || {},
              created_at: motif.created_at || null,
              updated_at: motif.updated_at || null,
            })),
            // Note: Full Clio analysis (clusters, facets, canonical DAGs) is computed on-demand
            // and not persisted. Only motifs (Rung 6) are stored in the database.
            note: 'Only motifs (Rung 6) are exported. Full Clio clusters, facets, and canonical DAGs are computed on-demand and not persisted.',
          },

          // Module Graph (Rung 4 - File-level abstraction)
          moduleGraph: moduleGraphData,

          // Functions: Function-level representation (Medium Privacy)
          functions: rung3Data,

          // Semantic Edits: Statement-level (semantic edit scripts) (Low Privacy)
          semantic_edits: rung2Data,

          // Tokens: Token-level abstraction (Lowest Privacy)
          tokens: rung1Data,
        },

        // ============================================
        // RELATIONSHIPS SECTION - How data connects
        // ============================================
        relationships: {
          // Explicit prompt-to-code links (when prompt_id is set)
          linkedPairs: noLinkedData
            ? []
            : linkedData.map((link) => ({
                prompt_id: link.prompt.id,
                code_change_id: link.code_change.id,
                linked_at: link.linked_at,
                relationship_type: link.relationship.link_type,
                // Quick reference (not full objects to avoid duplication)
                prompt_timestamp: link.prompt.timestamp,
                code_change_timestamp: link.code_change.timestamp,
                time_gap_seconds: Math.abs(
                  (new Date(link.code_change.timestamp).getTime() -
                    new Date(link.prompt.timestamp).getTime()) /
                    1000
                ),
              })),

          // Items without explicit links (for analysis)
          unlinked: {
            codeChanges: unlinkedEntries.filter((e) => !e.prompt_id).map((e) => e.id),
            prompts: unlinkedPrompts.map((p) => p.id),
            note: 'These items have no explicit prompt_id/linked_entry_id links. They may be related by timestamp proximity in temporal_chunks.',
          },
        },

        // ============================================
        // CONVERSATION HIERARCHY - Full workspace → conversation → tabs → prompts structure
        // ============================================
        conversationHierarchy: (() => {
          // Build hierarchy: Workspace → Conversation → Tabs/Threads → Prompts
          const workspaceMap = new Map();

          filteredPrompts.forEach((prompt) => {
            const workspaceId =
              prompt.workspace_id ||
              prompt.workspaceId ||
              prompt.workspace_path ||
              prompt.workspacePath ||
              'unknown';
            const workspaceName =
              prompt.workspace_name ||
              prompt.workspaceName ||
              workspaceId.split('/').pop() ||
              'Unknown';

            if (!workspaceMap.has(workspaceId)) {
              workspaceMap.set(workspaceId, {
                id: workspaceId,
                name: workspaceName,
                path: prompt.workspace_path || prompt.workspacePath || workspaceId,
                conversations: new Map(),
                metadata: {
                  totalPrompts: 0,
                  totalConversations: 0,
                  lastActivity: null,
                },
              });
            }

            const workspace = workspaceMap.get(workspaceId);
            workspace.metadata.totalPrompts++;

            if (
              !workspace.metadata.lastActivity ||
              new Date(prompt.timestamp) > new Date(workspace.metadata.lastActivity)
            ) {
              workspace.metadata.lastActivity = prompt.timestamp;
            }

            // Group by conversation
            const conversationId =
              prompt.conversation_id ||
              prompt.conversationId ||
              prompt.composer_id ||
              prompt.composerId ||
              `${workspaceId}_${prompt.id || Date.now()}`;

            const parentConversationId =
              prompt.parent_conversation_id || prompt.parentConversationId || null;

            if (!workspace.conversations.has(conversationId)) {
              workspace.conversations.set(conversationId, {
                id: conversationId,
                title:
                  prompt.conversation_title || prompt.conversationTitle || 'Untitled Conversation',
                workspaceId: workspaceId,
                workspaceName: workspace.name,
                tabs: new Map(),
                rootPrompts: [],
                allPrompts: [],
                metadata: {
                  messageCount: 0,
                  userMessageCount: 0,
                  assistantMessageCount: 0,
                  firstMessage: null,
                  lastMessage: null,
                  duration: null,
                  models: new Set(),
                  contextFiles: new Set(),
                },
              });
            }

            const conversation = workspace.conversations.get(conversationId);
            conversation.allPrompts.push(prompt);

            // Handle tabs/threads
            if (parentConversationId && parentConversationId !== conversationId) {
              if (!conversation.tabs.has(parentConversationId)) {
                conversation.tabs.set(parentConversationId, {
                  id: parentConversationId,
                  title: `Tab ${parentConversationId.substring(0, 8)}`,
                  prompts: [],
                  metadata: {
                    messageCount: 0,
                    firstMessage: null,
                    lastMessage: null,
                  },
                });
              }
              const tab = conversation.tabs.get(parentConversationId);
              tab.prompts.push(prompt);
              tab.metadata.messageCount++;

              if (
                !tab.metadata.firstMessage ||
                new Date(prompt.timestamp) < new Date(tab.metadata.firstMessage)
              ) {
                tab.metadata.firstMessage = prompt.timestamp;
              }
              if (
                !tab.metadata.lastMessage ||
                new Date(prompt.timestamp) > new Date(tab.metadata.lastMessage)
              ) {
                tab.metadata.lastMessage = prompt.timestamp;
              }
            } else {
              conversation.rootPrompts.push(prompt);
            }

            // Update conversation metadata
            conversation.metadata.messageCount++;
            if (prompt.message_role === 'user' || !prompt.message_role) {
              conversation.metadata.userMessageCount++;
            } else if (prompt.message_role === 'assistant') {
              conversation.metadata.assistantMessageCount++;
            }

            if (
              !conversation.metadata.firstMessage ||
              new Date(prompt.timestamp) < new Date(conversation.metadata.firstMessage)
            ) {
              conversation.metadata.firstMessage = prompt.timestamp;
            }
            if (
              !conversation.metadata.lastMessage ||
              new Date(prompt.timestamp) > new Date(conversation.metadata.lastMessage)
            ) {
              conversation.metadata.lastMessage = prompt.timestamp;
            }

            if (prompt.model_name || prompt.modelName) {
              conversation.metadata.models.add(prompt.model_name || prompt.modelName);
            }
          });

          // Calculate durations and convert Sets to Arrays
          workspaceMap.forEach((workspace) => {
            workspace.conversations.forEach((conv) => {
              if (conv.metadata.firstMessage && conv.metadata.lastMessage) {
                const start = new Date(conv.metadata.firstMessage).getTime();
                const end = new Date(conv.metadata.lastMessage).getTime();
                conv.metadata.duration = end - start;
              }
              conv.metadata.models = Array.from(conv.metadata.models);
              conv.metadata.contextFiles = Array.from(conv.metadata.contextFiles);
              workspace.metadata.totalConversations++;
            });
          });

          // Convert to serializable structure
          return Array.from(workspaceMap.values()).map((ws) => ({
            id: ws.id,
            name: ws.name,
            path: ws.path,
            conversations: Array.from(ws.conversations.values()).map((conv) => ({
              id: conv.id,
              title: conv.title,
              workspaceId: conv.workspaceId,
              workspaceName: conv.workspaceName,
              tabs: Array.from(conv.tabs.values()).map((tab) => ({
                id: tab.id,
                title: tab.title,
                promptIds: tab.prompts.map((p) => p.id),
                metadata: tab.metadata,
              })),
              rootPromptIds: conv.rootPrompts.map((p) => p.id),
              allPromptIds: conv.allPrompts.map((p) => p.id),
              metadata: {
                ...conv.metadata,
                models: conv.metadata.models,
                contextFiles: conv.metadata.contextFiles,
              },
            })),
            metadata: ws.metadata,
          }));
        })(),

        // ============================================
        // TEMPORAL ORGANIZATION - Time-grouped activity
        // Groups related activity by time windows
        // ============================================
        ...(noTemporalChunks
          ? {}
          : {
              temporalChunks: enrichedChunks.map((chunk) => ({
                id: chunk.id,
                start_time: chunk.start_time,
                end_time: chunk.end_time,
                duration_seconds: chunk.duration_seconds,
                // Summary statistics
                summary: chunk.summary,
                // Workspaces involved
                workspaces: chunk.workspace_paths,
                // Files changed
                files_changed: chunk.files_changed,
                // Models used
                models_used: chunk.models_used,
                // Relationships within chunk
                relationships: chunk.relationships,
                // Item references (IDs only to avoid duplication)
                item_ids: chunk.items.map((i) => ({
                  type: i.type,
                  id: i.id,
                  timestamp: i.timestamp,
                })),
              })),
            }),

        // ============================================
        // ANALYTICS & STATISTICS SECTION
        // ============================================
        analytics: {
          // Context analytics
          context: contextAnalytics,

          // Overall statistics
          statistics: {
            totalSessions: enrichedEntries.length,
            totalFileChanges: enrichedEntries.length,
            totalAIPrompts: filteredPrompts.length,
            totalEvents: filteredEvents.length,
            totalTerminalCommands: filteredTerminalCommands.length,
            avgContextUsage: contextAnalytics.avgContextUtilization || 0,
            linkingRate:
              enrichedEntries.length > 0
                ? ((linkedData.length / enrichedEntries.length) * 100).toFixed(1) + '%'
                : '0%',
            linkedPairs: linkedData.length,
          },

          // Workspace information
          workspaces: (db.workspaces || []).map((ws) => ({
            path: ws,
            name: ws.split('/').pop() || ws,
          })),
        },

        // ============================================
        // BACKWARD COMPATIBILITY SECTION
        // Flat arrays for legacy code that expects them
        // ============================================
        _legacy: {
          entries: enrichedEntries,
          prompts: filteredPrompts,
          events: filteredEvents,
          terminal_commands: filteredTerminalCommands,
          context_snapshots: filteredContextSnapshots,
          linked_data: noLinkedData ? [] : linkedData,
          temporal_chunks: noTemporalChunks ? [] : enrichedChunks,
          workspaces: db.workspaces || [],
          context_analytics: contextAnalytics,
          unlinked: {
            entries: unlinkedEntries.filter((e) => !e.prompt_id),
            prompts: unlinkedPrompts,
          },
          stats: {
            sessions: enrichedEntries.length,
            fileChanges: enrichedEntries.length,
            aiInteractions: filteredPrompts.length,
            totalActivities: filteredEvents.length,
            terminalCommands: filteredTerminalCommands.length,
            avgContextUsage: contextAnalytics.avgContextUtilization || 0,
            linkedPairs: linkedData.length,
            linkingRate:
              enrichedEntries.length > 0
                ? ((linkedData.length / enrichedEntries.length) * 100).toFixed(1) + '%'
                : '0%',
          },
        },
      };

      // Apply abstraction if level > 0
      let finalExportData = exportData;
      if (abstractionLevel > 0) {
        console.log(`[ABSTRACTION] Applying level ${abstractionLevel} abstraction...`);
        finalExportData = abstractionEngine.abstractExportData(exportData, abstractionLevel, {
          abstractPrompts: abstractPrompts || abstractionLevel >= 2,
          extractPatterns: extractPatterns || abstractionLevel >= 3,
        });
        console.log(`[ABSTRACTION] Abstraction applied successfully`);
      }

      console.log(
        `[SUCCESS] Exported ${enrichedEntries.length} entries (${linkedData.length} linked to prompts), ${filteredPrompts.length} prompts, ${filteredEvents.length} events, ${filteredTerminalCommands.length} terminal commands, ${filteredContextSnapshots.length} context snapshots, ${filteredMotifs.length} motifs`
      );

      res.json({
        success: true,
        schema_version: schemaVersion,
        data: finalExportData,
      });
    } catch (error) {
      console.error('Error exporting database:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Lightweight CSV export for quick analysis
  app.get('/api/export/csv', async (req, res) => {
    try {
      if (!persistentDB) {
        return res.status(503).json({
          success: false,
          error: 'Database not available',
        });
      }

      await persistentDB.init();

      const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 20000);
      const workspaceFilters = parseWorkspaceFiltersFromQuery(req.query);
      const workspaceForDb = workspaceFilters.length === 1 ? workspaceFilters[0] : null;
      const since = parseTimestampParam(req.query.since);
      const until = parseTimestampParam(req.query.until);

      let entries = [];
      if (since || until || workspaceForDb) {
        entries = await persistentDB.getEntriesInTimeRange(
          since || 0,
          until || Date.now(),
          workspaceForDb,
          limit
        );
      } else {
        entries = await persistentDB.getEntriesWithCode(limit);
      }

      if (workspaceFilters.length > 1) {
        entries = entries.filter((entry) =>
          workspaceFilters.includes(entry.workspace_path || entry.workspacePath)
        );
      }

      entries = entries.slice(0, limit);

      const filenameParts = ['cursor-export'];
      if (workspaceFilters.length === 1) {
        filenameParts.push(workspaceFilters[0].split('/').pop());
      }
      const filename = `${filenameParts.join('-')}-${Date.now()}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      const formatCsvValue = (value) => {
        if (value === null || value === undefined) return '';
        const normalized = String(value).replace(/\r?\n/g, '\\n');
        if (/[",]/.test(normalized)) {
          return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
      };

      const header = [
        'id',
        'workspace',
        'file_path',
        'timestamp',
        'source',
        'lines_added',
        'lines_removed',
        'chars_added',
        'chars_deleted',
        'before_code',
        'after_code',
        'notes',
      ].join(',');

      res.write(`${header}\n`);

      entries.forEach((entry) => {
        const diff = calculateDiffStats(
          entry.before_code || entry.before_content || '',
          entry.after_code || entry.after_content || ''
        );

        const row = [
          formatCsvValue(entry.id),
          formatCsvValue(entry.workspace_path || entry.workspacePath || ''),
          formatCsvValue(entry.file_path || entry.filePath || ''),
          formatCsvValue(entry.timestamp),
          formatCsvValue(entry.source || ''),
          diff.linesAdded,
          diff.linesRemoved,
          diff.charsAdded,
          diff.charsDeleted,
          formatCsvValue(entry.before_code || entry.before_content || ''),
          formatCsvValue(entry.after_code || entry.after_content || ''),
          formatCsvValue(entry.notes || ''),
        ].join(',');

        res.write(`${row}\n`);
      });

      res.end();
    } catch (error) {
      console.error('[EXPORT] CSV export failed:', error);
      if (res.headersSent) {
        res.end();
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  });

  // Database import/redeploy endpoint - restore exported data
  app.post('/api/import/database', async (req, res) => {
    try {
      console.log('[IMPORT] Import request received');

      const importData = req.body;

      // Validate import data structure
      if (!importData || !importData.data) {
        return res.status(400).json({
          success: false,
          error: 'Invalid import data: missing "data" field',
        });
      }

      const data = importData.data;
      const options = req.body.options || {};
      const {
        overwrite = false, // If true, overwrite existing records; if false, skip duplicates
        skipLinkedData = false, // Skip linked_data and temporal_chunks if present
        dryRun = false, // If true, validate but don't import
        workspaceFilter = null, // If set, only import data for this workspace
        mergeStrategy = 'skip', // 'skip', 'overwrite', 'merge', 'append'
        workspaceMappings = {}, // Map imported workspace paths to local paths
      } = options;

      // Normalize data structure - handle both new structured format and legacy format
      let normalizedData = data;
      if (data.data && data.metadata) {
        // New structured format (v2.5+)
        console.log('[IMPORT] Detected structured export format');
        normalizedData = {
          // Use structured data section
          entries: data.data.codeChanges || [],
          prompts: data.data.prompts || [],
          events: data.data.events || [],
          terminal_commands: data.data.terminalCommands || [],
          context_snapshots: data.data.contextSnapshots || [],
          // Fall back to legacy if structured is empty
          ...(data._legacy || {}),
          // Preserve other sections
          workspaces: data.analytics?.workspaces?.map((w) => w.path) || data.workspaces || [],
          context_analytics: data.analytics?.context || data.context_analytics,
        };
      } else if (data.entries || data.prompts) {
        // Legacy format (v2.4 and earlier) - use as-is
        console.log('[IMPORT] Detected legacy export format');
        normalizedData = data;
      }

      // Helper to apply workspace mappings
      const mapWorkspace = (workspacePath) => {
        if (!workspacePath) return workspacePath;
        return workspaceMappings[workspacePath] || workspacePath;
      };

      // Get current schema for schema version comparison
      let currentSchema = null;
      let currentSchemaVersion = '1.0.0';
      try {
        currentSchema = await persistentDB.getSchema();
        currentSchemaVersion = currentSchema.version || '1.0.0';
      } catch (err) {
        console.warn('[IMPORT] Could not load current schema:', err.message);
      }

      // Detect import schema version
      const importSchemaVersion =
        importData.schema_version ||
        importData.metadata?.schema_version ||
        data.metadata?.schema_version ||
        '1.0.0';

      console.log(
        `[IMPORT] Schema versions - Import: ${importSchemaVersion}, Current: ${currentSchemaVersion}`
      );

      // Schema compatibility check and migration
      const schemaCompatible = importSchemaVersion === currentSchemaVersion;
      if (!schemaCompatible) {
        console.log(
          `[IMPORT] Schema version mismatch detected - will normalize data during import`
        );

        // Run migrations if needed (migrate to current version)
        if (!dryRun) {
          try {
            const migrationResult = await schemaMigrations.migrate();
            if (migrationResult.migrations.length > 0) {
              console.log(
                `[IMPORT] Schema migrations completed: ${migrationResult.migrations.length} migration(s) applied`
              );
            }
          } catch (migrationErr) {
            console.warn(`[IMPORT] Schema migration warning:`, migrationErr.message);
          }
        }

        // Normalize data structure
        try {
          const normalizedData = await schemaMigrations.normalizeData(
            data,
            importSchemaVersion,
            currentSchemaVersion
          );
          Object.assign(data, normalizedData);
        } catch (normalizeErr) {
          console.warn(`[IMPORT] Data normalization warning:`, normalizeErr.message);
        }
      }

      // Log audit event for import start
      if (!dryRun) {
        await persistentDB
          .logAuditEvent('Import started', 'import', {
            workspaceId: workspaceFilter,
            importVersion: importSchemaVersion,
            currentVersion: currentSchemaVersion,
            mergeStrategy,
            overwrite,
            status: 'in_progress',
          })
          .catch((err) => console.warn('[IMPORT] Could not log audit event:', err.message));
      }

      const stats = {
        entries: { imported: 0, skipped: 0, errors: 0 },
        prompts: { imported: 0, skipped: 0, errors: 0 },
        events: { imported: 0, skipped: 0, errors: 0 },
        terminalCommands: { imported: 0, skipped: 0, errors: 0 },
        contextSnapshots: { imported: 0, skipped: 0, errors: 0 },
        workspaces: { imported: 0, skipped: 0, errors: 0 },
      };

      // Helper to check if record exists and apply merge strategy
      const shouldImport = async (table, item) => {
        if (mergeStrategy === 'append') return true; // Always import with append

        // Filter by workspace if specified
        if (workspaceFilter) {
          const itemWorkspace =
            item.workspaceId || item.workspace_id || item.workspace_path || item.workspacePath;
          if (
            itemWorkspace &&
            !itemWorkspace.includes(workspaceFilter) &&
            !workspaceFilter.includes(itemWorkspace)
          ) {
            return false; // Skip items not matching workspace filter
          }
        }

        try {
          let existing = null;
          if (table === 'entries') {
            existing = await persistentDB.getEntryById(item.id);
          } else if (table === 'prompts') {
            existing = await persistentDB.getPromptById(item.id);
          }

          if (!existing) return true; // New item, import it

          // Item exists, apply merge strategy
          if (
            mergeStrategy === 'skip' ||
            (!overwrite && mergeStrategy !== 'overwrite' && mergeStrategy !== 'merge')
          ) {
            return false; // Skip existing
          } else if (mergeStrategy === 'overwrite' || overwrite) {
            return true; // Overwrite existing
          } else if (mergeStrategy === 'merge') {
            // Merge: combine data, prefer existing for conflicts
            Object.assign(item, existing, item);
            return true;
          }

          return false;
        } catch (err) {
          return true; // On error, try to import
        }
      };

      // Import entries
      if (data.entries && Array.isArray(data.entries)) {
        console.log(`[IMPORT] Processing ${data.entries.length} entries...`);

        for (const entry of data.entries) {
          try {
            if (!dryRun) {
              const shouldImportEntry = await shouldImport('entries', entry);
              if (!shouldImportEntry) {
                stats.entries.skipped++;
                continue;
              }

              // Normalize entry data
              const originalWorkspace = entry.workspace_path || entry.workspacePath;
              const normalizedEntry = {
                id: entry.id,
                session_id: entry.session_id || entry.sessionId,
                workspace_path: mapWorkspace(originalWorkspace),
                file_path: entry.file_path || entry.filePath,
                source: entry.source || 'imported',
                before_code: entry.before_code || entry.beforeCode || entry.before_content,
                after_code: entry.after_code || entry.afterCode || entry.after_content,
                notes: entry.notes || entry.description,
                timestamp: entry.timestamp,
                tags: entry.tags,
                prompt_id: entry.prompt_id || entry.promptId,
                modelInfo: entry.modelInfo || entry.model_info,
                type: entry.type || 'file_change',
              };

              await persistentDB.saveEntry(normalizedEntry);
              stats.entries.imported++;
            } else {
              stats.entries.imported++; // Count in dry run
            }
          } catch (error) {
            console.error(`[IMPORT] Error importing entry ${entry.id}:`, error.message);
            stats.entries.errors++;
          }
        }
      }

      // Import prompts
      if (data.prompts && Array.isArray(data.prompts)) {
        console.log(`[IMPORT] Processing ${data.prompts.length} prompts...`);

        for (const prompt of data.prompts) {
          try {
            if (!dryRun) {
              const shouldImportPrompt = await shouldImport('prompts', prompt);
              if (!shouldImportPrompt) {
                stats.prompts.skipped++;
                continue;
              }

              // Normalize prompt data
              const originalPromptWorkspace =
                prompt.workspace_path || prompt.workspacePath || prompt.workspaceId;
              const normalizedPrompt = {
                id: prompt.id,
                timestamp: prompt.timestamp,
                text: prompt.text || prompt.prompt || prompt.preview || prompt.content,
                status: prompt.status || 'captured',
                workspace_path: mapWorkspace(originalPromptWorkspace),
                workspace_id: mapWorkspace(originalPromptWorkspace),
                linked_entry_id: prompt.linked_entry_id || prompt.linkedEntryId,
                source: prompt.source || 'imported',
                workspaceId: prompt.workspaceId || prompt.workspace_id,
                workspacePath: prompt.workspacePath || prompt.workspace_path,
                workspaceName: prompt.workspaceName || prompt.workspace_name,
                composerId: prompt.composerId || prompt.composer_id,
                subtitle: prompt.subtitle,
                linesAdded: prompt.linesAdded || prompt.lines_added || 0,
                linesRemoved: prompt.linesRemoved || prompt.lines_removed || 0,
                contextUsage: prompt.contextUsage || prompt.context_usage || 0,
                mode: prompt.mode,
                modelType: prompt.modelType || prompt.model_type,
                modelName: prompt.modelName || prompt.model_name,
                forceMode: prompt.forceMode || prompt.force_mode,
                isAuto: prompt.isAuto || prompt.is_auto || false,
                type: prompt.type,
                confidence: prompt.confidence,
                added_from_database: false, // Mark as imported, not from Cursor DB
                contextFiles: prompt.contextFiles || prompt.context_files,
                terminalBlocks: prompt.terminalBlocks || prompt.terminal_blocks,
                thinkingTime: prompt.thinkingTime || prompt.thinking_time,
                thinkingTimeSeconds: prompt.thinkingTimeSeconds || prompt.thinking_time_seconds,
                hasAttachments: prompt.hasAttachments || prompt.has_attachments || false,
                attachmentCount: prompt.attachmentCount || prompt.attachment_count || 0,
                conversationTitle: prompt.conversationTitle || prompt.conversation_title,
                messageRole: prompt.messageRole || prompt.message_role,
                parentConversationId: prompt.parentConversationId || prompt.parent_conversation_id,
                conversationId:
                  prompt.conversationId || prompt.composerId || prompt.parentConversationId,
                conversationIndex: prompt.conversationIndex || prompt.conversation_index,
              };

              // Update conversation metadata if conversation_id is set
              if (normalizedPrompt.conversationId && normalizedPrompt.workspaceId) {
                await persistentDB
                  .updateConversationMetadata(
                    normalizedPrompt.conversationId,
                    normalizedPrompt.workspaceId,
                    normalizedPrompt.workspacePath,
                    normalizedPrompt.conversationTitle
                  )
                  .catch((err) =>
                    console.warn('[IMPORT] Could not update conversation:', err.message)
                  );
              }

              await persistentDB.savePrompt(normalizedPrompt);
              stats.prompts.imported++;
            } else {
              stats.prompts.imported++;
            }
          } catch (error) {
            console.error(`[IMPORT] Error importing prompt ${prompt.id}:`, error.message);
            stats.prompts.errors++;
          }
        }
      }

      // Import events
      if (data.events && Array.isArray(data.events)) {
        console.log(`[IMPORT] Processing ${data.events.length} events...`);

        for (const event of data.events) {
          try {
            if (!dryRun) {
              const normalizedEvent = {
                id: event.id || `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                session_id: event.session_id || event.sessionId,
                workspace_path: event.workspace_path || event.workspacePath,
                timestamp: event.timestamp,
                type: event.type || 'activity',
                details: event.details || event.metadata || {},
              };

              await persistentDB.saveEvent(normalizedEvent);
              stats.events.imported++;
            } else {
              stats.events.imported++;
            }
          } catch (error) {
            console.error(`[IMPORT] Error importing event:`, error.message);
            stats.events.errors++;
          }
        }
      }

      // Import terminal commands
      if (data.terminal_commands && Array.isArray(data.terminal_commands)) {
        console.log(`[IMPORT] Processing ${data.terminal_commands.length} terminal commands...`);

        for (const cmd of data.terminal_commands) {
          try {
            if (!dryRun) {
              const normalizedCmd = {
                id: cmd.id || `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                command: cmd.command,
                shell: cmd.shell || cmd.metadata?.shell,
                source: cmd.source || cmd.metadata?.source || 'imported',
                timestamp: cmd.timestamp || cmd.metadata?.timestamp,
                workspace: cmd.workspace || cmd.workspace_path || cmd.metadata?.workspace,
                output: cmd.output || cmd.metadata?.output,
                exitCode: cmd.exit_code || cmd.exitCode || cmd.metadata?.exit_code,
                duration: cmd.duration || cmd.metadata?.duration,
                error: cmd.error || cmd.metadata?.error,
                linkedEntryId: cmd.linked_entry_id || cmd.linkedEntryId,
                linkedPromptId: cmd.linked_prompt_id || cmd.linkedPromptId,
                sessionId: cmd.session_id || cmd.sessionId,
              };

              await persistentDB.saveTerminalCommand(normalizedCmd);
              stats.terminalCommands.imported++;
            } else {
              stats.terminalCommands.imported++;
            }
          } catch (error) {
            console.error(`[IMPORT] Error importing terminal command:`, error.message);
            stats.terminalCommands.errors++;
          }
        }
      }

      // Import context snapshots (if present)
      if (data.context_snapshots && Array.isArray(data.context_snapshots)) {
        console.log(`[IMPORT] Processing ${data.context_snapshots.length} context snapshots...`);
        // Context snapshots are typically derived from prompts, so we'll skip explicit import
        // unless there's a dedicated table for them
        stats.contextSnapshots.skipped = data.context_snapshots.length;
      }

      // Import workspaces (add to in-memory db.workspaces)
      if (data.workspaces && Array.isArray(data.workspaces)) {
        console.log(`[IMPORT] Processing ${data.workspaces.length} workspaces...`);

        if (!dryRun) {
          for (const workspace of data.workspaces) {
            try {
              const workspacePath = workspace.path || workspace.workspace_path || workspace;
              if (workspacePath && !db.workspaces.includes(workspacePath)) {
                db.workspaces.push(workspacePath);
                stats.workspaces.imported++;
              } else {
                stats.workspaces.skipped++;
              }
            } catch (error) {
              console.error(`[IMPORT] Error importing workspace:`, error.message);
              stats.workspaces.errors++;
            }
          }
        } else {
          stats.workspaces.imported = data.workspaces.length;
        }
      }

      // Reload in-memory data from database after import
      if (!dryRun) {
        console.log('[IMPORT] Reloading in-memory data from database...');
        const recentEntries = await persistentDB.getRecentEntries(1000);
        const recentPrompts = await persistentDB.getRecentPrompts(1000);
        db.entries = recentEntries;
        db.prompts = recentPrompts;
      }

      const totalImported =
        stats.entries.imported +
        stats.prompts.imported +
        stats.events.imported +
        stats.terminalCommands.imported +
        stats.contextSnapshots.imported +
        stats.workspaces.imported;

      const totalSkipped =
        stats.entries.skipped +
        stats.prompts.skipped +
        stats.events.skipped +
        stats.terminalCommands.skipped +
        stats.contextSnapshots.skipped +
        stats.workspaces.skipped;

      const totalErrors =
        stats.entries.errors +
        stats.prompts.errors +
        stats.events.errors +
        stats.terminalCommands.errors +
        stats.contextSnapshots.errors +
        stats.workspaces.errors;

      console.log(
        `[SUCCESS] Import completed: ${totalImported} imported, ${totalSkipped} skipped, ${totalErrors} errors`
      );

      // Log audit event for import completion
      if (!dryRun) {
        await persistentDB
          .logAuditEvent('Import completed', 'import', {
            workspaceId: workspaceFilter,
            importVersion: importSchemaVersion,
            currentVersion: currentSchemaVersion,
            mergeStrategy,
            overwrite,
            totalImported,
            totalSkipped,
            totalErrors,
            status: totalErrors > 0 ? 'partial' : 'success',
          })
          .catch((err) => console.warn('[IMPORT] Could not log audit event:', err.message));
      }

      res.json({
        success: true,
        dryRun,
        stats,
        summary: {
          totalImported,
          totalSkipped,
          totalErrors,
          overwrite,
          mergeStrategy,
          workspaceFilter,
          timestamp: new Date().toISOString(),
        },
        schema: {
          importVersion: importSchemaVersion,
          currentVersion: currentSchemaVersion,
          compatible: schemaCompatible,
        },
        message: dryRun
          ? `Dry run: Would import ${totalImported} items (${totalSkipped} would be skipped)`
          : `Successfully imported ${totalImported} items (${totalSkipped} skipped, ${totalErrors} errors)`,
      });
    } catch (error) {
      console.error('Error importing database:', error);

      // Log audit event for import failure
      if (!req.body.options?.dryRun) {
        await persistentDB
          .logAuditEvent('Import failed', 'import', {
            workspaceId: req.body.options?.workspaceFilter,
            error: error.message,
            status: 'error',
          })
          .catch((err) => console.warn('[IMPORT] Could not log audit event:', err.message));
      }

      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  });
}

module.exports = createExportImportRoutes;
