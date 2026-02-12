/**
 * Rung 1 Service
 * Main orchestration service for token-level abstraction
 */

const Rung1Processor = require('./rung1-processor');
const ModuleGraphExtractor = require('../module-graph/module-graph-extractor');
const RungPromptLinker = require('../rung-prompt-linker');

class Rung1Service {
  constructor(cursorDbParser = null, persistentDB = null, options = {}) {
    this.processor = new Rung1Processor({
      piiOptions: options.piiOptions,
      fuzzSemanticExpressiveness: options.fuzzSemanticExpressiveness,
    });
    this.extractor = new ModuleGraphExtractor(cursorDbParser);
    this.persistentDB = persistentDB;
    this.promptLinker = persistentDB ? new RungPromptLinker(persistentDB) : null;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.piiOptions = options.piiOptions || {};
    this.fuzzSemanticExpressiveness = options.fuzzSemanticExpressiveness === true;
  }

  /**
   * Update PII redaction options
   */
  updatePIIOptions(piiOptions) {
    this.piiOptions = { ...this.piiOptions, ...piiOptions };
    this.processor.canonicalizer.updatePIIOptions(piiOptions);
  }

  /**
   * Update semantic expressiveness fuzzing option
   */
  setFuzzSemanticExpressiveness(enabled) {
    this.fuzzSemanticExpressiveness = enabled === true;
    this.processor.canonicalizer.setFuzzSemanticExpressiveness(enabled);
  }

  /**
   * Extract and process token sequences for a workspace
   */
  async extractTokens(workspacePath = null, options = {}) {
    const cacheKey = `tokens_${workspacePath || 'global'}`;
    const cached = this.cache.get(cacheKey);

    // Check cache
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout && !options.forceRefresh) {
      return cached.tokens;
    }

    // Try to load from database first
    if (this.persistentDB && !options.forceRefresh) {
      const dbTokens = await this.loadTokensFromDB(workspacePath);
      if (dbTokens && dbTokens.length > 0) {
        this.cache.set(cacheKey, {
          tokens: dbTokens,
          timestamp: Date.now(),
        });
        return dbTokens;
      }
    }

    // Get last extraction timestamp for incremental updates
    const lastExtraction = await this.getLastExtractionTimestamp(workspacePath, 'rung1');

    // Extract file metadata from Cursor DB
    let extractedData;
    try {
      extractedData = await this.extractor.extractAll(workspacePath);
    } catch (error) {
      console.error('[RUNG1] Error extracting data from Cursor database:', error);
      throw new Error(`Failed to extract data from Cursor database: ${error.message}`);
    }

    if (!extractedData || !extractedData.fileMetadata) {
      console.warn('[RUNG1] No file metadata extracted from Cursor database');
      return [];
    }

    const { fileMetadata } = extractedData;

    if (!fileMetadata || Object.keys(fileMetadata).length === 0) {
      console.warn('[RUNG1] No file metadata found in extracted data');
      return [];
    }

    // Process all diffs with improved prompt linking
    const allTokens = [];
    let totalDiffs = 0;
    let validDiffs = 0;
    let invalidDiffs = 0;

    for (const [filePath, metadata] of Object.entries(fileMetadata)) {
      if (metadata.diffs && metadata.diffs.length > 0) {
        totalDiffs += metadata.diffs.length;

        // Filter diffs by timestamp if doing incremental update
        let diffsToProcess = lastExtraction
          ? metadata.diffs.filter((diff) => {
              const diffTime = new Date(diff.timestamp || Date.now()).getTime();
              return diffTime > lastExtraction;
            })
          : metadata.diffs;

        // Filter diffs that have valid text lines (at least modifiedTextLines for token extraction)
        diffsToProcess = diffsToProcess.filter((diff) => {
          const hasModified = diff.modifiedTextLines && diff.modifiedTextLines.length > 0;
          if (!hasModified) {
            invalidDiffs++;
            console.warn(
              `[RUNG1] Skipping diff for ${filePath}: missing modifiedTextLines`
            );
            return false;
          }
          validDiffs++;
          return true;
        });

        if (diffsToProcess.length === 0) continue;

        // Link diffs to prompts
        const linkedDiffs = await this.linkDiffsToPrompts(diffsToProcess, filePath, workspacePath);

        // Process linked diffs
        for (const { diff, link } of linkedDiffs) {
          try {
            const tokens = this.processor.processDiffs([diff], filePath, workspacePath);
            // Enhance tokens with linking information
            tokens.forEach((token) => {
              token.linkedPromptId = link.promptId || token.linkedPromptId;
              token.conversationId = link.conversationId || null;
              token.eventType = this.inferEventType(link);
              token.linkingConfidence = link.confidence || 'none';
            });
            allTokens.push(...tokens);
          } catch (error) {
            console.error(`[RUNG1] Error processing diff for ${filePath}:`, error.message);
          }
        }
      }
    }

    console.log(
      `[RUNG1] Extraction summary: ${totalDiffs} total diffs, ${validDiffs} valid, ${invalidDiffs} invalid, ${allTokens.length} tokens generated`
    );

    // Persist to database
    if (this.persistentDB && allTokens.length > 0) {
      await this.persistTokens(allTokens);
      // Update extraction timestamp
      await this.updateExtractionTimestamp(workspacePath, 'rung1');
    }

    // Cache result
    this.cache.set(cacheKey, {
      tokens: allTokens,
      timestamp: Date.now(),
    });

    return allTokens;
  }

  /**
   * Persist tokens to database
   */
  async persistTokens(tokens) {
    if (!this.persistentDB) return;

    try {
      await this.persistentDB.init();

      for (const token of tokens) {
        await new Promise((resolve, reject) => {
          this.persistentDB.db.run(
            `INSERT OR REPLACE INTO rung1_tokens (
              id, diff_id, file_path, file_id, language, token_sequence, 
              canonical_sequence, token_count, identifier_count, 
              string_literal_count, numeric_literal_count, timestamp, 
              workspace_path, linked_prompt_id, conversation_id, event_type, 
              linking_confidence, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              token.id,
              token.diffId || null,
              token.filePath || null,
              token.fileId || null,
              token.language || 'unknown',
              JSON.stringify(token.tokenSequence || []),
              JSON.stringify(token.canonicalSequence || []),
              token.tokenCount || 0,
              token.identifierCount || 0,
              token.stringLiteralCount || 0,
              token.numericLiteralCount || 0,
              new Date(token.timestamp || Date.now()).toISOString(),
              token.workspacePath || null,
              token.linkedPromptId || null,
              token.conversationId || null,
              token.eventType || 'UNKNOWN',
              token.linkingConfidence || 'none',
              JSON.stringify(token.metadata || {}),
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    } catch (error) {
      console.warn('[RUNG1] Failed to persist tokens:', error.message);
    }
  }

  /**
   * Load tokens from database
   */
  async loadTokensFromDB(workspacePath = null) {
    if (!this.persistentDB) return [];

    try {
      await this.persistentDB.init();

      return new Promise((resolve, reject) => {
        const query = workspacePath
          ? `SELECT * FROM rung1_tokens WHERE workspace_path = ? ORDER BY timestamp DESC`
          : `SELECT * FROM rung1_tokens ORDER BY timestamp DESC`;

        const params = workspacePath ? [workspacePath] : [];

        this.persistentDB.db.all(query, params, (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          const tokens = rows.map((row) => ({
            id: row.id,
            diffId: row.diff_id,
            filePath: row.file_path,
            fileId: row.file_id,
            language: row.language,
            tokenSequence: JSON.parse(row.token_sequence || '[]'),
            canonicalSequence: JSON.parse(row.canonical_sequence || '[]'),
            tokenCount: row.token_count,
            identifierCount: row.identifier_count,
            stringLiteralCount: row.string_literal_count,
            numericLiteralCount: row.numeric_literal_count,
            timestamp: row.timestamp,
            workspacePath: row.workspace_path,
            linkedPromptId: row.linked_prompt_id,
            conversationId: row.conversation_id || null,
            eventType: row.event_type || 'UNKNOWN',
            linkingConfidence: row.linking_confidence || 'none',
            metadata: JSON.parse(row.metadata || '{}'),
          }));

          resolve(tokens);
        });
      });
    } catch (error) {
      console.warn('[RUNG1] Failed to load tokens from database:', error.message);
      return [];
    }
  }

  /**
   * Get tokens with filters
   */
  async getTokens(workspacePath = null, filters = {}) {
    // Try database first if no force refresh needed
    let tokens = [];
    if (this.persistentDB) {
      try {
        tokens = await this.loadTokensFromDB(workspacePath);
      } catch (error) {
        console.warn('[RUNG1] Error loading tokens from database:', error.message);
      }
    }

    // If no database tokens, extract from Cursor DB
    if (tokens.length === 0) {
      try {
        tokens = await this.extractTokens(workspacePath);
      } catch (error) {
        console.error('[RUNG1] Error extracting tokens:', error);
        // Return empty array instead of throwing - allows UI to show helpful message
        return [];
      }
    }

    let filtered = tokens;

    // Apply filters
    if (filters.language) {
      filtered = filtered.filter((t) => t.language === filters.language);
    }

    if (filters.filePath) {
      filtered = filtered.filter((t) => t.filePath === filters.filePath);
    }

    if (filters.since) {
      const sinceTime =
        typeof filters.since === 'string' ? new Date(filters.since).getTime() : filters.since;
      filtered = filtered.filter((t) => new Date(t.timestamp).getTime() >= sinceTime);
    }

    if (filters.until) {
      const untilTime =
        typeof filters.until === 'string' ? new Date(filters.until).getTime() : filters.until;
      filtered = filtered.filter((t) => new Date(t.timestamp).getTime() <= untilTime);
    }

    if (filters.conversationId) {
      filtered = filtered.filter((t) => t.conversationId === filters.conversationId);
    }

    if (filters.eventType) {
      filtered = filtered.filter((t) => t.eventType === filters.eventType);
    }

    return filtered;
  }

  /**
   * Get token statistics
   */
  async getTokenStats(workspacePath = null) {
    const tokens = await this.extractTokens(workspacePath);

    const stats = {
      total: tokens.length,
      byLanguage: {},
      totalTokenCount: 0,
      totalIdentifierCount: 0,
      totalStringLiteralCount: 0,
      totalNumericLiteralCount: 0,
    };

    for (const token of tokens) {
      stats.byLanguage[token.language] = (stats.byLanguage[token.language] || 0) + 1;
      stats.totalTokenCount += token.tokenCount;
      stats.totalIdentifierCount += token.identifierCount;
      stats.totalStringLiteralCount += token.stringLiteralCount;
      stats.totalNumericLiteralCount += token.numericLiteralCount;
    }

    return stats;
  }

  /**
   * Clear cache
   */
  clearCache(workspacePath = null) {
    if (workspacePath) {
      this.cache.delete(`tokens_${workspacePath}`);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Link diffs to prompts using the prompt linker
   */
  async linkDiffsToPrompts(diffs, filePath, workspacePath) {
    if (!this.promptLinker) {
      return diffs.map((diff) => ({
        diff,
        link: { promptId: diff.promptId || null, confidence: 'none', method: 'none' },
      }));
    }
    return await this.promptLinker.linkDiffsToPrompts(diffs, filePath, workspacePath);
  }

  /**
   * Infer event type from prompt link
   */
  inferEventType(link) {
    if (!link || !link.promptId) {
      return 'MANUAL_EDIT';
    }
    if (link.confidence === 'high' || link.confidence === 'medium') {
      return 'AI_EDIT';
    }
    return 'UNKNOWN';
  }

  /**
   * Get last extraction timestamp for incremental updates
   */
  async getLastExtractionTimestamp(workspacePath, rungType) {
    if (!this.persistentDB) return null;

    try {
      await this.persistentDB.init();
      return new Promise((resolve, reject) => {
        const key = workspacePath || 'global';
        this.persistentDB.db.get(
          `SELECT last_extraction_timestamp FROM rung_extraction_timestamps WHERE workspace_path = ? AND rung_type = ?`,
          [key, rungType],
          (err, row) => {
            if (err) {
              reject(err);
              return;
            }
            if (row && row.last_extraction_timestamp) {
              resolve(new Date(row.last_extraction_timestamp).getTime());
            } else {
              resolve(null);
            }
          }
        );
      });
    } catch (error) {
      console.warn('[RUNG1] Error getting last extraction timestamp:', error.message);
      return null;
    }
  }

  /**
   * Update extraction timestamp
   */
  async updateExtractionTimestamp(workspacePath, rungType) {
    if (!this.persistentDB) return;

    try {
      await this.persistentDB.init();
      const key = workspacePath || 'global';
      const timestamp = new Date().toISOString();
      await new Promise((resolve, reject) => {
        this.persistentDB.db.run(
          `INSERT OR REPLACE INTO rung_extraction_timestamps (workspace_path, rung_type, last_extraction_timestamp) VALUES (?, ?, ?)`,
          [key, rungType, timestamp],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    } catch (error) {
      console.warn('[RUNG1] Error updating extraction timestamp:', error.message);
    }
  }
}

module.exports = Rung1Service;
