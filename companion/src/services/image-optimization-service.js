/**
 * Image Optimization Service
 * Provides comprehensive image processing with automatic compression,
 * format conversion, and responsive image generation
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class ImageOptimizationService {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(__dirname, '../../data/image-cache');
    this.enableCache = options.enableCache !== false;
    this.defaultQuality = options.defaultQuality || 85;
    this.defaultFormat = options.defaultFormat || 'webp';

    // Responsive image presets
    this.presets = {
      thumbnail: { width: 200, height: 150, quality: 75 },
      small: { width: 400, height: 300, quality: 80 },
      medium: { width: 800, height: 600, quality: 85 },
      large: { width: 1200, height: 900, quality: 85 },
      full: { width: 2000, height: 1500, quality: 90 },
    };

    this.initCache();
  }

  async initCache() {
    if (this.enableCache) {
      try {
        await fs.mkdir(this.cacheDir, { recursive: true });
      } catch (error) {
        console.error('[IMAGE-OPT] Failed to create cache directory:', error);
        this.enableCache = false;
      }
    }
  }

  /**
   * Generate cache key for an image with specific parameters
   */
  getCacheKey(imagePath, options) {
    const optionsStr = JSON.stringify({
      w: options.width,
      h: options.height,
      q: options.quality,
      fmt: options.format,
      fit: options.fit,
    });
    const hash = crypto
      .createHash('md5')
      .update(imagePath + optionsStr)
      .digest('hex');
    return `${hash}.${options.format || 'webp'}`;
  }

  /**
   * Check if cached version exists
   */
  async getCachedImage(cacheKey) {
    if (!this.enableCache) return null;

    try {
      const cachePath = path.join(this.cacheDir, cacheKey);
      const stats = await fs.stat(cachePath);

      // Cache valid for 24 hours
      if (Date.now() - stats.mtime.getTime() < 24 * 60 * 60 * 1000) {
        return await fs.readFile(cachePath);
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Save image to cache
   */
  async cacheImage(cacheKey, buffer) {
    if (!this.enableCache) return;

    try {
      const cachePath = path.join(this.cacheDir, cacheKey);
      await fs.writeFile(cachePath, buffer);
    } catch (error) {
      console.error('[IMAGE-OPT] Failed to cache image:', error);
    }
  }

  /**
   * Process and optimize an image
   * @param {string} imagePath - Path to source image
   * @param {Object} options - Processing options
   * @returns {Object} { buffer, metadata, stats }
   */
  async processImage(imagePath, options = {}) {
    const {
      width = null,
      height = null,
      quality = this.defaultQuality,
      format = this.defaultFormat,
      fit = 'inside',
      preset = null,
    } = options;

    // Apply preset if specified
    let finalOptions = { width, height, quality, format, fit };
    if (preset && this.presets[preset]) {
      finalOptions = { ...this.presets[preset], ...finalOptions };
    }

    // Check cache first
    const cacheKey = this.getCacheKey(imagePath, finalOptions);
    const cached = await this.getCachedImage(cacheKey);
    if (cached) {
      const metadata = await sharp(cached).metadata();
      return {
        buffer: cached,
        metadata,
        cached: true,
        stats: {
          originalSize: 0,
          processedSize: cached.length,
          compressionRatio: 0,
        },
      };
    }

    // Get original file stats
    const originalStats = await fs.stat(imagePath);
    const originalSize = originalStats.size;

    // Process image with Sharp
    let image = sharp(imagePath);

    // Get original metadata
    const originalMetadata = await image.metadata();

    // Apply resizing if requested
    if (finalOptions.width || finalOptions.height) {
      image = image.resize(finalOptions.width, finalOptions.height, {
        fit: finalOptions.fit,
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3, // High-quality downsampling
      });
    }

    // Apply format-specific optimizations
    switch (finalOptions.format) {
      case 'webp':
        image = image.webp({
          quality: finalOptions.quality,
          effort: 4,
          smartSubsample: true,
          nearLossless: finalOptions.quality > 90,
        });
        break;

      case 'jpeg':
      case 'jpg':
        image = image.jpeg({
          quality: finalOptions.quality,
          progressive: true,
          mozjpeg: true,
          chromaSubsampling: '4:2:0',
        });
        break;

      case 'png':
        image = image.png({
          quality: finalOptions.quality,
          compressionLevel: 9,
          adaptiveFiltering: true,
          palette: finalOptions.quality < 90, // Use palette for smaller files at lower quality
        });
        break;

      case 'avif':
        image = image.avif({
          quality: finalOptions.quality,
          effort: 4,
        });
        break;

      default:
        // Auto-detect best format
        image = image.webp({
          quality: finalOptions.quality,
          effort: 4,
        });
    }

    // Process the image
    const processedBuffer = await image.toBuffer();
    const processedMetadata = await sharp(processedBuffer).metadata();

    // Calculate stats
    const processedSize = processedBuffer.length;
    const compressionRatio = ((originalSize - processedSize) / originalSize) * 100;

    // Cache the processed image
    await this.cacheImage(cacheKey, processedBuffer);

    return {
      buffer: processedBuffer,
      metadata: processedMetadata,
      cached: false,
      stats: {
        originalSize,
        processedSize,
        compressionRatio: compressionRatio.toFixed(2),
        originalDimensions: `${originalMetadata.width}x${originalMetadata.height}`,
        processedDimensions: `${processedMetadata.width}x${processedMetadata.height}`,
      },
    };
  }

  /**
   * Generate multiple responsive versions of an image
   * @param {string} imagePath - Path to source image
   * @param {Array} presets - Array of preset names
   * @returns {Object} Map of preset names to processed images
   */
  async generateResponsiveSet(imagePath, presets = ['thumbnail', 'small', 'medium', 'large']) {
    const results = {};

    for (const preset of presets) {
      try {
        results[preset] = await this.processImage(imagePath, { preset });
      } catch (error) {
        console.error(`[IMAGE-OPT] Failed to generate ${preset} version:`, error);
        results[preset] = { error: error.message };
      }
    }

    return results;
  }

  /**
   * Analyze image and suggest optimal settings
   * @param {string} imagePath - Path to source image
   * @returns {Object} Suggested optimization settings
   */
  async analyzeAndSuggest(imagePath) {
    const image = sharp(imagePath);
    const metadata = await image.metadata();
    const stats = await fs.stat(imagePath);

    const suggestions = {
      currentSize: stats.size,
      currentDimensions: `${metadata.width}x${metadata.height}`,
      format: metadata.format,
      suggestions: [],
    };

    // Suggest resizing if image is very large
    if (metadata.width > 2000 || metadata.height > 2000) {
      suggestions.suggestions.push({
        type: 'resize',
        reason: 'Image dimensions are very large',
        recommendation: 'Resize to 2000x1500 for web use',
        potentialSavings: '~60-70%',
      });
    }

    // Suggest format conversion
    if (metadata.format !== 'webp' && metadata.format !== 'avif') {
      suggestions.suggestions.push({
        type: 'format',
        reason: `Current format (${metadata.format}) is not optimal`,
        recommendation: 'Convert to WebP for better compression',
        potentialSavings: '~30-50%',
      });
    }

    // Suggest quality reduction for very high quality images
    if (stats.size > 500 * 1024) {
      // > 500KB
      suggestions.suggestions.push({
        type: 'quality',
        reason: 'File size is large',
        recommendation: 'Reduce quality to 80-85% (imperceptible difference)',
        potentialSavings: '~20-40%',
      });
    }

    return suggestions;
  }

  /**
   * Batch process multiple images
   * @param {Array} imagePaths - Array of image paths
   * @param {Object} options - Processing options
   * @returns {Array} Array of processed results
   */
  async batchProcess(imagePaths, options = {}) {
    const results = [];

    for (const imagePath of imagePaths) {
      try {
        const result = await this.processImage(imagePath, options);
        results.push({
          path: imagePath,
          success: true,
          ...result,
        });
      } catch (error) {
        results.push({
          path: imagePath,
          success: false,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Clear cache
   * @param {number} olderThanDays - Clear files older than X days (default: 7)
   */
  async clearCache(olderThanDays = 7) {
    if (!this.enableCache) return { cleared: 0 };

    try {
      const files = await fs.readdir(this.cacheDir);
      const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      let cleared = 0;

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          cleared++;
        }
      }

      return { cleared, total: files.length };
    } catch (error) {
      console.error('[IMAGE-OPT] Failed to clear cache:', error);
      return { error: error.message };
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    if (!this.enableCache) {
      return { enabled: false };
    }

    try {
      const files = await fs.readdir(this.cacheDir);
      let totalSize = 0;

      for (const file of files) {
        const stats = await fs.stat(path.join(this.cacheDir, file));
        totalSize += stats.size;
      }

      return {
        enabled: true,
        fileCount: files.length,
        totalSize,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        cacheDir: this.cacheDir,
      };
    } catch (error) {
      return { enabled: true, error: error.message };
    }
  }
}

module.exports = ImageOptimizationService;
