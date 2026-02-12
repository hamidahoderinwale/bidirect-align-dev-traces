# Representations for Learning from Developer-Agent Workflows

---

## Quick Start

```bash
# 1. Start companion service
cd companion && npm install && npm start  # Port 43917

# 2. Use Cursor IDE normally (events captured automatically)

# 3. Transform traces
python
from representations import motifs_repr, tokens_repr
motifs = motifs_repr(trace)  # High-level patterns
tokens = tokens_repr(trace)  # Token sequences
```

---

## The 6-Level Representation System

Each level trades privacy for expressiveness:

| **Level** | **Compression** | **Description** | **Use Case** |
|-----------|----------------|-----------------|--------------|
| **Raw** | 1× | Complete event logs with PII redaction | Ground truth |
| **Tokens** | 10× | Canonicalized token sequences | Research datasets |
| **Edits** | 11× | AST-based edit operations | Workflow analysis |
| **Functions** | 39× | Function-level changes & signatures | API tracking |
| **Modules** | 100× | File dependencies & coupling | Team collaboration |
| **Motifs** | 240× | Abstract workflow patterns | Public sharing |

### Example Outputs

```json
// Raw
{"events": [{"type": "code_change", "file": "utils.ts", "diff": "+15, -8", "before": "...", "after": "..."}]}

// Tokens  
["FUNCTION_DECL", "ASYNC", "PARAM:input", "RETURN_TYPE:Promise", "AWAIT", "CALL:process"]

// Edits
["EDIT(modify)→OP:async_wrapper", "EDIT(delete)→OP:remove_function"]

// Functions
["MODIFY processData params:(string)→(string,Config) return:void→Promise<string>"]

// Modules
["utils.ts→api.ts (imports, co-edited 5×)", "api.ts→config.ts (depends_on)"]

// Motifs
["PROMPT→EXPLORE→REFACTOR→ABSTRACT→TEST→COMMIT", "intent:'refactoring', freq:23"]
```

---

## Architecture

### `/companion` - Data Capture (Node.js)
Captures real-time telemetry from Cursor IDE via MCP protocol. Stores in SQLite (local) or PostgreSQL (cloud).

**Captures**: Code changes with diffs • AI prompts + context • Terminal commands • File events

### `/representations` - Transformation (Python)
Transforms raw traces into 6 abstraction levels using encoders for each rung.

**Core**: Canonicalization • PII redaction • Intent extraction • Motif mining (PrefixSpan + Sequitur)

### `/analysis` - Computational Model (Python)
Processes sequences, builds behavioral libraries, calculates metrics.

**Features**: DTW-based clustering • Context Precision • Event vectorization • Embeddings

---

## Configuration

### Environment Variables

```bash
# Database
DATABASE_TYPE=sqlite                    # or 'postgres'
DATABASE_PATH=/path/to/companion.db

# Embeddings (optional)
EMBEDDING_SERVICE=local                 # 'openrouter', 'huggingface', 'local'
OPENROUTER_API_KEY=sk-or-v1-...
HF_TOKEN=hf_...

# Clustering
CLUSTERING_METHOD=dtw                   # 'dtw', 'kmeans', 'hierarchical'
CP_TIME_WINDOW_SECONDS=300              # 5 minutes
```

### Companion Config (`companion/config.json`)

```json
{
  "port": 43917,
  "database": {"type": "sqlite", "path": "./data/companion.db"},
  "pii": {
    "redactEmails": true,
    "redactNames": true,
    "redactFilePaths": true
  }
}
```

---

## API Reference

### REST API

**Base URL**: `http://localhost:43917`

```bash
# Data
GET /api/prompts?workspace=/path&limit=100
GET /api/events?type=code_change&since=2024-01-01
GET /api/entries?file_path=src/index.js

# Representations
GET /api/tokens?workspace=/path&redact_emails=true
GET /api/edits?workspace=/path
GET /api/functions?workspace=/path

# Export
GET /api/hf/export?rung=tokens
GET /api/hf/export?rung=motifs&workspace=/path

# Analytics
GET /api/analytics/context-precision?workspace=/path
GET /api/analytics/session-summary?session_id=xyz
```

### Python API

#### Representations

```python
from representations import (
    raw_repr, tokens_repr, semantic_edits_repr,
    functions_repr, module_graph_repr, motifs_repr
)

trace = {...}  # Your trace data

# Transform at different levels
raw = raw_repr(trace, redact_pii_enabled=True)
tokens = tokens_repr(trace, include_prompts=True)
edits = semantic_edits_repr(trace)
functions = functions_repr(trace)
modules = module_graph_repr(trace)
motifs = motifs_repr(trace, use_statistical_mining=True)
```

#### Analysis

```python
from analysis import SequenceProcessor, DatabaseConnector

# Database access
db = DatabaseConnector()
events = db.get_events_with_prompts(workspace_path="/path")

# Sequence processing
processor = SequenceProcessor()
sequences = processor.extract_sequences(workspace_path="/path")
vectorized = processor.vectorize_sequences(sequences)
clusters = processor.cluster_sequences(vectorized, method='dtw')
library = processor.build_behavioral_library(workspace_path="/path")
```

---

## Privacy Features

### PII Redaction
- Emails: `user@domain.com` → `<EMAIL_REDACTED>`
- URLs: `https://example.com` → `<URL_REDACTED>`
- File paths: `/Users/name/project/file.js` → `<PATH>/project/file.js`
- IP addresses, names, optional numbers

### Event Canonicalization
- Hash event types to stable symbols: `code_change` → `EV_a13f92`
- Obscures IDE/agent details while maintaining finite alphabet

### Graduated Disclosure
Choose representation level by privacy needs:
- **Public**: Motifs (~240× compression)
- **Team**: Module graphs (~100×)
- **Research**: Tokens with PII redaction (~10×)
- **Internal**: Raw events with redaction

---

## Data Extraction Without Service

Extract data directly from Cursor databases:

```bash
# Extract raw data
./scripts/extract_cursor_data.sh ./cursor_exports

# Parse to traces
python scripts/parse_to_traces.py --input ./cursor_exports --output traces.jsonl

# Convert formats
python scripts/convert_format.py --input traces.jsonl --output traces.parquet
```

---

## Usage Examples

### Calculate Context Precision

```python
from analysis import DatabaseConnector
from analysis.scripts.calculate_cp import calculate_cp

db = DatabaseConnector()
prompts = db.get_prompts(limit=1000)

for prompt in prompts:
    diff_files = db.get_entries_for_prompt(prompt['id'], time_window_seconds=300)
    result = calculate_cp(prompt, [e['file_path'] for e in diff_files])
    if result['cp'] < 0.3:
        print(f"Low CP: {result['cp']:.2f}, unused: {result['unused_context_files']}")
```

### Export Custom Dataset

```bash
# Export with maximum privacy
curl "http://localhost:43917/api/hf/export?rung=tokens&redact_emails=true&redact_names=true" > dataset.json

# Export motifs for public sharing
curl "http://localhost:43917/api/hf/export?rung=motifs" > motifs_public.json

# Upload to HuggingFace
cd companion
./cli.js hf upload dataset.json --repo user/dataset --private --token hf_xxx
```

### Motif Mining

```python
from representations import motifs_repr
from representations.encoders.motif_mining import MotifRegistry

motifs = motifs_repr(trace, use_statistical_mining=True)

registry = MotifRegistry()
for motif in motifs[:10]:
    print(f"{motif}: {registry.describe(motif)} [{registry.get_category(motif)}]")
```

---

## Key Algorithms

**Event Canonicalization**: SHA1-based hashing for privacy-preserving event encoding

**Motif Mining**: PrefixSpan (frequent subsequences) + Sequitur (grammar compression)

**Context Precision**: `CP = |Context ∩ Diff| / |Context|` (time-windowed)

**Clustering**: DTW (Dynamic Time Warping) for variable-length sequence similarity

---

## Data Flow

```
┌─────────────────────────────────────────────────┐
│ CAPTURE: Companion Service (Port 43917)        │
│ File Watch • Prompt Capture • Terminal Monitor │
│              ↓ SQLite/PostgreSQL                │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ TRANSFORM: Representations (Python)             │
│ Raw → Tokens → Edits → Functions → Modules     │
│                     ↓ Motifs                    │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ ANALYZE: Sequence Processing (Python)          │
│ Vectorize → Cluster → Calculate CP → Library   │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│ EXPORT: HuggingFace • JSON • Parquet • API     │
└─────────────────────────────────────────────────┘
```

---

## Troubleshooting

**Database is empty?**
```bash
curl http://localhost:43917/api/status  # Check service
ls -lh companion/data/companion.db      # Verify database
```

**MCP not capturing?**
```bash
tail -f companion/logs/mcp.log  # Check MCP logs
```

**Embedding service fails?**
```bash
export EMBEDDING_SERVICE=local
pip install sentence-transformers
```

**Out of memory during clustering?**
```python
processor.cluster_sequences(vectorized, method='kmeans', n_clusters=5)
```

---

## Learn More

- **Project Site**: [https://telemetry-landing.netlify.app/](https://telemetry-landing.netlify.app/)
- **Paper**: Coming soon
- **Examples**: See `/analysis/example_usage.py`
- **License**: MIT
