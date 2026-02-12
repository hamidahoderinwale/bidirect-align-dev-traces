# Event Retrieval Evaluation Infrastructure

This directory contains infrastructure for evaluating event-level retrieval using:
1. **LLM-as-Judge Baseline**: LLM directly retrieves events from natural language queries
2. **Multi-Rung Search Engine**: Search across different representation rungs
3. **Comparison Framework**: Analyze differences between methods

## Files

- `event_search_engine.py`: Core search infrastructure
  - `EventIndex`: Indexes events with multiple representation rungs
  - `RungSearchEngine`: Searches using TF-IDF/embeddings on different rungs
  - `LLMJudgeRetriever`: LLM baseline that directly selects relevant events
  - `SearchComparisonFramework`: Compares results across methods

- `event_retrieval_evaluation.ipynb`: Evaluation notebook that:
  - Loads traces and queries
  - Builds event indices for all rungs
  - Runs comparisons across methods
  - Saves results for analysis

## Usage

### 1. Prepare Data

Ensure you have:
- `research/data/companion_traces.jsonl`: Traces with events
- `research/data/procedural_search_queries.json`: Natural language queries

### 2. Run Evaluation

Open `event_retrieval_evaluation.ipynb` and run all cells. The notebook will:

1. **Build Event Index**: Extract all events from traces
2. **Build Rung Indices**: Index events by representation rung (raw, tokens, semantic_edits, functions, motifs)
3. **Load Queries**: Load natural language queries
4. **Run Comparisons**: For each query:
   - LLM-as-judge retrieves events directly
   - Rung-based search retrieves events using different rungs
   - Intent-aware search (if specified)
5. **Analyze Differences**: Compute overlap, unique results, and metrics
6. **Save Results**: Save to `research/results/event_retrieval_comparison.json`

### 3. Analyze Results

Results include:
- **Per-query results**: Event IDs retrieved by each method
- **Overlap analysis**: Jaccard similarity between methods
- **Unique results**: Events found only by specific methods
- **Ground truth metrics**: Precision/recall/F1 (if ground truth provided)

## Search Methods

### LLM-as-Judge
- **Method**: GPT-4 directly selects relevant events from query
- **Input**: Natural language query + event summaries
- **Output**: Ranked list of event IDs
- **Use case**: Baseline comparison, understanding LLM's raw retrieval capability

### Rung-Based Search
- **Method**: TF-IDF or embedding similarity on representation rungs
- **Rungs**: raw, tokens, semantic_edits, functions, motifs
- **Use case**: Compare which rungs work best for different query types

### Intent-Aware Search
- **Method**: Rung search + intent filtering
- **Intent methods**: systematic, embedding_cluster, llm_zero_shot
- **Use case**: Test whether intent information improves retrieval

## Query Format

Queries should be in JSON format:
```json
{
  "id": "query_1",
  "text": "Find all the times I created planning markdown files",
  "query_category": "project_planning",
  "difficulty": "easy",
  "target_rungs": ["semantic_edits", "functions"],
  "intent_method": "systematic",
  "ground_truth_criteria": "Events where file_path ends with .md and contains 'plan'"
}
```

## Results Format

Results are saved as JSON:
```json
{
  "queries": {
    "query_1": {
      "llm_judge": {
        "n_results": 15,
        "results": [{"event_id": "...", "score": 0.95, "rank": 1}, ...]
      },
      "semantic_edits": {
        "n_results": 12,
        "results": [{"event_id": "...", "score": 0.87, "rank": 1}, ...]
      }
    }
  },
  "analyses": {
    "query_1": {
      "overlap_matrix": {
        "llm_judge_vs_semantic_edits": {
          "jaccard": 0.65,
          "overlap": 8
        }
      }
    }
  }
}
```

## Key Comparisons

The infrastructure enables:
1. **Rung Comparison**: Which rung performs best for which query types?
2. **Intent Impact**: Does intent information improve retrieval?
3. **LLM vs Structured**: How does LLM-as-judge compare to structured search?
4. **Query Type Analysis**: Which query categories are hardest/easiest?

## Next Steps

1. **Inter-Rater Analysis**: Add ground truth labels from multiple raters
2. **Metrics Computation**: Compute precision@K, recall@K, MRR with ground truth
3. **Statistical Analysis**: Bootstrap CIs, significance testing
4. **Visualization**: Create plots comparing methods



















