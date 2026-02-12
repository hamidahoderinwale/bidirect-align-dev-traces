/**
 * Rung 3 Change Detector
 * Detects function-level changes from diffs
 */

const Rung3FunctionExtractor = require('./rung3-function-extractor');
const Rung3SignatureMatcher = require('./rung3-signature-matcher');
const Rung3CallGraphBuilder = require('./rung3-callgraph-builder');
const { nanoid } = require('nanoid');

class Rung3ChangeDetector {
  constructor() {
    this.functionExtractor = new Rung3FunctionExtractor();
    this.signatureMatcher = new Rung3SignatureMatcher();
    this.callGraphBuilder = new Rung3CallGraphBuilder();
  }

  /**
   * Detect function-level changes from a diff
   */
  detectChanges(diff, filePath, workspacePath = null) {
    const language = this.functionExtractor.detectLanguage(filePath);
    const originalLines = diff.originalTextLines || [];
    const modifiedLines = diff.modifiedTextLines || [];

    // Extract functions from before and after
    const beforeCode = originalLines.join('\n');
    const afterCode = modifiedLines.join('\n');

    const beforeFunctions = this.functionExtractor.extractFunctions(beforeCode, language);
    const afterFunctions = this.functionExtractor.extractFunctions(afterCode, language);

    // Extract function calls
    const beforeCalls = this.functionExtractor.extractFunctionCalls(beforeCode, language);
    const afterCalls = this.functionExtractor.extractFunctionCalls(afterCode, language);

    // Match functions
    const matches = this.signatureMatcher.matchFunctions(beforeFunctions, afterFunctions);

    // Generate file ID
    const fileId = this.generateFileId(filePath);

    // Build call graph updates
    const callGraphUpdates = this.buildCallGraphUpdates(
      beforeFunctions,
      afterFunctions,
      beforeCalls,
      afterCalls,
      fileId
    );

    // Generate function changes
    const changes = [];

    // Added functions
    for (const added of matches.added) {
      changes.push({
        id: nanoid(),
        diffId: diff.diffId,
        filePath,
        fileId,
        language,
        changeType: 'FUNCTION_ADD',
        functionId: added.functionId,
        functionName: added.function.name,
        signatureBefore: null,
        signatureAfter: JSON.stringify({
          parameterCount: added.function.parameterCount,
          returnType: added.function.returnType,
        }),
        parameterChanges: null,
        returnTypeChanged: false,
        callgraphUpdates: null,
        docstringChanged: false,
        timestamp: diff.timestamp || Date.now(),
        workspacePath: workspacePath || null,
        linkedPromptId: diff.promptId || null,
        intentCategory: null,
        metadata: {
          line: added.function.line,
        },
      });
    }

    // Removed functions
    for (const removed of matches.removed) {
      changes.push({
        id: nanoid(),
        diffId: diff.diffId,
        filePath,
        fileId,
        language,
        changeType: 'FUNCTION_REMOVE',
        functionId: removed.functionId,
        functionName: removed.function.name,
        signatureBefore: JSON.stringify({
          parameterCount: removed.function.parameterCount,
          returnType: removed.function.returnType,
        }),
        signatureAfter: null,
        parameterChanges: null,
        returnTypeChanged: false,
        callgraphUpdates: null,
        docstringChanged: false,
        timestamp: diff.timestamp || Date.now(),
        workspacePath: workspacePath || null,
        linkedPromptId: diff.promptId || null,
        intentCategory: null,
        metadata: {
          line: removed.function.line,
        },
      });
    }

    // Modified functions
    for (const modified of matches.modified) {
      const parameterChanges = modified.changes.find((c) => c.type === 'PARAMETER_COUNT_CHANGED');
      const returnTypeChanged = modified.changes.some((c) => c.type === 'RETURN_TYPE_CHANGED');

      changes.push({
        id: nanoid(),
        diffId: diff.diffId,
        filePath,
        fileId,
        language,
        changeType: 'FUNCTION_MODIFY',
        functionId: modified.functionId,
        functionName: modified.after.name,
        signatureBefore: JSON.stringify({
          parameterCount: modified.before.parameterCount,
          returnType: modified.before.returnType,
        }),
        signatureAfter: JSON.stringify({
          parameterCount: modified.after.parameterCount,
          returnType: modified.after.returnType,
        }),
        parameterChanges: parameterChanges ? JSON.stringify(parameterChanges) : null,
        returnTypeChanged,
        callgraphUpdates: JSON.stringify(callGraphUpdates),
        docstringChanged: false,
        timestamp: diff.timestamp || Date.now(),
        workspacePath: workspacePath || null,
        linkedPromptId: diff.promptId || null,
        intentCategory: null,
        metadata: {
          beforeLine: modified.before.line,
          afterLine: modified.after.line,
        },
      });
    }

    // Build function registry entries
    const functions = afterFunctions.map((func) => {
      const functionId = this.signatureMatcher.getOrCreateFunctionId(func.canonicalSignature);
      return {
        id: functionId,
        fileId,
        functionName: func.name,
        canonicalSignature: func.canonicalSignature,
        parameterCount: func.parameterCount,
        returnType: func.returnType,
        firstSeen: diff.timestamp || Date.now(),
        lastModified: diff.timestamp || Date.now(),
        callCount: afterCalls.filter((c) => c.name === func.name).length,
        metadata: {
          line: func.line,
        },
      };
    });

    return {
      changes,
      functions,
      callGraph: callGraphUpdates,
    };
  }

  /**
   * Build call graph updates
   */
  buildCallGraphUpdates(beforeFunctions, afterFunctions, beforeCalls, afterCalls, fileId) {
    const beforeGraph = this.callGraphBuilder.buildCallGraph(beforeFunctions, beforeCalls, fileId);
    const afterGraph = this.callGraphBuilder.buildCallGraph(afterFunctions, afterCalls, fileId);

    // Find added and removed edges
    const beforeEdges = new Set(beforeGraph.edges.map((e) => `${e.source}->${e.target}`));
    const afterEdges = new Set(afterGraph.edges.map((e) => `${e.source}->${e.target}`));

    const addedCalls = afterGraph.edges.filter((e) => !beforeEdges.has(`${e.source}->${e.target}`));
    const removedCalls = beforeGraph.edges.filter(
      (e) => !afterEdges.has(`${e.source}->${e.target}`)
    );

    return {
      added_calls: addedCalls,
      removed_calls: removedCalls,
      nodes: afterGraph.nodes,
      edges: afterGraph.edges,
    };
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

  /**
   * Process multiple diffs
   */
  processDiffs(diffs, filePath, workspacePath = null) {
    const allChanges = [];
    const allFunctions = [];
    let callGraph = { nodes: [], edges: [] };

    for (const diff of diffs) {
      const result = this.detectChanges(diff, filePath, workspacePath);
      allChanges.push(...result.changes);
      allFunctions.push(...result.functions);

      // Merge call graphs
      if (result.callGraph) {
        callGraph = this.callGraphBuilder.updateCallGraph(
          callGraph,
          result.functions.map((f) => ({
            name: f.functionName,
            functionId: f.id,
            canonicalSignature: f.canonicalSignature,
            parameterCount: f.parameterCount,
            returnType: f.returnType,
            line: f.metadata?.line || 0,
          })),
          [], // Calls would need to be extracted separately
          result.functions[0]?.fileId || this.generateFileId(filePath)
        );
      }
    }

    return {
      changes: allChanges,
      functions: allFunctions,
      callGraph,
    };
  }
}

module.exports = Rung3ChangeDetector;
