/**
 * ConversationManager - Manages conversation lifecycle and turn tracking
 * Handles creating conversations, adding turns, and querying conversation data
 */

const { nanoid } = require('nanoid');

class ConversationManager {
  constructor(persistentDB) {
    this.db = persistentDB;
  }

  /**
   * Create a new conversation
   * @param {Object} options - Conversation options
   * @param {string} options.workspaceId - Workspace identifier
   * @param {string} [options.workspacePath] - Workspace path
   * @param {string} [options.title] - Conversation title
   * @param {string} [options.status='active'] - Conversation status
   * @param {Object} [options.metadata] - Additional metadata
   * @returns {Promise<Object>} Created conversation
   */
  async createConversation(options = {}) {
    const {
      workspaceId,
      workspacePath = null,
      title = null,
      status = 'active',
      metadata = {},
    } = options;

    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }

    const conversationId = nanoid();
    const now = new Date().toISOString();

    const conversation = {
      id: conversationId,
      workspace_id: workspaceId,
      workspace_path: workspacePath,
      title: title || `Conversation ${conversationId.substring(0, 8)}`,
      status: status,
      tags: null,
      metadata: JSON.stringify(metadata),
      created_at: now,
      updated_at: now,
      last_message_at: null,
      message_count: 0,
    };

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `INSERT INTO conversations (
          id, workspace_id, workspace_path, title, status, tags, metadata,
          created_at, updated_at, last_message_at, message_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          conversation.id,
          conversation.workspace_id,
          conversation.workspace_path,
          conversation.title,
          conversation.status,
          conversation.tags,
          conversation.metadata,
          conversation.created_at,
          conversation.updated_at,
          conversation.last_message_at,
          conversation.message_count,
        ],
        function (err) {
          if (err) {
            console.error('Error creating conversation:', err);
            reject(err);
          } else {
            console.log(`[ConversationManager] Created conversation: ${conversationId}`);
            resolve(conversation);
          }
        }
      );
    });
  }

  /**
   * Get a conversation by ID
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object|null>} Conversation or null if not found
   */
  async getConversation(conversationId) {
    return new Promise((resolve, reject) => {
      this.db.db.get('SELECT * FROM conversations WHERE id = ?', [conversationId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          if (row) {
            resolve({
              ...row,
              metadata: row.metadata ? JSON.parse(row.metadata) : {},
            });
          } else {
            resolve(null);
          }
        }
      });
    });
  }

  /**
   * Get all conversations for a workspace
   * @param {string} workspaceId - Workspace identifier
   * @param {Object} options - Query options
   * @param {number} [options.limit=100] - Maximum number of conversations
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.status] - Filter by status
   * @returns {Promise<Array>} Array of conversations
   */
  async getConversationsByWorkspace(workspaceId, options = {}) {
    const { limit = 100, offset = 0, status = null } = options;

    let query = 'SELECT * FROM conversations WHERE workspace_id = ?';
    const params = [workspaceId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY last_message_at DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const conversations = rows.map((row) => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
          }));
          resolve(conversations);
        }
      });
    });
  }

  /**
   * Get all conversations (across all workspaces)
   * @param {Object} options - Query options
   * @param {number} [options.limit=100] - Maximum number of conversations
   * @param {number} [options.offset=0] - Offset for pagination
   * @param {string} [options.status] - Filter by status
   * @returns {Promise<Array>} Array of conversations
   */
  async getAllConversations(options = {}) {
    const { limit = 100, offset = 0, status = null } = options;

    let query = 'SELECT * FROM conversations';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY last_message_at DESC, created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return new Promise((resolve, reject) => {
      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const conversations = rows.map((row) => ({
            ...row,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
          }));
          resolve(conversations);
        }
      });
    });
  }

  /**
   * Update conversation metadata
   * @param {string} conversationId - Conversation ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated conversation
   */
  async updateConversation(conversationId, updates = {}) {
    const allowedFields = ['title', 'status', 'tags', 'metadata'];
    const setClause = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = ?`);
        if (key === 'metadata' && typeof value === 'object') {
          values.push(JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (setClause.length === 0) {
      return this.getConversation(conversationId);
    }

    setClause.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(conversationId);

    return new Promise((resolve, reject) => {
      this.db.db.run(
        `UPDATE conversations SET ${setClause.join(', ')} WHERE id = ?`,
        values,
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.getConversation(conversationId));
          }
        }.bind(this)
      );
    });
  }

  /**
   * Get all turns for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Array>} Array of turns ordered by turn_index
   */
  async getConversationTurns(conversationId) {
    return new Promise((resolve, reject) => {
      this.db.db.all(
        `SELECT * FROM conversation_turns 
         WHERE conversation_id = ? 
         ORDER BY turn_index ASC`,
        [conversationId],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            const turns = rows.map((row) => ({
              ...row,
              context_files: row.context_files ? JSON.parse(row.context_files) : [],
              referenced_files: row.referenced_files ? JSON.parse(row.referenced_files) : [],
              code_blocks: row.code_blocks ? JSON.parse(row.code_blocks) : [],
              metadata: row.metadata ? JSON.parse(row.metadata) : {},
              streaming: Boolean(row.streaming),
            }));
            resolve(turns);
          }
        }
      );
    });
  }

  /**
   * Get conversation with all turns
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation with turns array
   */
  async getConversationWithTurns(conversationId) {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      return null;
    }

    const turns = await this.getConversationTurns(conversationId);
    return {
      ...conversation,
      turns: turns,
    };
  }

  /**
   * Update conversation message count and last message timestamp
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async updateConversationStats(conversationId) {
    return new Promise((resolve, reject) => {
      // Get current turn count
      this.db.db.get(
        'SELECT COUNT(*) as count, MAX(created_at) as last_message_at FROM conversation_turns WHERE conversation_id = ?',
        [conversationId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          // Update conversation
          this.db.db.run(
            `UPDATE conversations 
             SET message_count = ?, 
                 last_message_at = ?,
                 updated_at = ?
             WHERE id = ?`,
            [
              row.count,
              row.last_message_at || new Date().toISOString(),
              new Date().toISOString(),
              conversationId,
            ],
            (updateErr) => {
              if (updateErr) {
                reject(updateErr);
              } else {
                resolve();
              }
            }
          );
        }
      );
    });
  }

  /**
   * Archive a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Updated conversation
   */
  async archiveConversation(conversationId) {
    return this.updateConversation(conversationId, { status: 'archived' });
  }

  /**
   * Delete a conversation and all its turns
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async deleteConversation(conversationId) {
    return new Promise((resolve, reject) => {
      this.db.db.run('DELETE FROM conversations WHERE id = ?', [conversationId], function (err) {
        if (err) {
          reject(err);
        } else {
          console.log(`[ConversationManager] Deleted conversation: ${conversationId}`);
          resolve();
        }
      });
    });
  }
}

module.exports = ConversationManager;
