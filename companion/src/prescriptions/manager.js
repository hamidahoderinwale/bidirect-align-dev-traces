/**
 * Prescription Manager
 *
 * Core business logic for managing prescriptions (behavioral rules).
 * Handles CRUD operations, conflict detection, and application tracking.
 */

const { validatePrescription, SCOPES, CATEGORIES } = require('./schema');

class PrescriptionManager {
  constructor(db) {
    this.db = db;
  }

  /**
   * Generate unique prescription ID
   */
  generateId() {
    return `presc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a new prescription
   * @param {object} data - Prescription data
   * @returns {object} { success: boolean, id?: string, errors?: string[] }
   */
  create(data) {
    const id = this.generateId();
    const now = Date.now();

    const prescription = {
      id,
      title: data.title,
      prescription: data.prescription,
      category: data.category,
      scope: data.scope || SCOPES.GLOBAL,
      scope_value: data.scope_value || null,
      priority: data.priority || 10,
      active: data.active !== undefined ? data.active : true,
      created_at: now,
      updated_at: now,
      applied_count: 0,
      last_applied: null,
      source: data.source || 'manual',
      tags: data.tags ? JSON.stringify(data.tags) : null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    };

    const validation = validatePrescription(prescription);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    try {
      this.db
        .prepare(
          `
        INSERT INTO prescriptions (
          id, title, prescription, category, scope, scope_value, 
          priority, active, created_at, updated_at, applied_count, 
          last_applied, source, tags, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          prescription.id,
          prescription.title,
          prescription.prescription,
          prescription.category,
          prescription.scope,
          prescription.scope_value,
          prescription.priority,
          prescription.active ? 1 : 0,
          prescription.created_at,
          prescription.updated_at,
          prescription.applied_count,
          prescription.last_applied,
          prescription.source,
          prescription.tags,
          prescription.metadata
        );

      return { success: true, id };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Get all prescriptions with optional filtering
   * @param {object} filters - { active, category, scope, search }
   */
  getAll(filters = {}) {
    let query = 'SELECT * FROM prescriptions WHERE 1=1';
    const params = [];

    if (filters.active !== undefined) {
      query += ' AND active = ?';
      params.push(filters.active ? 1 : 0);
    }

    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.scope) {
      query += ' AND scope = ?';
      params.push(filters.scope);
    }

    if (filters.search) {
      query += ' AND (title LIKE ? OR prescription LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY priority DESC, updated_at DESC';

    const results = this.db.prepare(query).all(...params);

    // Parse JSON fields
    return results.map((p) => ({
      ...p,
      active: Boolean(p.active),
      tags: p.tags ? JSON.parse(p.tags) : [],
      metadata: p.metadata ? JSON.parse(p.metadata) : {},
    }));
  }

  /**
   * Get prescription by ID
   */
  getById(id) {
    const result = this.db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id);

    if (!result) return null;

    return {
      ...result,
      active: Boolean(result.active),
      tags: result.tags ? JSON.parse(result.tags) : [],
      metadata: result.metadata ? JSON.parse(result.metadata) : {},
    };
  }

  /**
   * Update prescription
   * @param {string} id - Prescription ID
   * @param {object} updates - Fields to update
   */
  update(id, updates) {
    const existing = this.getById(id);
    if (!existing) {
      return { success: false, errors: ['Prescription not found'] };
    }

    const updated = { ...existing, ...updates, updated_at: Date.now() };

    const validation = validatePrescription(updated);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    try {
      const fields = [];
      const values = [];

      const allowedUpdates = [
        'title',
        'prescription',
        'category',
        'scope',
        'scope_value',
        'priority',
        'active',
        'tags',
        'metadata',
      ];

      for (const field of allowedUpdates) {
        if (updates[field] !== undefined) {
          fields.push(`${field} = ?`);

          if (field === 'tags' || field === 'metadata') {
            values.push(JSON.stringify(updates[field]));
          } else if (field === 'active') {
            values.push(updates[field] ? 1 : 0);
          } else {
            values.push(updates[field]);
          }
        }
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?');
        values.push(Date.now());
        values.push(id);

        this.db
          .prepare(
            `
          UPDATE prescriptions 
          SET ${fields.join(', ')} 
          WHERE id = ?
        `
          )
          .run(...values);
      }

      return { success: true };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Delete prescription
   */
  delete(id) {
    try {
      const result = this.db.prepare('DELETE FROM prescriptions WHERE id = ?').run(id);

      if (result.changes === 0) {
        return { success: false, errors: ['Prescription not found'] };
      }

      return { success: true };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Toggle prescription active state
   */
  toggle(id) {
    const prescription = this.getById(id);
    if (!prescription) {
      return { success: false, errors: ['Prescription not found'] };
    }

    return this.update(id, { active: !prescription.active });
  }

  /**
   * Track prescription application
   */
  recordApplication(id) {
    try {
      this.db
        .prepare(
          `
        UPDATE prescriptions 
        SET applied_count = applied_count + 1, last_applied = ? 
        WHERE id = ?
      `
        )
        .run(Date.now(), id);

      return { success: true };
    } catch (error) {
      return { success: false, errors: [error.message] };
    }
  }

  /**
   * Get active prescriptions for a specific context
   * @param {object} context - { workspace, fileType, filePath }
   */
  getActiveForContext(context = {}) {
    const { workspace, fileType, filePath } = context;

    const prescriptions = this.db
      .prepare(
        `
      SELECT * FROM prescriptions 
      WHERE active = 1 
        AND (
          scope = ? 
          OR (scope = ? AND scope_value = ?)
          OR (scope = ? AND scope_value = ?)
          OR (scope = ? AND scope_value = ?)
        )
      ORDER BY priority DESC, created_at ASC
    `
      )
      .all(
        SCOPES.GLOBAL,
        SCOPES.WORKSPACE,
        workspace || '',
        SCOPES.FILE_TYPE,
        fileType || '',
        SCOPES.FILE,
        filePath || ''
      );

    return prescriptions.map((p) => ({
      ...p,
      active: Boolean(p.active),
      tags: p.tags ? JSON.parse(p.tags) : [],
      metadata: p.metadata ? JSON.parse(p.metadata) : {},
    }));
  }

  /**
   * Detect conflicting prescriptions
   * @returns {Array} Array of conflict groups
   */
  detectConflicts() {
    const allPrescriptions = this.getAll({ active: true });
    const conflicts = [];

    // Simple conflict detection: same category, opposite instructions
    const byCategory = {};

    for (const presc of allPrescriptions) {
      if (!byCategory[presc.category]) {
        byCategory[presc.category] = [];
      }
      byCategory[presc.category].push(presc);
    }

    // Check for contradictions within categories
    for (const [category, prescriptions] of Object.entries(byCategory)) {
      if (prescriptions.length > 1) {
        // Look for "don't" vs "do" patterns
        const doPatterns = prescriptions.filter((p) =>
          p.prescription.toLowerCase().match(/^(always|use|prefer|do)/)
        );
        const dontPatterns = prescriptions.filter((p) =>
          p.prescription.toLowerCase().match(/^(never|don't|avoid|no )/)
        );

        if (doPatterns.length > 0 && dontPatterns.length > 0) {
          conflicts.push({
            category,
            type: 'do_vs_dont',
            prescriptions: [...doPatterns, ...dontPatterns],
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Get statistics
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM prescriptions').get().count;
    const active = this.db
      .prepare('SELECT COUNT(*) as count FROM prescriptions WHERE active = 1')
      .get().count;

    const byCategory = this.db
      .prepare(
        `
      SELECT category, COUNT(*) as count 
      FROM prescriptions 
      WHERE active = 1 
      GROUP BY category
    `
      )
      .all();

    const byScope = this.db
      .prepare(
        `
      SELECT scope, COUNT(*) as count 
      FROM prescriptions 
      WHERE active = 1 
      GROUP BY scope
    `
      )
      .all();

    const mostApplied = this.db
      .prepare(
        `
      SELECT id, title, applied_count 
      FROM prescriptions 
      WHERE active = 1 
      ORDER BY applied_count DESC 
      LIMIT 10
    `
      )
      .all();

    const recentlyUpdated = this.db
      .prepare(
        `
      SELECT id, title, updated_at 
      FROM prescriptions 
      ORDER BY updated_at DESC 
      LIMIT 10
    `
      )
      .all();

    return {
      total,
      active,
      inactive: total - active,
      byCategory,
      byScope,
      mostApplied,
      recentlyUpdated,
      conflicts: this.detectConflicts(),
    };
  }

  /**
   * Import prescriptions from array
   * @param {Array} prescriptions - Array of prescription objects
   * @param {object} options - { overwrite: boolean }
   */
  bulkImport(prescriptions, options = {}) {
    const results = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    for (const presc of prescriptions) {
      // Check if prescription with same title exists
      const existing = this.db
        .prepare('SELECT id FROM prescriptions WHERE title = ?')
        .get(presc.title);

      if (existing && !options.overwrite) {
        results.skipped++;
        continue;
      }

      if (existing && options.overwrite) {
        const updateResult = this.update(existing.id, presc);
        if (updateResult.success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({ title: presc.title, errors: updateResult.errors });
        }
      } else {
        const createResult = this.create({ ...presc, source: 'imported' });
        if (createResult.success) {
          results.success++;
        } else {
          results.failed++;
          results.errors.push({ title: presc.title, errors: createResult.errors });
        }
      }
    }

    return results;
  }

  /**
   * Export all prescriptions
   */
  exportAll() {
    return this.getAll();
  }
}

module.exports = PrescriptionManager;
