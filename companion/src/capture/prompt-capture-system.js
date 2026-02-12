#!/usr/bin/env node

/**
 * Systematic Prompt Capture & Display System
 * Comprehensive prompt capture with enhanced threading and display
 */

const { EventEmitter } = require('events');
const crypto = require('crypto');

class PromptCaptureSystem extends EventEmitter {
  constructor() {
    super();
    this.activePrompts = new Map();
    this.promptThreads = new Map();
    this.correlationIds = new Map();
    this.captureMethods = new Map();

    this.initializeCaptureMethods();
  }

  /**
   * Initialize all prompt capture methods
   */
  initializeCaptureMethods() {
    // Clipboard-based capture
    this.captureMethods.set('clipboard', {
      enabled: true,
      priority: 'high',
      handler: this.handleClipboardPrompt.bind(this),
    });

    // DOM-based capture
    this.captureMethods.set('dom', {
      enabled: true,
      priority: 'medium',
      handler: this.handleDOMPrompt.bind(this),
    });

    // MCP-based capture
    this.captureMethods.set('mcp', {
      enabled: true,
      priority: 'high',
      handler: this.handleMCPPrompt.bind(this),
    });

    // Manual capture
    this.captureMethods.set('manual', {
      enabled: true,
      priority: 'low',
      handler: this.handleManualPrompt.bind(this),
    });

    // File-based capture
    this.captureMethods.set('file', {
      enabled: true,
      priority: 'medium',
      handler: this.handleFilePrompt.bind(this),
    });
  }

  /**
   * Capture prompt with systematic approach
   */
  async capturePrompt(promptData, method = 'manual') {
    try {
      const correlationId = this.generateCorrelationId();
      const promptId = crypto.randomUUID();

      // Enhanced prompt data structure
      const enhancedPrompt = {
        id: promptId,
        correlationId: correlationId,
        timestamp: new Date().toISOString(),
        content: promptData.content,
        context: promptData.context || {},
        metadata: {
          method: method,
          source: promptData.source || 'unknown',
          filePath: promptData.filePath,
          sessionId: promptData.sessionId,
          intent: this.analyzeIntent(promptData.content),
          complexity: this.analyzeComplexity(promptData.content),
          keywords: this.extractKeywords(promptData.content),
          patterns: this.extractPatterns(promptData.content),
        },
        status: 'captured',
        linkedEvents: [],
        linkedFiles: [],
        threadId: null,
      };

      // Store prompt
      this.activePrompts.set(promptId, enhancedPrompt);

      // Create or update thread
      await this.createOrUpdateThread(enhancedPrompt);

      // Emit capture event
      this.emit('promptCaptured', enhancedPrompt);

      console.log(`[NOTE] Prompt captured: ${promptId} via ${method}`);
      return enhancedPrompt;
    } catch (error) {
      console.error('Error capturing prompt:', error);
      this.emit('promptCaptureError', { error, promptData });
      throw error;
    }
  }

  /**
   * Handle clipboard-based prompt capture
   */
  async handleClipboardPrompt(clipboardData) {
    const promptData = {
      content: clipboardData.text,
      context: {
        source: 'clipboard',
        timestamp: new Date().toISOString(),
      },
      source: 'clipboard',
    };

    return await this.capturePrompt(promptData, 'clipboard');
  }

  /**
   * Handle DOM-based prompt capture
   */
  async handleDOMPrompt(domData) {
    const promptData = {
      content: domData.text,
      context: {
        source: 'dom',
        element: domData.element,
        filePath: domData.filePath,
        timestamp: new Date().toISOString(),
      },
      source: 'dom',
      filePath: domData.filePath,
    };

    return await this.capturePrompt(promptData, 'dom');
  }

  /**
   * Handle MCP-based prompt capture
   */
  async handleMCPPrompt(mcpData) {
    const promptData = {
      content: mcpData.content,
      context: {
        source: 'mcp',
        sessionId: mcpData.sessionId,
        timestamp: new Date().toISOString(),
      },
      source: 'mcp',
      sessionId: mcpData.sessionId,
    };

    return await this.capturePrompt(promptData, 'mcp');
  }

  /**
   * Handle manual prompt capture
   */
  async handleManualPrompt(manualData) {
    return await this.capturePrompt(manualData, 'manual');
  }

  /**
   * Handle file-based prompt capture
   */
  async handleFilePrompt(fileData) {
    const promptData = {
      content: fileData.content,
      context: {
        source: 'file',
        filePath: fileData.filePath,
        timestamp: new Date().toISOString(),
      },
      source: 'file',
      filePath: fileData.filePath,
    };

    return await this.capturePrompt(promptData, 'file');
  }

  /**
   * Create or update prompt thread
   */
  async createOrUpdateThread(prompt) {
    const threadId = prompt.metadata.sessionId || `thread-${Date.now()}`;

    if (!this.promptThreads.has(threadId)) {
      this.promptThreads.set(threadId, {
        id: threadId,
        sessionId: prompt.metadata.sessionId,
        startTime: prompt.timestamp,
        prompts: [],
        events: [],
        status: 'active',
        metadata: {
          totalPrompts: 0,
          lastActivity: prompt.timestamp,
        },
      });
    }

    const thread = this.promptThreads.get(threadId);
    thread.prompts.push(prompt);
    thread.metadata.totalPrompts++;
    thread.metadata.lastActivity = prompt.timestamp;

    // Update prompt with thread ID
    prompt.threadId = threadId;

    this.emit('threadUpdated', thread);
  }

  /**
   * Link prompt to event
   */
  async linkPromptToEvent(promptId, eventId) {
    const prompt = this.activePrompts.get(promptId);
    if (prompt) {
      prompt.linkedEvents.push(eventId);
      this.emit('promptLinked', { promptId, eventId });
    }
  }

  /**
   * Link prompt to file
   */
  async linkPromptToFile(promptId, filePath) {
    const prompt = this.activePrompts.get(promptId);
    if (prompt) {
      prompt.linkedFiles.push(filePath);
      this.emit('promptFileLinked', { promptId, filePath });
    }
  }

  /**
   * Get prompt by ID
   */
  getPrompt(promptId) {
    return this.activePrompts.get(promptId);
  }

  /**
   * Get all prompts in thread
   */
  getThreadPrompts(threadId) {
    const thread = this.promptThreads.get(threadId);
    return thread ? thread.prompts : [];
  }

  /**
   * Get all active prompts
   */
  getAllPrompts() {
    return Array.from(this.activePrompts.values());
  }

  /**
   * Get all threads
   */
  getAllThreads() {
    return Array.from(this.promptThreads.values());
  }

  /**
   * Analyze prompt intent
   */
  analyzeIntent(content) {
    const intentPatterns = {
      data_visualization: ['plot', 'chart', 'graph', 'visualize', 'matplotlib', 'seaborn'],
      data_analysis: ['analyze', 'analysis', 'data', 'dataset', 'pandas', 'numpy'],
      code_implementation: ['implement', 'create', 'build', 'write', 'function', 'class'],
      debugging: ['debug', 'error', 'bug', 'fix', 'issue', 'problem'],
      optimization: ['optimize', 'performance', 'speed', 'efficient', 'improve'],
      documentation: ['document', 'comment', 'explain', 'readme', 'docstring'],
      testing: ['test', 'testing', 'unit test', 'assert', 'verify'],
      refactoring: ['refactor', 'restructure', 'reorganize', 'clean up'],
    };

    const contentLower = content.toLowerCase();
    let maxScore = 0;
    let detectedIntent = 'general';

    Object.entries(intentPatterns).forEach(([intent, keywords]) => {
      const score = keywords.reduce((acc, keyword) => {
        return acc + (contentLower.includes(keyword) ? 1 : 0);
      }, 0);

      if (score > maxScore) {
        maxScore = score;
        detectedIntent = intent;
      }
    });

    return detectedIntent;
  }

  /**
   * Analyze prompt complexity
   */
  analyzeComplexity(content) {
    const wordCount = content.split(/\s+/).length;
    const sentenceCount = content.split(/[.!?]+/).length;
    const avgWordsPerSentence = wordCount / sentenceCount;

    if (wordCount < 10) return 'simple';
    if (wordCount < 50 && avgWordsPerSentence < 15) return 'medium';
    return 'complex';
  }

  /**
   * Extract keywords from prompt
   */
  extractKeywords(content) {
    const words = content
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 3);

    const wordFreq = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    return Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);
  }

  /**
   * Extract patterns from prompt
   */
  extractPatterns(content) {
    const patterns = [];

    // Direct prompt patterns
    if (/prompt:|question:|ask:|request:/i.test(content)) {
      patterns.push('direct_prompt');
    }

    // Code patterns
    if (/```[\s\S]*```/.test(content)) {
      patterns.push('code_block');
    }

    // Question patterns
    if (/\?/.test(content)) {
      patterns.push('question');
    }

    // Task patterns
    if (/task:|goal:|objective:/i.test(content)) {
      patterns.push('task_definition');
    }

    return patterns;
  }

  /**
   * Generate correlation ID
   */
  generateCorrelationId() {
    return `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get prompt statistics
   */
  getStats() {
    const prompts = this.getAllPrompts();
    const threads = this.getAllThreads();

    return {
      totalPrompts: prompts.length,
      totalThreads: threads.length,
      activePrompts: prompts.filter((p) => p.status === 'captured').length,
      intentDistribution: this.getIntentDistribution(prompts),
      methodDistribution: this.getMethodDistribution(prompts),
      complexityDistribution: this.getComplexityDistribution(prompts),
    };
  }

  getIntentDistribution(prompts) {
    const distribution = {};
    prompts.forEach((prompt) => {
      const intent = prompt.metadata.intent;
      distribution[intent] = (distribution[intent] || 0) + 1;
    });
    return distribution;
  }

  getMethodDistribution(prompts) {
    const distribution = {};
    prompts.forEach((prompt) => {
      const method = prompt.metadata.method;
      distribution[method] = (distribution[method] || 0) + 1;
    });
    return distribution;
  }

  getComplexityDistribution(prompts) {
    const distribution = {};
    prompts.forEach((prompt) => {
      const complexity = prompt.metadata.complexity;
      distribution[complexity] = (distribution[complexity] || 0) + 1;
    });
    return distribution;
  }
}

module.exports = PromptCaptureSystem;
