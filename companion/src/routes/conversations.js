/**
 * Conversation API routes
 * Handles conversation and turn management endpoints
 */

function createConversationRoutes(deps) {
  const {
    app,
    persistentDB,
    conversationManager,
    conversationCapture,
    conversationContext,
    clioService,
  } = deps;

  // Get all conversations for a workspace (workspaceId is optional)
  app.get('/api/conversations', async (req, res) => {
    try {
      const workspaceId = req.query.workspaceId || req.query.workspace || null;

      const options = {
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0,
        status: req.query.status || null,
      };

      let conversations;
      if (workspaceId && workspaceId !== 'all') {
        conversations = await conversationManager.getConversationsByWorkspace(workspaceId, options);
      } else {
        // Get all conversations if no workspace specified
        conversations = await conversationManager.getAllConversations(options);
      }

      res.json({
        success: true,
        data: conversations,
        count: conversations.length,
      });
    } catch (error) {
      console.error('Error getting conversations:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get a specific conversation with turns
  app.get('/api/conversations/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversation = await conversationManager.getConversationWithTurns(conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error('Error getting conversation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Create a new conversation
  app.post('/api/conversations', async (req, res) => {
    try {
      const { workspaceId, workspacePath, title, status, metadata } = req.body;

      if (!workspaceId) {
        return res.status(400).json({
          success: false,
          error: 'workspaceId is required',
        });
      }

      const conversation = await conversationManager.createConversation({
        workspaceId,
        workspacePath,
        title,
        status,
        metadata,
      });

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error('Error creating conversation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Update a conversation
  app.patch('/api/conversations/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const updates = req.body;

      const conversation = await conversationManager.updateConversation(conversationId, updates);

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error('Error updating conversation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Archive a conversation
  app.post('/api/conversations/:conversationId/archive', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversation = await conversationManager.archiveConversation(conversationId);

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error('Error archiving conversation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Delete a conversation
  app.delete('/api/conversations/:conversationId', async (req, res) => {
    try {
      const { conversationId } = req.params;
      await conversationManager.deleteConversation(conversationId);

      res.json({
        success: true,
        message: 'Conversation deleted',
      });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Capture a user turn
  app.post('/api/conversations/:conversationId/turns/user', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const { content, contextFiles, referencedFiles, metadata } = req.body;

      if (!content) {
        return res.status(400).json({
          success: false,
          error: 'content is required',
        });
      }

      const turn = await conversationCapture.captureUserTurn(conversationId, {
        content,
        contextFiles,
        referencedFiles,
        metadata,
      });

      res.json({
        success: true,
        data: turn,
      });
    } catch (error) {
      console.error('Error capturing user turn:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Capture an assistant turn
  app.post('/api/conversations/:conversationId/turns/assistant', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const {
        content,
        timing,
        tokens,
        model,
        streaming,
        codeBlocks,
        metadata,
        thinkingTime,
        thinkingTimeSeconds,
      } = req.body;

      if (!content || !timing) {
        return res.status(400).json({
          success: false,
          error: 'content and timing are required',
        });
      }

      // Include thinking time in timing or metadata if provided
      const enhancedTiming = {
        ...timing,
        thinkingTime: thinkingTime || timing.thinkingTime,
        thinkingTimeSeconds: thinkingTimeSeconds || timing.thinkingTimeSeconds,
      };
      const enhancedMetadata = {
        ...metadata,
        thinkingTime: thinkingTime || metadata.thinkingTime,
        thinkingTimeSeconds: thinkingTimeSeconds || metadata.thinkingTimeSeconds,
      };

      const turn = await conversationCapture.captureAssistantTurn(conversationId, {
        content,
        timing: enhancedTiming,
        tokens,
        model,
        streaming,
        codeBlocks,
        metadata: enhancedMetadata,
      });

      res.json({
        success: true,
        data: turn,
      });
    } catch (error) {
      console.error('Error capturing assistant turn:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Update a turn
  app.patch('/api/conversations/turns/:turnId', async (req, res) => {
    try {
      const { turnId } = req.params;
      const updates = req.body;

      const turn = await conversationCapture.updateTurn(turnId, updates);

      if (!turn) {
        return res.status(404).json({
          success: false,
          error: 'Turn not found',
        });
      }

      res.json({
        success: true,
        data: turn,
      });
    } catch (error) {
      console.error('Error updating turn:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get conversation statistics
  app.get('/api/conversations/:conversationId/stats', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const turns = await conversationManager.getConversationTurns(conversationId);

      const assistantTurns = turns.filter((t) => t.role === 'assistant');
      const assistantTurnsWithDuration = assistantTurns.filter((t) => t.request_duration_ms);
      const assistantTurnsWithTTFT = assistantTurns.filter((t) => t.time_to_first_token_ms);
      const assistantTurnsWithThinking = assistantTurns.filter(
        (t) => t.thinking_time_seconds && t.thinking_time_seconds > 0
      );

      const stats = {
        totalTurns: turns.length,
        userTurns: turns.filter((t) => t.role === 'user').length,
        assistantTurns: assistantTurns.length,
        totalTokens: turns.reduce((sum, t) => sum + (t.total_tokens || 0), 0),
        totalPromptTokens: turns.reduce((sum, t) => sum + (t.prompt_tokens || 0), 0),
        totalCompletionTokens: turns.reduce((sum, t) => sum + (t.completion_tokens || 0), 0),
        avgResponseTime:
          assistantTurnsWithDuration.length > 0
            ? assistantTurnsWithDuration.reduce((sum, t) => sum + t.request_duration_ms, 0) /
              assistantTurnsWithDuration.length
            : 0,
        avgTimeToFirstToken:
          assistantTurnsWithTTFT.length > 0
            ? assistantTurnsWithTTFT.reduce((sum, t) => sum + t.time_to_first_token_ms, 0) /
              assistantTurnsWithTTFT.length
            : 0,
        avgThinkingTime:
          assistantTurnsWithThinking.length > 0
            ? assistantTurnsWithThinking.reduce((sum, t) => sum + t.thinking_time_seconds, 0) /
              assistantTurnsWithThinking.length
            : 0,
        totalThinkingTime: assistantTurnsWithThinking.reduce(
          (sum, t) => sum + t.thinking_time_seconds,
          0
        ),
      };

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      console.error('Error getting conversation stats:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Process conversation through RAG pipeline
  app.post('/api/conversations/:conversationId/process-rag', async (req, res) => {
    try {
      const { conversationId } = req.params;
      const conversation = await conversationManager.getConversationWithTurns(conversationId);

      if (!conversation) {
        return res.status(404).json({
          success: false,
          error: 'Conversation not found',
        });
      }

      if (!clioService) {
        return res.status(503).json({
          success: false,
          error: 'RAG pipeline (Clio) service not available',
        });
      }

      // Convert conversation turns to format expected by RAG pipeline
      const ragData = conversation.turns.map((turn) => ({
        itemType: 'conversation_turn',
        role: turn.role,
        content: turn.content,
        timestamp: turn.created_at,
        metadata: {
          conversationId: conversation.id,
          turnIndex: turn.turn_index,
          model: turn.model_name,
          tokens: {
            prompt: turn.prompt_tokens,
            completion: turn.completion_tokens,
            total: turn.total_tokens,
          },
          timing: {
            duration: turn.request_duration_ms,
            timeToFirstToken: turn.time_to_first_token_ms,
          },
        },
      }));

      // Process through RAG pipeline
      const result = await clioService.processData(ragData, {
        sampleSize: 100000,
        strategies: ['global', 'workspace_specific'],
        privacyStrict: false,
      });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error processing conversation through RAG:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
}

module.exports = createConversationRoutes;
