/**
 * MCP Search Service
 * Provides LLM-powered search and retrieval over developer workflows
 * Implements task-appropriate rung selection based on research findings
 */

const crypto = require('crypto');

class MCPSearchService {
  constructor(persistentDB) {
    this.db = persistentDB;
    
    // Task-to-rung mapping based on research findings
    this.taskRungMap = {
      classification: 'motifs',        // 98.4% accuracy
      retrieval: 'semantic_edits',    // 34.4% Recall@1
      balanced: 'functions',          // 80.9% / 50% 
      debugging: 'semantic_edits',
      refactoring: 'functions',
      feature: 'semantic_edits',
      testing: 'functions',
    };
    
    // Cache for TF-IDF vectors and similarity computations
    this.vectorCache = new Map();
    this.similarityCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Search workflows by natural language query
   */
  async searchWorkflows(params) {
    const {
      query,
      rung = 'semantic_edits',
      workspace = null,
      timeframe_days = 90,
      limit = 10,
      auto_select = false
    } = params;

    // Auto-select rung based on query type if requested
    const selectedRung = auto_select ? this.autoSelectRung(query) : rung;

    // Get relevant sessions from database
    const sessions = await this.getRelevantSessions(workspace, timeframe_days);
    
    if (!sessions || sessions.length === 0) {
      return { matches: [], total: 0, rung: selectedRung };
    }

    // Extract representations at the selected rung
    const representations = await this.extractRungs(sessions, selectedRung);

    // Compute similarity scores
    const matches = await this.computeSimilarity(query, representations, selectedRung);

    // Sort by similarity and limit results
    const sortedMatches = matches
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return {
      matches: sortedMatches,
      total: matches.length,
      rung: selectedRung,
      query_embedding: this.getQueryEmbedding(query),
    };
  }

  /**
   * Retrieve sessions similar to current activity
   */
  async retrieveSimilarSessions(params) {
    const {
      current_files = [],
      current_intent = null,
      rung = 'semantic_edits',
      similarity_threshold = 0.5,
      limit = 5
    } = params;

    // Build current activity representation
    const currentActivity = {
      files: current_files,
      intent: current_intent,
      timestamp: new Date().toISOString()
    };

    // Get recent sessions
    const sessions = await this.getRecentSessions(30); // Last 30 days

    // Extract rungs and compute similarity
    const representations = await this.extractRungs(sessions, rung);
    const currentRep = this.buildActivityRepresentation(currentActivity, rung);

    const matches = await this.computeSimilarity(currentRep, representations, rung);

    // Filter by threshold and limit
    return {
      matches: matches
        .filter(m => m.similarity >= similarity_threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit),
      current_activity: currentActivity,
      rung
    };
  }

  /**
   * Get workflow pattern for specific task type
   */
  async getWorkflowPattern(params) {
    const {
      task_type,
      workspace = null,
      format = 'motifs',
      limit = 10
    } = params;

    // Select appropriate rung for task type
    const rung = this.taskRungMap[task_type] || 'motifs';

    // Query sessions matching task type
    const sessions = await this.getSessionsByTaskType(task_type, workspace);

    if (!sessions || sessions.length === 0) {
      return { 
        pattern: null, 
        task_type, 
        rung,
        message: `No ${task_type} sessions found`
      };
    }

    // Extract common patterns using motif mining
    const patterns = await this.extractCommonPatterns(sessions, rung);

    // Format results
    if (format === 'timeline') {
      return {
        pattern: this.formatAsTimeline(patterns),
        task_type,
        rung,
        session_count: sessions.length
      };
    } else {
      return {
        pattern: patterns.slice(0, limit),
        task_type,
        rung,
        session_count: sessions.length
      };
    }
  }

  /**
   * Query sessions by developer intent
   */
  async queryByIntent(params) {
    const {
      intent,
      context = null,
      rung = 'semantic_edits',
      limit = 10
    } = params;

    // Normalize intent
    const normalizedIntent = intent.toLowerCase();

    // Query database for sessions with matching intent
    const sql = `
      SELECT DISTINCT s.*, 
        GROUP_CONCAT(DISTINCT e.type) as event_types,
        COUNT(DISTINCT e.id) as event_count
      FROM sessions s
      LEFT JOIN events e ON s.id = e.session_id
      WHERE s.id IN (
        SELECT session_id FROM events 
        WHERE annotation LIKE ? OR intent LIKE ?
      )
      GROUP BY s.id
      ORDER BY s.start_time DESC
      LIMIT ?
    `;

    const sessions = await this.db.all(sql, [
      `%${normalizedIntent}%`,
      `%${normalizedIntent}%`,
      limit * 2  // Get more for filtering
    ]);

    // Extract representations
    const representations = await this.extractRungs(sessions, rung);

    // If context provided, filter by relevance
    if (context) {
      const matches = await this.computeSimilarity(context, representations, rung);
      return {
        matches: matches.slice(0, limit),
        intent: normalizedIntent,
        rung
      };
    }

    return {
      matches: representations.slice(0, limit),
      intent: normalizedIntent,
      rung
    };
  }

  /**
   * Get file-specific workflow history
   */
  async getFileHistory(params) {
    const {
      file_path,
      include_related = false,
      rung = 'functions',
      limit = 20
    } = params;

    // Query events for this file
    const sql = `
      SELECT e.*, s.workspace_path, s.start_time
      FROM events e
      JOIN sessions s ON e.session_id = s.id
      WHERE json_extract(e.details, '$.file_path') = ?
      ORDER BY e.timestamp DESC
      LIMIT ?
    `;

    const events = await this.db.all(sql, [file_path, limit]);

    // Extract rung representation
    const representation = await this.extractRungFromEvents(events, rung);

    // If include_related, find files often edited together
    let relatedFiles = [];
    if (include_related) {
      relatedFiles = await this.findRelatedFiles(file_path, rung);
    }

    return {
      file_path,
      history: representation,
      related_files: relatedFiles,
      rung,
      event_count: events.length
    };
  }

  /**
   * Get context-aware suggestions for current activity
   */
  async getContextSuggestions(params) {
    const {
      current_session_id,
      current_files = [],
      current_intent = null,
      lookback_minutes = 30
    } = params;

    // Get current session events
    const cutoffTime = new Date(Date.now() - lookback_minutes * 60 * 1000).toISOString();
    
    const sql = `
      SELECT * FROM events 
      WHERE session_id = ? AND timestamp >= ?
      ORDER BY timestamp DESC
    `;

    const recentEvents = await this.db.all(sql, [current_session_id, cutoffTime]);

    // Analyze current workflow pattern
    const currentPattern = await this.analyzeCurrentPattern(recentEvents);

    // Find similar past patterns
    const similarPatterns = await this.findSimilarPatterns(currentPattern);

    // Generate suggestions based on what usually comes next
    const suggestions = this.generateSuggestions(currentPattern, similarPatterns);

    return {
      current_pattern: currentPattern,
      suggestions,
      confidence: this.calculateConfidence(similarPatterns)
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Auto-select appropriate rung based on query type
   */
  autoSelectRung(query) {
    const lowerQuery = query.toLowerCase();
    
    // Classification queries
    if (lowerQuery.includes('is this') || lowerQuery.includes('classify') || 
        lowerQuery.includes('what type')) {
      return 'motifs';
    }
    
    // Retrieval queries
    if (lowerQuery.includes('find') || lowerQuery.includes('search') || 
        lowerQuery.includes('similar') || lowerQuery.includes('like')) {
      return 'semantic_edits';
    }
    
    // Balanced queries
    if (lowerQuery.includes('how did i') || lowerQuery.includes('pattern')) {
      return 'functions';
    }
    
    // Default to semantic_edits (good for retrieval)
    return 'semantic_edits';
  }

  /**
   * Get relevant sessions from database with caching
   */
  async getRelevantSessions(workspace, timeframe_days) {
    const cacheKey = `sessions:${workspace}:${timeframe_days}`;
    
    if (this.vectorCache.has(cacheKey)) {
      const cached = this.vectorCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }
    }

    const cutoffDate = new Date(Date.now() - timeframe_days * 24 * 60 * 60 * 1000).toISOString();
    
    let sql = `
      SELECT s.*, 
        COUNT(DISTINCT e.id) as event_count,
        GROUP_CONCAT(DISTINCT e.type) as event_types
      FROM sessions s
      LEFT JOIN events e ON s.id = e.session_id
      WHERE s.start_time >= ?
    `;
    
    const params = [cutoffDate];
    
    if (workspace) {
      sql += ` AND s.workspace_path = ?`;
      params.push(workspace);
    }
    
    sql += `
      GROUP BY s.id
      HAVING event_count > 0
      ORDER BY s.start_time DESC
      LIMIT 1000
    `;

    const sessions = await this.db.all(sql, params);
    
    // Cache results
    this.vectorCache.set(cacheKey, {
      data: sessions,
      timestamp: Date.now()
    });

    return sessions;
  }

  /**
   * Get recent sessions with limit
   */
  async getRecentSessions(days) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const sql = `
      SELECT * FROM sessions 
      WHERE start_time >= ?
      ORDER BY start_time DESC
      LIMIT 500
    `;

    return await this.db.all(sql, [cutoffDate]);
  }

  /**
   * Extract rung representations for sessions (with caching)
   */
  async extractRungs(sessions, rung) {
    // This would call the actual rung extraction logic
    // For now, simplified implementation
    const representations = [];
    
    for (const session of sessions) {
      const cacheKey = `rung:${session.id}:${rung}`;
      
      let representation;
      if (this.vectorCache.has(cacheKey)) {
        representation = this.vectorCache.get(cacheKey).data;
      } else {
        // Call rung extraction service
        representation = await this.extractRungForSession(session, rung);
        this.vectorCache.set(cacheKey, { data: representation, timestamp: Date.now() });
      }
      
      representations.push({
        session_id: session.id,
        workspace_path: session.workspace_path,
        timestamp: session.start_time,
        representation,
        rung
      });
    }
    
    return representations;
  }

  /**
   * Compute similarity between query and representations
   */
  async computeSimilarity(query, representations, rung) {
    const matches = [];
    
    // Convert query to representation
    const queryVector = this.textToVector(query);
    
    for (const rep of representations) {
      const repVector = this.textToVector(
        Array.isArray(rep.representation) ? rep.representation.join(' ') : rep.representation
      );
      
      // Compute cosine similarity
      const similarity = this.cosineSimilarity(queryVector, repVector);
      
      matches.push({
        session_id: rep.session_id,
        workspace_path: rep.workspace_path,
        timestamp: rep.timestamp,
        workflow: rep.representation,
        similarity,
        rung
      });
    }
    
    return matches;
  }

  /**
   * Simple TF-IDF vectorization
   */
  textToVector(text) {
    if (!text) return {};
    
    const tokens = text.toString().toLowerCase().split(/\s+/);
    const vector = {};
    
    for (const token of tokens) {
      if (token.length > 2) {  // Ignore very short tokens
        vector[token] = (vector[token] || 0) + 1;
      }
    }
    
    return vector;
  }

  /**
   * Cosine similarity between two vectors
   */
  cosineSimilarity(vec1, vec2) {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    const allKeys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
    
    for (const key of allKeys) {
      const v1 = vec1[key] || 0;
      const v2 = vec2[key] || 0;
      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    }
    
    if (norm1 === 0 || norm2 === 0) return 0;
    
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Placeholder for actual rung extraction
   */
  async extractRungForSession(session, rung) {
    // This should call the actual rung extraction service
    // For now, return a placeholder
    return [`${rung}_representation_for_${session.id}`];
  }

  /**
   * Extract rung from specific events
   */
  async extractRungFromEvents(events, rung) {
    // Simplified implementation
    return events.map(e => ({
      type: e.type,
      timestamp: e.timestamp,
      rung
    }));
  }

  /**
   * Get query embedding for caching
   */
  getQueryEmbedding(query) {
    return crypto.createHash('md5').update(query).digest('hex').substring(0, 8);
  }

  /**
   * Analyze current workflow pattern
   */
  async analyzeCurrentPattern(events) {
    // Extract pattern from recent events
    const types = events.map(e => e.type);
    return {
      event_types: types,
      sequence_length: types.length,
      unique_types: new Set(types).size
    };
  }

  /**
   * Find patterns similar to current one
   */
  async findSimilarPatterns(pattern) {
    // Simplified - would use actual pattern matching
    return [];
  }

  /**
   * Generate suggestions based on patterns
   */
  generateSuggestions(currentPattern, similarPatterns) {
    // Simplified suggestion generation
    return [
      { 
        action: 'run_tests',
        confidence: 0.8,
        reason: 'You usually test after code changes'
      }
    ];
  }

  /**
   * Calculate confidence based on historical patterns
   */
  calculateConfidence(patterns) {
    if (!patterns || patterns.length === 0) return 0;
    return Math.min(0.95, patterns.length / 10);
  }

  /**
   * Build activity representation from current state
   */
  buildActivityRepresentation(activity, rung) {
    // Simplified representation building
    return activity.files.join(' ') + ' ' + (activity.intent || '');
  }

  /**
   * Get sessions by task type
   */
  async getSessionsByTaskType(taskType, workspace) {
    const sql = `
      SELECT DISTINCT s.* 
      FROM sessions s
      JOIN events e ON s.id = e.session_id
      WHERE (e.annotation LIKE ? OR e.intent LIKE ?)
      ${workspace ? 'AND s.workspace_path = ?' : ''}
      ORDER BY s.start_time DESC
      LIMIT 100
    `;

    const params = [`%${taskType}%`, `%${taskType}%`];
    if (workspace) params.push(workspace);

    return await this.db.all(sql, params);
  }

  /**
   * Extract common patterns from sessions
   */
  async extractCommonPatterns(sessions, rung) {
    // Use motif extraction
    const allPatterns = [];
    
    for (const session of sessions) {
      const rep = await this.extractRungForSession(session, rung);
      allPatterns.push(...rep);
    }
    
    // Count frequency
    const frequency = {};
    for (const pattern of allPatterns) {
      frequency[pattern] = (frequency[pattern] || 0) + 1;
    }
    
    // Return sorted by frequency
    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, count]) => ({ pattern, count, frequency: count / sessions.length }));
  }

  /**
   * Format patterns as timeline
   */
  formatAsTimeline(patterns) {
    return {
      steps: patterns.map((p, i) => ({
        step: i + 1,
        pattern: p.pattern,
        frequency: p.frequency
      }))
    };
  }

  /**
   * Find files often edited together with target file
   */
  async findRelatedFiles(filePath, rung) {
    const sql = `
      SELECT 
        json_extract(e2.details, '$.file_path') as related_file,
        COUNT(*) as co_occurrence
      FROM events e1
      JOIN events e2 ON e1.session_id = e2.session_id
      WHERE json_extract(e1.details, '$.file_path') = ?
        AND json_extract(e2.details, '$.file_path') != ?
        AND json_extract(e2.details, '$.file_path') IS NOT NULL
      GROUP BY related_file
      ORDER BY co_occurrence DESC
      LIMIT 10
    `;

    const related = await this.db.all(sql, [filePath, filePath]);
    return related.map(r => ({
      file: r.related_file,
      co_occurrence: r.co_occurrence
    }));
  }

  /**
   * Clear caches (called periodically)
   */
  clearCaches() {
    const now = Date.now();
    
    // Clear expired vector cache entries
    for (const [key, value] of this.vectorCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.vectorCache.delete(key);
      }
    }
    
    // Clear expired similarity cache entries
    for (const [key, value] of this.similarityCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.similarityCache.delete(key);
      }
    }
  }
}

module.exports = MCPSearchService;

