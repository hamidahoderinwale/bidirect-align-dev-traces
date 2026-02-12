/**
 * Rung 2 AST Differ
 * Computes differences between two ASTs and generates semantic edit operations
 *
 * NOTE: This is a simplified implementation. For production, use GumTree or similar.
 */

class Rung2ASTDiffer {
  constructor() {
    // Semantic operation mappings
    this.operationMap = {
      IfStatement: 'ADD_IF_CONDITION',
      ForStatement: 'ADD_LOOP',
      WhileStatement: 'ADD_LOOP',
      FunctionDeclaration: 'ADD_FUNCTION',
      ImportDeclaration: 'ADD_IMPORT',
      ExportDeclaration: 'ADD_EXPORT',
      ReturnStatement: 'ADD_RETURN',
      AssignmentExpression: 'MODIFY_ASSIGNMENT',
      CallExpression: 'ADD_CALL',
      ClassDeclaration: 'ADD_CLASS',
      TryStatement: 'ADD_TRY',
      CatchClause: 'ADD_CATCH',
    };
  }

  /**
   * Compute AST diff and generate semantic edit operations
   */
  computeDiff(beforeAST, afterAST) {
    const operations = [];

    // Simple approach: compare node types
    const beforeNodes = this.extractNodes(beforeAST);
    const afterNodes = this.extractNodes(afterAST);

    // Find added nodes
    const beforeNodeTypes = new Set(beforeNodes.map((n) => `${n.type}_${n.line}`));
    const afterNodeTypes = new Set(afterNodes.map((n) => `${n.type}_${n.line}`));

    for (const afterNode of afterNodes) {
      const key = `${afterNode.type}_${afterNode.line}`;
      if (!beforeNodeTypes.has(key)) {
        // New node - determine operation type
        const operation = this.mapNodeToOperation(afterNode.type);
        if (operation) {
          operations.push({
            type: operation,
            nodeType: afterNode.type,
            line: afterNode.line,
            change: 'add',
          });
        }
      }
    }

    // Find removed nodes
    for (const beforeNode of beforeNodes) {
      const key = `${beforeNode.type}_${beforeNode.line}`;
      if (!afterNodeTypes.has(key)) {
        const operation = this.mapNodeToOperation(beforeNode.type);
        if (operation) {
          operations.push({
            type: operation.replace('ADD_', 'REMOVE_'),
            nodeType: beforeNode.type,
            line: beforeNode.line,
            change: 'remove',
          });
        }
      }
    }

    // Fallback: If no operations detected but ASTs differ, create generic MODIFY operation
    if (operations.length === 0 && (beforeNodes.length > 0 || afterNodes.length > 0)) {
      const beforeCount = beforeNodes.length;
      const afterCount = afterNodes.length;

      if (beforeCount !== afterCount) {
        operations.push({
          type: afterCount > beforeCount ? 'ADD_STATEMENT' : 'REMOVE_STATEMENT',
          nodeType: 'Generic',
          line: 1,
          change: afterCount > beforeCount ? 'add' : 'remove',
          metadata: {
            beforeNodeCount: beforeCount,
            afterNodeCount: afterCount,
          },
        });
      } else if (beforeCount > 0 && afterCount > 0) {
        // Same number of nodes but different content
        operations.push({
          type: 'MODIFY_STATEMENT',
          nodeType: 'Generic',
          line: 1,
          change: 'modify',
          metadata: {
            nodeCount: beforeCount,
          },
        });
      }
    }

    // Determine change style
    const changeStyle = this.determineChangeStyle(operations);

    return {
      operations,
      operationCount: operations.length,
      operationTypes: this.countOperationTypes(operations),
      astNodeTypes: this.countASTNodeTypes(operations),
      changeStyle,
    };
  }

  /**
   * Extract nodes from AST
   */
  extractNodes(ast) {
    const nodes = [];
    const traverse = (node) => {
      if (node && node.type) {
        nodes.push({
          type: node.type,
          line: node.line || 0,
          text: node.text || '',
        });
      }
      if (node.body && Array.isArray(node.body)) {
        node.body.forEach(traverse);
      }
    };
    traverse(ast);
    return nodes;
  }

  /**
   * Map AST node type to semantic operation
   */
  mapNodeToOperation(nodeType) {
    return this.operationMap[nodeType] || `MODIFY_${nodeType.toUpperCase()}`;
  }

  /**
   * Determine overall change style
   */
  determineChangeStyle(operations) {
    const adds = operations.filter((op) => op.change === 'add').length;
    const removes = operations.filter((op) => op.change === 'remove').length;
    const modifies = operations.filter((op) => op.change === 'modify').length;

    if (adds > 0 && removes === 0 && modifies === 0) return 'add';
    if (removes > 0 && adds === 0 && modifies === 0) return 'delete';
    if (modifies > 0 && adds === 0 && removes === 0) return 'modify';
    return 'mixed';
  }

  /**
   * Count operation types
   */
  countOperationTypes(operations) {
    const counts = {};
    for (const op of operations) {
      counts[op.type] = (counts[op.type] || 0) + 1;
    }
    return counts;
  }

  /**
   * Count AST node types
   */
  countASTNodeTypes(operations) {
    const counts = {};
    for (const op of operations) {
      counts[op.nodeType] = (counts[op.nodeType] || 0) + 1;
    }
    return counts;
  }
}

module.exports = Rung2ASTDiffer;
