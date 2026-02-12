# Representations for Learning from Developer-Agent Workflows

This repository provides a **multi-level representation engineering framework** for capturing, transforming, and analyzing developer-agent interaction traces from Cursor IDE. It implements a privacy-expressiveness frontier with 6 levels of abstraction designed for evaluation and privacy-preserving data sharing.

## Table of Contents

- [System Overview](#system-overview)
- [Architecture Components](#architecture-components)
- [The 6-Level Representation System](#the-6-level-representation-system-rungs)
- [Quick Start](#quick-start)
- [Key Tools Reference](#key-tools-reference)
- [Data Flow Pipeline](#data-flow-pipeline)
- [Configuration](#configuration)
- [Privacy & Security](#privacy--security)
- [API Reference](#api-reference)
- [Advanced Usage](#advanced-usage)
- [Learn More](#learn-more)

---

## System Overview

A comprehensive telemetry system that captures real-time developer-agent interactions and transforms them into progressively abstract representations. Each representation level provides different tradeoffs between privacy and expressiveness, enabling:

- **Research**: Privacy-preserving datasets for studying developer workflows
- **Evaluation**: Metrics like Context Precision for agent performance
- **Sharing**: Graduated disclosure from raw logs to abstract patterns
- **Analysis**: Behavioral clustering and workflow mining

---

## Architecture Components

The system consists of three main components working together:

### 1. `/companion` - Data Capture Service (Node.js)

**Purpose**: Real-time telemetry capture from Cursor IDE  
**Port**: 43917  
**Database**: SQLite (local) or PostgreSQL (cloud)

**Key Capabilities**:
- Multi-modal event capture (code changes, prompts, terminal commands)
- MCP (Model Context Protocol) integration for IDE communication
- File watching with diff computation
- Terminal monitoring and command tracking
- IDE state capture (open files, cursor position, etc.)
- Prompt-to-change linking with temporal windows

**Start the service**:
```bash
cd companion
npm install
npm start  # http://localhost:43917
```

### 2. `/representations` - Transformation Pipeline (Python)

**Purpose**: Transform raw traces into 6 abstraction levels

**Core Modules**:
- `canonicalization.py` - Rule-free event normalization using SHA1 hashing
- `intent.py` - Prompt intent extraction and classification
- `intent_hierarchical.py` - Multi-level intent modeling
- `utils.py` - AST parsing, tokenization, PII redaction

**Encoders** (one per rung):
- `raw.py` - Complete events with metadata
- `tokens.py` - Canonicalized token sequences
- `edits.py` - AST-based edit operations
- `functions.py` - Function-level changes
- `modules.py` - File dependency graphs
- `motifs.py` - Workflow patterns (PrefixSpan + Sequitur)

**Usage**:
```python
from representations import tokens_repr, motifs_repr, raw_repr

# Transform traces at different abstraction levels
tokens = tokens_repr(trace)  # Token sequences
motifs = motifs_repr(trace)  # High-level patterns
raw = raw_repr(trace)        # Full events with PII redaction
```

### 3. `/analysis` - Computational Model (Python)

**Purpose**: Sequence processing, clustering, and behavioral library construction

**Key Components**:
- `sequence_processor.py` - Main orchestration service
- `vectorizer.py` - Event vectorization with embeddings
- `database_connector.py` - Database abstraction (SQLite/PostgreSQL)
- `config.py` - Configuration management

**Analysis Scripts**:
- `cluster_sequences.py` - DTW-based sequence clustering
- `calculate_cp.py` - Context Precision metrics
- `ab_test_analysis.py` - A/B testing framework

---

## The 6-Level Representation System (Rungs)

Each level represents a different privacy-expressiveness tradeoff:

| **Level** | **Compression** | **Description** | **Key Files** | **Use Case** |
|-----------|----------------|-----------------|---------------|--------------|
| **Rung 1: Raw** | ~1x | Complete event logs with PII redaction | `raw.py`, `raw-data-schema.js` | Ground truth, full detail |
| **Rung 2: Tokens** | ~10x | Canonicalized token sequences | `tokens.py`, `rung1-service.js` | Research datasets |
| **Rung 3: Semantic Edits** | ~11x | AST-based edit operations | `edits.py`, `rung2-service.js` | Workflow analysis |
| **Rung 4: Functions** | ~39x | Function-level changes & signatures | `functions.py`, `rung3-service.js` | API tracking |
| **Rung 5: Module Graphs** | ~100x | File dependencies & coupling | `modules.py`, `module-graph-builder.js` | Team collaboration |
| **Rung 6: Motifs** | ~240x | Abstract workflow patterns | `motifs.py`, `motif_mining.py` | Public sharing |

#### Example Outputs (One-line samples)

```json
// Rung 1: Raw
{"events": [{"type": "code_change", "file": "utils.ts", "diff": "+15, -8", "before": "export function processData(...)", "after": "export async function processData(...)"}]}

// Rung 2: Tokens  
["FUNCTION_DECL", "ASYNC", "PARAM:input", "PARAM:options", "RETURN_TYPE:Promise", "AWAIT", "CALL:BaseUtil.process", "RETURN"]

// Rung 3: Semantic Edits
["EDIT(modify)→OP:async_wrapper", "EDIT(modify)→OP:signature_change", "EDIT(delete)→OP:remove_function", "EDIT(create)→OP:new_module"]

// Rung 4: Functions
["MODIFY processData params:(input:string)→(input:string,options:Config) return:void→Promise<string>", "ADD BaseUtil.process", "DELETE deprecatedHelper"]

// Rung 5: Module Graphs
["utils.ts→api.ts (imports, co-edited 5×)", "api.ts→config.ts (depends_on, co-edited 3×)", "utils.ts→models.ts (new_dependency)"]

// Rung 6: Motifs
["PROMPT→EXPLORE→REFACTOR→ABSTRACT→TEST→COMMIT", "intent:'extract-and-consolidate refactoring', freq:23"]
```

---

## Quick Start

### Option 1: Local Development

**Step 1: Start the companion service**
```bash
cd companion
npm install
npm start
```

**Step 2: Use Cursor IDE normally** - events are captured automatically

**Step 3: Transform traces**
```python
from representations import motifs_repr
from analysis import SequenceProcessor

# Load and transform
processor = SequenceProcessor()
sequences = processor.extract_sequences()
```

### Option 2: Analyze Existing Data

```python
from analysis import DatabaseConnector, EventVectorizer

db = DatabaseConnector()
events = db.get_events(limit=100)

vectorizer = EventVectorizer()
vectorizer.build_event_type_encoder(events)
```

### Option 3: Export to HuggingFace

```bash
# Export at different rung levels
curl "http://localhost:43917/api/hf/export?rung=tokens"
curl "http://localhost:43917/api/hf/export?rung=motifs"

# Upload to HuggingFace Hub
cd companion
./cli.js hf upload ./data/export-xxx --repo username/dataset --token hf_xxx
```

---

## Key Implementation Details

### Core Algorithms

#### Event Canonicalization
**Location**: `representations/core/canonicalization.py`

Rule-free event encoding:
```python
def canonicalize_event(event: Dict) -> str:
    """
    Hashes event types to stable symbols (e.g., "EV_a13f92")
    - Ensures privacy by obscuring event types
    - Creates stable finite alphabet
    - Works across IDEs, languages, agents
    """
```

#### 6. Motif Mining
**Location**: `representations/encoders/motif_mining.py`

Statistical pattern discovery:
- **MotifRegistry**: Tracks hash→pattern mappings for interpretability
- **PrefixSpan**: Discovers frequent subsequences
- **Sequitur**: Grammar-based compression
- **Pattern types**: 
  - Transitions: `T_EV_xxx_EV_yyy`
  - PrefixSpan: `PS_EV_xxx_EV_yyy_...`
  - Sequitur: `SQ_xxx`
  - Cycles: `CYCLE_EV_xxx_EV_yyy`
  - Hotspots: `HOT_EV_xxx_N`

Natural language descriptions generated for all motifs.

#### Sequence Processor
**Location**: `analysis/sequence_processor.py`

Main orchestration service:
```python
class SequenceProcessor:
    def extract_sequences() -> List[List[Dict]]
        """Group events by session, filter by length"""
    
    def vectorize_sequences() -> List[Dict]
        """Convert to numerical vectors with embeddings"""
    
    def cluster_sequences() -> Dict
        """DTW-based clustering"""
    
    def build_behavioral_library() -> Dict
        """Full pipeline: extract → vectorize → cluster → filter by CP"""
```

#### Event Vectorizer
**Location**: `analysis/vectorizer.py`

Converts events to numerical representations:
- **One-hot encoding** for event types
- **Text embeddings** for prompts (768-dim)
- **Embedding services**: Local, OpenRouter, HuggingFace
- **Caching** for performance
- Default model: `sentence-transformers/all-mpnet-base-v2`

#### Context Precision Calculator
**Location**: `analysis/scripts/calculate_cp.py`

Measures context usage efficiency:
```python
CP = |Context_files ∩ Diff_files| / |Context_files|
```

Features:
- Extracts context files from prompt metadata
- Time-windowed association (default: 5 minutes)
- Identifies unused context files
- Baseline CP calculation across all prompts

#### Sequence Clustering
**Location**: `analysis/scripts/cluster_sequences.py`

Behavioral clustering:
- **DTW (Dynamic Time Warping)** with `tslearn`
- Handles variable-length sequences
- Fallback to standard k-means
- Configurable cluster sizes and methods

#### Persistent Database
**Location**: `companion/src/database/persistent-db.js`

Dual-backend database abstraction:
- **SQLite** for local development
- **PostgreSQL** for cloud deployment
- **Schema**: events, prompts, entries, conversations, rung1/2/3 tables
- Automatic migrations and optimizations
- Connection pooling for PostgreSQL

**Schema highlights**:
```sql
-- Core tables
events (id, type, timestamp, details, workspace_path, session_id, prompt_id)
prompts (id, text, timestamp, context_files_json, model_info)
entries (id, file_path, before_code, after_code, notes, timestamp)

-- Rung tables
rung1_tokens (id, file_path, diff_timestamp, tokens, prompt_id)
rung2_edit_scripts (id, file_path, operation, before_ast, after_ast)
rung3_function_changes (id, function_name, signature, change_type)
```

---

## Data Flow Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. CAPTURE (Companion Service on port 43917)                   │
├─────────────────────────────────────────────────────────────────┤
│ File Watcher  →  Code changes with diffs                        │
│ Prompt Capture → AI interactions + context                      │
│ Terminal Monitor → Command execution                            │
│ MCP Handler   →  IDE events via JSON-RPC                        │
│                     ↓                                            │
│              Raw Events & Metadata                               │
│                     ↓                                            │
│         SQLite/PostgreSQL Database                               │
└─────────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. TRANSFORM (Representations - Python)                         │
├─────────────────────────────────────────────────────────────────┤
│ Raw events → Canonicalize → Extract features                    │
│                     ↓                                            │
│           Rung Encoders (Parallel)                               │
│  ┌──────────┬──────────┬───────────┬──────────┬────────┐       │
│  │ Tokens   │ Edits    │ Functions │ Modules  │ Motifs │       │
│  │ (10x)    │ (11x)    │ (39x)     │ (100x)   │ (240x) │       │
│  └──────────┴──────────┴───────────┴──────────┴────────┘       │
│              Compressed Representations                          │
└─────────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. ANALYZE (Analysis Scripts - Python)                          │
├─────────────────────────────────────────────────────────────────┤
│ Sequences → Vectorize (one-hot + embeddings)                    │
│          → Cluster (DTW-based)                                   │
│          → Calculate Context Precision                           │
│          → Mine Behavioral Patterns                              │
│                     ↓                                            │
│          Behavioral Library + Metrics                            │
└─────────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. EXPORT & SHARE                                               │
├─────────────────────────────────────────────────────────────────┤
│ → HuggingFace Datasets (public/private)                         │
│ → JSON traces (filtered by privacy level)                       │
│ → Parquet files (for analysis)                                  │
│ → API endpoints (real-time access)                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Configuration

### Analysis Configuration
**Location**: `analysis/config.py`

Environment variables:
```bash
# Database
DATABASE_TYPE=sqlite                    # or 'postgres'
DATABASE_URL=postgresql://...           # for PostgreSQL
DATABASE_PATH=/path/to/companion.db     # for SQLite

# Embeddings
EMBEDDING_SERVICE=openrouter            # 'openrouter', 'huggingface', 'local'
OPENROUTER_API_KEY=sk-or-v1-...
HF_TOKEN=hf_...
CLIO_EMBEDDING_MODEL=sentence-transformers/all-mpnet-base-v2

# Clustering
CLUSTERING_METHOD=dtw                   # 'dtw', 'kmeans', 'hierarchical'
MIN_CLUSTER_SIZE=3
MAX_CLUSTERS=20

# Context Precision
CP_TIME_WINDOW_SECONDS=300              # 5 minutes
MIN_CP_THRESHOLD=0.5

# Output
OUTPUT_DIR=./output
LOG_LEVEL=INFO
```

### Companion Configuration
**Location**: `companion/config.json`

```json
{
  "port": 43917,
  "database": {
    "type": "sqlite",
    "path": "./data/companion.db"
  },
  "pii": {
    "redactEmails": true,
    "redactNames": true,
    "redactNumbers": false,
    "redactUrls": true,
    "redactIpAddresses": true,
    "redactFilePaths": true
  },
  "fileWatch": {
    "enabled": true,
    "patterns": ["**/*"],
    "ignorePatterns": ["**/node_modules/**", "**/.git/**"]
  },
  "mcp": {
    "enabled": true,
    "protocol": "2024-11-05"
  }
}
```

---

## Privacy & Security

### PII Redaction Options

All configurable via API or config:

1. **Email addresses**: `user@domain.com` → `<EMAIL_REDACTED>`
2. **Names**: Pattern-based detection and replacement
3. **Numbers**: Optional (useful for keeping line numbers)
4. **URLs**: `https://example.com/path` → `<URL_REDACTED>`
5. **IP addresses**: `192.168.1.1` → `<IP_REDACTED>`
6. **File paths**: `/Users/name/project/file.js` → `<PATH>/project/file.js`
7. **All strings**: Extreme privacy mode
8. **All numbers**: Maximum obfuscation

### Canonicalization (Event Privacy)

Event types are hashed with SHA1:
- `code_change` → `EV_a13f92`
- Stable across runs (deterministic)
- Obscures specific IDE/agent details
- Maintains finite alphabet for mining

### Semantic Fuzzing

Optional expressiveness reduction:
- Replaces specific identifiers with generic tokens
- Reduces overfitting in learned models
- Configurable per-rung

### Graduated Disclosure

Choose representation level based on privacy needs:
- **Public sharing**: Motifs only (~240x compression)
- **Team collaboration**: Module graphs (~100x)
- **Research datasets**: Tokens with PII redaction (~10x)
- **Internal evaluation**: Raw events with redaction

---

## API Reference

### REST API (Companion Service)

**Base URL**: `http://localhost:43917`

#### Data Endpoints

```bash
# Get all prompts
GET /api/prompts?workspace=/path/to/workspace&limit=100

# Get events with filters
GET /api/events?workspace=/path&type=code_change&since=2024-01-01

# Get file change entries
GET /api/entries?file_path=src/index.js
```

#### Rung Endpoints

```bash
# Tokens (Rung 2)
GET /api/rung1/tokens?workspace=/path&redact_emails=true

# Edit scripts (Rung 3)
GET /api/rung2/edit-scripts?workspace=/path

# Function changes (Rung 4)
GET /api/rung3/functions?workspace=/path

# Module graph (Rung 5)
GET /api/module-graph?workspace=/path
```

#### Export Endpoints

```bash
# Export at specific rung level
GET /api/hf/export?rung=tokens
GET /api/hf/export?rung=motifs&workspace=/path

# Custom export with filters
POST /api/export/custom
Content-Type: application/json
{
  "rung": "tokens",
  "workspace": "/path",
  "since": "2024-01-01",
  "pii": {
    "redactEmails": true,
    "redactFilePaths": true
  }
}
```

#### Analytics Endpoints

```bash
# Context Precision metrics
GET /api/analytics/context-precision?workspace=/path

# Session summary
GET /api/analytics/session-summary?session_id=xyz

# Activity timeline
GET /api/analytics/activity?start=2024-01-01&end=2024-01-31
```

### Python API

#### Representations

```python
from representations import (
    raw_repr,
    tokens_repr,
    semantic_edits_repr,
    functions_repr,
    module_graph_repr,
    motifs_repr
)

# All functions accept trace dict and optional params
trace = {...}  # Your trace data

# Different abstraction levels
raw = raw_repr(trace, include_metadata=True, redact_pii_enabled=True)
tokens = tokens_repr(trace, include_prompts=True)
edits = semantic_edits_repr(trace)
functions = functions_repr(trace)
modules = module_graph_repr(trace)
motifs = motifs_repr(trace, use_statistical_mining=True, include_prompts=True)
```

#### Analysis

```python
from analysis import SequenceProcessor, DatabaseConnector, EventVectorizer

# Database access
db = DatabaseConnector()
events = db.get_events_with_prompts(workspace_path="/path")
prompts = db.get_prompts(limit=100)

# Vectorization
vectorizer = EventVectorizer()
vectorizer.build_event_type_encoder(events)
vectorized = vectorizer.vectorize_event(event, prompt_text="Fix bug")

# Sequence processing
processor = SequenceProcessor()
sequences = processor.extract_sequences(workspace_path="/path")
vectorized = processor.vectorize_sequences(sequences)
clusters = processor.cluster_sequences(vectorized, method='dtw', n_clusters=10)
library = processor.build_behavioral_library(workspace_path="/path")
```

---

## Advanced Usage

### Example 1: Calculate Context Precision for All Prompts

```python
from analysis import DatabaseConnector
from analysis.scripts.calculate_cp import calculate_cp, extract_context_files

db = DatabaseConnector()
prompts = db.get_prompts(limit=1000)

cp_scores = []
for prompt in prompts:
    # Get files changed after this prompt (5-minute window)
    diff_files = db.get_entries_for_prompt(prompt['id'], time_window_seconds=300)
    diff_file_paths = [e['file_path'] for e in diff_files]
    
    # Calculate CP
    result = calculate_cp(prompt, diff_file_paths)
    cp_scores.append(result['cp'])
    
    if result['cp'] < 0.3:  # Low precision
        print(f"Prompt {prompt['id']}: CP={result['cp']:.2f}")
        print(f"  Unused context: {result['unused_context_files']}")

print(f"Average CP: {sum(cp_scores)/len(cp_scores):.2f}")
```

### Example 2: Build Behavioral Library with Clustering

```python
from analysis import SequenceProcessor

processor = SequenceProcessor()

# Extract and cluster sequences
library = processor.build_behavioral_library(
    workspace_path="/path/to/workspace",
    min_cp=0.5  # Only include high-quality sequences
)

print(f"Total sequences: {library['total_sequences']}")
print(f"Clusters found: {library['clusters_found']}")
print(f"High CP sequences: {library['high_cp_count']}")

# Save library
processor.save_library(library, "behavioral_library.json")
```

### Example 3: Export Custom Dataset

```bash
# Export tokens with maximum privacy
curl -X GET "http://localhost:43917/api/hf/export?rung=tokens&redact_emails=true&redact_names=true&redact_file_paths=true&fuzz_semantic_expressiveness=true" > tokens_private.json

# Export motifs for public sharing
curl "http://localhost:43917/api/hf/export?rung=motifs" > motifs_public.json

# Upload to HuggingFace
cd companion
./cli.js hf upload tokens_private.json --repo myuser/private-dataset --private --token hf_xxx
./cli.js hf upload motifs_public.json --repo myuser/public-patterns --token hf_xxx
```

### Example 4: Real-time Monitoring

```python
import requests
import time

# Monitor prompt activity in real-time
while True:
    response = requests.get("http://localhost:43917/api/prompts?limit=10")
    prompts = response.json()
    
    for prompt in prompts:
        print(f"[{prompt['timestamp']}] {prompt['text'][:50]}...")
        
        # Calculate CP for recent prompt
        entries = requests.get(
            f"http://localhost:43917/api/entries?prompt_id={prompt['id']}"
        ).json()
        
        context_files = len(prompt.get('context_files_json', []))
        diff_files = len(entries)
        
        if context_files > 0:
            cp = diff_files / context_files
            print(f"  CP: {cp:.2f} ({diff_files}/{context_files} files used)")
    
    time.sleep(30)
```

### Example 5: Motif Mining and Interpretation

```python
from representations import motifs_repr
from representations.encoders.motif_mining import MotifRegistry

# Extract motifs
trace = {...}  # Your trace
motifs = motifs_repr(trace, use_statistical_mining=True, include_prompts=True)

# Get human-readable descriptions
registry = MotifRegistry()
for motif in motifs[:10]:
    description = registry.describe(motif)
    category = registry.get_category(motif)
    original = registry.get_original(motif)
    
    print(f"Motif: {motif}")
    print(f"  Description: {description}")
    print(f"  Category: {category}")
    if original:
        print(f"  Original: {original}")
    print()
```

---

## Troubleshooting

### Database is empty
```bash
# Check if companion service is running
curl http://localhost:43917/api/status

# Verify database path
ls -lh companion/data/companion.db

# Check for write permissions
```

### MCP not capturing events
```bash
# Verify MCP configuration in Cursor IDE settings
# Check companion logs for MCP messages
tail -f companion/logs/mcp.log
```

### Embedding service fails
```bash
# Use local embeddings
export EMBEDDING_SERVICE=local
pip install sentence-transformers

# Or provide API keys
export OPENROUTER_API_KEY=sk-or-v1-...
export HF_TOKEN=hf_...
```

### Out of memory during clustering
```python
# Reduce sequence length or cluster size
processor.cluster_sequences(
    vectorized,
    method='kmeans',  # Use simpler method
    n_clusters=5,     # Fewer clusters
    min_cluster_size=5
)
```

---

## Learn More

- **Project Site**: [https://telemetry-landing.netlify.app/](https://telemetry-landing.netlify.app/)
- **Paper**: Coming soon
- **Examples**: See `/analysis/example_usage.py` for more code examples
- **License**: MIT
