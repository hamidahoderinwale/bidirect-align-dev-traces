/**
 * Base Segmentation Interface
 * Common utilities and base class for segmentation methods
 */

import {
  Trace,
  Segment,
  SegmentationContext,
  SegmentationBoundaryDetector,
  SegmentationMethod,
} from './types';

export abstract class BaseSegmentationDetector implements SegmentationBoundaryDetector {
  abstract isBoundary(context: SegmentationContext): boolean;
  abstract getMethod(): SegmentationMethod;

  /**
   * Calculate time gap in minutes between two events
   */
  protected getTimeGapMinutes(event1: Trace | null, event2: Trace): number {
    if (!event1) return 0;
    const time1 = new Date(event1.timestamp).getTime();
    const time2 = new Date(event2.timestamp).getTime();
    return (time2 - time1) / (1000 * 60);
  }

  /**
   * Extract files from an event
   */
  protected extractFiles(event: Trace): string[] {
    const files: string[] = [];
    const details = event.details || {};

    if (event.workspace_path) {
      // Normalize workspace-relative paths
      const workspace = event.workspace_path;
      const addFile = (path: string) => {
        if (path && !files.includes(path)) {
          files.push(path);
        }
      };

      addFile(details.file_path);
      addFile(details.file);
      addFile(details.target);
    }

    return files;
  }

  /**
   * Extract intent from an event
   */
  protected extractIntent(event: Trace): string | null {
    return event.intent || event.annotation || null;
  }

  /**
   * Extract topic from an event
   */
  protected extractTopic(event: Trace): string | null {
    return event.details?.topic || null;
  }

  /**
   * Calculate file overlap ratio between two sets
   */
  protected calculateFileOverlap(files1: string[], files2: string[]): number {
    if (files1.length === 0 || files2.length === 0) return 0;

    const set1 = new Set(files1);
    const set2 = new Set(files2);
    const intersection = files1.filter((f) => set2.has(f)).length;
    const union = new Set([...files1, ...files2]).size;

    return intersection / union; // Jaccard similarity
  }

  /**
   * Check if minimum events requirement is met
   */
  protected meetsMinimumEvents(
    segment: Segment,
    minEvents?: number
  ): boolean {
    if (minEvents === undefined) return true;
    return segment.events.length >= minEvents;
  }
}



















