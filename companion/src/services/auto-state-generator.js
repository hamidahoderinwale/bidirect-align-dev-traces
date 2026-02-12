/**
 * Auto State Generator Service
 * Automatically generates development states from telemetry events
 * Detects state boundaries based on:
 * - Intent changes
 * - Time gaps (inactivity)
 * - Topic/file changes
 * - Workspace changes
 */

const EventAnnotationService = require('./event-annotation-service.js');

class AutoStateGenerator {
  constructor(stateManager, persistentDB) {
    this.stateManager = stateManager;
    this.db = persistentDB;
    this.annotationService = new EventAnnotationService();

    // Configuration
    this.config = {
      minEventsPerState: 3, // Minimum events to create a state
      maxTimeGapMinutes: 30, // Max gap before creating new state
      intentChangeThreshold: 0.7, // Confidence threshold for intent change
      autoGenerate: true, // Enable auto-generation
    };
  }

  /**
   * Generate states from events
   */
  async generateStatesFromEvents(workspacePath = null, options = {}) {
    const config = { ...this.config, ...options };

    // Get all events for workspace
    const events = await this.getEventsForWorkspace(workspacePath);

    if (events.length < config.minEventsPerState) {
      console.log('[AUTO-STATE] Not enough events to generate states');
      return [];
    }

    // Group events into potential states
    const stateGroups = this.detectStateBoundaries(events, config);

    // Create states from groups
    const createdStates = [];
    for (const group of stateGroups) {
      if (group.events.length >= config.minEventsPerState) {
        try {
          const state = await this.createStateFromEvents(group, workspacePath);
          if (state) {
            createdStates.push(state);
          }
        } catch (error) {
          console.error('[AUTO-STATE] Error creating state from group:', error.message);
        }
      }
    }

    console.log(
      `[AUTO-STATE] Generated ${createdStates.length} states from ${events.length} events`
    );
    return createdStates;
  }

  /**
   * Get events for workspace
   */
  async getEventsForWorkspace(workspacePath) {
    return new Promise((resolve, reject) => {
      let query = 'SELECT * FROM events WHERE 1=1';
      const params = [];

      if (workspacePath) {
        query += ' AND workspace_path = ?';
        params.push(workspacePath);
      }

      query += ' ORDER BY timestamp ASC';

      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const events = rows.map((row) => ({
            ...row,
            details: row.details ? JSON.parse(row.details) : {},
            tags: row.tags ? JSON.parse(row.tags || '[]') : [],
            ai_generated: row.ai_generated === 1,
          }));
          resolve(events);
        }
      });
    });
  }

  /**
   * Detect state boundaries in events
   */
  detectStateBoundaries(events, config) {
    if (events.length === 0) return [];

    const groups = [];
    let currentGroup = {
      events: [],
      startTime: null,
      endTime: null,
      intent: null,
      topics: new Set(),
      files: new Set(),
    };

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const prevEvent = i > 0 ? events[i - 1] : null;

      // Parse event timestamp
      const eventTime = new Date(event.timestamp);
      const prevTime = prevEvent ? new Date(prevEvent.timestamp) : null;

      // Calculate time gap
      const timeGapMinutes = prevTime ? (eventTime - prevTime) / (1000 * 60) : 0;

      // Get event intent
      const eventIntent = event.intent || this.inferIntentFromEvent(event);

      // Get event topic/files
      const eventFiles = this.extractFilesFromEvent(event);
      const eventTopic = this.extractTopicFromEvent(event);

      // Check for state boundary
      const isBoundary = this.isStateBoundary(event, prevEvent, currentGroup, {
        timeGapMinutes,
        eventIntent,
        eventFiles,
        eventTopic,
        config,
      });

      if (isBoundary && currentGroup.events.length >= config.minEventsPerState) {
        // Finalize current group
        currentGroup.endTime = prevEvent ? new Date(prevEvent.timestamp) : eventTime;
        groups.push({ ...currentGroup });

        // Start new group
        currentGroup = {
          events: [event],
          startTime: eventTime,
          endTime: null,
          intent: eventIntent,
          topics: new Set(eventTopic ? [eventTopic] : []),
          files: new Set(eventFiles),
        };
      } else {
        // Add to current group
        if (currentGroup.events.length === 0) {
          currentGroup.startTime = eventTime;
        }
        currentGroup.events.push(event);
        currentGroup.endTime = eventTime;

        // Update group metadata
        if (eventIntent) {
          currentGroup.intent = this.mergeIntent(currentGroup.intent, eventIntent);
        }
        if (eventTopic) {
          currentGroup.topics.add(eventTopic);
        }
        eventFiles.forEach((f) => currentGroup.files.add(f));
      }
    }

    // Add final group
    if (currentGroup.events.length >= config.minEventsPerState) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Check if event represents a state boundary
   */
  isStateBoundary(event, prevEvent, currentGroup, context) {
    const { timeGapMinutes, eventIntent, eventFiles, eventTopic, config } = context;

    // Large time gap
    if (timeGapMinutes > config.maxTimeGapMinutes) {
      return true;
    }

    // Intent change
    if (currentGroup.intent && eventIntent && currentGroup.intent !== eventIntent) {
      return true;
    }

    // Significant topic change (different file areas)
    if (currentGroup.files.size > 0 && eventFiles.length > 0) {
      const overlap = eventFiles.filter((f) => currentGroup.files.has(f)).length;
      const overlapRatio = overlap / Math.max(currentGroup.files.size, eventFiles.length);

      // If less than 30% file overlap, likely new state
      if (overlapRatio < 0.3 && currentGroup.events.length >= config.minEventsPerState) {
        return true;
      }
    }

    // Workspace change
    if (prevEvent && event.workspace_path !== prevEvent.workspace_path) {
      return true;
    }

    return false;
  }

  /**
   * Create state from event group
   */
  async createStateFromEvents(group, workspacePath) {
    if (group.events.length === 0) return null;

    // Generate state name
    const name = this.generateStateName(group);

    // Generate state description
    const description = await this.generateStateDescription(group);

    // Determine intent
    const intent = group.intent || this.inferIntentFromEvents(group.events);

    // Extract tags
    const tags = this.extractTagsFromEvents(group.events);

    // Get workspace from events
    const wsPath = workspacePath || group.events[0]?.workspace_path || null;

    // Check if state already exists (avoid duplicates)
    const existingStates = await this.stateManager.listStates({ workspace_path: wsPath });
    const similarState = existingStates.find(
      (s) =>
        s.name === name ||
        (s.description &&
          description &&
          s.description.substring(0, 50) === description.substring(0, 50))
    );

    if (similarState) {
      console.log(`[AUTO-STATE] Similar state already exists: ${similarState.name}`);
      return similarState;
    }

    // Create state
    const state = await this.stateManager.createState(name, description, {
      workspace_path: wsPath,
      intent,
      tags: Array.from(tags),
      auto_generated: true,
      event_count: group.events.length,
      start_time: group.startTime?.toISOString(),
      end_time: group.endTime?.toISOString(),
    });

    // Link events to state (store in metadata or create event-state relationship)
    // For now, we'll store event IDs in state metadata
    const eventIds = group.events.map((e) => e.id);
    state.metadata.event_ids = eventIds;
    await this.stateManager.saveState(state);

    console.log(`[AUTO-STATE] Created state: ${name} (${group.events.length} events)`);
    return state;
  }

  /**
   * Generate state name from event group
   */
  generateStateName(group) {
    const intent = group.intent || 'general';
    const topics = Array.from(group.topics).slice(0, 2);

    if (topics.length > 0) {
      const topicStr = topics.join(' & ');
      return `${intent}: ${topicStr}`;
    }

    // Use file patterns
    if (group.files.size > 0) {
      const fileNames = Array.from(group.files)
        .map((f) => {
          const parts = f.split('/');
          return parts[parts.length - 1];
        })
        .slice(0, 2);

      if (fileNames.length > 0) {
        return `${intent}: ${fileNames.join(', ')}`;
      }
    }

    // Fallback to intent + timestamp
    const date = group.startTime
      ? new Date(group.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Session';

    return `${intent}: ${date}`;
  }

  /**
   * Generate state description using AI
   */
  async generateStateDescription(group) {
    if (!process.env.OPENROUTER_API_KEY) {
      return this.generateFallbackDescription(group);
    }

    try {
      const eventSummaries = group.events
        .slice(0, 10) // Limit to recent events
        .map((e) => {
          if (e.annotation) return e.annotation;
          if (e.details?.file_path) return `Modified ${e.details.file_path}`;
          return `${e.type} event`;
        })
        .join(', ');

      const prompt = `Summarize this development session in one sentence (max 20 words):
Events: ${eventSummaries}
Intent: ${group.intent || 'general'}
Topics: ${Array.from(group.topics).join(', ') || 'various'}`;

      const fetchModule = (await import('node-fetch')).default;
      const response = await fetchModule('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_CHAT_MODEL || 'microsoft/phi-3-mini-128k-instruct:free',
          messages: [
            {
              role: 'system',
              content:
                'You are a development activity summarizer. Generate concise, technical summaries.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 50,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices[0].message.content.trim();
      }
    } catch (error) {
      console.warn('[AUTO-STATE] Error generating description:', error.message);
    }

    return this.generateFallbackDescription(group);
  }

  /**
   * Generate fallback description
   */
  generateFallbackDescription(group) {
    const intent = group.intent || 'general';
    const eventCount = group.events.length;
    const topics = Array.from(group.topics).slice(0, 3);

    let desc = `${eventCount} ${eventCount === 1 ? 'event' : 'events'} related to ${intent}`;

    if (topics.length > 0) {
      desc += `: ${topics.join(', ')}`;
    }

    return desc;
  }

  /**
   * Infer intent from event
   */
  inferIntentFromEvent(event) {
    // Use existing intent if available
    if (event.intent) return event.intent;

    // Infer from annotation
    if (event.annotation) {
      const annotation = event.annotation.toLowerCase();
      if (
        annotation.includes('fix') ||
        annotation.includes('bug') ||
        annotation.includes('error')
      ) {
        return 'bug-fix';
      }
      if (
        annotation.includes('add') ||
        annotation.includes('feature') ||
        annotation.includes('implement')
      ) {
        return 'feature';
      }
      if (annotation.includes('refactor') || annotation.includes('clean')) {
        return 'refactor';
      }
      if (annotation.includes('optimiz') || annotation.includes('performance')) {
        return 'optimization';
      }
    }

    // Infer from file path
    if (event.details?.file_path) {
      const filePath = event.details.file_path.toLowerCase();
      if (filePath.includes('test') || filePath.includes('spec')) {
        return 'testing';
      }
    }

    return 'general';
  }

  /**
   * Infer intent from multiple events
   */
  inferIntentFromEvents(events) {
    const intents = events.map((e) => this.inferIntentFromEvent(e)).filter((i) => i !== 'general');

    if (intents.length === 0) return 'general';

    // Return most common intent
    const counts = {};
    intents.forEach((i) => {
      counts[i] = (counts[i] || 0) + 1;
    });

    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * Merge intents (prefer more specific)
   */
  mergeIntent(currentIntent, newIntent) {
    if (!currentIntent) return newIntent;
    if (!newIntent) return currentIntent;
    if (currentIntent === newIntent) return currentIntent;

    // Prefer more specific intents
    const specificity = {
      general: 0,
      testing: 1,
      optimization: 2,
      refactor: 3,
      'bug-fix': 4,
      feature: 4,
      experiment: 5,
    };

    return (specificity[newIntent] || 0) > (specificity[currentIntent] || 0)
      ? newIntent
      : currentIntent;
  }

  /**
   * Extract files from event
   */
  extractFilesFromEvent(event) {
    const files = [];

    if (event.file_path) {
      files.push(event.file_path);
    }

    if (event.details?.file_path) {
      files.push(event.details.file_path);
    }

    // Extract from annotation
    if (event.annotation) {
      const fileMatch = event.annotation.match(
        /[\w\/\-\.]+\.(js|ts|jsx|tsx|py|java|go|rs|cpp|c|h|json|yaml|yml)/
      );
      if (fileMatch) {
        files.push(fileMatch[0]);
      }
    }

    return files;
  }

  /**
   * Extract topic from event
   */
  extractTopicFromEvent(event) {
    // Use tags if available
    if (event.tags && event.tags.length > 0) {
      return event.tags[0];
    }

    // Extract from annotation
    if (event.annotation) {
      // Look for common topics
      const annotation = event.annotation.toLowerCase();
      const topics = [
        'auth',
        'api',
        'database',
        'ui',
        'test',
        'config',
        'middleware',
        'route',
        'component',
      ];
      for (const topic of topics) {
        if (annotation.includes(topic)) {
          return topic;
        }
      }
    }

    // Extract from file path
    if (event.details?.file_path) {
      const path = event.details.file_path.toLowerCase();
      if (path.includes('auth')) return 'authentication';
      if (path.includes('api')) return 'api';
      if (path.includes('db') || path.includes('database')) return 'database';
      if (path.includes('test')) return 'testing';
      if (path.includes('component') || path.includes('ui')) return 'ui';
    }

    return null;
  }

  /**
   * Extract tags from events
   */
  extractTagsFromEvents(events) {
    const tags = new Set();

    events.forEach((event) => {
      if (event.tags && Array.isArray(event.tags)) {
        event.tags.forEach((tag) => tags.add(tag));
      }

      const topic = this.extractTopicFromEvent(event);
      if (topic) {
        tags.add(topic);
      }
    });

    return tags;
  }
}

module.exports = AutoStateGenerator;
