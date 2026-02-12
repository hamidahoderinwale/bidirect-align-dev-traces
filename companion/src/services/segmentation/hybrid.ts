/**
 * Hybrid Segmentation
 * Combines multiple segmentation methods using different strategies
 */

import {
  SegmentationContext,
  SegmentationMethod,
  HybridConfig,
  HybridStrategy,
} from './types';
import { BaseSegmentationDetector } from './base';
import { TemporalSegmentationDetector } from './temporal';
import { IntentSegmentationDetector } from './intent';
import { FileSegmentationDetector } from './file-segmentation';
import { WorkspaceSegmentationDetector } from './workspace';
import { TopicSegmentationDetector } from './topic';

export class HybridSegmentationDetector extends BaseSegmentationDetector {
  private config: HybridConfig;
  private detectors: Map<SegmentationMethod, BaseSegmentationDetector>;

  constructor(config: HybridConfig, detectors: Map<SegmentationMethod, BaseSegmentationDetector>) {
    super();
    this.config = config;
    this.detectors = detectors;
  }

  getMethod(): SegmentationMethod {
    return 'hybrid';
  }

  isBoundary(context: SegmentationContext): boolean {
    const { strategy, methods, weights, order, minAgreement } = this.config;

    switch (strategy) {
      case 'or':
        return this.orStrategy(context, methods);
      case 'and':
        return this.andStrategy(context, methods, minAgreement);
      case 'weighted':
        return this.weightedStrategy(context, methods, weights || {});
      case 'sequential':
        return this.sequentialStrategy(context, order || methods);
      default:
        return this.orStrategy(context, methods);
    }
  }

  /**
   * OR Strategy: Any method detecting a boundary creates a boundary
   */
  private orStrategy(
    context: SegmentationContext,
    methods: SegmentationMethod[]
  ): boolean {
    for (const method of methods) {
      const detector = this.detectors.get(method);
      if (detector && detector.isBoundary(context)) {
        return true;
      }
    }
    return false;
  }

  /**
   * AND Strategy: All (or minAgreement) methods must detect a boundary
   */
  private andStrategy(
    context: SegmentationContext,
    methods: SegmentationMethod[],
    minAgreement?: number
  ): boolean {
    const requiredAgreement = minAgreement || methods.length;
    let agreementCount = 0;

    for (const method of methods) {
      const detector = this.detectors.get(method);
      if (detector && detector.isBoundary(context)) {
        agreementCount++;
      }
    }

    return agreementCount >= requiredAgreement;
  }

  /**
   * Weighted Strategy: Methods vote with weights, threshold determines boundary
   */
  private weightedStrategy(
    context: SegmentationContext,
    methods: SegmentationMethod[],
    weights: Record<SegmentationMethod, number>
  ): boolean {
    let totalWeight = 0;
    let boundaryWeight = 0;

    for (const method of methods) {
      const detector = this.detectors.get(method);
      const weight = weights[method] || 1.0;
      totalWeight += weight;

      if (detector && detector.isBoundary(context)) {
        boundaryWeight += weight;
      }
    }

    // Boundary if weighted vote exceeds 50% threshold
    return totalWeight > 0 && boundaryWeight / totalWeight > 0.5;
  }

  /**
   * Sequential Strategy: Try methods in order, first one that detects boundary wins
   */
  private sequentialStrategy(
    context: SegmentationContext,
    order: SegmentationMethod[]
  ): boolean {
    for (const method of order) {
      const detector = this.detectors.get(method);
      if (detector) {
        const isBoundary = detector.isBoundary(context);
        if (isBoundary) {
          return true;
        }
      }
    }
    return false;
  }
}



















