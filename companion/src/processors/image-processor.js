/**
 * Image Processor
 * Handles image processing operations using Sharp
 * - Thumbnail generation
 * - Metadata extraction
 * - Perceptual hashing for similarity detection
 * - Image optimization
 * - General image validation and format support
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class ImageProcessor {
  constructor(options = {}) {
    this.thumbnailDir = options.thumbnailDir || path.join(__dirname, '../../data/thumbnails');
    this.maxThumbnailSize = options.maxThumbnailSize || { width: 300, height: 200 };
    this.thumbnailQuality = options.thumbnailQuality || 80;
    this.thumbnailFormat = options.thumbnailFormat || 'webp';
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 500; // ms
    this.silentErrors = options.silentErrors !== false; // Default to true to reduce noise

    // Supported image formats
    this.supportedFormats = new Set([
      'jpeg',
      'jpg',
      'png',
      'webp',
      'gif',
      'svg',
      'tiff',
      'tif',
      'bmp',
      'avif',
      'heic',
      'heif',
      'raw',
      'ico',
    ]);

    // Ensure thumbnail directory exists
    if (!fs.existsSync(this.thumbnailDir)) {
      fs.mkdirSync(this.thumbnailDir, { recursive: true });
    }
  }

  /**
   * Validate if file is a valid image before processing
   */
  async validateImageFile(imagePath) {
    try {
      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        return { valid: false, error: 'File does not exist' };
      }

      // Check if it's a file (not directory)
      const stats = fs.statSync(imagePath);
      if (!stats.isFile()) {
        return { valid: false, error: 'Path is not a file' };
      }

      // Check file size (must be > 0)
      if (stats.size === 0) {
        return { valid: false, error: 'File is empty' };
      }

      // Check extension
      const ext = path.extname(imagePath).toLowerCase().slice(1);
      if (!this.supportedFormats.has(ext)) {
        return { valid: false, error: `Unsupported file extension: .${ext}` };
      }

      // Try to read file metadata with Sharp to validate it's actually an image
      try {
        const metadata = await sharp(imagePath).metadata();
        if (!metadata.format) {
          return { valid: false, error: 'Unable to determine image format' };
        }
        return { valid: true, format: metadata.format, metadata };
      } catch (sharpError) {
        // Sharp error usually means it's not a valid image
        const errorMsg = sharpError.message || 'Invalid image file';
        if (
          errorMsg.includes('unsupported image format') ||
          errorMsg.includes('Input file contains unsupported image format')
        ) {
          return { valid: false, error: 'Unsupported or corrupted image format' };
        }
        return { valid: false, error: errorMsg };
      }
    } catch (error) {
      return { valid: false, error: error.message || 'Validation failed' };
    }
  }

  /**
   * Retry wrapper for file operations that might fail due to file locking
   */
  async retryOperation(operation, retries = this.maxRetries) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        // Only retry on specific errors (file locking, EACCES, etc.)
        if (
          attempt < retries - 1 &&
          (error.code === 'EACCES' ||
            error.code === 'EBUSY' ||
            error.message.includes('locked') ||
            error.message.includes('in use'))
        ) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelay * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  /**
   * Log error only if not in silent mode
   */
  logError(message, error) {
    if (!this.silentErrors) {
      console.error(`[IMAGE] ${message}:`, error?.message || error);
    }
  }

  /**
   * Generate thumbnail for an image
   */
  async generateThumbnail(imagePath, options = {}) {
    const {
      width = this.maxThumbnailSize.width,
      height = this.maxThumbnailSize.height,
      quality = this.thumbnailQuality,
      format = this.thumbnailFormat,
    } = options;

    try {
      // Validate image first
      const validation = await this.validateImageFile(imagePath);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          skipped: true,
        };
      }

      const fileName = path.basename(imagePath, path.extname(imagePath));
      const hash = crypto.createHash('md5').update(imagePath).digest('hex').substring(0, 8);
      const thumbnailPath = path.join(this.thumbnailDir, `${fileName}_${hash}_thumb.${format}`);

      // Check if thumbnail already exists
      if (fs.existsSync(thumbnailPath)) {
        return {
          success: true,
          thumbnailPath,
          cached: true,
        };
      }

      // Use retry logic for file operations
      await this.retryOperation(async () => {
        const image = sharp(imagePath);

        // Handle SVG differently (convert to raster)
        if (validation.format === 'svg') {
          await image
            .resize(width, height, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .png()
            .toFile(thumbnailPath.replace(/\.webp$/, '.png'));
        } else {
          await image
            .resize(width, height, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .webp({ quality })
            .toFile(thumbnailPath);
        }
      });

      return {
        success: true,
        thumbnailPath,
        cached: false,
      };
    } catch (error) {
      // Only log if it's not a validation/skip error
      if (!error.skipped) {
        this.logError('Error generating thumbnail', error);
      }
      return {
        success: false,
        error: error.message || error.error || 'Unknown error',
        skipped: error.skipped || false,
      };
    }
  }

  /**
   * Extract image metadata
   */
  async extractMetadata(imagePath) {
    try {
      // Validate image first
      const validation = await this.validateImageFile(imagePath);
      if (!validation.valid) {
        return null;
      }

      const stats = fs.statSync(imagePath);

      // Use retry logic
      const metadata = await this.retryOperation(async () => {
        return await sharp(imagePath).metadata();
      });

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: stats.size,
        hasAlpha: metadata.hasAlpha || false,
        colorSpace: metadata.space,
        channels: metadata.channels,
        density: metadata.density,
        orientation: metadata.orientation,
        exif: metadata.exif ? 'present' : null,
      };
    } catch (error) {
      // Only log unexpected errors (validation errors are expected)
      if (
        !error.message?.includes('unsupported') &&
        !error.message?.includes('corrupted') &&
        !error.message?.includes('Invalid image')
      ) {
        this.logError('Error extracting metadata', error);
      }
      return null;
    }
  }

  /**
   * Compute perceptual hash for similarity detection
   * Uses difference hash (dHash) algorithm
   */
  async computePerceptualHash(imagePath) {
    try {
      // Validate image first
      const validation = await this.validateImageFile(imagePath);
      if (!validation.valid) {
        return null;
      }

      // Skip SVG for perceptual hashing (vector format)
      if (validation.format === 'svg') {
        return null;
      }

      // Resize to 9x8 for dHash (8x8 + 1 for comparison)
      const buffer = await this.retryOperation(async () => {
        return await sharp(imagePath).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
      });

      // Compute difference hash
      let hash = 0n;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const left = buffer[row * 9 + col];
          const right = buffer[row * 9 + col + 1];
          hash = (hash << 1n) | (left < right ? 1n : 0n);
        }
      }

      return hash.toString(16).padStart(16, '0');
    } catch (error) {
      // Only log unexpected errors
      if (
        !error.message?.includes('unsupported') &&
        !error.message?.includes('corrupted') &&
        !error.message?.includes('Invalid image')
      ) {
        this.logError('Error computing perceptual hash', error);
      }
      return null;
    }
  }

  /**
   * Compare two images using perceptual hash
   * Returns similarity score (0-1, where 1 is identical)
   */
  async compareImages(imagePath1, imagePath2) {
    try {
      const hash1 = await this.computePerceptualHash(imagePath1);
      const hash2 = await this.computePerceptualHash(imagePath2);

      if (!hash1 || !hash2) {
        return null;
      }

      const distance = this.hammingDistance(hash1, hash2);
      const maxDistance = 64; // 8x8 = 64 bits
      const similarity = 1 - distance / maxDistance;

      return {
        similarity: Math.max(0, similarity),
        distance,
        hash1,
        hash2,
      };
    } catch (error) {
      console.error('[IMAGE] Error comparing images:', error.message);
      return null;
    }
  }

  /**
   * Compare two perceptual hashes
   */
  hammingDistance(hash1, hash2) {
    const bin1 = BigInt('0x' + hash1);
    const bin2 = BigInt('0x' + hash2);
    const diff = bin1 ^ bin2;

    let distance = 0;
    let temp = diff;
    while (temp > 0n) {
      distance += Number(temp & 1n);
      temp = temp >> 1n;
    }

    return distance;
  }

  /**
   * Optimize image (convert to WebP with compression)
   */
  async optimizeImage(imagePath, outputPath = null) {
    try {
      // Validate image first
      const validation = await this.validateImageFile(imagePath);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          skipped: true,
        };
      }

      const fileName = path.basename(imagePath, path.extname(imagePath));
      const output = outputPath || path.join(path.dirname(imagePath), `${fileName}_optimized.webp`);

      // Use retry logic
      await this.retryOperation(async () => {
        const image = sharp(imagePath);

        // Handle SVG differently
        if (validation.format === 'svg') {
          await image.png().toFile(output.replace(/\.webp$/, '.png'));
        } else {
          await image.webp({ quality: 85, effort: 6 }).toFile(output);
        }
      });

      const originalSize = fs.statSync(imagePath).size;
      const optimizedSize = fs.statSync(output).size;
      const savings = ((originalSize - optimizedSize) / originalSize) * 100;

      return {
        success: true,
        outputPath: output,
        originalSize,
        optimizedSize,
        savings: savings.toFixed(2),
      };
    } catch (error) {
      if (!error.skipped) {
        this.logError('Error optimizing image', error);
      }
      return {
        success: false,
        error: error.message || error.error || 'Unknown error',
        skipped: error.skipped || false,
      };
    }
  }

  /**
   * Process image and return all metadata
   * General-purpose image processing with validation and error handling
   */
  async processImage(imagePath, options = {}) {
    const {
      generateThumbnail = true,
      extractMetadata = true,
      computeHash = true,
      skipValidation = false,
    } = options;

    const result = {
      path: imagePath,
      success: false,
      skipped: false,
    };

    try {
      // Validate image first (unless explicitly skipped)
      if (!skipValidation) {
        const validation = await this.validateImageFile(imagePath);
        if (!validation.valid) {
          result.error = validation.error;
          result.skipped = true;
          return result;
        }
        result.format = validation.format;
      }

      // Process in parallel where possible
      const promises = [];

      if (extractMetadata) {
        promises.push(
          this.extractMetadata(imagePath)
            .then((metadata) => {
              result.metadata = metadata;
            })
            .catch((err) => {
              // Metadata extraction failure is not critical
              result.metadata = null;
            })
        );
      }

      if (generateThumbnail) {
        promises.push(
          this.generateThumbnail(imagePath)
            .then((thumbnail) => {
              result.thumbnail = thumbnail;
            })
            .catch((err) => {
              // Thumbnail generation failure is not critical
              result.thumbnail = { success: false, error: err.message };
            })
        );
      }

      if (computeHash) {
        promises.push(
          this.computePerceptualHash(imagePath)
            .then((hash) => {
              result.perceptualHash = hash;
            })
            .catch((err) => {
              // Hash computation failure is not critical
              result.perceptualHash = null;
            })
        );
      }

      // Wait for all operations to complete
      await Promise.allSettled(promises);

      // Consider it successful if at least one operation succeeded
      result.success =
        result.metadata !== null ||
        (result.thumbnail && result.thumbnail.success) ||
        result.perceptualHash !== null;

      return result;
    } catch (error) {
      // Only log unexpected errors
      if (!result.skipped && !error.message?.includes('unsupported')) {
        this.logError('Error processing image', error);
      }
      result.error = error.message || 'Unknown error';
      return result;
    }
  }

  /**
   * Batch process multiple images
   */
  async processImages(imagePaths, options = {}) {
    const results = [];
    const { concurrency = 5 } = options;

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < imagePaths.length; i += concurrency) {
      const batch = imagePaths.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map((imagePath) => this.processImage(imagePath, options))
      );

      results.push(
        ...batchResults.map((result, idx) => ({
          path: batch[idx],
          ...(result.status === 'fulfilled'
            ? result.value
            : {
                success: false,
                error: result.reason?.message || 'Processing failed',
              }),
        }))
      );
    }

    return results;
  }

  /**
   * Get supported formats
   */
  getSupportedFormats() {
    return Array.from(this.supportedFormats);
  }

  /**
   * Check if format is supported
   */
  isFormatSupported(format) {
    return this.supportedFormats.has(format.toLowerCase());
  }
}

module.exports = ImageProcessor;
