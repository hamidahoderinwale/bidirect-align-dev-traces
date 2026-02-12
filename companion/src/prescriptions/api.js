/**
 * Prescription API Routes
 *
 * Express router for prescription management endpoints.
 * Provides REST API for CRUD operations, suggestions, and injection.
 */

const express = require('express');

/**
 * Create prescription API router
 * @param {PrescriptionManager} manager - Prescription manager instance
 * @param {PrescriptionInjector} injector - Prescription injector instance
 * @param {PrescriptionDetector} detector - Prescription detector instance
 * @returns {express.Router} Express router
 */
function createPrescriptionAPI(manager, injector, detector) {
  const router = express.Router();

  // ============================================
  // CRUD Operations
  // ============================================

  /**
   * GET /api/prescriptions
   * Get all prescriptions with optional filtering
   * Query params: active, category, scope, search
   */
  router.get('/', (req, res) => {
    try {
      const filters = {
        active: req.query.active !== undefined ? req.query.active === 'true' : undefined,
        category: req.query.category,
        scope: req.query.scope,
        search: req.query.search,
      };

      const prescriptions = manager.getAll(filters);
      res.json({
        success: true,
        count: prescriptions.length,
        prescriptions,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/prescriptions/:id
   * Get single prescription by ID
   */
  router.get('/:id', (req, res) => {
    try {
      const prescription = manager.getById(req.params.id);

      if (!prescription) {
        return res.status(404).json({
          success: false,
          error: 'Prescription not found',
        });
      }

      res.json({
        success: true,
        prescription,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/prescriptions
   * Create new prescription
   * Body: { title, prescription, category, scope, scope_value, priority, tags, metadata }
   */
  router.post('/', (req, res) => {
    try {
      const result = manager.create(req.body);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * PATCH /api/prescriptions/:id
   * Update prescription
   * Body: fields to update
   */
  router.patch('/:id', (req, res) => {
    try {
      const result = manager.update(req.params.id, req.body);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * DELETE /api/prescriptions/:id
   * Delete prescription
   */
  router.delete('/:id', (req, res) => {
    try {
      const result = manager.delete(req.params.id);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/prescriptions/:id/toggle
   * Toggle prescription active state
   */
  router.post('/:id/toggle', (req, res) => {
    try {
      const result = manager.toggle(req.params.id);

      if (!result.success) {
        return res.status(404).json(result);
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Context & Injection
  // ============================================

  /**
   * GET /api/prescriptions/inject
   * Get formatted prescriptions for context injection
   * Query params: workspace, fileType, filePath, format (prompt|json|markdown|plain)
   */
  router.get('/inject', (req, res) => {
    try {
      const context = {
        workspace: req.query.workspace,
        fileType: req.query.fileType,
        filePath: req.query.filePath,
      };

      const result = injector.inject(context);
      const format = req.query.format || 'prompt';

      let formatted;
      switch (format) {
        case 'json':
          formatted = injector.formatAsJSON(result.prescriptions);
          break;
        case 'markdown':
          formatted = injector.formatAsMarkdown(result.prescriptions);
          break;
        case 'plain':
          formatted = injector.formatAsPlainText(result.prescriptions);
          break;
        case 'prompt':
        default:
          formatted = result.formatted;
          break;
      }

      res.json({
        success: true,
        formatted,
        count: result.count,
        prescriptions: result.prescriptions,
        context,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/prescriptions/inject/preview
   * Preview what would be injected for given context
   */
  router.get('/inject/preview', (req, res) => {
    try {
      const context = {
        workspace: req.query.workspace,
        fileType: req.query.fileType,
        filePath: req.query.filePath,
      };

      const preview = injector.preview(context);

      res.json({
        success: true,
        ...preview,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Statistics & Analytics
  // ============================================

  /**
   * GET /api/prescriptions/stats
   * Get prescription statistics
   */
  router.get('/stats', (req, res) => {
    try {
      const stats = manager.getStats();

      res.json({
        success: true,
        stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * GET /api/prescriptions/conflicts
   * Detect conflicting prescriptions
   */
  router.get('/conflicts', (req, res) => {
    try {
      const conflicts = manager.detectConflicts();

      res.json({
        success: true,
        count: conflicts.length,
        conflicts,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Auto-Detection & Suggestions
  // ============================================

  /**
   * GET /api/prescriptions/suggest
   * Get prescription suggestions from patterns
   * Query params: days, minOccurrences, source (prompts|code|all)
   */
  router.get('/suggest', async (req, res) => {
    try {
      const options = {
        days: parseInt(req.query.days) || 7,
        minOccurrences: parseInt(req.query.minOccurrences) || 3,
      };

      const source = req.query.source || 'all';
      let suggestions;

      if (source === 'prompts') {
        suggestions = await detector.suggestFromPrompts(options);
      } else if (source === 'code') {
        suggestions = await detector.suggestFromCode();
      } else {
        const all = await detector.getAllSuggestions();
        suggestions = all.combined;
      }

      res.json({
        success: true,
        count: suggestions.length,
        suggestions,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/prescriptions/suggest/:index/accept
   * Accept a suggestion and create prescription
   * Body: suggestion object
   */
  router.post('/suggest/accept', (req, res) => {
    try {
      const suggestion = req.body;

      // Create prescription from suggestion
      const result = manager.create({
        title: suggestion.title,
        prescription: suggestion.prescription,
        category: suggestion.category,
        scope: suggestion.scope || 'global',
        scope_value: suggestion.scope_value,
        priority: suggestion.priority || 50,
        source: suggestion.source || 'auto-detected',
        tags: ['auto-suggested'],
        metadata: {
          confidence: suggestion.confidence,
          reason: suggestion.reason,
          acceptedAt: Date.now(),
        },
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Import/Export
  // ============================================

  /**
   * GET /api/prescriptions/export
   * Export all prescriptions
   */
  router.get('/export', (req, res) => {
    try {
      const prescriptions = manager.exportAll();

      res.json({
        success: true,
        count: prescriptions.length,
        prescriptions,
        exportedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/prescriptions/import
   * Import prescriptions
   * Body: { prescriptions: [], overwrite: boolean }
   */
  router.post('/import', (req, res) => {
    try {
      const { prescriptions, overwrite } = req.body;

      if (!Array.isArray(prescriptions)) {
        return res.status(400).json({
          success: false,
          error: 'prescriptions must be an array',
        });
      }

      const result = manager.bulkImport(prescriptions, { overwrite: !!overwrite });

      res.json({
        success: true,
        result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // ============================================
  // Templates
  // ============================================

  /**
   * GET /api/prescriptions/templates
   * Get predefined prescription templates
   */
  router.get('/templates', (req, res) => {
    try {
      const templates = getPrescriptionTemplates();

      res.json({
        success: true,
        count: templates.length,
        templates,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * POST /api/prescriptions/templates/:templateId/apply
   * Apply a template (create multiple prescriptions)
   */
  router.post('/templates/:templateId/apply', (req, res) => {
    try {
      const templates = getPrescriptionTemplates();
      const template = templates.find((t) => t.id === req.params.templateId);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found',
        });
      }

      const result = manager.bulkImport(template.prescriptions, { overwrite: false });

      res.json({
        success: true,
        templateName: template.name,
        result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
}

/**
 * Get predefined prescription templates
 */
function getPrescriptionTemplates() {
  return [
    {
      id: 'react-nextjs',
      name: 'React/Next.js Project',
      description: 'Common rules for React and Next.js development',
      prescriptions: [
        {
          title: 'React/Next.js Project',
          prescription: 'This is a React/Next.js project - follow React best practices',
          category: 'domain',
          scope: 'global',
          priority: 80,
        },
        {
          title: 'Server Components',
          prescription:
            'Use Server Components by default unless client-side interactivity is needed',
          category: 'behavior',
          scope: 'global',
          priority: 70,
        },
        {
          title: 'TypeScript Strict',
          prescription: 'Use TypeScript with strict mode enabled',
          category: 'formatting',
          scope: 'global',
          priority: 70,
        },
      ],
    },
    {
      id: 'python-data-science',
      name: 'Python Data Science',
      description: 'Rules for Python data science projects',
      prescriptions: [
        {
          title: 'Python Data Science Project',
          prescription: 'This is a Python data science project - use pandas, numpy, scikit-learn',
          category: 'domain',
          scope: 'global',
          priority: 80,
        },
        {
          title: 'Type Hints Required',
          prescription: 'Use type hints for all function parameters and return values',
          category: 'formatting',
          scope: 'file-type',
          scope_value: '.py',
          priority: 70,
        },
        {
          title: 'Document Functions',
          prescription: 'Add docstrings to all functions with parameter and return descriptions',
          category: 'behavior',
          scope: 'file-type',
          scope_value: '.py',
          priority: 60,
        },
      ],
    },
    {
      id: 'security-focused',
      name: 'Security-Focused Development',
      description: 'Security-first development rules',
      prescriptions: [
        {
          title: 'No Real Credentials',
          prescription: 'Never include real API keys, passwords, or tokens in code',
          category: 'security',
          scope: 'global',
          priority: 95,
        },
        {
          title: 'Input Validation',
          prescription: 'Always validate and sanitize user input',
          category: 'security',
          scope: 'global',
          priority: 90,
        },
        {
          title: 'Use Environment Variables',
          prescription: 'Store sensitive configuration in environment variables',
          category: 'security',
          scope: 'global',
          priority: 85,
        },
      ],
    },
    {
      id: 'clean-code',
      name: 'Clean Code Principles',
      description: 'General clean code best practices',
      prescriptions: [
        {
          title: 'Descriptive Names',
          prescription: 'Use descriptive variable and function names',
          category: 'behavior',
          scope: 'global',
          priority: 60,
        },
        {
          title: 'Small Functions',
          prescription: 'Keep functions small and focused on a single responsibility',
          category: 'behavior',
          scope: 'global',
          priority: 60,
        },
        {
          title: 'DRY Principle',
          prescription: "Don't Repeat Yourself - extract common code into reusable functions",
          category: 'behavior',
          scope: 'global',
          priority: 60,
        },
        {
          title: 'No Magic Numbers',
          prescription: 'Use named constants instead of magic numbers',
          category: 'behavior',
          scope: 'global',
          priority: 50,
        },
      ],
    },
  ];
}

module.exports = createPrescriptionAPI;
