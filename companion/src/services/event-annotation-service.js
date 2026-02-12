/**
 * Event Annotation Service
 * Uses OpenRouter API to generate meaningful descriptions for events
 */

// Use dynamic import for node-fetch v3 (ESM)
let fetchModule;
const fetchPromise = import('node-fetch').then((mod) => {
  fetchModule = mod.default;
});

class EventAnnotationService {
  constructor() {
    this.apiBase = process.env.API_BASE || 'http://localhost:43917';
    this.openRouterKey = process.env.OPENROUTER_API_KEY || '';
    this.openRouterEndpoint = 'https://openrouter.ai/api/v1';
    this.chatModel = process.env.OPENROUTER_CHAT_MODEL || 'microsoft/phi-3-mini-128k-instruct:free';
    this.cache = new Map(); // Cache annotations to avoid regenerating
    this.batchQueue = []; // Queue for batch processing
    this.batchTimeout = null;
  }

  /**
   * Annotate a single event
   */
  async annotateEvent(event, context = {}) {
    // Check cache first
    const cacheKey = this.getCacheKey(event);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    if (!this.openRouterKey) {
      return this.generateFallbackAnnotation(event);
    }

    try {
      await fetchPromise;

      const prompt = this.buildAnnotationPrompt(event, context);

      const response = await fetchModule(`${this.openRouterEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a code analysis assistant. Generate concise, meaningful descriptions of development events. Be specific and technical. Use present tense. Maximum 15 words.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3, // Lower temperature for more consistent annotations
          max_tokens: 50,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const annotation = data.choices[0].message.content.trim();

        // Cache result
        this.cache.set(cacheKey, annotation);
        return annotation;
      } else {
        console.warn(`[ANNOTATION] OpenRouter API error: ${response.status}`);
        return this.generateFallbackAnnotation(event);
      }
    } catch (error) {
      console.warn(`[ANNOTATION] Error generating annotation:`, error.message);
      return this.generateFallbackAnnotation(event);
    }
  }

  /**
   * Build prompt for event annotation
   */
  buildAnnotationPrompt(event, context) {
    const parts = [];

    // Event type
    parts.push(`Event type: ${event.type || 'unknown'}`);

    // File information
    if (event.file_path || event.details?.file_path) {
      const filePath = event.file_path || event.details?.file_path;
      parts.push(`File: ${filePath}`);

      // File extension for context
      const ext = filePath.split('.').pop();
      if (ext) parts.push(`File type: ${ext}`);
    }

    // Code changes
    if (
      event.before_code ||
      event.after_code ||
      event.details?.before_code ||
      event.details?.after_code
    ) {
      const before = event.before_code || event.details?.before_code || '';
      const after = event.after_code || event.details?.after_code || '';

      if (before && after) {
        // Show snippet of what changed
        const beforeLines = before.split('\n').slice(0, 5).join('\n');
        const afterLines = after.split('\n').slice(0, 5).join('\n');
        parts.push(`Before:\n${beforeLines}\n\nAfter:\n${afterLines}`);
      } else if (after && !before) {
        parts.push(`Added code:\n${after.split('\n').slice(0, 10).join('\n')}`);
      } else if (before && !after) {
        parts.push(`Removed code:\n${before.split('\n').slice(0, 10).join('\n')}`);
      }
    }

    // Source/context
    if (event.source) {
      parts.push(`Source: ${event.source}`);
    }

    // Notes if available
    if (event.notes) {
      parts.push(`Notes: ${event.notes}`);
    }

    // Context from surrounding events
    if (context.recentEvents && context.recentEvents.length > 0) {
      const recentTypes = context.recentEvents.map((e) => e.type).join(', ');
      parts.push(`Recent context: ${recentTypes}`);
    }

    return `Analyze this development event and generate a concise description:\n\n${parts.join('\n\n')}\n\nDescription:`;
  }

  /**
   * Generate fallback annotation when AI is unavailable
   */
  generateFallbackAnnotation(event) {
    const type = event.type || 'unknown';
    const filePath = event.file_path || event.details?.file_path;

    if (filePath) {
      const fileName = filePath.split('/').pop();
      return `${this.formatEventType(type)} in ${fileName}`;
    }

    return this.formatEventType(type);
  }

  /**
   * Format event type for display
   */
  formatEventType(type) {
    const typeMap = {
      file_change: 'File changed',
      code_change: 'Code modified',
      entry_created: 'Entry created',
      session_start: 'Session started',
      session_end: 'Session ended',
      prompt: 'AI prompt',
      response: 'AI response',
    };

    return typeMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }

  /**
   * Get cache key for event
   */
  getCacheKey(event) {
    const key = `${event.type || 'unknown'}_${event.file_path || ''}_${event.timestamp || ''}`;
    // Simple hash
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  /**
   * Batch annotate multiple events (more efficient)
   */
  async annotateEventsBatch(events, context = {}) {
    if (!this.openRouterKey || events.length === 0) {
      return events.map((e) => ({ ...e, annotation: this.generateFallbackAnnotation(e) }));
    }

    try {
      await fetchPromise;

      // Build batch prompt
      const eventSummaries = events
        .map((e, i) => {
          const filePath = e.file_path || e.details?.file_path || 'unknown';
          const type = e.type || 'unknown';
          return `${i + 1}. ${type} in ${filePath.split('/').pop()}`;
        })
        .join('\n');

      const prompt = `Analyze these ${events.length} development events and generate concise descriptions (max 15 words each):

${eventSummaries}

Respond with JSON array of descriptions in order:
["description1", "description2", ...]`;

      const response = await fetchModule(`${this.openRouterEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a code analysis assistant. Generate concise descriptions of development events. Respond with JSON array only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 200,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content.trim();

        // Try to parse JSON array
        try {
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const annotations = JSON.parse(jsonMatch[0]);
            return events.map((e, i) => ({
              ...e,
              annotation: annotations[i] || this.generateFallbackAnnotation(e),
            }));
          }
        } catch (parseError) {
          console.warn('[ANNOTATION] Failed to parse batch annotations, using fallback');
        }
      }
    } catch (error) {
      console.warn(`[ANNOTATION] Batch annotation error:`, error.message);
    }

    // Fallback to individual annotations
    return Promise.all(
      events.map((e) => this.annotateEvent(e, context).then((annotation) => ({ ...e, annotation })))
    );
  }

  /**
   * Classify intent of a development session/activity
   */
  async classifyIntent(events, context = {}) {
    if (!this.openRouterKey || events.length === 0) {
      return { intent: 'general', confidence: 0.5, tags: [] };
    }

    try {
      await fetchPromise;

      // Summarize events for intent classification
      const eventSummary = events
        .slice(0, 10)
        .map((e) => {
          const filePath = e.file_path || e.details?.file_path || 'unknown';
          const type = e.type || 'unknown';
          return `- ${type} in ${filePath.split('/').pop()}`;
        })
        .join('\n');

      const prompt = `Analyze this development activity and classify the intent:

Events:
${eventSummary}

Classify as one of: feature, bug-fix, refactor, experiment, optimization, documentation, test, config, other

Respond with JSON:
{
  "intent": "feature|bug-fix|refactor|experiment|optimization|documentation|test|config|other",
  "confidence": 0.0-1.0,
  "tags": ["tag1", "tag2"],
  "summary": "brief description"
}`;

      const response = await fetchModule(`${this.openRouterEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a code analysis assistant. Classify development intent accurately. Respond with valid JSON only.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.4,
          max_tokens: 150,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0].message.content.trim();

        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
          }
        } catch (parseError) {
          console.warn('[ANNOTATION] Failed to parse intent classification');
        }
      }
    } catch (error) {
      console.warn(`[ANNOTATION] Intent classification error:`, error.message);
    }

    // Fallback
    return {
      intent: 'general',
      confidence: 0.5,
      tags: [],
      summary: 'General development activity',
    };
  }

  /**
   * Generate state summary (for future state management)
   */
  async generateStateSummary(events, fileChanges = []) {
    if (!this.openRouterKey || events.length === 0) {
      return 'Development session';
    }

    try {
      await fetchPromise;

      // Build summary of changes
      const fileSummary = fileChanges
        .slice(0, 10)
        .map((f) => {
          return `- ${f.file_path || f.path || 'unknown'}`;
        })
        .join('\n');

      const eventSummary = events
        .slice(0, 10)
        .map((e) => {
          const type = e.type || 'unknown';
          return `- ${type}`;
        })
        .join('\n');

      const prompt = `Summarize this development state/session:

Files changed:
${fileSummary}

Events:
${eventSummary}

Generate a concise summary (max 20 words) describing what was accomplished.`;

      const response = await fetchModule(`${this.openRouterEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages: [
            {
              role: 'system',
              content:
                'You are a code analysis assistant. Generate concise, meaningful summaries of development work.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.5,
          max_tokens: 100,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices[0].message.content.trim();
      }
    } catch (error) {
      console.warn(`[ANNOTATION] State summary error:`, error.message);
    }

    return 'Development session';
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = EventAnnotationService;
