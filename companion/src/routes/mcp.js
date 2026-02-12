/**
 * MCP (Model Context Protocol) API routes - BIDIRECTIONAL
 * Supports both WRITE (data capture) and READ (search/retrieval)
 * Set enable_mcp: true in config.json to enable.
 */

const crypto = require('crypto');
const path = require('path');
const MCPSearchService = require('../services/mcp-search-service');

function createMCPRoutes(deps) {
  const {
    app,
    persistentDB,
    db,
    checkSessionTimeout,
    updateActivityTime,
    detectWorkspace,
    getWorkspaceSession,
    getCurrentWorkspace,
    updateWorkspaceData,
    enqueue,
    broadcastUpdate,
    broadcastConversationUpdate,
    conversationStreams,
  } = deps;

  // Initialize MCP Search Service
  const searchService = new MCPSearchService(persistentDB);

  // Clear caches periodically (every 10 minutes)
  setInterval(() => searchService.clearCaches(), 10 * 60 * 1000);

  // Check if MCP is enabled (default: false)
  const isMCPEnabled = () => {
    try {
      const cfg = require('../utils/config.js');
      return cfg.get().enable_mcp === true;
    } catch (e) {
      return false; // Default to disabled
    }
  };

  // Enhanced MCP endpoints with comprehensive data capture (OPTIONAL)
  app.post('/mcp/log-prompt-response', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
        note: 'MCP is an optional feature for external data collection. Database mode is the default.',
      });
    }
    console.log('[MCP] Enhanced prompt-response received:', Object.keys(req.body));
    checkSessionTimeout();
    updateActivityTime();

    const {
      session_id,
      conversation_id,
      conversation_title,
      message_id,
      timestamp,
      file_path,
      workspace_path,
      workspace_name,
      prompt,
      response,
      message_role = 'user',
      metadata = {},
    } = req.body;

    // Detect workspace for this file
    const workspacePath =
      workspace_path || (file_path ? await detectWorkspace(file_path) : getCurrentWorkspace());
    const workspaceSession = getWorkspaceSession(workspacePath);

    const entryId = message_id || crypto.randomUUID();
    const entryTimestamp = timestamp || new Date().toISOString();

    // Create entry with enhanced metadata
    const entry = {
      id: entryId,
      session_id: session_id || workspaceSession,
      workspace_path: workspacePath,
      workspace_name: workspace_name || path.basename(workspacePath),
      timestamp: entryTimestamp,
      source: 'mcp',
      file_path: file_path || '',
      prompt: prompt || '',
      response: response || '',
      notes: 'Logged via MCP (Enhanced)',
      conversation_id: conversation_id,
      conversation_title: conversation_title,
      message_role: message_role,
    };

    // Create prompt record with comprehensive metadata (matching database mode structure)
    const promptData = {
      id: crypto.randomUUID(),
      session_id: entry.session_id,
      workspace_path: workspacePath,
      workspace_name: entry.workspace_name,
      timestamp: entryTimestamp,
      source: 'mcp',
      conversation_id: conversation_id || entryId,
      conversation_title: conversation_title,
      message_role: message_role,
      text: message_role === 'user' ? prompt : response,
      linked_entry_id: entryId,
      // Enhanced metadata
      context_usage: metadata.contextUsage || metadata.context_usage || null,
      lines_added: metadata.linesAdded || metadata.lines_added || null,
      lines_removed: metadata.linesRemoved || metadata.lines_removed || null,
      ai_mode: metadata.aiMode || metadata.ai_mode || 'chat',
      model: metadata.model || null,
      finish_reason: metadata.finishReason || metadata.finish_reason || null,
      thinking_time_seconds: metadata.thinkingTimeSeconds || metadata.thinking_time_seconds || null,
      context_files: JSON.stringify(metadata.contextFiles || metadata.context_files || []),
      at_files: JSON.stringify(metadata.atFiles || metadata.at_files || []),
      command_type: metadata.commandType || metadata.command_type || null,
      generation_uuid: metadata.generationUUID || metadata.generation_uuid || null,
      status: 'captured',
      confidence: 'high',
    };

    // Create matching event
    const event = {
      id: crypto.randomUUID(),
      session_id: entry.session_id,
      workspace_path: workspacePath,
      timestamp: entryTimestamp,
      type: 'prompt_response',
      details: JSON.stringify({
        file_path: entry.file_path,
        conversation_id: conversation_id,
        message_role: message_role,
        metadata: metadata,
      }),
    };

    // Store in database if persistent DB is available
    if (persistentDB) {
      try {
        await persistentDB.savePrompt(promptData);
        if (message_role === 'assistant' && response) {
          // Also save as entry for AI responses
          await persistentDB.saveEntry(entry);
        }
      } catch (dbError) {
        console.warn('[MCP] Failed to save to persistent DB:', dbError.message);
      }
    }

    // Use enqueue function for reliable queuing
    enqueue('entry', entry);
    enqueue('event', event);

    // Add prompt to in-memory store
    if (!db.prompts) db.prompts = [];
    db.prompts.push(promptData);

    // Update workspace data
    updateWorkspaceData(workspacePath, entry, event);

    // Broadcast real-time update via WebSocket
    broadcastUpdate('prompt-captured', {
      prompt: promptData,
      entry: entry,
      conversation_id: conversation_id,
    });

    console.log(
      `[SUCCESS] MCP enhanced entry added: ${entry.id} - ${entry.file_path} in workspace: ${workspacePath}`
    );

    res.json({ success: true, entry_id: entry.id, prompt_id: promptData.id });
  });

  app.post('/mcp/log-code-change', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
        note: 'MCP is an optional feature for external data collection. Database mode is the default.',
      });
    }

    checkSessionTimeout();
    updateActivityTime();

    const {
      session_id,
      conversation_id,
      timestamp,
      file_path,
      workspace_path,
      before_code,
      after_code,
      metadata = {},
    } = req.body;

    // Detect workspace for this file
    const workspacePath =
      workspace_path || (file_path ? await detectWorkspace(file_path) : getCurrentWorkspace());
    const workspaceSession = getWorkspaceSession(workspacePath);

    // Calculate diff metrics if not provided
    const linesAdded =
      metadata.linesAdded ||
      metadata.lines_added ||
      Math.max(0, (after_code || '').split('\n').length - (before_code || '').split('\n').length);
    const linesRemoved =
      metadata.linesRemoved ||
      metadata.lines_removed ||
      Math.max(0, (before_code || '').split('\n').length - (after_code || '').split('\n').length);

    const entry = {
      id: crypto.randomUUID(),
      session_id: session_id || workspaceSession,
      workspace_path: workspacePath,
      timestamp: timestamp || new Date().toISOString(),
      source: 'mcp',
      file_path: file_path || '',
      before_code: before_code || '',
      after_code: after_code || '',
      notes: 'Code change logged via MCP (Enhanced)',
      conversation_id: conversation_id,
      lines_added: linesAdded,
      lines_removed: linesRemoved,
      diff_size:
        metadata.diffSize ||
        metadata.diff_size ||
        Math.abs((after_code || '').length - (before_code || '').length),
    };

    // Store in database if persistent DB is available
    if (persistentDB) {
      try {
        await persistentDB.saveEntry(entry);
      } catch (dbError) {
        console.warn('[MCP] Failed to save entry to persistent DB:', dbError.message);
      }
    }

    // Use enqueue function for reliable queuing
    enqueue('entry', entry);

    // Create matching event
    const event = {
      id: crypto.randomUUID(),
      session_id: entry.session_id,
      workspace_path: workspacePath,
      timestamp: entry.timestamp,
      type: 'code_change',
      details: JSON.stringify({
        file_path: entry.file_path,
        conversation_id: conversation_id,
        lines_added: linesAdded,
        lines_removed: linesRemoved,
        metadata: metadata,
      }),
    };
    enqueue('event', event);

    // Update workspace data
    updateWorkspaceData(workspacePath, entry, event);

    // Broadcast real-time update
    broadcastUpdate('file-changed', {
      entry: entry,
      event: event,
    });

    console.log(
      `[SUCCESS] MCP enhanced code change added: ${entry.id} - ${entry.file_path} in workspace: ${workspacePath}`
    );

    res.json({ success: true, entry_id: entry.id });
  });

  // Enhanced conversation logging endpoint (OPTIONAL)
  app.post('/mcp/log-conversation', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
        note: 'MCP is an optional feature for external data collection. Database mode is the default.',
      });
    }

    console.log('[MCP] Conversation received:', req.body.conversation_id);
    checkSessionTimeout();
    updateActivityTime();

    const {
      conversation_id,
      conversation_title,
      session_id,
      workspace_path,
      workspace_name,
      messages = [],
      metadata = {},
    } = req.body;

    const workspacePath = workspace_path || getCurrentWorkspace();
    const workspaceSession = getWorkspaceSession(workspacePath);

    // Process all messages in the conversation
    const savedPrompts = [];
    const savedEntries = [];

    for (const message of messages) {
      const messageId = message.id || crypto.randomUUID();
      const messageTimestamp = message.timestamp || new Date().toISOString();

      // Create prompt record for each message
      const promptData = {
        id: messageId,
        session_id: session_id || workspaceSession,
        workspace_path: workspacePath,
        workspace_name: workspace_name || path.basename(workspacePath),
        timestamp: messageTimestamp,
        source: 'mcp',
        conversation_id: conversation_id,
        conversation_title: conversation_title,
        message_role: message.role || 'user',
        text: message.text || message.content || '',
        linked_entry_id: null,
        context_usage: message.metadata?.contextUsage || metadata.contextUsage || null,
        lines_added: message.metadata?.linesAdded || metadata.linesAdded || null,
        lines_removed: message.metadata?.linesRemoved || metadata.linesRemoved || null,
        ai_mode: message.metadata?.aiMode || metadata.aiMode || 'chat',
        model: message.metadata?.model || metadata.model || null,
        finish_reason: message.metadata?.finishReason || metadata.finishReason || null,
        thinking_time_seconds:
          message.metadata?.thinkingTimeSeconds || metadata.thinkingTimeSeconds || null,
        context_files: JSON.stringify(
          message.metadata?.contextFiles || metadata.contextFiles || []
        ),
        at_files: JSON.stringify(message.metadata?.atFiles || metadata.atFiles || []),
        status: 'captured',
        confidence: 'high',
      };

      savedPrompts.push(promptData);

      // Store in database
      if (persistentDB) {
        try {
          await persistentDB.savePrompt(promptData);
        } catch (dbError) {
          console.warn('[MCP] Failed to save prompt:', dbError.message);
        }
      }

      // Add to in-memory store
      if (!db.prompts) db.prompts = [];
      db.prompts.push(promptData);
    }

    // Create conversation event
    const event = {
      id: crypto.randomUUID(),
      session_id: session_id || workspaceSession,
      workspace_path: workspacePath,
      timestamp: new Date().toISOString(),
      type: 'conversation',
      details: JSON.stringify({
        conversation_id: conversation_id,
        conversation_title: conversation_title,
        message_count: messages.length,
        metadata: metadata,
      }),
    };

    enqueue('event', event);
    updateWorkspaceData(workspacePath, null, event);

    // Broadcast conversation update
    broadcastUpdate('conversation-update', {
      conversation_id: conversation_id,
      conversation_title: conversation_title,
      messages: savedPrompts,
      metadata: metadata,
    });

    // Broadcast to subscribed WebSocket clients
    if (broadcastConversationUpdate) {
      broadcastConversationUpdate(conversation_id, {
        conversation_id: conversation_id,
        conversation_title: conversation_title,
        messages: savedPrompts,
        metadata: metadata,
      });
    }

    console.log(
      `[SUCCESS] MCP conversation logged: ${conversation_id} with ${messages.length} messages`
    );

    res.json({
      success: true,
      conversation_id: conversation_id,
      message_count: messages.length,
      prompt_ids: savedPrompts.map((p) => p.id),
    });
  });

  // Conversation streaming endpoint (OPTIONAL)
  app.post('/mcp/stream-conversation', (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
        note: 'MCP is an optional feature for external data collection. Database mode is the default.',
      });
    }

    const { conversation_id, enable = true } = req.body;

    if (enable) {
      conversationStreams.set(conversation_id, {
        id: conversation_id,
        enabled: true,
        startTime: Date.now(),
        messageCount: 0,
      });
      console.log(`[MCP] Conversation streaming enabled: ${conversation_id}`);
    } else {
      conversationStreams.delete(conversation_id);
      console.log(`[MCP] Conversation streaming disabled: ${conversation_id}`);
    }

    res.json({ success: true, streaming: enable, conversation_id });
  });

  // Get active conversation streams (OPTIONAL)
  app.get('/mcp/streams', (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
        note: 'MCP is an optional feature for external data collection. Database mode is the default.',
      });
    }

    const streams = Array.from(conversationStreams.values());
    res.json({ success: true, streams: streams });
  });

  app.post('/mcp/log-event', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
        note: 'MCP is an optional feature for external data collection. Database mode is the default.',
      });
    }

    checkSessionTimeout();
    updateActivityTime();

    const { session_id, type, details, file_path, timestamp } = req.body;

    // Detect workspace from file_path if provided, or use details
    let workspacePath = getCurrentWorkspace();
    const parsedDetails = typeof details === 'string' ? JSON.parse(details || '{}') : details;
    const eventFilePath = file_path || parsedDetails.file_path;

    if (eventFilePath) {
      workspacePath = await detectWorkspace(eventFilePath);
    }
    const workspaceSession = getWorkspaceSession(workspacePath);

    const event = {
      id: crypto.randomUUID(),
      session_id: session_id || workspaceSession,
      workspace_path: workspacePath,
      timestamp: timestamp || new Date().toISOString(),
      type: type || 'unknown',
      details: typeof details === 'string' ? details : JSON.stringify(details || {}),
    };

    // Use enqueue function for reliable queuing
    enqueue('event', event);

    // Update workspace data
    updateWorkspaceData(workspacePath, null, event);

    // Broadcast real-time update
    broadcastUpdate('event', event);

    console.log(
      `[SUCCESS] MCP event added: ${event.id} - ${event.type} in workspace: ${workspacePath}`
    );

    res.json({ success: true, event_id: event.id });
  });

  // ============================================================================
  // MCP READ/SEARCH ENDPOINTS (NEW - Bidirectional MCP)
  // ============================================================================

  /**
   * Search workflows by natural language query
   * MCP Tool: search_workflows
   */
  app.post('/mcp/search-workflows', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled. Set enable_mcp: true in config.json to enable.',
      });
    }

    try {
      const { query, rung, workspace, timeframe_days, limit, auto_select } = req.body;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Query parameter is required'
        });
      }

      const results = await searchService.searchWorkflows({
        query,
        rung: rung || 'semantic_edits',
        workspace: workspace || null,
        timeframe_days: timeframe_days || 90,
        limit: limit || 10,
        auto_select: auto_select || false
      });

      console.log(`[MCP Search] Workflow search: "${query}" - ${results.matches.length} matches (${results.rung})`);

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      console.error('[MCP Search] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Retrieve sessions similar to current activity
   * MCP Tool: retrieve_similar_sessions
   */
  app.post('/mcp/retrieve-similar', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled.',
      });
    }

    try {
      const {
        current_files,
        current_intent,
        rung,
        similarity_threshold,
        limit
      } = req.body;

      const results = await searchService.retrieveSimilarSessions({
        current_files: current_files || [],
        current_intent: current_intent || null,
        rung: rung || 'semantic_edits',
        similarity_threshold: similarity_threshold || 0.5,
        limit: limit || 5
      });

      console.log(`[MCP Search] Similar sessions: ${results.matches.length} matches`);

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      console.error('[MCP Search] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get workflow pattern for specific task type
   * MCP Tool: get_workflow_pattern
   */
  app.post('/mcp/workflow-pattern', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled.',
      });
    }

    try {
      const { task_type, workspace, format, limit } = req.body;

      if (!task_type) {
        return res.status(400).json({
          success: false,
          error: 'task_type parameter is required'
        });
      }

      const results = await searchService.getWorkflowPattern({
        task_type,
        workspace: workspace || null,
        format: format || 'motifs',
        limit: limit || 10
      });

      console.log(`[MCP Search] Workflow pattern for ${task_type}: ${results.session_count} sessions`);

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      console.error('[MCP Search] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Query sessions by developer intent
   * MCP Tool: query_by_intent
   */
  app.post('/mcp/query-intent', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled.',
      });
    }

    try {
      const { intent, context, rung, limit } = req.body;

      if (!intent) {
        return res.status(400).json({
          success: false,
          error: 'intent parameter is required'
        });
      }

      const results = await searchService.queryByIntent({
        intent,
        context: context || null,
        rung: rung || 'semantic_edits',
        limit: limit || 10
      });

      console.log(`[MCP Search] Intent query "${intent}": ${results.matches.length} matches`);

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      console.error('[MCP Search] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get file-specific workflow history
   * MCP Tool: get_file_history
   */
  app.post('/mcp/file-history', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled.',
      });
    }

    try {
      const { file_path, include_related, rung, limit } = req.body;

      if (!file_path) {
        return res.status(400).json({
          success: false,
          error: 'file_path parameter is required'
        });
      }

      const results = await searchService.getFileHistory({
        file_path,
        include_related: include_related || false,
        rung: rung || 'functions',
        limit: limit || 20
      });

      console.log(`[MCP Search] File history for ${file_path}: ${results.event_count} events`);

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      console.error('[MCP Search] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get context-aware suggestions for current activity
   * MCP Tool: get_context_suggestions
   */
  app.post('/mcp/context-suggestions', async (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled.',
      });
    }

    try {
      const {
        current_session_id,
        current_files,
        current_intent,
        lookback_minutes
      } = req.body;

      if (!current_session_id) {
        return res.status(400).json({
          success: false,
          error: 'current_session_id parameter is required'
        });
      }

      const results = await searchService.getContextSuggestions({
        current_session_id,
        current_files: current_files || [],
        current_intent: current_intent || null,
        lookback_minutes: lookback_minutes || 30
      });

      console.log(`[MCP Search] Context suggestions: ${results.suggestions.length} suggestions`);

      res.json({
        success: true,
        ...results
      });
    } catch (error) {
      console.error('[MCP Search] Error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  /**
   * Get MCP capabilities - lists all available tools
   */
  app.get('/mcp/capabilities', (req, res) => {
    if (!isMCPEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'MCP endpoints are disabled.',
      });
    }

    res.json({
      success: true,
      protocol_version: '2024-11-05',
      capabilities: {
        write: {
          log_prompt_response: true,
          log_code_change: true,
          log_conversation: true,
          log_event: true,
          stream_conversation: true
        },
        read: {
          search_workflows: {
            description: 'Search for similar workflows in past sessions',
            parameters: ['query', 'rung', 'workspace', 'timeframe_days', 'limit', 'auto_select']
          },
          retrieve_similar_sessions: {
            description: 'Find sessions similar to current activity',
            parameters: ['current_files', 'current_intent', 'rung', 'similarity_threshold', 'limit']
          },
          get_workflow_pattern: {
            description: 'Get workflow pattern for specific task type',
            parameters: ['task_type', 'workspace', 'format', 'limit']
          },
          query_by_intent: {
            description: 'Query past sessions by developer intent',
            parameters: ['intent', 'context', 'rung', 'limit']
          },
          get_file_history: {
            description: 'Get workflow history for specific file',
            parameters: ['file_path', 'include_related', 'rung', 'limit']
          },
          get_context_suggestions: {
            description: 'Get context-aware suggestions for current activity',
            parameters: ['current_session_id', 'current_files', 'current_intent', 'lookback_minutes']
          }
        }
      },
      rung_options: ['raw', 'tokens', 'semantic_edits', 'functions', 'module_graph', 'motifs'],
      task_rung_mapping: searchService.taskRungMap
    });
  });
}

module.exports = createMCPRoutes;
