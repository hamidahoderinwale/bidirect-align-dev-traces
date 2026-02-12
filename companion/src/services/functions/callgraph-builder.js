/**
 * Rung 3 Call Graph Builder
 * Builds call graphs from function calls
 */

class CallGraphBuilder {
  constructor() {
    this.callGraph = {
      nodes: [],
      edges: [],
    };
  }

  /**
   * Build call graph from functions and calls
   */
  buildCallGraph(functions, calls, fileId) {
    const nodes = functions.map((func) => ({
      id: func.functionId || `FUNC_${func.name}`,
      name: func.name,
      fileId,
      signature: func.canonicalSignature,
      parameterCount: func.parameterCount,
      returnType: func.returnType,
    }));

    const edges = [];
    const functionNames = new Set(functions.map((f) => f.name));

    for (const call of calls) {
      if (functionNames.has(call.name)) {
        // Find caller (simplified - would need proper scope analysis)
        const caller = functions.find((f) => f.line <= call.line && f.line + 10 >= call.line);
        if (caller) {
          edges.push({
            source: caller.functionId || `FUNC_${caller.name}`,
            target: `FUNC_${call.name}`,
            type: 'CALL',
            line: call.line,
          });
        }
      }
    }

    return {
      nodes,
      edges,
    };
  }

  /**
   * Update call graph with new functions and calls
   */
  updateCallGraph(existingGraph, newFunctions, newCalls, fileId) {
    const updatedNodes = [...(existingGraph.nodes || [])];
    const updatedEdges = [...(existingGraph.edges || [])];

    // Add new function nodes
    for (const func of newFunctions) {
      const nodeId = func.functionId || `FUNC_${func.name}`;
      if (!updatedNodes.find((n) => n.id === nodeId)) {
        updatedNodes.push({
          id: nodeId,
          name: func.name,
          fileId,
          signature: func.canonicalSignature,
          parameterCount: func.parameterCount,
          returnType: func.returnType,
        });
      }
    }

    // Add new call edges
    const functionNames = new Set(newFunctions.map((f) => f.name));
    for (const call of newCalls) {
      if (functionNames.has(call.name)) {
        const caller = newFunctions.find((f) => f.line <= call.line && f.line + 10 >= call.line);
        if (caller) {
          const sourceId = caller.functionId || `FUNC_${caller.name}`;
          const targetId = `FUNC_${call.name}`;

          if (!updatedEdges.find((e) => e.source === sourceId && e.target === targetId)) {
            updatedEdges.push({
              source: sourceId,
              target: targetId,
              type: 'CALL',
              line: call.line,
            });
          }
        }
      }
    }

    return {
      nodes: updatedNodes,
      edges: updatedEdges,
    };
  }
}

module.exports = CallGraphBuilder;
