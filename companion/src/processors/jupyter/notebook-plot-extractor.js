/**
 * Jupyter Notebook Plot Extractor
 * Extracts plot outputs from Jupyter notebook cells
 * - Detects matplotlib, plotly, and other visualization outputs
 * - Extracts base64 image data
 * - Captures cell execution context
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class NotebookPlotExtractor {
  constructor(imageProcessor = null) {
    this.imageProcessor = imageProcessor;
  }

  /**
   * Extract all plots from a notebook file
   */
  async extractPlotsFromNotebook(notebookPath) {
    try {
      if (!fs.existsSync(notebookPath)) {
        return { success: false, error: 'Notebook file not found', plots: [] };
      }

      const content = fs.readFileSync(notebookPath, 'utf8');
      const notebook = JSON.parse(content);

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return { success: false, error: 'Invalid notebook structure', plots: [] };
      }

      const plots = [];
      const notebookMetadata = {
        path: notebookPath,
        name: path.basename(notebookPath),
        kernel: notebook.metadata?.kernelspec?.name || 'unknown',
        language: notebook.metadata?.language_info?.name || 'python',
      };

      notebook.cells.forEach((cell, cellIndex) => {
        if (cell.cell_type === 'code' && cell.outputs) {
          const cellPlots = this.extractPlotsFromCell(cell, cellIndex, notebookMetadata);
          plots.push(...cellPlots);
        }
      });

      return {
        success: true,
        plots,
        count: plots.length,
        notebook: notebookMetadata,
      };
    } catch (error) {
      console.error('[NOTEBOOK] Error extracting plots:', error.message);
      return {
        success: false,
        error: error.message,
        plots: [],
      };
    }
  }

  /**
   * Extract plots from a single cell
   */
  extractPlotsFromCell(cell, cellIndex, notebookMetadata) {
    const plots = [];
    const cellSource = Array.isArray(cell.source) ? cell.source.join('') : cell.source || '';
    const executionCount = cell.execution_count || null;

    // Extract execution timestamp
    const executionTime = this.extractCellExecutionTime(cell);

    cell.outputs.forEach((output, outputIndex) => {
      if (output.output_type === 'display_data' || output.output_type === 'execute_result') {
        const plot = this.extractPlotFromOutput(output, outputIndex, {
          cellIndex,
          cellSource,
          executionCount,
          executionTime,
          notebookMetadata,
        });

        if (plot) {
          plots.push(plot);
        }
      }
    });

    return plots;
  }

  /**
   * Extract plot from a single output
   */
  extractPlotFromOutput(output, outputIndex, context) {
    const { cellIndex, cellSource, executionCount, executionTime, notebookMetadata } = context;

    // Check for matplotlib PNG output
    if (output.data && output.data['image/png']) {
      const base64Data = output.data['image/png'];
      const imageBuffer = Buffer.from(base64Data, 'base64');

      return {
        id: crypto.randomUUID(),
        type: 'matplotlib',
        format: 'png',
        source: 'notebook_cell',
        base64Data: base64Data,
        imageBuffer: imageBuffer,
        outputIndex,
        cellIndex,
        executionCount,
        executionTime,
        notebookPath: notebookMetadata.path,
        notebookName: notebookMetadata.name,
        cellSource: cellSource.substring(0, 500), // Limit source length
        library: this.detectLibraryFromCode(cellSource),
        metadata: {
          outputType: output.output_type,
          hasMetadata: !!output.metadata,
        },
      };
    }

    // Check for plotly JSON output
    if (output.data && output.data['application/vnd.plotly.v1+json']) {
      const plotlyData = output.data['application/vnd.plotly.v1+json'];

      return {
        id: crypto.randomUUID(),
        type: 'plotly',
        format: 'json',
        source: 'notebook_cell',
        plotlyData: typeof plotlyData === 'string' ? JSON.parse(plotlyData) : plotlyData,
        outputIndex,
        cellIndex,
        executionCount,
        executionTime,
        notebookPath: notebookMetadata.path,
        notebookName: notebookMetadata.name,
        cellSource: cellSource.substring(0, 500),
        library: 'plotly',
        metadata: {
          outputType: output.output_type,
          hasMetadata: !!output.metadata,
        },
      };
    }

    // Check for SVG output
    if (output.data && output.data['image/svg+xml']) {
      const svgData = output.data['image/svg+xml'];
      const svgString = Array.isArray(svgData) ? svgData.join('') : svgData;

      return {
        id: crypto.randomUUID(),
        type: 'svg',
        format: 'svg',
        source: 'notebook_cell',
        svgData: svgString,
        outputIndex,
        cellIndex,
        executionCount,
        executionTime,
        notebookPath: notebookMetadata.path,
        notebookName: notebookMetadata.name,
        cellSource: cellSource.substring(0, 500),
        library: this.detectLibraryFromCode(cellSource),
        metadata: {
          outputType: output.output_type,
          hasMetadata: !!output.metadata,
        },
      };
    }

    return null;
  }

  /**
   * Detect visualization library from code
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
    if (codeLower.includes('altair')) {
      return 'altair';
    }

    return 'unknown';
  }

  /**
   * Extract execution time from cell metadata
   */
  extractCellExecutionTime(cell) {
    if (cell.metadata?.execution?.iopub?.timestamp) {
      return new Date(cell.metadata.execution.iopub.timestamp);
    }
    if (cell.metadata?.executed_at) {
      return new Date(cell.metadata.executed_at);
    }
    return new Date();
  }

  /**
   * Save plot image to file (for base64 images)
   */
  async savePlotImage(plot, outputDir) {
    if (!plot.imageBuffer) {
      return { success: false, error: 'No image buffer available' };
    }

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const fileName = `plot_${plot.id}.${plot.format}`;
      const filePath = path.join(outputDir, fileName);

      fs.writeFileSync(filePath, plot.imageBuffer);

      return {
        success: true,
        filePath,
        fileName,
      };
    } catch (error) {
      console.error('[NOTEBOOK] Error saving plot image:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process plot with image processor (generate thumbnail, extract metadata)
   */
  async processPlot(plot, outputDir = null) {
    if (!this.imageProcessor || !plot.imageBuffer) {
      return plot;
    }

    try {
      // Save temporary file for processing
      const tempDir = outputDir || require('os').tmpdir();
      const tempPath = path.join(tempDir, `temp_${plot.id}.${plot.format}`);
      fs.writeFileSync(tempPath, plot.imageBuffer);

      // Process image
      const processed = await this.imageProcessor.processImage(tempPath, {
        generateThumbnail: true,
        extractMetadata: true,
        computeHash: true,
      });

      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      // Add processed data to plot
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

      return plot;
    } catch (error) {
      console.error('[NOTEBOOK] Error processing plot:', error.message);
      return plot;
    }
  }
}

module.exports = NotebookPlotExtractor;
