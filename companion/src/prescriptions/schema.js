/**
 * Prescription Database Schema
 *
 * Prescriptions are behavioral rules and instructions that guide AI behavior.
 * They're lightweight, prescriptive (not retrospective), and auto-applied to prompts.
 */

const PRESCRIPTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prescription TEXT NOT NULL,
  category TEXT NOT NULL,  -- formatting, behavior, domain, workflow, security
  scope TEXT DEFAULT 'global',  -- global, workspace, file-type, file
  scope_value TEXT,  -- workspace path, file extension (e.g., '.js'), file path
  priority INTEGER DEFAULT 10,  -- 1-100, higher = more important
  active BOOLEAN DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  applied_count INTEGER DEFAULT 0,
  last_applied INTEGER,
  source TEXT DEFAULT 'manual',  -- manual, auto-detected, imported
  tags TEXT,  -- JSON array of tags
  metadata TEXT  -- JSON object for extensibility
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_active ON prescriptions(active);
CREATE INDEX IF NOT EXISTS idx_prescriptions_scope ON prescriptions(scope, scope_value);
CREATE INDEX IF NOT EXISTS idx_prescriptions_priority ON prescriptions(priority DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_category ON prescriptions(category);
CREATE INDEX IF NOT EXISTS idx_prescriptions_updated ON prescriptions(updated_at DESC);
`;

const CATEGORIES = {
  FORMATTING: 'formatting',
  BEHAVIOR: 'behavior',
  DOMAIN: 'domain',
  WORKFLOW: 'workflow',
  SECURITY: 'security',
  COMMUNICATION: 'communication',
  CONSTRAINTS: 'constraints',
  ALLOWLIST: 'allowlist',
  BLOCKLIST: 'blocklist',
};

const SCOPES = {
  GLOBAL: 'global',
  WORKSPACE: 'workspace',
  FILE_TYPE: 'file-type',
  FILE: 'file',
};

const SOURCES = {
  MANUAL: 'manual',
  AUTO_DETECTED: 'auto-detected',
  IMPORTED: 'imported',
  TEMPLATE: 'template',
};

/**
 * Initialize prescription tables in the database
 * @param {object} db - SQLite database instance
 */
function initializePrescriptionSchema(db) {
  try {
    db.exec(PRESCRIPTION_SCHEMA);
    console.log('Prescription schema initialized');
    return true;
  } catch (error) {
    console.error('Failed to initialize prescription schema:', error.message);
    return false;
  }
}

/**
 * Get schema validation rules
 */
function getValidationRules() {
  return {
    id: { type: 'string', required: true, pattern: /^presc-/ },
    title: { type: 'string', required: true, minLength: 3, maxLength: 200 },
    prescription: { type: 'string', required: true, minLength: 10, maxLength: 2000 },
    category: { type: 'enum', required: true, values: Object.values(CATEGORIES) },
    scope: { type: 'enum', required: true, values: Object.values(SCOPES) },
    priority: { type: 'number', min: 1, max: 100 },
    active: { type: 'boolean' },
  };
}

/**
 * Validate prescription data
 * @param {object} data - Prescription data to validate
 * @returns {object} { valid: boolean, errors: string[] }
 */
function validatePrescription(data) {
  const errors = [];
  const rules = getValidationRules();

  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    if (rule.type === 'string') {
      if (typeof value !== 'string') {
        errors.push(`${field} must be a string`);
      } else {
        if (rule.minLength && value.length < rule.minLength) {
          errors.push(`${field} must be at least ${rule.minLength} characters`);
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push(`${field} must be at most ${rule.maxLength} characters`);
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push(`${field} has invalid format`);
        }
      }
    }

    if (rule.type === 'number') {
      if (typeof value !== 'number') {
        errors.push(`${field} must be a number`);
      } else {
        if (rule.min !== undefined && value < rule.min) {
          errors.push(`${field} must be at least ${rule.min}`);
        }
        if (rule.max !== undefined && value > rule.max) {
          errors.push(`${field} must be at most ${rule.max}`);
        }
      }
    }

    if (rule.type === 'enum') {
      if (!rule.values.includes(value)) {
        errors.push(`${field} must be one of: ${rule.values.join(', ')}`);
      }
    }

    if (rule.type === 'boolean') {
      if (typeof value !== 'boolean' && value !== 0 && value !== 1) {
        errors.push(`${field} must be a boolean`);
      }
    }
  }

  // Scope-specific validation
  if (data.scope === SCOPES.WORKSPACE && !data.scope_value) {
    errors.push('scope_value is required for workspace scope');
  }
  if (data.scope === SCOPES.FILE_TYPE && !data.scope_value) {
    errors.push('scope_value is required for file-type scope');
  }
  if (data.scope === SCOPES.FILE && !data.scope_value) {
    errors.push('scope_value is required for file scope');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  PRESCRIPTION_SCHEMA,
  CATEGORIES,
  SCOPES,
  SOURCES,
  initializePrescriptionSchema,
  validatePrescription,
  getValidationRules,
};
