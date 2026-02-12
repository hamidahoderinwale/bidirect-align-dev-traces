/**
 * Rung Prompt Linker
 * Improves prompt linking with temporal proximity fallback and file path matching
 */

const path = require('path');

class RungPromptLinker {
  constructor(persistentDB) {
    this.persistentDB = persistentDB;
    this.temporalWindow = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Link a diff to a prompt using multiple strategies:
   * 1. Direct promptId from diff
   * 2. Temporal proximity (changes within 5 minutes of prompt)
   * 3. File path matching (changes to files mentioned in prompt context)
   */
  async linkDiffToPrompt(diff, filePath, workspacePath = null) {
    // Strategy 1: Direct promptId from diff
    if (diff.promptId) {
      return {
        promptId: diff.promptId,
        confidence: 'high',
        method: 'direct',
      };
    }

    // Strategy 2: Temporal proximity
    const diffTime = new Date(diff.timestamp || Date.now()).getTime();
    const temporalLink = await this.findPromptByTemporalProximity(
      diffTime,
      filePath,
      workspacePath
    );

    if (temporalLink) {
      return temporalLink;
    }

    // Strategy 3: File path matching (if we have context files from prompts)
    const filePathLink = await this.findPromptByFilePath(filePath, diffTime, workspacePath);

    if (filePathLink) {
      return filePathLink;
    }

    return {
      promptId: null,
      confidence: 'none',
      method: 'none',
    };
  }

  /**
   * Find prompt by temporal proximity (within 5 minutes before the diff)
   */
  async findPromptByTemporalProximity(diffTime, filePath, workspacePath = null) {
    if (!this.persistentDB) return null;

    try {
      await this.persistentDB.init();

      const windowStart = new Date(diffTime - this.temporalWindow).toISOString();
      const windowEnd = new Date(diffTime).toISOString();

      return new Promise((resolve, reject) => {
        let query = `
          SELECT id, timestamp, text, workspace_path, conversation_id
          FROM prompts
          WHERE timestamp >= ? AND timestamp <= ?
        `;
        const params = [windowStart, windowEnd];

        if (workspacePath) {
          query += ` AND (workspace_path = ? OR workspace_path IS NULL)`;
          params.push(workspacePath);
        }

        query += ` ORDER BY timestamp DESC LIMIT 10`;

        this.persistentDB.db.all(query, params, (err, prompts) => {
          if (err) {
            reject(err);
            return;
          }

          if (prompts.length === 0) {
            resolve(null);
            return;
          }

          // Find the closest prompt (most recent before the diff)
          const closestPrompt = prompts
            .filter((p) => {
              const promptTime = new Date(p.timestamp).getTime();
              return promptTime <= diffTime; // Only prompts before the diff
            })
            .sort((a, b) => {
              const aTime = new Date(a.timestamp).getTime();
              const bTime = new Date(b.timestamp).getTime();
              return bTime - aTime; // Most recent first
            })[0];

          if (closestPrompt) {
            const promptTime = new Date(closestPrompt.timestamp).getTime();
            const timeDiff = diffTime - promptTime;
            const confidence = timeDiff < 2 * 60 * 1000 ? 'high' : 'medium'; // Within 2 min = high confidence

            resolve({
              promptId: closestPrompt.id,
              conversationId: closestPrompt.conversation_id || null,
              confidence,
              method: 'temporal_proximity',
              timeDiff,
            });
          } else {
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.warn(
        '[RUNG-PROMPT-LINKER] Error finding prompt by temporal proximity:',
        error.message
      );
      return null;
    }
  }

  /**
   * Find prompt by file path matching (if prompt context mentions this file)
   */
  async findPromptByFilePath(filePath, diffTime, workspacePath = null) {
    if (!this.persistentDB) return null;

    try {
      await this.persistentDB.init();

      // Look for prompts that mention this file in their context
      // This is a simplified version - in a full implementation, we'd parse
      // the prompt's context_files or analyze the prompt text for file references
      const windowStart = new Date(diffTime - this.temporalWindow * 2).toISOString();
      const windowEnd = new Date(diffTime).toISOString();

      return new Promise((resolve, reject) => {
        let query = `
          SELECT id, timestamp, text, workspace_path, conversation_id
          FROM prompts
          WHERE timestamp >= ? AND timestamp <= ?
            AND (text LIKE ? OR workspace_path = ?)
        `;
        const fileName = path.basename(filePath);
        const params = [windowStart, windowEnd, `%${fileName}%`, workspacePath];

        if (workspacePath) {
          query += ` AND (workspace_path = ? OR workspace_path IS NULL)`;
          params.push(workspacePath);
        }

        query += ` ORDER BY timestamp DESC LIMIT 5`;

        this.persistentDB.db.all(query, params, (err, prompts) => {
          if (err) {
            reject(err);
            return;
          }

          if (prompts.length === 0) {
            resolve(null);
            return;
          }

          // Find the closest prompt
          const closestPrompt = prompts
            .filter((p) => {
              const promptTime = new Date(p.timestamp).getTime();
              return promptTime <= diffTime;
            })
            .sort((a, b) => {
              const aTime = new Date(a.timestamp).getTime();
              const bTime = new Date(b.timestamp).getTime();
              return bTime - aTime;
            })[0];

          if (closestPrompt) {
            resolve({
              promptId: closestPrompt.id,
              conversationId: closestPrompt.conversation_id || null,
              confidence: 'medium',
              method: 'file_path_matching',
            });
          } else {
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.warn('[RUNG-PROMPT-LINKER] Error finding prompt by file path:', error.message);
      return null;
    }
  }

  /**
   * Batch link multiple diffs to prompts
   */
  async linkDiffsToPrompts(diffs, filePath, workspacePath = null) {
    const results = [];

    for (const diff of diffs) {
      const link = await this.linkDiffToPrompt(diff, filePath, workspacePath);
      results.push({
        diff,
        link,
      });
    }

    return results;
  }
}

module.exports = RungPromptLinker;
