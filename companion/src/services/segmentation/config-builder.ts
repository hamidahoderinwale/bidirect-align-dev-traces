/**
 * Configuration Builder
 * Builder pattern for creating segmentation configurations from UI/CLI inputs
 */

import {
  SegmentationConfig,
  SegmentationMethod,
  HybridStrategy,
  TemporalConfig,
  IntentConfig,
  FileBasedConfig,
  WorkspaceConfig,
  TopicConfig,
  HybridConfig,
} from './types';
import { SegmentationConfigValidator } from './config-validator';

export interface UISegmentationInput {
  method: SegmentationMethod;
  // Temporal options
  timeGapMinutes?: number;
  // Intent options
  requireExplicitIntent?: boolean;
  intentChangeThreshold?: number;
  // File options
  fileOverlapThreshold?: number;
  fileSet?: 'workspace' | 'specific';
  specificFiles?: string[];
  // Workspace options (no specific options)
  // Topic options
  topicSimilarityThreshold?: number;
  // Hybrid options
  hybridStrategy?: HybridStrategy;
  hybridMethods?: SegmentationMethod[];
  hybridWeights?: Record<string, number>;
  hybridOrder?: SegmentationMethod[];
  hybridMinAgreement?: number;
  // Global options
  minEventsPerSegment?: number;
}

export class SegmentationConfigBuilder {
  /**
   * Build configuration from UI/CLI input
   */
  static build(input: UISegmentationInput): {
    config: SegmentationConfig;
    validation: { valid: boolean; errors: string[]; warnings: string[] };
  } {
    const config: SegmentationConfig = {
      method: input.method,
      minEventsPerSegment: input.minEventsPerSegment || 3,
    };

    // Build method-specific configs
    switch (input.method) {
      case 'temporal':
        config.temporal = {
          timeGapMinutes: input.timeGapMinutes || 30,
          minEventsPerSegment: input.minEventsPerSegment || 3,
        };
        break;

      case 'intent':
        config.intent = {
          requireExplicitIntent: input.requireExplicitIntent || false,
          intentChangeThreshold: input.intentChangeThreshold,
          minEventsPerSegment: input.minEventsPerSegment || 3,
        };
        break;

      case 'file':
        config.file = {
          overlapThreshold: input.fileOverlapThreshold || 0.3,
          fileSet: input.fileSet || 'workspace',
          specificFiles: input.specificFiles,
          minEventsPerSegment: input.minEventsPerSegment || 3,
        };
        break;

      case 'workspace':
        config.workspace = {
          minEventsPerSegment: input.minEventsPerSegment || 3,
        };
        break;

      case 'topic':
        config.topic = {
          similarityThreshold: input.topicSimilarityThreshold || 0.5,
          minEventsPerSegment: input.minEventsPerSegment || 3,
        };
        break;

      case 'hybrid':
        // Build hybrid config
        const hybridMethods = input.hybridMethods || ['temporal', 'intent', 'file', 'workspace'];
        const hybridConfig: HybridConfig = {
          strategy: input.hybridStrategy || 'or',
          methods: hybridMethods,
        };

        if (input.hybridStrategy === 'weighted' && input.hybridWeights) {
          hybridConfig.weights = input.hybridWeights as Record<SegmentationMethod, number>;
        }

        if (input.hybridStrategy === 'sequential' && input.hybridOrder) {
          hybridConfig.order = input.hybridOrder;
        }

        if (input.hybridStrategy === 'and' && input.hybridMinAgreement !== undefined) {
          hybridConfig.minAgreement = input.hybridMinAgreement;
        }

        config.hybrid = hybridConfig;

        // Build configs for each method in hybrid
        if (hybridMethods.includes('temporal')) {
          config.temporal = {
            timeGapMinutes: input.timeGapMinutes || 30,
            minEventsPerSegment: input.minEventsPerSegment || 3,
          };
        }

        if (hybridMethods.includes('intent')) {
          config.intent = {
            requireExplicitIntent: input.requireExplicitIntent || false,
            intentChangeThreshold: input.intentChangeThreshold,
            minEventsPerSegment: input.minEventsPerSegment || 3,
          };
        }

        if (hybridMethods.includes('file')) {
          config.file = {
            overlapThreshold: input.fileOverlapThreshold || 0.3,
            fileSet: input.fileSet || 'workspace',
            specificFiles: input.specificFiles,
            minEventsPerSegment: input.minEventsPerSegment || 3,
          };
        }

        if (hybridMethods.includes('workspace')) {
          config.workspace = {
            minEventsPerSegment: input.minEventsPerSegment || 3,
          };
        }

        if (hybridMethods.includes('topic')) {
          config.topic = {
            similarityThreshold: input.topicSimilarityThreshold || 0.5,
            minEventsPerSegment: input.minEventsPerSegment || 3,
          };
        }
        break;
    }

    // Validate configuration
    const validation = SegmentationConfigValidator.validate(config);

    return { config, validation };
  }

  /**
   * Build from JSON (for CLI/API)
   */
  static fromJSON(json: string | object): {
    config: SegmentationConfig;
    validation: { valid: boolean; errors: string[]; warnings: string[] };
  } {
    const input = typeof json === 'string' ? JSON.parse(json) : json;
    return this.build(input as UISegmentationInput);
  }

  /**
   * Convert config to UI-friendly format
   */
  static toUIFormat(config: SegmentationConfig): UISegmentationInput {
    const input: UISegmentationInput = {
      method: config.method,
      minEventsPerSegment: config.minEventsPerSegment,
    };

    if (config.temporal) {
      input.timeGapMinutes = config.temporal.timeGapMinutes;
    }

    if (config.intent) {
      input.requireExplicitIntent = config.intent.requireExplicitIntent;
      input.intentChangeThreshold = config.intent.intentChangeThreshold;
    }

    if (config.file) {
      input.fileOverlapThreshold = config.file.overlapThreshold;
      input.fileSet = config.file.fileSet;
      input.specificFiles = config.file.specificFiles;
    }

    if (config.topic) {
      input.topicSimilarityThreshold = config.topic.similarityThreshold;
    }

    if (config.hybrid) {
      input.hybridStrategy = config.hybrid.strategy;
      input.hybridMethods = config.hybrid.methods;
      input.hybridWeights = config.hybrid.weights as Record<string, number>;
      input.hybridOrder = config.hybrid.order;
      input.hybridMinAgreement = config.hybrid.minAgreement;
    }

    return input;
  }
}



















