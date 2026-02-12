/**
 * TODO tracking API routes
 */

function createTodosRoutes(deps) {
  const { app, persistentDB, broadcastUpdate } = deps;

  // Track currently active TODO (module-level state)
  let currentActiveTodo = null;

  app.get('/api/todos', async (req, res) => {
    try {
      const todos = await persistentDB.getCurrentSessionTodos();

      for (const todo of todos) {
        const events = await persistentDB.getTodoEvents(todo.id);
        todo.eventCount = events.length;
        todo.promptCount = events.filter((e) => e.event_type === 'prompt').length;
        todo.fileChangeCount = events.filter((e) => e.event_type === 'file_change').length;

        if (todo.completedAt && todo.startedAt) {
          todo.duration = todo.completedAt - todo.startedAt;
        } else if (todo.startedAt) {
          todo.duration = Date.now() - todo.startedAt;
        }
      }

      res.json({
        success: true,
        todos: todos,
        activeTodoId: currentActiveTodo,
      });
    } catch (error) {
      console.error('Error fetching todos:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/todos/:id/events', async (req, res) => {
    try {
      const todoId = parseInt(req.params.id);
      const events = await persistentDB.getTodoEvents(todoId);

      const enrichedEvents = [];
      for (const event of events) {
        let enrichedEvent = {
          eventType: event.event_type,
          timestamp: event.timestamp,
        };

        if (event.event_type === 'prompt') {
          const prompt = await persistentDB.getPromptById(event.event_id);
          if (prompt) {
            enrichedEvent.details = prompt.text || prompt.preview || 'N/A';
            enrichedEvent.data = prompt;
          } else {
            enrichedEvent.details = 'Prompt not found';
          }
        } else if (event.event_type === 'file_change') {
          const entry = await persistentDB.getRecentEntries(1, event.event_id);
          if (entry && entry.length > 0) {
            const fileEntry = entry[0];
            enrichedEvent.details = `File: ${fileEntry.filePath || fileEntry.file_path || 'unknown'}`;
            enrichedEvent.data = fileEntry;
          } else {
            enrichedEvent.details = 'File change details not available';
          }
        } else {
          enrichedEvent.details = 'Unknown event type';
        }

        enrichedEvents.push(enrichedEvent);
      }

      res.json({
        success: true,
        events: enrichedEvents,
      });
    } catch (error) {
      console.error('Error fetching todo events:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/todos/:id/status', async (req, res) => {
    try {
      const todoId = parseInt(req.params.id);
      const { status } = req.body;

      await persistentDB.updateTodoStatus(todoId, status);

      if (status === 'in_progress') {
        currentActiveTodo = todoId;
        console.log(`[TODO] Set active TODO to ${todoId}`);
      } else if (status === 'completed' && currentActiveTodo === todoId) {
        currentActiveTodo = null;
        console.log(`[TODO] Completed TODO ${todoId}, cleared active TODO`);
      }

      broadcastUpdate('todos', {
        todos: await persistentDB.getCurrentSessionTodos(),
        activeTodoId: currentActiveTodo,
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating todo status:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/todos', async (req, res) => {
    try {
      const { todos, merge } = req.body;

      if (!todos || !Array.isArray(todos)) {
        return res.status(400).json({ success: false, error: 'todos array required' });
      }

      const savedTodos = [];

      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];

        if (merge && todo.id) {
          if (todo.status) {
            await persistentDB.updateTodoStatus(todo.id, todo.status);

            if (todo.status === 'in_progress') {
              currentActiveTodo = todo.id;
            } else if (todo.status === 'completed' && currentActiveTodo === todo.id) {
              currentActiveTodo = null;
            }
          }
        } else {
          const todoId = await persistentDB.saveTodo({
            content: todo.content,
            status: todo.status || 'pending',
            order_index: i,
            created_at: Date.now(),
          });

          savedTodos.push(todoId);

          if (todo.status === 'in_progress' && !currentActiveTodo) {
            currentActiveTodo = todoId;
            console.log(`[TODO] Set active TODO to ${todoId}`);
          }
        }
      }

      console.log(`[TODO] Created ${savedTodos.length} new TODOs`);

      broadcastUpdate('todos', {
        todos: await persistentDB.getCurrentSessionTodos(),
        activeTodoId: currentActiveTodo,
      });

      res.json({
        success: true,
        created: savedTodos.length,
        todoIds: savedTodos,
      });
    } catch (error) {
      console.error('Error creating todos:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Expose currentActiveTodo for external access if needed
  return {
    getCurrentActiveTodo: () => currentActiveTodo,
    setCurrentActiveTodo: (id) => {
      currentActiveTodo = id;
    },
  };
}

module.exports = createTodosRoutes;
