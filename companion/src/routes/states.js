/**
 * State Management API Routes
 * Handles state operations: create, fork, merge, list, search
 */

function createStateRoutes(deps) {
  const { app, persistentDB } = deps;
  const StateManager = require('../services/state-manager.js');
  const NaturalLanguageParser = require('../services/natural-language-parser.js');
  const StateRecommender = require('../services/state-recommender.js');
  const EventAnnotationService = require('../services/event-annotation-service.js');

  const stateManager = new StateManager(persistentDB);
  const parser = new NaturalLanguageParser();
  const recommender = new StateRecommender(stateManager, persistentDB);
  const annotationService = new EventAnnotationService();

  /**
   * Parse natural language command
   */
  app.post('/api/states/parse-command', async (req, res) => {
    try {
      const { command } = req.body;

      if (!command) {
        return res.status(400).json({
          success: false,
          error: 'Command is required',
        });
      }

      const parsed = await parser.parseCommand(command);

      res.json({
        success: true,
        parsed,
      });
    } catch (error) {
      console.error('[STATES] Error parsing command:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Execute natural language command
   */
  app.post('/api/states/execute', async (req, res) => {
    try {
      const { command, context } = req.body;

      if (!command) {
        return res.status(400).json({
          success: false,
          error: 'Command is required',
        });
      }

      // Parse command
      const parsed = await parser.parseCommand(command);

      if (parsed.action === 'unknown') {
        return res.status(400).json({
          success: false,
          error: 'Could not understand command',
          parsed,
        });
      }

      // Execute based on action
      let result;
      switch (parsed.action) {
        case 'fork':
          result = await executeFork(parsed, context);
          break;
        case 'merge':
          result = await executeMerge(parsed, context);
          break;
        case 'switch':
          result = await executeSwitch(parsed, context);
          break;
        case 'search':
          result = await executeSearch(parsed, context);
          break;
        case 'list':
          result = await executeList(parsed, context);
          break;
        case 'create':
          result = await executeCreate(parsed, context);
          break;
        default:
          return res.status(400).json({
            success: false,
            error: `Action not implemented: ${parsed.action}`,
          });
      }

      res.json({
        success: true,
        action: parsed.action,
        result,
      });
    } catch (error) {
      console.error('[STATES] Error executing command:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Execute fork action
   */
  async function executeFork(parsed, context) {
    const sourceStateId = parsed.source || context.currentStateId;
    const name = parsed.name || `Fork: ${parsed.topic || parsed.intent || 'experiment'}`;
    const description =
      parsed.description || `Forked state for ${parsed.topic || parsed.intent || 'experiment'}`;

    // Generate state summary if we have events
    let stateSummary = description;
    if (context.events && context.events.length > 0) {
      stateSummary = await annotationService.generateStateSummary(
        context.events,
        context.fileChanges || []
      );
    }

    const forkedState = await stateManager.forkState(sourceStateId, name, stateSummary, {
      intent: parsed.intent || 'experiment',
      tags: parsed.topic ? [parsed.topic] : [],
      workspace_path: context.workspace_path,
    });

    // Log state fork event
    if (persistentDB) {
      const forkEvent = {
        id: `state-fork-${Date.now()}`,
        session_id: context.session_id || null,
        workspace_path: context.workspace_path,
        timestamp: new Date().toISOString(),
        type: 'state_fork',
        details: JSON.stringify({
          source_state_id: sourceStateId,
          forked_state_id: forkedState.id,
          forked_state_name: name,
          intent: parsed.intent || 'experiment',
          topic: parsed.topic,
        }),
        annotation: `Forked state "${name}" for ${parsed.topic || parsed.intent || 'experiment'}`,
        intent: parsed.intent || 'experiment',
        tags: parsed.topic ? [parsed.topic] : [],
        ai_generated: true,
      };
      await persistentDB.saveEvent(forkEvent);
    }

    return {
      state: forkedState,
      message: `Forked state "${name}" from ${sourceStateId ? 'source state' : 'current state'}`,
    };
  }

  /**
   * Execute merge action
   */
  async function executeMerge(parsed, context) {
    // Find source states by name
    const allStates = await stateManager.listStates({ workspace_path: context.workspace_path });

    const sourceStates = parsed.source
      ? allStates.filter((s) => s.name.toLowerCase().includes(parsed.source.toLowerCase()))
      : [context.currentStateId].filter(Boolean);

    const targetState = parsed.target
      ? allStates.find((s) => s.name.toLowerCase().includes(parsed.target.toLowerCase()))
      : allStates.find((s) => s.name === 'main' || s.name === 'master');

    if (!targetState) {
      throw new Error(`Target state not found: ${parsed.target || 'main'}`);
    }

    if (sourceStates.length === 0) {
      throw new Error(`Source state not found: ${parsed.source}`);
    }

    const mergePlan = await stateManager.mergeStates(
      sourceStates.map((s) => s.id),
      targetState.id,
      'smart'
    );

    // Log state merge event
    if (persistentDB) {
      const mergeEvent = {
        id: `state-merge-${Date.now()}`,
        session_id: context.session_id || null,
        workspace_path: context.workspace_path,
        timestamp: new Date().toISOString(),
        type: 'state_merge',
        details: JSON.stringify({
          source_state_ids: sourceStates.map((s) => s.id),
          source_state_names: sourceStates.map((s) => s.name),
          target_state_id: targetState.id,
          target_state_name: targetState.name,
          strategy: 'smart',
        }),
        annotation: `Merged ${sourceStates.length} state(s) into "${targetState.name}"`,
        intent: 'merge',
        tags: ['merge', 'state-management'],
        ai_generated: true,
      };
      await persistentDB.saveEvent(mergeEvent);
    }

    return {
      mergePlan,
      message: `Prepared merge of ${sourceStates.length} state(s) into "${targetState.name}"`,
    };
  }

  /**
   * Execute switch action
   */
  async function executeSwitch(parsed, context) {
    const allStates = await stateManager.listStates({ workspace_path: context.workspace_path });
    const targetState = parsed.target
      ? allStates.find((s) => s.name.toLowerCase().includes(parsed.target.toLowerCase()))
      : null;

    if (!targetState) {
      throw new Error(`State not found: ${parsed.target}`);
    }

    return {
      state: targetState,
      message: `Switched to state "${targetState.name}"`,
    };
  }

  /**
   * Execute search action
   */
  async function executeSearch(parsed, context) {
    const filters = {
      workspace_path: context.workspace_path,
    };

    if (parsed.filters?.type) {
      filters.intent = parsed.filters.type;
    }

    if (parsed.filters?.tags) {
      filters.tags = Array.isArray(parsed.filters.tags)
        ? parsed.filters.tags
        : [parsed.filters.tags];
    }

    // Use semantic search if query provided
    const searchQuery = parsed.filters?.topic || parsed.topic;
    const states = await stateManager.listStates(filters, searchQuery);

    return {
      states,
      count: states.length,
      message: `Found ${states.length} state(s) matching your search`,
    };
  }

  /**
   * Execute list action
   */
  async function executeList(parsed, context) {
    const filters = {};
    if (context.workspace_path) {
      filters.workspace_path = context.workspace_path;
    }

    const states = await stateManager.listStates(filters);

    return {
      states,
      count: states.length,
      message: `Found ${states.length} state(s)`,
    };
  }

  /**
   * Execute create action
   */
  async function executeCreate(parsed, context) {
    const name = parsed.name || `State: ${parsed.topic || parsed.intent || 'new'}`;
    const description =
      parsed.description || `State for ${parsed.topic || parsed.intent || 'development'}`;

    // Generate state summary if we have events
    let stateSummary = description;
    if (context.events && context.events.length > 0) {
      stateSummary = await annotationService.generateStateSummary(
        context.events,
        context.fileChanges || []
      );
    }

    const state = await stateManager.createState(name, stateSummary, {
      intent: parsed.intent || 'general',
      tags: parsed.topic ? [parsed.topic] : [],
      workspace_path: context.workspace_path,
    });

    // Create snapshot
    await stateManager.createSnapshot(state.id);

    return {
      state,
      message: `Created state "${name}"`,
    };
  }

  /**
   * Semantic search states
   */
  app.post('/api/states/search', async (req, res) => {
    try {
      const { query, workspace_path, filters } = req.body;

      const searchFilters = { ...filters };
      if (workspace_path) {
        searchFilters.workspace_path = workspace_path;
      }

      const states = await stateManager.listStates(searchFilters, query);

      res.json({
        success: true,
        states,
        count: states.length,
      });
    } catch (error) {
      console.error('[STATES] Error searching states:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get state recommendations
   */
  app.get('/api/states/recommendations', async (req, res) => {
    try {
      const workspace_path = req.query.workspace_path;

      // Get current events for similarity matching
      const recentEvents = await persistentDB.getRecentEvents(50);

      const recommendations = [];

      // Unfinished experiments
      const unfinished = await recommender.findUnfinishedExperiments(workspace_path);
      if (unfinished.length > 0) {
        recommendations.push({
          type: 'unfinished',
          message: `You have ${unfinished.length} unfinished experiment${unfinished.length !== 1 ? 's' : ''}. Want to merge any?`,
          states: unfinished,
          action: 'merge',
        });
      }

      // Similar states
      if (recentEvents && recentEvents.length > 0) {
        const similar = await recommender.findSimilarStates(recentEvents, workspace_path, 3);
        if (similar.length > 0) {
          recommendations.push({
            type: 'similar',
            message: `Found ${similar.length} similar state${similar.length !== 1 ? 's' : ''} to your current work`,
            states: similar,
            action: 'fork',
          });
        }
      }

      // Merge recommendations
      const mergeRecs = await recommender.getMergeRecommendations(workspace_path);
      mergeRecs.forEach((rec) => {
        recommendations.push({
          type: 'merge',
          message: recommender.generateRecommendationMessage(rec),
          states: rec.states,
          action: 'merge',
          confidence: rec.confidence,
        });
      });

      res.json({
        success: true,
        recommendations,
      });
    } catch (error) {
      console.error('[STATES] Error getting recommendations:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get state by ID
   */
  app.get('/api/states/:stateId', async (req, res) => {
    try {
      const { stateId } = req.params;
      const state = await stateManager.getState(stateId);

      if (!state) {
        return res.status(404).json({
          success: false,
          error: 'State not found',
        });
      }

      res.json({
        success: true,
        state,
      });
    } catch (error) {
      console.error('[STATES] Error getting state:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * List all states
   */
  app.get('/api/states', async (req, res) => {
    try {
      const { workspace_path, intent, tags, search } = req.query;

      const filters = {};
      // Only filter by workspace_path if it's not 'all'
      if (workspace_path && workspace_path !== 'all') {
        filters.workspace_path = workspace_path;
      }
      if (intent) filters.intent = intent;
      if (tags) filters.tags = tags.split(',');

      const states = await stateManager.listStates(filters, search || null);

      res.json({
        success: true,
        states,
        count: states.length,
      });
    } catch (error) {
      console.error('[STATES] Error listing states:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Create a new state
   */
  app.post('/api/states', async (req, res) => {
    try {
      const { name, description, metadata, events, fileChanges } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          error: 'State name is required',
        });
      }

      // Generate description if not provided and we have events
      let stateDescription = description;
      if (!stateDescription && events && events.length > 0) {
        stateDescription = await annotationService.generateStateSummary(events, fileChanges || []);
      }

      // Classify intent if we have events
      let intent = metadata?.intent || 'general';
      let tags = metadata?.tags || [];
      if (events && events.length > 0) {
        const classification = await annotationService.classifyIntent(events);
        intent = classification.intent;
        tags = classification.tags || [];
      }

      const state = await stateManager.createState(name, stateDescription || name, {
        ...metadata,
        intent,
        tags,
        workspace_path: metadata?.workspace_path,
      });

      // Create snapshot if workspace path is available
      if (state.workspace_path) {
        try {
          await stateManager.createSnapshot(state.id);
        } catch (snapshotError) {
          console.warn('[STATES] Could not create snapshot:', snapshotError.message);
        }
      }

      // Log state creation event
      try {
        const createEvent = {
          id: `state-create-${Date.now()}`,
          session_id: req.body.session_id || null,
          workspace_path: metadata?.workspace_path,
          timestamp: new Date().toISOString(),
          type: 'state_create',
          details: JSON.stringify({
            state_id: state.id,
            state_name: name,
            intent,
            tags,
          }),
          annotation: `Created state "${name}" for ${intent}`,
          intent,
          tags: Array.isArray(tags) ? tags : [],
          ai_generated: true,
        };
        await persistentDB.saveEvent(createEvent);
      } catch (eventError) {
        console.warn('[STATES] Could not log state creation event:', eventError.message);
      }

      res.json({
        success: true,
        state,
      });
    } catch (error) {
      console.error('[STATES] Error creating state:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Fork a state
   */
  app.post('/api/states/:stateId/fork', async (req, res) => {
    try {
      const { stateId } = req.params;
      const { name, description, metadata, events, fileChanges } = req.body;

      const newName = name || `Fork of ${stateId}`;

      // Generate description if we have events
      let stateDescription = description;
      if (!stateDescription && events && events.length > 0) {
        stateDescription = await annotationService.generateStateSummary(events, fileChanges || []);
      }

      const forkedState = await stateManager.forkState(
        stateId,
        newName,
        stateDescription || newName,
        metadata || {}
      );

      res.json({
        success: true,
        state: forkedState,
      });
    } catch (error) {
      console.error('[STATES] Error forking state:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get state diff
   */
  app.get('/api/states/:stateId1/diff/:stateId2', async (req, res) => {
    try {
      const { stateId1, stateId2 } = req.params;
      const diff = await stateManager.getStateDiff(stateId1, stateId2);

      res.json({
        success: true,
        diff,
      });
    } catch (error) {
      console.error('[STATES] Error getting state diff:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Auto-generate states from events
   */
  app.post('/api/states/auto-generate', async (req, res) => {
    try {
      let AutoStateGenerator;
      try {
        AutoStateGenerator = require('../services/auto-state-generator.js');
      } catch (requireError) {
        // Service file doesn't exist or can't be loaded
        console.warn('[STATES] Auto-state-generator service not available:', requireError.message);
        return res.status(501).json({
          success: false,
          error: 'Auto-state generation service not available',
          details: requireError.message,
        });
      }

      const generator = new AutoStateGenerator(stateManager, persistentDB);

      let { workspace_path } = req.body;
      // Treat 'all' as null to generate states for all workspaces
      if (workspace_path === 'all') {
        workspace_path = null;
      }
      const options = req.body.options || {};

      const states = await generator.generateStatesFromEvents(workspace_path, options);

      res.json({
        success: true,
        states,
        count: states.length,
      });
    } catch (error) {
      console.error('[STATES] Error auto-generating states:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      });
    }
  });
}

module.exports = createStateRoutes;
