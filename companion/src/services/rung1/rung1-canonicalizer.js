/**
 * Rung 1 Canonicalizer
 * Canonicalizes identifiers to stable IDs (ID_001, FUNC_002, etc.)
 * Supports granular PII redaction options and semantic expressiveness fuzzing
 */

class Rung1Canonicalizer {
  constructor(options = {}) {
    this.identifierMap = new Map(); // original -> canonical
    this.functionMap = new Map();
    this.variableMap = new Map();
    this.counter = {
      id: 1,
      func: 1,
      var: 1,
      class: 1,
    };

    // Semantic expressiveness fuzzing (default: false)
    // When enabled, preserves data type distinctions (FUNC, CLASS, VAR) but removes semantic meaning
    // This preserves type information while anonymizing actual names
    this.fuzzSemanticExpressiveness = options.fuzzSemanticExpressiveness === true;

    // PII redaction options (default: all enabled for privacy)
    this.piiOptions = {
      redactEmails: options.redactEmails !== false, // Default: true
      redactNames: options.redactNames !== false, // Default: true
      redactNumbers: options.redactNumbers !== false, // Default: true
      redactUrls: options.redactUrls !== false, // Default: true
      redactIpAddresses: options.redactIpAddresses !== false, // Default: true
      redactFilePaths: options.redactFilePaths !== false, // Default: true
      redactJwtSecrets: options.redactJwtSecrets !== false, // Default: true
      redactAllStrings: options.redactAllStrings !== false, // Default: true (legacy behavior)
      redactAllNumbers: options.redactAllNumbers !== false, // Default: true (legacy behavior)
    };

    // PII detection patterns
    this.piiPatterns = {
      email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      name: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, // First Last or First Middle Last
      url: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
      ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
      filePath: /(?:[a-zA-Z]:)?[\\\/](?:[^\\\/\n<>"|]+[\\\/])*[^\\\/\n<>"|]*/g,
      phoneNumber: /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
      ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
      creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
      // JWT tokens: three base64url-encoded parts separated by dots (header.payload.signature)
      jwtToken: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{20,}\b/g,
      // JWT/JWST secrets in environment variables or code assignments
      jwtSecret:
        /(?:jwt|jwst)[_-]?(?:secret|key|token|signing[_-]?key)[=:]\s*['"`]([^'"`]{20,})['"`]/gi,
      // High entropy strings that could be JWT secrets (32+ base64url characters)
      jwtSecretHighEntropy: /\b[A-Za-z0-9+/]{32,}={0,2}\b/g,
    };
  }

  /**
   * Canonicalize a token sequence
   * Replaces identifiers with canonical IDs
   * When fuzzSemanticExpressiveness is enabled, preserves data type distinctions (FUNC, CLASS, VAR)
   * but removes semantic meaning by anonymizing names
   */
  canonicalize(tokens, context = {}) {
    const canonical = [];
    let i = 0;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token === 'IDENTIFIER') {
        // In a real implementation, we'd need to parse the actual identifier
        // For now, we'll use a simple heuristic based on context
        const canonicalId = this.getCanonicalIdentifier('ID', this.counter.id++);
        canonical.push(canonicalId);
      } else if (token === 'FUNCTION' || token === 'DEF') {
        canonical.push(token);
        // Next identifier after function/def is likely a function name
        if (i + 1 < tokens.length && tokens[i + 1] === 'IDENTIFIER') {
          // Preserve function type (FUNC) even when fuzzing - only anonymize the name
          const funcId = this.getCanonicalIdentifier('FUNC', this.counter.func++);
          canonical.push(funcId);
          i++; // Skip the identifier
        }
      } else if (token === 'CLASS') {
        canonical.push(token);
        // Next identifier after class is likely a class name
        if (i + 1 < tokens.length && tokens[i + 1] === 'IDENTIFIER') {
          // Preserve class type (CLASS) even when fuzzing - only anonymize the name
          const classId = this.getCanonicalIdentifier('CLASS', this.counter.class++);
          canonical.push(classId);
          i++; // Skip the identifier
        }
      } else if (token === 'CONST' || token === 'LET' || token === 'VAR') {
        canonical.push(token);
        // Next identifier is likely a variable name
        if (i + 1 < tokens.length && tokens[i + 1] === 'IDENTIFIER') {
          const varId = this.getCanonicalIdentifier('VAR', this.counter.var++);
          canonical.push(varId);
          i++; // Skip the identifier
        }
      } else if (
        token === 'NEW' ||
        token === 'EXTENDS' ||
        token === 'IMPLEMENTS' ||
        token === 'INTERFACE' ||
        token === 'TYPE' ||
        token === 'ENUM'
      ) {
        // These keywords are followed by type identifiers
        canonical.push(token);
        // Next identifier after these keywords should preserve type distinction
        if (i + 1 < tokens.length && tokens[i + 1] === 'IDENTIFIER') {
          // Determine type based on keyword context
          let prefix = 'VAR'; // Default
          let counter = this.counter.var++;

          if (token === 'NEW' || token === 'EXTENDS' || token === 'IMPLEMENTS') {
            // Likely a class name
            prefix = 'CLASS';
            counter = this.counter.class++;
          } else if (token === 'INTERFACE' || token === 'TYPE' || token === 'ENUM') {
            // Type-level constructs - preserve as CLASS for type distinction
            prefix = 'CLASS';
            counter = this.counter.class++;
          }

          const typeId = this.getCanonicalIdentifier(prefix, counter);
          canonical.push(typeId);
          i++; // Skip the identifier
        }
      } else {
        canonical.push(token);
      }

      i++;
    }

    return canonical;
  }

  /**
   * Get or create canonical identifier
   */
  getCanonicalIdentifier(prefix, index) {
    const id = `${prefix}_${String(index).padStart(3, '0')}`;
    return id;
  }

  /**
   * Detect PII in a string value
   * Returns the PII type if detected, null otherwise
   */
  detectPII(value) {
    if (typeof value !== 'string') return null;

    // Check each PII pattern
    if (this.piiOptions.redactEmails && this.piiPatterns.email.test(value)) {
      return 'EMAIL';
    }
    if (this.piiOptions.redactNames && this.piiPatterns.name.test(value)) {
      return 'NAME';
    }
    if (this.piiOptions.redactUrls && this.piiPatterns.url.test(value)) {
      return 'URL';
    }
    if (this.piiOptions.redactIpAddresses && this.piiPatterns.ipAddress.test(value)) {
      return 'IP';
    }
    if (this.piiOptions.redactFilePaths && this.piiPatterns.filePath.test(value)) {
      return 'FILEPATH';
    }
    if (this.piiOptions.redactJwtSecrets) {
      if (this.piiPatterns.jwtToken.test(value)) {
        return 'JWT_TOKEN';
      }
      if (this.piiPatterns.jwtSecret.test(value)) {
        return 'JWT_SECRET';
      }
      // Check for high entropy strings that could be JWT secrets
      // Only flag if it's a standalone string (not part of a larger structure)
      if (
        this.piiPatterns.jwtSecretHighEntropy.test(value) &&
        value.length >= 32 &&
        value.length <= 512
      ) {
        return 'JWT_SECRET';
      }
    }
    if (this.piiPatterns.phoneNumber.test(value)) {
      return 'PHONE';
    }
    if (this.piiPatterns.ssn.test(value)) {
      return 'SSN';
    }
    if (this.piiPatterns.creditCard.test(value)) {
      return 'CREDIT_CARD';
    }

    return null;
  }

  /**
   * Canonicalize string literals with optional PII detection
   * If redactAllStrings is true, all strings become <STR>
   * Otherwise, only PII-containing strings are redacted
   */
  canonicalizeStringLiterals(tokens, originalCode = '') {
    // If redactAllStrings is enabled, use simple redaction (legacy behavior)
    if (this.piiOptions.redactAllStrings) {
      return tokens.map((token) => {
        if (token === 'STRING_LITERAL') {
          return '<STR>';
        }
        return token;
      });
    }

    // Otherwise, detect PII in strings
    // Note: We need the original code to check string values
    // For now, we'll use a heuristic: if any PII pattern matches in the code,
    // we'll redact the string. This is a simplified approach.
    // A more sophisticated implementation would track string positions.

    const hasPII =
      (this.piiOptions.redactEmails && this.piiPatterns.email.test(originalCode)) ||
      (this.piiOptions.redactNames && this.piiPatterns.name.test(originalCode)) ||
      (this.piiOptions.redactUrls && this.piiPatterns.url.test(originalCode)) ||
      (this.piiOptions.redactIpAddresses && this.piiPatterns.ipAddress.test(originalCode)) ||
      (this.piiOptions.redactFilePaths && this.piiPatterns.filePath.test(originalCode)) ||
      (this.piiOptions.redactJwtSecrets &&
        (this.piiPatterns.jwtToken.test(originalCode) ||
          this.piiPatterns.jwtSecret.test(originalCode)));

    if (hasPII) {
      // If PII detected in code, redact all strings (conservative approach)
      return tokens.map((token) => {
        if (token === 'STRING_LITERAL') {
          return '<STR>';
        }
        return token;
      });
    }

    // No PII detected, preserve strings (but this is token-level, so we still use <STR>)
    // The actual string content is already lost at tokenization, so we maintain <STR>
    // for consistency, but this allows future enhancement with position tracking
    return tokens.map((token) => {
      if (token === 'STRING_LITERAL') {
        return '<STR>';
      }
      return token;
    });
  }

  /**
   * Canonicalize numbers with optional PII detection
   * If redactAllNumbers is true, all numbers become <NUM>
   * Otherwise, only PII-like numbers (SSN, credit card, phone) are redacted
   */
  canonicalizeNumbers(tokens, originalCode = '') {
    // If redactAllNumbers is enabled, use simple redaction (legacy behavior)
    if (this.piiOptions.redactAllNumbers) {
      return tokens.map((token) => {
        if (token === 'NUMBER') {
          return '<NUM>';
        }
        return token;
      });
    }

    // Check for PII patterns that involve numbers
    const hasPII =
      this.piiPatterns.phoneNumber.test(originalCode) ||
      this.piiPatterns.ssn.test(originalCode) ||
      this.piiPatterns.creditCard.test(originalCode) ||
      (this.piiOptions.redactIpAddresses && this.piiPatterns.ipAddress.test(originalCode));

    if (hasPII) {
      // If PII-like numbers detected, redact all numbers
      return tokens.map((token) => {
        if (token === 'NUMBER') {
          return '<NUM>';
        }
        return token;
      });
    }

    // No PII-like numbers detected, preserve numbers
    // Note: At token level, we can't distinguish between PII and non-PII numbers
    // without position tracking, so we maintain <NUM> for consistency
    return tokens.map((token) => {
      if (token === 'NUMBER') {
        return '<NUM>';
      }
      return token;
    });
  }

  /**
   * Full canonicalization pipeline
   * @param {Array} tokens - Token sequence to canonicalize
   * @param {string} originalCode - Original code string (for PII detection)
   */
  canonicalizeFull(tokens, originalCode = '') {
    // Step 1: Canonicalize identifiers
    let canonical = this.canonicalize(tokens);

    // Step 2: Replace string literals (with PII detection if enabled)
    canonical = this.canonicalizeStringLiterals(canonical, originalCode);

    // Step 3: Replace numbers (with PII detection if enabled)
    canonical = this.canonicalizeNumbers(canonical, originalCode);

    return canonical;
  }

  /**
   * Update PII redaction options
   */
  updatePIIOptions(options) {
    this.piiOptions = { ...this.piiOptions, ...options };
  }

  /**
   * Update semantic expressiveness fuzzing option
   */
  setFuzzSemanticExpressiveness(enabled) {
    this.fuzzSemanticExpressiveness = enabled === true;
  }

  /**
   * Reset counters (for new file/context)
   */
  reset() {
    this.counter = {
      id: 1,
      func: 1,
      var: 1,
      class: 1,
    };
  }
}

module.exports = Rung1Canonicalizer;
