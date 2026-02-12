/**
 * Hugging Face Dataset Exporter
 * Converts Cursor telemetry data to Hugging Face Dataset format
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

class HuggingFaceExporter {
  constructor(persistentDB, options = {}) {
    this.db = persistentDB;
    this.options = {
      privacyLevel: options.privacyLevel || 'clio', // 'raw', 'tokens', 'semantic_edits', 'functions', 'module_graph', 'clio'
      includeCode: options.includeCode !== false,
      includePrompts: options.includePrompts !== false,
      anonymize: options.anonymize !== false,
      maxSamples: options.maxSamples || 10000,
      workspace: options.workspace || null,
      ...options,
    };
  }

  /**
   * Export telemetry data in Hugging Face Dataset format
   */
  async exportToHuggingFaceFormat(outputDir) {
    console.log('[HF-EXPORT] Starting Hugging Face export...');

    try {
      await mkdirAsync(outputDir, { recursive: true });
      const splits = await this.createDatasetSplits();
      await this.writeDatasetFiles(outputDir, splits);
      await this.generateDatasetCard(outputDir, splits);
      await this.generateDatasetScript(outputDir);

      console.log(`[HF-EXPORT] Export complete! Output: ${outputDir}`);
      return {
        success: true,
        outputDir,
        totalSamples: splits.train.length + splits.validation.length,
        files: [
          path.join(outputDir, 'train.jsonl'),
          path.join(outputDir, 'validation.jsonl'),
          path.join(outputDir, 'README.md'),
          path.join(outputDir, 'cursor_telemetry.py'),
        ],
      };
    } catch (error) {
      console.error('[HF-EXPORT] Export failed:', error);
      throw error;
    }
  }

  async createDatasetSplits() {
    let entries;
    if (this.options.since || this.options.until) {
      entries = await this.db.getEntriesInTimeRange(
        this.options.since || 0,
        this.options.until || Date.now(),
        this.options.workspace || null,
        this.options.maxSamples
      );
    } else {
      entries = await this.db.getRecentEntries(
        this.options.maxSamples,
        null,
        0,
        this.options.workspace || null
      );
    }

    let prompts = [];
    if (this.options.includePrompts) {
      const allPrompts = await this.db.getRecentPrompts(
        this.options.maxSamples * 2,
        0,
        this.options.workspace || null
      );
      prompts = allPrompts
        .filter((p) => {
          const timestamp = new Date(p.timestamp || p.created_at || 0).getTime();
          if (this.options.since && timestamp < this.options.since) return false;
          if (this.options.until && timestamp > this.options.until) return false;
          return true;
        })
        .slice(0, this.options.maxSamples);
    }

    const processedSamples = this.processDataForExport(entries, prompts);
    const splitIndex = Math.floor(processedSamples.length * 0.9);

    return {
      train: processedSamples.slice(0, splitIndex),
      validation: processedSamples.slice(splitIndex),
    };
  }

  processDataForExport(entries, prompts) {
    const samples = [];

    entries.forEach((entry) => {
      const sample = {
        id: entry.id,
        timestamp: entry.timestamp,
        type: 'code_change',
        source: entry.source,
      };

      if (entry.file_path) {
        sample.file_path = this.options.anonymize
          ? this.anonymizeFilePath(entry.file_path)
          : entry.file_path;
        sample.file_extension = path.extname(entry.file_path).slice(1);
        sample.file_type = this.detectFileType(entry.file_path);
      }

      if (this.options.includeCode && this.options.privacyLevel !== 'clio') {
        if (this.options.privacyLevel === 'raw' || this.options.privacyLevel === 'tokens') {
          sample.before_code = entry.before_code || '';
          sample.after_code = entry.after_code || '';
        }
        sample.diff_stats = this.calculateDiffStats(entry.before_code || '', entry.after_code || '');
      }

      samples.push(sample);
    });

    if (this.options.includePrompts) {
      prompts.forEach((prompt) => {
        const sample = {
          id: `prompt_${prompt.id}`,
          timestamp: prompt.timestamp,
          type: 'ai_interaction',
          mode: prompt.mode || 'chat',
          model_name: prompt.model_name,
        };

        if (prompt.text) {
          sample.prompt_text = this.sanitizePromptText(prompt.text);
        }

        samples.push(sample);
      });
    }

    return samples;
  }

  calculateDiffStats(before, after) {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    return {
      lines_added: Math.max(0, afterLines.length - beforeLines.length),
      lines_removed: Math.max(0, beforeLines.length - afterLines.length),
      chars_added: Math.max(0, after.length - before.length),
      chars_removed: Math.max(0, before.length - after.length),
    };
  }

  anonymizeFilePath(filePath) {
    let anonymized = filePath
      .replace(/\/Users\/[^\/]+\//g, '/Users/<username>/')
      .replace(/\/home\/[^\/]+\//g, '/home/<username>/');
    const parts = anonymized.split('/');
    if (parts.length > 3) return `<workspace>/${parts.slice(-3).join('/')}`;
    return anonymized;
  }

  detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = { '.js': 'javascript', '.ts': 'typescript', '.py': 'python', '.rs': 'rust', '.go': 'go' };
    return typeMap[ext] || 'other';
  }

  sanitizePromptText(text) {
    if (!text) return '';
    text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<EMAIL>');
    text = text.replace(/https?:\/\/[^\s]+/g, '<URL>');
    if (text.length > 2000) text = text.substring(0, 2000) + '...<truncated>';
    return text;
  }

  async writeDatasetFiles(outputDir, splits) {
    await writeFileAsync(path.join(outputDir, 'train.jsonl'), splits.train.map(s => JSON.stringify(s)).join('\n'));
    await writeFileAsync(path.join(outputDir, 'validation.jsonl'), splits.validation.map(s => JSON.stringify(s)).join('\n'));
  }

  async generateDatasetCard(outputDir, splits) {
    const totalSamples = splits.train.length + splits.validation.length;
    const readme = `---
license: apache-2.0
tags:
- cursor
- telemetry
- developer-activity
---

# Cursor Telemetry Dataset
Exported with privacy level: ${this.options.privacyLevel}.
Total samples: ${totalSamples.toLocaleString()}.
`;
    await writeFileAsync(path.join(outputDir, 'README.md'), readme);
  }

  async generateDatasetScript(outputDir) {
    const script = `import json\nimport datasets\n# Minimal loading script\n`;
    await writeFileAsync(path.join(outputDir, 'cursor_telemetry.py'), script);
  }
}

module.exports = HuggingFaceExporter;

