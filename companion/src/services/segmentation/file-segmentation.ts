/**
 * File-Based Segmentation
 * Segments traces based on file set changes
 */

import {
  SegmentationContext,
  SegmentationMethod,
  FileBasedConfig,
} from './types';
import { BaseSegmentationDetector } from './base';

export class FileSegmentationDetector extends BaseSegmentationDetector {
  private config: FileBasedConfig;

  constructor(config: FileBasedConfig) {
    super();
    this.config = config;
  }

  getMethod(): SegmentationMethod {
    return 'file';
  }

  isBoundary(context: SegmentationContext): boolean {
    const { currentEvent, currentSegment, config } = context;
    const fileConfig = config.file || this.config;

    // Extract files from current event
    const currentFiles = this.extractFiles(currentEvent);
    if (currentFiles.length === 0) {
      return false; // No files in event, can't determine boundary
    }

    // Filter files based on fileSet configuration
    const filteredCurrentFiles = this.filterFiles(
      currentFiles,
      fileConfig.fileSet,
      fileConfig.specificFiles || []
    );

    if (filteredCurrentFiles.length === 0) {
      return false; // No relevant files after filtering
    }

    // Get files from current segment
    const segmentFiles = Array.from(currentSegment.metadata.files || []);

    // Filter segment files based on configuration
    const filteredSegmentFiles = this.filterFiles(
      segmentFiles,
      fileConfig.fileSet,
      fileConfig.specificFiles || []
    );

    if (filteredSegmentFiles.length === 0) {
      // Segment has no files yet, add current files and continue
      return false;
    }

    // Calculate overlap ratio
    const overlapRatio = this.calculateFileOverlap(
      filteredSegmentFiles,
      filteredCurrentFiles
    );

    // Check if overlap is below threshold
    if (overlapRatio < fileConfig.overlapThreshold) {
      // Only create boundary if current segment meets minimum events requirement
      return this.meetsMinimumEvents(
        currentSegment,
        fileConfig.minEventsPerSegment || config.minEventsPerSegment
      );
    }

    return false;
  }

  /**
   * Filter files based on fileSet configuration
   */
  private filterFiles(
    files: string[],
    fileSet: 'workspace' | 'specific',
    specificFiles: string[]
  ): string[] {
    if (fileSet === 'workspace') {
      // Return all files (workspace includes everything)
      return files;
    } else if (fileSet === 'specific') {
      // Only return files that match specific files list
      // Match if file path contains or is contained by any specific file
      return files.filter((file) =>
        specificFiles.some((spec) => {
          const normalizedFile = file.toLowerCase();
          const normalizedSpec = spec.toLowerCase();
          return normalizedFile.includes(normalizedSpec) || normalizedSpec.includes(normalizedFile);
        })
      );
    }
    return files;
  }
}

