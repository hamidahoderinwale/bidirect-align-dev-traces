/**
 * Hugging Face API Routes
 */

const path = require('path');
const HuggingFaceExporter = require('../services/huggingface/exporter.js');
const HuggingFaceUploader = require('../services/huggingface/uploader.js');

function createHuggingFaceRoutes(deps) {
  const { app, persistentDB } = deps;
  const uploader = new HuggingFaceUploader();

  app.get('/api/hf/export', async (req, res) => {
    try {
      const options = {
        privacyLevel: req.query.rung || req.query.privacy_level || 'clio',
        maxSamples: parseInt(req.query.max_samples) || 10000,
        workspace: req.query.workspace || null,
      };
      const outputDir = path.join(__dirname, '../../data', `export-${Date.now()}`);
      const exporter = new HuggingFaceExporter(persistentDB, options);
      const result = await exporter.exportToHuggingFaceFormat(outputDir);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/hf/login', async (req, res) => {
    try {
      const { token } = req.body;
      const result = await uploader.login(token);
      res.json(result);
    } catch (error) {
      res.status(401).json({ success: false, error: error.message });
    }
  });

  app.post('/api/hf/upload', async (req, res) => {
    try {
      const { sessionId, repoName, directory } = req.body;
      const result = await uploader.uploadDataset(sessionId, repoName, directory);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createHuggingFaceRoutes;

