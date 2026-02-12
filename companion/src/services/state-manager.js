/**
 * State Manager Service
 * Manages development states (like Git branches but for development workflows)
 * Supports fork, merge, and state switching operations
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class StateManager {
  constructor(persistentDB) {
    this.db = persistentDB;
    this.statesPath = path.join(__dirname, '../data/states');
    this.ensureStatesDirectory();
  }

  ensureStatesDirectory() {
    if (!fs.existsSync(this.statesPath)) {
      fs.mkdirSync(this.statesPath, { recursive: true });
    }
  }

  /**
   * Create a new state
   */
  async createState(name, description, metadata = {}) {
    const stateId = `state-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const state = {
      id: stateId,
      name,
      description,
      parent_id: metadata.parent_id || null,
      created_at: new Date().toISOString(),
      workspace_path: metadata.workspace_path || process.cwd(),
      snapshot_hash: null, // Will be set when snapshot is created
      metadata: {
        ...metadata,
        intent: metadata.intent || 'general',
        tags: metadata.tags || [],
      },
    };

    // Save to database
    await this.saveState(state);

    return state;
  }

  /**
   * Fork a state (create new state from existing)
   */
  async forkState(sourceStateId, newName, description, metadata = {}) {
    const sourceState = await this.getState(sourceStateId);
    if (!sourceState) {
      throw new Error(`Source state not found: ${sourceStateId}`);
    }

    // Create new state with parent reference
    const forkedState = await this.createState(newName, description, {
      ...metadata,
      parent_id: sourceStateId,
      forked_from: sourceStateId,
      original_name: sourceState.name,
    });

    // Copy snapshot if it exists
    if (sourceState.snapshot_hash) {
      const snapshotPath = this.getSnapshotPath(sourceState.snapshot_hash);
      if (fs.existsSync(snapshotPath)) {
        const newSnapshotHash = await this.createSnapshot(forkedState.id);
        const newSnapshotPath = this.getSnapshotPath(newSnapshotHash);
        fs.copyFileSync(snapshotPath, newSnapshotPath);
        forkedState.snapshot_hash = newSnapshotHash;
        await this.saveState(forkedState);
      }
    }

    return forkedState;
  }

  /**
   * Merge states
   */
  async mergeStates(sourceStateIds, targetStateId, strategy = 'smart') {
    const targetState = await this.getState(targetStateId);
    if (!targetState) {
      throw new Error(`Target state not found: ${targetStateId}`);
    }

    const sourceStates = await Promise.all(sourceStateIds.map((id) => this.getState(id)));

    const missingStates = sourceStates.filter((s) => !s);
    if (missingStates.length > 0) {
      throw new Error(`Source states not found: ${missingStates.map((s) => s?.id).join(', ')}`);
    }

    // For now, return merge plan (actual file merging will be implemented later)
    const mergePlan = {
      target: targetState,
      sources: sourceStates,
      strategy,
      conflicts: [],
      files_to_merge: [],
    };

    // Store merge operation
    await this.saveMergeOperation({
      id: `merge-${Date.now()}`,
      target_state_id: targetStateId,
      source_state_ids: sourceStateIds,
      strategy,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    return mergePlan;
  }

  /**
   * List states with filters
   */
  async listStates(filters = {}, searchQuery = null) {
    let query = 'SELECT * FROM states WHERE 1=1';
    const params = [];

    if (filters.workspace_path) {
      query += ' AND workspace_path = ?';
      params.push(filters.workspace_path);
    }

    if (filters.intent) {
      query += ' AND metadata LIKE ?';
      params.push(`%"intent":"${filters.intent}"%`);
    }

    if (filters.tags && filters.tags.length > 0) {
      filters.tags.forEach((tag) => {
        query += ' AND metadata LIKE ?';
        params.push(`%"${tag}"%`);
      });
    }

    if (filters.parent_id) {
      query += ' AND parent_id = ?';
      params.push(filters.parent_id);
    }

    query += ' ORDER BY created_at DESC';

    return new Promise((resolve, reject) => {
      this.db.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const states = rows.map((row) => ({
            ...row,
            metadata: JSON.parse(row.metadata || '{}'),
          }));

          // Apply semantic search if query provided
          if (searchQuery) {
            resolve(this.semanticSearchStates(states, searchQuery));
          } else {
            resolve(states);
          }
        }
      });
    });
  }

  /**
   * Get a single state
   */
  async getState(stateId) {
    return new Promise((resolve, reject) => {
      this.db.db.get('SELECT * FROM states WHERE id = ?', [stateId], (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ...row,
            metadata: JSON.parse(row.metadata || '{}'),
          });
        }
      });
    });
  }

  /**
   * Save state to database
   */
  async saveState(state) {
    // Ensure states table exists
    await this.ensureStatesTable();

    return new Promise((resolve, reject) => {
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO states 
        (id, name, description, parent_id, created_at, workspace_path, snapshot_hash, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        state.id,
        state.name,
        state.description,
        state.parent_id,
        state.created_at,
        state.workspace_path,
        state.snapshot_hash,
        JSON.stringify(state.metadata || {})
      );

      stmt.finalize((err) => {
        if (err) {
          reject(err);
        } else {
          resolve(state);
        }
      });
    });
  }

  /**
   * Ensure states table exists
   */
  async ensureStatesTable() {
    return new Promise((resolve, reject) => {
      this.db.db.run(
        `
        CREATE TABLE IF NOT EXISTS states (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          parent_id TEXT,
          created_at TEXT,
          workspace_path TEXT,
          snapshot_hash TEXT,
          metadata TEXT
        )
      `,
        (err) => {
          if (err) {
            reject(err);
          } else {
            // Create indexes
            this.db.db.run(
              'CREATE INDEX IF NOT EXISTS idx_states_workspace ON states(workspace_path)',
              () => {}
            );
            this.db.db.run(
              'CREATE INDEX IF NOT EXISTS idx_states_parent ON states(parent_id)',
              () => {}
            );
            resolve();
          }
        }
      );
    });
  }

  /**
   * Create snapshot of current workspace state
   */
  async createSnapshot(stateId) {
    const state = await this.getState(stateId);
    if (!state) {
      throw new Error(`State not found: ${stateId}`);
    }

    const workspacePath = state.workspace_path;
    if (!fs.existsSync(workspacePath)) {
      throw new Error(`Workspace path does not exist: ${workspacePath}`);
    }

    // Create snapshot of file tree and key files
    const snapshot = {
      state_id: stateId,
      workspace_path: workspacePath,
      timestamp: new Date().toISOString(),
      files: {},
    };

    // Walk directory and snapshot code files
    const codeExtensions = [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.java',
      '.go',
      '.rs',
      '.cpp',
      '.c',
      '.h',
      '.json',
      '.yaml',
      '.yml',
    ];

    const walkDir = (dir, baseDir = workspacePath) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          // Skip common ignore directories
          if (!['node_modules', '.git', 'dist', 'build', '.next', '.cache'].includes(file)) {
            walkDir(filePath, baseDir);
          }
        } else {
          const ext = path.extname(file);
          if (codeExtensions.includes(ext)) {
            const relativePath = path.relative(baseDir, filePath);
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              snapshot.files[relativePath] = {
                content: content.substring(0, 10000), // Limit size
                size: stat.size,
                modified: stat.mtime.toISOString(),
              };
            } catch (err) {
              // Skip files that can't be read
            }
          }
        }
      });
    };

    walkDir(workspacePath);

    // Save snapshot
    const snapshotHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
      .substring(0, 16);

    const snapshotPath = this.getSnapshotPath(snapshotHash);
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

    // Update state with snapshot hash
    state.snapshot_hash = snapshotHash;
    await this.saveState(state);

    return snapshotHash;
  }

  /**
   * Get snapshot path
   */
  getSnapshotPath(snapshotHash) {
    return path.join(this.statesPath, `${snapshotHash}.json`);
  }

  /**
   * Get state diff
   */
  async getStateDiff(stateId1, stateId2) {
    const state1 = await this.getState(stateId1);
    const state2 = await this.getState(stateId2);

    if (!state1 || !state2) {
      throw new Error('One or both states not found');
    }

    // Load snapshots
    const snapshot1 = state1.snapshot_hash
      ? JSON.parse(fs.readFileSync(this.getSnapshotPath(state1.snapshot_hash), 'utf8'))
      : null;
    const snapshot2 = state2.snapshot_hash
      ? JSON.parse(fs.readFileSync(this.getSnapshotPath(state2.snapshot_hash), 'utf8'))
      : null;

    if (!snapshot1 || !snapshot2) {
      return { error: 'One or both states have no snapshot' };
    }

    // Compare files
    const files1 = new Set(Object.keys(snapshot1.files || {}));
    const files2 = new Set(Object.keys(snapshot2.files || {}));

    const added = [...files2].filter((f) => !files1.has(f));
    const removed = [...files1].filter((f) => !files2.has(f));
    const modified = [...files1].filter((f) => {
      if (!files2.has(f)) return false;
      return snapshot1.files[f].content !== snapshot2.files[f].content;
    });

    return {
      added,
      removed,
      modified,
      unchanged: [...files1].filter(
        (f) => files2.has(f) && snapshot1.files[f].content === snapshot2.files[f].content
      ),
    };
  }

  /**
   * Save merge operation
   */
  async saveMergeOperation(mergeOp) {
    await this.ensureMergesTable();

    return new Promise((resolve, reject) => {
      const stmt = this.db.db.prepare(`
        INSERT OR REPLACE INTO state_merges 
        (id, target_state_id, source_state_ids, strategy, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        mergeOp.id,
        mergeOp.target_state_id,
        JSON.stringify(mergeOp.source_state_ids),
        mergeOp.strategy,
        mergeOp.status,
        mergeOp.created_at
      );

      stmt.finalize((err) => {
        if (err) reject(err);
        else resolve(mergeOp);
      });
    });
  }

  /**
   * Ensure merges table exists
   */
  async ensureMergesTable() {
    return new Promise((resolve) => {
      this.db.db.run(
        `
        CREATE TABLE IF NOT EXISTS state_merges (
          id TEXT PRIMARY KEY,
          target_state_id TEXT,
          source_state_ids TEXT,
          strategy TEXT,
          status TEXT,
          created_at TEXT
        )
      `,
        () => resolve()
      );
    });
  }

  /**
   * Semantic search states using embeddings
   */
  async semanticSearchStates(states, query) {
    if (!query || states.length === 0) {
      return states;
    }

    // Try to use embeddings if API is available
    try {
      const openRouterKey = process.env.OPENROUTER_API_KEY;
      if (openRouterKey) {
        // Use embedding-based search
        return await this.semanticSearchWithEmbeddings(states, query);
      }
    } catch (error) {
      console.warn('[STATE-MANAGER] Embedding search failed, using text matching:', error.message);
    }

    // Fallback to text matching
    const queryLower = query.toLowerCase();
    return states.filter((state) => {
      const name = (state.name || '').toLowerCase();
      const desc = (state.description || '').toLowerCase();
      const intent = (state.metadata?.intent || '').toLowerCase();
      const tags = (state.metadata?.tags || []).join(' ').toLowerCase();

      return (
        name.includes(queryLower) ||
        desc.includes(queryLower) ||
        intent.includes(queryLower) ||
        tags.includes(queryLower)
      );
    });
  }

  /**
   * Semantic search using embeddings
   */
  async semanticSearchWithEmbeddings(states, query) {
    const fetchModule = (await import('node-fetch')).default;
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const embeddingModel =
      process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';

    // Generate query embedding
    const queryResponse = await fetchModule('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:43917',
        'X-Title': 'Cursor Telemetry Dashboard',
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: query,
      }),
    });

    if (!queryResponse.ok) {
      throw new Error(`Embedding API error: ${queryResponse.status}`);
    }

    const queryData = await queryResponse.json();
    const queryEmbedding = queryData.data[0].embedding;

    // Generate embeddings for states (batch)
    const stateTexts = states.map(
      (s) => `${s.name} ${s.description || ''} ${(s.metadata?.tags || []).join(' ')}`
    );

    const statesResponse = await fetchModule('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:43917',
        'X-Title': 'Cursor Telemetry Dashboard',
      },
      body: JSON.stringify({
        model: embeddingModel,
        input: stateTexts,
      }),
    });

    if (!statesResponse.ok) {
      throw new Error(`Embedding API error: ${statesResponse.status}`);
    }

    const statesData = await statesResponse.json();
    const stateEmbeddings = statesData.data.map((d) => d.embedding);

    // Calculate cosine similarity
    const scoredStates = states.map((state, i) => {
      const similarity = this.cosineSimilarity(queryEmbedding, stateEmbeddings[i]);
      return { state, similarity };
    });

    // Sort by similarity and filter low scores
    return scoredStates
      .filter((s) => s.similarity > 0.3) // Minimum similarity threshold
      .sort((a, b) => b.similarity - a.similarity)
      .map((s) => s.state);
  }

  /**
   * Calculate cosine similarity
   */
  cosineSimilarity(vec1, vec2) {
    if (!vec1 || !vec2 || vec1.length !== vec2.length) {
      return 0;
    }

    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }

    if (mag1 === 0 || mag2 === 0) return 0;
    return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }
}

module.exports = StateManager;
