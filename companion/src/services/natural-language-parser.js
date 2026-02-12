/**
 * Natural Language Command Parser
 * Parses natural language commands into structured actions
 * Uses OpenRouter API for better understanding
 */

// Use dynamic import for node-fetch v3 (ESM)
let fetchModule;
const fetchPromise = import('node-fetch').then((mod) => {
  fetchModule = mod.default;
});

class NaturalLanguageParser {
  constructor() {
    this.openRouterKey = process.env.OPENROUTER_API_KEY || '';
    this.openRouterEndpoint = 'https://openrouter.ai/api/v1';
    this.chatModel = process.env.OPENROUTER_CHAT_MODEL || 'microsoft/phi-3-mini-128k-instruct:free';
  }

  /**
   * Parse a natural language command
   */
  async parseCommand(command) {
    if (!command || !command.trim()) {
      return { action: 'unknown', error: 'Empty command' };
    }

    // Try AI parsing first if available
    if (this.openRouterKey) {
      try {
        const aiParsed = await this.parseWithAI(command);
        if (aiParsed && aiParsed.action !== 'unknown') {
          return aiParsed;
        }
      } catch (error) {
        console.warn('[NLP] AI parsing failed, using rule-based:', error.message);
      }
    }

    // Fallback to rule-based parsing
    return this.parseWithRules(command);
  }

  /**
   * Parse command using AI
   */
  async parseWithAI(command) {
    await fetchPromise;

    const prompt = `Parse this natural language command about development state management:

Command: "${command}"

Possible actions:
- fork: Create a new state from current or another state
- merge: Combine states together
- switch: Change to a different state
- search: Find states matching criteria
- list: Show all states
- create: Create a new state
- delete: Remove a state
- show: Display state details

Respond with JSON only:
{
  "action": "fork|merge|switch|search|list|create|delete|show",
  "intent": "experiment|feature|bug-fix|refactor|optimization|general",
  "topic": "extracted topic or null",
  "source": "source state name/id or null",
  "target": "target state name/id or null",
  "filters": {
    "type": "bug-fix|feature|etc",
    "topic": "topic to search for"
  },
  "name": "state name if creating",
  "description": "description if creating"
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
              'You are a command parser for a development state management system. Parse natural language commands into structured JSON. Always respond with valid JSON only.',
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

      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.warn('[NLP] Failed to parse AI response:', parseError.message);
      }
    }

    return { action: 'unknown' };
  }

  /**
   * Rule-based command parsing (fallback)
   */
  parseWithRules(command) {
    const cmd = command.toLowerCase().trim();
    const result = {
      action: 'unknown',
      intent: null,
      topic: null,
      source: null,
      target: null,
      filters: {},
      name: null,
      description: null,
    };

    // Fork commands
    if (
      cmd.includes('fork') ||
      (cmd.includes('create') && (cmd.includes('from') || cmd.includes('based')))
    ) {
      result.action = 'fork';

      // Extract intent
      if (cmd.includes('experiment') || cmd.includes('try') || cmd.includes('test')) {
        result.intent = 'experiment';
      } else if (cmd.includes('feature')) {
        result.intent = 'feature';
      } else if (cmd.includes('bug') || cmd.includes('fix')) {
        result.intent = 'bug-fix';
      } else if (cmd.includes('refactor')) {
        result.intent = 'refactor';
      } else if (cmd.includes('optimiz')) {
        result.intent = 'optimization';
      }

      // Extract topic (words after "for" or "trying")
      const forMatch = cmd.match(/(?:for|trying|about)\s+(.+?)(?:\s+approach|\s+method|\s+way|$)/);
      if (forMatch) {
        result.topic = forMatch[1].trim();
      }

      // Extract source state
      const fromMatch = cmd.match(/(?:from|based on)\s+([^\s]+(?:\s+[^\s]+)?)/);
      if (fromMatch) {
        result.source = fromMatch[1].trim();
      }
    }
    // Merge commands
    else if (cmd.includes('merge') || cmd.includes('combine')) {
      result.action = 'merge';

      // Extract source and target
      const intoMatch = cmd.match(/(.+?)\s+into\s+(.+)/);
      if (intoMatch) {
        result.source = intoMatch[1].trim();
        result.target = intoMatch[2].trim();
      } else {
        // Try "merge X and Y"
        const andMatch = cmd.match(/merge\s+(.+?)\s+and\s+(.+)/);
        if (andMatch) {
          result.source = andMatch[1].trim();
          result.target = andMatch[2].trim();
        }
      }
    }
    // Switch commands
    else if (
      cmd.includes('switch') ||
      cmd.includes('change to') ||
      cmd.includes('go to') ||
      cmd.includes('use')
    ) {
      result.action = 'switch';

      const toMatch = cmd.match(/(?:to|state)\s+(.+)/);
      if (toMatch) {
        result.target = toMatch[1].trim();
      }
    }
    // Search commands
    else if (
      cmd.includes('show') ||
      cmd.includes('find') ||
      cmd.includes('search') ||
      cmd.includes('where')
    ) {
      result.action = 'search';

      // Extract filters
      if (cmd.includes('bug') || cmd.includes('fix')) {
        result.filters.type = 'bug-fix';
      } else if (cmd.includes('feature')) {
        result.filters.type = 'feature';
      } else if (cmd.includes('experiment')) {
        result.filters.type = 'experiment';
      } else if (cmd.includes('refactor')) {
        result.filters.type = 'refactor';
      } else if (cmd.includes('optimiz')) {
        result.filters.type = 'optimization';
      }

      // Extract topic
      const workingMatch = cmd.match(/(?:working on|about|for)\s+(.+?)(?:\s+bug|\s+feature|$)/);
      if (workingMatch) {
        result.filters.topic = workingMatch[1].trim();
      }
    }
    // List commands
    else if (cmd.includes('list') || cmd.includes('show all') || cmd.includes('all states')) {
      result.action = 'list';
    }
    // Create commands
    else if (cmd.startsWith('create') || cmd.startsWith('new state')) {
      result.action = 'create';

      const nameMatch = cmd.match(/(?:called|named)\s+(.+?)(?:\s+for|\s+with|$)/);
      if (nameMatch) {
        result.name = nameMatch[1].trim();
      }
    }

    return result;
  }

  /**
   * Extract intent from command
   */
  extractIntent(command) {
    const cmd = command.toLowerCase();

    if (cmd.includes('experiment') || cmd.includes('try') || cmd.includes('test')) {
      return 'experiment';
    } else if (cmd.includes('feature') || cmd.includes('add') || cmd.includes('new')) {
      return 'feature';
    } else if (cmd.includes('bug') || cmd.includes('fix') || cmd.includes('repair')) {
      return 'bug-fix';
    } else if (cmd.includes('refactor') || cmd.includes('restructure')) {
      return 'refactor';
    } else if (cmd.includes('optimiz') || cmd.includes('performance') || cmd.includes('speed')) {
      return 'optimization';
    } else if (cmd.includes('document')) {
      return 'documentation';
    } else if (cmd.includes('test')) {
      return 'test';
    }

    return 'general';
  }

  /**
   * Extract topic from command
   */
  extractTopic(command) {
    // Look for patterns like "for X", "about X", "working on X"
    const patterns = [
      /(?:for|about|working on|trying)\s+(.+?)(?:\s+approach|\s+method|\s+way|\s+bug|\s+feature|$)/i,
      /(?:the|a|an)\s+(.+?)\s+(?:bug|feature|refactor|optimization|experiment)/i,
    ];

    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }
}

module.exports = NaturalLanguageParser;
