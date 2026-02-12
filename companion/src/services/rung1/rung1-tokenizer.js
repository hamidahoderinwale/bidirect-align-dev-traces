/**
 * Rung 1 Tokenizer
 * Tokenizes code into token types with canonicalized identifiers
 */

const path = require('path');

class Rung1Tokenizer {
  constructor() {
    // Token type mappings
    this.tokenTypes = {
      // Keywords
      function: 'FUNCTION',
      const: 'CONST',
      let: 'LET',
      var: 'VAR',
      if: 'IF',
      else: 'ELSE',
      for: 'FOR',
      while: 'WHILE',
      return: 'RETURN',
      import: 'IMPORT',
      export: 'EXPORT',
      class: 'CLASS',
      async: 'ASYNC',
      await: 'AWAIT',
      try: 'TRY',
      catch: 'CATCH',
      throw: 'THROW',
      new: 'NEW',
      this: 'THIS',
      super: 'SUPER',
      extends: 'EXTENDS',
      implements: 'IMPLEMENTS',
      interface: 'INTERFACE',
      type: 'TYPE',
      enum: 'ENUM',
      namespace: 'NAMESPACE',
      module: 'MODULE',
      def: 'DEF',
      lambda: 'LAMBDA',
      yield: 'YIELD',
      with: 'WITH',
      from: 'FROM',
      as: 'AS',
      default: 'DEFAULT',

      // Operators
      '=': 'ASSIGN',
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'MULTIPLY',
      '/': 'DIVIDE',
      '%': 'MODULO',
      '==': 'EQUAL',
      '===': 'STRICT_EQUAL',
      '!=': 'NOT_EQUAL',
      '!==': 'STRICT_NOT_EQUAL',
      '<': 'LESS',
      '>': 'GREATER',
      '<=': 'LESS_EQUAL',
      '>=': 'GREATER_EQUAL',
      '&&': 'AND',
      '||': 'OR',
      '!': 'NOT',
      '++': 'INCREMENT',
      '--': 'DECREMENT',
      '+=': 'PLUS_ASSIGN',
      '-=': 'MINUS_ASSIGN',
      '*=': 'MULTIPLY_ASSIGN',
      '/=': 'DIVIDE_ASSIGN',
      '?': 'TERNARY',
      '??': 'NULLISH',
      '?.': 'OPTIONAL_CHAIN',

      // Punctuation
      '(': 'LPAREN',
      ')': 'RPAREN',
      '[': 'LBRACKET',
      ']': 'RBRACKET',
      '{': 'LBRACE',
      '}': 'RBRACE',
      ',': 'COMMA',
      ';': 'SEMICOLON',
      ':': 'COLON',
      '.': 'DOT',
      '...': 'SPREAD',
      '=>': 'ARROW',
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
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.r': 'r',
      '.m': 'matlab',
      '.sh': 'bash',
      '.sql': 'sql',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Tokenize code content
   * Returns array of token types
   */
  tokenize(code, language = null) {
    if (!code || typeof code !== 'string') {
      return [];
    }

    // Simple regex-based tokenization for common patterns
    // This is a basic implementation - can be enhanced with proper parsers
    const tokens = [];
    const lines = code.split('\n');

    for (const line of lines) {
      const lineTokens = this.tokenizeLine(line.trim());
      tokens.push(...lineTokens);
    }

    return tokens;
  }

  /**
   * Tokenize a single line
   */
  tokenizeLine(line) {
    if (!line) return [];

    const tokens = [];
    let i = 0;

    while (i < line.length) {
      // Skip whitespace
      if (/\s/.test(line[i])) {
        i++;
        continue;
      }

      // Try multi-character operators first
      let matched = false;
      for (const [pattern, tokenType] of Object.entries(this.tokenTypes)) {
        if (line.substring(i).startsWith(pattern)) {
          tokens.push(tokenType);
          i += pattern.length;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // String literals
      if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
        const quote = line[i];
        tokens.push('STRING_LITERAL');
        i++;
        // Skip to end of string (simple - doesn't handle escapes perfectly)
        while (i < line.length && line[i] !== quote) {
          if (line[i] === '\\') i++; // Skip escape
          i++;
        }
        if (i < line.length) i++; // Skip closing quote
        continue;
      }

      // Numbers
      if (/\d/.test(line[i])) {
        tokens.push('NUMBER');
        while (i < line.length && /[\d.]/.test(line[i])) i++;
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_$]/.test(line[i])) {
        let identifier = '';
        while (i < line.length && /[a-zA-Z0-9_$]/.test(line[i])) {
          identifier += line[i];
          i++;
        }
        // Check if it's a keyword
        if (this.tokenTypes[identifier]) {
          tokens.push(this.tokenTypes[identifier]);
        } else {
          tokens.push('IDENTIFIER');
        }
        continue;
      }

      // Unknown character - skip
      i++;
    }

    return tokens;
  }

  /**
   * Get token statistics
   */
  getTokenStats(tokens) {
    const stats = {
      total: tokens.length,
      byType: {},
      identifierCount: 0,
      stringLiteralCount: 0,
      numericLiteralCount: 0,
    };

    for (const token of tokens) {
      stats.byType[token] = (stats.byType[token] || 0) + 1;

      if (token === 'IDENTIFIER') stats.identifierCount++;
      if (token === 'STRING_LITERAL') stats.stringLiteralCount++;
      if (token === 'NUMBER') stats.numericLiteralCount++;
    }

    return stats;
  }
}

module.exports = Rung1Tokenizer;
