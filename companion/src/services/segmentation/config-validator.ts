/**
 * Configuration Validator
 * Validates segmentation configurations and provides preset options
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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class SegmentationConfigValidator {
  /**
   * Validate a segmentation configuration
   */
  static validate(config: SegmentationConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate method-specific configs
    switch (config.method) {
      case 'temporal':
        if (!config.temporal) {
          errors.push('Temporal segmentation requires temporal config');
        } else {
          this.validateTemporalConfig(config.temporal, errors, warnings);
        }
        break;

      case 'intent':
        if (!config.intent) {
          errors.push('Intent segmentation requires intent config');
        } else {
          this.validateIntentConfig(config.intent, errors, warnings);
        }
        break;

      case 'file':
        if (!config.file) {
          errors.push('File segmentation requires file config');
        } else {
          this.validateFileConfig(config.file, errors, warnings);
        }
        break;

      case 'workspace':
        // Workspace config is optional
        if (config.workspace) {
          this.validateWorkspaceConfig(config.workspace, errors, warnings);
        }
        break;

      case 'topic':
        if (!config.topic) {
          errors.push('Topic segmentation requires topic config');
        } else {
          this.validateTopicConfig(config.topic, errors, warnings);
        }
        break;

      case 'hybrid':
        if (!config.hybrid) {
          errors.push('Hybrid segmentation requires hybrid config');
        } else {
          this.validateHybridConfig(config, errors, warnings);
        }
        break;

      default:
        errors.push(`Unknown segmentation method: ${config.method}`);
    }

    // Validate global settings
    if (config.minEventsPerSegment !== undefined && config.minEventsPerSegment < 1) {
      errors.push('minEventsPerSegment must be at least 1');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate temporal config
   */
  private static validateTemporalConfig(
    config: TemporalConfig,
    errors: string[],
    warnings: string[]
  ): void {
    if (config.timeGapMinutes <= 0) {
      errors.push('timeGapMinutes must be greater than 0');
    }
    if (config.minEventsPerSegment !== undefined && config.minEventsPerSegment < 1) {
      errors.push('minEventsPerSegment must be at least 1');
    }
  }

  /**
   * Validate intent config
   */
  private static validateIntentConfig(
    config: IntentConfig,
    errors: string[],
    warnings: string[]
  ): void {
    if (config.intentChangeThreshold !== undefined) {
      if (config.intentChangeThreshold < 0 || config.intentChangeThreshold > 1) {
        errors.push('intentChangeThreshold must be between 0 and 1');
      }
    }
    if (config.minEventsPerSegment !== undefined && config.minEventsPerSegment < 1) {
      errors.push('minEventsPerSegment must be at least 1');
    }
  }

  /**
   * Validate file config
   */
  private static validateFileConfig(
    config: FileBasedConfig,
    errors: string[],
    warnings: string[]
  ): void {
    if (config.overlapThreshold < 0 || config.overlapThreshold > 1) {
      errors.push('overlapThreshold must be between 0 and 1');
    }
    if (config.fileSet === 'specific' && (!config.specificFiles || config.specificFiles.length === 0)) {
      errors.push('specificFiles must be provided when fileSet is "specific"');
    }
    if (config.minEventsPerSegment !== undefined && config.minEventsPerSegment < 1) {
      errors.push('minEventsPerSegment must be at least 1');
    }
  }

  /**
   * Validate workspace config
   */
  private static validateWorkspaceConfig(
    config: WorkspaceConfig,
    errors: string[],
    warnings: string[]
  ): void {
    if (config.minEventsPerSegment !== undefined && config.minEventsPerSegment < 1) {
      errors.push('minEventsPerSegment must be at least 1');
    }
  }

  /**
   * Validate topic config
   */
  private static validateTopicConfig(
    config: TopicConfig,
    errors: string[],
    warnings: string[]
  ): void {
    if (config.similarityThreshold < 0 || config.similarityThreshold > 1) {
      errors.push('similarityThreshold must be between 0 and 1');
    }
    if (config.minEventsPerSegment !== undefined && config.minEventsPerSegment < 1) {
      errors.push('minEventsPerSegment must be at least 1');
    }
  }

  /**
   * Validate hybrid config
   */
  private static validateHybridConfig(
    config: SegmentationConfig,
    errors: string[],
    warnings: string[]
  ): void {
    const hybrid = config.hybrid!;

    if (!hybrid.methods || hybrid.methods.length === 0) {
      errors.push('Hybrid config must specify at least one method');
      return;
    }

    // Validate each method in hybrid has its config
    for (const method of hybrid.methods) {
      switch (method) {
        case 'temporal':
          if (!config.temporal) {
            errors.push('Hybrid with temporal method requires temporal config');
          }
          break;
        case 'intent':
          if (!config.intent) {
            errors.push('Hybrid with intent method requires intent config');
          }
          break;
        case 'file':
          if (!config.file) {
            errors.push('Hybrid with file method requires file config');
          }
          break;
        case 'topic':
          if (!config.topic) {
            errors.push('Hybrid with topic method requires topic config');
          }
          break;
        // workspace doesn't require config
      }
    }

    // Validate strategy-specific requirements
    if (hybrid.strategy === 'weighted') {
      if (!hybrid.weights || Object.keys(hybrid.weights).length === 0) {
        errors.push('Weighted strategy requires weights configuration');
      } else {
        // Validate weights sum to reasonable value
        const totalWeight = Object.values(hybrid.weights).reduce((sum, w) => sum + w, 0);
        if (totalWeight <= 0) {
          errors.push('Weights must sum to a positive value');
        }
      }
    }

    if (hybrid.strategy === 'and') {
      if (hybrid.minAgreement !== undefined) {
        if (hybrid.minAgreement < 1 || hybrid.minAgreement > hybrid.methods.length) {
          errors.push(`minAgreement must be between 1 and ${hybrid.methods.length}`);
        }
      }
    }

    if (hybrid.strategy === 'sequential') {
      if (!hybrid.order || hybrid.order.length === 0) {
        errors.push('Sequential strategy requires order configuration');
      } else if (hybrid.order.length !== hybrid.methods.length) {
        warnings.push('Order should include all methods from methods array');
      }
    }
  }

  /**
   * Get valid combinations for UI/CLI
   */
  static getValidCombinations(): {
    method: SegmentationMethod;
    description: string;
    requiredConfigs: string[];
    optionalConfigs: string[];
  }[] {
    return [
      {
        method: 'temporal',
        description: 'Segment by time gaps between events',
        requiredConfigs: ['temporal'],
        optionalConfigs: [],
      },
      {
        method: 'intent',
        description: 'Segment by intent changes',
        requiredConfigs: ['intent'],
        optionalConfigs: [],
      },
      {
        method: 'file',
        description: 'Segment by file set changes',
        requiredConfigs: ['file'],
        optionalConfigs: [],
      },
      {
        method: 'workspace',
        description: 'Segment by workspace path changes',
        requiredConfigs: [],
        optionalConfigs: ['workspace'],
      },
      {
        method: 'topic',
        description: 'Segment by topic/semantic changes',
        requiredConfigs: ['topic'],
        optionalConfigs: [],
      },
      {
        method: 'hybrid',
        description: 'Combine multiple methods using a strategy',
        requiredConfigs: ['hybrid'],
        optionalConfigs: ['temporal', 'intent', 'file', 'workspace', 'topic'],
      },
    ];
  }

  /**
   * Get available hybrid strategies
   */
  static getHybridStrategies(): {
    strategy: HybridStrategy;
    description: string;
    requiredConfig: string[];
  }[] {
    return [
      {
        strategy: 'or',
        description: 'Any method detecting a boundary creates a boundary',
        requiredConfig: ['methods'],
      },
      {
        strategy: 'and',
        description: 'All (or minAgreement) methods must detect a boundary',
        requiredConfig: ['methods'],
      },
      {
        strategy: 'weighted',
        description: 'Methods vote with weights, threshold determines boundary',
        requiredConfig: ['methods', 'weights'],
      },
      {
        strategy: 'sequential',
        description: 'Try methods in order, first one that detects boundary wins',
        requiredConfig: ['methods', 'order'],
      },
    ];
  }
}



















