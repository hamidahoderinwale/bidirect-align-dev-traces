/**
 * Repository-Aware Facet Extractor
 * Extracts facets that include repository structure and workspace context
 */

class RepositoryAwareFacetExtractor {
  constructor(workspaceContextService, llmService = null) {
    this.workspaceContextService = workspaceContextService;
    this.llmService = llmService;
  }

  /**
   * Extract comprehensive facets including repository context
   */
  async extractFacets(item, workspaceContext = null) {
    // Get workspace context if not provided
    if (!workspaceContext && item.workspace_path) {
      workspaceContext = await this.workspaceContextService.getWorkspaceContext(
        item.workspace_path
      );
    }

    // Extract base facets (conversation content)
    const baseFacets = await this.extractBaseFacets(item);

    // Extract repository-aware facets
    const repoFacets = this.extractRepositoryFacets(item, workspaceContext);

    // Extract workspace-specific facets
    const workspaceFacets = this.extractWorkspaceFacets(item, workspaceContext);

    // Extract cross-workspace pattern facets
    const crossWorkspaceFacets = await this.extractCrossWorkspaceFacets(item);

    return {
      ...baseFacets,
      ...repoFacets,
      ...workspaceFacets,
      ...crossWorkspaceFacets,
      metadata: {
        extractedAt: new Date().toISOString(),
        workspacePath: item.workspace_path || null,
        hasWorkspaceContext: !!workspaceContext,
      },
    };
  }

  /**
   * Extract base facets from conversation/item content
   */
  async extractBaseFacets(item) {
    // This would use LLM to extract facets similar to Clio paper
    // For now, return structured data based on item type

    const facets = {
      topic: null,
      subtopic: null,
      task_type: null,
      language: null,
      complexity: null,
      safety_flags: [],
      metadata: {
        length: 0,
        turn_count: 0,
        context_usage: 0,
      },
    };

    // Extract from prompts
    if (item.itemType === 'prompt' || item.type === 'prompt') {
      const text = item.text || item.prompt || item.content || '';
      facets.topic = this.inferTopic(text);
      facets.task_type = this.inferTaskType(text);
      facets.language = this.detectLanguage(text);
      facets.metadata.length = text.length;
      facets.metadata.turn_count = item.turn_count || 1;
      facets.metadata.context_usage = item.contextUsage || 0;
    }

    // Extract from events (code changes)
    if (item.itemType === 'event' || item.type === 'event' || item.type === 'code_change') {
      const details = typeof item.details === 'string' ? JSON.parse(item.details) : item.details;
      facets.topic = this.inferCodeTopic(details);
      facets.task_type = this.inferCodeTaskType(details);
      facets.language = this.detectCodeLanguage(details);
      facets.complexity = this.assessCodeComplexity(details);
    }

    // Extract from terminal commands
    if (item.itemType === 'terminal' || item.type === 'terminal') {
      const command = item.command || '';
      facets.topic = this.inferCommandTopic(command);
      facets.task_type = this.inferCommandTaskType(command);
      facets.language = this.detectCommandLanguage(command);
    }

    return facets;
  }

  /**
   * Extract repository-specific facets
   */
  extractRepositoryFacets(item, workspaceContext) {
    if (!workspaceContext) {
      return {
        repository_type: 'unknown',
        project_structure: 'unknown',
        file_organization: 'unknown',
      };
    }

    return {
      repository_type: workspaceContext.repoType || 'unknown',
      project_structure: workspaceContext.projectStructure || 'unstructured',
      file_organization: this.analyzeFileOrganization(workspaceContext),
      has_git: workspaceContext.hasGit || false,
      complexity_level: workspaceContext.complexity || 'unknown',
    };
  }

  /**
   * Extract workspace-specific facets
   */
  extractWorkspaceFacets(item, workspaceContext) {
    if (!workspaceContext) {
      return {
        workspace_size: 'unknown',
        workspace_activity_level: 'unknown',
        workspace_complexity: 'unknown',
      };
    }

    return {
      workspace_size: workspaceContext.size || 'unknown',
      workspace_activity_level: this.categorizeActivityLevel(item, workspaceContext),
      workspace_complexity: workspaceContext.complexity || 'unknown',
      workspace_file_count: workspaceContext.fileCount || 0,
      workspace_directory_count: workspaceContext.directoryCount || 0,
    };
  }

  /**
   * Extract cross-workspace pattern facets
   */
  async extractCrossWorkspaceFacets(item) {
    // This would analyze if this pattern appears across multiple workspaces
    // For now, return basic structure
    return {
      is_multi_workspace_pattern: false, // Would be calculated during clustering
      workspace_count: 1,
      cross_workspace_similarity: null,
    };
  }

  /**
   * Analyze file organization pattern
   */
  analyzeFileOrganization(workspaceContext) {
    const dirs = workspaceContext.topLevelDirs || [];
    const files = workspaceContext.topLevelFiles || [];

    // Check for common organization patterns
    if (dirs.includes('src') && dirs.includes('test')) {
      return 'standard_library';
    }
    if (dirs.includes('components') && dirs.includes('pages')) {
      return 'component_based';
    }
    if (dirs.includes('models') && dirs.includes('views')) {
      return 'mvc';
    }
    if (dirs.includes('packages') || dirs.includes('apps')) {
      return 'monorepo';
    }
    if (files.some((f) => f.includes('index') || f.includes('main'))) {
      return 'entry_point_based';
    }

    return 'flat';
  }

  /**
   * Categorize activity level
   */
  categorizeActivityLevel(item, workspaceContext) {
    // This would be calculated from historical data
    // For now, use workspace context
    return workspaceContext.activityLevel || 'unknown';
  }

  /**
   * Infer topic from text (simple heuristic, would use LLM in production)
   */
  inferTopic(text) {
    const lowerText = text.toLowerCase();

    if (lowerText.includes('debug') || lowerText.includes('error') || lowerText.includes('fix')) {
      return 'debugging';
    }
    if (
      lowerText.includes('implement') ||
      lowerText.includes('create') ||
      lowerText.includes('add')
    ) {
      return 'implementation';
    }
    if (
      lowerText.includes('refactor') ||
      lowerText.includes('improve') ||
      lowerText.includes('optimize')
    ) {
      return 'refactoring';
    }
    if (lowerText.includes('test') || lowerText.includes('spec') || lowerText.includes('unit')) {
      return 'testing';
    }
    if (
      lowerText.includes('document') ||
      lowerText.includes('readme') ||
      lowerText.includes('comment')
    ) {
      return 'documentation';
    }

    return 'general';
  }

  /**
   * Infer task type from text
   */
  inferTaskType(text) {
    const lowerText = text.toLowerCase();

    if (
      lowerText.includes('api') ||
      lowerText.includes('endpoint') ||
      lowerText.includes('route')
    ) {
      return 'api_development';
    }
    if (
      lowerText.includes('ui') ||
      lowerText.includes('component') ||
      lowerText.includes('react') ||
      lowerText.includes('vue')
    ) {
      return 'ui_development';
    }
    if (
      lowerText.includes('database') ||
      lowerText.includes('sql') ||
      lowerText.includes('query')
    ) {
      return 'database';
    }
    if (
      lowerText.includes('auth') ||
      lowerText.includes('login') ||
      lowerText.includes('security')
    ) {
      return 'authentication';
    }

    return 'general_development';
  }

  /**
   * Detect language from text
   */
  detectLanguage(text) {
    // Simple detection - would use proper language detection in production
    const lowerText = text.toLowerCase();

    if (
      lowerText.includes('python') ||
      lowerText.includes('import ') ||
      lowerText.includes('def ')
    ) {
      return 'python';
    }
    if (
      lowerText.includes('javascript') ||
      lowerText.includes('const ') ||
      lowerText.includes('function')
    ) {
      return 'javascript';
    }
    if (
      lowerText.includes('typescript') ||
      lowerText.includes('interface ') ||
      lowerText.includes('type ')
    ) {
      return 'typescript';
    }
    if (lowerText.includes('rust') || lowerText.includes('fn ') || lowerText.includes('let ')) {
      return 'rust';
    }

    return 'english'; // Default to natural language
  }

  /**
   * Infer code topic from code change details
   */
  inferCodeTopic(details) {
    const filePath = details.file_path || '';
    const before = details.before_content || '';
    const after = details.after_content || '';

    if (filePath.includes('test') || filePath.includes('spec')) {
      return 'testing';
    }
    if (filePath.includes('api') || filePath.includes('route')) {
      return 'api';
    }
    if (filePath.includes('component') || filePath.includes('ui')) {
      return 'ui';
    }

    return 'code_change';
  }

  /**
   * Infer code task type
   */
  inferCodeTaskType(details) {
    const linesAdded = details.lines_added || 0;
    const linesRemoved = details.lines_removed || 0;

    if (linesAdded > linesRemoved * 2) {
      return 'feature_addition';
    }
    if (linesRemoved > linesAdded * 2) {
      return 'code_removal';
    }
    if (linesAdded > 0 && linesRemoved > 0) {
      return 'refactoring';
    }

    return 'modification';
  }

  /**
   * Detect code language from file path or content
   */
  detectCodeLanguage(details) {
    const filePath = details.file_path || '';
    const ext = filePath.split('.').pop()?.toLowerCase();

    const extMap = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      rs: 'rust',
      go: 'go',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
    };

    return extMap[ext] || 'unknown';
  }

  /**
   * Assess code complexity
   */
  assessCodeComplexity(details) {
    const before = details.before_content || '';
    const after = details.after_content || '';
    const linesAdded = details.lines_added || 0;
    const linesRemoved = details.lines_removed || 0;

    const totalChange = linesAdded + linesRemoved;

    if (totalChange > 500) return 'very_high';
    if (totalChange > 200) return 'high';
    if (totalChange > 50) return 'medium';
    if (totalChange > 10) return 'low';
    return 'very_low';
  }

  /**
   * Infer command topic
   */
  inferCommandTopic(command) {
    const lowerCmd = command.toLowerCase();

    if (lowerCmd.includes('git')) return 'version_control';
    if (lowerCmd.includes('npm') || lowerCmd.includes('yarn') || lowerCmd.includes('pip'))
      return 'package_management';
    if (lowerCmd.includes('test') || lowerCmd.includes('jest') || lowerCmd.includes('pytest'))
      return 'testing';
    if (lowerCmd.includes('build') || lowerCmd.includes('compile')) return 'build';
    if (lowerCmd.includes('run') || lowerCmd.includes('start')) return 'execution';

    return 'general';
  }

  /**
   * Infer command task type
   */
  inferCommandTaskType(command) {
    const lowerCmd = command.toLowerCase();

    if (lowerCmd.includes('install')) return 'installation';
    if (lowerCmd.includes('update') || lowerCmd.includes('upgrade')) return 'update';
    if (lowerCmd.includes('remove') || lowerCmd.includes('uninstall')) return 'removal';
    if (lowerCmd.includes('commit') || lowerCmd.includes('push')) return 'version_control';

    return 'execution';
  }

  /**
   * Detect command language (usually from context)
   */
  detectCommandLanguage(command) {
    // Commands are usually shell/bash, but context matters
    return 'shell';
  }
}

module.exports = RepositoryAwareFacetExtractor;
