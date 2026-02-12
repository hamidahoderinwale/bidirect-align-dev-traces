# Bidirectional Alignment for Developer Workflows

A framework for representing developer workflows at multiple abstraction levels, enabling privacy-preserving collective learning and bidirectional human-AI alignment.

## Overview

This repository contains:
- **Companion Service**: Backend for capturing multi-modal telemetry from Cursor IDE
- **Representation Engineering**: Six encoders (Raw, Tokens, Functions, Edits, Modules, Motifs) spanning a privacy-expressiveness frontier
- **Research Tools**: Evaluation notebooks and analysis scripts for studying workflow representations

## Key Features

### Multi-Level Representations

1. **Raw** - Complete event logs (ground truth)
2. **Tokens** - Canonicalized token sequences with PII redaction
3. **Functions** - Function-level changes and API evolution
4. **Semantic Edits** - AST-based edit operations
5. **Module Graphs** - File dependencies and architectural coupling
6. **Motifs** - Abstract workflow patterns (highest privacy)

### Privacy-Preserving Export

- 5 privacy levels (rungs) with configurable PII redaction
- Selective sharing: choose abstraction level based on use case
- K-anonymity guarantees at higher abstraction levels
- Support for JSON, CSV, SQLite, and Hugging Face dataset formats

### Workflow Analysis

- Procedural pattern discovery through motif mining
- Intent classification and semantic clustering
- Compression analysis (vocabulary size, storage efficiency)
- Downstream utility evaluation (retrieval, classification tasks)

## Repository Structure

```
bidirect-align-dev/
├── companion/                      # Data capture service
│   ├── src/
│   │   ├── services/
│   │   │   ├── rung1/             # Token-level abstraction
│   │   │   ├── rung2/             # Semantic edits
│   │   │   ├── rung3/             # Function-level
│   │   │   ├── module-graph/      # Dependency graphs
│   │   │   └── clio/              # Motif extraction
│   │   ├── routes/                # API endpoints
│   │   ├── database/              # Data persistence
│   │   └── monitors/              # File/terminal watchers
│   ├── computational-model/        # Python analysis tools
│   └── package.json
│
├── research/
│   ├── rung_extractors/          # Representation engineering
│   │   ├── representations.py     # Core abstraction logic
│   │   ├── canonicalization.py   # Identifier normalization
│   │   ├── motif_mining.py       # Pattern discovery
│   │   └── intent.py              # Intent classification
│   ├── evaluation/                # Research notebooks
│   │   ├── probes/                # Downstream task evaluation
│   │   ├── retrieval/             # Context retrieval studies
│   │   ├── search/                # Semantic search experiments
│   │   └── segmentation/          # Segmentation strategies
│   └── paper/                     # CHI Workshop paper
│       ├── vision_paper_v2_revised_edited.tex
│       └── references.bib
│
└── docs/                          # Documentation
```

## Quick Start

### Companion Service

```bash
cd companion
npm install
npm start  # Starts on port 43917
```

### Data Export

```bash
# Export with privacy controls
curl "http://localhost:43917/api/export/data?rung=motifs" > workflows.json

# Or use CLI
cd companion
npm link
cursor-telemetry export json --rung motifs -o workflows.json
```

### Research Notebooks

```bash
cd research/evaluation
# Install dependencies
pip install -r requirements.txt

# Run evaluation notebooks
jupyter notebook
```

## Use Cases

### For Researchers
- Export anonymized workflow datasets
- Study developer behavior patterns
- Train code generation models on procedural data
- Analyze human-AI collaboration dynamics

### For Developers
- Track personal productivity patterns
- Share workflow strategies with privacy controls
- Learn from aggregated community patterns
- Improve AI assistant prompt engineering

### For Organizations
- Analyze team development workflows
- Evaluate AI coding assistant effectiveness
- Identify process bottlenecks
- Build privacy-preserving analytics

## Key Concepts

### Representation Axes

Our framework defines four orthogonal axes:
1. **Segmentation**: How to chunk event streams (sessions, prompts, time windows)
2. **Scale**: File-level, project-level, or workflow-level analysis
3. **Signal Type**: Structural (code) vs. behavioral (prompts, execution)
4. **Privacy**: Raw identifiers, canonicalized, hashed, or fully anonymized

### Motifs

Motifs are recurring workflow patterns that compress strategies into comparable units:
- **Recurring**: Appear across multiple contexts
- **Meaningful**: Carry semantic significance beyond surface variation
- **Composable**: Combine to form larger strategies

Example: `PROMPT → EDIT(add) → RUN → ERROR → EDIT(fix) → RUN → COMMIT`

### Privacy Levels

| Level | K-Anonymity | Description | Use Case |
|-------|-------------|-------------|----------|
| Motifs | ≥10 | Abstract patterns only | Public sharing |
| Modules | 5 | File dependencies | Team collaboration |
| Functions | 3 | Function signatures | API tracking |
| Edits | 3 | Edit operations | Workflow analysis |
| Tokens | 1 | Token sequences (PII redacted) | Research datasets |

## Documentation

- [Companion Service API](companion/README.md)
- [Representation Engineering](research/rung_extractors/README.md)
- [Research Notebooks](research/evaluation/README.md)
- [CHI Workshop Paper](research/paper/)

## Citation

```bibtex
@inproceedings{oderinwale2026workflow,
  title={Workflow Representations for Collective Developer-Agent Intelligence},
  author={Oderinwale, Hamidah and Arawjo, Ian and Guo, Jin L.C.},
  booktitle={CHI Workshop on Bidirectional Human-AI Alignment (BiAlign '26)},
  year={2026},
  address={Barcelona, Spain}
}
```

## License

MIT License - See LICENSE file for details

## Contact

- **Hamidah Oderinwale** - hamidah.oderinwale@mail.mcgill.ca
- Issues: https://github.com/hamidahoderinwale/bidirect-align-dev/issues

