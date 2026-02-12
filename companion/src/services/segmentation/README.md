# Segmentation Service

A flexible, configurable segmentation system for organizing traces into segments based on various criteria.

## Features

- **Multiple Segmentation Methods**: Temporal, Intent, File, Workspace, Topic
- **Hybrid Strategies**: Combine multiple methods (OR, AND, Weighted, Sequential)
- **Configuration Validation**: Ensures valid combinations
- **Presets**: Pre-configured options for common use cases
- **UI/CLI Ready**: Easy integration with UI and command-line interfaces

## Quick Start

```typescript
import { createSegmenter, SegmentationPresets } from './segmentation';

// Use a preset
const config = SegmentationPresets.hybridOr();
const segmenter = createSegmenter(config);
const result = segmenter.segment(traces);
```

## Segmentation Methods

### 1. Temporal Segmentation
Segments traces based on time gaps between events.

```typescript
const config = {
  method: 'temporal',
  temporal: {
    timeGapMinutes: 30,
    minEventsPerSegment: 3,
  },
};
```

### 2. Intent-Based Segmentation
Segments traces based on intent changes.

```typescript
const config = {
  method: 'intent',
  intent: {
    requireExplicitIntent: false,
    minEventsPerSegment: 3,
  },
};
```

### 3. File-Based Segmentation
Segments traces based on file set changes.

```typescript
// Workspace-wide
const config = {
  method: 'file',
  file: {
    overlapThreshold: 0.3,
    fileSet: 'workspace',
    minEventsPerSegment: 3,
  },
};

// Specific files
const config = {
  method: 'file',
  file: {
    overlapThreshold: 0.3,
    fileSet: 'specific',
    specificFiles: ['src/auth.js', 'src/utils.js'],
    minEventsPerSegment: 3,
  },
};
```

### 4. Workspace-Based Segmentation
Segments traces based on workspace path changes.

```typescript
const config = {
  method: 'workspace',
  workspace: {
    minEventsPerSegment: 3,
  },
};
```

### 5. Topic-Based Segmentation
Segments traces based on topic/semantic changes.

```typescript
const config = {
  method: 'topic',
  topic: {
    similarityThreshold: 0.5,
    minEventsPerSegment: 3,
  },
};
```

## Hybrid Strategies

### OR Strategy (Default)
Any method detecting a boundary creates a boundary.

```typescript
const config = {
  method: 'hybrid',
  hybrid: {
    strategy: 'or',
    methods: ['temporal', 'intent', 'file', 'workspace'],
  },
  temporal: { timeGapMinutes: 30 },
  intent: { requireExplicitIntent: false },
  file: { overlapThreshold: 0.3, fileSet: 'workspace' },
  workspace: {},
};
```

### AND Strategy
All (or minAgreement) methods must detect a boundary.

```typescript
const config = {
  method: 'hybrid',
  hybrid: {
    strategy: 'and',
    methods: ['temporal', 'intent'],
    minAgreement: 2, // Optional: require at least 2 methods to agree
  },
  temporal: { timeGapMinutes: 30 },
  intent: { requireExplicitIntent: false },
};
```

### Weighted Strategy
Methods vote with weights, threshold determines boundary.

```typescript
const config = {
  method: 'hybrid',
  hybrid: {
    strategy: 'weighted',
    methods: ['temporal', 'intent', 'file'],
    weights: {
      temporal: 0.4,
      intent: 0.4,
      file: 0.2,
    },
  },
  temporal: { timeGapMinutes: 30 },
  intent: { requireExplicitIntent: false },
  file: { overlapThreshold: 0.3, fileSet: 'workspace' },
};
```

### Sequential Strategy
Try methods in order, first one that detects boundary wins.

```typescript
const config = {
  method: 'hybrid',
  hybrid: {
    strategy: 'sequential',
    methods: ['intent', 'temporal', 'file'],
    order: ['intent', 'temporal', 'file'], // Must match methods
  },
  intent: { requireExplicitIntent: false },
  temporal: { timeGapMinutes: 30 },
  file: { overlapThreshold: 0.3, fileSet: 'workspace' },
};
```

## Using from UI/CLI

### Configuration Builder

```typescript
import { SegmentationConfigBuilder } from './segmentation';

// From UI input
const uiInput = {
  method: 'hybrid',
  hybridStrategy: 'or',
  hybridMethods: ['temporal', 'intent', 'file'],
  timeGapMinutes: 30,
  fileOverlapThreshold: 0.3,
  fileSet: 'workspace',
  minEventsPerSegment: 3,
};

const { config, validation } = SegmentationConfigBuilder.build(uiInput);

if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
  return;
}

const segmenter = createSegmenter(config);
const result = segmenter.segment(traces);
```

### From JSON (CLI/API)

```typescript
const jsonConfig = `{
  "method": "hybrid",
  "hybridStrategy": "or",
  "hybridMethods": ["temporal", "intent", "file"],
  "timeGapMinutes": 30,
  "fileOverlapThreshold": 0.3,
  "fileSet": "workspace"
}`;

const { config, validation } = SegmentationConfigBuilder.fromJSON(jsonConfig);
```

## Presets

```typescript
import { SegmentationPresets } from './segmentation';

// Available presets
const presets = SegmentationPresets.getAllPresets();
// Returns: [{ name, description, config }, ...]

// Use a preset
const config = SegmentationPresets.hybridOr();
const config = SegmentationPresets.temporal();
const config = SegmentationPresets.intent();
const config = SegmentationPresets.fileWorkspace();
const config = SegmentationPresets.fileSpecific(['src/auth.js']);
const config = SegmentationPresets.workspace();
const config = SegmentationPresets.topic();
```

## Validation

```typescript
import { SegmentationConfigValidator } from './segmentation';

const validation = SegmentationConfigValidator.validate(config);

if (!validation.valid) {
  console.error('Errors:', validation.errors);
  console.warn('Warnings:', validation.warnings);
}

// Get valid combinations for UI
const combinations = SegmentationConfigValidator.getValidCombinations();
// Returns available methods with required/optional configs

// Get hybrid strategies
const strategies = SegmentationConfigValidator.getHybridStrategies();
// Returns available strategies with required configs
```

## Valid Combinations

All methods can be used independently or combined in hybrid mode:

- ✅ **Single methods**: `temporal`, `intent`, `file`, `workspace`, `topic`
- ✅ **Hybrid OR**: Any method triggers boundary (default behavior)
- ✅ **Hybrid AND**: All methods must agree
- ✅ **Hybrid Weighted**: Weighted voting
- ✅ **Hybrid Sequential**: Try methods in order

## File Structure

```
segmentation/
├── types.ts              # Type definitions
├── base.ts               # Base detector class
├── temporal.ts            # Temporal segmentation
├── intent.ts              # Intent-based segmentation
├── file-segmentation.ts   # File-based segmentation
├── workspace.ts           # Workspace-based segmentation
├── topic.ts               # Topic-based segmentation
├── hybrid.ts              # Hybrid strategies
├── segmenter.ts           # Main segmentation service
├── config-validator.ts    # Configuration validation
├── presets.ts             # Pre-configured options
├── config-builder.ts      # UI/CLI configuration builder
├── index.ts               # Module exports
└── README.md              # This file
```

## Integration Examples

### UI Integration

```typescript
// React component example
function SegmentationConfigForm() {
  const [method, setMethod] = useState<SegmentationMethod>('hybrid');
  const [config, setConfig] = useState<SegmentationConfig | null>(null);

  const handleSubmit = (input: UISegmentationInput) => {
    const { config: newConfig, validation } = SegmentationConfigBuilder.build({
      ...input,
      method,
    });

    if (validation.valid) {
      setConfig(newConfig);
    } else {
      // Show validation errors to user
      alert(validation.errors.join('\n'));
    }
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### CLI Integration

```typescript
// CLI script example
import { readFileSync } from 'fs';
import { SegmentationConfigBuilder, createSegmenter } from './segmentation';

const configPath = process.argv[2];
const tracesPath = process.argv[3];

const configJson = readFileSync(configPath, 'utf-8');
const { config, validation } = SegmentationConfigBuilder.fromJSON(configJson);

if (!validation.valid) {
  console.error('Invalid config:', validation.errors);
  process.exit(1);
}

const traces = JSON.parse(readFileSync(tracesPath, 'utf-8'));
const segmenter = createSegmenter(config);
const result = segmenter.segment(traces);

console.log(JSON.stringify(result, null, 2));
```

## Notes

- All segmentation methods respect `minEventsPerSegment` to avoid creating segments with too few events
- Hybrid strategies allow flexible combination of methods
- Configuration validation ensures only valid combinations are used
- Presets provide sensible defaults for common use cases



















