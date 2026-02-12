/**
 * Rung 3 Signature Matcher
 * Matches functions across versions using canonical signatures
 */

class Rung3SignatureMatcher {
  constructor() {
    this.functionRegistry = new Map(); // canonicalSignature -> functionId
    this.functionCounter = 1;
  }

  /**
   * Match functions between before and after versions
   */
  matchFunctions(beforeFunctions, afterFunctions) {
    const matches = {
      added: [],
      removed: [],
      modified: [],
      unchanged: [],
    };

    // Create maps by canonical signature
    const beforeMap = new Map();
    for (const func of beforeFunctions) {
      beforeMap.set(func.canonicalSignature, func);
    }

    const afterMap = new Map();
    for (const func of afterFunctions) {
      afterMap.set(func.canonicalSignature, func);
    }

    // Find added functions
    for (const afterFunc of afterFunctions) {
      if (!beforeMap.has(afterFunc.canonicalSignature)) {
        const functionId = this.getOrCreateFunctionId(afterFunc.canonicalSignature);
        matches.added.push({
          functionId,
          function: afterFunc,
        });
      }
    }

    // Find removed functions
    for (const beforeFunc of beforeFunctions) {
      if (!afterMap.has(beforeFunc.canonicalSignature)) {
        const functionId = this.getOrCreateFunctionId(beforeFunc.canonicalSignature);
        matches.removed.push({
          functionId,
          function: beforeFunc,
        });
      }
    }

    // Find modified functions (same signature but different details)
    for (const afterFunc of afterFunctions) {
      const beforeFunc = beforeMap.get(afterFunc.canonicalSignature);
      if (beforeFunc) {
        // Check if details changed
        if (this.hasChanges(beforeFunc, afterFunc)) {
          const functionId = this.getOrCreateFunctionId(afterFunc.canonicalSignature);
          matches.modified.push({
            functionId,
            before: beforeFunc,
            after: afterFunc,
            changes: this.detectChanges(beforeFunc, afterFunc),
          });
        } else {
          const functionId = this.getOrCreateFunctionId(afterFunc.canonicalSignature);
          matches.unchanged.push({
            functionId,
            function: afterFunc,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Check if function has changes
   */
  hasChanges(before, after) {
    return (
      before.parameterCount !== after.parameterCount ||
      before.returnType !== after.returnType ||
      before.line !== after.line
    );
  }

  /**
   * Detect specific changes
   */
  detectChanges(before, after) {
    const changes = [];

    if (before.parameterCount !== after.parameterCount) {
      changes.push({
        type: 'PARAMETER_COUNT_CHANGED',
        before: before.parameterCount,
        after: after.parameterCount,
      });
    }

    if (before.returnType !== after.returnType) {
      changes.push({
        type: 'RETURN_TYPE_CHANGED',
        before: before.returnType,
        after: after.returnType,
      });
    }

    return changes;
  }

  /**
   * Get or create function ID
   */
  getOrCreateFunctionId(canonicalSignature) {
    if (!this.functionRegistry.has(canonicalSignature)) {
      const functionId = `FUNC_${String(this.functionCounter).padStart(3, '0')}`;
      this.functionRegistry.set(canonicalSignature, functionId);
      this.functionCounter++;
    }
    return this.functionRegistry.get(canonicalSignature);
  }

  /**
   * Reset registry (for new file/context)
   */
  reset() {
    this.functionRegistry.clear();
    this.functionCounter = 1;
  }
}

module.exports = Rung3SignatureMatcher;
