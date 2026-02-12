/**
 * Hugging Face Dataset Exporter
 * Converts Cursor telemetry data to Hugging Face Dataset format
 *
 * Usage:
 *   const exporter = new HuggingFaceExporter(persistentDB);
 *   await exporter.exportToHuggingFaceFormat('/path/to/output');
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
      includeCode: options.includeCode !== false, // Include code diffs (disable for high privacy)
      includePrompts: options.includePrompts !== false,
      anonymize: options.anonymize !== false, // Anonymize file paths and workspace names
      maxSamples: options.maxSamples || 10000, // Limit dataset size
      workspace: options.workspace || null, // Filter by workspace
      ...options,
    };
  }

  /**
   * Export telemetry data in Hugging Face Dataset format
   */
  async exportToHuggingFaceFormat(outputDir) {
    console.log('[HF-EXPORT] Starting Hugging Face export...');
    console.log(`[HF-EXPORT] Privacy level: ${this.options.privacyLevel}`);

    try {
      // Create output directory
      await mkdirAsync(outputDir, { recursive: true });

      // Export different splits
      const splits = await this.createDatasetSplits();

      // Write dataset files
      await this.writeDatasetFiles(outputDir, splits);

      // Generate dataset card (README.md)
      await this.generateDatasetCard(outputDir, splits);

      // Generate dataset script
      await this.generateDatasetScript(outputDir);

      console.log(`[HF-EXPORT] ✅ Export complete! Output: ${outputDir}`);
      console.log(`[HF-EXPORT] Total samples: ${splits.train.length + splits.validation.length}`);

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

  /**
   * Create train/validation splits
   */
  async createDatasetSplits() {
    // Get data from database with workspace and date range filters
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
      if (this.options.since || this.options.until) {
        // Filter prompts by date range if needed
        const allPrompts = await this.db.getRecentPrompts(
          this.options.maxSamples * 2, // Get more to filter
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
      } else {
        prompts = await this.db.getRecentPrompts(
          this.options.maxSamples,
          0,
          this.options.workspace || null
        );
      }
    }

    // Process and anonymize data
    const processedSamples = this.processDataForExport(entries, prompts);

    // Split 90/10 train/validation
    const splitIndex = Math.floor(processedSamples.length * 0.9);

    return {
      train: processedSamples.slice(0, splitIndex),
      validation: processedSamples.slice(splitIndex),
    };
  }

  /**
   * Process and anonymize data based on privacy level
   */
  processDataForExport(entries, prompts) {
    const samples = [];

    // Process entries (code changes)
    entries.forEach((entry) => {
      const sample = {
        id: entry.id,
        timestamp: entry.timestamp,
        type: 'code_change',
        source: entry.source,
      };

      // Add file path (anonymized if needed)
      if (entry.file_path) {
        sample.file_path = this.options.anonymize
          ? this.anonymizeFilePath(entry.file_path)
          : entry.file_path;
        sample.file_extension = path.extname(entry.file_path).slice(1);
        sample.file_type = this.detectFileType(entry.file_path);
      }

      // Add code based on privacy level
      if (this.options.includeCode && this.options.privacyLevel !== 'clio') {
        if (this.options.privacyLevel === 'raw' || this.options.privacyLevel === 'tokens') {
          sample.before_code = entry.before_code || '';
          sample.after_code = entry.after_code || '';
        }

        // Calculate diff stats
        sample.diff_stats = this.calculateDiffStats(
          entry.before_code || '',
          entry.after_code || ''
        );
      }

      // Add tags
      if (entry.tags) {
        sample.tags = typeof entry.tags === 'string' ? JSON.parse(entry.tags) : entry.tags;
      }

      // Add notes (sanitized)
      if (entry.notes) {
        sample.notes = this.sanitizeText(entry.notes);
      }

      samples.push(sample);
    });

    // Process prompts (AI interactions)
    if (this.options.includePrompts) {
      prompts.forEach((prompt) => {
        const sample = {
          id: `prompt_${prompt.id}`,
          timestamp: prompt.timestamp,
          type: 'ai_interaction',
          mode: prompt.mode || 'chat',
          model_type: prompt.model_type,
          model_name: prompt.model_name,
        };

        // Add prompt text (sanitized for privacy)
        if (prompt.text) {
          sample.prompt_text = this.sanitizePromptText(prompt.text);
          sample.prompt_length = prompt.text.length;
        }

        // Add metadata
        if (prompt.context_usage) {
          sample.context_usage = prompt.context_usage;
        }

        if (prompt.lines_added || prompt.lines_removed) {
          sample.impact = {
            lines_added: prompt.lines_added || 0,
            lines_removed: prompt.lines_removed || 0,
          };
        }

        samples.push(sample);
      });
    }

    return samples;
  }

  /**
   * Calculate diff statistics
   */
  calculateDiffStats(before, after) {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');

    return {
      lines_added: Math.max(0, afterLines.length - beforeLines.length),
      lines_removed: Math.max(0, beforeLines.length - afterLines.length),
      chars_added: Math.max(0, after.length - before.length),
      chars_removed: Math.max(0, before.length - after.length),
      total_lines_before: beforeLines.length,
      total_lines_after: afterLines.length,
    };
  }

  /**
   * Anonymize file path
   */
  anonymizeFilePath(filePath) {
    // Replace specific paths with generic placeholders
    let anonymized = filePath
      .replace(/\/Users\/[^\/]+\//g, '/Users/<username>/')
      .replace(/\/home\/[^\/]+\//g, '/home/<username>/')
      .replace(/C:\\Users\\[^\\]+\\/g, 'C:\\Users\\<username>\\');

    // Hash workspace-specific prefixes
    const parts = anonymized.split('/');
    if (parts.length > 3) {
      // Keep file structure but anonymize project name
      return `<workspace>/${parts.slice(-3).join('/')}`;
    }

    return anonymized;
  }

  /**
   * Detect file type from extension
   */
  detectFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.js': 'javascript',
      '.ts': 'typescript',
      '.jsx': 'react',
      '.tsx': 'react-typescript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.rs': 'rust',
      '.go': 'go',
      '.rb': 'ruby',
      '.php': 'php',
      '.html': 'html',
      '.css': 'css',
      '.json': 'json',
      '.md': 'markdown',
      '.sql': 'sql',
      '.sh': 'shell',
    };
    return typeMap[ext] || 'other';
  }

  /**
   * Sanitize text by removing PII
   */
  sanitizeText(text) {
    if (!text) return '';

    // Remove email addresses
    text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<EMAIL>');

    // Remove URLs
    text = text.replace(/https?:\/\/[^\s]+/g, '<URL>');

    // Remove IP addresses
    text = text.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>');

    // Remove API keys (common patterns)
    text = text.replace(/[a-zA-Z0-9]{32,}/g, '<TOKEN>');

    return text;
  }

  /**
   * Sanitize prompt text for privacy
   */
  sanitizePromptText(text) {
    if (!text) return '';

    // Basic sanitization
    text = this.sanitizeText(text);

    // Truncate very long prompts
    if (text.length > 2000) {
      text = text.substring(0, 2000) + '...<truncated>';
    }

    return text;
  }

  /**
   * Write dataset files in JSONL format
   */
  async writeDatasetFiles(outputDir, splits) {
    // Write train split
    const trainPath = path.join(outputDir, 'train.jsonl');
    const trainLines = splits.train.map((sample) => JSON.stringify(sample)).join('\n');
    await writeFileAsync(trainPath, trainLines);
    console.log(`[HF-EXPORT] ✅ Written train split: ${splits.train.length} samples`);

    // Write validation split
    const validationPath = path.join(outputDir, 'validation.jsonl');
    const validationLines = splits.validation.map((sample) => JSON.stringify(sample)).join('\n');
    await writeFileAsync(validationPath, validationLines);
    console.log(`[HF-EXPORT] ✅ Written validation split: ${splits.validation.length} samples`);
  }

  /**
   * Generate dataset card (README.md)
   */
  async generateDatasetCard(outputDir, splits) {
    const totalSamples = splits.train.length + splits.validation.length;
    const codeChanges = splits.train.filter((s) => s.type === 'code_change').length;
    const aiInteractions = splits.train.filter((s) => s.type === 'ai_interaction').length;

    const readme = `---
license: apache-2.0
task_categories:
- text-generation
- code-generation
language:
- en
tags:
- cursor
- telemetry
- developer-activity
- code-changes
- ai-assisted-coding
size_categories:
- ${totalSamples < 1000 ? '1K<n<10K' : totalSamples < 10000 ? '10K<n<100K' : '100K<n<1M'}
---

# Cursor Telemetry Dataset

This dataset contains telemetry data from Cursor IDE usage, capturing developer activity, code changes, and AI interactions.

## Dataset Summary

- **Privacy Level**: ${this.options.privacyLevel}
- **Total Samples**: ${totalSamples.toLocaleString()}
- **Code Changes**: ${codeChanges.toLocaleString()}
- **AI Interactions**: ${aiInteractions.toLocaleString()}
- **Anonymized**: ${this.options.anonymize ? 'Yes' : 'No'}

## Dataset Structure

### Data Fields

**Code Change Events:**
- \`id\`: Unique identifier
- \`timestamp\`: ISO 8601 timestamp
- \`type\`: Event type (code_change)
- \`file_path\`: File path (anonymized if enabled)
- \`file_extension\`: File extension (.js, .py, etc.)
- \`file_type\`: Language/file type
- \`diff_stats\`: Object with change statistics
  - \`lines_added\`: Number of lines added
  - \`lines_removed\`: Number of lines removed
  - \`chars_added\`: Number of characters added
  - \`chars_removed\`: Number of characters removed
- \`tags\`: Array of tags
- \`notes\`: Description of change

**AI Interaction Events:**
- \`id\`: Unique identifier
- \`timestamp\`: ISO 8601 timestamp
- \`type\`: Event type (ai_interaction)
- \`mode\`: Interaction mode (chat, inline, etc.)
- \`model_type\`: AI model type
- \`model_name\`: AI model name
- \`prompt_text\`: Sanitized prompt text
- \`prompt_length\`: Length of original prompt
- \`context_usage\`: Context tokens used
- \`impact\`: Object with impact metrics
  - \`lines_added\`: Lines added by AI
  - \`lines_removed\`: Lines removed by AI

## Usage

\`\`\`python
from datasets import load_dataset

# Load the dataset
dataset = load_dataset("path/to/dataset")

# Access train split
train_data = dataset["train"]

# Filter code changes
code_changes = train_data.filter(lambda x: x["type"] == "code_change")

# Filter AI interactions
ai_interactions = train_data.filter(lambda x: x["type"] == "ai_interaction")
\`\`\`

## Privacy & Ethics

${
  this.options.anonymize
    ? `
- **Anonymization**: File paths, usernames, and workspace names have been anonymized
- **PII Removal**: Email addresses, URLs, IP addresses, and tokens have been redacted
- **Sanitization**: All text fields have been sanitized to remove sensitive information
`
    : `
- **Warning**: This dataset contains non-anonymized data. Use with caution.
`
}

${
  this.options.privacyLevel === 'clio'
    ? `
- **High Privacy**: This dataset uses the highest privacy level (Clio), containing only workflow patterns without code
`
    : ''
}

## Intended Use

- Research on developer workflows
- Training AI code assistants
- Analyzing coding patterns
- Productivity analysis
- AI-assisted coding research

## Limitations

- Data is limited to Cursor IDE usage
- May not represent all development workflows
- Temporal patterns may be specific to individual developers
- Privacy level may limit certain analyses

## Citation

\`\`\`bibtex
@misc{cursor-telemetry-dataset,
  title={Cursor Telemetry Dataset},
  author={Cursor Activity Logger},
  year={${new Date().getFullYear()}},
  url={https://github.com/hamidahoderinwale/cursor-telemetry}
}
\`\`\`

## License

Apache 2.0

## Contact

For questions or issues, please open an issue on the [GitHub repository](https://github.com/hamidahoderinwale/cursor-telemetry).
`;

    const readmePath = path.join(outputDir, 'README.md');
    await writeFileAsync(readmePath, readme);
    console.log('[HF-EXPORT] ✅ Generated dataset card (README.md)');
  }

  /**
   * Generate dataset loading script
   */
  async generateDatasetScript(outputDir) {
    const script = `"""Cursor Telemetry Dataset"""

import json
import datasets

_DESCRIPTION = """
Cursor IDE telemetry dataset containing developer activity, code changes, and AI interactions.
"""

_HOMEPAGE = "https://github.com/hamidahoderinwale/cursor-telemetry"

_LICENSE = "Apache 2.0"

_URLS = {
    "train": "train.jsonl",
    "validation": "validation.jsonl",
}

class CursorTelemetry(datasets.GeneratorBasedBuilder):
    """Cursor Telemetry Dataset"""

    VERSION = datasets.Version("1.0.0")

    def _info(self):
        features = datasets.Features({
            "id": datasets.Value("string"),
            "timestamp": datasets.Value("string"),
            "type": datasets.Value("string"),
            "file_path": datasets.Value("string"),
            "file_extension": datasets.Value("string"),
            "file_type": datasets.Value("string"),
            "diff_stats": {
                "lines_added": datasets.Value("int32"),
                "lines_removed": datasets.Value("int32"),
                "chars_added": datasets.Value("int32"),
                "chars_removed": datasets.Value("int32"),
            },
            "tags": datasets.Sequence(datasets.Value("string")),
            "notes": datasets.Value("string"),
        })

        return datasets.DatasetInfo(
            description=_DESCRIPTION,
            features=features,
            homepage=_HOMEPAGE,
            license=_LICENSE,
        )

    def _split_generators(self, dl_manager):
        urls = _URLS
        data_files = dl_manager.download_and_extract(urls)

        return [
            datasets.SplitGenerator(
                name=datasets.Split.TRAIN,
                gen_kwargs={
                    "filepath": data_files["train"],
                    "split": "train",
                },
            ),
            datasets.SplitGenerator(
                name=datasets.Split.VALIDATION,
                gen_kwargs={
                    "filepath": data_files["validation"],
                    "split": "validation",
                },
            ),
        ]

    def _generate_examples(self, filepath, split):
        with open(filepath, encoding="utf-8") as f:
            for idx, line in enumerate(f):
                sample = json.loads(line)
                yield idx, sample
`;

    const scriptPath = path.join(outputDir, 'cursor_telemetry.py');
    await writeFileAsync(scriptPath, script);
    console.log('[HF-EXPORT] ✅ Generated dataset script (cursor_telemetry.py)');
  }
}

module.exports = HuggingFaceExporter;
