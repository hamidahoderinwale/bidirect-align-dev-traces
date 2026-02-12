/**
 * Temporal Segmentation
 * Segments traces based on time gaps between events
 */

import {
  SegmentationContext,
  SegmentationMethod,
  TemporalConfig,
} from './types';
import { BaseSegmentationDetector } from './base';

export class TemporalSegmentationDetector extends BaseSegmentationDetector {
  private config: TemporalConfig;

  constructor(config: TemporalConfig) {
    super();
    this.config = config;
  }

  getMethod(): SegmentationMethod {
    return 'temporal';
  }

  isBoundary(context: SegmentationContext): boolean {
    const { currentEvent, previousEvent, currentSegment, config } = context;
    const temporalConfig = config.temporal || this.config;

    // Calculate time gap
    const timeGapMinutes = this.getTimeGapMinutes(previousEvent, currentEvent);

    // Check if time gap exceeds threshold
    if (timeGapMinutes > temporalConfig.timeGapMinutes) {
      // Only create boundary if current segment meets minimum events requirement
      return this.meetsMinimumEvents(
        currentSegment,
        temporalConfig.minEventsPerSegment || config.minEventsPerSegment
      );
    }

    return false;
  }
}



















