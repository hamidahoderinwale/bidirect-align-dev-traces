/**
 * Stratified Sampling Service
 * Handles representative sampling across workspaces with variable sizes
 */

class StratifiedSamplingService {
  /**
   * Sample data with workspace stratification
   */
  sampleForClio(data, targetSize = 100000, options = {}) {
    const {
      minPerWorkspace = 50,
      maxPerWorkspace = 5000,
      stratifyBy = ['timestamp', 'type'],
      preserveDistribution = true,
    } = options;

    const byWorkspace = this.groupByWorkspace(data);
    const workspaceCount = Object.keys(byWorkspace).length;

    if (workspaceCount === 0) {
      return [];
    }

    // Calculate base samples per workspace
    const baseSamplesPerWorkspace = Math.floor(targetSize / workspaceCount);

    // Adjust for min/max constraints
    const samplesPerWorkspace = Math.max(
      minPerWorkspace,
      Math.min(maxPerWorkspace, baseSamplesPerWorkspace)
    );

    const sampled = {};

    Object.entries(byWorkspace).forEach(([workspace, items]) => {
      if (items.length <= samplesPerWorkspace) {
        // Keep all items if workspace is small
        sampled[workspace] = items;
      } else {
        // Stratified sampling for larger workspaces
        sampled[workspace] = this.stratifiedSample(items, samplesPerWorkspace, {
          stratifyBy,
          preserveDistribution,
        });
      }
    });

    return Object.values(sampled).flat();
  }

  /**
   * Perform stratified sampling
   */
  stratifiedSample(items, sampleSize, options = {}) {
    const { stratifyBy = ['timestamp'], preserveDistribution = true } = options;

    if (items.length <= sampleSize) {
      return items;
    }

    // Create strata based on stratification keys
    const strata = this.createStrata(items, stratifyBy);

    // Calculate samples per stratum
    const samplesPerStratum = this.calculateSamplesPerStratum(
      strata,
      sampleSize,
      preserveDistribution
    );

    // Sample from each stratum
    const sampled = [];
    Object.entries(strata).forEach(([stratumKey, stratumItems]) => {
      const stratumSampleSize = samplesPerStratum[stratumKey] || 0;
      if (stratumSampleSize > 0) {
        const stratumSample = this.randomSample(stratumItems, stratumSampleSize);
        sampled.push(...stratumSample);
      }
    });

    // If we didn't get enough samples, fill randomly
    if (sampled.length < sampleSize) {
      const remaining = sampleSize - sampled.length;
      const remainingItems = items.filter((item) => !sampled.includes(item));
      const additional = this.randomSample(remainingItems, remaining);
      sampled.push(...additional);
    }

    return sampled.slice(0, sampleSize);
  }

  /**
   * Create strata from items based on stratification keys
   */
  createStrata(items, stratifyBy) {
    const strata = {};

    items.forEach((item) => {
      const stratumKey = this.getStratumKey(item, stratifyBy);

      if (!strata[stratumKey]) {
        strata[stratumKey] = [];
      }

      strata[stratumKey].push(item);
    });

    return strata;
  }

  /**
   * Get stratum key for an item
   */
  getStratumKey(item, stratifyBy) {
    const keys = [];

    stratifyBy.forEach((key) => {
      if (key === 'timestamp') {
        // Stratify by time period (day, week, month)
        const timestamp = item.timestamp || item.sortTime || 0;
        const date = new Date(timestamp);
        const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        keys.push(dayKey);
      } else if (key === 'type') {
        // Stratify by item type
        const type = item.itemType || item.type || 'unknown';
        keys.push(type);
      } else {
        // Generic key extraction
        const value = item[key] || 'unknown';
        keys.push(String(value));
      }
    });

    return keys.join('|');
  }

  /**
   * Calculate samples per stratum
   */
  calculateSamplesPerStratum(strata, totalSampleSize, preserveDistribution) {
    const totalItems = Object.values(strata).reduce((sum, items) => sum + items.length, 0);
    const samplesPerStratum = {};

    if (preserveDistribution) {
      // Preserve original distribution
      Object.entries(strata).forEach(([stratumKey, stratumItems]) => {
        const proportion = stratumItems.length / totalItems;
        samplesPerStratum[stratumKey] = Math.floor(totalSampleSize * proportion);
      });
    } else {
      // Equal sampling from each stratum
      const stratumCount = Object.keys(strata).length;
      const baseSamples = Math.floor(totalSampleSize / stratumCount);

      Object.keys(strata).forEach((stratumKey, index) => {
        // Last stratum gets remainder
        if (index === stratumCount - 1) {
          const allocated = Object.values(samplesPerStratum).reduce((sum, n) => sum + n, 0);
          samplesPerStratum[stratumKey] = totalSampleSize - allocated;
        } else {
          samplesPerStratum[stratumKey] = baseSamples;
        }
      });
    }

    return samplesPerStratum;
  }

  /**
   * Random sample from array
   */
  randomSample(array, sampleSize) {
    if (array.length <= sampleSize) {
      return [...array];
    }

    const shuffled = [...array].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, sampleSize);
  }

  /**
   * Group data by workspace
   */
  groupByWorkspace(data) {
    const grouped = {};

    data.forEach((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';

      if (!grouped[workspace]) {
        grouped[workspace] = [];
      }

      grouped[workspace].push(item);
    });

    return grouped;
  }

  /**
   * Sample with workspace balancing
   */
  balancedWorkspaceSample(data, targetSize, options = {}) {
    const { minPerWorkspace = 10, maxPerWorkspace = 2000, ensureRepresentation = true } = options;

    const byWorkspace = this.groupByWorkspace(data);
    const workspaceCount = Object.keys(byWorkspace).length;

    if (workspaceCount === 0) {
      return [];
    }

    // Calculate target per workspace
    let targetPerWorkspace = Math.floor(targetSize / workspaceCount);
    targetPerWorkspace = Math.max(minPerWorkspace, Math.min(maxPerWorkspace, targetPerWorkspace));

    const sampled = {};
    let totalSampled = 0;

    // First pass: sample from each workspace
    Object.entries(byWorkspace).forEach(([workspace, items]) => {
      if (items.length <= targetPerWorkspace) {
        sampled[workspace] = items;
        totalSampled += items.length;
      } else {
        sampled[workspace] = this.randomSample(items, targetPerWorkspace);
        totalSampled += targetPerWorkspace;
      }
    });

    // Second pass: if we have room, sample more from larger workspaces
    if (totalSampled < targetSize && ensureRepresentation) {
      const remaining = targetSize - totalSampled;
      const workspaceSizes = Object.entries(byWorkspace)
        .map(([ws, items]) => ({ workspace: ws, size: items.length, sampled: sampled[ws].length }))
        .sort((a, b) => b.size - a.size);

      let allocated = 0;
      workspaceSizes.forEach(({ workspace, size, sampled: currentSampled }) => {
        if (allocated >= remaining) return;

        const available = size - currentSampled;
        if (available > 0) {
          const additional = Math.min(available, remaining - allocated);
          const additionalSample = this.randomSample(
            byWorkspace[workspace].filter((item) => !sampled[workspace].includes(item)),
            additional
          );
          sampled[workspace].push(...additionalSample);
          allocated += additional;
        }
      });
    }

    return Object.values(sampled).flat();
  }
}

module.exports = StratifiedSamplingService;
