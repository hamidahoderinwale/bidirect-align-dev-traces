/**
 * Topic-Based Segmentation
 * Segments traces based on topic/semantic changes
 */

import {
  SegmentationContext,
  SegmentationMethod,
  TopicConfig,
} from './types';
import { BaseSegmentationDetector } from './base';

export class TopicSegmentationDetector extends BaseSegmentationDetector {
  private config: TopicConfig;

  constructor(config: TopicConfig) {
    super();
    this.config = config;
  }

  getMethod(): SegmentationMethod {
    return 'topic';
  }

  isBoundary(context: SegmentationContext): boolean {
    const { currentEvent, currentSegment, config } = context;
    const topicConfig = config.topic || this.config;

    // Extract topic from current event
    const currentTopic = this.extractTopic(currentEvent);
    if (!currentTopic) {
      return false; // No topic in event, can't determine boundary
    }

    // Get topics from current segment
    const segmentTopics = Array.from(currentSegment.metadata.topics || []);

    if (segmentTopics.length === 0) {
      // Segment has no topics yet, add current topic and continue
      return false;
    }

    // Calculate topic similarity (simple: check if topic is in segment topics)
    // For more sophisticated similarity, could use embeddings or NLP
    const topicSimilarity = segmentTopics.includes(currentTopic) ? 1.0 : 0.0;

    // Check if similarity is below threshold
    if (topicSimilarity < topicConfig.similarityThreshold) {
      // Only create boundary if current segment meets minimum events requirement
      return this.meetsMinimumEvents(
        currentSegment,
        topicConfig.minEventsPerSegment || config.minEventsPerSegment
      );
    }

    return false;
  }

  /**
   * Calculate topic similarity between two topics
   * Can be extended to use embeddings or NLP for more sophisticated similarity
   */
  protected calculateTopicSimilarity(topic1: string, topic2: string): number {
    // Simple exact match
    if (topic1 === topic2) return 1.0;

    // Simple substring match
    if (topic1.includes(topic2) || topic2.includes(topic1)) return 0.5;

    // Could extend with:
    // - Embedding-based cosine similarity
    // - NLP-based semantic similarity
    // - Keyword overlap

    return 0.0;
  }
}



















