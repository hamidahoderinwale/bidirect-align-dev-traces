/**
 * Rung 3 Function Extractor
 * Extracts functions from code using basic pattern matching
 *
 * NOTE: This is a simplified implementation. For production, use Tree-sitter or Babel.
 */

const path = require('path');

class FunctionExtractor {
  constructor() {
    // Function declaration patterns
    this.functionPatterns = {
      javascript: [
        /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,
        /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
        /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(/,
        /^\s*(\w+)\s*:\s*(?:async\s+)?\(/,
        /^\s*(\w+)\s*:\s*(?:async\s+)?function\s*\(/,
      ],
      typescript: [
        /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[<\(]/,
        /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]\s*(?:async\s+)?\(/,
        /^\s*(?:export\s+)?(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\(/,
      ],
      python: [/^\s*(?:async\s+)?def\s+(\w+)\s*\(/, /^\s*class\s+(\w+)\s*\(/],
      java: [/^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:\w+\s+)?(\w+)\s*\(/],
      go: [/^\s*func\s+(?:\w+\.)?(\w+)\s*\(/],
      rust: [/^\s*(?:pub\s+)?fn\s+(\w+)\s*\(/],
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
      '.go': 'go',
      '.rs': 'rust',
    };
    return langMap[ext] || 'unknown';
  }

  /**
   * Extract functions from code
   */
  extractFunctions(code, language = 'javascript') {
    if (!code || typeof code !== 'string') {
      return [];
    }

    const functions = [];
    const lines = code.split('\n');
    const patterns = this.functionPatterns[language] || this.functionPatterns.javascript;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const functionName = match[1];
          const signature = this.extractSignature(lines, i, language);

          functions.push({
            name: functionName,
            line: i + 1,
            signature: signature.text,
            parameterCount: signature.parameterCount,
            returnType: signature.returnType || 'unknown',
            canonicalSignature: this.canonicalizeSignature(signature, language),
          });
          break;
        }
      }
    }

    return functions;
  }

  /**
   * Extract function signature
   */
  extractSignature(lines, startLine, language) {
    let signature = '';
    let braceCount = 0;
    let parenCount = 0;
    let inSignature = false;
    let parameterCount = 0;

    for (let i = startLine; i < Math.min(startLine + 10, lines.length); i++) {
      const line = lines[i];
      signature += line + '\n';

      for (const char of line) {
        if (char === '(') {
          parenCount++;
          inSignature = true;
        } else if (char === ')') {
          parenCount--;
          if (inSignature && parenCount === 0) {
            // Extract parameters
            const paramMatch = signature.match(/\(([^)]*)\)/);
            if (paramMatch && paramMatch[1].trim()) {
              parameterCount = paramMatch[1].split(',').filter((p) => p.trim()).length;
            }
            break;
          }
        } else if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (inSignature && parenCount === 0 && braceCount > 0) {
        break;
      }
    }

    // Try to extract return type
    let returnType = null;
    if (language === 'typescript' || language === 'java') {
      const returnMatch = signature.match(/:\s*(\w+)/);
      if (returnMatch) {
        returnType = returnMatch[1];
      }
    }

    return {
      text: signature.trim(),
      parameterCount,
      returnType,
    };
  }

  /**
   * Canonicalize function signature
   */
  canonicalizeSignature(signature, language) {
    // Create a canonical signature: FUNC_001(param_count=2, return_type=bool)
    const paramCount = signature.parameterCount || 0;
    const returnType = signature.returnType || 'unknown';
    return `FUNC_${paramCount}_${returnType}`;
  }

  /**
   * Extract function calls from code
   */
  extractFunctionCalls(code, language = 'javascript') {
    if (!code || typeof code !== 'string') {
      return [];
    }

    const calls = [];
    const lines = code.split('\n');

    // Simple pattern: identifier followed by (
    const callPattern = /(\w+)\s*\(/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;

      while ((match = callPattern.exec(line)) !== null) {
        const functionName = match[1];
        // Skip keywords
        if (
          !['if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'return'].includes(
            functionName
          )
        ) {
          calls.push({
            name: functionName,
            line: i + 1,
          });
        }
      }
    }

    return calls;
  }
}

module.exports = FunctionExtractor;
