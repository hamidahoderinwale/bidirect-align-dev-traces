"""
Multi-Rung Event Search Engine

This module provides a search engine that can search across different representation rungs
(tokens, semantic_edits, functions, motifs, raw) and compare results.

It also includes an LLM-as-judge baseline for comparison.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass
from collections import defaultdict
import numpy as np

from dotenv import load_dotenv

load_dotenv()

if not os.getenv("OPENROUTER_API_KEY"):
    raise RuntimeError("OPENROUTER_API_KEY must be set in .env before running this script.")
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
# Try to import OpenAI (for backward compatibility)
try:
    import openai
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

# Try to import requests for Hugging Face API
try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
from sentence_transformers import SentenceTransformer


@dataclass
class SearchResult:
    """A single search result with event and metadata."""
    event_id: str
    event: Dict[str, Any]
    score: float
    rank: int
    rung: str
    intent_method: Optional[str] = None
    match_reason: Optional[str] = None  # Why this event matched


@dataclass
class SearchResponse:
    """Response from a search query."""
    query_id: str
    query_text: str
    results: List[SearchResult]
    n_total_events: int
    search_method: str  # 'llm_judge', 'rung_search', etc.
    rung: Optional[str] = None
    intent_method: Optional[str] = None


class EventIndex:
    """Index of events with multiple representation rungs."""
    
    def __init__(self, traces: List[Dict], rung_extractors=None):
        """
        Initialize event index from traces.
        
        Args:
            traces: List of trace dictionaries
            rung_extractors: Module with rung extraction functions
        """
        self.traces = traces
        self.events = []
        self.event_to_trace = {}
        self.rung_extractors = rung_extractors
        
        # Extract all events from traces
        self._extract_events()
        
        # Index by rung
        self.rung_indices = {
            'raw': {},
            'tokens': {},
            'semantic_edits': {},
            'functions': {},
            'motifs': {}
        }
        
        # Intent indices
        self.intent_indices = {
            'none': {},
            'raw': {},
            'systematic': {},
            'llm_zero_shot': {},
            'embedding_cluster': {}
        }
        
    def _extract_events(self):
        """Extract all events from traces."""
        for trace_idx, trace in enumerate(self.traces):
            events = trace.get('events', [])
            for event_idx, event in enumerate(events):
                event_id = f"trace_{trace_idx}_event_{event_idx}"
                event['_event_id'] = event_id
                event['_trace_idx'] = trace_idx
                event['_event_idx'] = event_idx
                self.events.append(event)
                self.event_to_trace[event_id] = trace_idx
    
    def build_rung_index(self, rung: str):
        """Build search index for a specific rung."""
        if not self.rung_extractors:
            raise ValueError("rung_extractors module required")
        
        rung_func = getattr(self.rung_extractors, f'{rung}_repr_str', None)
        if not rung_func:
            raise ValueError(f"No function found for rung: {rung}")
        
        # Extract representations for each trace
        trace_reprs = []
        for trace in self.traces:
            try:
                repr_str = rung_func(trace)
                trace_reprs.append(repr_str)
            except Exception as e:
                print(f"Error extracting {rung} for trace: {e}")
                trace_reprs.append("")
        
        # Map events to their trace representations
        for event in self.events:
            trace_idx = event['_trace_idx']
            event_id = event['_event_id']
            self.rung_indices[rung][event_id] = trace_reprs[trace_idx]
    
    def build_intent_index(self, intent_method: str, intent_extractor=None):
        """Build intent index for a specific intent method."""
        if intent_method == 'none':
            # No intent indexing needed
            return
        
        if not intent_extractor:
            raise ValueError(f"intent_extractor required for method: {intent_method}")
        
        # Extract intents for each event
        for event in self.events:
            event_id = event['_event_id']
            trace_idx = event['_trace_idx']
            trace = self.traces[trace_idx]
            
            try:
                intent = intent_extractor(event, trace, method=intent_method)
                self.intent_indices[intent_method][event_id] = intent
            except Exception as e:
                print(f"Error extracting intent for event {event_id}: {e}")
                self.intent_indices[intent_method][event_id] = ""


class RungSearchEngine:
    """Search engine that searches across different representation rungs."""
    
    def __init__(self, event_index: EventIndex):
        self.index = event_index
        self.tfidf_vectorizers = {}
        self.embedding_models = {}
        
    def _get_tfidf_vectorizer(self, rung: str):
        """Get or create TF-IDF vectorizer for a rung."""
        if rung not in self.tfidf_vectorizers:
            self.tfidf_vectorizers[rung] = TfidfVectorizer(
                max_features=5000,
                ngram_range=(1, 2),
                stop_words='english'
            )
        return self.tfidf_vectorizers[rung]
    
    def _get_embedding_model(self):
        """Get or create sentence transformer model."""
        if 'default' not in self.embedding_models:
            try:
                self.embedding_models['default'] = SentenceTransformer('all-mpnet-base-v2')
            except Exception as e:
                print(f"Warning: Could not load embedding model: {e}")
                return None
        return self.embedding_models['default']
    
    def search(
        self,
        query: str,
        rung: str = 'semantic_edits',
        intent_method: Optional[str] = None,
        top_k: int = 20,
        use_embeddings: bool = True
    ) -> SearchResponse:
        """
        Search for events using a specific rung representation.
        
        Args:
            query: Natural language query
            rung: Representation rung to use ('tokens', 'semantic_edits', 'functions', 'motifs', 'raw')
            intent_method: Optional intent method to filter by ('systematic', 'llm_zero_shot', etc.)
            top_k: Number of results to return
            use_embeddings: Whether to use embeddings (True) or TF-IDF (False)
        
        Returns:
            SearchResponse with ranked results
        """
        if rung not in self.index.rung_indices:
            raise ValueError(f"Rung {rung} not indexed. Call build_rung_index first.")
        
        # Get event representations
        event_reprs = []
        event_ids = []
        for event_id, repr_str in self.index.rung_indices[rung].items():
            if repr_str:  # Only include events with non-empty representations
                event_reprs.append(repr_str)
                event_ids.append(event_id)
        
        if not event_reprs:
            return SearchResponse(
                query_id="",
                query_text=query,
                results=[],
                n_total_events=len(self.index.events),
                search_method='rung_search',
                rung=rung,
                intent_method=intent_method
            )
        
        # Compute similarity
        if use_embeddings:
            model = self._get_embedding_model()
            if model:
                query_embedding = model.encode([query])[0]
                event_embeddings = model.encode(event_reprs)
                similarities = cosine_similarity([query_embedding], event_embeddings)[0]
            else:
                # Fallback to TF-IDF
                use_embeddings = False
        
        if not use_embeddings:
            # Use TF-IDF
            vectorizer = self._get_tfidf_vectorizer(rung)
            try:
                # Fit on all representations
                vectorizer.fit(event_reprs)
                query_vec = vectorizer.transform([query])
                event_vecs = vectorizer.transform(event_reprs)
                similarities = cosine_similarity(query_vec, event_vecs)[0]
            except Exception as e:
                print(f"Error with TF-IDF: {e}")
                # Fallback: simple keyword matching
                similarities = np.array([
                    len(set(query.lower().split()) & set(repr.lower().split())) / len(set(query.lower().split()))
                    for repr in event_reprs
                ])
        
        # Rank by similarity
        ranked_indices = np.argsort(similarities)[::-1]
        
        # Filter by intent if specified
        if intent_method and intent_method != 'none':
            filtered_results = []
            for idx in ranked_indices:
                event_id = event_ids[idx]
                if event_id in self.index.intent_indices.get(intent_method, {}):
                    # Could add intent-based filtering here
                    filtered_results.append((idx, similarities[idx]))
            if filtered_results:
                ranked_indices = [idx for idx, _ in sorted(filtered_results, key=lambda x: x[1], reverse=True)]
        
        # Build results
        results = []
        for rank, idx in enumerate(ranked_indices[:top_k], 1):
            event_id = event_ids[idx]
            event = next(e for e in self.index.events if e['_event_id'] == event_id)
            results.append(SearchResult(
                event_id=event_id,
                event=event,
                score=float(similarities[idx]),
                rank=rank,
                rung=rung,
                intent_method=intent_method
            ))
        
        return SearchResponse(
            query_id="",
            query_text=query,
            results=results,
            n_total_events=len(self.index.events),
            search_method='rung_search',
            rung=rung,
            intent_method=intent_method
        )


class LLMJudgeRetriever:
    """LLM-as-judge baseline: LLM directly retrieves events from query.
    
    Supports free Hugging Face models (default) and paid OpenAI models (fallback).
    """
    
    def __init__(self, event_index: EventIndex, api_key: Optional[str] = None, 
                 model: str = "meta-llama/Llama-3.2-3B-Instruct", use_openai: bool = False):
        self.index = event_index
        self.model = model
        self.client = None
        self.use_openai = use_openai
        self.hf_token = None
        self.api_key = None
        self.hf_api_url = None
        self.openrouter_key = os.getenv('OPENROUTER_API_KEY', '').strip()
        self.openrouter_model = os.getenv('OPENROUTER_CHAT_MODEL', 'anthropic/claude-3-haiku')
        self.openrouter_endpoint = 'https://openrouter.ai/api/v1/chat/completions'
        self.use_openrouter = False
        
        # Determine which service to use
        if use_openai and HAS_OPENAI:
            # Use OpenAI (paid)
            self.api_key = api_key or os.getenv('OPENAI_API_KEY')
            if self.api_key:
                try:
                    self.client = openai.OpenAI(api_key=self.api_key)
                    self.use_openai = True
                    print(f"✓ Using OpenAI model: {model}")
                except Exception as e:
                    print(f"Warning: Could not initialize OpenAI client: {e}")
                    self.use_openai = False
        
        if not self.use_openai:
            # Use Hugging Face (free)
            self.hf_token = api_key or os.getenv('HF_TOKEN') or os.getenv('HUGGINGFACE_API_TOKEN') or os.getenv('HUGGINGFACE_API_KEY')
            if self.hf_token:
                # Use new Hugging Face Inference API
                self.hf_api_url = f"https://api-inference.huggingface.co/models/{model}"  # Set default URL
                try:
                    from huggingface_hub import InferenceClient
                    self.hf_client = InferenceClient(model=model, token=self.hf_token)
                    self.use_hf_client = True
                    print(f"✓ Using free Hugging Face model: {model} (via InferenceClient)")
                except ImportError:
                    # Fallback to direct API calls
                    self.hf_client = None
                    self.use_hf_client = False
                    print(f"✓ Using free Hugging Face model: {model} (direct API)")
                    print(f"  Note: Install 'huggingface_hub' for better compatibility: pip install huggingface_hub")
                except Exception as e:
                    # If InferenceClient fails, fall back to direct API
                    print(f"  Warning: InferenceClient initialization failed: {e}")
                    self.hf_client = None
                    self.use_hf_client = False
                    print(f"  Falling back to direct API calls")
            elif self.openrouter_key:
                self.use_openrouter = True
                print(f"✓ Using OpenRouter model: {self.openrouter_model}")
                print("  OpenRouter will handle LLM-as-judge retrieval.")
            else:
                print("Warning: No Hugging Face token found. Set HF_TOKEN in .env file.")
                print("  Get a free token at: https://huggingface.co/settings/tokens")
                if HAS_OPENAI and os.getenv('OPENAI_API_KEY'):
                    self.api_key = os.getenv('OPENAI_API_KEY')
                    try:
                        self.client = openai.OpenAI(api_key=self.api_key)
                        self.use_openai = True
                        print(f"✓ Using OpenAI fallback: {model}")
                    except:
                        print("Warning: No API keys available. LLM judge will be disabled.")
                else:
                    print("Warning: No API keys available. LLM judge will be disabled.")
    
    def search(self, query: str, top_k: int = 20) -> SearchResponse:
        """
        Use LLM to directly retrieve relevant events.
        
        The LLM sees all events and selects the most relevant ones.
        """
        if not self.client and not self.hf_token:
            # Fallback: return empty results
            return SearchResponse(
                query_id="",
                query_text=query,
                results=[],
                n_total_events=len(self.index.events),
                search_method='llm_judge',
                rung=None,
                intent_method=None
            )
        
        # Prepare event summaries for LLM
        event_summaries = []
        for event in self.index.events[:100]:  # Limit to first 100 for token efficiency
            summary = self._summarize_event(event)
            event_summaries.append({
                'id': event['_event_id'],
                'summary': summary
            })
        
        # Build prompt
        prompt = f"""You are a search system for developer workflow events. Given a query, identify the most relevant events.

Query: {query}

Available events:
{json.dumps(event_summaries, indent=2)}

Return a JSON array of event IDs in order of relevance (most relevant first). Return at most {top_k} event IDs.
Format: ["event_id_1", "event_id_2", ...]
"""
        
        try:
            if self.use_openai and self.client:
                # Use OpenAI API
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": "You are a precise search system. Return only valid JSON arrays."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.0,
                    max_tokens=500
                )
                content = response.choices[0].message.content.strip()
            elif self.use_openrouter:
                content = self._retrieve_via_openrouter(prompt, top_k)
            else:
                # Use Hugging Face Inference API (free)
                formatted_prompt = self._format_hf_prompt(prompt)
                
                # Try using InferenceClient first (recommended)
                if hasattr(self, 'use_hf_client') and self.use_hf_client and self.hf_client:
                    try:
                        # Use the correct InferenceClient API - it's just .chat() not .chat.completion()
                        messages = [
                            {"role": "system", "content": "You are a precise search system. Return only valid JSON arrays."},
                            {"role": "user", "content": formatted_prompt}
                        ]
                        # InferenceClient uses .chat() method directly
                        response_text = self.hf_client.chat(
                            messages=messages,
                            max_tokens=500,
                            temperature=0.0
                        )
                        # Response format varies - handle both dict and object responses
                        if hasattr(response_text, 'choices'):
                            content = response_text.choices[0].message.content.strip()
                        elif isinstance(response_text, dict):
                            content = response_text.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
                        elif isinstance(response_text, str):
                            content = response_text.strip()
                        else:
                            content = str(response_text).strip()
                    except AttributeError as e:
                        # If .chat() doesn't exist, try text generation instead
                        try:
                            response_text = self.hf_client.text_generation(
                                prompt=formatted_prompt,
                                max_new_tokens=500,
                                temperature=0.0,
                                return_full_text=False
                            )
                            content = response_text.strip()
                        except Exception as e2:
                            print(f"  Warning: InferenceClient failed, trying direct API: {e2}")
                            content = None
                    except Exception as e:
                        print(f"  Warning: InferenceClient failed, trying direct API: {e}")
                        content = None
                else:
                    content = None
                
                # Fallback to direct API calls
                if content is None:
                    if not self.hf_token:
                        print(f"  Error: No Hugging Face token available for direct API calls")
                        raise ValueError("HF_TOKEN required for LLM-as-Judge")
                    
                    headers = {
                        "Authorization": f"Bearer {self.hf_token}",
                        "Content-Type": "application/json"
                    }
                    
                    # Use the URL that was set during initialization, or fallback
                    api_url = getattr(self, 'hf_api_url', None) or f"https://api-inference.huggingface.co/models/{self.model}"
                    
                    payload = {
                        "inputs": formatted_prompt,
                        "parameters": {
                            "temperature": 0.0,
                            "max_new_tokens": 500,
                            "return_full_text": False,
                            "do_sample": False,
                        }
                    }
                    
                    try:
                        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
                        response.raise_for_status()
                        
                        result = response.json()
                        
                        # Handle rate limiting or model loading
                        if isinstance(result, dict) and "error" in result:
                            error_msg = result.get("error", "Unknown error")
                            if "loading" in error_msg.lower():
                                print(f"  ⚠ Model is loading, please wait and try again")
                                return SearchResponse(
                                    query_id="",
                                    query_text=query,
                                    results=[],
                                    n_total_events=len(self.index.events),
                                    search_method='llm_judge',
                                    rung=None,
                                    intent_method=None
                                )
                            else:
                                raise ValueError(f"HF API error: {error_msg}")
                        
                        # Extract text from response
                        if isinstance(result, list) and len(result) > 0:
                            if "generated_text" in result[0]:
                                content = result[0]["generated_text"].strip()
                            else:
                                content = str(result[0]).strip()
                        elif isinstance(result, dict):
                            content = result.get("generated_text", str(result)).strip()
                        else:
                            content = str(result).strip()
                    except requests.exceptions.HTTPError as e:
                        if e.response.status_code == 404:
                            # Try old endpoint as fallback
                            old_url = f"https://api-inference.huggingface.co/models/{self.model}"
                            print(f"  ⚠ Router endpoint not found, trying legacy endpoint...")
                            try:
                                response = requests.post(old_url, headers=headers, json=payload, timeout=60)
                                if response.status_code == 410:
                                    raise ValueError("Hugging Face API endpoints have changed. Please install 'huggingface_hub': pip install huggingface_hub")
                                response.raise_for_status()
                                result = response.json()
                                if isinstance(result, list) and len(result) > 0:
                                    content = result[0].get("generated_text", str(result[0])).strip()
                                elif isinstance(result, dict):
                                    content = result.get("generated_text", str(result)).strip()
                                else:
                                    content = str(result).strip()
                            except:
                                raise ValueError("Hugging Face API error. Please install 'huggingface_hub': pip install huggingface_hub")
                        else:
                            raise
                
                # Clean up special tokens
                if content:
                    content = content.replace("<|end|>", "").replace("<|assistant|>", "").replace("<|eot_id|>", "").strip()
                    content = content.split("<|")[0].split("[/INST]")[-1].strip()
            
            # Remove markdown code blocks if present
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
            content = content.strip()
            
            event_ids = json.loads(content)
            
            # Build results
            results = []
            event_dict = {e['_event_id']: e for e in self.index.events}
            
            for rank, event_id in enumerate(event_ids[:top_k], 1):
                if event_id in event_dict:
                    results.append(SearchResult(
                        event_id=event_id,
                        event=event_dict[event_id],
                        score=1.0 - (rank / len(event_ids)),  # Decreasing score
                        rank=rank,
                        rung=None,
                        intent_method=None,
                        match_reason="LLM judgment"
                    ))
            
            return SearchResponse(
                query_id="",
                query_text=query,
                results=results,
                n_total_events=len(self.index.events),
                search_method='llm_judge',
                rung=None,
                intent_method=None
            )
            
        except Exception as e:
            print(f"Error in LLM search: {e}")
            return SearchResponse(
                query_id="",
                query_text=query,
                results=[],
                n_total_events=len(self.index.events),
                search_method='llm_judge',
                rung=None,
                intent_method=None
            )
    
    def _format_hf_prompt(self, prompt: str) -> str:
        """Format prompt for Hugging Face chat models."""
        model_lower = self.model.lower()
        
        if "llama" in model_lower or "meta" in model_lower:
            # Llama format
            return f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are a precise search system. Return only valid JSON arrays.<|eot_id|><|start_header_id|>user<|end_header_id|>

{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

"""
        elif "mistral" in model_lower:
            # Mistral format
            return f"""<s>[INST] You are a precise search system. Return only valid JSON arrays.

{prompt} [/INST]"""
        elif "phi" in model_lower:
            # Phi format
            return f"""<|system|>
You are a precise search system. Return only valid JSON arrays.<|end|>
<|user|>
{prompt}<|end|>
<|assistant|>
"""
        else:
            # Generic format
            return f"""System: You are a precise search system. Return only valid JSON arrays.

User: {prompt}

Assistant:"""
    
    def _retrieve_via_openrouter(self, prompt: str, top_k: int) -> str:
        """Call OpenRouter chat completions for LLM-as-judge retrieval."""
        if not HAS_REQUESTS:
            raise RuntimeError("The 'requests' package is required for OpenRouter support.")
        if not self.openrouter_key:
            raise ValueError("OPENROUTER_API_KEY must be set to use OpenRouter.")

        headers = {
            "Authorization": f"Bearer {self.openrouter_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com",
            "X-Title": "Cursor Telemetry LLM Judge",
        }

        payload = {
            "model": self.openrouter_model,
            "messages": [
                {"role": "system", "content": "You are a precise search system. Return only valid JSON arrays."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.0,
            "max_tokens": min(1000, max(200, top_k * 40)),
            "top_p": 1.0,
            "stop": None,
        }

        response = requests.post(self.openrouter_endpoint, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()

        choices = data.get("choices") or []
        if not choices:
            raise ValueError("OpenRouter returned no choices.")

        message = choices[0].get("message", {}) or choices[0]
        content = message.get("content") or message.get("text") or ""
        return content.strip()

    def _summarize_event(self, event: Dict) -> str:
        """Create a summary of an event for LLM consumption."""
        event_type = event.get('type', event.get('operation', 'unknown'))
        file_path = event.get('details', {}).get('file_path', '') if isinstance(event.get('details'), dict) else ''
        timestamp = event.get('timestamp', '')
        
        # Try to extract prompt
        prompt = ""
        if 'prompt' in event:
            prompt = event['prompt']
        elif 'details' in event and isinstance(event['details'], dict):
            prompt = event['details'].get('prompt', '')
        
        summary = f"Event {event['_event_id']}: {event_type}"
        if file_path:
            summary += f" in {file_path}"
        if prompt:
            summary += f" | Prompt: {prompt[:100]}"
        if timestamp:
            summary += f" | Time: {timestamp}"
        
        return summary


class SearchComparisonFramework:
    """Framework to compare search results across different methods."""
    
    def __init__(self, event_index: EventIndex, llm_judge: Optional[LLMJudgeRetriever] = None):
        self.index = event_index
        self.rung_engine = RungSearchEngine(event_index)
        self.llm_judge = llm_judge if llm_judge is not None else LLMJudgeRetriever(event_index)
    
    def compare_search_methods(
        self,
        query: Dict,
        rungs: List[str] = ['raw', 'semantic_edits', 'functions', 'motifs'],
        intent_methods: List[Optional[str]] = [None, 'systematic'],
        top_k: int = 20,
        include_llm_judge: bool = True
    ) -> Dict[str, SearchResponse]:
        """
        Compare search results across different rungs and intent methods.
        
        Args:
            query: Query dictionary with 'text' field
            rungs: List of rungs to compare
            intent_methods: List of intent methods to compare (None = no intent filtering)
            top_k: Number of results to retrieve
            include_llm_judge: Whether to include LLM-as-judge baseline (default: True)
        
        Returns:
            Dictionary mapping method names to SearchResponse objects
        """
        query_text = query.get('text', '')
        results = {}
        
        # LLM-as-judge baseline (only if enabled and available)
        if include_llm_judge and self.llm_judge:
            try:
                # Check if LLM judge has valid configuration
                if hasattr(self.llm_judge, 'hf_token') and self.llm_judge.hf_token:
                    results['llm_judge'] = self.llm_judge.search(query_text, top_k=top_k)
                elif hasattr(self.llm_judge, 'client') and self.llm_judge.client:
                    results['llm_judge'] = self.llm_judge.search(query_text, top_k=top_k)
                else:
                    print("  ⚠ LLM-as-judge skipped: No API key configured")
            except Exception as e:
                print(f"  ⚠ LLM-as-judge failed: {e}")
                # Don't add llm_judge to results if it fails
        
        # Rung-based search
        for rung in rungs:
            if rung not in self.index.rung_indices:
                continue
            
            for intent_method in intent_methods:
                method_name = f"{rung}"
                if intent_method:
                    method_name += f"_intent_{intent_method}"
                
                try:
                    response = self.rung_engine.search(
                        query_text,
                        rung=rung,
                        intent_method=intent_method,
                        top_k=top_k
                    )
                    results[method_name] = response
                except Exception as e:
                    print(f"Error searching with {method_name}: {e}")
        
        return results
    
    def analyze_differences(
        self,
        results: Dict[str, SearchResponse],
        ground_truth_event_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Analyze differences between search methods.
        
        Args:
            results: Dictionary of search results from compare_search_methods
            ground_truth_event_ids: Optional list of ground truth relevant event IDs
        
        Returns:
            Analysis dictionary with overlap, unique results, etc.
        """
        analysis = {
            'method_results': {},
            'overlap_matrix': {},
            'unique_results': {},
            'ground_truth_metrics': {}
        }
        
        # Extract event IDs from each method
        method_event_ids = {}
        for method, response in results.items():
            event_ids = [r.event_id for r in response.results]
            method_event_ids[method] = event_ids
            analysis['method_results'][method] = {
                'n_results': len(event_ids),
                'event_ids': event_ids
            }
        
        # Compute overlap matrix
        methods = list(method_event_ids.keys())
        for i, method1 in enumerate(methods):
            for method2 in methods[i+1:]:
                ids1 = set(method_event_ids[method1])
                ids2 = set(method_event_ids[method2])
                overlap = len(ids1 & ids2)
                union = len(ids1 | ids2)
                jaccard = overlap / union if union > 0 else 0
                
                analysis['overlap_matrix'][f"{method1}_vs_{method2}"] = {
                    'overlap': overlap,
                    'union': union,
                    'jaccard': jaccard
                }
        
        # Find unique results per method
        for method in methods:
            other_methods = [m for m in methods if m != method]
            other_ids = set()
            for other_method in other_methods:
                other_ids.update(method_event_ids[other_method])
            
            unique_ids = set(method_event_ids[method]) - other_ids
            analysis['unique_results'][method] = {
                'n_unique': len(unique_ids),
                'event_ids': list(unique_ids)
            }
        
        # Ground truth metrics if provided
        if ground_truth_event_ids:
            gt_set = set(ground_truth_event_ids)
            for method in methods:
                retrieved_ids = set(method_event_ids[method])
                tp = len(retrieved_ids & gt_set)
                fp = len(retrieved_ids - gt_set)
                fn = len(gt_set - retrieved_ids)
                
                precision = tp / (tp + fp) if (tp + fp) > 0 else 0
                recall = tp / (tp + fn) if (tp + fn) > 0 else 0
                f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
                
                analysis['ground_truth_metrics'][method] = {
                    'precision': precision,
                    'recall': recall,
                    'f1': f1,
                    'tp': tp,
                    'fp': fp,
                    'fn': fn
                }
        
        return analysis

