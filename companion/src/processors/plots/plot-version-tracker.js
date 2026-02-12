/**
 * Plot Version Tracker
 * Tracks plot versions and detects regenerations
 * - Detects when same plot is regenerated
 * - Tracks version history
 * - Computes similarity between versions
 * - Detects changes between versions
 */

const crypto = require('crypto');

class PlotVersionTracker {
  constructor(persistentDB = null) {
    this.db = persistentDB;
    this.plotCache = new Map(); // Cache for quick lookups
  }

  /**
   * Track a new plot and detect if it's a regeneration
   */
  async trackPlot(plot, options = {}) {
    try {
      // Detect if this is a regeneration
      const regeneration = await this.detectRegeneration(plot, options);

      if (regeneration.isRegeneration) {
        // Get original plot
        const original = await this.getPlot(regeneration.originalPlotId);

        if (original) {
          // Detect changes
          const changes = this.detectChanges(plot, original);

          // Compute similarity
          const similarity = await this.computeSimilarity(plot, original);

          // Create version record
          const versionRecord = {
            ...plot,
            isRegeneration: true,
            originalPlotId: original.id,
            regenerationCount: (original.regenerationCount || 0) + 1,
            versionNumber: (original.versionNumber || 1) + 1,
            changesDetected: changes,
            similarityToOriginal: similarity?.overall || 0,
            similarityBreakdown: similarity?.breakdown || {},
            previousVersionId: original.id,
            createdAt: new Date().toISOString(),
          };

          // Store version
          if (this.db) {
            await this.storePlotVersion(versionRecord);
          }

          // Update original's latest version pointer
          await this.updateOriginalPlot(original.id, {
            latestVersionId: versionRecord.id,
            totalRegenerations: versionRecord.regenerationCount,
          });

          return versionRecord;
        }
      }

      // New plot - no version history
      const newPlot = {
        ...plot,
        isRegeneration: false,
        regenerationCount: 0,
        versionNumber: 1,
        createdAt: new Date().toISOString(),
      };

      if (this.db) {
        await this.storePlotVersion(newPlot);
      }

      return newPlot;
    } catch (error) {
      console.error('[PLOT] Error tracking plot:', error.message);
      return plot;
    }
  }

  /**
   * Detect if plot is a regeneration of an existing plot
   */
  async detectRegeneration(plot, options = {}) {
    // Method 1: Check by file path (for file-based plots)
    if (plot.filePath) {
      const existingByPath = await this.findPlotByPath(plot.filePath);
      if (existingByPath) {
        return {
          isRegeneration: true,
          originalPlotId: existingByPath.id,
          method: 'file_path',
        };
      }
    }

    // Method 2: Check by notebook cell (for notebook plots)
    if (plot.source === 'notebook_cell' && plot.cellIndex !== undefined && plot.notebookPath) {
      const existingByCell = await this.findPlotByCell(
        plot.notebookPath,
        plot.cellIndex,
        plot.executionCount
      );
      if (existingByCell) {
        return {
          isRegeneration: true,
          originalPlotId: existingByCell.id,
          method: 'notebook_cell',
        };
      }
    }

    // Method 3: Check by perceptual hash (content-based)
    if (plot.perceptualHash) {
      const existingByHash = await this.findPlotByHash(
        plot.perceptualHash,
        options.similarityThreshold || 0.85
      );
      if (existingByHash) {
        return {
          isRegeneration: true,
          originalPlotId: existingByHash.id,
          method: 'perceptual_hash',
          similarity: existingByHash.similarity,
        };
      }
    }

    return {
      isRegeneration: false,
    };
  }

  /**
   * Find plot by file path
   */
  async findPlotByPath(filePath) {
    if (this.db) {
      await this.db.init();
      return new Promise((resolve, reject) => {
        this.db.db.get(
          'SELECT * FROM plot_outputs WHERE file_path = ? ORDER BY created_at DESC LIMIT 1',
          [filePath],
          (err, row) => {
            if (err) {
              console.error('[PLOT] Error finding plot by path:', err);
              resolve(null);
            } else {
              resolve(row || null);
            }
          }
        );
      });
    }
    return null;
  }

  /**
   * Find plot by notebook cell
   */
  async findPlotByCell(notebookPath, cellIndex, executionCount = null) {
    if (this.db) {
      let query = 'SELECT * FROM plot_outputs WHERE notebook_path = ? AND cell_index = ?';
      const params = [notebookPath, cellIndex];

      if (executionCount !== null) {
        query += ' AND execution_count = ?';
        params.push(executionCount);
      }

      query += ' ORDER BY created_at DESC LIMIT 1';

      await this.db.init();
      return new Promise((resolve, reject) => {
        this.db.db.get(query, params, (err, row) => {
          if (err) {
            console.error('[PLOT] Error finding plot by cell:', err);
            resolve(null);
          } else {
            resolve(row || null);
          }
        });
      });
    }
    return null;
  }

  /**
   * Find plot by perceptual hash (with similarity threshold)
   */
  async findPlotByHash(hash, threshold = 0.85) {
    if (!this.db || !hash) return null;

    // Get all plots with hashes
    await this.db.init();
    return new Promise((resolve, reject) => {
      this.db.db.all(
        'SELECT * FROM plot_outputs WHERE perceptual_hash IS NOT NULL',
        [],
        async (err, rows) => {
          if (err) {
            console.error('[PLOT] Error finding plot by hash:', err);
            resolve(null);
            return;
          }

          // Compare hashes
          for (const row of rows) {
            if (row.perceptual_hash) {
              const similarity = this.compareHashes(hash, row.perceptual_hash);
              if (similarity >= threshold) {
                resolve({ ...row, similarity });
                return;
              }
            }
          }

          resolve(null);
        }
      );
    });
  }

  /**
   * Compare two perceptual hashes
   */
  compareHashes(hash1, hash2) {
    if (!hash1 || !hash2) return 0;

    const bin1 = BigInt('0x' + hash1);
    const bin2 = BigInt('0x' + hash2);
    const diff = bin1 ^ bin2;

    let distance = 0;
    let temp = diff;
    while (temp > 0n) {
      distance += Number(temp & 1n);
      temp = temp >> 1n;
    }

    const maxDistance = 64; // 8x8 dHash
    return 1 - distance / maxDistance;
  }

  /**
   * Detect changes between two plot versions
   */
  detectChanges(newPlot, originalPlot) {
    const changes = [];

    // Dimension changes
    if (newPlot.width !== originalPlot.width || newPlot.height !== originalPlot.height) {
      changes.push({
        type: 'dimension_changed',
        old: { width: originalPlot.width, height: originalPlot.height },
        new: { width: newPlot.width, height: newPlot.height },
      });
    }

    // Format changes
    if (newPlot.format !== originalPlot.format) {
      changes.push({
        type: 'format_changed',
        old: originalPlot.format,
        new: newPlot.format,
      });
    }

    // Library changes
    if (newPlot.library !== originalPlot.library) {
      changes.push({
        type: 'library_changed',
        old: originalPlot.library,
        new: newPlot.library,
      });
    }

    // Code changes (for notebook plots)
    if (newPlot.cellSource && originalPlot.cellSource) {
      if (newPlot.cellSource !== originalPlot.cellSource) {
        changes.push('code_modified');
      }
    }

    // File path changes
    if (newPlot.filePath && originalPlot.filePath && newPlot.filePath !== originalPlot.filePath) {
      changes.push('file_path_changed');
    }

    return changes;
  }

  /**
   * Compute similarity between two plots
   */
  async computeSimilarity(plot1, plot2) {
    const scores = {};

    // Perceptual hash similarity
    if (plot1.perceptualHash && plot2.perceptualHash) {
      scores.perceptual = this.compareHashes(plot1.perceptualHash, plot2.perceptualHash);
    }

    // Dimension similarity
    if (plot1.width && plot2.width && plot1.height && plot2.height) {
      const widthSim = Math.min(plot1.width, plot2.width) / Math.max(plot1.width, plot2.width);
      const heightSim = Math.min(plot1.height, plot2.height) / Math.max(plot1.height, plot2.height);
      scores.dimensions = (widthSim + heightSim) / 2;
    }

    // Format similarity
    scores.format = plot1.format === plot2.format ? 1 : 0;

    // Library similarity
    scores.library = plot1.library === plot2.library ? 1 : 0;

    // Weighted combination
    const overall =
      (scores.perceptual || 0) * 0.5 +
      (scores.dimensions || 0) * 0.2 +
      (scores.format || 0) * 0.15 +
      (scores.library || 0) * 0.15;

    return {
      overall: Math.max(0, Math.min(1, overall)),
      breakdown: scores,
    };
  }

  /**
   * Store plot version in database
   */
  async storePlotVersion(plot) {
    if (!this.db) return;

    await this.db.init();
    return new Promise((resolve, reject) => {
      this.db.db.run(
        `INSERT OR REPLACE INTO plot_outputs (
          id, plot_type, source_type, file_path, notebook_path, cell_index,
          execution_count, format, library, width, height, size,
          perceptual_hash, thumbnail_path, is_regeneration, original_plot_id,
          regeneration_count, version_number, changes_detected, similarity_to_original,
          created_at, execution_timestamp, cell_source, script_path, workspace_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plot.id,
          plot.type || 'unknown',
          plot.source || 'unknown',
          plot.filePath || null,
          plot.notebookPath || null,
          plot.cellIndex !== undefined ? plot.cellIndex : null,
          plot.executionCount || null,
          plot.format || null,
          plot.library || null,
          plot.width || null,
          plot.height || null,
          plot.size || null,
          plot.perceptualHash || null,
          plot.thumbnailPath || null,
          plot.isRegeneration ? 1 : 0,
          plot.originalPlotId || null,
          plot.regenerationCount || 0,
          plot.versionNumber || 1,
          JSON.stringify(plot.changesDetected || []),
          plot.similarityToOriginal || null,
          plot.createdAt || new Date().toISOString(),
          plot.executionTime ? new Date(plot.executionTime).toISOString() : null,
          plot.cellSource || null,
          plot.scriptPath || null,
          plot.workspacePath || null,
        ],
        function (err) {
          if (err) {
            console.error('[PLOT] Error storing plot:', err);
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  /**
   * Update original plot with version info
   */
  async updateOriginalPlot(plotId, updates) {
    if (!this.db) return;

    const setClause = Object.keys(updates)
      .map((key) => `${key} = ?`)
      .join(', ');
    const values = Object.values(updates);

    await this.db.init();
    return new Promise((resolve, reject) => {
      this.db.db.run(
        `UPDATE plot_outputs SET ${setClause} WHERE id = ?`,
        [...values, plotId],
        (err) => {
          if (err) {
            console.error('[PLOT] Error updating original plot:', err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Get plot by ID
   */
  async getPlot(plotId) {
    if (this.db) {
      await this.db.init();
      return new Promise((resolve, reject) => {
        this.db.db.get('SELECT * FROM plot_outputs WHERE id = ?', [plotId], (err, row) => {
          if (err) {
            console.error('[PLOT] Error getting plot:', err);
            resolve(null);
          } else {
            resolve(row || null);
          }
        });
      });
    }
    return null;
  }

  /**
   * Get version history for a plot
   */
  async getVersionHistory(plotId) {
    if (!this.db) return [];

    await this.db.init();
    return new Promise((resolve, reject) => {
      this.db.db.all(
        `WITH RECURSIVE version_chain AS (
          SELECT * FROM plot_outputs WHERE id = ?
          UNION ALL
          SELECT p.* FROM plot_outputs p
          INNER JOIN version_chain v ON p.original_plot_id = v.id
        )
        SELECT * FROM version_chain ORDER BY created_at`,
        [plotId],
        (err, rows) => {
          if (err) {
            console.error('[PLOT] Error getting version history:', err);
            resolve([]);
          } else {
            resolve(rows || []);
          }
        }
      );
    });
  }
}

module.exports = PlotVersionTracker;
