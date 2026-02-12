/**
 * Segmentation Module
 * Exports all segmentation types, detectors, and the main segmenter
 */

export * from './types';
export * from './base';
export * from './temporal';
export * from './intent';
export * from './file-segmentation';
export * from './workspace';
export * from './topic';
export * from './hybrid';
export * from './segmenter';
export * from './config-validator';
export * from './presets';
export * from './config-builder';

// Convenience factory function
import { Segmenter, SegmentationConfig } from './segmenter';
import { SegmentationConfigValidator } from './config-validator';

export function createSegmenter(config: SegmentationConfig): Segmenter {
  // Validate before creating
  const validation = SegmentationConfigValidator.validate(config);
  if (!validation.valid) {
    throw new Error(`Invalid segmentation config: ${validation.errors.join(', ')}`);
  }
  return new Segmenter(config);
}

