/**
 * Procedural Knowledge Builder
 * Automatically builds procedural knowledge representations (motifs, rungs) from captured data
 */

class ProceduralKnowledgeBuilder {
  constructor(persistentDB, motifService, rung1Service, rung2Service, rung3Service, options = {}) {
    this.db = persistentDB;
    this.motifService = motifService;
    this.rung1Service = rung1Service;
    this.rung2Service = rung2Service;
    this.rung3Service = rung3Service;

    this.options = {
      autoBuildEnabled: options.autoBuildEnabled !== false, // Default: enabled
      batchSize: options.batchSize || 50, // Process after N new items
      interval: options.interval || 5 * 60 * 1000, // Check every 5 minutes
      minDataForMotifs: options.minDataForMotifs || 100, // Minimum data points for motif extraction
      ...options,
    };

    this.pendingCounts = {
      entries: 0,
      prompts: 0,
      events: 0,
    };

    this.lastProcessTime = 0;
    this.processingInterval = null;
    this.isProcessing = false;
  }

  /**
   * Start automatic processing
   */
  start() {
    if (!this.options.autoBuildEnabled) {
      console.log('[PROCEDURAL-KNOWLEDGE] Auto-build disabled');
      return;
    }

    console.log('[PROCEDURAL-KNOWLEDGE] Starting automatic procedural knowledge builder');

    // Process periodically
    this.processingInterval = setInterval(() => {
      this.processIfNeeded().catch((err) => {
        console.warn('[PROCEDURAL-KNOWLEDGE] Error in periodic processing:', err.message);
      });
    }, this.options.interval);

    // Initial check
    this.processIfNeeded().catch((err) => {
      console.warn('[PROCEDURAL-KNOWLEDGE] Error in initial processing:', err.message);
    });
  }

  /**
   * Stop automatic processing
   */
  stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
  }

  /**
   * Notify that new data was captured
   */
  notifyDataCaptured(type, count = 1) {
    if (!this.options.autoBuildEnabled) return;

    this.pendingCounts[type] = (this.pendingCounts[type] || 0) + count;

    // Trigger processing if batch size reached
    if (this.pendingCounts[type] >= this.options.batchSize) {
      this.processIfNeeded().catch((err) => {
        console.warn('[PROCEDURAL-KNOWLEDGE] Error processing after batch:', err.message);
      });
    }
  }

  /**
   * Process if enough data has accumulated
   */
  async processIfNeeded() {
    if (this.isProcessing) {
      return;
    }

    const totalPending = Object.values(this.pendingCounts).reduce((a, b) => a + b, 0);

    if (totalPending < this.options.batchSize) {
      return; // Not enough data yet
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      console.log('[PROCEDURAL-KNOWLEDGE] Starting automatic processing...');

      // Process in background (don't block)
      setImmediate(async () => {
        try {
          await this.buildProceduralKnowledge();

          // Reset pending counts
          this.pendingCounts = { entries: 0, prompts: 0, events: 0 };
          this.lastProcessTime = Date.now();

          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[PROCEDURAL-KNOWLEDGE] Processing complete in ${duration}s`);
        } catch (error) {
          console.error('[PROCEDURAL-KNOWLEDGE] Error building procedural knowledge:', error);
        } finally {
          this.isProcessing = false;
        }
      });
    } catch (error) {
      this.isProcessing = false;
      throw error;
    }
  }

  /**
   * Build procedural knowledge representations
   */
  async buildProceduralKnowledge() {
    if (!this.db) {
      console.warn('[PROCEDURAL-KNOWLEDGE] Database not available');
      return;
    }

    try {
      // Get recent data for processing
      let entries = [];
      let prompts = [];
      let events = [];

      try {
        // Get entries with code (file changes)
        entries = await this.db.getRecentEntries(this.options.batchSize * 2);

        // Get recent prompts
        prompts = await this.db.getRecentPrompts(this.options.batchSize * 2);

        // Get recent events
        events = await this.db.getRecentEvents(this.options.batchSize * 2);
      } catch (error) {
        console.warn('[PROCEDURAL-KNOWLEDGE] Error fetching data:', error.message);
      }

      console.log(
        `[PROCEDURAL-KNOWLEDGE] Processing ${entries.length} entries, ${prompts.length} prompts, ${events.length} events`
      );

      // Build Rung 1-3 abstractions from file changes
      if (this.rung1Service && entries.length > 0) {
        await this.buildRungAbstractions(entries);
      }

      // Build motifs if enough data
      if (this.motifService && entries.length + prompts.length >= this.options.minDataForMotifs) {
        await this.buildMotifs(entries, prompts, events);
      }
    } catch (error) {
      console.error('[PROCEDURAL-KNOWLEDGE] Error in buildProceduralKnowledge:', error);
      throw error;
    }
  }

  /**
   * Build Rung 1-3 abstractions
   */
  async buildRungAbstractions(entries) {
    try {
      // Group entries by workspace
      const workspaceGroups = new Map();
      for (const entry of entries) {
        const workspace = entry.workspace_path || entry.workspacePath || 'default';
        if (!workspaceGroups.has(workspace)) {
          workspaceGroups.set(workspace, []);
        }
        workspaceGroups.get(workspace).push(entry);
      }

      // Process each workspace
      for (const [workspace, workspaceEntries] of workspaceGroups) {
        // Rung 1: Token-level abstraction
        if (this.rung1Service) {
          try {
            await this.rung1Service.extractTokens(workspace, {
              entries: workspaceEntries,
              autoProcess: true,
            });
          } catch (err) {
            console.warn(
              `[PROCEDURAL-KNOWLEDGE] Rung 1 extraction failed for ${workspace}:`,
              err.message
            );
          }
        }

        // Rung 2: Statement-level abstraction
        if (this.rung2Service) {
          try {
            await this.rung2Service.extractEditScripts(workspace, {
              entries: workspaceEntries,
              autoProcess: true,
            });
          } catch (err) {
            console.warn(
              `[PROCEDURAL-KNOWLEDGE] Rung 2 extraction failed for ${workspace}:`,
              err.message
            );
          }
        }

        // Rung 3: Function-level abstraction
        if (this.rung3Service) {
          try {
            await this.rung3Service.extractFunctions(workspace, {
              entries: workspaceEntries,
              autoProcess: true,
            });
          } catch (err) {
            console.warn(
              `[PROCEDURAL-KNOWLEDGE] Rung 3 extraction failed for ${workspace}:`,
              err.message
            );
          }
        }
      }

      console.log(
        `[PROCEDURAL-KNOWLEDGE] Built Rung 1-3 abstractions for ${workspaceGroups.size} workspaces`
      );
    } catch (error) {
      console.error('[PROCEDURAL-KNOWLEDGE] Error building Rung abstractions:', error);
    }
  }

  /**
   * Build motifs from canonical DAGs
   */
  async buildMotifs(entries, prompts, events) {
    if (!this.motifService) {
      return;
    }

    try {
      // Build canonical DAGs from entries, prompts, and events
      const canonicalDAGs = await this.buildCanonicalDAGs(entries, prompts, events);

      if (canonicalDAGs.length === 0) {
        console.log('[PROCEDURAL-KNOWLEDGE] No canonical DAGs to process for motifs');
        return;
      }

      console.log(
        `[PROCEDURAL-KNOWLEDGE] Processing ${canonicalDAGs.length} canonical DAGs for motifs`
      );

      // Extract motifs
      const motifs = await this.motifService.processDAGsToMotifs(canonicalDAGs, {
        forceRefresh: false,
        minClusterSize: 10,
      });

      console.log(`[PROCEDURAL-KNOWLEDGE] Extracted ${motifs.length} motifs`);
    } catch (error) {
      console.error('[PROCEDURAL-KNOWLEDGE] Error building motifs:', error);
    }
  }

  /**
   * Build canonical DAGs from data
   */
  async buildCanonicalDAGs(entries, prompts, events) {
    // Group related items by workspace and time windows
    const dags = [];
    const timeWindow = 5 * 60 * 1000; // 5 minutes

    // Create temporal groups
    const allItems = [
      ...entries.map((e) => ({ ...e, type: 'entry', time: new Date(e.timestamp).getTime() })),
      ...prompts.map((p) => ({ ...p, type: 'prompt', time: new Date(p.timestamp).getTime() })),
      ...events.map((e) => ({ ...e, type: 'event', time: new Date(e.timestamp).getTime() })),
    ].sort((a, b) => a.time - b.time);

    let currentGroup = [];
    let groupStartTime = null;

    for (const item of allItems) {
      if (!groupStartTime || item.time - groupStartTime > timeWindow) {
        // Start new group
        if (currentGroup.length > 0) {
          dags.push(this.createDAGFromGroup(currentGroup));
        }
        currentGroup = [item];
        groupStartTime = item.time;
      } else {
        currentGroup.push(item);
      }
    }

    // Add final group
    if (currentGroup.length > 0) {
      dags.push(this.createDAGFromGroup(currentGroup));
    }

    return dags;
  }

  /**
   * Create a canonical DAG from a group of items
   */
  createDAGFromGroup(group) {
    // Extract sequence of actions
    const sequence = group.map((item) => {
      if (item.type === 'entry') {
        return `FILE_CHANGE:${item.file_path || item.filePath || 'unknown'}`;
      } else if (item.type === 'prompt') {
        return `PROMPT:${item.text?.substring(0, 50) || 'unknown'}`;
      } else if (item.type === 'event') {
        return `EVENT:${item.type || 'unknown'}`;
      }
      return 'UNKNOWN';
    });

    // Extract intent from prompts
    const intents = group
      .filter((item) => item.type === 'prompt')
      .map((item) => item.intent || 'unknown');

    return {
      id: `DAG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sequence,
      intents,
      workspace: group[0]?.workspace_path || group[0]?.workspacePath || 'unknown',
      timestamp: group[0]?.time || Date.now(),
      items: group,
    };
  }
}

module.exports = ProceduralKnowledgeBuilder;
