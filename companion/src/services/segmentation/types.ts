/**
 * Segmentation Types
 * Type definitions for trace segmentation methods
 */

export interface Trace {
  id?: string;
  type: string;
  timestamp: string;
  workspace_path?: string;
  intent?: string;
  annotation?: string;
  details?: {
    file_path?: string;
    file?: string;
    target?: string;
    topic?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface Segment {
  id: string;
  events: Trace[];
  startTime: Date;
  endTime: Date;
  metadata: {
    intent?: string;
    files?: Set<string>;
    topics?: Set<string>;
    workspace_path?: string;
  };
}

export interface SegmentationResult {
  segments: Segment[];
  method: SegmentationMethod;
  config: SegmentationConfig;
}

export type SegmentationMethod =
  | 'temporal'
  | 'intent'
  | 'file'
  | 'workspace'
  | 'topic'
  | 'hybrid';

export type HybridStrategy = 'or' | 'and' | 'weighted' | 'sequential';

export interface TemporalConfig {
  timeGapMinutes: number;
  minEventsPerSegment?: number;
}

export interface IntentConfig {
  requireExplicitIntent?: boolean;
  intentChangeThreshold?: number;
  minEventsPerSegment?: number;
}

export interface FileBasedConfig {
  overlapThreshold: number; // 0-1, ratio of file overlap
  fileSet: 'workspace' | 'specific';
  specificFiles?: string[];
  minEventsPerSegment?: number;
}

export interface WorkspaceConfig {
  minEventsPerSegment?: number;
}

export interface TopicConfig {
  similarityThreshold: number; // 0-1, topic similarity
  minEventsPerSegment?: number;
}

export interface HybridConfig {
  strategy: HybridStrategy;
  methods: SegmentationMethod[];
  weights?: Record<SegmentationMethod, number>; // For weighted strategy
  order?: SegmentationMethod[]; // For sequential strategy
  minAgreement?: number; // For AND strategy (number of methods that must agree)
}

export interface SegmentationConfig {
  method: SegmentationMethod;
  temporal?: TemporalConfig;
  intent?: IntentConfig;
  file?: FileBasedConfig;
  workspace?: WorkspaceConfig;
  topic?: TopicConfig;
  hybrid?: HybridConfig;
  minEventsPerSegment?: number; // Global minimum
}

export interface SegmentationContext {
  currentSegment: Segment;
  previousEvent: Trace | null;
  currentEvent: Trace;
  allEvents: Trace[];
  config: SegmentationConfig;
}

export interface SegmentationBoundaryDetector {
  /**
   * Check if an event represents a boundary
   */
  isBoundary(context: SegmentationContext): boolean;

  /**
   * Get the method name
   */
  getMethod(): SegmentationMethod;
}



















