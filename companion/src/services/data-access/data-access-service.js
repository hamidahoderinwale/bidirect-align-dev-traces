/**
 * Unified Data Access Service
 *
 * Provides a single interface for accessing data sources in the companion service:
 * - Cursor Database (via CursorDatabaseParser)
 * - Companion Database (via PersistentDB)
 *
 * This consolidates data access patterns and makes it clear how services should
 * access different data sources.
 */

class DataAccessService {
  constructor(cursorDbParser, persistentDB) {
    this.cursorDbParser = cursorDbParser;
    this.persistentDB = persistentDB;
  }

  /**
   * Get Cursor Database Parser
   * Use this for reading from Cursor's internal databases
   */
  getCursorDbParser() {
    if (!this.cursorDbParser) {
      throw new Error('CursorDatabaseParser not available');
    }
    return this.cursorDbParser;
  }

  /**
   * Get Persistent Database
   * Use this for reading/writing to companion's own database
   */
  getPersistentDB() {
    if (!this.persistentDB) {
      throw new Error('PersistentDB not available');
    }
    return this.persistentDB;
  }

  /**
   * Check if Cursor DB parser is available
   */
  hasCursorDbAccess() {
    return this.cursorDbParser !== null && this.cursorDbParser !== undefined;
  }

  /**
   * Check if Persistent DB is available
   */
  hasPersistentDbAccess() {
    return this.persistentDB !== null && this.persistentDB !== undefined;
  }

  /**
   * Get all data from Cursor databases
   * Convenience method that wraps cursorDbParser.getAllData()
   */
  async getAllCursorData() {
    if (!this.hasCursorDbAccess()) {
      throw new Error('Cursor database access not available');
    }
    return await this.cursorDbParser.getAllData();
  }

  /**
   * Get all workspaces from Cursor databases
   */
  async getAllCursorWorkspaces() {
    if (!this.hasCursorDbAccess()) {
      throw new Error('Cursor database access not available');
    }
    return await this.cursorDbParser.getAllWorkspaces();
  }

  /**
   * Extract AI service data from Cursor databases
   */
  async extractAIServiceData() {
    if (!this.hasCursorDbAccess()) {
      throw new Error('Cursor database access not available');
    }
    return await this.cursorDbParser.extractAllAIServiceData();
  }

  /**
   * Get entries from companion database
   */
  async getEntries(options = {}) {
    if (!this.hasPersistentDbAccess()) {
      throw new Error('Persistent database access not available');
    }

    await this.persistentDB.init();

    const { limit, offset = 0, workspacePath, since, until } = options;

    // Build query
    let query = 'SELECT * FROM entries WHERE 1=1';
    const params = [];

    if (workspacePath) {
      query += ' AND workspace_path = ?';
      params.push(workspacePath);
    }

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }

    if (until) {
      query += ' AND timestamp <= ?';
      params.push(until);
    }

    query += ' ORDER BY timestamp DESC';

    if (limit) {
      query += ` LIMIT ${limit}`;
      if (offset) {
        query += ` OFFSET ${offset}`;
      }
    }

    return new Promise((resolve, reject) => {
      this.persistentDB.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  /**
   * Get prompts from companion database
   */
  async getPrompts(options = {}) {
    if (!this.hasPersistentDbAccess()) {
      throw new Error('Persistent database access not available');
    }

    await this.persistentDB.init();

    const { limit, offset = 0, workspacePath, conversationId, since, until } = options;

    // Build query
    let query = 'SELECT * FROM prompts WHERE 1=1';
    const params = [];

    if (workspacePath) {
      query += ' AND workspace_path = ?';
      params.push(workspacePath);
    }

    if (conversationId) {
      query += ' AND conversation_id = ?';
      params.push(conversationId);
    }

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }

    if (until) {
      query += ' AND timestamp <= ?';
      params.push(until);
    }

    query += ' ORDER BY timestamp DESC';

    if (limit) {
      query += ` LIMIT ${limit}`;
      if (offset) {
        query += ` OFFSET ${offset}`;
      }
    }

    return new Promise((resolve, reject) => {
      this.persistentDB.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  /**
   * Get events from companion database
   */
  async getEvents(options = {}) {
    if (!this.hasPersistentDbAccess()) {
      throw new Error('Persistent database access not available');
    }

    await this.persistentDB.init();

    const { limit, offset = 0, workspacePath, type, since, until } = options;

    // Build query
    let query = 'SELECT * FROM events WHERE 1=1';
    const params = [];

    if (workspacePath) {
      query += ' AND workspace_path = ?';
      params.push(workspacePath);
    }

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    if (since) {
      query += ' AND timestamp >= ?';
      params.push(since);
    }

    if (until) {
      query += ' AND timestamp <= ?';
      params.push(until);
    }

    query += ' ORDER BY timestamp DESC';

    if (limit) {
      query += ` LIMIT ${limit}`;
      if (offset) {
        query += ` OFFSET ${offset}`;
      }
    }

    return new Promise((resolve, reject) => {
      this.persistentDB.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows || []);
      });
    });
  }

  /**
   * Get database statistics
   */
  async getStats() {
    if (!this.hasPersistentDbAccess()) {
      return { entries: 0, prompts: 0, events: 0 };
    }

    return await this.persistentDB.getStats();
  }
}

module.exports = DataAccessService;
