/**
 * AST-Based Import Detector
 * Uses AST parsing to detect imports more accurately than regex
 */

const path = require('path');
const fs = require('fs').promises;
const Rung2ASTParser = require('../rung2/ast-parser');
const { getConfig } = require('./config');

class ASTImportDetector {
  constructor() {
    this.astParser = new Rung2ASTParser();
    this.cache = new Map(); // Cache parsed ASTs
  }

  /**
   * Detect imports from file using AST
   * @param {string} filePath - File path
   * @param {string} content - File content
   * @returns {Array} Array of import statements
   */
  detectImports(filePath, content) {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const lang = this.astParser.detectLanguage(filePath);
    if (lang === 'unknown') {
      return this.fallbackToRegex(filePath, content);
    }

    try {
      const ast = this.astParser.parse(content, lang);
      return this.extractImportsFromAST(ast, lang, filePath);
    } catch (error) {
      console.warn(
        `[AST-IMPORT] Failed to parse AST for ${filePath}, falling back to regex:`,
        error.message
      );
      return this.fallbackToRegex(filePath, content);
    }
  }

  /**
   * Extract imports from AST
   * @param {object} ast - AST object
   * @param {string} language - Language
   * @param {string} filePath - File path
   * @returns {Array} Import statements
   */
  extractImportsFromAST(ast, language, filePath) {
    const imports = [];

    if (!ast || !ast.body) {
      return imports;
    }

    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration' || node.type === 'import') {
        const importPath = this.extractImportPath(node, language);
        if (importPath) {
          imports.push({
            path: importPath,
            type: 'import',
            line: node.line,
            node: node,
          });
        }
      } else if (node.type === 'ExportDeclaration' || node.type === 'export') {
        // Also track exports for re-export detection
        const exportPath = this.extractExportPath(node, language);
        if (exportPath) {
          imports.push({
            path: exportPath,
            type: 'export',
            line: node.line,
            node: node,
          });
        }
      }
    }

    return imports;
  }

  /**
   * Extract import path from AST node
   * @param {object} node - AST node
   * @param {string} language - Language
   * @returns {string|null} Import path
   */
  extractImportPath(node, language) {
    if (language === 'javascript' || language === 'typescript') {
      // Extract from text: import ... from "path" or require("path")
      const text = node.text || '';
      const importMatch = text.match(/from\s+['"](.+?)['"]/);
      const requireMatch = text.match(/require\(['"](.+?)['"]\)/);
      const importFuncMatch = text.match(/import\(['"](.+?)['"]\)/);

      return importMatch?.[1] || requireMatch?.[1] || importFuncMatch?.[1] || null;
    } else if (language === 'python') {
      // Extract from: import module or from module import ...
      const text = node.text || '';
      const importMatch = text.match(/^import\s+(\S+)/);
      const fromMatch = text.match(/^from\s+(\S+)\s+import/);

      return importMatch?.[1] || fromMatch?.[1] || null;
    }

    return null;
  }

  /**
   * Extract export path from AST node
   * @param {object} node - AST node
   * @param {string} language - Language
   * @returns {string|null} Export path
   */
  extractExportPath(node, language) {
    if (language === 'javascript' || language === 'typescript') {
      const text = node.text || '';
      const exportMatch = text.match(/from\s+['"](.+?)['"]/);
      return exportMatch?.[1] || null;
    }

    return null;
  }

  /**
   * Fallback to regex-based import detection
   * @param {string} filePath - File path
   * @param {string} content - File content
   * @returns {Array} Import statements
   */
  fallbackToRegex(filePath, content) {
    const imports = [];
    const lang = this.astParser.detectLanguage(filePath);
    const lines = content.split('\n');

    const patterns = {
      javascript: [
        /import\s+.*?\s+from\s+['"](.+?)['"]/g,
        /require\(['"](.+?)['"]\)/g,
        /import\(['"](.+?)['"]\)/g,
      ],
      typescript: [/import\s+.*?\s+from\s+['"](.+?)['"]/g, /import\s+['"](.+?)['"]/g],
      python: [/^import\s+(\S+)/gm, /^from\s+(\S+)\s+import/gm],
    };

    const langPatterns = patterns[lang] || patterns.javascript;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of langPatterns) {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          imports.push({
            path: match[1],
            type: 'import',
            line: i + 1,
          });
        }
      }
    }

    return imports;
  }
}

module.exports = ASTImportDetector;
