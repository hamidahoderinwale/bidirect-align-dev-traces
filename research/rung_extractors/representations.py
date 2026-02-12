"""
Rung Extraction Functions

All abstraction rung extraction functions:
- raw: Raw representation (code_change, prompt, metadata) with PII redaction
- tokens: Token-level sequences with canonicalized identifiers
- semantic_edits: Semantic edit operations
- functions: Function-level changes
- module_graph: Module/file-level relationships
- motifs: High-level workflow patterns (using universal motif extraction)
"""

import json
from pathlib import Path
from typing import Dict, List

from .canonicalization import event_sequence
from .motif_mining import (
    extract_intent_motifs,
    extract_structural_motifs,
    extract_universal_motifs,
    motifs_from_sequence,
)
from .utils import (
    _extract_code_tokens,
    extract_function_names_from_code,
    redact_code_pii,
    redact_pii,
)


def tokens_repr(trace: Dict, include_prompts: bool = True) -> List[str]:
    """Extract token-level representation: sequence of token types from code.
    
    Higher-level aim:
    - Capture code structure (token types: IDENTIFIER, KEYWORD, OPERATOR)
    - Preserve privacy (canonicalize identifiers, don't expose exact values)
    - Be language-agnostic (works across Python, JS, TS, etc.)
    - Support downstream tasks (classification, retrieval, prediction)
    - Balance privacy-utility (lowest privacy rung but still privacy-preserving)
    
    This extracts token types rather than exact token values, preserving
    code structure while maintaining privacy. For code_change events, it
    tokenizes the code content. For other events, it uses event metadata.
    
    Args:
        trace: Trace dictionary with events
        include_prompts: If True, include prompts in representation
    
    Returns:
        List of token type strings (e.g., ['CONST', 'IDENTIFIER', 'ASSIGN', 'STRING_LITERAL', 'code_change'])
    """
    if not trace or not isinstance(trace, dict):
        return []
    
    tokens = []
    identifier_counter = {}  # For canonicalization: map original -> canonical
    
    events = trace.get('events', [])
    if not events:
        return []
    
    for event in events:
        if not isinstance(event, dict):
            continue
            
        try:
            event_type = (event.get('type') or '').lower()
            details = event.get('details', {})
            
            # Handle string details (JSON-encoded)
            if isinstance(details, str):
                try:
                    details = json.loads(details)
                except (json.JSONDecodeError, TypeError):
                    details = {}
            
            # For code_change events, extract token types from code content
            if isinstance(details, dict):
                code_content = details.get('after_content') or details.get('before_content') or details.get('code', '')
                file_path = details.get('file_path') or details.get('file')
                
                if code_content and isinstance(code_content, str):
                    try:
                        # Extract token types (not values) from code
                        code_tokens = _extract_code_tokens(code_content, file_path)
                        
                        # Canonicalize identifiers: replace with IDENTIFIER_001, IDENTIFIER_002, etc.
                        canonicalized = []
                        id_counter = 1
                        for token in code_tokens:
                            if token == 'IDENTIFIER':
                                canonicalized.append(f'ID_{id_counter:03d}')
                                id_counter += 1
                            else:
                                canonicalized.append(token)
                        
                        tokens.extend(canonicalized[:200])  # Limit per event
                        continue
                    except Exception:
                        # If tokenization fails, fall through to event type
                        pass
            
            # Fallback: use event type for non-code events
            # Include annotation/intent for semantic context
            kind = event.get('type') or event.get('annotation') or event.get('intent')
            if kind:
                tokens.append(str(kind))
        except Exception:
            # Skip malformed events
            continue
    
    return tokens


def semantic_edits_repr(
    trace: Dict, 
    include_prompts: bool = True, 
    include_intent: bool = True,
    canonicalize: bool = False,
    use_emergent: bool = True,  # Default to emergent intent
) -> List[str]:
    """Extract semantic edit representation: operation->target pairs with intent encoding.
    
    Extracts semantic edit operations from events, including:
    - Operation type (create, modify, delete, etc.)
    - Target entity (file, function, class, etc.) - canonicalized or named based on policy
    - Edit characteristics (lines added/removed, diff summary)
    - Code structure changes (function additions, imports, etc.)
    - Intent encoding (multi-dimensional, one-hot-like) for each edit
    - Segment-level intent aggregation
    
    Canonicalization is a policy lever: set canonicalize=True for privacy, False for expressiveness.
    Intent extraction works with both canonicalized and non-canonicalized data, making
    representations maximally meaningful regardless of privacy policy.
    
    Args:
        trace: Trace dictionary with events
        include_prompts: If True, include prompts in representation
        include_intent: If True, include intent encoding for each edit (default: True)
        canonicalize: If True, use generic identifiers (F001, FN001) for privacy; 
                     If False, use actual names for expressiveness (default: False)
        use_emergent: If True, use emergent taxonomy (clustering-based) instead of 
                     fixed keyword categories for intent extraction. Requires taxonomy
                     discovery to have been run first (default: False)
    
    Returns:
        List of semantic edit strings in format "operation->target->intent" or 
        "operation->target->detail->intent", with additional INTENT-> tokens for 
        multi-dimensional encoding.
    """
    if not trace or not isinstance(trace, dict):
        return []
    
    edits = []
    events = trace.get('events', [])
    if not events:
        return []
    
    # Track segment-level intent (rolling window)
    max_segment_size = 10  # Events per segment for intent aggregation
    
    for i, event in enumerate(events):
        if not isinstance(event, dict):
            continue
            
        try:
            event_type = event.get('type', '').lower()
            op = event.get('operation') or event.get('verb') or event_type
            target = event.get('target') or event.get('file') or event.get('symbol')
            details = event.get('details', {})
            
            # Handle string details
            if isinstance(details, str):
                try:
                    details = json.loads(details)
                except (json.JSONDecodeError, TypeError):
                    details = {}
            
            if not isinstance(details, dict):
                details = {}
            
            file_path = details.get('file_path') or details.get('file')
            
            # Extract edit characteristics
            lines_added = details.get('lines_added', 0) or 0
            lines_removed = details.get('lines_removed', 0) or 0
            diff_summary = details.get('diff_summary', '')
            
            # Determine operation type from event characteristics
            if event_type in ('file_change', 'code_change', 'entry_modified'):
                if lines_added > 0 and lines_removed == 0:
                    op = 'ADD'
                elif lines_removed > 0 and lines_added == 0:
                    op = 'REMOVE'
                elif lines_added > 0 and lines_removed > 0:
                    op = 'MODIFY'
                else:
                    op = 'MODIFY'  # Default for file changes
            elif event_type in ('entry_created', 'file_created'):
                op = 'CREATE'
            elif event_type in ('entry_deleted', 'file_deleted'):
                op = 'DELETE'
            
            # Extract target with more detail
            # Canonicalization is a policy lever: False = expressive (actual names), True = privacy (hashed)
            if file_path:
                if canonicalize:
                    # Use generic identifiers for privacy (hash-based maintains uniqueness)
                    import hashlib
                    path_hash = hashlib.md5(str(file_path).encode()).hexdigest()[:8]
                    target_base = f"F_{path_hash}"
                else:
                    # Use actual names for expressiveness and meaningfulness
                    from pathlib import Path
                    path_obj = Path(file_path)
                    file_ext = path_obj.suffix.lower() if path_obj.suffix else 'no_ext'
                    target_base = path_obj.stem
                
                # Try to extract function/class names from code if available
                before_content = details.get('before_content', '')
                after_content = details.get('after_content', '')
                code_content = after_content or before_content
                
                # Extract function/class names from code
                if code_content:
                    from .utils import extract_function_names_from_code
                    funcs = extract_function_names_from_code(code_content, file_path)
                    if funcs:
                        if canonicalize:
                            # Canonicalize function names too
                            import hashlib
                            func_hash = hashlib.md5(str(funcs[0]).encode()).hexdigest()[:6]
                            target = f"{target_base}::FN_{func_hash}"
                        else:
                            # Use actual function name for expressiveness
                            target = f"{target_base}::{funcs[0]}"
                    else:
                        target = target_base
                else:
                    target = target_base
                
                # Add edit size indicator
                if lines_added > 50 or lines_removed > 50:
                    size_indicator = 'LARGE'
                elif lines_added > 10 or lines_removed > 10:
                    size_indicator = 'MEDIUM'
                else:
                    size_indicator = 'SMALL'
                
                # Build semantic edit string
                edit_str = f"{op}->{target}"
                if size_indicator != 'SMALL':
                    edit_str += f"->{size_indicator}"
                
                # Add diff summary keywords if available
                if diff_summary:
                    # Extract key terms from diff summary (first few words)
                    summary_words = diff_summary.split()[:3]
                    if summary_words:
                        edit_str += f"->{'_'.join(summary_words[:2])}"
                
                # Add intent encoding (multi-dimensional, one-hot-like)
                # Intent extraction works regardless of canonicalization policy
                if include_intent:
                    from .intent import intent_tokens_for_event
                    event_intents = intent_tokens_for_event(
                        event, 
                        include_llm=False,
                        use_canonicalized_paths=canonicalize,
                        use_emergent=use_emergent,
                    )
                    # Add primary intent to edit string, additional intents as separate tokens
                    if event_intents:
                        edit_str += f"->{event_intents[0]}"
                        edits.append(edit_str)
                        # Add additional intents as separate tokens (one-hot encoding)
                        # This makes intent multi-dimensional and maximally expressive
                        for additional_intent in event_intents[1:]:
                            edits.append(f"INTENT->{additional_intent}")
                    else:
                        edits.append(edit_str)
                else:
                    edits.append(edit_str)
            elif op and target:
                edit_str = f"{op}->{target}"
                if include_intent:
                    from .intent import intent_tokens_for_event
                    event_intents = intent_tokens_for_event(
                        event, 
                        include_llm=False,
                        use_canonicalized_paths=canonicalize,
                        use_emergent=use_emergent,
                    )
                    if event_intents:
                        edit_str += f"->{event_intents[0]}"
                        edits.append(edit_str)
                        for additional_intent in event_intents[1:]:
                            edits.append(f"INTENT->{additional_intent}")
                    else:
                        edits.append(edit_str)
                else:
                    edits.append(edit_str)
            elif op:
                if include_intent:
                    from .intent import intent_tokens_for_event
                    event_intents = intent_tokens_for_event(
                        event, 
                        include_llm=False,
                        use_canonicalized_paths=canonicalize,
                        use_emergent=use_emergent,
                    )
                    if event_intents:
                        edits.append(f"{op}->{event_intents[0]}")
                        for additional_intent in event_intents[1:]:
                            edits.append(f"INTENT->{additional_intent}")
                    else:
                        edits.append(str(op))
                else:
                    edits.append(str(op))
        
            # Add segment-level intent tokens periodically (aggregate over recent events)
            # Segment-level intent provides higher-level context, making representations
            # maximally meaningful even when individual event intents are sparse
            if include_intent and (i + 1) % max_segment_size == 0:
                # Aggregate intents from recent segment
                from collections import Counter
                from .intent import extract_event_intent, extract_emergent_intent
                segment_events = events[max(0, i - max_segment_size + 1):i + 1]
                segment_intent_counts = Counter()
                for seg_event in segment_events:
                    if use_emergent:
                        seg_intents = extract_emergent_intent(seg_event, use_llm=False)
                    else:
                        seg_intents = extract_event_intent(seg_event, use_canonicalized_paths=canonicalize)
                    segment_intent_counts.update(seg_intents)
                
                # Add top intents for this segment (multi-dimensional segment encoding)
                top_segment_intents = [intent for intent, _ in segment_intent_counts.most_common(3)]
                for seg_intent in top_segment_intents:
                    edits.append(f"SEGMENT_INTENT->{seg_intent}")
                
        except Exception:
            # Skip malformed events
            continue
    
    return edits


def functions_repr(trace: Dict, include_prompts: bool = True) -> List[str]:
    """Extract function-level representation: function names and operations.
    
    Args:
        trace: Trace dictionary with events
        include_prompts: If True, include prompts in representation
    
    Returns:
        List of function names extracted from code changes.
    """
    if not trace or not isinstance(trace, dict):
        return []
    
    funcs = []
    events = trace.get('events', [])
    if not events:
        return []
    
    for event in events:
        if not isinstance(event, dict):
            continue
            
        try:
            details = event.get('details', {})
            
            # Handle string details
            if isinstance(details, str):
                try:
                    details = json.loads(details)
                except (json.JSONDecodeError, TypeError):
                    details = {}
            
            if not isinstance(details, dict):
                details = {}
            
            code = details.get('after_content') or details.get('before_content') or details.get('code', '')
            file_path = details.get('file_path') or details.get('file', '')
            
            if code and isinstance(code, str):
                try:
                    func_names = extract_function_names_from_code(code, file_path)
                    if func_names:
                        funcs.extend(func_names)
                except Exception:
                    # Skip if function extraction fails
                    pass
            
            # Also capture function-related operations
            op = event.get('operation') or event.get('type')
            if op and isinstance(op, str) and 'function' in op.lower():
                funcs.append(op)
        except Exception:
            # Skip malformed events
            continue
    
    return funcs


def module_graph_repr(trace: Dict) -> List[str]:
    """Extract module/file-level representation: file paths and relationships.
    
    Returns a list of module/file names extracted from events.
    
    DEPRECATED: Use file_edit_graph_repr for proper graph structure.
    This function is kept for backward compatibility.
    """
    modules = []
    seen_files = set()
    for event in trace.get('events', []):
        details = event.get('details', {})
        
        # Handle string details
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except (json.JSONDecodeError, TypeError):
                details = {}
        
        file_path = details.get('file_path') or details.get('file')
        
        if file_path and file_path not in seen_files:
            # Extract just the filename or module name
            module_name = Path(file_path).stem if file_path else None
            if module_name:
                modules.append(module_name)
                seen_files.add(file_path)
        
        # Capture module-level operations
        op = event.get('operation') or event.get('type')
        if op and any(keyword in op.lower() for keyword in ['import', 'export', 'module', 'file']):
            modules.append(op)
    return modules


# ============================================================================
# Edit Graph Representations (NEW)
# ============================================================================

def _extract_file_edits(trace: Dict) -> List[Dict]:
    """Extract file edits with timestamps from trace.
    
    Returns list of {'time': timestamp, 'path': file_path} dicts.
    """
    edits = []
    for event in trace.get('events', []):
        details = event.get('details', {})
        
        # Handle string details
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except (json.JSONDecodeError, TypeError):
                details = {}
        
        if not isinstance(details, dict):
            details = {}
        
        file_path = details.get('file_path') or details.get('file')
        timestamp = event.get('timestamp', 0)
        
        # Parse timestamp if string
        if isinstance(timestamp, str):
            try:
                from datetime import datetime
                timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()
            except (ValueError, TypeError):
                timestamp = 0
        
        if file_path:
            edits.append({'time': timestamp or 0, 'path': file_path})
    
    return edits


def _extract_function_edits(trace: Dict) -> List[Dict]:
    """Extract function edits with timestamps from trace.
    
    Returns list of {'time': timestamp, 'func': name, 'file': path, 'qualified': file::func} dicts.
    """
    edits = []
    for event in trace.get('events', []):
        details = event.get('details', {})
        
        # Handle string details
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except (json.JSONDecodeError, TypeError):
                details = {}
        
        if not isinstance(details, dict):
            details = {}
        
        code = details.get('after_content') or details.get('before_content') or details.get('code', '')
        file_path = details.get('file_path') or details.get('file', '')
        timestamp = event.get('timestamp', 0)
        
        # Parse timestamp if string
        if isinstance(timestamp, str):
            try:
                from datetime import datetime
                timestamp = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()
            except (ValueError, TypeError):
                timestamp = 0
        
        if code and isinstance(code, str):
            try:
                func_names = extract_function_names_from_code(code, file_path)
                for func in func_names:
                    edits.append({
                        'time': timestamp or 0,
                        'func': func,
                        'file': file_path,
                        'qualified': f"{Path(file_path).stem}::{func}" if file_path else func
                    })
            except Exception:
                pass
    
    return edits


def file_edit_graph_repr(
    trace: Dict,
    time_window_sec: int = 300,
    canonicalize: bool = False,
) -> List[str]:
    """Extract file-level edit graph representation.
    
    Captures temporal relationships between file edits:
    - Edges: which files were edited in sequence
    - Edit counts: how many times each file was edited
    - Graph structure: in/out degree, cycles, size
    
    Args:
        trace: Trace dictionary with events
        time_window_sec: Window for considering edits as related (default 5 min)
        canonicalize: If True, replace file names with F001, F002 for privacy
    
    Returns:
        List of strings encoding graph structure:
        - E_src_dst: Edge from src to dst (temporal sequence)
        - EDITS_file_N: File edited N times
        - OUT_file_N: File has N outgoing edges
        - IN_file_N: File has N incoming edges
        - CYCLES_N: Number of cycles detected
        - NODES_N: Total number of files
        - EDGES_N: Total number of edges
    """
    edits = _extract_file_edits(trace)
    
    if len(edits) < 2:
        return []
    
    repr_tokens = []
    
    # Build name mapping
    all_files = list(set(e['path'] for e in edits))
    if canonicalize:
        name_map = {f: f"F{i:03d}" for i, f in enumerate(sorted(all_files))}
    else:
        name_map = {f: Path(f).stem for f in all_files}
    
    # Build edges: file A → file B if B edited after A within window
    edges = set()
    for i, e1 in enumerate(edits):
        for e2 in edits[i+1:]:
            if e1['path'] == e2['path']:
                continue
            
            time_diff = e2['time'] - e1['time']
            
            if 0 <= time_diff <= time_window_sec:
                src, dst = name_map[e1['path']], name_map[e2['path']]
                edges.add((src, dst))
                break  # only immediate successor
    
    # 1. Edge tokens
    for src, dst in sorted(edges):
        repr_tokens.append(f"E_{src}_{dst}")
    
    # 2. Edit counts per file
    edit_counts = {}
    for e in edits:
        f = name_map[e['path']]
        edit_counts[f] = edit_counts.get(f, 0) + 1
    
    for f, count in sorted(edit_counts.items()):
        repr_tokens.append(f"EDITS_{f}_{count}")
    
    # 3. Out-degree per node
    out_degree = {}
    for src, dst in edges:
        out_degree[src] = out_degree.get(src, 0) + 1
    
    for f, degree in sorted(out_degree.items()):
        repr_tokens.append(f"OUT_{f}_{degree}")
    
    # 4. In-degree per node
    in_degree = {}
    for src, dst in edges:
        in_degree[dst] = in_degree.get(dst, 0) + 1
    
    for f, degree in sorted(in_degree.items()):
        repr_tokens.append(f"IN_{f}_{degree}")
    
    # 5. Cycle count (A → B and B → A)
    cycle_count = 0
    for src, dst in edges:
        if (dst, src) in edges:
            cycle_count += 1
    repr_tokens.append(f"CYCLES_{cycle_count // 2}")
    
    # 6. Graph size
    repr_tokens.append(f"NODES_{len(all_files)}")
    repr_tokens.append(f"EDGES_{len(edges)}")
    
    return repr_tokens


def function_edit_graph_repr(
    trace: Dict,
    time_window_sec: int = 300,
    canonicalize: bool = False,
) -> List[str]:
    """Extract function-level edit graph representation.
    
    Captures temporal relationships between function edits:
    - Edges: which functions were edited in sequence
    - Edit counts: how many times each function was edited
    - Graph structure: in/out degree, cycles, size
    
    Args:
        trace: Trace dictionary with events
        time_window_sec: Window for considering edits as related (default 5 min)
        canonicalize: If True, replace function names with FN001, FN002 for privacy
    
    Returns:
        List of strings encoding graph structure:
        - E_src_dst: Edge from src to dst (temporal sequence)
        - EDITS_func_N: Function edited N times
        - OUT_func_N: Function has N outgoing edges
        - IN_func_N: Function has N incoming edges
        - CYCLES_N: Number of cycles detected
        - NODES_N: Total number of functions
        - EDGES_N: Total number of edges
    """
    edits = _extract_function_edits(trace)
    
    if len(edits) < 2:
        return []
    
    repr_tokens = []
    
    # Build name mapping
    all_funcs = list(set(e['qualified'] for e in edits))
    if canonicalize:
        name_map = {f: f"FN{i:03d}" for i, f in enumerate(sorted(all_funcs))}
    else:
        # Use just function name (without file prefix) for readability
        name_map = {f: f.split('::')[-1] if '::' in f else f for f in all_funcs}
    
    # Build edges: func A → func B if B edited after A within window
    edges = set()
    for i, e1 in enumerate(edits):
        for e2 in edits[i+1:]:
            if e1['qualified'] == e2['qualified']:
                continue
            
            time_diff = e2['time'] - e1['time']
            
            if 0 <= time_diff <= time_window_sec:
                src, dst = name_map[e1['qualified']], name_map[e2['qualified']]
                edges.add((src, dst))
                break  # only immediate successor
    
    # 1. Edge tokens
    for src, dst in sorted(edges):
        repr_tokens.append(f"E_{src}_{dst}")
    
    # 2. Edit counts per function
    edit_counts = {}
    for e in edits:
        f = name_map[e['qualified']]
        edit_counts[f] = edit_counts.get(f, 0) + 1
    
    for f, count in sorted(edit_counts.items()):
        repr_tokens.append(f"EDITS_{f}_{count}")
    
    # 3. Out-degree per node
    out_degree = {}
    for src, dst in edges:
        out_degree[src] = out_degree.get(src, 0) + 1
    
    for f, degree in sorted(out_degree.items()):
        repr_tokens.append(f"OUT_{f}_{degree}")
    
    # 4. In-degree per node
    in_degree = {}
    for src, dst in edges:
        in_degree[dst] = in_degree.get(dst, 0) + 1
    
    for f, degree in sorted(in_degree.items()):
        repr_tokens.append(f"IN_{f}_{degree}")
    
    # 5. Cycle count (A → B and B → A)
    cycle_count = 0
    for src, dst in edges:
        if (dst, src) in edges:
            cycle_count += 1
    repr_tokens.append(f"CYCLES_{cycle_count // 2}")
    
    # 6. Graph size
    repr_tokens.append(f"NODES_{len(all_funcs)}")
    repr_tokens.append(f"EDGES_{len(edges)}")
    
    return repr_tokens


def motifs_repr(
    trace: Dict,
    use_statistical_mining: bool = True,
    include_prompts: bool = True,
    include_llm_intents: bool = False,
) -> List[str]:
    """Extract motif representation using statistical sequence mining with intent awareness.
    
    This uses the new rule-free, structure-based approach with prompt-derived intent:
    1. Canonicalize events using hash-based encoding (no semantic rules)
    2. Insert INTENT markers derived from prompts (if include_prompts=True)
    3. Apply statistical motif extraction (PrefixSpan, Sequitur, transitions, structural)
    4. Add file-level structural motifs (rung-specific enhancement)
    
    Now captures both structural patterns (what developers did) and semantic intent
    (why they did it), enabling intent-aware motif discovery.
    
    Args:
        trace: Trace dictionary with events
        use_statistical_mining: If True, use PrefixSpan/Sequitur; if False, use legacy approach
        include_prompts: If True, include INTENT tokens from prompts; if False, structure-only
    
    Returns:
        List of motif strings, including intent-aware patterns
    """
    events = trace.get('events', [])
    if not events:
        return []
    
    # Step 1: Build canonical event sequence with intent markers (rule-free hashing + prompt intent)
    canonical_seq = event_sequence(
        trace,
        include_prompts=include_prompts,
        include_llm_intents=include_llm_intents,
    )
    
    if not canonical_seq:
        return []
    
    # Step 2: Apply statistical motif extraction
    if use_statistical_mining:
        motifs = motifs_from_sequence(canonical_seq, max_total=300)
    else:
        # Legacy approach for backward compatibility
        motifs = extract_universal_motifs(
            canonical_seq,
            include_transitions=True,
            include_ngrams=True,
            include_structural=True,
            ngram_sizes=[3, 4],
            use_statistical_mining=False
        )
    
    # Step 3: Add file-level structural motifs (rung-specific enhancement)
    structural_motifs = extract_structural_motifs(trace)
    motifs.extend(structural_motifs)
    
    # Step 4: Extract intent-specific motifs (if prompts included)
    if include_prompts:
        intent_motifs = extract_intent_motifs(canonical_seq)
        motifs.extend(intent_motifs)
    
    # Deduplicate while preserving order
    return list(dict.fromkeys(motifs))


def raw_repr(trace: Dict, include_metadata: bool = True, redact_pii_enabled: bool = True) -> Dict:
    """Extract raw representation: triple of (code_change, prompt, metadata) with PII redaction.
    
    This is the lowest-level representation that preserves actual code content and prompts
    while redacting PII. It's useful for:
    - Training foundation models on developer workflows
    - Understanding prompt-code relationships
    - Debugging and analysis
    - As a baseline for comparing abstraction rungs
    
    Args:
        trace: Trace dictionary with events
        include_metadata: Whether to include metadata (timestamp, file_path, etc.)
        redact_pii_enabled: Whether to redact PII from code and prompts
    
    Returns:
        Dictionary with structure:
        {
            'code_changes': [...],
            'prompts': [...],
            'metadata': {...}  # if include_metadata
        }
    """
    result = {
        'code_changes': [],
        'prompts': [],
    }
    
    if include_metadata:
        result['metadata'] = {
            'session_id': trace.get('session_id'),
            'workspace_path': trace.get('workspace_path'),
            'event_count': len(trace.get('events', [])),
            'code_change_count': 0,
            'prompt_count': 0,
        }
    
    # Extract code changes and prompts from events
    for event in trace.get('events', []):
        event_type = (event.get('type') or '').lower()
        details = event.get('details', {})
        
        if not isinstance(details, dict):
            continue
        
        # Extract code changes
        if event_type in ('code_change', 'file_change', 'entry_created'):
            before_content = details.get('before_content', '')
            after_content = details.get('after_content', '')
            file_path = details.get('file_path') or details.get('file', '')
            
            # Redact PII if enabled
            if redact_pii_enabled:
                before_content = redact_code_pii(before_content)
                after_content = redact_code_pii(after_content)
            
            code_change = {
                'file_path': file_path,
                'before_content': before_content,
                'after_content': after_content,
                'diff_summary': details.get('diff_summary', ''),
                'timestamp': event.get('timestamp'),
            }
            
            if include_metadata:
                code_change['metadata'] = {
                    'event_id': event.get('id'),
                    'event_type': event_type,
                    'lines_added': details.get('lines_added'),
                    'lines_removed': details.get('lines_removed'),
                    'chars_added': details.get('chars_added'),
                    'chars_deleted': details.get('chars_deleted'),
                    'ai_generated': event.get('ai_generated', False),
                    'annotation': event.get('annotation'),
                    'intent': event.get('intent'),
                }
            
            result['code_changes'].append(code_change)
            if include_metadata:
                result['metadata']['code_change_count'] += 1
        
        # Extract prompts (if present in event)
        elif event_type in ('prompt', 'prompt_sent', 'conversation'):
            prompt_content = details.get('text') or details.get('content') or event.get('text') or ''
            
            # Redact PII if enabled
            if redact_pii_enabled:
                prompt_content = redact_pii(prompt_content)
            
            prompt = {
                'content': prompt_content,
                'timestamp': event.get('timestamp'),
            }
            
            if include_metadata:
                prompt['metadata'] = {
                    'event_id': event.get('id'),
                    'event_type': event_type,
                    'conversation_id': details.get('conversation_id'),
                    'model': details.get('model'),
                    'context_files': details.get('context_files'),
                }
            
            result['prompts'].append(prompt)
            if include_metadata:
                result['metadata']['prompt_count'] += 1
    
    # Check if prompts are stored separately in trace
    if 'prompts' in trace:
        for prompt_data in trace.get('prompts', []):
            prompt_content = prompt_data.get('text') or prompt_data.get('content', '')
            
            if redact_pii_enabled:
                prompt_content = redact_pii(prompt_content)
            
            prompt = {
                'content': prompt_content,
                'timestamp': prompt_data.get('timestamp'),
            }
            
            if include_metadata:
                prompt['metadata'] = {
                    'prompt_id': prompt_data.get('id'),
                    'conversation_id': prompt_data.get('conversation_id'),
                    'model': prompt_data.get('model'),
                    'context_files': prompt_data.get('context_files'),
                }
            
            result['prompts'].append(prompt)
            if include_metadata:
                result['metadata']['prompt_count'] += 1
    
    return result


# ============================================================================
# String Format Functions (for LLM descriptions)
# ============================================================================

def tokens_repr_str(trace: Dict, limit: int = 200) -> str:
    """Extract tokens as a string representation for LLM descriptions."""
    tokens = tokens_repr(trace, include_prompts=True)
    if not tokens:
        return "EMPTY_TRACE"
    token_str = " ".join(tokens[:limit])
    if len(tokens) > limit:
        token_str += f" ... [truncated from {len(tokens)} tokens]"
    return token_str


def semantic_edits_repr_str(
    trace: Dict, 
    limit: int = 50, 
    include_intent: bool = True, 
    canonicalize: bool = False,
    use_emergent: bool = True,  # Default to emergent intent
) -> str:
    """Extract semantic edits as a string representation for LLM descriptions.
    
    Args:
        trace: Trace dictionary with events
        limit: Maximum number of edits to include
        include_intent: If True, include intent encoding (default: True)
        canonicalize: If True, use generic identifiers for privacy (default: False)
    """
    edits = semantic_edits_repr(
        trace, 
        include_prompts=True, 
        include_intent=include_intent, 
        canonicalize=canonicalize
    )
    if not edits:
        return "EMPTY_TRACE"
    edit_str = " → ".join(edits[:limit])
    if len(edits) > limit:
        edit_str += f" ... [truncated from {len(edits)} edits]"
    return edit_str


def functions_repr_str(trace: Dict, limit: int = 50) -> str:
    """Extract functions as a string representation for LLM descriptions."""
    functions = functions_repr(trace, include_prompts=True)
    if not functions:
        return "EMPTY_TRACE"
    func_str = " → ".join(functions[:limit])
    if len(functions) > limit:
        func_str += f" ... [truncated from {len(functions)} functions]"
    return func_str


def module_graph_repr_str(trace: Dict, limit: int = 50) -> str:
    """Extract module graph as a string representation for LLM descriptions.
    
    DEPRECATED: Use file_edit_graph_repr_str for proper graph structure.
    """
    modules = module_graph_repr(trace)
    if not modules:
        return "EMPTY_TRACE"
    module_str = " → ".join(modules[:limit])
    if len(modules) > limit:
        module_str += f" ... [truncated from {len(modules)} modules]"
    return module_str


def file_edit_graph_repr_str(
    trace: Dict,
    time_window_sec: int = 300,
    canonicalize: bool = False,
    limit: int = 100,
) -> str:
    """Extract file edit graph as a string representation.
    
    Args:
        trace: Trace dictionary with events
        time_window_sec: Window for considering edits as related
        canonicalize: If True, replace file names with F001, F002 for privacy
        limit: Maximum number of tokens to include
    
    Returns:
        Space-separated string of graph tokens
    """
    tokens = file_edit_graph_repr(trace, time_window_sec, canonicalize)
    if not tokens:
        return "EMPTY_GRAPH"
    
    result = " ".join(tokens[:limit])
    if len(tokens) > limit:
        result += f" ... [truncated from {len(tokens)} tokens]"
    return result


def function_edit_graph_repr_str(
    trace: Dict,
    time_window_sec: int = 300,
    canonicalize: bool = False,
    limit: int = 100,
) -> str:
    """Extract function edit graph as a string representation.
    
    Args:
        trace: Trace dictionary with events
        time_window_sec: Window for considering edits as related
        canonicalize: If True, replace function names with FN001, FN002 for privacy
        limit: Maximum number of tokens to include
    
    Returns:
        Space-separated string of graph tokens
    """
    tokens = function_edit_graph_repr(trace, time_window_sec, canonicalize)
    if not tokens:
        return "EMPTY_GRAPH"
    
    result = " ".join(tokens[:limit])
    if len(tokens) > limit:
        result += f" ... [truncated from {len(tokens)} tokens]"
    return result


def motifs_repr_str(trace: Dict, limit: int = 50, max_length: int = 2000) -> str:
    """Extract motifs as a string representation for LLM descriptions.
    
    Uses universal motif extraction and formats as string.
    """
    motifs = motifs_repr(trace, use_statistical_mining=True, include_prompts=True)
    if not motifs:
        return "EMPTY_WORKFLOW"
    
    # Take unique motifs and limit total count
    unique_motifs = list(dict.fromkeys(motifs))[:limit]
    motif_str = " | ".join(unique_motifs)
    
    # Limit total string length
    if len(motif_str) > max_length:
        motif_str = motif_str[:max_length] + "... [truncated]"
    
    return motif_str


def raw_repr_str(trace: Dict, include_metadata: bool = True, redact_pii_enabled: bool = True) -> str:
    """Get raw representation as a formatted string for LLM descriptions.
    
    Returns a human-readable string representation of the raw triple.
    """
    raw = raw_repr(trace, include_metadata, redact_pii_enabled)
    
    parts = []
    
    # Code changes
    if raw['code_changes']:
        parts.append("CODE_CHANGES:")
        for i, change in enumerate(raw['code_changes'], 1):
            parts.append(f"\n  Change {i}:")
            parts.append(f"    File: {change.get('file_path', 'unknown')}")
            if change.get('before_content'):
                parts.append(f"    Before: {change['before_content'][:200]}...")
            if change.get('after_content'):
                parts.append(f"    After: {change['after_content'][:200]}...")
            parts.append(f"    Summary: {change.get('diff_summary', '')}")
    
    # Prompts
    if raw['prompts']:
        parts.append("\nPROMPTS:")
        for i, prompt in enumerate(raw['prompts'], 1):
            parts.append(f"\n  Prompt {i}:")
            parts.append(f"    Content: {prompt['content'][:300]}...")
    
    # Metadata
    if include_metadata and raw.get('metadata'):
        parts.append(f"\nMETADATA: {raw['metadata']}")
    
    return "\n".join(parts) if parts else "EMPTY_RAW_REPRESENTATION"


# ============================================================================
# Rung Function Mappings
# ============================================================================

# List-based functions (for sequence modeling)
RUNG_FUNCS_LIST = {
    'raw': raw_repr,  # Returns Dict, not List, but included for completeness
    'tokens': tokens_repr,
    'semantic_edits': semantic_edits_repr,
    'functions': functions_repr,
    'module_graph': module_graph_repr,  # DEPRECATED: use file_edit_graph
    'file_edit_graph': file_edit_graph_repr,
    'function_edit_graph': function_edit_graph_repr,
    'motifs': motifs_repr,
}

# String-based functions (for LLM descriptions)
RUNG_FUNCS_STR = {
    'raw': raw_repr_str,
    'tokens': tokens_repr_str,
    'semantic_edits': semantic_edits_repr_str,
    'functions': functions_repr_str,
    'module_graph': module_graph_repr_str,  # DEPRECATED: use file_edit_graph
    'file_edit_graph': file_edit_graph_repr_str,
    'function_edit_graph': function_edit_graph_repr_str,
    'motifs': motifs_repr_str,
}

# Base sequence functions (without motif extraction applied)
BASE_SEQUENCE_FUNCS = {
    'tokens': tokens_repr,
    'semantic_edits': semantic_edits_repr,
    'functions': functions_repr,
    'module_graph': module_graph_repr,
}

# Graph-based functions (relational structure)
GRAPH_FUNCS = {
    'file_edit_graph': file_edit_graph_repr,
    'function_edit_graph': function_edit_graph_repr,
}


def extract_motifs_from_rung(trace: Dict, rung_name: str, use_statistical_mining: bool = True, include_prompts: bool = True) -> List[str]:
    """Extract motifs from a specific rung using statistical sequence mining with intent awareness.
    
    This ensures consistent motif representation across all rungs.
    Uses the new rule-free, structure-based approach with prompt-derived intent.
    
    Args:
        trace: Trace dictionary with events
        rung_name: Name of the rung ('tokens', 'semantic_edits', 'functions', 'module_graph', 'motifs')
        use_statistical_mining: If True, use PrefixSpan/Sequitur; if False, use legacy approach
        include_prompts: If True, include INTENT tokens from prompts; if False, structure-only
    
    Returns:
        List of motif strings, including intent-aware patterns
    """
    if rung_name == 'motifs':
        # Special case: motifs rung uses canonicalized events with intent
        return motifs_repr(trace, use_statistical_mining=use_statistical_mining, include_prompts=include_prompts)
    
    # For other rungs: get base sequence (with intent if enabled), then apply statistical motif extraction
    base_func = BASE_SEQUENCE_FUNCS.get(rung_name)
    if not base_func:
        return []
    
    # Pass include_prompts parameter if function supports it
    try:
        base_seq = base_func(trace, include_prompts=include_prompts)
    except TypeError:
        # Fallback for functions that don't support include_prompts yet
        base_seq = base_func(trace)
    
    if not base_seq:
        return []
    
    # Apply statistical motif extraction
    if use_statistical_mining:
        motifs = motifs_from_sequence(base_seq, max_total=300)
        
        # Add intent-specific motifs if prompts included
        if include_prompts:
            intent_motifs = extract_intent_motifs(base_seq)
            motifs.extend(intent_motifs)
        
        return list(dict.fromkeys(motifs))
    else:
        # Legacy approach for backward compatibility
        return extract_universal_motifs(
            base_seq,
            include_transitions=True,
            include_ngrams=True,
            include_structural=True,
            ngram_sizes=[3, 4],
            use_statistical_mining=False
        )






