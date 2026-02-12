"""
Universal Rung Extraction Functions

This module provides consistent rung extraction functions for all abstraction levels:

Sequence Representations (what happened):
- raw: Raw representation (code_change, prompt, metadata) with PII redaction
- tokens: Token-level sequences with canonicalized identifiers
- semantic_edits: Semantic edit operations
- functions: Function-level changes
- motifs: High-level workflow patterns (using universal motif extraction)

Graph Representations (how things relate):
- file_edit_graph: Graph of which files were edited in sequence
- function_edit_graph: Graph of which functions were edited in sequence

Legacy (deprecated):
- module_graph: Module/file-level relationships (use file_edit_graph instead)

All functions use universal motif extraction for consistent representation across rungs.

Defaults are set to "everything on" for completeness:
- include_prompts=True (include prompts in representations)
- use_statistical_mining=True (use PrefixSpan/Sequitur)
- include_metadata=True (include metadata in raw representation)
- redact_pii_enabled=True (redact PII by default)
- canonicalize=False (use named identifiers by default; set True for privacy)
"""

from .canonicalization import (
    CANONICAL_EVENT_MAP,
    canonicalize_event,
    canonicalize_event_legacy,
    event_sequence,
    extract_prompt_from_event,
)
from .intent import (
    canonicalize_prompt,
    extract_intent_vector,
    extract_event_intent,
    intent_tokens_for_event,
    intent_tokens_for_prompt,
    # Emergent intent (Values in the Wild approach)
    EmergentIntentTaxonomy,
    get_emergent_taxonomy,
    extract_emergent_intent,
    extract_intent,
    discover_intent_taxonomy,
    compare_intent_methods,
)
from .motif_mining import (
    extract_intent_motifs,
    extract_structural_motifs,
    extract_universal_motifs,
    motifs_from_sequence,
    motif_registry,
    MotifRegistry,
    prefixspan,
    prefixspan_motifs,
    sequitur_rules,
    structural_motifs,
    transition_motifs,
    unify_motifs,
)
from .representations import (
    BASE_SEQUENCE_FUNCS,
    GRAPH_FUNCS,
    RUNG_FUNCS_LIST,
    RUNG_FUNCS_STR,
    extract_motifs_from_rung,
    file_edit_graph_repr,
    file_edit_graph_repr_str,
    function_edit_graph_repr,
    function_edit_graph_repr_str,
    functions_repr,
    functions_repr_str,
    module_graph_repr,
    module_graph_repr_str,
    motifs_repr,
    motifs_repr_str,
    raw_repr,
    raw_repr_str,
    semantic_edits_repr,
    semantic_edits_repr_str,
    tokens_repr,
    tokens_repr_str,
)
from .utils import (
    _extract_code_tokens,
    _python_function_names,
    _tokenize_generic,
    _tokenize_java_ast,
    _tokenize_js_ast,
    _tokenize_python_ast,
    count_ops,
    dependencies_repr,
    extract_function_names_from_code,
    extract_imports_from_code,
    files_repr,
    get_file_action_stats,
    redact_code_pii,
    redact_pii,
)

__all__ = [
    # Canonicalization
    'canonicalize_event',
    'canonicalize_event_legacy',
    'CANONICAL_EVENT_MAP',
    'event_sequence',
    'extract_prompt_from_event',
    # Intent (keyword-based)
    'canonicalize_prompt',
    'extract_intent_vector',
    'extract_event_intent',
    'intent_tokens_for_event',
    'intent_tokens_for_prompt',
    # Intent (emergent - Values in the Wild approach)
    'EmergentIntentTaxonomy',
    'get_emergent_taxonomy',
    'extract_emergent_intent',
    'extract_intent',
    'discover_intent_taxonomy',
    'compare_intent_methods',
    # Motif Mining
    'transition_motifs',
    'structural_motifs',
    'prefixspan',
    'prefixspan_motifs',
    'sequitur_rules',
    'unify_motifs',
    'motifs_from_sequence',
    'extract_universal_motifs',
    'extract_structural_motifs',
    'extract_intent_motifs',
    'motif_registry',
    'MotifRegistry',
    # Representations
    'raw_repr',
    'raw_repr_str',
    'tokens_repr',
    'tokens_repr_str',
    'semantic_edits_repr',
    'semantic_edits_repr_str',
    'functions_repr',
    'functions_repr_str',
    'module_graph_repr',
    'module_graph_repr_str',
    'file_edit_graph_repr',
    'file_edit_graph_repr_str',
    'function_edit_graph_repr',
    'function_edit_graph_repr_str',
    'motifs_repr',
    'motifs_repr_str',
    'extract_motifs_from_rung',
    'RUNG_FUNCS_LIST',
    'RUNG_FUNCS_STR',
    'BASE_SEQUENCE_FUNCS',
    'GRAPH_FUNCS',
    # Utils
    '_extract_code_tokens',
    '_python_function_names',
    '_tokenize_python_ast',
    '_tokenize_js_ast',
    '_tokenize_java_ast',
    '_tokenize_generic',
    'extract_function_names_from_code',
    'count_ops',
    'extract_imports_from_code',
    'files_repr',
    'dependencies_repr',
    'get_file_action_stats',
    'redact_pii',
    'redact_code_pii',
]


# Convenience wrapper functions with defaults set to "everything on"
def tokens_repr_default(trace):
    """Extract tokens with defaults: include_prompts=True"""
    return tokens_repr(trace, include_prompts=True)


def semantic_edits_repr_default(trace):
    """Extract semantic edits with defaults: include_prompts=True"""
    return semantic_edits_repr(trace, include_prompts=True)


def functions_repr_default(trace):
    """Extract functions with defaults: include_prompts=True"""
    return functions_repr(trace, include_prompts=True)


def motifs_repr_default(trace):
    """Extract motifs with defaults: use_statistical_mining=True, include_prompts=True"""
    return motifs_repr(trace, use_statistical_mining=True, include_prompts=True)


def raw_repr_default(trace):
    """Extract raw representation with defaults: include_metadata=True, redact_pii_enabled=True"""
    return raw_repr(trace, include_metadata=True, redact_pii_enabled=True)


def extract_motifs_from_rung_default(trace, rung_name):
    """Extract motifs from rung with defaults: use_statistical_mining=True, include_prompts=True"""
    return extract_motifs_from_rung(trace, rung_name, use_statistical_mining=True, include_prompts=True)









