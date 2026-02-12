/**
 * Segmentation Presets
 * Pre-configured segmentation options for common use cases
 */

import {
  SegmentationConfig,
  HybridStrategy,
} from './types';

export class SegmentationPresets {
  /**
   * Default temporal segmentation (30 minute gaps)
   */
  static temporal(): SegmentationConfig {
    return {
      method: 'temporal',
      temporal: {
        timeGapMinutes: 30,
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Default intent-based segmentation
   */
  static intent(): SegmentationConfig {
    return {
      method: 'intent',
      intent: {
        requireExplicitIntent: false,
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Default file-based segmentation (workspace-wide)
   */
  static fileWorkspace(): SegmentationConfig {
    return {
      method: 'file',
      file: {
        overlapThreshold: 0.3,
        fileSet: 'workspace',
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * File-based segmentation for specific files
   */
  static fileSpecific(files: string[]): SegmentationConfig {
    return {
      method: 'file',
      file: {
        overlapThreshold: 0.3,
        fileSet: 'specific',
        specificFiles: files,
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Default workspace-based segmentation
   */
  static workspace(): SegmentationConfig {
    return {
      method: 'workspace',
      workspace: {
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Default topic-based segmentation
   */
  static topic(): SegmentationConfig {
    return {
      method: 'topic',
      topic: {
        similarityThreshold: 0.5,
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Hybrid: OR strategy (any method triggers boundary)
   * This is the current default behavior
   */
  static hybridOr(methods: SegmentationMethod[] = ['temporal', 'intent', 'file', 'workspace']): SegmentationConfig {
    return {
      method: 'hybrid',
      hybrid: {
        strategy: 'or',
        methods,
      },
      temporal: {
        timeGapMinutes: 30,
        minEventsPerSegment: 3,
      },
      intent: {
        requireExplicitIntent: false,
        minEventsPerSegment: 3,
      },
      file: {
        overlapThreshold: 0.3,
        fileSet: 'workspace',
        minEventsPerSegment: 3,
      },
      workspace: {
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Hybrid: AND strategy (all methods must agree)
   */
  static hybridAnd(
    methods: SegmentationMethod[] = ['temporal', 'intent'],
    minAgreement?: number
  ): SegmentationConfig {
    return {
      method: 'hybrid',
      hybrid: {
        strategy: 'and',
        methods,
        minAgreement,
      },
      temporal: {
        timeGapMinutes: 30,
        minEventsPerSegment: 3,
      },
      intent: {
        requireExplicitIntent: false,
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Hybrid: Weighted strategy
   */
  static hybridWeighted(
    methods: SegmentationMethod[] = ['temporal', 'intent', 'file'],
    weights: Record<SegmentationMethod, number> = {
      temporal: 0.4,
      intent: 0.4,
      file: 0.2,
    }
  ): SegmentationConfig {
    return {
      method: 'hybrid',
      hybrid: {
        strategy: 'weighted',
        methods,
        weights,
      },
      temporal: {
        timeGapMinutes: 30,
        minEventsPerSegment: 3,
      },
      intent: {
        requireExplicitIntent: false,
        minEventsPerSegment: 3,
      },
      file: {
        overlapThreshold: 0.3,
        fileSet: 'workspace',
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Hybrid: Sequential strategy (try methods in order)
   */
  static hybridSequential(
    order: SegmentationMethod[] = ['intent', 'temporal', 'file', 'workspace']
  ): SegmentationConfig {
    return {
      method: 'hybrid',
      hybrid: {
        strategy: 'sequential',
        methods: order,
        order,
      },
      temporal: {
        timeGapMinutes: 30,
        minEventsPerSegment: 3,
      },
      intent: {
        requireExplicitIntent: false,
        minEventsPerSegment: 3,
      },
      file: {
        overlapThreshold: 0.3,
        fileSet: 'workspace',
        minEventsPerSegment: 3,
      },
      workspace: {
        minEventsPerSegment: 3,
      },
      minEventsPerSegment: 3,
    };
  }

  /**
   * Get all available presets
   */
  static getAllPresets(): {
    name: string;
    description: string;
    config: SegmentationConfig;
  }[] {
    return [
      {
        name: 'temporal',
        description: 'Segment by 30-minute time gaps',
        config: this.temporal(),
      },
      {
        name: 'intent',
        description: 'Segment by intent changes',
        config: this.intent(),
      },
      {
        name: 'file-workspace',
        description: 'Segment by file changes (workspace-wide)',
        config: this.fileWorkspace(),
      },
      {
        name: 'workspace',
        description: 'Segment by workspace path changes',
        config: this.workspace(),
      },
      {
        name: 'topic',
        description: 'Segment by topic/semantic changes',
        config: this.topic(),
      },
      {
        name: 'hybrid-or',
        description: 'Hybrid: Any method triggers boundary (default)',
        config: this.hybridOr(),
      },
      {
        name: 'hybrid-and',
        description: 'Hybrid: All methods must agree',
        config: this.hybridAnd(),
      },
      {
        name: 'hybrid-weighted',
        description: 'Hybrid: Weighted voting',
        config: this.hybridWeighted(),
      },
      {
        name: 'hybrid-sequential',
        description: 'Hybrid: Try methods in order',
        config: this.hybridSequential(),
      },
    ];
  }
}



















