/**
 * Rung 4 Edge Detector
 * Detects typed edges between modules (files) for the module graph
 */

class Rung4EdgeDetector {
  constructor() {
    this.edgeIdCounter = 0;
  }

  /**
   * Detect all edge types between modules
   */
  detectAllEdges(fileMetadata, modelContext, toolInteractions, fileIdMap) {
    const edges = [];

    // 1. EDIT_SEQUENCE edges (temporal co-editing)
    edges.push(...this.detectEditSequenceEdges(fileMetadata, fileIdMap));

    // 2. MODEL_CONTEXT edges (LLM context files)
    edges.push(...this.detectModelContextEdges(modelContext, fileIdMap));

    // 3. TOOL_INTERACTION edges (terminal, jupyter, etc.)
    edges.push(...this.detectToolInteractionEdges(toolInteractions, fileIdMap));

    // 4. IMPORT edges (static code analysis) - Placeholder for future
    // edges.push(...this.detectImportEdges(fileMetadata, fileIdMap));

    return edges;
  }

  /**
   * Detect EDIT_SEQUENCE edges (files edited within time window)
   */
  detectEditSequenceEdges(fileMetadata, fileIdMap) {
    const edges = [];
    const TIME_WINDOW = 5 * 60 * 1000; // 5 minutes

    const allEdits = [];
    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      for (const diff of metadata.diffs || []) {
        allEdits.push({
          filePath,
          timestamp: diff.timestamp || Date.now(),
          diffId: diff.diffId,
        });
      }
    }

    // Sort by timestamp
    allEdits.sort((a, b) => a.timestamp - b.timestamp);

    // Find co-edits within time window
    for (let i = 0; i < allEdits.length - 1; i++) {
      const edit1 = allEdits[i];
      const edit2 = allEdits[i + 1];

      if (edit1.filePath !== edit2.filePath && edit2.timestamp - edit1.timestamp <= TIME_WINDOW) {
        const sourceId = fileIdMap.get(edit1.filePath);
        const targetId = fileIdMap.get(edit2.filePath);

        if (sourceId && targetId) {
          edges.push({
            id: `EDGE_${String(this.edgeIdCounter++).padStart(3, '0')}`,
            type: 'EDIT_SEQUENCE',
            source: sourceId,
            target: targetId,
            weight: 1,
            metadata: {
              time_gap_ms: edit2.timestamp - edit1.timestamp,
              source_diff_id: edit1.diffId,
              target_diff_id: edit2.diffId,
            },
          });
        }
      }
    }

    return edges;
  }

  /**
   * Detect MODEL_CONTEXT edges (files used as LLM context)
   */
  detectModelContextEdges(modelContext, fileIdMap) {
    const edges = [];

    for (const [targetFile, contextFiles] of Object.entries(modelContext)) {
      const targetId = fileIdMap.get(targetFile);
      if (!targetId) continue;

      for (const contextFile of contextFiles) {
        const contextId = fileIdMap.get(contextFile);
        if (!contextId) continue;

        edges.push({
          id: `EDGE_${String(this.edgeIdCounter++).padStart(3, '0')}`,
          type: 'MODEL_CONTEXT',
          source: contextId,
          target: targetId,
          weight: 1,
          metadata: {
            context_type: 'llm_context',
          },
        });
      }
    }

    return edges;
  }

  /**
   * Detect TOOL_INTERACTION edges (terminal commands affecting files)
   */
  detectToolInteractionEdges(toolInteractions, fileIdMap) {
    const edges = [];

    for (const interaction of toolInteractions) {
      if (interaction.type === 'terminal' && interaction.command) {
        // Parse file paths from common commands
        const filePaths = this.extractFilePathsFromCommand(interaction.command);

        for (const filePath of filePaths) {
          const fileId = fileIdMap.get(filePath);
          if (fileId) {
            edges.push({
              id: `EDGE_${String(this.edgeIdCounter++).padStart(3, '0')}`,
              type: 'TOOL_INTERACTION',
              source: null, // Terminal is external
              target: fileId,
              weight: 1,
              metadata: {
                tool: 'terminal',
                command: interaction.command,
                workspace: interaction.workspace,
              },
            });
          }
        }
      }
    }

    return edges;
  }

  /**
   * Extract file paths from terminal commands (basic heuristic)
   */
  extractFilePathsFromCommand(command) {
    const filePaths = [];
    const parts = command.split(/\s+/);

    for (const part of parts) {
      // Look for file-like patterns (contains / and extension)
      if (part.includes('/') && /\.[a-z]{1,4}$/i.test(part)) {
        filePaths.push(part);
      }
    }

    return filePaths;
  }

  /**
   * Detect IMPORT edges from static code analysis
   * TODO: Implement AST parsing for import detection
   */
  detectImportEdges(fileMetadata, fileIdMap) {
    const edges = [];
    // Future: Parse imports from source code
    return edges;
  }
}

module.exports = Rung4EdgeDetector;
