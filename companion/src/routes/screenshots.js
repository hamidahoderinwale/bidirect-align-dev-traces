/**
 * Screenshot API routes
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');
const ImageOptimizationService = require('../services/image-optimization-service');

// Initialize image optimization service
const imageOptimizer = new ImageOptimizationService({
  enableCache: true,
  defaultQuality: 85,
  defaultFormat: 'webp',
});

function createScreenshotRoutes(deps) {
  const { app, screenshotMonitor } = deps;

  // API endpoint for screenshots
  app.get('/api/screenshots', (req, res) => {
    try {
      const { limit, recent, since, until } = req.query;

      let screenshots = [];

      if (recent) {
        // Get recent screenshots
        screenshots = screenshotMonitor.getRecentScreenshots(parseInt(recent) || 10);
      } else if (since && until) {
        // Get screenshots in time range
        const startTime = new Date(since).getTime();
        const endTime = new Date(until).getTime();
        screenshots = screenshotMonitor.getScreenshotsInRange(startTime, endTime);
      } else {
        // Get all screenshots
        screenshots = screenshotMonitor.getAllScreenshots();
        if (limit) {
          screenshots = screenshots.slice(0, parseInt(limit));
        }
      }

      res.json({
        success: true,
        screenshots: screenshots,
        stats: screenshotMonitor.getStats(),
      });
    } catch (error) {
      console.error('Error getting screenshots:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API endpoint to serve images (proxy for file:// URLs)
  // Now with automatic compression and resizing support
  app.get('/api/image', async (req, res) => {
    try {
      let filePath = req.query.path;
      if (!filePath) {
        return res.status(400).json({ error: 'Missing path parameter' });
      }

      // Parse query parameters for image optimization
      const width = parseInt(req.query.w || req.query.width) || null;
      const height = parseInt(req.query.h || req.query.height) || null;
      const quality = parseInt(req.query.q || req.query.quality) || 85;
      const format = req.query.format || req.query.fmt || null; // auto, webp, jpeg, png
      const fit = req.query.fit || 'inside'; // inside, cover, contain, fill

      // Decode URL-encoded path (handles spaces, special characters)
      // The path might be double-encoded or have plus signs instead of spaces
      try {
        filePath = decodeURIComponent(filePath);
        // Replace + with spaces if needed (some browsers encode spaces as +)
        filePath = filePath.replace(/\+/g, ' ');
      } catch (decodeError) {
        console.warn('[IMAGE] Path decode warning:', decodeError.message);
        // If decoding fails, try using the path as-is
      }

      // Resolve the file path
      let resolvedPath = filePath;

      // Handle relative paths (e.g., "Desktop/file.png")
      if (!path.isAbsolute(filePath)) {
        // Try resolving from user's home directory
        const homeDir = os.homedir();
        resolvedPath = path.join(homeDir, filePath);
      }

      // Normalize the path (resolves . and .., handles duplicate slashes)
      resolvedPath = path.normalize(resolvedPath);

      // Security: Only allow files within user's home directory
      const homeDir = os.homedir();
      const homeDirNormalized = path.normalize(homeDir);
      if (!resolvedPath.startsWith(homeDirNormalized)) {
        console.warn('[IMAGE] Security check failed:', {
          resolvedPath,
          homeDir: homeDirNormalized,
        });
        return res.status(403).json({ error: 'Access denied: File outside home directory' });
      }

      // Check if file exists
      if (!fs.existsSync(resolvedPath)) {
        console.warn('[IMAGE] File not found:', resolvedPath);
        return res.status(404).json({ error: 'File not found', path: resolvedPath });
      }

      // Check if it's actually a file (not a directory)
      const stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) {
        return res.status(400).json({ error: 'Path is not a file' });
      }

      // Check if it's an image file
      const ext = path.extname(resolvedPath).toLowerCase();
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
      if (!imageExts.includes(ext)) {
        return res.status(400).json({ error: 'Not an image file', ext });
      }

      // Special handling for SVG (no processing)
      if (ext === '.svg') {
        const fileBuffer = await fs.promises.readFile(resolvedPath);
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Length', fileBuffer.length);
        res.send(fileBuffer);
        console.log(
          `[IMAGE] Served SVG: ${resolvedPath} (${(fileBuffer.length / 1024).toFixed(2)}KB)`
        );
        return;
      }

      // Use the image optimization service
      const result = await imageOptimizer.processImage(resolvedPath, {
        width,
        height,
        quality,
        format: format || 'auto',
        fit,
      });

      // Determine MIME type
      const mimeTypes = {
        webp: 'image/webp',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        png: 'image/png',
        avif: 'image/avif',
      };
      const mimeType = mimeTypes[result.metadata.format] || 'image/jpeg';

      // Set response headers
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=7200'); // Cache for 2 hours
      res.setHeader('Content-Length', result.buffer.length);
      res.setHeader('X-Original-Size', result.stats.originalSize);
      res.setHeader('X-Compressed-Size', result.stats.processedSize);
      res.setHeader('X-Compression-Ratio', result.stats.compressionRatio + '%');
      res.setHeader('X-Image-Width', result.metadata.width);
      res.setHeader('X-Image-Height', result.metadata.height);
      res.setHeader('X-Cached', result.cached ? 'true' : 'false');

      // Send the processed image buffer
      res.send(result.buffer);

      const cacheStatus = result.cached ? '[CACHED]' : '[PROCESSED]';
      console.log(
        `[IMAGE] ${cacheStatus} Served: ${resolvedPath} | ${result.stats.originalSize ? `Original: ${(result.stats.originalSize / 1024).toFixed(2)}KB → ` : ''}Compressed: ${(result.stats.processedSize / 1024).toFixed(2)}KB${result.stats.compressionRatio ? ` (${result.stats.compressionRatio}% savings)` : ''} | Format: ${result.metadata.format} | Dimensions: ${result.metadata.width}x${result.metadata.height}`
      );
    } catch (error) {
      console.error('[IMAGE] Error serving image:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to serve image', details: error.message });
      }
    }
  });

  // API endpoint to get screenshots near a specific time
  app.get('/api/screenshots/near/:timestamp', (req, res) => {
    try {
      const timestamp = req.params.timestamp;
      const windowMs = parseInt(req.query.window) || 5 * 60 * 1000; // 5 minutes default

      const screenshots = screenshotMonitor.findScreenshotsNearTime(timestamp, windowMs);

      res.json({
        success: true,
        screenshots: screenshots,
        count: screenshots.length,
      });
    } catch (error) {
      console.error('Error finding screenshots:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API endpoint for image cache statistics
  app.get('/api/image/cache/stats', async (req, res) => {
    try {
      const stats = await imageOptimizer.getCacheStats();
      res.json({
        success: true,
        cache: stats,
      });
    } catch (error) {
      console.error('Error getting cache stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API endpoint to clear image cache
  app.post('/api/image/cache/clear', async (req, res) => {
    try {
      const olderThanDays = parseInt(req.query.days) || 7;
      const result = await imageOptimizer.clearCache(olderThanDays);
      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API endpoint for image analysis and optimization suggestions
  app.get('/api/image/analyze', async (req, res) => {
    try {
      let filePath = req.query.path;
      if (!filePath) {
        return res.status(400).json({ error: 'Missing path parameter' });
      }

      // Decode and resolve path (same security checks as /api/image)
      filePath = decodeURIComponent(filePath).replace(/\+/g, ' ');
      let resolvedPath = filePath;

      if (!path.isAbsolute(filePath)) {
        const homeDir = os.homedir();
        resolvedPath = path.join(homeDir, filePath);
      }

      resolvedPath = path.normalize(resolvedPath);
      const homeDir = os.homedir();
      const homeDirNormalized = path.normalize(homeDir);

      if (!resolvedPath.startsWith(homeDirNormalized)) {
        return res.status(403).json({ error: 'Access denied: File outside home directory' });
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const analysis = await imageOptimizer.analyzeAndSuggest(resolvedPath);

      res.json({
        success: true,
        analysis,
      });
    } catch (error) {
      console.error('Error analyzing image:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = createScreenshotRoutes;
