/**
 * State Recommender Service
 * Provides intelligent recommendations about states
 * - Unfinished experiments
 * - Similar states
 * - Merge suggestions
 */

const EventAnnotationService = require('./event-annotation-service.js');

class StateRecommender {
  constructor(stateManager, persistentDB) {
    this.stateManager = stateManager;
    this.db = persistentDB;
    this.annotationService = new EventAnnotationService();
  }

  /**
   * Find unfinished experiments
   */
  async findUnfinishedExperiments(workspacePath = null) {
    const filters = { intent: 'experiment' };
    if (workspacePath) {
      filters.workspace_path = workspacePath;
    }

    const states = await this.stateManager.listStates(filters);

    // Filter for states that haven't been merged or completed
    const unfinished = states.filter((state) => {
      // Check if state has recent activity (within last 7 days)
      const created = new Date(state.created_at);
      const daysSinceCreation = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);

      // Consider unfinished if:
      // - Created more than 1 day ago
      // - Has no parent (not merged)
      // - No recent activity
      return daysSinceCreation > 1 && !state.parent_id;
    });

    return unfinished;
  }

  /**
   * Find states similar to current work
   */
  async findSimilarStates(currentEvents, workspacePath = null, limit = 5) {
    if (!currentEvents || currentEvents.length === 0) {
      return [];
    }

    // Get intent classification for current work
    const currentIntent = await this.annotationService.classifyIntent(currentEvents);

    // Get all states
    const filters = {};
    if (workspacePath) {
      filters.workspace_path = workspacePath;
    }

    const allStates = await this.stateManager.listStates(filters);

    // Score states by similarity
    const scoredStates = allStates.map((state) => {
      let score = 0;

      // Intent match
      if (state.metadata?.intent === currentIntent.intent) {
        score += 10;
      }

      // Tag overlap
      const stateTags = new Set(state.metadata?.tags || []);
      const currentTags = new Set(currentIntent.tags || []);
      const overlap = [...currentTags].filter((t) => stateTags.has(t)).length;
      score += overlap * 5;

      // Description similarity (simple keyword matching)
      const currentSummary = currentIntent.summary?.toLowerCase() || '';
      const stateDesc = (state.description || '').toLowerCase();
      const stateName = (state.name || '').toLowerCase();

      const currentWords = new Set(currentSummary.split(/\s+/));
      const stateWords = new Set([...stateDesc.split(/\s+/), ...stateName.split(/\s+/)]);
      const wordOverlap = [...currentWords].filter((w) => stateWords.has(w) && w.length > 3).length;
      score += wordOverlap * 2;

      return { state, score };
    });

    // Sort by score and return top matches
    return scoredStates
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.state);
  }

  /**
   * Get merge recommendations
   */
  async getMergeRecommendations(workspacePath = null) {
    const unfinished = await this.findUnfinishedExperiments(workspacePath);

    if (unfinished.length === 0) {
      return [];
    }

    // Group by intent/topic
    const groups = {};
    unfinished.forEach((state) => {
      const key = `${state.metadata?.intent || 'general'}_${this.extractTopicKey(state)}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(state);
    });

    // Find groups with multiple states (candidates for merging)
    const recommendations = [];
    Object.entries(groups).forEach(([key, states]) => {
      if (states.length >= 2) {
        recommendations.push({
          reason: `You have ${states.length} unfinished ${states[0].metadata?.intent || 'experiments'} related to ${this.extractTopicKey(states[0])}`,
          states: states,
          suggestedAction: 'merge',
          confidence: states.length >= 3 ? 'high' : 'medium',
        });
      }
    });

    return recommendations;
  }

  /**
   * Extract topic key from state
   */
  extractTopicKey(state) {
    const desc = (state.description || '').toLowerCase();
    const name = (state.name || '').toLowerCase();

    // Try to extract main topic
    const topicMatch = desc.match(/(?:for|about|working on)\s+([^\s]+(?:\s+[^\s]+)?)/);
    if (topicMatch) {
      return topicMatch[1];
    }

    return name || 'general';
  }

  /**
   * Generate recommendation message
   */
  generateRecommendationMessage(recommendation) {
    if (recommendation.suggestedAction === 'merge') {
      const stateNames = recommendation.states.map((s) => s.name).join(', ');
      return `You have ${recommendation.states.length} unfinished ${recommendation.states[0].metadata?.intent || 'experiments'}: ${stateNames}. Would you like to merge any of them?`;
    } else if (recommendation.suggestedAction === 'fork') {
      return `This state "${recommendation.state.name}" looks similar to your current work. Want to fork it?`;
    }

    return recommendation.reason;
  }
}

module.exports = StateRecommender;
