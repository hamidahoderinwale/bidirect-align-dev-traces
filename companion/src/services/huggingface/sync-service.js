/**
 * Automatic Hugging Face Sync Service
 */

const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const HuggingFaceExporter = require('./exporter.js');

class HuggingFaceSyncService {
  constructor(persistentDB, uploader, options = {}) {
    this.db = persistentDB;
    this.uploader = uploader;
    this.options = {
      enabled: options.enabled === 'true',
      interval: options.interval || '0 */6 * * *',
      privacyLevel: options.privacyLevel || 'clio',
      ...options
    };
    this.job = null;
  }

  async start(sessionId, repoName) {
    if (this.job) this.job.stop();
    this.job = cron.schedule(this.options.interval, async () => {
      console.log('[HF-SYNC] Running scheduled sync...');
      const outputDir = path.join(__dirname, '../../../data', `hf-sync-${Date.now()}`);
      const exporter = new HuggingFaceExporter(this.db, { privacyLevel: this.options.privacyLevel });
      const result = await exporter.exportToHuggingFaceFormat(outputDir);
      await this.uploader.uploadDataset(sessionId, repoName, result.outputDir);
      fs.rmSync(outputDir, { recursive: true, force: true });
    });
  }

  stop() {
    if (this.job) this.job.stop();
  }
}

module.exports = HuggingFaceSyncService;

