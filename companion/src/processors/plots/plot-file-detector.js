/**
 * Plot File Detector
 * Detects when scripts generate plot/image files
 * - Monitors common output directories
 * - Detects plot generation from code patterns
 * - Links plots to source scripts
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PlotFileDetector {
  constructor(imageProcessor = null) {
    this.imageProcessor = imageProcessor;
    this.commonOutputDirs = [
      'plots',
      'figures',
      'images',
      'output',
      'results',
      'visualizations',
      'charts',
      'graphs',
    ];
    this.plotExtensions = ['.png', '.jpg', '.jpeg', '.svg', '.pdf', '.webp'];
  }

  /**
   * Detect plot generation patterns in code
   */
  detectPlotPatterns(code) {
    const patterns = {
      matplotlib: [
        /plt\.savefig\(['"`]([^'"`]+)['"`]/g,
        /fig\.savefig\(['"`]([^'"`]+)['"`]/g,
        /savefig\(['"`]([^'"`]+)['"`]/g,
      ],
      plotly: [
        /fig\.write_image\(['"`]([^'"`]+)['"`]/g,
        /fig\.write_html\(['"`]([^'"`]+)['"`]/g,
        /pio\.write_image\([^,]+,\s*['"`]([^'"`]+)['"`]/g,
      ],
      seaborn: [/sns\.savefig\(['"`]([^'"`]+)['"`]/g],
      general: [/\.to_file\(['"`]([^'"`]+)['"`]/g, /\.save\(['"`]([^'"`]+)['"`]/g],
    };

    const detectedPaths = [];
    const detectedLibraries = new Set();

    Object.entries(patterns).forEach(([library, regexList]) => {
      regexList.forEach((regex) => {
        let match;
        while ((match = regex.exec(code)) !== null) {
          const filePath = this.cleanPath(match[1]);
          if (this.isPlotFile(filePath)) {
            detectedPaths.push({
              path: filePath,
              library: library === 'general' ? this.detectLibraryFromCode(code) : library,
              line: this.getLineNumber(code, match.index),
            });
            if (library !== 'general') {
              detectedLibraries.add(library);
            }
          }
        }
      });
    });

    return {
      paths: detectedPaths,
      libraries: Array.from(detectedLibraries),
    };
  }

  /**
   * Check if file path is a plot file
   */
  isPlotFile(filePath) {
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    return this.plotExtensions.includes(ext);
  }

  /**
   * Clean and normalize file path
   */
  cleanPath(filePath) {
    if (!filePath) return null;
    return filePath.replace(/['"`]/g, '').trim();
  }

  /**
   * Get line number from code index
   */
  getLineNumber(code, index) {
    return code.substring(0, index).split('\n').length;
  }

  /**
   * Detect library from code content
   */
  detectLibraryFromCode(code) {
    const codeLower = code.toLowerCase();

    if (
      codeLower.includes('matplotlib') ||
      codeLower.includes('plt.') ||
      codeLower.includes('pyplot')
    ) {
      return 'matplotlib';
    }
    if (codeLower.includes('plotly') || codeLower.includes('px.') || codeLower.includes('go.')) {
      return 'plotly';
    }
    if (codeLower.includes('seaborn') || codeLower.includes('sns.')) {
      return 'seaborn';
    }
    if (codeLower.includes('bokeh')) {
      return 'bokeh';
    }

    return 'unknown';
  }

  /**
   * Resolve plot file path relative to script location
   */
  resolvePlotPath(plotPath, scriptPath) {
    if (path.isAbsolute(plotPath)) {
      return plotPath;
    }

    // Try relative to script directory
    const scriptDir = path.dirname(scriptPath);
    const resolved = path.join(scriptDir, plotPath);

    if (fs.existsSync(resolved)) {
      return path.resolve(resolved);
    }

    // Try relative to current working directory
    const cwd = process.cwd();
    const cwdResolved = path.join(cwd, plotPath);

    if (fs.existsSync(cwdResolved)) {
      return path.resolve(cwdResolved);
    }

    // Try common output directories
    for (const dir of this.commonOutputDirs) {
      const dirPath = path.join(scriptDir, dir, path.basename(plotPath));
      if (fs.existsSync(dirPath)) {
        return path.resolve(dirPath);
      }
    }

    return null;
  }

  /**
   * Detect newly created plot files in a directory
   */
  async detectNewPlotFiles(directory, since = null) {
    const plotFiles = [];

    try {
      if (!fs.existsSync(directory)) {
        return plotFiles;
      }

      const files = fs.readdirSync(directory, { withFileTypes: true });

      for (const file of files) {
        const filePath = path.join(directory, file.name);

        if (file.isDirectory()) {
          // Recursively check subdirectories
          const subPlots = await this.detectNewPlotFiles(filePath, since);
          plotFiles.push(...subPlots);
        } else if (file.isFile() && this.isPlotFile(filePath)) {
          const stats = fs.statSync(filePath);

          // Check if file was created/modified since timestamp
          if (!since || stats.mtime.getTime() > since) {
            plotFiles.push({
              path: filePath,
              name: file.name,
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              extension: path.extname(filePath),
            });
          }
        }
      }
    } catch (error) {
      console.error('[PLOT] Error detecting plot files:', error.message);
    }

    return plotFiles;
  }

  /**
   * Create plot record from file
   */
  async createPlotFromFile(filePath, context = {}) {
    try {
      const stats = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();

      const plot = {
        id: crypto.randomUUID(),
        type: 'file_output',
        format: ext.substring(1),
        source: 'script',
        filePath: filePath,
        fileName: path.basename(filePath),
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        scriptPath: context.scriptPath || null,
        terminalCommand: context.terminalCommand || null,
        workspacePath: context.workspacePath || null,
        library: context.library || 'unknown',
      };

      // Process image if processor available
      if (this.imageProcessor && this.isImageFile(filePath)) {
        const processed = await this.imageProcessor.processImage(filePath, {
          generateThumbnail: true,
          extractMetadata: true,
          computeHash: true,
        });

        if (processed.metadata) {
          plot.width = processed.metadata.width;
          plot.height = processed.metadata.height;
          plot.imageMetadata = processed.metadata;
        }

        if (processed.thumbnail) {
          plot.thumbnailPath = processed.thumbnail.thumbnailPath;
        }

        if (processed.perceptualHash) {
          plot.perceptualHash = processed.perceptualHash;
        }
      }

      return plot;
    } catch (error) {
      console.error('[PLOT] Error creating plot from file:', error.message);
      return null;
    }
  }

  /**
   * Check if file is an image (not PDF)
   */
  isImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'].includes(ext);
  }
}

module.exports = PlotFileDetector;
