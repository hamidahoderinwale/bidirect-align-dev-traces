/**
 * Privacy Filter Service
 * Filters data to specified rung level and anonymizes PII before upload to research server
 */

const crypto = require('crypto');

class PrivacyFilter {
  constructor(consentRung = 5) {
    // Map rung numbers to names
    this.rungMap = {
      1: 'tokens',
      2: 'semantic_edits',
      3: 'functions',
      4: 'module_graph',
      5: 'dag',
      6: 'clio',
    };
    
    this.consentRung = consentRung;
    this.rungName = this.rungMap[consentRung] || 'dag';
  }

  /**
   * Hash participant ID for anonymization
   */
  hashParticipantId(participantId) {
    if (!participantId) return null;
    return crypto.createHash('sha256').update(participantId).digest('hex').slice(0, 16);
  }

  /**
   * Anonymize workspace path
   */
  anonymizePath(path) {
    if (!path) return null;
    const hash = crypto.createHash('sha256').update(path).digest('hex').slice(0, 8);
    return `/project_${hash}`;
  }

  /**
   * Filter entry to specified rung level
   */
  filterEntry(entry, rung = null) {
    const targetRung = rung || this.consentRung;
    
    const filtered = {
      id: entry.id,
      session_id: entry.session_id,
      workspace_path: this.anonymizePath(entry.workspace_path),
      timestamp: entry.timestamp,
      type: entry.type,
      source: entry.source,
    };

    // Rung 1 (tokens): Include code but canonicalized
    if (targetRung <= 1) {
      filtered.before_code = entry.before_code;
      filtered.after_code = entry.after_code;
      filtered.file_path = this.anonymizePath(entry.file_path);
    }
    // Rung 2 (semantic_edits): Include semantic edit scripts, no raw code
    else if (targetRung <= 2) {
      filtered.file_path = this.anonymizePath(entry.file_path);
      // Note: Semantic edits would be extracted by rung2 service
      // For now, we just exclude code
    }
    // Rung 3 (functions): Function-level changes only
    else if (targetRung <= 3) {
      filtered.file_path = this.anonymizePath(entry.file_path);
      // Note: Function changes would be extracted by rung3 service
    }
    // Rung 4+ (module_graph, DAG, motifs): No file paths, just structure
    else {
      // Only include high-level metadata
    }

    return filtered;
  }

  /**
   * Filter prompt to specified rung level
   */
  filterPrompt(prompt, rung = null) {
    const targetRung = rung || this.consentRung;
    
    const filtered = {
      id: prompt.id,
      timestamp: prompt.timestamp,
      status: prompt.status,
      source: prompt.source,
    };

    // Rung 1-2: Include prompt text (may contain code references)
    if (targetRung <= 2) {
      filtered.text = prompt.text;
      filtered.workspace_path = this.anonymizePath(prompt.workspace_path);
    }
    // Rung 3: Include prompt but anonymize context files
    else if (targetRung <= 3) {
      filtered.text = prompt.text;
      filtered.workspace_path = this.anonymizePath(prompt.workspace_path);
      if (prompt.context_files_json) {
        try {
          const contextFiles = JSON.parse(prompt.context_files_json);
          filtered.context_files = Array.isArray(contextFiles)
            ? contextFiles.map(f => this.anonymizePath(f))
            : [];
        } catch (e) {
          filtered.context_files = [];
        }
      }
    }
    // Rung 4+: Only include metadata
    else {
      filtered.workspace_path = this.anonymizePath(prompt.workspace_path);
      filtered.context_file_count = prompt.context_file_count || 0;
    }

    // Always include high-level metadata
    filtered.mode = prompt.mode;
    filtered.model_type = prompt.model_type;
    filtered.model_name = prompt.model_name;
    filtered.lines_added = prompt.lines_added || 0;
    filtered.lines_removed = prompt.lines_removed || 0;
    filtered.context_usage = prompt.context_usage || 0;

    return filtered;
  }

  /**
   * Filter event to specified rung level
   */
  filterEvent(event, rung = null) {
    const targetRung = rung || this.consentRung;
    
    const filtered = {
      id: event.id,
      session_id: event.session_id,
      timestamp: event.timestamp,
      type: event.type,
    };

    // Rung 1-3: Include workspace path
    if (targetRung <= 3) {
      filtered.workspace_path = this.anonymizePath(event.workspace_path);
    }

    // Rung 1-2: Include details
    if (targetRung <= 2) {
      filtered.details = event.details;
    }

    // Always include high-level metadata
    filtered.annotation = event.annotation;
    filtered.intent = event.intent;
    filtered.tags = event.tags;

    return filtered;
  }

  /**
   * Filter data for upload based on consent rung
   */
  filterForUpload(data, dataType, rung = null) {
    const targetRung = rung || this.consentRung;

    if (targetRung < 1 || targetRung > 6) {
      throw new Error(`Invalid rung level: ${targetRung}. Must be between 1 and 6.`);
    }

    switch (dataType) {
      case 'entry':
        return this.filterEntry(data, targetRung);
      case 'prompt':
        return this.filterPrompt(data, targetRung);
      case 'event':
        return this.filterEvent(data, targetRung);
      default:
        throw new Error(`Unknown data type: ${dataType}`);
    }
  }

  /**
   * Filter batch of data
   */
  filterBatch(dataArray, dataType, rung = null) {
    return dataArray.map(item => this.filterForUpload(item, dataType, rung));
  }
}

module.exports = PrivacyFilter;

