/**
 * Rung 1 Processor
 * Processes diffs and extracts token sequences
 */

const Rung1Tokenizer = require('./rung1-tokenizer');
const Rung1Canonicalizer = require('./rung1-canonicalizer');
const { nanoid } = require('nanoid');

class Rung1Processor {
  constructor(options = {}) {
    this.tokenizer = new Rung1Tokenizer();
    this.canonicalizer = new Rung1Canonicalizer({
      ...(options.piiOptions || {}),
      fuzzSemanticExpressiveness: options.fuzzSemanticExpressiveness,
    });
    this.piiOptions = options.piiOptions || {};
    this.fuzzSemanticExpressiveness = options.fuzzSemanticExpressiveness === true;
  }

  /**
   * Process a single diff
   */
  processDiff(diff, filePath, workspacePath = null) {
    const language = this.tokenizer.detectLanguage(filePath);
    const originalLines = diff.originalTextLines || [];
    const modifiedLines = diff.modifiedTextLines || [];

    // Tokenize original content
    const originalCode = originalLines.join('\n');
    const originalTokens = this.tokenizer.tokenize(originalCode, language);
    const originalCanonical = this.canonicalizer.canonicalizeFull(originalTokens, originalCode);

    // Tokenize modified content
    const modifiedCode = modifiedLines.join('\n');
    const modifiedTokens = this.tokenizer.tokenize(modifiedCode, language);
    this.canonicalizer.reset(); // Reset for modified version
    const modifiedCanonical = this.canonicalizer.canonicalizeFull(modifiedTokens, modifiedCode);

    // Get statistics
    const originalStats = this.tokenizer.getTokenStats(originalTokens);
    const modifiedStats = this.tokenizer.getTokenStats(modifiedTokens);

    // Generate file ID (simple hash of file path)
    const fileId = this.generateFileId(filePath);

    return {
      id: nanoid(),
      diffId: diff.diffId,
      filePath,
      fileId,
      language,
      tokenSequence: modifiedCanonical,
      canonicalSequence: modifiedCanonical,
      tokenCount: modifiedTokens.length,
      identifierCount: modifiedStats.identifierCount,
      stringLiteralCount: modifiedStats.stringLiteralCount,
      numericLiteralCount: modifiedStats.numericLiteralCount,
      timestamp: diff.timestamp || Date.now(),
      workspacePath: workspacePath || null,
      linkedPromptId: diff.promptId || null,
      metadata: {
        originalTokenCount: originalTokens.length,
        modifiedTokenCount: modifiedTokens.length,
        tokenDistribution: modifiedStats.byType,
      },
    };
  }

  /**
   * Generate a simple file ID from file path
   */
  generateFileId(filePath) {
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < filePath.length; i++) {
      const char = filePath.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `FILE_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Process multiple diffs
   */
  processDiffs(diffs, filePath, workspacePath = null) {
    return diffs.map((diff) => this.processDiff(diff, filePath, workspacePath));
  }
}

module.exports = Rung1Processor;
