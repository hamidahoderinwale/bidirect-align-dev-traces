/**
 * Module Graph Builder
 * Builds the complete module graph structure from extracted data
 */

const path = require('path');
const { nanoid } = require('nanoid');

class ModuleGraphBuilder {
  constructor() {
    this.fileIdCounter = 0;
    this.dirIdCounter = 0;
  }

  /**
   * Build complete module graph (now async)
   * @param {object} extractedData - Extracted data
   * @param {object} options - Options
   * @returns {Promise<object>} Graph object
   */
  async buildGraph(extractedData, options = {}) {
    const { filePaths, fileMetadata, modelContext, toolInteractions } = extractedData;

    // Step 1: Canonicalize file IDs
    const fileIdMap = this.canonicalizeFileIds(filePaths);

    // Step 2: Build directory hierarchy
    const hierarchy = this.buildDirectoryHierarchy(filePaths, fileIdMap);

    // Step 3: Build module nodes
    const nodes = this.buildModuleNodes(filePaths, fileMetadata, fileIdMap, hierarchy);

    // Step 4: Build typed edges (using unified edge detector - now async)
    const ModuleGraphEdgeDetector = require('./module-graph-edge-detector');
    const detector = new ModuleGraphEdgeDetector({
      workspaceRoot: options.workspaceRoot || null,
    });
    const edges = await detector.detectAllEdges(
      fileMetadata,
      modelContext,
      toolInteractions,
      fileIdMap
    );

    // Step 5: Build structural events
    const events = this.buildStructuralEvents(fileMetadata, fileIdMap);

    // Step 6: Assemble final graph
    return {
      nodes,
      edges,
      events,
      hierarchy,
      metadata: {
        totalFiles: filePaths.length,
        totalEdges: edges.length,
        totalEvents: events.length,
        edgeTypes: this.countEdgeTypes(edges),
        builtAt: new Date().toISOString(),
        version: Date.now(),
      },
    };
  }

  /**
   * Canonicalize file paths to stable IDs
   */
  canonicalizeFileIds(filePaths) {
    const fileIdMap = new Map();
    const dirIdMap = new Map();

    for (const filePath of filePaths) {
      // Generate file ID
      const fileId = `FILE_${String(this.fileIdCounter++).padStart(3, '0')}`;
      fileIdMap.set(filePath, fileId);

      // Generate directory IDs
      const dirPath = path.dirname(filePath);
      if (!dirIdMap.has(dirPath)) {
        const dirId = `DIR_${String(this.dirIdCounter++).padStart(3, '0')}`;
        dirIdMap.set(dirPath, dirId);
      }
    }

    // Store directory map for later use
    this.dirIdMap = dirIdMap;

    return fileIdMap;
  }

  /**
   * Build directory hierarchy
   */
  buildDirectoryHierarchy(filePaths, fileIdMap) {
    const hierarchy = {};
    const dirMap = new Map();

    // Build directory structure
    for (const filePath of filePaths) {
      const fileId = fileIdMap.get(filePath);
      const dirPath = path.dirname(filePath);
      const dirId = this.dirIdMap.get(dirPath);

      if (!dirMap.has(dirPath)) {
        dirMap.set(dirPath, {
          id: dirId,
          type: 'directory',
          path: dirPath,
          children: [],
          depth: this.calculateDepth(dirPath),
        });
      }

      dirMap.get(dirPath).children.push(fileId);
    }

    // Build parent-child relationships
    for (const [dirPath, dirData] of dirMap.entries()) {
      const parentPath = path.dirname(dirPath);
      if (parentPath !== dirPath && dirMap.has(parentPath)) {
        const parentId = this.dirIdMap.get(parentPath);
        dirData.parent = parentId;
      }

      hierarchy[dirData.id] = dirData;
    }

    return hierarchy;
  }

  /**
   * Calculate directory depth
   */
  calculateDepth(dirPath) {
    const parts = dirPath.split(path.sep).filter((p) => p);
    return parts.length;
  }

  /**
   * Build module nodes (files and directories)
   */
  buildModuleNodes(filePaths, fileMetadata, fileIdMap, hierarchy) {
    const nodes = [];

    // Build file nodes
    for (const filePath of filePaths) {
      const fileId = fileIdMap.get(filePath);
      const metadata = fileMetadata[filePath] || {};
      const dirPath = path.dirname(filePath);
      const dirId = this.dirIdMap.get(dirPath);

      const lang = this.getLanguage(filePath);
      const sizeBucket = this.getSizeBucket(metadata.originalLines?.length || 0);

      // Calculate interaction counts
      const interactionCounts = {
        edits: metadata.editCount || 0,
        navs: 0, // Will be calculated from navigation edges
        ai_suggestions: 0, // Will be calculated from model context
        model_context_uses: 0,
        tool_calls: 0,
      };

      nodes.push({
        id: fileId,
        type: 'file',
        lang,
        path: filePath,
        directory: dirId,
        size_bucket: sizeBucket,
        interaction_counts: interactionCounts,
        metadata: {
          num_original_lines: metadata.originalLines?.length || 0,
          num_edits: metadata.editCount || 0,
          num_ai_edits: 0, // Will be calculated
          last_modified: this.getLastModified(metadata.diffs),
          created: this.getFirstSeen(metadata.diffs),
        },
        ports: {
          import_out: true,
          import_in: true,
          call_out: true,
          call_in: true,
          ctx_out: true,
          ctx_in: true,
          nav_out: true,
          nav_in: true,
          tool_out: true,
          tool_in: true,
        },
      });
    }

    // Build directory nodes
    for (const [dirId, dirData] of Object.entries(hierarchy)) {
      nodes.push({
        id: dirId,
        type: 'directory',
        path: dirData.path,
        children: dirData.children,
        parent: dirData.parent || null,
        depth: dirData.depth,
        metadata: {
          file_count: dirData.children.length,
        },
      });
    }

    return nodes;
  }

  /**
   * Build structural events
   */
  buildStructuralEvents(fileMetadata, fileIdMap) {
    const events = [];

    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      const fileId = fileIdMap.get(filePath);

      for (const diff of metadata.diffs) {
        events.push({
          id: nanoid(),
          timestamp: diff.timestamp || Date.now(),
          event_type: 'FILE_EDIT',
          file: fileId,
          related_files: [],
          metadata: {
            diff_id: diff.diffId,
            file_path: filePath,
          },
        });
      }
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events;
  }

  /**
   * Count edge types
   */
  countEdgeTypes(edges) {
    const counts = {};
    for (const edge of edges) {
      counts[edge.type] = (counts[edge.type] || 0) + 1;
    }
    return counts;
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
      '.json': 'json',
      '.md': 'md',
      '.html': 'html',
      '.css': 'css',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Get size bucket
   */
  getSizeBucket(lineCount) {
    if (lineCount < 100) return 'small';
    if (lineCount < 500) return 'medium';
    return 'large';
  }

  /**
   * Get last modified timestamp
   */
  getLastModified(diffs) {
    if (!diffs || diffs.length === 0) return null;
    const timestamps = diffs.map((d) => d.timestamp).filter(Boolean);
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  }

  /**
   * Get first seen timestamp
   */
  getFirstSeen(diffs) {
    if (!diffs || diffs.length === 0) return null;
    const timestamps = diffs.map((d) => d.timestamp).filter(Boolean);
    if (timestamps.length === 0) return null;
    return new Date(Math.min(...timestamps)).toISOString();
  }
}

module.exports = ModuleGraphBuilder;
