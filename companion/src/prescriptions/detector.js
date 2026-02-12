/**
 * Prescription Pattern Detector
 *
 * Analyzes prompt history and code patterns to auto-suggest prescriptions.
 * Learns from repeated instructions and coding patterns.
 */

const { CATEGORIES, SOURCES } = require('./schema');

class PrescriptionDetector {
  constructor(db, prescriptionManager) {
    this.db = db;
    this.manager = prescriptionManager;
  }

  /**
   * Analyze prompt history to find repeated patterns
   * @param {object} options - { days: number, minOccurrences: number }
   * @returns {Array} Suggested prescriptions
   */
  async suggestFromPrompts(options = {}) {
    const days = options.days || 7;
    const minOccurrences = options.minOccurrences || 3;
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    // Get recent prompts
    const prompts = this.db
      .prepare(
        `
      SELECT text FROM prompts 
      WHERE timestamp > ? 
      ORDER BY timestamp DESC
    `
      )
      .all(cutoffTime);

    const suggestions = [];
    const patterns = this.getDetectionPatterns();

    // Count pattern occurrences
    const patternCounts = new Map();

    for (const prompt of prompts) {
      if (!prompt.text) continue;

      for (const pattern of patterns) {
        const match = prompt.text.match(pattern.regex);
        if (match) {
          const key = pattern.id;
          patternCounts.set(key, (patternCounts.get(key) || 0) + 1);
        }
      }
    }

    // Generate suggestions for patterns that occur frequently
    for (const pattern of patterns) {
      const count = patternCounts.get(pattern.id) || 0;

      if (count >= minOccurrences) {
        // Check if similar prescription already exists
        const existing = this.findSimilarPrescription(pattern.title);

        if (!existing) {
          suggestions.push({
            title: pattern.title,
            prescription: pattern.prescription,
            category: pattern.category,
            scope: pattern.scope || 'global',
            priority: pattern.priority || 50,
            confidence: Math.min(count / (minOccurrences * 2), 1.0),
            occurrences: count,
            source: SOURCES.AUTO_DETECTED,
            reason: `Detected ${count} times in last ${days} days`,
          });
        }
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Analyze code patterns from file entries
   * @returns {Array} Suggested prescriptions based on code style
   */
  async suggestFromCode() {
    const suggestions = [];

    // Get recent file entries with code
    const entries = this.db
      .prepare(
        `
      SELECT file_path, after_code 
      FROM entries 
      WHERE after_code IS NOT NULL 
      ORDER BY timestamp DESC 
      LIMIT 100
    `
      )
      .all();

    if (entries.length === 0) return suggestions;

    // Analyze code patterns
    const jsFiles = entries.filter((e) => e.file_path?.match(/\.(js|jsx|ts|tsx)$/i));
    const pyFiles = entries.filter((e) => e.file_path?.match(/\.py$/i));

    // JavaScript/TypeScript patterns
    if (jsFiles.length > 10) {
      const jsCode = jsFiles.map((f) => f.after_code).join('\n');

      // Check semicolon usage
      const withSemicolons = (jsCode.match(/;[\s]*$/gm) || []).length;
      const statements = (jsCode.match(/[}\)]\s*$/gm) || []).length;

      if (statements > 20 && withSemicolons / statements < 0.2) {
        suggestions.push({
          title: 'No Semicolons',
          prescription: 'Omit semicolons in JavaScript/TypeScript code',
          category: CATEGORIES.FORMATTING,
          scope: 'file-type',
          scope_value: '.js',
          confidence: 0.8,
          reason: 'Code rarely uses semicolons',
        });
      }

      // Check quote style
      const singleQuotes = (jsCode.match(/'/g) || []).length;
      const doubleQuotes = (jsCode.match(/"/g) || []).length;

      if (singleQuotes + doubleQuotes > 50) {
        if (singleQuotes > doubleQuotes * 2) {
          suggestions.push({
            title: 'Single Quotes',
            prescription: 'Prefer single quotes over double quotes in JavaScript',
            category: CATEGORIES.FORMATTING,
            scope: 'file-type',
            scope_value: '.js',
            confidence: 0.7,
            reason: 'Code predominantly uses single quotes',
          });
        }
      }

      // Check for TypeScript usage
      if (jsCode.match(/:\s*(string|number|boolean|any|void)/)) {
        suggestions.push({
          title: 'TypeScript Project',
          prescription: 'This is a TypeScript project - use type annotations',
          category: CATEGORIES.DOMAIN,
          scope: 'global',
          confidence: 0.9,
          reason: 'TypeScript syntax detected',
        });
      }
    }

    // Python patterns
    if (pyFiles.length > 10) {
      const pyCode = pyFiles.map((f) => f.after_code).join('\n');

      // Check for type hints
      if (pyCode.match(/def \w+\([^)]*:\s*(str|int|float|bool|List|Dict)/)) {
        suggestions.push({
          title: 'Python Type Hints',
          prescription: 'Use Python type hints for function parameters and return values',
          category: CATEGORIES.FORMATTING,
          scope: 'file-type',
          scope_value: '.py',
          confidence: 0.8,
          reason: 'Type hints used consistently',
        });
      }
    }

    return suggestions;
  }

  /**
   * Get all detection patterns
   * @returns {Array} Pattern definitions
   */
  getDetectionPatterns() {
    return [
      // Markdown avoidance
      {
        id: 'no-markdown',
        regex: /don't (write|create|make|generate) markdown/i,
        title: 'No Markdown Files',
        prescription: "Don't create markdown files unless explicitly requested",
        category: CATEGORIES.BEHAVIOR,
        priority: 70,
      },

      // Conciseness
      {
        id: 'be-concise',
        regex: /(be concise|keep it short|don't explain|no lengthy)/i,
        title: 'Concise Responses',
        prescription: 'Be concise, avoid lengthy explanations unless asked',
        category: CATEGORIES.COMMUNICATION,
        priority: 60,
      },

      // Show diffs
      {
        id: 'show-diffs',
        regex: /(show|display) (diffs?|changes?|modifications)/i,
        title: 'Show Code Diffs',
        prescription: 'Always show code diffs, not full file rewrites',
        category: CATEGORIES.BEHAVIOR,
        priority: 70,
      },

      // TypeScript
      {
        id: 'typescript-project',
        regex: /this is a typescript (project|app|codebase)/i,
        title: 'TypeScript Project',
        prescription: 'This is a TypeScript project - use strict typing',
        category: CATEGORIES.DOMAIN,
        priority: 80,
      },

      // Python version
      {
        id: 'python-version',
        regex: /python (3\.\d+)/i,
        title: 'Python Version',
        prescription: 'Use Python 3.x syntax and features',
        category: CATEGORIES.DOMAIN,
        priority: 80,
      },

      // React framework
      {
        id: 'react-project',
        regex: /(react|next\.?js|remix) (project|app)/i,
        title: 'React Project',
        prescription: 'This is a React project - follow React best practices',
        category: CATEGORIES.DOMAIN,
        priority: 80,
      },

      // Testing requirement
      {
        id: 'run-tests',
        regex: /run tests? (after|before)/i,
        title: 'Run Tests',
        prescription: 'Run tests after making changes',
        category: CATEGORIES.WORKFLOW,
        priority: 60,
      },

      // No console logs
      {
        id: 'no-console',
        regex: /(remove|check for|no) console\.log/i,
        title: 'No Console Logs',
        prescription: 'Check for and remove console.log statements before finishing',
        category: CATEGORIES.WORKFLOW,
        priority: 50,
      },

      // API key security
      {
        id: 'no-api-keys',
        regex: /(don't|never) (include|add|put) (real )?api keys?/i,
        title: 'No Real API Keys',
        prescription: 'Never include real API keys in code examples',
        category: CATEGORIES.SECURITY,
        priority: 90,
      },

      // ESM vs CommonJS
      {
        id: 'commonjs-only',
        regex: /(commonjs|require|no es modules)/i,
        title: 'CommonJS Only',
        prescription: 'Use CommonJS (require/module.exports), not ES modules',
        category: CATEGORIES.FORMATTING,
        priority: 70,
      },

      // Formatting tool
      {
        id: 'prettier',
        regex: /prettier/i,
        title: 'Use Prettier',
        prescription: 'Code should follow Prettier formatting standards',
        category: CATEGORIES.FORMATTING,
        priority: 60,
      },

      // Code style guide
      {
        id: 'airbnb-style',
        regex: /airbnb (style|guide)/i,
        title: 'Airbnb Style Guide',
        prescription: 'Follow Airbnb JavaScript Style Guide',
        category: CATEGORIES.FORMATTING,
        priority: 60,
      },
    ];
  }

  /**
   * Find similar existing prescription
   * @param {string} title - Title to search for
   * @returns {object|null} Existing prescription or null
   */
  findSimilarPrescription(title) {
    const existing = this.manager.getAll({ active: true });

    return existing.find(
      (p) =>
        p.title.toLowerCase() === title.toLowerCase() || this.similarityScore(p.title, title) > 0.8
    );
  }

  /**
   * Calculate similarity score between two strings
   * @param {string} str1
   * @param {string} str2
   * @returns {number} Similarity score 0-1
   */
  similarityScore(str1, str2) {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 1.0;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(s1, s2);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Get comprehensive suggestions
   * @returns {object} { fromPrompts: [], fromCode: [], combined: [] }
   */
  async getAllSuggestions() {
    const [fromPrompts, fromCode] = await Promise.all([
      this.suggestFromPrompts(),
      this.suggestFromCode(),
    ]);

    // Combine and deduplicate
    const seen = new Set();
    const combined = [];

    for (const suggestion of [...fromPrompts, ...fromCode]) {
      const key = `${suggestion.title}:${suggestion.category}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(suggestion);
      }
    }

    return {
      fromPrompts,
      fromCode,
      combined: combined.sort((a, b) => b.confidence - a.confidence),
    };
  }
}

module.exports = PrescriptionDetector;
