/**
 * Abstraction Engine
 * Implements procedural abstraction levels for privacy-expressiveness frontier
 *
 * Levels:
 * 0: Raw traces (full code, full prompts, all metadata)
 * 1: Code abstracts (remove code content, preserve stats)
 * 2: Statement-level (abstract to descriptions)
 * 3: Workflow-level (extract patterns only)
 */

class AbstractionEngine {
  constructor() {
    this.patternCache = new Map();
  }

  /**
   * Apply abstraction to entries (code changes)
   */
  abstractEntry(entry, level) {
    if (level === 0) {
      return entry; // No abstraction
    }

    const abstracted = { ...entry };

    if (level >= 1) {
      // Level 1: Remove code content, preserve stats
      delete abstracted.before_code;
      delete abstracted.after_code;
      delete abstracted.before_content;
      delete abstracted.after_content;

      // Keep diff stats
      if (!abstracted.diff_stats && entry.diff_stats) {
        abstracted.diff_stats = entry.diff_stats;
      }

      // Add abstracted description
      abstracted.abstracted_change = this.createCodeAbstract(entry);
    }

    if (level >= 2) {
      // Level 2: Statement-level abstraction
      abstracted.abstracted_change = this.abstractToStatement(entry);
      delete abstracted.diff_stats; // Remove detailed stats
    }

    if (level >= 3) {
      // Level 3: Workflow-level (extract pattern only)
      abstracted.workflow_pattern = this.extractWorkflowPattern(entry);
      delete abstracted.abstracted_change;
      delete abstracted.file_path; // Remove file path for privacy
    }

    return abstracted;
  }

  /**
   * Apply abstraction to prompts
   */
  abstractPrompt(prompt, level) {
    if (level === 0) {
      return prompt; // No abstraction
    }

    const abstracted = { ...prompt };

    if (level >= 1) {
      // Keep prompt but add abstract
      abstracted.prompt_abstract = this.createPromptAbstract(prompt);
    }

    if (level >= 2) {
      // Level 2: Replace text with abstract
      const abstract = this.abstractPromptToStatement(prompt);
      abstracted.prompt_abstract = abstract;

      // Remove full text but keep length
      if (abstracted.text) {
        abstracted.text_length = abstracted.text.length;
        delete abstracted.text;
      }
      if (abstracted.prompt) {
        abstracted.prompt_length = abstracted.prompt.length;
        delete abstracted.prompt;
      }
      if (abstracted.content) {
        abstracted.content_length = abstracted.content.length;
        delete abstracted.content;
      }
    }

    if (level >= 3) {
      // Level 3: Extract intent pattern only
      abstracted.intent_pattern = this.extractIntentPattern(prompt);
      delete abstracted.prompt_abstract;
      delete abstracted.text_length;
      delete abstracted.prompt_length;
      delete abstracted.content_length;
    }

    return abstracted;
  }

  /**
   * Create code abstract (Level 1)
   */
  createCodeAbstract(entry) {
    const stats = entry.diff_stats || {};
    const filePath = entry.file_path || 'unknown';
    const fileName = filePath.split('/').pop();

    const linesAdded = stats.lines_added || 0;
    const linesRemoved = stats.lines_removed || 0;
    const charsAdded = stats.chars_added || 0;
    const charsRemoved = stats.chars_deleted || 0;

    let description = `Modified ${fileName}`;

    if (linesAdded > 0 || linesRemoved > 0) {
      description += ` (+${linesAdded}/-${linesRemoved} lines)`;
    }

    if (charsAdded > 0 || charsRemoved > 0) {
      const kbAdded = (charsAdded / 1024).toFixed(1);
      const kbRemoved = (charsRemoved / 1024).toFixed(1);
      description += ` (${kbAdded}KB added, ${kbRemoved}KB removed)`;
    }

    return description;
  }

  /**
   * Abstract to statement level (Level 2)
   */
  abstractToStatement(entry) {
    const filePath = entry.file_path || '';
    const fileName = filePath.split('/').pop() || 'file';
    const stats = entry.diff_stats || {};

    // Try to infer what changed from file name and stats
    const isLargeChange = (stats.lines_added || 0) + (stats.lines_removed || 0) > 50;
    const isAddition = (stats.lines_added || 0) > (stats.lines_removed || 0) * 2;
    const isRemoval = (stats.lines_removed || 0) > (stats.lines_added || 0) * 2;
    const isRefactor = Math.abs((stats.lines_added || 0) - (stats.lines_removed || 0)) < 10;

    let action = 'modified';
    if (isAddition && isLargeChange) {
      action = 'added functionality to';
    } else if (isRemoval && isLargeChange) {
      action = 'removed code from';
    } else if (isRefactor) {
      action = 'refactored';
    } else if (isAddition) {
      action = 'added code to';
    } else if (isRemoval) {
      action = 'removed code from';
    }

    // Infer domain from file name
    let domain = this.inferDomain(fileName);

    return `${action} ${domain} in ${fileName}`;
  }

  /**
   * Extract workflow pattern (Level 3)
   */
  extractWorkflowPattern(entry) {
    const filePath = entry.file_path || '';
    const fileName = filePath.split('/').pop() || '';
    const stats = entry.diff_stats || {};

    const isLargeChange = (stats.lines_added || 0) + (stats.lines_removed || 0) > 50;
    const isAddition = (stats.lines_added || 0) > (stats.lines_removed || 0) * 2;
    const domain = this.inferDomain(fileName);

    // Common workflow patterns
    if (isAddition && isLargeChange) {
      return `adding_${domain}_feature`;
    } else if (stats.lines_removed > stats.lines_added) {
      return `removing_${domain}_code`;
    } else {
      return `modifying_${domain}`;
    }
  }

  /**
   * Create prompt abstract (Level 1)
   */
  createPromptAbstract(prompt) {
    const text = prompt.text || prompt.prompt || prompt.content || '';
    const length = text.length;

    if (length < 20) {
      return `Short prompt (${length} chars)`;
    }

    // Extract first sentence or first 100 chars
    const firstSentence = text.split(/[.!?]/)[0];
    const abstract = firstSentence.length < 100 ? firstSentence : text.substring(0, 100) + '...';

    return abstract;
  }

  /**
   * Abstract prompt to statement (Level 2)
   */
  abstractPromptToStatement(prompt) {
    const text = prompt.text || prompt.prompt || prompt.content || '';
    const lowerText = text.toLowerCase();

    // Common intent patterns
    if (lowerText.includes('how') || lowerText.includes('help')) {
      return 'Requested help or guidance';
    } else if (
      lowerText.includes('fix') ||
      lowerText.includes('error') ||
      lowerText.includes('bug')
    ) {
      return 'Requested bug fix or error resolution';
    } else if (
      lowerText.includes('add') ||
      lowerText.includes('create') ||
      lowerText.includes('implement')
    ) {
      return 'Requested feature addition or implementation';
    } else if (
      lowerText.includes('refactor') ||
      lowerText.includes('improve') ||
      lowerText.includes('optimize')
    ) {
      return 'Requested code improvement or refactoring';
    } else if (
      lowerText.includes('explain') ||
      lowerText.includes('what') ||
      lowerText.includes('why')
    ) {
      return 'Requested explanation or clarification';
    } else if (lowerText.includes('test') || lowerText.includes('debug')) {
      return 'Requested testing or debugging assistance';
    } else {
      return 'AI interaction';
    }
  }

  /**
   * Extract intent pattern (Level 3)
   */
  extractIntentPattern(prompt) {
    const text = prompt.text || prompt.prompt || prompt.content || '';
    const lowerText = text.toLowerCase();

    // Map to workflow patterns
    if (lowerText.includes('fix') || lowerText.includes('error') || lowerText.includes('bug')) {
      return 'bug_fixing';
    } else if (
      lowerText.includes('add') ||
      lowerText.includes('create') ||
      lowerText.includes('implement')
    ) {
      return 'feature_implementation';
    } else if (lowerText.includes('refactor') || lowerText.includes('improve')) {
      return 'code_refactoring';
    } else if (lowerText.includes('explain') || lowerText.includes('how')) {
      return 'knowledge_seeking';
    } else {
      return 'general_interaction';
    }
  }

  /**
   * Infer domain from file name
   */
  inferDomain(fileName) {
    const lower = fileName.toLowerCase();

    if (lower.includes('auth') || lower.includes('login') || lower.includes('user')) {
      return 'authentication';
    } else if (lower.includes('api') || lower.includes('endpoint') || lower.includes('route')) {
      return 'api';
    } else if (lower.includes('test') || lower.includes('spec')) {
      return 'testing';
    } else if (lower.includes('component') || lower.includes('ui') || lower.includes('view')) {
      return 'ui';
    } else if (lower.includes('db') || lower.includes('database') || lower.includes('model')) {
      return 'database';
    } else if (lower.includes('config') || lower.includes('setting')) {
      return 'configuration';
    } else {
      return 'code';
    }
  }

  /**
   * Apply abstraction to entire export dataset
   */
  abstractExportData(data, level, options = {}) {
    const abstracted = { ...data };

    // Abstract entries
    if (abstracted.entries) {
      abstracted.entries = abstracted.entries.map((entry) => this.abstractEntry(entry, level));
    }

    // Abstract prompts
    if (abstracted.prompts) {
      abstracted.prompts = abstracted.prompts.map((prompt) => this.abstractPrompt(prompt, level));
    }

    // Abstract linked data
    if (abstracted.linked_data && level < 3) {
      abstracted.linked_data = abstracted.linked_data.map((link) => ({
        ...link,
        prompt: this.abstractPrompt(link.prompt, level),
        code_change: this.abstractEntry(link.code_change, level),
      }));
    } else if (level >= 3) {
      delete abstracted.linked_data; // Remove explicit links at workflow level
    }

    // Abstract temporal chunks
    if (abstracted.temporal_chunks && level < 3) {
      abstracted.temporal_chunks = abstracted.temporal_chunks.map((chunk) => ({
        ...chunk,
        items: chunk.items.map((item) => {
          if (item.type === 'code_change') {
            return { ...item, abstracted: this.abstractEntry(item, level) };
          } else if (item.type === 'prompt') {
            return { ...item, abstracted: this.abstractPrompt(item, level) };
          }
          return item;
        }),
      }));
    } else if (level >= 3) {
      delete abstracted.temporal_chunks; // Remove temporal chunks at workflow level
    }

    // Add abstraction metadata
    abstracted.abstraction_metadata = {
      level: level,
      applied_at: new Date().toISOString(),
      description: this.getLevelDescription(level),
    };

    return abstracted;
  }

  /**
   * Get level description
   */
  getLevelDescription(level) {
    const descriptions = {
      0: 'Raw traces - Full code diffs, complete prompts, all metadata',
      1: 'Code abstracts - Code content removed, stats and metadata preserved',
      2: 'Statement-level - Abstracted to descriptions, reduced detail',
      3: 'Workflow-level - Pattern extraction only, maximum privacy',
    };
    return descriptions[level] || 'Unknown level';
  }
}

module.exports = AbstractionEngine;
