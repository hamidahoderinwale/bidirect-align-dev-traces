#!/usr/bin/env node

/**
 * Context Window Analyzer
 * Tracks and analyzes @ mentions, context files, token usage, and file relationships
 */

const ContextExtractor = require('../capture/context-extractor');

class ContextAnalyzer {
  constructor(persistentDB = null) {
    this.contextExtractor = new ContextExtractor();
    this.contextSnapshots = [];
    this.fileCoOccurrence = new Map(); // Track which files appear together
    this.fileContextHistory = new Map(); // Track file usage over time
    this.persistentDB = persistentDB; // Store reference to persistent database
  }

  /**
   * Analyze context for a prompt
   */
  async analyzePromptContext(prompt) {
    try {
      // Prefer integer ID (from database) over UUID composerId for proper linking
      // If prompt.id is a number, use it; otherwise fall back to composerId (UUID)
      const promptId = (typeof prompt.id === 'number') ? prompt.id : (prompt.id || prompt.composerId);
      const analysis = {
        promptId: promptId,
        timestamp: Date.now(),
        contextFiles: [],
        atMentions: [],
        implicitContext: [],
        tokenEstimate: 0,
        fileCount: 0,
        truncated: false,
      };

      // Extract @ mentions from prompt text
      const text = prompt.text || prompt.content || '';
      analysis.atMentions = this.extractAtMentions(text);

      // Extract context from Cursor's composer data
      if (prompt.composerData || prompt.context) {
        const composerContext = await this.contextExtractor.getPromptContext({
          text: text,
          content: text,
          composerData: prompt.composerData || prompt.context,
        });

        // Add @ files
        if (composerContext.atFiles && Array.isArray(composerContext.atFiles)) {
          composerContext.atFiles.forEach((f) => {
            const filePath = typeof f === 'string' ? f : f.filePath || f.fileName || f.path;
            if (filePath && filePath.length > 0) {
              analysis.contextFiles.push({
                path: filePath,
                type: 'explicit',
                source: 'at_mention',
              });
            }
          });
        }

        // Add context files
        if (composerContext.contextFiles) {
          if (
            typeof composerContext.contextFiles === 'object' &&
            !Array.isArray(composerContext.contextFiles)
          ) {
            Object.entries(composerContext.contextFiles).forEach(([path, info]) => {
              if (
                path &&
                path.length > 0 &&
                !['attachedFiles', 'codebaseFiles', 'referencedFiles', 'mentionedFiles'].includes(
                  path
                )
              ) {
                analysis.contextFiles.push({
                  path: path,
                  type: 'implicit',
                  source: 'context_window',
                  lineCount: info?.lineCount,
                  size: info?.size,
                });
              }
            });
          } else if (Array.isArray(composerContext.contextFiles)) {
            composerContext.contextFiles.forEach((file) => {
              const filePath =
                typeof file === 'string' ? file : file.path || file.fileName || file.name;
              if (filePath && filePath.length > 0) {
                analysis.contextFiles.push({
                  path: filePath,
                  type: 'implicit',
                  source: 'context_window',
                });
              }
            });
          }
        }

        // Add response files
        if (composerContext.responseFiles && Array.isArray(composerContext.responseFiles)) {
          composerContext.responseFiles.forEach((file) => {
            const filePath =
              typeof file === 'string' ? file : file.path || file.fileName || file.name;
            if (
              filePath &&
              filePath.length > 0 &&
              !analysis.contextFiles.find((f) => f.path === filePath)
            ) {
              analysis.contextFiles.push({
                path: filePath,
                type: 'response',
                source: 'ai_generated',
              });
            }
          });
        }
      }

      // Calculate token estimate
      analysis.tokenEstimate = this.estimateTokens(analysis.contextFiles);
      analysis.fileCount = analysis.contextFiles.length;

      // Check for truncation (Claude Sonnet 4.5 has 200k context)
      const MAX_TOKENS = 200000;
      analysis.truncated = analysis.tokenEstimate > MAX_TOKENS * 0.9;
      analysis.utilizationPercent = (analysis.tokenEstimate / MAX_TOKENS) * 100;

      // Track file co-occurrence
      this.trackFileRelationships(analysis.contextFiles);

      // Store snapshot in memory
      this.contextSnapshots.push(analysis);

      // Keep only last 1000 snapshots in memory
      if (this.contextSnapshots.length > 1000) {
        this.contextSnapshots = this.contextSnapshots.slice(-1000);
      }

      // Persist snapshot to database
      if (this.persistentDB) {
        try {
          await this.persistentDB.saveContextSnapshot(analysis);
        } catch (error) {
          console.error('Error saving context snapshot to database:', error);
        }
      }

      return analysis;
    } catch (error) {
      console.error('Error analyzing context:', error);
      return null;
    }
  }

  /**
   * Extract @ mentions from text
   */
  extractAtMentions(text) {
    const mentions = [];
    const pattern = /@([\w\/\.\-]+)/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  /**
   * Estimate token count for context files
   */
  estimateTokens(contextFiles) {
    let totalTokens = 0;

    contextFiles.forEach((file) => {
      // Rough estimate: 1 token ≈ 4 characters
      // Average lines: ~50 chars per line
      const estimatedChars = (file.lineCount || 50) * 50;
      const tokens = Math.ceil(estimatedChars / 4);
      totalTokens += tokens;
    });

    return totalTokens;
  }

  /**
   * Track which files appear together in context
   */
  trackFileRelationships(contextFiles) {
    const filePaths = contextFiles.map((f) => f.path).filter(Boolean);

    // Create pairs
    for (let i = 0; i < filePaths.length; i++) {
      for (let j = i + 1; j < filePaths.length; j++) {
        const file1 = filePaths[i];
        const file2 = filePaths[j];
        const key = [file1, file2].sort().join('|||');

        if (!this.fileCoOccurrence.has(key)) {
          this.fileCoOccurrence.set(key, {
            file1,
            file2,
            count: 0,
            lastSeen: Date.now(),
          });
        }

        const pair = this.fileCoOccurrence.get(key);
        pair.count++;
        pair.lastSeen = Date.now();
      }
    }

    // Track individual file usage
    filePaths.forEach((file) => {
      if (!this.fileContextHistory.has(file)) {
        this.fileContextHistory.set(file, {
          file,
          mentionCount: 0,
          firstSeen: Date.now(),
          lastSeen: Date.now(),
        });
      }

      const history = this.fileContextHistory.get(file);
      history.mentionCount++;
      history.lastSeen = Date.now();
    });
  }

  /**
   * Get file relationship graph data (optimized)
   */
  getFileRelationshipGraph(minCount = 2) {
    const edges = [];
    const nodes = new Map();
    const snapshotCount = this.contextSnapshots.length || 1; // Avoid division by zero

    // Pre-filter and build in single pass for better performance
    for (const [key, data] of this.fileCoOccurrence.entries()) {
      if (data.count < minCount) continue; // Skip early

      // Add edge
      edges.push({
        source: data.file1,
        target: data.file2,
        weight: data.count,
        strength: data.count / snapshotCount,
      });

      // Add nodes (only if not already added)
      if (!nodes.has(data.file1)) {
        const history = this.fileContextHistory.get(data.file1);
        nodes.set(data.file1, {
          id: data.file1,
          label: data.file1.split('/').pop() || data.file1,
          mentions: history?.mentionCount || 0,
          size: Math.min(50, 10 + (history?.mentionCount || 0)),
        });
      }

      if (!nodes.has(data.file2)) {
        const history = this.fileContextHistory.get(data.file2);
        nodes.set(data.file2, {
          id: data.file2,
          label: data.file2.split('/').pop() || data.file2,
          mentions: history?.mentionCount || 0,
          size: Math.min(50, 10 + (history?.mentionCount || 0)),
        });
      }
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: edges,
      metadata: {
        totalRelationships: this.fileCoOccurrence.size,
        filteredRelationships: edges.length,
        totalFiles: this.fileContextHistory.size,
        includedFiles: nodes.size,
      },
    };
  }

  /**
   * Get context analytics summary
   */
  getContextAnalytics() {
    if (this.contextSnapshots.length === 0) {
      return {
        totalSnapshots: 0,
        avgFilesPerPrompt: 0,
        avgTokensPerPrompt: 0,
        truncationRate: 0,
        mostReferencedFiles: [],
        avgContextUtilization: 0,
      };
    }

    const totalFiles = this.contextSnapshots.reduce((sum, s) => sum + s.fileCount, 0);
    const totalTokens = this.contextSnapshots.reduce((sum, s) => sum + s.tokenEstimate, 0);
    const truncated = this.contextSnapshots.filter((s) => s.truncated).length;
    const totalUtilization = this.contextSnapshots.reduce(
      (sum, s) => sum + (s.utilizationPercent || 0),
      0
    );

    // Get most referenced files
    const filesByMentions = Array.from(this.fileContextHistory.values())
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 10);

    return {
      totalSnapshots: this.contextSnapshots.length,
      avgFilesPerPrompt: totalFiles / this.contextSnapshots.length,
      avgTokensPerPrompt: Math.round(totalTokens / this.contextSnapshots.length),
      truncationRate: (truncated / this.contextSnapshots.length) * 100,
      mostReferencedFiles: filesByMentions,
      avgContextUtilization: totalUtilization / this.contextSnapshots.length,
      fileRelationships: this.fileCoOccurrence.size,
      uniqueFilesReferenced: this.fileContextHistory.size,
    };
  }

  /**
   * Get recent context snapshots
   */
  getRecentSnapshots(limit = 50) {
    return this.contextSnapshots.slice(-limit);
  }

  /**
   * Get context timeline data
   */
  getContextTimeline() {
    // Group by hour
    const hourlyData = new Map();

    this.contextSnapshots.forEach((snapshot) => {
      const hour = Math.floor(snapshot.timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000);

      if (!hourlyData.has(hour)) {
        hourlyData.set(hour, {
          timestamp: hour,
          snapshots: 0,
          totalFiles: 0,
          totalTokens: 0,
          truncations: 0,
        });
      }

      const data = hourlyData.get(hour);
      data.snapshots++;
      data.totalFiles += snapshot.fileCount;
      data.totalTokens += snapshot.tokenEstimate;
      if (snapshot.truncated) data.truncations++;
    });

    return Array.from(hourlyData.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Clear old data
   */
  cleanup() {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days

    this.contextSnapshots = this.contextSnapshots.filter((s) => s.timestamp > cutoff);

    // Clean up file co-occurrence
    this.fileCoOccurrence.forEach((data, key) => {
      if (data.lastSeen < cutoff) {
        this.fileCoOccurrence.delete(key);
      }
    });
  }
}

module.exports = ContextAnalyzer;
