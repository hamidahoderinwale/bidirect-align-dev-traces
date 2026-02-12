/**
 * ConversationCapture - Captures conversation turns with timing metadata
 * Tracks LLM request timing, token usage, and response metadata
 */

const { nanoid } = require('nanoid');

class ConversationCapture {
  constructor(persistentDB, conversationManager) {
    this.db = persistentDB;
    this.conversationManager = conversationManager;
  }

  /**
   * Start capturing a user turn
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Turn options
   * @param {string} options.content - Message content
   * @param {Array} [options.contextFiles] - Context files included
   * @param {Array} [options.referencedFiles] - Referenced files
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Created turn
   */
  async captureUserTurn(conversationId, options = {}) {
    const { content, contextFiles = [], referencedFiles = [], metadata = {} } = options;

    if (!content) {
      throw new Error('Content is required for user turn');
    }

    // Get current turn count to determine index
    const existingTurns = await this.conversationManager.getConversationTurns(conversationId);
    const turnIndex = existingTurns.length;

    const turnId = nanoid();
    const now = Date.now();
    const nowISO = new Date().toISOString();

    const turn = {
      id: turnId,
      conversation_id: conversationId,
      turn_index: turnIndex,
      role: 'user',
      content: content,
      model_name: null,
      model_provider: null,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      request_start_time: now,
      request_end_time: null,
      request_duration_ms: null,
      first_token_time: null,
      time_to_first_token_ms: null,
      streaming: 0,
      context_files: JSON.stringify(contextFiles),
      referenced_files: JSON.stringify(referencedFiles),
      code_blocks: JSON.stringify([]),
      metadata: JSON.stringify(metadata),
      created_at: nowISO,
    };

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `INSERT INTO conversation_turns (
          id, conversation_id, turn_index, role, content, model_name, model_provider,
          prompt_tokens, completion_tokens, total_tokens,
          request_start_time, request_end_time, request_duration_ms,
          first_token_time, time_to_first_token_ms, streaming,
          context_files, referenced_files, code_blocks, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          turn.id,
          turn.conversation_id,
          turn.turn_index,
          turn.role,
          turn.content,
          turn.model_name,
          turn.model_provider,
          turn.prompt_tokens,
          turn.completion_tokens,
          turn.total_tokens,
          turn.request_start_time,
          turn.request_end_time,
          turn.request_duration_ms,
          turn.first_token_time,
          turn.time_to_first_token_ms,
          turn.streaming,
          turn.context_files,
          turn.referenced_files,
          turn.code_blocks,
          turn.metadata,
          turn.created_at,
        ],
        async (err) => {
          if (err) {
            console.error('Error capturing user turn:', err);
            reject(err);
          } else {
            // Update conversation stats
            await this.conversationManager.updateConversationStats(conversationId);
            console.log(
              `[ConversationCapture] Captured user turn ${turnIndex} for conversation ${conversationId}`
            );
            resolve(turn);
          }
        }
      );
    });
  }

  /**
   * Capture assistant turn with timing metadata
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Turn options
   * @param {string} options.content - Response content
   * @param {Object} options.timing - Timing metadata
   * @param {number} options.timing.requestStartTime - Request start timestamp (ms)
   * @param {number} options.timing.requestEndTime - Request end timestamp (ms)
   * @param {number} [options.timing.firstTokenTime] - First token timestamp (ms)
   * @param {Object} [options.tokens] - Token usage
   * @param {number} [options.tokens.prompt] - Prompt tokens
   * @param {number} [options.tokens.completion] - Completion tokens
   * @param {number} [options.tokens.total] - Total tokens
   * @param {Object} [options.model] - Model information
   * @param {string} [options.model.name] - Model name
   * @param {string} [options.model.provider] - Model provider
   * @param {boolean} [options.streaming=false] - Whether response was streamed
   * @param {Array} [options.codeBlocks] - Code blocks in response
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Created turn
   */
  async captureAssistantTurn(conversationId, options = {}) {
    const {
      content,
      timing = {},
      tokens = {},
      model = {},
      streaming = false,
      codeBlocks = [],
      metadata = {},
    } = options;

    if (!content) {
      throw new Error('Content is required for assistant turn');
    }

    if (!timing.requestStartTime || !timing.requestEndTime) {
      throw new Error('Timing metadata (requestStartTime, requestEndTime) is required');
    }

    // Get current turn count
    const existingTurns = await this.conversationManager.getConversationTurns(conversationId);
    const turnIndex = existingTurns.length;

    const turnId = nanoid();
    const nowISO = new Date().toISOString();

    // Calculate durations
    const requestDuration = timing.requestEndTime - timing.requestStartTime;
    const timeToFirstToken = timing.firstTokenTime
      ? timing.firstTokenTime - timing.requestStartTime
      : null;

    // Extract thinking time from timing or metadata
    const thinkingTime = timing.thinkingTime || metadata.thinkingTime || 0;
    const thinkingTimeSeconds =
      timing.thinkingTimeSeconds || metadata.thinkingTimeSeconds || thinkingTime / 1000;

    const turn = {
      id: turnId,
      conversation_id: conversationId,
      turn_index: turnIndex,
      role: 'assistant',
      content: content,
      model_name: model.name || null,
      model_provider: model.provider || null,
      prompt_tokens: tokens.prompt || 0,
      completion_tokens: tokens.completion || 0,
      total_tokens: tokens.total || (tokens.prompt || 0) + (tokens.completion || 0),
      request_start_time: timing.requestStartTime,
      request_end_time: timing.requestEndTime,
      request_duration_ms: requestDuration,
      first_token_time: timing.firstTokenTime || null,
      time_to_first_token_ms: timeToFirstToken,
      thinking_time: thinkingTime,
      thinking_time_seconds: thinkingTimeSeconds,
      streaming: streaming ? 1 : 0,
      context_files: JSON.stringify([]),
      referenced_files: JSON.stringify([]),
      code_blocks: JSON.stringify(codeBlocks),
      metadata: JSON.stringify(metadata),
      created_at: nowISO,
    };

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `INSERT INTO conversation_turns (
          id, conversation_id, turn_index, role, content, model_name, model_provider,
          prompt_tokens, completion_tokens, total_tokens,
          request_start_time, request_end_time, request_duration_ms,
          first_token_time, time_to_first_token_ms, thinking_time, thinking_time_seconds,
          streaming, context_files, referenced_files, code_blocks, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          turn.id,
          turn.conversation_id,
          turn.turn_index,
          turn.role,
          turn.content,
          turn.model_name,
          turn.model_provider,
          turn.prompt_tokens,
          turn.completion_tokens,
          turn.total_tokens,
          turn.request_start_time,
          turn.request_end_time,
          turn.request_duration_ms,
          turn.first_token_time,
          turn.time_to_first_token_ms,
          turn.thinking_time,
          turn.thinking_time_seconds,
          turn.streaming,
          turn.context_files,
          turn.referenced_files,
          turn.code_blocks,
          turn.metadata,
          turn.created_at,
        ],
        async (err) => {
          if (err) {
            console.error('Error capturing assistant turn:', err);
            reject(err);
          } else {
            // Update conversation stats
            await this.conversationManager.updateConversationStats(conversationId);
            console.log(
              `[ConversationCapture] Captured assistant turn ${turnIndex} for conversation ${conversationId} (${requestDuration}ms)`
            );
            resolve(turn);
          }
        }
      );
    });
  }

  /**
   * Update a turn with additional metadata (e.g., after streaming completes)
   * @param {string} turnId - Turn ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated turn
   */
  async updateTurn(turnId, updates = {}) {
    const allowedFields = [
      'content',
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'request_end_time',
      'request_duration_ms',
      'first_token_time',
      'time_to_first_token_ms',
      'thinking_time',
      'thinking_time_seconds',
      'code_blocks',
      'metadata',
    ];

    const setClause = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      const dbKey =
        key === 'promptTokens'
          ? 'prompt_tokens'
          : key === 'completionTokens'
            ? 'completion_tokens'
            : key === 'totalTokens'
              ? 'total_tokens'
              : key === 'requestEndTime'
                ? 'request_end_time'
                : key === 'requestDurationMs'
                  ? 'request_duration_ms'
                  : key === 'firstTokenTime'
                    ? 'first_token_time'
                    : key === 'timeToFirstTokenMs'
                      ? 'time_to_first_token_ms'
                      : key === 'thinkingTime'
                        ? 'thinking_time'
                        : key === 'thinkingTimeSeconds'
                          ? 'thinking_time_seconds'
                          : key === 'codeBlocks'
                            ? 'code_blocks'
                            : key;

      if (allowedFields.includes(dbKey)) {
        setClause.push(`${dbKey} = ?`);
        if (dbKey === 'code_blocks' || dbKey === 'metadata') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (setClause.length === 0) {
      return null;
    }

    values.push(turnId);

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `UPDATE conversation_turns SET ${setClause.join(', ')} WHERE id = ?`,
        values,
        function (err) {
          if (err) {
            reject(err);
          } else {
            // Get updated turn
            this.db.db.get(
              'SELECT * FROM conversation_turns WHERE id = ?',
              [turnId],
              (getErr, row) => {
                if (getErr) {
                  reject(getErr);
                } else if (row) {
                  resolve({
                    ...row,
                    context_files: row.context_files ? JSON.parse(row.context_files) : [],
                    referenced_files: row.referenced_files ? JSON.parse(row.referenced_files) : [],
                    code_blocks: row.code_blocks ? JSON.parse(row.code_blocks) : [],
                    metadata: row.metadata ? JSON.parse(row.metadata) : {},
                    streaming: Boolean(row.streaming),
                  });
                } else {
                  resolve(null);
                }
              }
            );
          }
        }.bind(this)
      );
    });
  }
}

module.exports = ConversationCapture;
