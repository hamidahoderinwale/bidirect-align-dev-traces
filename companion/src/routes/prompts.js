/**
 * Prompt API routes
 */

function createPromptRoutes(deps) {
  const { app, db, persistentDB, getCurrentWorkspace, getCurrentActiveTodo } = deps;

  // Manual prompt logging endpoint
  app.post('/api/prompts/manual', async (req, res) => {
    try {
      const { text, conversationTitle, conversationId, messageRole, hasAttachments, attachments } =
        req.body;

      if (!text) {
        return res.status(400).json({ success: false, error: 'Prompt text is required' });
      }

      const prompt = {
        id: db.nextId++,
        text: text,
        timestamp: Date.now(),
        source: 'manual',
        type: messageRole ? 'message' : 'standalone-prompt',
        conversationTitle: conversationTitle || null,
        parentConversationId: conversationId || null,
        messageRole: messageRole || 'user',
        hasAttachments: hasAttachments || attachments?.length > 0 || false,
        attachmentCount: attachments?.length || 0,
        status: 'captured',
        confidence: 'high',
        workspacePath: getCurrentWorkspace ? getCurrentWorkspace() : null,
      };

      // Save to in-memory
      db.prompts.push(prompt);

      // Save to database
      await persistentDB.savePrompt(prompt);

      // Link to active TODO
      const currentActiveTodo = getCurrentActiveTodo ? getCurrentActiveTodo() : null;
      if (currentActiveTodo) {
        await persistentDB.addPromptToTodo(currentActiveTodo, prompt.id);
        await persistentDB.linkEventToTodo('prompt', prompt.id);
      }

      console.log(`[MANUAL] Captured prompt: "${text.substring(0, 60)}..."`);

      res.json({
        success: true,
        promptId: prompt.id,
        message: 'Prompt captured successfully',
      });
    } catch (error) {
      console.error('Error capturing manual prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createPromptRoutes;
