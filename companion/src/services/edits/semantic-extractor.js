/**
 * Rung 2 Semantic Extractor
 * Extracts semantic edit scripts from AST diffs
 */

const Rung2ASTParser = require('./ast-parser');
const Rung2ASTDiffer = require('./ast-differ');
const { nanoid } = require('nanoid');

class SemanticExtractor {
  constructor() {
    this.parser = new Rung2ASTParser();
    this.differ = new Rung2ASTDiffer();
  }

  /**
   * Extract semantic edit script from a diff
   */
  extractEditScript(diff, filePath, workspacePath = null) {
    const language = this.parser.detectLanguage(filePath);
    const originalLines = diff.originalTextLines || [];
    const modifiedLines = diff.modifiedTextLines || [];

    // Parse before and after code
    const beforeCode = originalLines.join('\n');
    const afterCode = modifiedLines.join('\n');

    const beforeAST = this.parser.parse(beforeCode, language);
    const afterAST = this.parser.parse(afterCode, language);

    // Compute diff
    const diffResult = this.differ.computeDiff(beforeAST, afterAST);

    // Generate file ID
    const fileId = this.generateFileId(filePath);

    return {
      id: nanoid(),
      diffId: diff.diffId,
      filePath,
      fileId,
      language,
      editOperations: diffResult.operations,
      operationCount: diffResult.operationCount,
      operationTypes: diffResult.operationTypes,
      astNodeTypes: diffResult.astNodeTypes,
      changeStyle: diffResult.changeStyle,
      timestamp: diff.timestamp || Date.now(),
      workspacePath: workspacePath || null,
      linkedPromptId: diff.promptId || null,
      intentCategory: null, // Would be extracted from prompt
      metadata: {
        beforeASTNodeCount: beforeAST.body.length,
        afterASTNodeCount: afterAST.body.length,
      },
    };
  }

  /**
   * Extract edit scripts from multiple diffs
   */
  extractEditScripts(diffs, filePath, workspacePath = null) {
    return diffs.map((diff) => this.extractEditScript(diff, filePath, workspacePath));
  }

  /**
   * Generate a simple file ID from file path
   */
  generateFileId(filePath) {
    let hash = 0;
    for (let i = 0; i < filePath.length; i++) {
      const char = filePath.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `FILE_${Math.abs(hash).toString(36)}`;
  }
}

module.exports = SemanticExtractor;
