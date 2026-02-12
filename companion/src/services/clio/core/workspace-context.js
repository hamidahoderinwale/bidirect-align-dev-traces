/**
 * Workspace Context Service
 * Analyzes and provides context about workspaces and repositories
 */

const fs = require('fs');
const path = require('path');

class WorkspaceContextService {
  constructor() {
    this.workspaceCache = new Map();
    this.repoTypeIndicators = {
      nodejs: ['package.json', 'node_modules', 'yarn.lock', 'package-lock.json'],
      python: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'poetry.lock'],
      rust: ['Cargo.toml', 'Cargo.lock'],
      go: ['go.mod', 'go.sum'],
      java: ['pom.xml', 'build.gradle', 'build.sbt'],
      php: ['composer.json', 'composer.lock'],
      ruby: ['Gemfile', 'Gemfile.lock'],
      cpp: ['CMakeLists.txt', 'Makefile', 'configure'],
      dotnet: ['.csproj', '.sln', 'project.json'],
      swift: ['Package.swift', '.xcodeproj'],
      kotlin: ['build.gradle.kts'],
      scala: ['build.sbt'],
      haskell: ['stack.yaml', 'cabal.project'],
      elixir: ['mix.exs'],
      erlang: ['rebar.config'],
      dart: ['pubspec.yaml'],
      flutter: ['pubspec.yaml', '.flutter-plugins'],
      vue: ['vue.config.js'],
      react: ['react', 'jsx'],
      angular: ['angular.json'],
      django: ['manage.py', 'settings.py'],
      rails: ['config.ru', 'Gemfile'],
      laravel: ['artisan', 'composer.json'],
      spring: ['pom.xml', 'application.properties'],
    };

    this.projectStructurePatterns = {
      standard_library: {
        indicators: ['src', 'test', 'lib', 'tests'],
        description: 'Standard library structure with src/ and test/ directories',
      },
      web_application: {
        indicators: ['components', 'pages', 'views', 'routes', 'public'],
        description: 'Web application with component-based architecture',
      },
      mvc_pattern: {
        indicators: ['models', 'views', 'controllers', 'mvc'],
        description: 'MVC (Model-View-Controller) pattern',
      },
      microservices: {
        indicators: ['services', 'api', 'gateway', 'microservice'],
        description: 'Microservices architecture',
      },
      monorepo: {
        indicators: ['packages', 'apps', 'workspaces', 'lerna.json', 'nx.json'],
        description: 'Monorepo structure',
      },
      fullstack: {
        indicators: ['client', 'server', 'frontend', 'backend'],
        description: 'Full-stack application',
      },
      cli_tool: {
        indicators: ['bin', 'cli', 'commands', 'cmd'],
        description: 'Command-line tool',
      },
      data_science: {
        indicators: ['notebooks', 'data', 'models', 'experiments', 'jupyter'],
        description: 'Data science project',
      },
      documentation: {
        indicators: ['docs', 'documentation', 'wiki', 'mkdocs.yml'],
        description: 'Documentation project',
      },
    };
  }

  /**
   * Get comprehensive workspace context
   */
  async getWorkspaceContext(workspacePath) {
    if (this.workspaceCache.has(workspacePath)) {
      return this.workspaceCache.get(workspacePath);
    }

    const context = {
      path: workspacePath,
      exists: fs.existsSync(workspacePath),
      repoType: null,
      projectStructure: null,
      fileCount: 0,
      directoryCount: 0,
      topLevelFiles: [],
      topLevelDirs: [],
      hasGit: false,
      complexity: 'unknown',
      size: 'unknown',
      activityLevel: 'unknown',
      metadata: {},
    };

    if (!context.exists) {
      this.workspaceCache.set(workspacePath, context);
      return context;
    }

    try {
      // Detect repository type
      context.repoType = await this.detectRepoType(workspacePath);

      // Analyze project structure
      context.projectStructure = await this.analyzeProjectStructure(workspacePath);

      // Count files and directories
      const counts = await this.countFilesAndDirs(workspacePath);
      context.fileCount = counts.files;
      context.directoryCount = counts.dirs;
      context.topLevelFiles = counts.topLevelFiles;
      context.topLevelDirs = counts.topLevelDirs;

      // Check for Git
      context.hasGit = fs.existsSync(path.join(workspacePath, '.git'));

      // Assess complexity
      context.complexity = this.assessComplexity(context);

      // Categorize size
      context.size = this.categorizeSize(context);

      // Additional metadata
      context.metadata = {
        detectedAt: new Date().toISOString(),
        indicators: this.findIndicators(workspacePath),
      };

      this.workspaceCache.set(workspacePath, context);
      return context;
    } catch (error) {
      console.warn(`[CLIO] Error analyzing workspace ${workspacePath}:`, error.message);
      return context;
    }
  }

  /**
   * Detect repository type from workspace
   */
  async detectRepoType(workspacePath) {
    if (!fs.existsSync(workspacePath)) {
      return 'unknown';
    }

    try {
      const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
      const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase());

      // Check each repo type
      for (const [type, indicators] of Object.entries(this.repoTypeIndicators)) {
        for (const indicator of indicators) {
          if (fileNames.includes(indicator.toLowerCase())) {
            return type;
          }
        }
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Analyze project structure pattern
   */
  async analyzeProjectStructure(workspacePath) {
    if (!fs.existsSync(workspacePath)) {
      return 'unstructured';
    }

    try {
      const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
      const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());

      // Check each pattern
      for (const [pattern, config] of Object.entries(this.projectStructurePatterns)) {
        const matches = config.indicators.filter((indicator) =>
          dirNames.some((dir) => dir.includes(indicator.toLowerCase()))
        );

        if (matches.length >= 2) {
          return pattern;
        }
      }

      return 'unstructured';
    } catch (error) {
      return 'unstructured';
    }
  }

  /**
   * Count files and directories
   */
  async countFilesAndDirs(workspacePath, maxDepth = 2) {
    let fileCount = 0;
    let dirCount = 0;
    const topLevelFiles = [];
    const topLevelDirs = [];

    if (!fs.existsSync(workspacePath)) {
      return { files: 0, dirs: 0, topLevelFiles: [], topLevelDirs: [] };
    }

    try {
      const countRecursive = (dir, depth = 0) => {
        if (depth > maxDepth) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          // Skip hidden files and common ignore patterns
          if (
            entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'venv' ||
            entry.name === '__pycache__'
          ) {
            continue;
          }

          const fullPath = path.join(dir, entry.name);

          try {
            if (entry.isDirectory()) {
              dirCount++;
              if (depth === 0) {
                topLevelDirs.push(entry.name);
              }
              countRecursive(fullPath, depth + 1);
            } else if (entry.isFile()) {
              fileCount++;
              if (depth === 0) {
                topLevelFiles.push(entry.name);
              }
            }
          } catch (err) {
            // Skip files we can't access
            continue;
          }
        }
      };

      countRecursive(workspacePath);

      return { files: fileCount, dirs: dirCount, topLevelFiles, topLevelDirs };
    } catch (error) {
      return { files: 0, dirs: 0, topLevelFiles: [], topLevelDirs: [] };
    }
  }

  /**
   * Assess workspace complexity
   */
  assessComplexity(context) {
    const fileCount = context.fileCount || 0;
    const dirCount = context.directoryCount || 0;
    const hasStructure = context.projectStructure !== 'unstructured';

    if (fileCount > 1000 || dirCount > 100) {
      return hasStructure ? 'high_structured' : 'high_unstructured';
    } else if (fileCount > 200 || dirCount > 20) {
      return hasStructure ? 'medium_structured' : 'medium_unstructured';
    } else {
      return hasStructure ? 'low_structured' : 'low_unstructured';
    }
  }

  /**
   * Categorize workspace size
   */
  categorizeSize(context) {
    const fileCount = context.fileCount || 0;

    if (fileCount < 50) return 'small';
    if (fileCount < 500) return 'medium';
    if (fileCount < 5000) return 'large';
    return 'very_large';
  }

  /**
   * Find all indicators in workspace
   */
  findIndicators(workspacePath) {
    const indicators = {
      repoTypes: [],
      structures: [],
      tools: [],
    };

    if (!fs.existsSync(workspacePath)) {
      return indicators;
    }

    try {
      const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
      const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase());
      const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());

      // Check repo types
      for (const [type, typeIndicators] of Object.entries(this.repoTypeIndicators)) {
        if (typeIndicators.some((ind) => fileNames.includes(ind.toLowerCase()))) {
          indicators.repoTypes.push(type);
        }
      }

      // Check structures
      for (const [structure, config] of Object.entries(this.projectStructurePatterns)) {
        if (
          config.indicators.some((ind) => dirNames.some((dir) => dir.includes(ind.toLowerCase())))
        ) {
          indicators.structures.push(structure);
        }
      }

      // Check tools
      const toolIndicators = {
        docker: ['Dockerfile', 'docker-compose.yml'],
        kubernetes: ['k8s', 'kubernetes'],
        ci_cd: ['.github', '.gitlab-ci.yml', '.travis.yml', 'Jenkinsfile'],
        testing: ['jest.config', 'pytest.ini', 'spec', '__tests__'],
        linting: ['.eslintrc', '.prettierrc', 'pylintrc'],
      };

      for (const [tool, toolFiles] of Object.entries(toolIndicators)) {
        if (
          toolFiles.some(
            (file) =>
              fileNames.includes(file.toLowerCase()) ||
              dirNames.some((dir) => dir.includes(file.toLowerCase()))
          )
        ) {
          indicators.tools.push(tool);
        }
      }

      return indicators;
    } catch (error) {
      return indicators;
    }
  }

  /**
   * Get workspace statistics from data
   */
  getWorkspaceStats(data) {
    const stats = {
      totalItems: data.length,
      workspaces: new Set(),
      workspaceCounts: {},
      workspaceTypes: {},
      workspaceSizes: {},
      dateRange: { min: null, max: null },
    };

    data.forEach((item) => {
      const workspace = item.workspace_path || item.workspacePath || item.workspace || 'unknown';
      stats.workspaces.add(workspace);
      stats.workspaceCounts[workspace] = (stats.workspaceCounts[workspace] || 0) + 1;

      const timestamp = item.timestamp || item.sortTime || 0;
      if (timestamp) {
        if (!stats.dateRange.min || timestamp < stats.dateRange.min) {
          stats.dateRange.min = timestamp;
        }
        if (!stats.dateRange.max || timestamp > stats.dateRange.max) {
          stats.dateRange.max = timestamp;
        }
      }
    });

    stats.uniqueWorkspaces = stats.workspaces.size;
    stats.avgItemsPerWorkspace = stats.totalItems / Math.max(1, stats.uniqueWorkspaces);

    return stats;
  }

  /**
   * Categorize activity level for workspace
   */
  categorizeActivityLevel(workspaceData) {
    const itemCount = workspaceData.length || 0;
    const timeSpan = workspaceData.timeSpan || 0; // in days

    if (timeSpan === 0) return 'unknown';

    const itemsPerDay = itemCount / timeSpan;

    if (itemsPerDay > 100) return 'very_high';
    if (itemsPerDay > 50) return 'high';
    if (itemsPerDay > 20) return 'medium';
    if (itemsPerDay > 5) return 'low';
    return 'very_low';
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.workspaceCache.clear();
  }
}

module.exports = WorkspaceContextService;
