#!/usr/bin/env node

/**
 * Context Extractor
 * Extracts context files, @ references, and UI state from Cursor's database
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execAsync = promisify(exec);

class ContextExtractor {
  constructor() {
    this.dbPaths = this.findCursorDatabases();
  }

  /**
   * Find all Cursor database files
   */
  findCursorDatabases() {
    const basePath = path.join(os.homedir(), 'Library/Application Support/Cursor');

    return {
      global: path.join(basePath, 'User/globalStorage/state.vscdb'),
      workspaceStorage: path.join(basePath, 'User/workspaceStorage'),
    };
  }

  /**
   * Extract @ file references from prompt text
   */
  extractAtFiles(promptText) {
    if (!promptText) return [];

    // Pattern to match @filename or @path/to/file
    const atFilePattern = /@([^\s,]+(?:\.[\w]+)?)/g;
    const atFiles = [];
    let match;

    while ((match = atFilePattern.exec(promptText)) !== null) {
      const reference = match[0]; // Full match with @
      const filePath = match[1]; // Just the file path

      atFiles.push({
        reference: reference,
        filePath: filePath,
        fileName: path.basename(filePath),
        position: match.index,
        context: this.getContextAroundMatch(promptText, match.index, 50),
      });
    }

    return atFiles;
  }

  /**
   * Get context around a match
   */
  getContextAroundMatch(text, position, radius = 50) {
    const start = Math.max(0, position - radius);
    const end = Math.min(text.length, position + radius);
    return text.substring(start, end);
  }

  /**
   * Extract context files from composer data
   */
  async extractContextFilesFromComposer(composerData) {
    try {
      const contextFiles = {
        referencedFiles: [],
        attachedFiles: [],
        codebaseFiles: [],
        mentionedFiles: [],
      };

      if (!composerData) return contextFiles;

      // Extract from composer data structure
      if (composerData.files) {
        contextFiles.attachedFiles = composerData.files.map((f) => ({
          path: f.path || f.filePath || f,
          name: path.basename(f.path || f.filePath || f),
          type: 'attached',
        }));
      }

      // Extract from context array
      if (composerData.context) {
        contextFiles.codebaseFiles = composerData.context.map((c) => ({
          path: c.path || c.file || c,
          name: path.basename(c.path || c.file || c),
          type: 'codebase',
          score: c.score || 0,
        }));
      }

      // Extract from mentions
      if (composerData.mentions) {
        contextFiles.mentionedFiles = composerData.mentions.map((m) => ({
          path: m.path || m,
          name: path.basename(m.path || m),
          type: 'mentioned',
        }));
      }

      return contextFiles;
    } catch (error) {
      console.warn('Error extracting context files from composer:', error.message);
      return {
        referencedFiles: [],
        attachedFiles: [],
        codebaseFiles: [],
        mentionedFiles: [],
      };
    }
  }

  /**
   * Extract browser/UI state from database
   */
  async extractBrowserState() {
    try {
      const { global } = this.dbPaths;

      if (!fs.existsSync(global)) {
        return this.getEmptyBrowserState();
      }

      // Query for UI/browser related data
      const queries = [
        "SELECT key, value FROM ItemTable WHERE key LIKE '%tab%'",
        "SELECT key, value FROM ItemTable WHERE key LIKE '%browser%'",
        "SELECT key, value FROM ItemTable WHERE key LIKE '%webview%'",
        "SELECT key, value FROM ItemTable WHERE key LIKE '%panel%'",
        "SELECT key, value FROM ItemTable WHERE key LIKE '%view%'",
      ];

      const browserState = {
        tabs: [],
        panels: {},
        viewState: {},
        timestamp: Date.now(),
      };

      for (const query of queries) {
        try {
          const { stdout } = await execAsync(`sqlite3 "${global}" "${query}"`);

          const lines = stdout
            .trim()
            .split('\n')
            .filter((l) => l);

          for (const line of lines) {
            const [key, valueBlob] = line.split('|', 2);

            if (!valueBlob) continue;

            // Try to parse as JSON
            try {
              const jsonMatch = valueBlob.match(/\{.*\}/);
              if (jsonMatch) {
                const data = JSON.parse(jsonMatch[0]);
                this.processBrowserStateData(key, data, browserState);
              }
            } catch (e) {
              // Not JSON, try to extract text
              const textData = this.extractTextFromBlob(valueBlob);
              if (textData) {
                this.processBrowserStateData(key, textData, browserState);
              }
            }
          }
        } catch (queryError) {
          // Skip failed queries
        }
      }

      return browserState;
    } catch (error) {
      console.warn('Error extracting browser state:', error.message);
      return this.getEmptyBrowserState();
    }
  }

  /**
   * Process browser state data
   */
  processBrowserStateData(key, data, browserState) {
    if (key.includes('tab')) {
      if (typeof data === 'object' && data.path) {
        browserState.tabs.push({
          path: data.path,
          name: path.basename(data.path),
          isActive: data.active || false,
        });
      }
    } else if (key.includes('panel')) {
      browserState.panels = {
        ...browserState.panels,
        [key]: data,
      };
    } else if (key.includes('view')) {
      browserState.viewState = {
        ...browserState.viewState,
        [key]: data,
      };
    }
  }

  /**
   * Extract text from blob data
   */
  extractTextFromBlob(blob) {
    try {
      // Try to extract readable text from binary blob
      const textMatch = blob.match(/[a-zA-Z0-9\/\._-]{3,}/g);
      if (textMatch) {
        return textMatch.join(' ');
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get empty browser state
   */
  getEmptyBrowserState() {
    return {
      tabs: [],
      panels: {},
      viewState: {},
      timestamp: Date.now(),
    };
  }

  /**
   * Extract file references from AI response
   */
  extractFilesFromResponse(responseText) {
    if (!responseText) return [];

    // Pattern to match file paths in code blocks or references
    const filePatterns = [
      /`([^`]+\.[a-zA-Z]+)`/g, // Backtick wrapped files
      /\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9_\/-]+\.[a-zA-Z]+)\b/g, // Path-like strings
      /['"]([^'"]+\.[a-zA-Z]+)['"]/g, // Quoted files
    ];

    const files = new Set();

    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(responseText)) !== null) {
        const filePath = match[1];
        if (filePath && filePath.length > 2 && filePath.length < 200) {
          files.add(filePath);
        }
      }
    }

    return Array.from(files).map((f) => ({
      path: f,
      name: path.basename(f),
      source: 'ai-response',
    }));
  }

  /**
   * Analyze file relationships from context
   */
  analyzeFileRelationships(contextFiles) {
    const relationships = {
      primary: null,
      supporting: [],
      referenced: [],
      generated: [],
    };

    if (!contextFiles) return relationships;

    // Primary file is usually the first attached or most referenced
    if (contextFiles.attachedFiles && contextFiles.attachedFiles.length > 0) {
      relationships.primary = contextFiles.attachedFiles[0];
    }

    // Supporting files are codebase context files
    if (contextFiles.codebaseFiles) {
      relationships.supporting = contextFiles.codebaseFiles;
    }

    // Referenced files are @ mentions
    if (contextFiles.referencedFiles) {
      relationships.referenced = contextFiles.referencedFiles;
    }

    return relationships;
  }

  /**
   * Get comprehensive context for a prompt
   */
  async getPromptContext(promptData) {
    try {
      const context = {
        // Extract @ files from prompt text
        atFiles: this.extractAtFiles(promptData.text || promptData.content),

        // Extract context files from composer data
        contextFiles: await this.extractContextFilesFromComposer(promptData.composerData),

        // Extract files from AI response
        responseFiles: this.extractFilesFromResponse(promptData.response),

        // Get browser/UI state
        browserState: await this.extractBrowserState(),

        // Analyze relationships
        fileRelationships: null,

        timestamp: Date.now(),
      };

      // Analyze file relationships
      context.fileRelationships = this.analyzeFileRelationships(context.contextFiles);

      return context;
    } catch (error) {
      console.error('Error getting prompt context:', error);
      return this.getEmptyContext();
    }
  }

  /**
   * Get empty context
   */
  getEmptyContext() {
    return {
      atFiles: [],
      contextFiles: {
        referencedFiles: [],
        attachedFiles: [],
        codebaseFiles: [],
        mentionedFiles: [],
      },
      responseFiles: [],
      browserState: this.getEmptyBrowserState(),
      fileRelationships: {
        primary: null,
        supporting: [],
        referenced: [],
        generated: [],
      },
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate context statistics
   */
  calculateContextStats(contexts) {
    const stats = {
      totalPrompts: contexts.length,
      totalAtFiles: 0,
      totalContextFiles: 0,
      totalResponseFiles: 0,
      averageFilesPerPrompt: 0,
      mostReferencedFiles: new Map(),
      fileTypes: new Map(),
    };

    for (const context of contexts) {
      stats.totalAtFiles += context.atFiles?.length || 0;
      stats.totalContextFiles += this.countContextFiles(context.contextFiles);
      stats.totalResponseFiles += context.responseFiles?.length || 0;

      // Track most referenced files
      this.trackReferencedFiles(context, stats.mostReferencedFiles);

      // Track file types
      this.trackFileTypes(context, stats.fileTypes);
    }

    stats.averageFilesPerPrompt =
      (stats.totalAtFiles + stats.totalContextFiles + stats.totalResponseFiles) /
      Math.max(contexts.length, 1);

    return stats;
  }

  /**
   * Count context files
   */
  countContextFiles(contextFiles) {
    if (!contextFiles) return 0;
    return (
      (contextFiles.referencedFiles?.length || 0) +
      (contextFiles.attachedFiles?.length || 0) +
      (contextFiles.codebaseFiles?.length || 0) +
      (contextFiles.mentionedFiles?.length || 0)
    );
  }

  /**
   * Track referenced files
   */
  trackReferencedFiles(context, referencedFilesMap) {
    const allFiles = [
      ...(context.atFiles || []),
      ...(context.contextFiles?.attachedFiles || []),
      ...(context.responseFiles || []),
    ];

    for (const file of allFiles) {
      const fileName =
        file.fileName || file.name || path.basename(file.path || file.filePath || '');
      if (fileName) {
        referencedFilesMap.set(fileName, (referencedFilesMap.get(fileName) || 0) + 1);
      }
    }
  }

  /**
   * Track file types
   */
  trackFileTypes(context, fileTypesMap) {
    const allFiles = [
      ...(context.atFiles || []),
      ...(context.contextFiles?.attachedFiles || []),
      ...(context.responseFiles || []),
    ];

    for (const file of allFiles) {
      const filePath = file.path || file.filePath || '';
      const ext = path.extname(filePath).toLowerCase();
      if (ext) {
        fileTypesMap.set(ext, (fileTypesMap.get(ext) || 0) + 1);
      }
    }
  }
}

module.exports = ContextExtractor;
