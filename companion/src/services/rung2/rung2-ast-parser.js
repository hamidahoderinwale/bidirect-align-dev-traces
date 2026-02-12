/**
 * Rung 2 AST Parser
 * Basic AST parsing for common languages
 *
 * NOTE: This is a simplified implementation. For production, use Tree-sitter or Babel.
 */

const path = require('path');

class Rung2ASTParser {
  constructor() {
    // AST node type mappings (simplified)
    this.nodeTypes = {
      // Statements
      if: 'IfStatement',
      for: 'ForStatement',
      while: 'WhileStatement',
      function: 'FunctionDeclaration',
      return: 'ReturnStatement',
      import: 'ImportDeclaration',
      export: 'ExportDeclaration',
      class: 'ClassDeclaration',
      try: 'TryStatement',
      catch: 'CatchClause',
      throw: 'ThrowStatement',

      // Expressions
      assignment: 'AssignmentExpression',
      call: 'CallExpression',
      member: 'MemberExpression',
      binary: 'BinaryExpression',
      unary: 'UnaryExpression',
      conditional: 'ConditionalExpression',

      // Literals
      string: 'StringLiteral',
      number: 'NumericLiteral',
      boolean: 'BooleanLiteral',
      array: 'ArrayExpression',
      object: 'ObjectExpression',
    };
  }

  /**
   * Detect language from file path
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const langMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Parse code to simplified AST structure
   * This is a basic implementation - for production, use proper parsers
   */
  parse(code, language = 'javascript') {
    if (!code || typeof code !== 'string') {
      return { type: 'Program', body: [] };
    }

    // Basic regex-based parsing for common patterns
    // This is a simplified approach - real implementation would use Tree-sitter or Babel
    const ast = {
      type: 'Program',
      body: [],
      language,
    };

    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('//') || line.startsWith('#')) continue;

      // Detect common patterns
      if (this.isIfStatement(line)) {
        ast.body.push({
          type: 'IfStatement',
          line: i + 1,
          text: line,
        });
      } else if (this.isForLoop(line)) {
        ast.body.push({
          type: 'ForStatement',
          line: i + 1,
          text: line,
        });
      } else if (this.isFunctionDeclaration(line)) {
        ast.body.push({
          type: 'FunctionDeclaration',
          line: i + 1,
          text: line,
        });
      } else if (this.isImportStatement(line)) {
        ast.body.push({
          type: 'ImportDeclaration',
          line: i + 1,
          text: line,
        });
      } else if (this.isReturnStatement(line)) {
        ast.body.push({
          type: 'ReturnStatement',
          line: i + 1,
          text: line,
        });
      } else if (this.isAssignment(line)) {
        ast.body.push({
          type: 'AssignmentExpression',
          line: i + 1,
          text: line,
        });
      } else if (this.isCallExpression(line)) {
        ast.body.push({
          type: 'CallExpression',
          line: i + 1,
          text: line,
        });
      }
    }

    return ast;
  }

  /**
   * Simple pattern detection methods
   */
  isIfStatement(line) {
    return /^\s*if\s*\(/.test(line) || /^\s*elif\s+/.test(line) || /^\s*else\s*:/.test(line);
  }

  isForLoop(line) {
    return /^\s*for\s+/.test(line) || /^\s*foreach\s+/.test(line);
  }

  isFunctionDeclaration(line) {
    return /^\s*(function|def|fn|const\s+\w+\s*=\s*\(|let\s+\w+\s*=\s*\(|var\s+\w+\s*=\s*\()/.test(
      line
    );
  }

  isImportStatement(line) {
    return /^\s*(import|from|require|using|include)/.test(line);
  }

  isReturnStatement(line) {
    return /^\s*return\s+/.test(line);
  }

  isAssignment(line) {
    return /^\s*\w+\s*[=:]/.test(line) && !this.isFunctionDeclaration(line);
  }

  isCallExpression(line) {
    return /\w+\s*\(/.test(line) && !this.isFunctionDeclaration(line) && !this.isIfStatement(line);
  }

  /**
   * Get AST node types
   */
  getNodeTypes(ast) {
    const types = {};
    const traverse = (node) => {
      if (node.type) {
        types[node.type] = (types[node.type] || 0) + 1;
      }
      if (node.body && Array.isArray(node.body)) {
        node.body.forEach(traverse);
      }
    };
    traverse(ast);
    return types;
  }
}

module.exports = Rung2ASTParser;
