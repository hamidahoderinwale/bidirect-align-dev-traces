/**
 * Workspace-Based Segmentation
 * Segments traces based on workspace path changes
 */

import {
  SegmentationContext,
  SegmentationMethod,
  WorkspaceConfig,
} from './types';
import { BaseSegmentationDetector } from './base';

export class WorkspaceSegmentationDetector extends BaseSegmentationDetector {
  private config: WorkspaceConfig;

  constructor(config: WorkspaceConfig = {}) {
    super();
    this.config = config;
  }

  getMethod(): SegmentationMethod {
    return 'workspace';
  }

  isBoundary(context: SegmentationContext): boolean {
    const { currentEvent, previousEvent, currentSegment, config } = context;
    const workspaceConfig = config.workspace || this.config;

    // Check for workspace path change
    if (previousEvent && currentEvent.workspace_path) {
      if (previousEvent.workspace_path !== currentEvent.workspace_path) {
        // Only create boundary if current segment meets minimum events requirement
        return this.meetsMinimumEvents(
          currentSegment,
          workspaceConfig.minEventsPerSegment || config.minEventsPerSegment
        );
      }
    }

    // If segment has no workspace but current event has one, start new segment
    if (!currentSegment.metadata.workspace_path && currentEvent.workspace_path) {
      return this.meetsMinimumEvents(
        currentSegment,
        workspaceConfig.minEventsPerSegment || config.minEventsPerSegment
      );
    }

    return false;
  }
}



















