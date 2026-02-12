/**
 * Motif Service (Rung 6)
 * Orchestrates motif extraction and management
 */

const MotifExtractor = require('./motif-extractor');

class MotifService {
  constructor(persistentDB, options = {}) {
    this.db = persistentDB;
    this.extractor = new MotifExtractor(options.extractorOptions);
    this.motifCache = new Map();
  }

  /**
   * Process canonical DAGs and extract motifs
   */
  async processDAGsToMotifs(canonicalDAGs, options = {}) {
    const { forceRefresh = false, minClusterSize = 10 } = options;

    // Check cache
    const cacheKey = this.getCacheKey(canonicalDAGs);
    if (!forceRefresh && this.motifCache.has(cacheKey)) {
      return this.motifCache.get(cacheKey);
    }

    // Extract motifs
    const motifs = await this.extractor.extractMotifs(canonicalDAGs);

    // Store in cache
    this.motifCache.set(cacheKey, motifs);

    // Optionally persist to database
    if (this.db) {
      await this.persistMotifs(motifs);
    }

    return motifs;
  }

  /**
   * Get all motifs with filters
   */
  async getMotifs(filters = {}) {
    const {
      intentClass = null,
      motifShape = null,
      complexityBand = null,
      frequencyBand = null,
      modelInvolvement = null,
    } = filters;

    // Load from database or cache
    let motifs = await this.loadMotifs();

    // Apply filters
    if (intentClass) {
      motifs = motifs.filter((m) => m.dominantIntent === intentClass);
    }

    if (motifShape) {
      motifs = motifs.filter((m) => m.shape === motifShape);
    }

    if (complexityBand) {
      motifs = this.filterByComplexity(motifs, complexityBand);
    }

    if (frequencyBand) {
      motifs = this.filterByFrequency(motifs, frequencyBand);
    }

    if (modelInvolvement) {
      motifs = this.filterByModelInvolvement(motifs, modelInvolvement);
    }

    return motifs;
  }

  /**
   * Get single motif by ID
   */
  async getMotif(motifId) {
    const motifs = await this.loadMotifs();
    return motifs.find((m) => m.id === motifId);
  }

  /**
   * Get motif frequency timeline
   */
  async getMotifTimeline(motifId, timeRange = null) {
    // This would query the database for motif occurrences over time
    // For now, return placeholder structure
    return {
      motifId,
      timeline: [],
      totalOccurrences: 0,
    };
  }

  /**
   * Filter by complexity band
   */
  filterByComplexity(motifs, band) {
    const bands = {
      short: { min: 0, max: 5 },
      medium: { min: 5, max: 15 },
      long: { min: 15, max: Infinity },
    };

    const range = bands[band] || bands.medium;
    return motifs.filter((m) => {
      const length = m.stats?.medianLength || 0;
      return length >= range.min && length < range.max;
    });
  }

  /**
   * Filter by frequency band
   */
  filterByFrequency(motifs, band) {
    const frequencies = motifs.map((m) => m.frequency);
    const maxFreq = Math.max(...frequencies);
    const minFreq = Math.min(...frequencies);
    const medianFreq = this.median(frequencies);

    const bands = {
      common: { min: medianFreq, max: Infinity },
      rare: { min: minFreq, max: medianFreq },
    };

    const range = bands[band] || bands.common;
    return motifs.filter((m) => m.frequency >= range.min && m.frequency <= range.max);
  }

  /**
   * Filter by model involvement
   */
  filterByModelInvolvement(motifs, level) {
    // This would require model/human ratio in stats
    // For now, placeholder
    return motifs;
  }

  /**
   * Load motifs from database
   */
  async loadMotifs() {
    if (!this.db) {
      return [];
    }

    try {
      await this.db.init();
      return new Promise((resolve, reject) => {
        this.db.db.all('SELECT * FROM motifs ORDER BY frequency DESC', (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows.map((row) => JSON.parse(row.data || '{}')));
          }
        });
      });
    } catch (error) {
      console.warn('[MOTIF] Failed to load motifs from database:', error.message);
      return [];
    }
  }

  /**
   * Persist motifs to database
   */
  async persistMotifs(motifs) {
    if (!this.db) return;

    try {
      await this.db.init();

      for (const motif of motifs) {
        await new Promise((resolve, reject) => {
          this.db.db.run(
            `INSERT OR REPLACE INTO motifs (id, data, frequency, created_at) 
             VALUES (?, ?, ?, ?)`,
            [motif.id, JSON.stringify(motif), motif.frequency, new Date().toISOString()],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    } catch (error) {
      console.warn('[MOTIF] Failed to persist motifs:', error.message);
    }
  }

  /**
   * Generate cache key
   */
  getCacheKey(dags) {
    return `motifs_${dags.length}_${Date.now()}`;
  }

  /**
   * Utility: Median
   */
  median(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }
}

module.exports = MotifService;
