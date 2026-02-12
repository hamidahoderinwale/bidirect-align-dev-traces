/**
 * Prescription Injector
 *
 * Formats prescriptions for context injection into AI prompts.
 * Handles scope hierarchy, priority ordering, and clean formatting.
 */

const { CATEGORIES } = require('./schema');

class PrescriptionInjector {
  constructor(prescriptionManager) {
    this.manager = prescriptionManager;
  }

  /**
   * Get active prescriptions for context and format for prompt
   * @param {object} context - { workspace, fileType, filePath }
   * @returns {object} { formatted: string, prescriptions: array, count: number }
   */
  inject(context = {}) {
    const prescriptions = this.manager.getActiveForContext(context);

    if (prescriptions.length === 0) {
      return {
        formatted: '',
        prescriptions: [],
        count: 0,
      };
    }

    // Track applications
    prescriptions.forEach((p) => {
      this.manager.recordApplication(p.id);
    });

    const formatted = this.formatForPrompt(prescriptions, context);

    return {
      formatted,
      prescriptions,
      count: prescriptions.length,
    };
  }

  /**
   * Format prescriptions for AI prompt injection
   * @param {Array} prescriptions - Array of prescription objects
   * @param {object} context - Context information
   * @returns {string} Formatted text for prompt
   */
  formatForPrompt(prescriptions, context = {}) {
    if (!prescriptions || prescriptions.length === 0) {
      return '';
    }

    const grouped = this.groupByCategory(prescriptions);
    const scopeInfo = this.formatScopeInfo(context);

    let prompt = '\n═══════════════════════════════════════\n';
    prompt += '[CLIPBOARD] ACTIVE PRESCRIPTIONS\n';
    if (scopeInfo) {
      prompt += `Context: ${scopeInfo}\n`;
    }
    prompt += '═══════════════════════════════════════\n\n';

    // Add prescriptions by category
    const categoryOrder = [
      CATEGORIES.DOMAIN,
      CATEGORIES.BEHAVIOR,
      CATEGORIES.FORMATTING,
      CATEGORIES.WORKFLOW,
      CATEGORIES.SECURITY,
      CATEGORIES.COMMUNICATION,
      CATEGORIES.ALLOWLIST,
      CATEGORIES.BLOCKLIST,
      CATEGORIES.CONSTRAINTS,
    ];

    for (const category of categoryOrder) {
      if (grouped[category] && grouped[category].length > 0) {
        prompt += this.formatCategory(category, grouped[category]);
      }
    }

    prompt += '═══════════════════════════════════════\n';
    prompt += '↓ USER REQUEST FOLLOWS BELOW\n';
    prompt += '═══════════════════════════════════════\n\n';

    return prompt;
  }

  /**
   * Format a category section
   */
  formatCategory(category, prescriptions) {
    const icons = {
      [CATEGORIES.DOMAIN]: '[BUILD]',
      [CATEGORIES.BEHAVIOR]: '[TARGET]',
      [CATEGORIES.FORMATTING]: '[SPARKLE]',
      [CATEGORIES.WORKFLOW]: '[CONFIG]',
      [CATEGORIES.SECURITY]: '[SECURITY]',
      [CATEGORIES.COMMUNICATION]: '[CHAT]',
      [CATEGORIES.ALLOWLIST]: '[SUCCESS]',
      [CATEGORIES.BLOCKLIST]: '[BLOCK]',
      [CATEGORIES.CONSTRAINTS]: '[WARN]',
    };

    const icon = icons[category] || '•';
    let section = `${icon} ${category.toUpperCase()}\n`;

    prescriptions.forEach((p) => {
      const priorityMarker = p.priority >= 80 ? '[HIGH] ' : p.priority <= 30 ? '[LOW] ' : '';
      const scopeMarker = p.scope !== 'global' ? ` [${p.scope}]` : '';

      section += `  • ${priorityMarker}${p.prescription}${scopeMarker}\n`;
    });

    section += '\n';
    return section;
  }

  /**
   * Group prescriptions by category
   */
  groupByCategory(prescriptions) {
    return prescriptions.reduce((acc, presc) => {
      const category = presc.category || 'general';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(presc);
      return acc;
    }, {});
  }

  /**
   * Format context scope information
   */
  formatScopeInfo(context) {
    const parts = [];

    if (context.workspace) {
      parts.push(`Workspace: ${this.truncatePath(context.workspace)}`);
    }
    if (context.fileType) {
      parts.push(`File Type: ${context.fileType}`);
    }
    if (context.filePath) {
      parts.push(`File: ${this.truncatePath(context.filePath)}`);
    }

    return parts.join(' | ');
  }

  /**
   * Truncate file paths for display
   */
  truncatePath(path) {
    if (!path) return '';

    const parts = path.split('/');
    if (parts.length <= 3) return path;

    return `.../${parts.slice(-3).join('/')}`;
  }

  /**
   * Format for markdown display
   * @param {Array} prescriptions - Array of prescriptions
   * @returns {string} Markdown formatted text
   */
  formatAsMarkdown(prescriptions) {
    if (!prescriptions || prescriptions.length === 0) {
      return '*No active prescriptions*';
    }

    const grouped = this.groupByCategory(prescriptions);
    let markdown = '# Active Prescriptions\n\n';

    for (const [category, items] of Object.entries(grouped)) {
      markdown += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

      items.forEach((p) => {
        markdown += `- **${p.title}**`;
        if (p.priority >= 80) markdown += ' [ERROR] HIGH PRIORITY';
        markdown += `\n  - ${p.prescription}\n`;
        markdown += `  - *Scope: ${p.scope}`;
        if (p.scope_value) markdown += ` (${p.scope_value})`;
        markdown += `*\n\n`;
      });
    }

    return markdown;
  }

  /**
   * Format for JSON API response
   * @param {Array} prescriptions - Array of prescriptions
   * @returns {object} Structured JSON
   */
  formatAsJSON(prescriptions) {
    return {
      count: prescriptions.length,
      categories: this.groupByCategory(prescriptions),
      flat: prescriptions.map((p) => ({
        id: p.id,
        title: p.title,
        prescription: p.prescription,
        category: p.category,
        scope: p.scope,
        priority: p.priority,
      })),
    };
  }

  /**
   * Format for plain text (no styling)
   * @param {Array} prescriptions - Array of prescriptions
   * @returns {string} Plain text
   */
  formatAsPlainText(prescriptions) {
    if (!prescriptions || prescriptions.length === 0) {
      return '';
    }

    const grouped = this.groupByCategory(prescriptions);
    let text = 'ACTIVE PRESCRIPTIONS\n\n';

    for (const [category, items] of Object.entries(grouped)) {
      text += `${category.toUpperCase()}:\n`;
      items.forEach((p) => {
        text += `- ${p.prescription}\n`;
      });
      text += '\n';
    }

    return text;
  }

  /**
   * Get injection preview (for testing/debugging)
   * @param {object} context - Context to test
   * @returns {string} Preview of what would be injected
   */
  preview(context = {}) {
    const result = this.inject(context);
    return {
      ...result,
      preview: result.formatted,
      examplePrompt: `${result.formatted}[User's actual prompt would appear here]`,
    };
  }
}

module.exports = PrescriptionInjector;
