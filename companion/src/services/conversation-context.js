/**
 * ConversationContext - Builder for conversation context
 * Assembles context from workspace, files, code, and previous conversation history
 */

class ConversationContext {
  constructor() {
    this.workspace = null;
    this.files = [];
    this.codeBlocks = [];
    this.previousTurns = [];
    this.metadata = {};
  }

  /**
   * Set workspace information
   * @param {Object} workspace - Workspace info
   * @param {string} workspace.id - Workspace ID
   * @param {string} workspace.path - Workspace path
   * @param {string} [workspace.name] - Workspace name
   * @returns {ConversationContext} This instance for chaining
   */
  withWorkspace(workspace) {
    this.workspace = workspace;
    return this;
  }

  /**
   * Add context files
   * @param {Array<string>|string} files - File paths or single file path
   * @returns {ConversationContext} This instance for chaining
   */
  withFiles(files) {
    if (Array.isArray(files)) {
      this.files.push(...files);
    } else {
      this.files.push(files);
    }
    return this;
  }

  /**
   * Add code blocks
   * @param {Array<Object>|Object} blocks - Code blocks or single block
   * @param {string} blocks.language - Code language
   * @param {string} blocks.code - Code content
   * @param {string} [blocks.file] - Source file
   * @returns {ConversationContext} This instance for chaining
   */
  withCodeBlocks(blocks) {
    if (Array.isArray(blocks)) {
      this.codeBlocks.push(...blocks);
    } else {
      this.codeBlocks.push(blocks);
    }
    return this;
  }

  /**
   * Add previous conversation turns for context
   * @param {Array<Object>} turns - Previous turns
   * @returns {ConversationContext} This instance for chaining
   */
  withPreviousTurns(turns) {
    this.previousTurns = turns;
    return this;
  }

  /**
   * Add metadata
   * @param {Object} metadata - Metadata object
   * @returns {ConversationContext} This instance for chaining
   */
  withMetadata(metadata) {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  /**
   * Build context string for LLM prompt
   * @param {Object} options - Build options
   * @param {number} [options.maxTurns=10] - Maximum previous turns to include
   * @param {number} [options.maxCodeBlocks=5] - Maximum code blocks to include
   * @returns {string} Formatted context string
   */
  build(options = {}) {
    const { maxTurns = 10, maxCodeBlocks = 5 } = options;

    const parts = [];

    // Workspace context
    if (this.workspace) {
      parts.push(`Workspace: ${this.workspace.name || this.workspace.id}`);
      if (this.workspace.path) {
        parts.push(`Path: ${this.workspace.path}`);
      }
    }

    // Context files
    if (this.files.length > 0) {
      parts.push(`\nContext Files (${this.files.length}):`);
      this.files.slice(0, 20).forEach((file) => {
        parts.push(`  - ${file}`);
      });
      if (this.files.length > 20) {
        parts.push(`  ... and ${this.files.length - 20} more`);
      }
    }

    // Code blocks
    if (this.codeBlocks.length > 0) {
      parts.push(`\nCode Context:`);
      this.codeBlocks.slice(0, maxCodeBlocks).forEach((block) => {
        const lang = block.language || 'text';
        const file = block.file ? ` (${block.file})` : '';
        parts.push(`\n\`\`\`${lang}${file}`);
        parts.push(block.code);
        parts.push('```');
      });
      if (this.codeBlocks.length > maxCodeBlocks) {
        parts.push(`\n... and ${this.codeBlocks.length - maxCodeBlocks} more code blocks`);
      }
    }

    // Previous conversation turns
    if (this.previousTurns.length > 0) {
      parts.push(`\nPrevious Conversation:`);
      const recentTurns = this.previousTurns.slice(-maxTurns);
      recentTurns.forEach((turn) => {
        const role = turn.role === 'user' ? 'User' : 'Assistant';
        parts.push(
          `\n${role}: ${turn.content.substring(0, 200)}${turn.content.length > 200 ? '...' : ''}`
        );
      });
    }

    return parts.join('\n');
  }

  /**
   * Build context object for RAG pipeline
   * @returns {Object} Context object
   */
  buildForRAG() {
    return {
      workspace: this.workspace,
      files: this.files,
      codeBlocks: this.codeBlocks,
      previousTurns: this.previousTurns,
      metadata: this.metadata,
    };
  }

  /**
   * Extract code blocks from text content
   * @param {string} content - Text content
   * @returns {Array<Object>} Extracted code blocks
   */
  static extractCodeBlocks(content) {
    const codeBlocks = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      codeBlocks.push({
        language: match[1] || 'text',
        code: match[2].trim(),
      });
    }

    return codeBlocks;
  }

  /**
   * Extract file references from text content
   * @param {string} content - Text content
   * @returns {Array<string>} Extracted file paths
   */
  static extractFileReferences(content) {
    const files = [];
    // Match file paths (common patterns)
    const filePatterns = [
      /@([^\s]+\.(js|ts|jsx|tsx|py|java|go|rs|cpp|c|h|hpp|rb|php|swift|kt|scala|clj|sh|bash|zsh|yaml|yml|json|xml|html|css|scss|sass|less|md|txt|sql|r|m|mm|pl|pm|tcl|v|vhdl|sv|svh|vhd|tex|bib|rst|adoc|org|wiki|log|conf|ini|cfg|toml|properties|env|dockerfile|makefile|cmake|gradle|maven|sbt|gemfile|rakefile|podfile|cartfile|package\.json|requirements\.txt|pom\.xml|build\.gradle|cmakelists\.txt|makefile|rakefile|gemfile|podfile|cartfile|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.json|composer\.lock|go\.mod|go\.sum|cargo\.toml|cargo\.lock|mix\.exs|rebar\.config|deps\.edn|project\.clj|build\.sbt|build\.scala|build\.sbt|project\.scala|build\.gradle|settings\.gradle|gradle\.properties|gradle-wrapper\.properties|maven-wrapper\.properties|pom\.xml|parent\.pom|settings\.xml|web\.xml|application\.xml|beans\.xml|persistence\.xml|faces-config\.xml|web-fragment\.xml|context\.xml|server\.xml|tomcat-users\.xml|logging\.properties|server\.properties|client\.properties|cluster\.properties|hazelcast\.xml|ehcache\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml|ehcache-failsafe\.xml))/gi,
      /([\/\\][^\s]+\.(js|ts|jsx|tsx|py|java|go|rs|cpp|c|h|hpp|rb|php|swift|kt|scala|clj|sh|bash|zsh|yaml|yml|json|xml|html|css|scss|sass|less|md|txt|sql|r|m|mm|pl|pm|tcl|v|vhdl|sv|svh|vhd|tex|bib|rst|adoc|org|wiki|log|conf|ini|cfg|toml|properties|env|dockerfile|makefile|cmake|gradle|maven|sbt|gemfile|rakefile|podfile|cartfile|package\.json|requirements\.txt|pom\.xml|build\.gradle|cmakelists\.txt|makefile|rakefile|gemfile|podfile|cartfile|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.json|composer\.lock|go\.mod|go\.sum|cargo\.toml|cargo\.lock|mix\.exs|rebar\.config|deps\.edn|project\.clj|build\.sbt|build\.scala|build\.sbt|project\.scala|build\.gradle|settings\.gradle|gradle\.properties|gradle-wrapper\.properties|maven-wrapper\.properties|pom\.xml|parent\.pom|settings\.xml|web\.xml|application\.xml|beans\.xml|persistence\.xml|faces-config\.xml|web-fragment\.xml|context\.xml|server\.xml|tomcat-users\.xml|logging\.properties|server\.properties|client\.properties|cluster\.properties|hazelcast\.xml|ehcache\.xml))/gi,
    ];

    filePatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const filePath = match[1] || match[0];
        if (filePath && !files.includes(filePath)) {
          files.push(filePath);
        }
      }
    });

    return files;
  }

  /**
   * Create a new ConversationContext instance
   * @returns {ConversationContext} New instance
   */
  static create() {
    return new ConversationContext();
  }
}

module.exports = ConversationContext;
