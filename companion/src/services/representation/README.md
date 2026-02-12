# Representation Services

This module provides services for creating and evaluating representation instances from developer traces.

## Structure

```
representation/
├── types.ts                    # Shared types (Trace, Segment)
├── segmentation/               # Segmentation services
│   ├── evaluation/             # Segmentation evaluation metrics
│   │   ├── types.ts           # Evaluation types
│   │   ├── completeness.ts    # Completeness metric (traces + segments)
│   │   ├── homogeneity.ts     # Homogeneity metric (traces + segments + intent)
│   │   ├── boundary-quality.ts # Boundary quality (traces + segments)
│   │   ├── semantic-coherence.ts # Semantic coherence (traces + segments)
│   │   ├── structural-quality.ts # Structural quality (traces + segments)
│   │   ├── evaluator.ts       # Main evaluation service
│   │   └── index.ts           # Exports
│   └── index.ts               # Segmentation exports
├── abstractions/              # Abstraction rung services
│   └── index.ts               # Abstraction exports
└── index.ts                   # Main exports
```

## Evaluation Metrics

Each metric is evaluated independently based on available information:

### 1. Completeness (25 points)
- **Requires**: traces, segments
- **Evaluates**: Are all related events grouped together?
- **Deductions**:
  - Fragmented segments: -5 per fragmentation
  - Missing related events: -3 per missing event
  - Over-segmentation: -2 per unnecessary segment

### 2. Homogeneity (25 points)
- **Requires**: traces, segments, intent (optional but recommended)
- **Evaluates**: Does each segment represent a single task/intent?
- **Deductions**:
  - Mixed intents: -5 per mixed intent segment
  - Unrelated events: -3 per unrelated event
  - Missed boundaries: -2 per missed boundary

### 3. Boundary Quality (25 points)
- **Requires**: traces, segments
- **Evaluates**: Are boundaries at natural break points?
- **Deductions**:
  - Boundaries in middle of tasks: -5 per bad boundary
  - Missing natural boundaries: -3 per missed boundary
  - Arbitrary boundaries: -2 per arbitrary boundary

### 4. Semantic Coherence (15 points)
- **Requires**: traces, segments
- **Evaluates**: Do segments make semantic sense?
- **Deductions**:
  - Unclear segment purpose: -5 per unclear segment
  - Contradictory events: -3 per contradiction
  - Weak semantic grouping: -2 per weak grouping

### 5. Structural Quality (10 points)
- **Requires**: traces, segments
- **Evaluates**: Appropriate segment sizes and granularity?
- **Deductions**:
  - Extremely small segments (< 2 events): -2 per segment
  - Extremely large segments (> 50 events): -2 per segment
  - Inconsistent granularity: -3

## Usage

```typescript
import { SegmentationEvaluator } from './representation/segmentation/evaluation';
import { Trace, Segment } from './representation/types';

// Create evaluator
const evaluator = new SegmentationEvaluator();

// Prepare context
const context = {
  traces: traces,
  segments: segments,
  intent: intentLabels, // Optional
  groundTruth: groundTruthSegments, // Optional
};

// Evaluate
const evaluation = evaluator.evaluate(context);

// Results
console.log(`Overall Score: ${evaluation.overall_score}/100`);
console.log(`Completeness: ${evaluation.metrics.completeness?.score}/100`);
console.log(`Homogeneity: ${evaluation.metrics.homogeneity?.score}/100`);
console.log(`Boundary Quality: ${evaluation.metrics.boundary_quality?.score}/100`);
console.log(`Semantic Coherence: ${evaluation.metrics.semantic_coherence?.score}/100`);
console.log(`Structural Quality: ${evaluation.metrics.structural_quality?.score}/100`);

// View deductions
evaluation.metrics.completeness?.deductions.forEach(d => {
  console.log(`- ${d.issue}: -${d.deduction} points`);
  console.log(`  Reasoning: ${d.reasoning}`);
});
```

## Metric Dependencies

| Metric | Traces | Segments | Intent | Ground Truth |
|--------|--------|----------|--------|--------------|
| Completeness | ✅ | ✅ | ❌ | Optional |
| Homogeneity | ✅ | ✅ | ⚠️ Recommended | Optional |
| Boundary Quality | ✅ | ✅ | ❌ | Optional |
| Semantic Coherence | ✅ | ✅ | ❌ | Optional |
| Structural Quality | ✅ | ✅ | ❌ | Optional |

## Evaluation Process

1. **Base Score**: Start with 100 points
2. **Metric Evaluation**: Each metric evaluates independently
3. **Deductions**: Apply deductions based on issues found
4. **Final Score**: Base score - total deductions
5. **Summary**: Generate strengths and improvements

## Notes

- Metrics are evaluated independently based on available information
- Intent is optional for homogeneity but improves accuracy
- Ground truth is optional but enables comparison
- Each metric provides detailed deductions with reasoning



















