/**
 * Module Graph Edge Detector
 * Unified edge detector for all edge types (imports, calls, model context, navigation, tool, edit sequences)
 */

const path = require('path');
const fs = require('fs');
const { getConfig } = require('./config');
const ASTImportDetector = require('./ast-import-detector');
const ImportResolver = require('./import-resolver');

class ModuleGraphEdgeDetector {
  constructor(options = {}) {
    this.edgeIdCounter = 0;
    this.options = {
      deduplicate: options.deduplicate !== false, // Default true
      workspaceRoot: options.workspaceRoot || null,
      ...options,
    };

    // Initialize AST import detector if enabled
    this.useAST = getConfig('edges.import.useAST', true);
    if (this.useAST) {
      this.astImportDetector = new ASTImportDetector();
    }

    // Initialize import resolver
    this.importResolver = new ImportResolver(this.options.workspaceRoot);

    this.importPatterns = {
      js: [
        /import\s+.*?\s+from\s+['"](.+?)['"]/g,
        /require\(['"](.+?)['"]\)/g,
        /import\(['"](.+?)['"]\)/g,
      ],
      ts: [/import\s+.*?\s+from\s+['"](.+?)['"]/g, /import\s+['"](.+?)['"]/g],
      py: [/^import\s+(\S+)/gm, /^from\s+(\S+)\s+import/gm],
    };

    // Edge deduplication map: "source:target:type" -> edge
    this.edgeMap = new Map();
  }

  /**
   * Detect import edges from file content
   * @param {object} fileMetadata - File metadata
   * @param {Map} fileIdMap - File path to ID mapping
   * @returns {Promise<Array>} Import edges
   */
  async detectImportEdges(fileMetadata, fileIdMap) {
    const edges = [];

    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      const fileId = fileIdMap.get(filePath);
      if (!fileId) continue;

      // Get file content
      const content = metadata.originalLines?.join('\n') || '';
      if (!content) continue;

      let imports = [];

      // Use AST-based detection if enabled
      if (this.useAST && this.astImportDetector) {
        try {
          imports = this.astImportDetector.detectImports(filePath, content);
        } catch (error) {
          console.warn(
            `[EDGE-DETECTOR] AST import detection failed for ${filePath}, using regex fallback:`,
            error.message
          );
          imports = this.detectImportsRegex(filePath, content);
        }
      } else {
        imports = this.detectImportsRegex(filePath, content);
      }

      // Resolve and create edges
      for (const importStmt of imports) {
        if (!importStmt.path) continue;

        try {
          // Use advanced import resolver
          const resolvedPath = await this.importResolver.resolve(importStmt.path, filePath);

          if (resolvedPath && fileIdMap.has(resolvedPath)) {
            const targetId = fileIdMap.get(resolvedPath);

            const edge = this.createOrUpdateEdge(fileId, targetId, 'IMPORT', {
              subtype: 'import_out',
              importPath: importStmt.path,
              resolvedPath: resolvedPath,
              line: importStmt.line,
            });
            if (edge) edges.push(edge);
          }
        } catch (error) {
          // Fallback to simple resolution
          const resolvedPath = this.resolveImportPath(importStmt.path, filePath);
          if (resolvedPath && fileIdMap.has(resolvedPath)) {
            const targetId = fileIdMap.get(resolvedPath);
            const edge = this.createOrUpdateEdge(fileId, targetId, 'IMPORT', {
              subtype: 'import_out',
              importPath: importStmt.path,
              resolvedPath: resolvedPath,
              line: importStmt.line,
            });
            if (edge) edges.push(edge);
          }
        }
      }
    }

    return edges;
  }

  /**
   * Detect imports using regex (fallback)
   * @param {string} filePath - File path
   * @param {string} content - File content
   * @returns {Array} Import statements
   */
  detectImportsRegex(filePath, content) {
    const imports = [];
    const lang = this.getLanguage(filePath);
    const patterns = this.importPatterns[lang] || [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          imports.push({
            path: match[1],
            line: i + 1,
          });
        }
      }
    }

    return imports;
  }

  /**
   * Detect model context edges
   */
  detectModelContextEdges(modelContext, fileIdMap) {
    const edges = [];

    for (const [targetFile, contextFiles] of Object.entries(modelContext)) {
      const targetId = fileIdMap.get(targetFile);
      if (!targetId) continue;

      for (const contextFile of contextFiles) {
        const sourceId = fileIdMap.get(contextFile);
        if (!sourceId) continue;

        const edge = this.createOrUpdateEdge(sourceId, targetId, 'MODEL_CONTEXT', {
          subtype: 'ctx_out',
          context_type: 'included',
        });
        if (edge) edges.push(edge);
      }
    }

    return edges;
  }

  /**
   * Detect navigation edges from file diffs (temporal ordering)
   */
  detectNavigationEdges(fileMetadata, fileIdMap) {
    const edges = [];
    const fileTimestamps = [];

    // Collect all file edit timestamps
    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      const fileId = fileIdMap.get(filePath);
      if (!fileId) continue;

      for (const diff of metadata.diffs) {
        fileTimestamps.push({
          fileId,
          filePath,
          timestamp: diff.timestamp || Date.now(),
        });
      }
    }

    // Sort by timestamp
    fileTimestamps.sort((a, b) => a.timestamp - b.timestamp);

    // Create navigation edges (previous file -> current file)
    for (let i = 1; i < fileTimestamps.length; i++) {
      const prev = fileTimestamps[i - 1];
      const curr = fileTimestamps[i];

      // Only create edge if files are different and within reasonable time window
      const navWindow = getConfig('edges.navigation.timeWindow', 5 * 60 * 1000);
      if (prev.fileId !== curr.fileId && curr.timestamp - prev.timestamp < navWindow) {
        const edge = this.createOrUpdateEdge(prev.fileId, curr.fileId, 'NAVIGATE', {
          subtype: 'nav_out',
          navigation_type: 'switch',
        });
        if (edge) {
          edge.timestamps = [curr.timestamp]; // Use actual timestamp
          edges.push(edge);
        }
      }
    }

    return edges;
  }

  /**
   * Detect tool edges from tool interactions
   */
  detectToolEdges(toolInteractions, fileIdMap) {
    const edges = [];

    for (const interaction of toolInteractions) {
      if (interaction.type === 'terminal' && interaction.command) {
        // Try to extract file paths from command
        const filePaths = this.extractFilePathsFromCommand(interaction.command);

        for (const filePath of filePaths) {
          const fileId = fileIdMap.get(filePath);
          if (!fileId) continue;

          // Create tool edge (file -> tool)
          const edge = this.createOrUpdateEdge(
            fileId,
            `TOOL_${interaction.tool}`,
            'TOOL_INTERACTION',
            {
              subtype: 'tool_out',
              tool_name: interaction.tool,
              command: interaction.command,
            }
          );
          if (edge) {
            edge.timestamps = [interaction.timestamp]; // Use actual timestamp
            edges.push(edge);
          }
        }
      }
    }

    return edges;
  }

  /**
   * Get language from file path
   */
  getLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const langMap = {
      '.js': 'js',
      '.jsx': 'js',
      '.ts': 'ts',
      '.tsx': 'ts',
      '.py': 'py',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.cpp': 'cpp',
      '.c': 'c',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Resolve import path to actual file path
   */
  resolveImportPath(importPath, fromFile) {
    // Remove file extension if present
    let resolved = importPath.replace(/\.(js|ts|jsx|tsx|py)$/, '');

    // Handle relative imports
    if (resolved.startsWith('.')) {
      const fromDir = path.dirname(fromFile);
      resolved = path.resolve(fromDir, resolved);
    } else {
      // Handle absolute/package imports (simplified)
      // In a real implementation, you'd need to resolve node_modules, etc.
      const fromDir = path.dirname(fromFile);
      resolved = path.resolve(fromDir, '..', resolved);
    }

    // Try common extensions
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.json'];
    for (const ext of extensions) {
      const withExt = resolved + ext;
      if (fs.existsSync(withExt)) {
        return withExt;
      }
    }

    // Return as-is if no extension found
    return resolved;
  }

  /**
   * Extract file paths from terminal command
   */
  extractFilePathsFromCommand(command) {
    const paths = [];
    // Simple pattern matching for file paths in commands
    const pathPattern = /[\w\/\-\.]+\.(js|ts|jsx|tsx|py|java|go|rs|cpp|c|json|md|txt)/g;
    let match;
    while ((match = pathPattern.exec(command)) !== null) {
      paths.push(match[0]);
    }
    return paths;
  }

  /**
   * Detect all edge types
   * @param {object} fileMetadata - File metadata
   * @param {object} modelContext - Model context mapping
   * @param {Array} toolInteractions - Tool interactions
   * @param {Map} fileIdMap - File path to ID mapping
   * @returns {Promise<Array>} All detected edges
   */
  async detectAllEdges(fileMetadata, modelContext, toolInteractions, fileIdMap) {
    this.edgeMap.clear(); // Reset deduplication map
    const edges = [];

    // 1. EDIT_SEQUENCE edges (temporal co-editing) - from rung4-edge-detector
    if (getConfig('edges.editSequence.enabled', true)) {
      const editSeqEdges = this.detectEditSequenceEdges(fileMetadata, fileIdMap);
      edges.push(...editSeqEdges);
    }

    // 2. IMPORT edges (static code analysis) - now async
    if (getConfig('edges.import.enabled', true)) {
      const importEdges = await this.detectImportEdges(fileMetadata, fileIdMap);
      edges.push(...importEdges);
    }

    // 3. MODEL_CONTEXT edges (LLM context files)
    if (getConfig('edges.modelContext.enabled', true)) {
      const contextEdges = this.detectModelContextEdges(modelContext, fileIdMap);
      edges.push(...contextEdges);
    }

    // 4. NAVIGATE edges (temporal file navigation)
    if (getConfig('edges.navigation.enabled', true)) {
      const navEdges = this.detectNavigationEdges(fileMetadata, fileIdMap);
      edges.push(...navEdges);
    }

    // 5. TOOL_INTERACTION edges (terminal, jupyter, etc.)
    if (getConfig('edges.toolInteraction.enabled', true)) {
      const toolEdges = this.detectToolEdges(toolInteractions, fileIdMap);
      edges.push(...toolEdges);
    }

    return edges;
  }

  /**
   * Detect EDIT_SEQUENCE edges (files edited within time window)
   * Merged from rung4-edge-detector
   * @param {object} fileMetadata - File metadata
   * @param {Map} fileIdMap - File path to ID mapping
   * @returns {Array} Edit sequence edges
   */
  detectEditSequenceEdges(fileMetadata, fileIdMap) {
    const edges = [];
    const TIME_WINDOW = getConfig('edges.editSequence.timeWindow', 5 * 60 * 1000);

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
          const edge = this.createOrUpdateEdge(sourceId, targetId, 'EDIT_SEQUENCE', {
            time_gap_ms: edit2.timestamp - edit1.timestamp,
            source_diff_id: edit1.diffId,
            target_diff_id: edit2.diffId,
          });
          if (edge) edges.push(edge);
        }
      }
    }

    return edges;
  }

  /**
   * Create or update edge with deduplication
   * @param {string} source - Source node ID
   * @param {string} target - Target node ID
   * @param {string} type - Edge type
   * @param {object} metadata - Edge metadata
   * @returns {object|null} Edge object or null if duplicate and deduplication enabled
   */
  createOrUpdateEdge(source, target, type, metadata = {}) {
    const key = `${source}:${target}:${type}`;

    if (this.options.deduplicate && this.edgeMap.has(key)) {
      const existing = this.edgeMap.get(key);
      existing.weight++;
      if (!existing.timestamps) existing.timestamps = [];
      existing.timestamps.push(Date.now());
      // Merge metadata
      existing.metadata = { ...existing.metadata, ...metadata };
      return null; // Don't add duplicate
    }

    const edge = {
      id: `EDGE_${String(this.edgeIdCounter++).padStart(6, '0')}`,
      type,
      source,
      target,
      weight: 1,
      timestamps: [Date.now()],
      metadata,
    };

    if (this.options.deduplicate) {
      this.edgeMap.set(key, edge);
    }

    return edge;
  }
}

module.exports = ModuleGraphEdgeDetector;
