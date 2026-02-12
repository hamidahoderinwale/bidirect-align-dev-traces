/**
 * Combined Timeline Service
 * Merges real-time monitoring data with historical mining data into a unified timeline
 */

class CombinedTimelineService {
  constructor(persistentDB) {
    this.persistentDB = persistentDB;
  }

  /**
   * Get combined timeline from both real-time and historical data
   * @param {Object} options - Query options
   * @param {string} options.workspace - Workspace path filter
   * @param {number} options.since - Start timestamp
   * @param {number} options.until - End timestamp
   * @param {number} options.limit - Maximum number of items to return
   * @param {Array<string>} options.types - Event types to include
   * @returns {Promise<Array>} Combined and sorted timeline
   */
  async getCombinedTimeline(options = {}) {
    const { workspace, since, until, limit = 1000, types } = options;

    try {
      // Build filter for queries
      const filter = {};
      if (workspace) filter.workspace = workspace;
      if (since) filter.since = since;
      if (until) filter.until = until;

      // Fetch real-time data
      const [realTimeEntries, realTimePrompts, realTimeEvents, realTimeCommands] =
        await Promise.all([
          this.getRealTimeEntries(filter),
          this.getRealTimePrompts(filter),
          this.getRealTimeEvents(filter),
          this.getRealTimeCommands(filter),
        ]);

      // Fetch historical data
      const [historicalCommits, historicalCommands, historicalPrompts] = await Promise.all([
        this.getHistoricalCommits(filter),
        this.getHistoricalCommands(filter),
        this.getHistoricalPrompts(filter),
      ]);

      // Transform and combine all data into unified timeline items
      const timeline = [];

      // Add real-time entries (file changes)
      realTimeEntries.forEach((entry) => {
        if (!types || types.includes('file_change')) {
          timeline.push({
            type: 'file_change',
            source: 'real_time',
            timestamp: new Date(entry.timestamp).getTime(),
            id: `entry_${entry.id}`,
            data: entry,
            summary: `Modified ${entry.file || 'file'}`,
            workspace: entry.workspace || workspace,
          });
        }
      });

      // Add real-time prompts (AI interactions)
      realTimePrompts.forEach((prompt) => {
        if (!types || types.includes('prompt')) {
          timeline.push({
            type: 'prompt',
            source: 'real_time',
            timestamp: new Date(prompt.timestamp).getTime(),
            id: `prompt_${prompt.id}`,
            data: prompt,
            summary: prompt.text?.substring(0, 100) || 'AI prompt',
            workspace: prompt.workspace || workspace,
          });
        }
      });

      // Add real-time events
      realTimeEvents.forEach((event) => {
        if (!types || types.includes(event.type)) {
          timeline.push({
            type: event.type,
            source: 'real_time',
            timestamp: new Date(event.timestamp).getTime(),
            id: `event_${event.id}`,
            data: event,
            summary: event.summary || event.type,
            workspace: event.workspace_path || workspace,
          });
        }
      });

      // Add real-time terminal commands
      realTimeCommands.forEach((cmd) => {
        if (!types || types.includes('terminal_command')) {
          timeline.push({
            type: 'terminal_command',
            source: 'real_time',
            timestamp: new Date(cmd.timestamp).getTime(),
            id: `terminal_${cmd.id}`,
            data: cmd,
            summary: cmd.command || 'Terminal command',
            workspace: cmd.workspace || workspace,
          });
        }
      });

      // Add historical commits
      historicalCommits.forEach((commit) => {
        if (!types || types.includes('git_commit')) {
          timeline.push({
            type: 'git_commit',
            source: 'historical',
            timestamp: commit.date || new Date(commit.committer_date).getTime(),
            id: `commit_${commit.commit_hash}`,
            data: commit,
            summary: commit.message?.split('\n')[0] || 'Git commit',
            workspace: commit.workspace_path || workspace,
          });
        }
      });

      // Add historical shell commands
      historicalCommands.forEach((cmd) => {
        if (!types || types.includes('historical_command')) {
          timeline.push({
            type: 'historical_command',
            source: 'historical',
            timestamp: new Date(cmd.timestamp).getTime(),
            id: `hist_cmd_${cmd.id}`,
            data: cmd,
            summary: cmd.command || 'Shell command (historical)',
            workspace: cmd.workspace_path || workspace,
          });
        }
      });

      // Add historical prompts
      historicalPrompts.forEach((prompt) => {
        if (!types || types.includes('historical_prompt')) {
          timeline.push({
            type: 'historical_prompt',
            source: 'historical',
            timestamp: new Date(prompt.timestamp).getTime(),
            id: `hist_prompt_${prompt.id}`,
            data: prompt,
            summary: prompt.prompt_text?.substring(0, 100) || 'Recovered prompt',
            workspace: workspace,
          });
        }
      });

      // Sort by timestamp (newest first)
      timeline.sort((a, b) => b.timestamp - a.timestamp);

      // Apply limit
      const limitedTimeline = limit ? timeline.slice(0, limit) : timeline;

      return limitedTimeline;
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error building timeline:', error);
      throw error;
    }
  }

  /**
   * Get statistics about combined timeline
   */
  async getTimelineStats(options = {}) {
    const { workspace, since, until } = options;

    try {
      const timeline = await this.getCombinedTimeline({
        ...options,
        limit: null, // Get all for stats
      });

      const stats = {
        total: timeline.length,
        byType: {},
        bySource: {
          real_time: 0,
          historical: 0,
        },
        dateRange: {
          earliest: null,
          latest: null,
        },
      };

      timeline.forEach((item) => {
        // Count by type
        stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;

        // Count by source
        stats.bySource[item.source]++;

        // Track date range
        if (!stats.dateRange.earliest || item.timestamp < stats.dateRange.earliest) {
          stats.dateRange.earliest = item.timestamp;
        }
        if (!stats.dateRange.latest || item.timestamp > stats.dateRange.latest) {
          stats.dateRange.latest = item.timestamp;
        }
      });

      // Convert timestamps to ISO strings
      if (stats.dateRange.earliest) {
        stats.dateRange.earliest = new Date(stats.dateRange.earliest).toISOString();
      }
      if (stats.dateRange.latest) {
        stats.dateRange.latest = new Date(stats.dateRange.latest).toISOString();
      }

      return stats;
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error getting stats:', error);
      throw error;
    }
  }

  /**
   * Helper methods to fetch data from persistent DB
   */

  async getRealTimeEntries(filter) {
    try {
      return (await this.persistentDB.getEntries(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching real-time entries:', error);
      return [];
    }
  }

  async getRealTimePrompts(filter) {
    try {
      return (await this.persistentDB.getPrompts(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching real-time prompts:', error);
      return [];
    }
  }

  async getRealTimeEvents(filter) {
    try {
      return (await this.persistentDB.getEvents(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching real-time events:', error);
      return [];
    }
  }

  async getRealTimeCommands(filter) {
    try {
      return (await this.persistentDB.getTerminalCommands(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching real-time commands:', error);
      return [];
    }
  }

  async getHistoricalCommits(filter) {
    try {
      return (await this.persistentDB.getHistoricalCommits(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching historical commits:', error);
      return [];
    }
  }

  async getHistoricalCommands(filter) {
    try {
      return (await this.persistentDB.getHistoricalCommands(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching historical commands:', error);
      return [];
    }
  }

  async getHistoricalPrompts(filter) {
    try {
      return (await this.persistentDB.getHistoricalPrompts(filter)) || [];
    } catch (error) {
      console.error('[COMBINED_TIMELINE] Error fetching historical prompts:', error);
      return [];
    }
  }
}

module.exports = CombinedTimelineService;
