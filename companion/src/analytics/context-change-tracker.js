#!/usr/bin/env node

/**
 * Context Change Tracker
 * Tracks files added/removed from context on a per-prompt/event basis
 */

class ContextChangeTracker {
  constructor(persistentDB = null) {
    this.persistentDB = persistentDB;
    this.previousContextSnapshot = null;
    this.contextHistory = []; // In-memory history for quick access
  }

  /**
   * Track context changes for a prompt/event
   * @param {Object} currentContext - Current context snapshot
   * @param {Object} options - Options including promptId, eventId, timestamp
   * @returns {Object} Context delta (added/removed files)
   */
  async trackContextChange(currentContext, options = {}) {
    try {
      const {
        promptId = null,
        eventId = null,
        timestamp = Date.now(),
        taskId = null,
        sessionId = null,
      } = options;

      // Extract file paths from current context
      const currentFiles = this.extractFilePaths(currentContext);

      // Get previous context files
      const previousFiles = this.previousContextSnapshot
        ? this.extractFilePaths(this.previousContextSnapshot)
        : [];

      // Calculate delta
      const delta = this.calculateDelta(previousFiles, currentFiles);

      // Create context change record
      const changeRecord = {
        id: `context-change-${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
        promptId,
        eventId,
        taskId,
        sessionId,
        timestamp,
        previousFileCount: previousFiles.length,
        currentFileCount: currentFiles.length,
        addedFiles: delta.added,
        removedFiles: delta.removed,
        unchangedFiles: delta.unchanged,
        netChange: delta.added.length - delta.removed.length,
        metadata: {
          previousContext: this.previousContextSnapshot
            ? {
                fileCount: previousFiles.length,
                files: previousFiles,
              }
            : null,
          currentContext: {
            fileCount: currentFiles.length,
            files: currentFiles,
          },
        },
      };

      // Store in memory (keep last 1000)
      this.contextHistory.push(changeRecord);
      if (this.contextHistory.length > 1000) {
        this.contextHistory = this.contextHistory.slice(-1000);
      }

      // Persist to database
      if (this.persistentDB) {
        try {
          await this.persistentDB.saveContextChange(changeRecord);
        } catch (error) {
          console.error('Error saving context change to database:', error);
        }
      }

      // Update previous snapshot
      this.previousContextSnapshot = currentContext;

      return changeRecord;
    } catch (error) {
      console.error('Error tracking context change:', error);
      return null;
    }
  }

  /**
   * Extract file paths from context object
   * Handles various context formats
   */
  extractFilePaths(context) {
    if (!context) return [];

    const files = new Set();

    // Handle array of file objects
    if (Array.isArray(context)) {
      context.forEach((file) => {
        const path = this.getFilePath(file);
        if (path) files.add(path);
      });
      return Array.from(files);
    }

    // Handle contextFiles object structure
    if (context.contextFiles) {
      if (Array.isArray(context.contextFiles)) {
        context.contextFiles.forEach((file) => {
          const path = this.getFilePath(file);
          if (path) files.add(path);
        });
      } else if (typeof context.contextFiles === 'object') {
        // Handle nested structure (attachedFiles, codebaseFiles, etc.)
        Object.values(context.contextFiles).forEach((fileArray) => {
          if (Array.isArray(fileArray)) {
            fileArray.forEach((file) => {
              const path = this.getFilePath(file);
              if (path) files.add(path);
            });
          }
        });
      }
    }

    // Handle atFiles
    if (context.atFiles && Array.isArray(context.atFiles)) {
      context.atFiles.forEach((file) => {
        const path = this.getFilePath(file);
        if (path) files.add(path);
      });
    }

    // Handle direct file paths
    if (context.files && Array.isArray(context.files)) {
      context.files.forEach((file) => {
        const path = this.getFilePath(file);
        if (path) files.add(path);
      });
    }

    return Array.from(files);
  }

  /**
   * Get file path from various file object formats
   */
  getFilePath(file) {
    if (!file) return null;

    if (typeof file === 'string') {
      return file;
    }

    return file.path || file.filePath || file.fileName || file.name || null;
  }

  /**
   * Calculate delta between previous and current file sets
   */
  calculateDelta(previousFiles, currentFiles) {
    const previousSet = new Set(previousFiles);
    const currentSet = new Set(currentFiles);

    const added = currentFiles.filter((f) => !previousSet.has(f));
    const removed = previousFiles.filter((f) => !currentSet.has(f));
    const unchanged = currentFiles.filter((f) => previousSet.has(f));

    return {
      added,
      removed,
      unchanged,
      addedCount: added.length,
      removedCount: removed.length,
      unchangedCount: unchanged.length,
    };
  }

  /**
   * Get context changes for a specific prompt
   */
  async getContextChangesForPrompt(promptId) {
    if (this.persistentDB) {
      return await this.persistentDB.getContextChanges({ promptId });
    }

    return this.contextHistory.filter((change) => change.promptId === promptId);
  }

  /**
   * Get context changes for a specific event
   */
  async getContextChangesForEvent(eventId) {
    if (this.persistentDB) {
      return await this.persistentDB.getContextChanges({ eventId });
    }

    return this.contextHistory.filter((change) => change.eventId === eventId);
  }

  /**
   * Get context changes for a specific task
   */
  async getContextChangesForTask(taskId) {
    if (this.persistentDB) {
      return await this.persistentDB.getContextChanges({ taskId });
    }

    return this.contextHistory.filter((change) => change.taskId === taskId);
  }

  /**
   * Get context changes within a time range
   */
  async getContextChangesInRange(startTime, endTime) {
    if (this.persistentDB) {
      return await this.persistentDB.getContextChanges({
        startTime,
        endTime,
      });
    }

    return this.contextHistory.filter(
      (change) => change.timestamp >= startTime && change.timestamp <= endTime
    );
  }

  /**
   * Get summary statistics
   */
  getSummaryStats() {
    const changes = this.contextHistory;

    if (changes.length === 0) {
      return {
        totalChanges: 0,
        totalFilesAdded: 0,
        totalFilesRemoved: 0,
        averageNetChange: 0,
        mostAddedFiles: [],
        mostRemovedFiles: [],
      };
    }

    const fileAddCounts = new Map();
    const fileRemoveCounts = new Map();
    let totalAdded = 0;
    let totalRemoved = 0;

    changes.forEach((change) => {
      change.addedFiles.forEach((file) => {
        fileAddCounts.set(file, (fileAddCounts.get(file) || 0) + 1);
        totalAdded++;
      });

      change.removedFiles.forEach((file) => {
        fileRemoveCounts.set(file, (fileRemoveCounts.get(file) || 0) + 1);
        totalRemoved++;
      });
    });

    const mostAddedFiles = Array.from(fileAddCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    const mostRemovedFiles = Array.from(fileRemoveCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([file, count]) => ({ file, count }));

    const averageNetChange =
      changes.length > 0 ? changes.reduce((sum, c) => sum + c.netChange, 0) / changes.length : 0;

    return {
      totalChanges: changes.length,
      totalFilesAdded: totalAdded,
      totalFilesRemoved: totalRemoved,
      averageNetChange: Math.round(averageNetChange * 100) / 100,
      mostAddedFiles,
      mostRemovedFiles,
    };
  }

  /**
   * Reset previous snapshot (useful for new sessions)
   */
  reset() {
    this.previousContextSnapshot = null;
  }

  /**
   * Set previous snapshot manually (useful for resuming tracking)
   */
  setPreviousSnapshot(snapshot) {
    this.previousContextSnapshot = snapshot;
  }
}

module.exports = ContextChangeTracker;
