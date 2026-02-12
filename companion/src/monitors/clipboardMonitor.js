const { queue } = require('../utils/queue.js');

// Simple in-memory database for prompt storage (replacing Dexie/IndexedDB)
const db = {
  _prompts: [],
  nextId: 1,

  get prompts() {
    return this._prompts;
  },
  set prompts(val) {
    this._prompts = val;
  },

  async add(table, data) {
    const item = { ...data, id: this.nextId++ };
    this[table].push(item);
    return item;
  },

  async update(table, id, updates) {
    const index = this[table].findIndex((item) => item.id === id);
    if (index >= 0) {
      this[table][index] = { ...this[table][index], ...updates };
      return this[table][index];
    }
    return null;
  },
};

class ClipboardMonitor {
  constructor() {
    this.isMonitoring = false;
    this.lastClipboard = '';
    this.intervalId = null;
    this.checkInterval = 10000; // Check every 10 seconds instead of 2 to reduce spam
    this.capturedPrompts = new Set(); // Track captured prompts to prevent duplicates
    this.lastCaptureTime = 0;
    this.minCaptureInterval = 30000; // Minimum 30 seconds between captures to reduce spam
    this.clipboard = null; // Will be loaded dynamically
    this.clipboardLoadPromise = null; // Cache the import promise
  }

  // Dynamically load clipboardy (ESM module)
  async loadClipboard() {
    if (this.clipboard) {
      return this.clipboard;
    }
    if (this.clipboardLoadPromise) {
      return this.clipboardLoadPromise;
    }
    this.clipboardLoadPromise = import('clipboardy')
      .then((module) => {
        this.clipboard = module.default;
        return this.clipboard;
      })
      .catch((error) => {
        console.warn('[CLIPBOARD] Failed to load clipboardy:', error.message);
        this.clipboardLoadPromise = null;
        return null;
      });
    return this.clipboardLoadPromise;
  }

  start() {
    if (this.isMonitoring) {
      console.log('Clipboard monitor already running');
      return;
    }

    console.log(' Starting clipboard monitor for prompt capture');
    this.isMonitoring = true;

    this.intervalId = setInterval(async () => {
      try {
        // Load clipboard module if not already loaded
        const clipboard = await this.loadClipboard();
        if (!clipboard) {
          return; // Skip if clipboard module failed to load
        }

        const text = (await clipboard.read()).trim();
        const now = Date.now();

        // Check if we should capture this prompt
        if (
          text &&
          text !== this.lastClipboard &&
          this.isLikelyPrompt(text) &&
          !this.capturedPrompts.has(text) &&
          now - this.lastCaptureTime > this.minCaptureInterval
        ) {
          console.log(` Captured potential prompt: ${text.slice(0, 80)}...`);

          // Save to database
          const promptId = await db.add('prompts', {
            timestamp: new Date().toISOString(),
            text: text,
            status: 'pending',
            linked_entry_id: null,
          });

          // Also add to queue for immediate processing
          queue.addPendingPrompt(text);
          this.lastClipboard = text;
          this.capturedPrompts.add(text);
          this.lastCaptureTime = now;

          console.log(`Saved prompt to database: ${promptId.id}`);
        }
      } catch (error) {
        // Silently handle clipboard errors (permission denied, etc.)
        if (
          error.message &&
          !error.message.includes('permission') &&
          !error.message.includes('IndexedDB')
        ) {
          console.error('Clipboard monitor error:', error.message);
        }
      }
    }, this.checkInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isMonitoring = false;
    console.log(' Clipboard monitor stopped');
  }

  isLikelyPrompt(text) {
    // Basic heuristics to identify prompts
    if (text.length < 10 || text.length > 2000) return false;

    // Skip UI labels and metrics
    const uiPatterns = [
      /^(changes per hour|coding velocity|productivity measure)/i,
      /^(total changes|files modified|conversations)/i,
      /^(code velocity|refactoring rate|lines changed)/i,
      /^\d+\/\d+$/, // Numbers like "5/100"
      /^\d+\/hr$/, // Numbers like "5/hr"
      /^[a-zA-Z\s]+:\s*\d+/, // Labels like "Files: 5"
    ];

    if (uiPatterns.some((pattern) => pattern.test(text))) {
      return false;
    }

    // Skip code-like content
    const codePatterns = [
      /^[{}[\]();\s]*$/, // Only brackets and semicolons
      /^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*[=:]\s*/, // Variable assignments
      /^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/, // Function calls
      /^\s*[#@]/, // Comments or directives
      /^\s*[<>]/, // HTML/XML tags
      /^\s*[0-9]/, // Numbers only
      /^\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*[{}]/, // Object/function definitions
    ];

    if (codePatterns.some((pattern) => pattern.test(text))) {
      return false;
    }

    // Look for prompt-like patterns
    const promptPatterns = [
      /^(can you|please|how do|what is|explain|help me|i need|i want)/i,
      /^(add|create|implement|fix|update|modify|change|remove|delete)/i,
      /^(show me|give me|find|search|look for)/i,
      /\?$/, // Ends with question mark
      /^(write|generate|make|build|develop)/i,
    ];

    return promptPatterns.some((pattern) => pattern.test(text));
  }

  getStats() {
    return {
      is_monitoring: this.isMonitoring,
      last_captured: this.lastClipboard ? this.lastClipboard.slice(0, 50) + '...' : null,
      pending_prompts: queue.getPendingPrompts().length,
    };
  }
}

const clipboardMonitor = new ClipboardMonitor();
module.exports = { clipboardMonitor };
