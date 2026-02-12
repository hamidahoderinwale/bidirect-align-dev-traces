/**
 * Automatic Hugging Face Sync Service
 * Periodically exports and uploads companion service data to Hugging Face Hub
 */

const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const HuggingFaceExporter = require('./huggingface-exporter.js');
const HuggingFaceUploadService = require('./huggingface-upload-service.js');

class AutomaticHuggingFaceSyncService {
  constructor(persistentDB, huggingFaceUploadService, options = {}) {
    this.persistentDB = persistentDB;
    this.uploadService = huggingFaceUploadService;
    this.options = {
      enabled: options.enabled !== false,
      syncInterval: options.syncInterval || '0 */6 * * *', // Every 6 hours by default
      privacyLevel: options.privacyLevel || 'clio', // Default to highest privacy
      includeCode: options.includeCode !== false,
      includePrompts: options.includePrompts !== false,
      anonymize: options.anonymize !== false,
      maxSamples: options.maxSamples || 10000,
      incrementalSync: options.incrementalSync !== false, // Only sync new data since last sync
      autoCleanup: options.autoCleanup !== false, // Clean up export directories after upload
      ...options,
    };

    this.scheduledJobs = [];
    this.isInitialized = false;
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.lastSyncResult = null;
    this.syncConfig = null; // Will be loaded from database
  }

  /**
   * Initialize automatic sync
   */
  async initialize() {
    if (!this.options.enabled) {
      console.log('[HF-SYNC] Automatic Hugging Face sync disabled');
      return;
    }

    console.log('[HF-SYNC] Initializing automatic Hugging Face sync service');

    // Load sync configuration from database
    await this.loadSyncConfig();

    // Only schedule if we have valid configuration (sessionId and repoName)
    if (this.syncConfig && this.syncConfig.sessionId && this.syncConfig.repoName) {
      // Schedule periodic sync
      this.schedulePeriodicSync();

      // Load last sync time
      await this.loadLastSyncTime();

      this.isInitialized = true;
      console.log('[HF-SYNC] Automatic Hugging Face sync initialized');
      console.log(`[HF-SYNC] Sync schedule: ${this.getCronDescription(this.options.syncInterval)}`);
      console.log(`[HF-SYNC] Repository: ${this.syncConfig.repoName}`);
      console.log(`[HF-SYNC] Privacy level: ${this.options.privacyLevel}`);
    } else {
      console.log('[HF-SYNC] No sync configuration found. Please configure via API or UI.');
    }
  }

  /**
   * Load sync configuration from database
   */
  async loadSyncConfig() {
    try {
      // Try to get sync config from database
      // For now, we'll use a simple approach - store in a table or use environment variables
      // In production, this should be stored in a dedicated table

      // Check for environment variables as fallback
      if (process.env.HF_SYNC_SESSION_ID && process.env.HF_SYNC_REPO_NAME) {
        this.syncConfig = {
          sessionId: process.env.HF_SYNC_SESSION_ID,
          repoName: process.env.HF_SYNC_REPO_NAME,
          privacyLevel: process.env.HF_SYNC_PRIVACY_LEVEL || this.options.privacyLevel,
        };
        console.log('[HF-SYNC] Loaded sync config from environment variables');
        return;
      }

      // Try to get from database (would need a sync_config table)
      // For now, return null and require manual configuration
      this.syncConfig = null;
    } catch (error) {
      console.error('[HF-SYNC] Error loading sync config:', error);
      this.syncConfig = null;
    }
  }

  /**
   * Set sync configuration
   */
  async setSyncConfig(config) {
    this.syncConfig = {
      sessionId: config.sessionId,
      repoName: config.repoName,
      privacyLevel: config.privacyLevel || this.options.privacyLevel,
    };

    // Store in database (would need a sync_config table)
    // For now, just store in memory

    // If not initialized, initialize now
    if (!this.isInitialized && this.options.enabled) {
      await this.initialize();
    } else if (this.isInitialized) {
      // Restart scheduler with new config
      this.stop();
      await this.initialize();
    }

    return { success: true, config: this.syncConfig };
  }

  /**
   * Load last sync time from database
   */
  async loadLastSyncTime() {
    try {
      // In production, store this in database
      // For now, we'll track it in memory and use file timestamps
      this.lastSyncTime = null; // Will be set after first successful sync
    } catch (error) {
      console.error('[HF-SYNC] Error loading last sync time:', error);
    }
  }

  /**
   * Schedule periodic sync using cron
   */
  schedulePeriodicSync() {
    if (!this.syncConfig) {
      console.warn('[HF-SYNC] Cannot schedule sync: no configuration');
      return;
    }

    const job = cron.schedule(this.options.syncInterval, async () => {
      console.log('[HF-SYNC] Running scheduled sync');
      await this.sync();
    });

    this.scheduledJobs.push(job);

    console.log(
      `[HF-SYNC] Scheduled periodic sync: ${this.getCronDescription(this.options.syncInterval)}`
    );
  }

  /**
   * Perform sync (export + upload)
   */
  async sync(options = {}) {
    if (this.isSyncing) {
      console.log('[HF-SYNC] Sync already in progress, skipping');
      return { success: false, error: 'Sync already in progress' };
    }

    if (!this.syncConfig || !this.syncConfig.sessionId || !this.syncConfig.repoName) {
      console.error('[HF-SYNC] Cannot sync: missing configuration');
      return { success: false, error: 'Missing sync configuration (sessionId or repoName)' };
    }

    this.isSyncing = true;
    const startTime = Date.now();

    try {
      console.log('[HF-SYNC] Starting sync to Hugging Face Hub...');
      console.log(`[HF-SYNC] Repository: ${this.syncConfig.repoName}`);
      console.log(
        `[HF-SYNC] Privacy level: ${this.syncConfig.privacyLevel || this.options.privacyLevel}`
      );

      // Step 1: Export data to HF format
      const outputDir = path.join(__dirname, '../../data', `hf-sync-${Date.now()}`);
      const privacyLevel =
        options.privacyLevel || this.syncConfig.privacyLevel || this.options.privacyLevel;

      const exporter = new HuggingFaceExporter(this.persistentDB, {
        privacyLevel,
        includeCode: this.options.includeCode,
        includePrompts: this.options.includePrompts,
        anonymize: this.options.anonymize,
        maxSamples: options.maxSamples || this.options.maxSamples,
      });

      console.log('[HF-SYNC] Exporting data to Hugging Face format...');
      const exportResult = await exporter.exportToHuggingFaceFormat(outputDir);

      console.log(`[HF-SYNC] Export complete: ${exportResult.totalSamples} samples`);

      // Step 2: Upload to Hugging Face Hub
      console.log('[HF-SYNC] Uploading to Hugging Face Hub...');
      const uploadResult = await this.uploadService.uploadDataset(
        this.syncConfig.sessionId,
        this.syncConfig.repoName,
        exportResult.outputDir,
        {
          private: options.private !== false,
          commitMessage:
            options.commitMessage ||
            `Auto-sync: ${new Date().toISOString()} (${exportResult.totalSamples} samples)`,
        }
      );

      console.log(`[HF-SYNC] Upload complete: ${uploadResult.repoUrl}`);

      // Step 3: Clean up export directory if enabled
      if (this.options.autoCleanup) {
        try {
          fs.rmSync(outputDir, { recursive: true, force: true });
          console.log('[HF-SYNC] Cleaned up export directory');
        } catch (cleanupError) {
          console.warn('[HF-SYNC] Failed to cleanup export directory:', cleanupError.message);
        }
      }

      // Step 4: Update last sync time
      this.lastSyncTime = Date.now();
      this.lastSyncResult = {
        success: true,
        timestamp: this.lastSyncTime,
        exportResult,
        uploadResult,
        duration_ms: Date.now() - startTime,
      };

      // Store last sync time in database (would need a sync_log table)
      await this.saveLastSyncTime();

      console.log(
        `[HF-SYNC] ✅ Sync completed successfully in ${(Date.now() - startTime) / 1000}s`
      );

      return this.lastSyncResult;
    } catch (error) {
      console.error('[HF-SYNC] Sync failed:', error);
      this.lastSyncResult = {
        success: false,
        error: error.message,
        timestamp: Date.now(),
        duration_ms: Date.now() - startTime,
      };
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Save last sync time to database
   */
  async saveLastSyncTime() {
    try {
      // In production, store in database
      // For now, just keep in memory
    } catch (error) {
      console.error('[HF-SYNC] Error saving last sync time:', error);
    }
  }

  /**
   * Manually trigger sync
   */
  async triggerSync(options = {}) {
    return this.sync(options);
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    this.scheduledJobs.forEach((job) => {
      if (job && job.stop) {
        job.stop();
      }
    });
    this.scheduledJobs = [];
    console.log('[HF-SYNC] Scheduler stopped');
  }

  /**
   * Get sync status
   */
  getStatus() {
    return {
      enabled: this.options.enabled,
      initialized: this.isInitialized,
      isSyncing: this.isSyncing,
      hasConfig: !!this.syncConfig,
      config: this.syncConfig
        ? {
            repoName: this.syncConfig.repoName,
            privacyLevel: this.syncConfig.privacyLevel || this.options.privacyLevel,
            // Don't expose sessionId
          }
        : null,
      lastSyncTime: this.lastSyncTime,
      lastSyncResult: this.lastSyncResult
        ? {
            success: this.lastSyncResult.success,
            timestamp: this.lastSyncResult.timestamp,
            duration_ms: this.lastSyncResult.duration_ms,
            samples: this.lastSyncResult.exportResult?.totalSamples,
            repoUrl: this.lastSyncResult.uploadResult?.repoUrl,
            error: this.lastSyncResult.error,
          }
        : null,
      scheduledJobs: this.scheduledJobs.length,
      syncInterval: this.options.syncInterval,
      nextSync: this.getNextSyncTime(),
    };
  }

  /**
   * Get next scheduled sync time
   */
  getNextSyncTime() {
    if (this.scheduledJobs.length === 0) {
      return null;
    }

    // Cron doesn't provide next execution time directly
    // Would need to calculate from cron pattern
    // For now, return the pattern description
    return this.getCronDescription(this.options.syncInterval);
  }

  /**
   * Get human-readable cron description
   */
  getCronDescription(pattern) {
    // Simple descriptions for common patterns
    const patterns = {
      '0 */6 * * *': 'Every 6 hours',
      '0 */12 * * *': 'Every 12 hours',
      '0 0 * * *': 'Daily at midnight',
      '0 0 * * 0': 'Weekly on Sunday',
      '0 0 1 * *': 'Monthly on the 1st',
    };

    return patterns[pattern] || pattern;
  }
}

module.exports = AutomaticHuggingFaceSyncService;
