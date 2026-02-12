/**
 * Main Segmentation Service
 * Orchestrates segmentation using configured methods
 */

import {
  Trace,
  Segment,
  SegmentationResult,
  SegmentationConfig,
  SegmentationMethod,
  SegmentationContext,
} from './types';
import { BaseSegmentationDetector } from './base';
import { TemporalSegmentationDetector } from './temporal';
import { IntentSegmentationDetector } from './intent';
import { FileSegmentationDetector } from './file-segmentation';
import { WorkspaceSegmentationDetector } from './workspace';
import { TopicSegmentationDetector } from './topic';
import { HybridSegmentationDetector } from './hybrid';

export class Segmenter {
  private config: SegmentationConfig;
  private detector: BaseSegmentationDetector;

  constructor(config: SegmentationConfig) {
    this.config = config;
    this.detector = this.createDetector(config);
  }

  /**
   * Segment a sequence of traces
   */
  segment(traces: Trace[]): SegmentationResult {
    if (traces.length === 0) {
      return {
        segments: [],
        method: this.config.method,
        config: this.config,
      };
    }

    const segments: Segment[] = [];
    let currentSegment = this.createInitialSegment(traces[0]);

    for (let i = 1; i < traces.length; i++) {
      const currentEvent = traces[i];
      const previousEvent = traces[i - 1];

      const context: SegmentationContext = {
        currentSegment,
        previousEvent,
        currentEvent,
        allEvents: traces,
        config: this.config,
      };

      // Check if this event represents a boundary
      if (this.detector.isBoundary(context)) {
        // Finalize current segment
        currentSegment.endTime = new Date(previousEvent.timestamp);
        segments.push(currentSegment);

        // Start new segment
        currentSegment = this.createInitialSegment(currentEvent);
      } else {
        // Add event to current segment
        currentSegment.events.push(currentEvent);
        currentSegment.endTime = new Date(currentEvent.timestamp);

        // Update segment metadata
        this.updateSegmentMetadata(currentSegment, currentEvent);
      }
    }

    // Add final segment
    if (currentSegment.events.length > 0) {
      segments.push(currentSegment);
    }

    // Filter segments that don't meet minimum events requirement
    const minEvents = this.config.minEventsPerSegment || 1;
    const filteredSegments = segments.filter(
      (seg) => seg.events.length >= minEvents
    );

    return {
      segments: filteredSegments,
      method: this.config.method,
      config: this.config,
    };
  }

  /**
   * Create detector based on configuration
   */
  private createDetector(
    config: SegmentationConfig
  ): BaseSegmentationDetector {
    switch (config.method) {
      case 'temporal':
        if (!config.temporal) {
          throw new Error('Temporal config required for temporal segmentation');
        }
        return new TemporalSegmentationDetector(config.temporal);

      case 'intent':
        if (!config.intent) {
          throw new Error('Intent config required for intent segmentation');
        }
        return new IntentSegmentationDetector(config.intent);

      case 'file':
        if (!config.file) {
          throw new Error('File config required for file segmentation');
        }
        return new FileSegmentationDetector(config.file);

      case 'workspace':
        return new WorkspaceSegmentationDetector(config.workspace || {});

      case 'topic':
        if (!config.topic) {
          throw new Error('Topic config required for topic segmentation');
        }
        return new TopicSegmentationDetector(config.topic);

      case 'hybrid':
        if (!config.hybrid) {
          throw new Error('Hybrid config required for hybrid segmentation');
        }
        return this.createHybridDetector(config);

      default:
        throw new Error(`Unknown segmentation method: ${config.method}`);
    }
  }

  /**
   * Create hybrid detector with all sub-detectors
   */
  private createHybridDetector(
    config: SegmentationConfig
  ): HybridSegmentationDetector {
    const detectors = new Map<SegmentationMethod, BaseSegmentationDetector>();

    const hybridConfig = config.hybrid!;
    const methods = hybridConfig.methods;

    for (const method of methods) {
      switch (method) {
        case 'temporal':
          if (config.temporal) {
            detectors.set(method, new TemporalSegmentationDetector(config.temporal));
          }
          break;
        case 'intent':
          if (config.intent) {
            detectors.set(method, new IntentSegmentationDetector(config.intent));
          }
          break;
        case 'file':
          if (config.file) {
            detectors.set(method, new FileSegmentationDetector(config.file));
          }
          break;
        case 'workspace':
          detectors.set(method, new WorkspaceSegmentationDetector(config.workspace || {}));
          break;
        case 'topic':
          if (config.topic) {
            detectors.set(method, new TopicSegmentationDetector(config.topic));
          }
          break;
      }
    }

    return new HybridSegmentationDetector(hybridConfig, detectors);
  }

  /**
   * Create initial segment from first event
   */
  private createInitialSegment(event: Trace): Segment {
    const files = this.extractFiles(event);
    const intent = this.extractIntent(event);
    const topic = this.extractTopic(event);

    return {
      id: `seg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      events: [event],
      startTime: new Date(event.timestamp),
      endTime: new Date(event.timestamp),
      metadata: {
        intent: intent || undefined,
        files: files.length > 0 ? new Set(files) : undefined,
        topics: topic ? new Set([topic]) : undefined,
        workspace_path: event.workspace_path,
      },
    };
  }

  /**
   * Update segment metadata with new event
   */
  private updateSegmentMetadata(segment: Segment, event: Trace): void {
    const files = this.extractFiles(event);
    const intent = this.extractIntent(event);
    const topic = this.extractTopic(event);

    // Update files
    if (files.length > 0) {
      if (!segment.metadata.files) {
        segment.metadata.files = new Set();
      }
      files.forEach((f) => segment.metadata.files!.add(f));
    }

    // Update intent (merge or keep existing)
    if (intent && !segment.metadata.intent) {
      segment.metadata.intent = intent;
    }

    // Update topics
    if (topic) {
      if (!segment.metadata.topics) {
        segment.metadata.topics = new Set();
      }
      segment.metadata.topics.add(topic);
    }

    // Update workspace
    if (event.workspace_path && !segment.metadata.workspace_path) {
      segment.metadata.workspace_path = event.workspace_path;
    }
  }

  /**
   * Helper methods (delegated to base class)
   */
  private extractFiles(event: Trace): string[] {
    const files: string[] = [];
    const details = event.details || {};
    if (details.file_path) files.push(details.file_path);
    if (details.file) files.push(details.file);
    if (details.target) files.push(details.target);
    return files;
  }

  private extractIntent(event: Trace): string | null {
    return event.intent || event.annotation || null;
  }

  private extractTopic(event: Trace): string | null {
    return event.details?.topic || null;
  }
}



















