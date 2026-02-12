#!/usr/bin/env node

/**
 * Cursor Database Parser
 * Extracts prompts, conversations, and AI interactions from Cursor's state.vscdb
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ContextExtractor = require('../capture/context-extractor');

const execAsync = promisify(exec);

class CursorDatabaseParser {
  constructor() {
    this.dbPaths = this.findCursorDatabases();
    this.cache = {
      conversations: [],
      prompts: [],
      lastUpdate: 0,
    };
    this.updateInterval = 300000; // Update every 5 minutes (increased from 10s to reduce DB reads)
    this.contextExtractor = new ContextExtractor();

    // Add mutex to prevent concurrent database reads (thundering herd)
    this.refreshPromise = null;
    this.isRefreshing = false;
  }

  /**
   * Find all Cursor database files
   */
  findCursorDatabases() {
    const basePath = path.join(os.homedir(), 'Library/Application Support/Cursor');
    return {
      global: path.join(basePath, 'User/globalStorage/state.vscdb'),
      workspaces: path.join(basePath, 'User/workspaceStorage'),
    };
  }

  /**
   * Resolve workspace ID to actual folder path
   */
  getWorkspacePath(workspaceId) {
    try {
      const { workspaces } = this.dbPaths;
      const workspaceDir = path.join(workspaces, workspaceId);
      const workspaceJsonPath = path.join(workspaceDir, 'workspace.json');

      if (fs.existsSync(workspaceJsonPath)) {
        const workspaceJson = JSON.parse(fs.readFileSync(workspaceJsonPath, 'utf8'));
        if (workspaceJson.folder) {
          // Remove 'file://' prefix and return clean path
          return workspaceJson.folder.replace(/^file:\/\//, '');
        }
      }
    } catch (error) {
      console.warn(`Could not resolve workspace path for ${workspaceId}:`, error.message);
    }

    return null;
  }

  /**
   * Get a friendly name for the workspace (last directory name)
   */
  getWorkspaceName(workspacePath) {
    if (!workspacePath) return 'Unknown';
    return path.basename(workspacePath);
  }

  /**
   * Extract AI prompts and generations (user inputs + AI responses)
   * This is where Cursor actually stores the conversation messages!
   */
  async extractAIServiceData(dbPath) {
    try {
      if (!fs.existsSync(dbPath)) {
        return { prompts: [], generations: [] };
      }

      // Extract aiService.prompts (user inputs)
      const promptQuery = `SELECT value FROM ItemTable WHERE key = 'aiService.prompts'`;
      const { stdout: promptData } = await execAsync(`sqlite3 "${dbPath}" "${promptQuery}"`).catch(
        () => ({ stdout: '' })
      );

      // Extract aiService.generations (AI responses)
      const genQuery = `SELECT value FROM ItemTable WHERE key = 'aiService.generations'`;
      const { stdout: genData } = await execAsync(`sqlite3 "${dbPath}" "${genQuery}"`).catch(
        () => ({ stdout: '' })
      );

      // Extract additional metadata that might contain context usage and model info
      // Query for keys that might contain context/token information
      // Also check for model information in request context or other structures
      const metadataQuery = `SELECT key, value FROM ItemTable WHERE key LIKE 'aiService.%' AND (key LIKE '%context%' OR key LIKE '%token%' OR key LIKE '%model%' OR key LIKE '%usage%' OR key LIKE '%request%')`;
      const { stdout: metadataData } = await execAsync(
        `sqlite3 "${dbPath}" "${metadataQuery}"`
      ).catch(() => ({ stdout: '' }));

      // Also try to extract model info from messageRequestContext if available
      const requestContextQuery = `SELECT value FROM ItemTable WHERE key LIKE 'aiService.messageRequestContext%' OR key LIKE '%messageRequestContext%' LIMIT 10`;
      const { stdout: requestContextData } = await execAsync(
        `sqlite3 "${dbPath}" "${requestContextQuery}"`
      ).catch(() => ({ stdout: '' }));

      // Try to extract conversation metadata if it exists
      // Query for all conversation-related keys and merge them
      const conversationQuery = `SELECT key, value FROM ItemTable WHERE key LIKE 'aiService.conversations%' OR key LIKE 'conversations%'`;
      const { stdout: conversationData } = await execAsync(
        `sqlite3 "${dbPath}" "${conversationQuery}"`
      ).catch(() => ({ stdout: '' }));

      let conversationMetadata = {};
      if (conversationData.trim()) {
        try {
          // Handle multiple rows (key-value pairs)
          // sqlite3 uses tabs as default separator, but values might contain tabs too
          // Use a regex that splits on the first tab only
          const lines = conversationData.trim().split('\n');
          const conversationsMap = new Map();

          for (const line of lines) {
            if (!line) continue;
            // Split on first tab only (sqlite3 default separator)
            const tabIndex = line.indexOf('\t');
            if (tabIndex === -1) continue;

            const key = line.substring(0, tabIndex);
            const value = line.substring(tabIndex + 1);

            try {
              const parsed = JSON.parse(value);
              // If it's an array of conversations, store them
              if (Array.isArray(parsed)) {
                parsed.forEach((conv) => {
                  if (conv.id && !conversationsMap.has(conv.id)) {
                    conversationsMap.set(conv.id, conv);
                  }
                });
              } else if (parsed.conversations && Array.isArray(parsed.conversations)) {
                parsed.conversations.forEach((conv) => {
                  if (conv.id && !conversationsMap.has(conv.id)) {
                    conversationsMap.set(conv.id, conv);
                  }
                });
              } else if (parsed.id) {
                // Single conversation object
                conversationsMap.set(parsed.id, parsed);
              }
            } catch (parseError) {
              // If this line doesn't parse as JSON, try parsing the whole value as JSON
              try {
                const fullParsed = JSON.parse(value);
                if (Array.isArray(fullParsed)) {
                  fullParsed.forEach((conv) => {
                    if (conv.id && !conversationsMap.has(conv.id)) {
                      conversationsMap.set(conv.id, conv);
                    }
                  });
                } else if (fullParsed.conversations) {
                  if (Array.isArray(fullParsed.conversations)) {
                    fullParsed.conversations.forEach((conv) => {
                      if (conv.id && !conversationsMap.has(conv.id)) {
                        conversationsMap.set(conv.id, conv);
                      }
                    });
                  }
                } else {
                  Object.assign(conversationMetadata, fullParsed);
                }
              } catch (e2) {
                // Skip this entry if it doesn't parse
              }
            }
          }

          // Convert map to array or object structure
          if (conversationsMap.size > 0) {
            conversationMetadata.conversations = Array.from(conversationsMap.values());
          } else if (conversationData.trim()) {
            // Fallback: try parsing the first line as JSON
            const firstLine = lines[0];
            if (firstLine) {
              const tabIndex = firstLine.indexOf('\t');
              if (tabIndex !== -1) {
                const value = firstLine.substring(tabIndex + 1);
                conversationMetadata = JSON.parse(value);
              }
            }
          }
        } catch (e) {
          // Ignore parsing errors for conversation metadata
          console.warn('Could not parse conversation metadata:', e.message);
        }
      }

      const prompts = [];
      const generations = [];

      // Parse user prompts
      if (promptData.trim()) {
        try {
          const promptsArray = JSON.parse(promptData.trim());
          if (Array.isArray(promptsArray)) {
            promptsArray.forEach((item, idx) => {
              const text =
                item.text || item.textDescription || item.prompt || item.content || item.message;
              if (text && text.trim()) {
                prompts.push({
                  text: text.trim(),
                  type: item.type || 'unknown',
                  timestamp: item.timestamp,
                  generationUUID: item.generationUUID,
                  commandType: item.commandType,
                  // Capture conversation title if available
                  conversationTitle:
                    item.title ||
                    item.conversationTitle ||
                    item.conversation?.title ||
                    item.metadata?.title ||
                    null,
                  conversationId:
                    item.conversationId ||
                    item.conversation?.id ||
                    item.metadata?.conversationId ||
                    null,
                  index: idx,
                  messageRole: 'user',
                  source: 'aiService',
                });
              }
            });
          }
        } catch (e) {
          console.warn('Error parsing aiService.prompts:', e.message);
        }
      }

      // Parse additional metadata for context usage and model info
      const metadataMap = new Map();
      if (metadataData.trim()) {
        try {
          const lines = metadataData.trim().split('\n');
          for (const line of lines) {
            if (!line) continue;
            const tabIndex = line.indexOf('\t');
            if (tabIndex === -1) continue;

            const key = line.substring(0, tabIndex);
            const value = line.substring(tabIndex + 1);

            try {
              const parsed = JSON.parse(value);
              metadataMap.set(key, parsed);
            } catch (e) {
              // Store raw value if not JSON
              metadataMap.set(key, value);
            }
          }
        } catch (e) {
          console.warn('Error parsing metadata:', e.message);
        }
      }

      // Parse AI generations
      if (genData.trim()) {
        try {
          const genArray = JSON.parse(genData.trim());
          if (Array.isArray(genArray)) {
            genArray.forEach((item, idx) => {
              const text = item.text || item.textDescription || item.content || item.message;
              if (text && text.trim()) {
                // Extract model information - check multiple possible locations
                // Check direct fields first
                let model =
                  item.model || item.model_name || item.assistant_model || item.modelName || null;

                // Check nested metadata structures
                if (!model && item.metadata) {
                  model =
                    item.metadata.model ||
                    item.metadata.model_name ||
                    item.metadata.assistant_model ||
                    item.metadata.modelName ||
                    null;
                }

                // Check request context or other nested structures
                if (!model && item.requestContext) {
                  model = item.requestContext.model || item.requestContext.model_name || null;
                }

                // Check for actual/resolved model (the model that was actually used)
                const actualModel =
                  item.actual_model ||
                  item.resolved_model ||
                  item.selected_model ||
                  item.actualModel ||
                  item.resolvedModel ||
                  item.selectedModel ||
                  (item.metadata && (item.metadata.actual_model || item.metadata.resolved_model)) ||
                  model;

                const isAuto =
                  !model ||
                  (typeof model === 'string' &&
                    (model.toLowerCase() === 'auto' || model.toLowerCase().includes('auto')));

                // Debug logging for missing model information (only log once per batch)
                if (!model && !actualModel && idx === 0 && Math.random() < 0.01) {
                  // Only log 1% of the time to reduce noise
                  console.debug(
                    '[CURSOR-DB-PARSER] Some generation items missing model info (this is normal)'
                  );
                }

                // Extract context usage from various possible fields
                const contextUsage =
                  item.context_usage ||
                  item.contextUsage ||
                  item.context_usage_percent ||
                  item.token_usage?.context_percent ||
                  item.usage?.context_percent ||
                  null;

                // Calculate context usage from token counts if available
                let calculatedContextUsage = null;
                if (
                  !contextUsage &&
                  (item.prompt_tokens || item.total_tokens || item.token_count)
                ) {
                  const promptTokens = item.prompt_tokens || item.token_count || 0;
                  const totalTokens = item.total_tokens || item.max_tokens || 0;
                  // Common context window sizes: 128k, 200k, 1M tokens
                  // Estimate based on prompt tokens (assuming 200k default)
                  const contextWindowSize = item.context_window_size || 200000;
                  if (promptTokens > 0 && contextWindowSize > 0) {
                    calculatedContextUsage = Math.min(
                      100,
                      (promptTokens / contextWindowSize) * 100
                    );
                  }
                }

                generations.push({
                  text: text.trim(),
                  type: item.type || 'unknown',
                  timestamp: item.timestamp,
                  generationUUID: item.uuid || item.generationUUID,
                  model: actualModel || model || 'Unknown',
                  originalModel: model, // Store original (might be "auto")
                  isAuto: isAuto,
                  finishReason: item.finishReason,
                  // Context usage information
                  contextUsage: contextUsage || calculatedContextUsage,
                  promptTokens: item.prompt_tokens || item.token_count || null,
                  completionTokens: item.completion_tokens || null,
                  totalTokens: item.total_tokens || null,
                  contextWindowSize: item.context_window_size || null,
                  // Additional metadata
                  temperature: item.temperature,
                  maxTokens: item.max_tokens,
                  index: idx,
                  messageRole: 'assistant',
                  source: 'aiService',
                });
              }
            });
          }
        } catch (e) {
          console.warn('Error parsing aiService.generations:', e.message);
        }
      }

      return {
        prompts,
        generations,
        conversationMetadata,
        metadata: Object.fromEntries(metadataMap),
      };
    } catch (error) {
      console.warn('Error extracting AI service data:', error.message);
      return { prompts: [], generations: [], conversationMetadata: {} };
    }
  }

  /**
   * Extract terminal blocks from text (code blocks with terminal output)
   */
  extractTerminalBlocks(text) {
    if (!text) return [];

    const terminalBlocks = [];

    // Pattern 1: Code blocks with bash/shell/terminal language
    const codeBlockPattern = /```(?:bash|shell|terminal|zsh|sh)?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockPattern.exec(text)) !== null) {
      const content = match[1].trim();
      if (content.length > 0) {
        terminalBlocks.push({
          type: 'code_block',
          content: content,
          hasPrompt: content.includes('$') || content.includes('%'),
          position: match.index,
        });
      }
    }

    // Pattern 2: Terminal-like patterns in plain text ($ or % prompts)
    const terminalLinePattern = /^[\$%]\s+(.+)$/gm;
    while ((match = terminalLinePattern.exec(text)) !== null) {
      terminalBlocks.push({
        type: 'terminal_line',
        content: match[1].trim(),
        position: match.index,
      });
    }

    // Pattern 3: Error messages
    const errorPatterns = [
      /Error:\s*(.+)/gi,
      /Exception:\s*(.+)/gi,
      /Failed:\s*(.+)/gi,
      /\[ERROR\]\s*(.+)/gi,
    ];

    errorPatterns.forEach((pattern) => {
      let errorMatch;
      while ((errorMatch = pattern.exec(text)) !== null) {
        terminalBlocks.push({
          type: 'error_message',
          content: errorMatch[1].trim(),
          position: errorMatch.index,
        });
      }
    });

    return terminalBlocks;
  }

  /**
   * Extract context information for prompts
   */
  async extractContextForPrompts(prompts) {
    const enrichedPrompts = [];

    for (const prompt of prompts) {
      try {
        // Extract context using the context extractor
        const context = await this.contextExtractor.getPromptContext({
          text: prompt.text,
          content: prompt.text,
          composerData: prompt.composerData || {},
          response: prompt.response,
        });

        // Enrich prompt with context information
        const enrichedPrompt = {
          ...prompt,
          context: {
            atFiles: context.atFiles || [],
            contextFiles: context.contextFiles || {},
            responseFiles: context.responseFiles || [],
            browserState: context.browserState || {},
            fileRelationships: context.fileRelationships || {},
          },
        };

        enrichedPrompts.push(enrichedPrompt);
      } catch (error) {
        console.warn(`Could not extract context for prompt ${prompt.composerId}:`, error.message);
        enrichedPrompts.push(prompt);
      }
    }

    return enrichedPrompts;
  }

  /**
   * Get all workspaces (including stale/old ones)
   */
  async getAllWorkspaces() {
    try {
      const { workspaces } = this.dbPaths;

      if (!fs.existsSync(workspaces)) {
        return [];
      }

      const workspaceDirs = fs.readdirSync(workspaces);
      const allWorkspaces = [];

      for (const dir of workspaceDirs) {
        try {
          const workspaceDir = path.join(workspaces, dir);
          const stat = fs.statSync(workspaceDir);

          // Skip if not a directory
          if (!stat.isDirectory()) continue;

          const workspacePath = this.getWorkspacePath(dir);
          const workspaceName = this.getWorkspaceName(workspacePath);

          allWorkspaces.push({
            id: dir,
            path: workspacePath,
            name: workspaceName,
            lastAccessed: stat.mtime,
            created: stat.birthtime || stat.ctime,
            exists: workspacePath ? fs.existsSync(workspacePath) : false,
          });
        } catch (error) {
          // Skip workspaces that can't be read
          console.warn(`Could not read workspace ${dir}:`, error.message);
        }
      }

      // Sort by last accessed (most recent first)
      allWorkspaces.sort((a, b) => b.lastAccessed - a.lastAccessed);

      console.log(`[FILE] Found ${allWorkspaces.length} total workspaces`);
      return allWorkspaces;
    } catch (error) {
      console.error('Error getting all workspaces:', error.message);
      return [];
    }
  }

  /**
   * Get all extracted data
   * Uses mutex to prevent concurrent database reads (thundering herd problem)
   */
  async getAllData() {
    const now = Date.now();

    // Use cache if recent
    if (now - this.cache.lastUpdate < this.updateInterval) {
      return this.cache;
    }

    // If already refreshing, wait for that promise instead of starting another refresh
    if (this.isRefreshing && this.refreshPromise) {
      console.log('[CACHE] Database refresh in progress, waiting...');
      try {
        await this.refreshPromise;
      } catch (error) {
        // If refresh failed, continue to try again
      }
      // Return cache (either updated by the other request, or stale if it failed)
      return this.cache;
    }

    // Start refresh with mutex
    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        // Extract AI service data (actual conversation messages with full threading!)
        const aiServiceMessages = await this.extractAllAIServiceData();

        // Enrich prompts with context information
        const enrichedPrompts = await this.extractContextForPrompts(aiServiceMessages);

        // Count unique conversations
        const uniqueConversations = new Set(
          enrichedPrompts.map((p) => p.parentConversationId).filter(Boolean)
        ).size;

        this.cache = {
          conversations: [], // No longer needed - messages are self-contained
          prompts: enrichedPrompts,
          lastUpdate: Date.now(),
          stats: {
            totalConversations: uniqueConversations,
            totalPrompts: enrichedPrompts.length,
            aiServiceMessages: aiServiceMessages.length,
            userMessages: enrichedPrompts.filter((p) => p.messageRole === 'user').length,
            assistantMessages: enrichedPrompts.filter((p) => p.messageRole === 'assistant').length,
          },
        };

        console.log(
          `[CACHE] Database refreshed: ${enrichedPrompts.length} prompts, ${uniqueConversations} workspaces`
        );
        return this.cache;
      } catch (error) {
        console.error('Error getting all data:', error.message);
        return this.cache; // Return cached data on error
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /**
   * Extract AI service data from all workspaces and thread them
   */
  async extractAllAIServiceData() {
    try {
      const { workspaces: workspaceRoot } = this.dbPaths;

      if (!fs.existsSync(workspaceRoot)) {
        return [];
      }

      const workspaceDirs = fs.readdirSync(workspaceRoot).filter((name) => {
        const dbPath = path.join(workspaceRoot, name, 'state.vscdb');
        return fs.existsSync(dbPath);
      });

      const allMessages = [];

      for (const workspaceId of workspaceDirs) {
        const dbPath = path.join(workspaceRoot, workspaceId, 'state.vscdb');
        const { prompts, generations, conversationMetadata } =
          await this.extractAIServiceData(dbPath);

        // Get workspace metadata
        const workspacePath = this.getWorkspacePath(workspaceId);
        const workspaceName = this.getWorkspaceName(workspacePath);

        // Link prompts to generations by UUID and create threaded conversations
        const linked = this.linkPromptsToGenerations(
          prompts,
          generations,
          workspaceId,
          workspacePath,
          workspaceName,
          conversationMetadata
        );
        allMessages.push(...linked);
      }

      console.log(
        `[AI-SERVICE] Extracted ${allMessages.length} messages with conversation threading`
      );
      return allMessages;
    } catch (error) {
      console.warn('Error extracting AI service data:', error.message);
      return [];
    }
  }

  /**
   * Link user prompts to AI generations and create conversation threads
   */
  linkPromptsToGenerations(
    prompts,
    generations,
    workspaceId,
    workspacePath,
    workspaceName,
    conversationMetadata = {}
  ) {
    const threaded = [];
    const genMap = new Map();

    // Build generation lookup by UUID
    generations.forEach((gen) => {
      if (gen.generationUUID) {
        genMap.set(gen.generationUUID, gen);
      }
    });

    // Create a map of conversation titles by conversationId if available
    const conversationTitleMap = new Map();
    if (conversationMetadata && typeof conversationMetadata === 'object') {
      // If conversationMetadata is an array of conversations
      if (Array.isArray(conversationMetadata)) {
        conversationMetadata.forEach((conv) => {
          if (conv.id && conv.title) {
            conversationTitleMap.set(conv.id, conv.title);
          }
        });
      } else if (
        conversationMetadata.conversations &&
        Array.isArray(conversationMetadata.conversations)
      ) {
        conversationMetadata.conversations.forEach((conv) => {
          if (conv.id && conv.title) {
            conversationTitleMap.set(conv.id, conv.title);
          }
        });
      }
    }

    // Link prompts to their responses
    prompts.forEach((prompt, idx) => {
      const correspondingGen = genMap.get(prompt.generationUUID);

      // Estimate timestamp if not available
      let timestamp = prompt.timestamp;
      if (!timestamp && correspondingGen && correspondingGen.timestamp) {
        timestamp = correspondingGen.timestamp - 30000; // 30 seconds before AI response
      }

      // Create stable conversation ID: prefer generationUUID (from Cursor DB), then conversationId, then create workspace-scoped ID
      let conversationId = prompt.generationUUID || prompt.conversationId;

      // If no stable ID, create one based on workspace + a hash of first message
      if (!conversationId) {
        const firstMessageHash = require('crypto')
          .createHash('md5')
          .update(prompt.text || '')
          .digest('hex')
          .substring(0, 8);
        conversationId = `${workspaceId}_${firstMessageHash}`;
      }

      // Ensure conversation ID is workspace-scoped to prevent collisions
      if (workspaceId && !conversationId.includes(workspaceId)) {
        conversationId = `${workspaceId}:${conversationId}`;
      }

      // Determine conversation title: prefer explicit title, then metadata map, then smart extraction
      let conversationTitle =
        prompt.conversationTitle ||
        conversationTitleMap.get(conversationId) ||
        conversationTitleMap.get(prompt.conversationId) ||
        null;

      // Smart title extraction: look for common patterns
      if (!conversationTitle && prompt.text) {
        const text = prompt.text.trim();

        // Pattern 1: First line if it's short and looks like a title
        const firstLine = text.split('\n')[0];
        if (firstLine.length < 100 && firstLine.length > 10 && !firstLine.includes('```')) {
          conversationTitle = firstLine;
        }
        // Pattern 2: Extract from "Fix X", "Add Y", "Implement Z" patterns
        else if (
          text.match(
            /^(fix|add|implement|create|update|refactor|remove|delete|improve|investigate|debug|test|write|build|design)\s+/i
          )
        ) {
          const match = text.match(/^([A-Z][^.!?]{10,80})/);
          if (match) {
            conversationTitle = match[1].trim();
          }
        }
        // Pattern 3: First sentence if reasonable length
        else {
          const firstSentence = text.match(/^([^.!?]{15,100})[.!?]/);
          if (firstSentence) {
            conversationTitle = firstSentence[1].trim();
          } else {
            // Fallback: first 80 chars, but clean it up
            conversationTitle = text.substring(0, 80).replace(/\n/g, ' ').trim();
            if (conversationTitle.length < 10) {
              conversationTitle = text.substring(0, 100).replace(/\n/g, ' ').trim();
            }
          }
        }
      }

      // Extract model and context info from corresponding generation
      const modelInfo = correspondingGen
        ? {
            model: correspondingGen.model,
            originalModel: correspondingGen.originalModel,
            isAuto: correspondingGen.isAuto,
            contextUsage: correspondingGen.contextUsage,
            promptTokens: correspondingGen.promptTokens,
            completionTokens: correspondingGen.completionTokens,
            totalTokens: correspondingGen.totalTokens,
            contextWindowSize: correspondingGen.contextWindowSize,
          }
        : {};

      // Add user message
      const isConversationThread = prompt.type === 'composer';
      threaded.push({
        id: `${conversationId}_user`,
        text: prompt.text,
        timestamp: timestamp || Date.now(),
        workspaceId: workspaceId,
        workspacePath: workspacePath,
        workspaceName: workspaceName,
        composerId: conversationId,
        conversationId: conversationId, // Explicit conversation ID
        conversationIndex: 0, // Will be updated when messages are saved
        source: 'aiService',
        type: isConversationThread ? 'conversation-thread' : 'user-prompt',
        messageRole: 'user',
        // Don't set parentConversationId for thread initiators (so dashboard can identify them as threads)
        parentConversationId: isConversationThread ? undefined : conversationId,
        conversationTitle: conversationTitle,
        // Include model and context info from generation (for user prompt, this is the model that will be used)
        modelName: modelInfo.model || null,
        originalModel: modelInfo.originalModel || null,
        isAuto: modelInfo.isAuto || false,
        contextUsage: modelInfo.contextUsage || null,
        promptTokens: modelInfo.promptTokens || null,
        confidence: 'high',
        status: 'captured',
      });

      // Add AI response if it exists
      if (correspondingGen) {
        // Use the same conversation title we determined above
        threaded.push({
          id: `${conversationId}_assistant`,
          text: correspondingGen.text,
          timestamp: correspondingGen.timestamp || timestamp + 30000,
          workspaceId: workspaceId,
          workspacePath: workspacePath,
          workspaceName: workspaceName,
          composerId: conversationId,
          conversationId: conversationId, // Explicit conversation ID
          conversationIndex: 1, // Will be updated when messages are saved
          source: 'aiService',
          type: 'ai-response',
          messageRole: 'assistant',
          parentConversationId: conversationId,
          conversationTitle: conversationTitle,
          // Model information - use actual model if available, otherwise original
          model: correspondingGen.model,
          modelName: correspondingGen.model, // Alias for consistency
          originalModel: correspondingGen.originalModel || correspondingGen.model,
          isAuto: correspondingGen.isAuto || false,
          finishReason: correspondingGen.finishReason,
          // Context usage information
          contextUsage: correspondingGen.contextUsage || null,
          promptTokens: correspondingGen.promptTokens || null,
          completionTokens: correspondingGen.completionTokens || null,
          totalTokens: correspondingGen.totalTokens || null,
          contextWindowSize: correspondingGen.contextWindowSize || null,
          thinkingTimeSeconds:
            correspondingGen.timestamp && timestamp
              ? ((correspondingGen.timestamp - timestamp) / 1000).toFixed(2)
              : null,
          confidence: 'high',
          status: 'captured',
        });
      }
    });

    return threaded;
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(callback) {
    console.log('[SEARCH] Starting Cursor database monitoring...');

    // Initial extraction
    this.getAllData().then((data) => {
      if (callback) callback(data);
    });

    // Periodic updates
    this.monitoringInterval = setInterval(async () => {
      try {
        const data = await this.getAllData();
        if (callback) callback(data);
      } catch (error) {
        console.error('Monitoring error:', error.message);
      }
    }, this.updateInterval);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      console.log('Stopped Cursor database monitoring');
    }
  }
}

module.exports = CursorDatabaseParser;

// Test if run directly
if (require.main === module) {
  const parser = new CursorDatabaseParser();

  parser
    .getAllData()
    .then((data) => {
      console.log('\n[DATA] Cursor Database Extraction Results:');
      console.log('=====================================');
      console.log(`Conversations: ${data.conversations.length}`);
      console.log(`Prompts: ${data.prompts.length}`);
      console.log('\nSample Prompts:');
      data.prompts.slice(0, 5).forEach((prompt, i) => {
        const text = prompt.text || prompt.preview || 'No text';
        console.log(`${i + 1}. ${text.substring(0, 100)}...`);
      });
    })
    .catch((error) => {
      console.error('Error:', error);
    });
}
