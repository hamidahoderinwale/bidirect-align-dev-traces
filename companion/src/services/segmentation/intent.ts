/**
 * Intent-Based Segmentation
 * Segments traces based on intent changes
 */

import {
  SegmentationContext,
  SegmentationMethod,
  IntentConfig,
} from './types';
import { BaseSegmentationDetector } from './base';

export class IntentSegmentationDetector extends BaseSegmentationDetector {
  private config: IntentConfig;

  constructor(config: IntentConfig) {
    super();
    this.config = config;
  }

  getMethod(): SegmentationMethod {
    return 'intent';
  }

  isBoundary(context: SegmentationContext): boolean {
    const { currentEvent, currentSegment, config } = context;
    const intentConfig = config.intent || this.config;

    // Extract intents
    const currentIntent = this.extractIntent(currentEvent);
    const segmentIntent = currentSegment.metadata.intent;

    // If no intent in current event and requireExplicitIntent is true, skip
    if (intentConfig.requireExplicitIntent && !currentIntent) {
      return false;
    }

    // Check for intent change
    if (segmentIntent && currentIntent && segmentIntent !== currentIntent) {
      // Only create boundary if current segment meets minimum events requirement
      return this.meetsMinimumEvents(
        currentSegment,
        intentConfig.minEventsPerSegment || config.minEventsPerSegment
      );
    }

    // If segment has no intent but current event has one, start new segment
    if (!segmentIntent && currentIntent) {
      return this.meetsMinimumEvents(
        currentSegment,
        intentConfig.minEventsPerSegment || config.minEventsPerSegment
      );
    }

    return false;
  }
}



















