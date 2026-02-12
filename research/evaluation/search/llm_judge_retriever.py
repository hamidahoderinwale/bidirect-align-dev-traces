"""
Standalone LLM-as-Judge Event Retriever

This script uses an LLM to directly retrieve relevant events from natural language queries.
It serves as a baseline comparison for structured search methods.

Usage:
    python llm_judge_retriever.py --queries queries.json --traces traces.jsonl --output results.json
"""

import json
import os
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from tqdm import tqdm

from dotenv import load_dotenv

load_dotenv()

if not os.getenv("OPENROUTER_API_KEY"):
    raise RuntimeError("OPENROUTER_API_KEY must be set in .env before running this script.")

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


@dataclass
class EventSummary:
    """Summary of an event for LLM consumption."""
    event_id: str
    event_type: str
    file_path: str
    timestamp: str
    prompt: str
    code_snippet: str
    operation: str
    context: str


@dataclass
class LLMRetrievalResult:
    """Result from LLM retrieval."""
    query_id: str
    query_text: str
    retrieved_event_ids: List[str]
    n_total_events: int
    n_retrieved: int
    model: str
    error: Optional[str] = None


class LLMJudgeRetriever:
    """LLM-as-judge event retriever with improved event handling.
    
    Supports free Hugging Face models (default) and paid OpenAI models (fallback).
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "meta-llama/Llama-3.2-3B-Instruct",  # Free default
        max_events_per_query: int = 200,
        batch_size: int = 50,
        use_openai: bool = False
    ):
        """
        Initialize LLM judge retriever.
        
        Args:
            api_key: API key (HF_TOKEN for Hugging Face, OPENAI_API_KEY for OpenAI)
            model: Model to use. Free defaults:
                   - meta-llama/Llama-3.2-3B-Instruct (Hugging Face, free)
                   - mistralai/Mistral-7B-Instruct-v0.2 (Hugging Face, free)
                   - microsoft/Phi-3-mini-4k-instruct (Hugging Face, free)
                   - gpt-4, gpt-3.5-turbo (OpenAI, paid)
            max_events_per_query: Maximum events to send to LLM per query
            batch_size: If events exceed max, process in batches
            use_openai: Force use OpenAI instead of Hugging Face
        """
        self.model = model
        self.max_events_per_query = max_events_per_query
        self.batch_size = batch_size
        self.client = None
        self.use_openai = use_openai
        self.hf_token = None
        self.api_key = None
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
                # Use new Hugging Face Inference API (via huggingface_hub or direct API)
                try:
                    from huggingface_hub import InferenceClient
                    self.hf_client = InferenceClient(model=model, token=self.hf_token)
                    self.use_hf_client = True
                    print(f"✓ Using free Hugging Face model: {model} (via InferenceClient)")
                except ImportError:
                    # Fallback to direct API calls
                    self.hf_client = None
                    self.use_hf_client = False
                    # Try router endpoint first, fallback to old endpoint
                    self.hf_api_url = f"https://router.huggingface.co/models/{model}"
                    print(f"✓ Using free Hugging Face model: {model}")
                    print(f"  API endpoint: {self.hf_api_url}")
                    print(f"  Note: Install 'huggingface_hub' for better compatibility: pip install huggingface_hub")
            elif self.openrouter_key:
                self.use_openrouter = True
                print(f"✓ Using OpenRouter model: {self.openrouter_model}")
                print("  OpenRouter will handle LLM-as-judge retrieval.")
            else:
                print("Warning: No Hugging Face token found. Set HF_TOKEN in .env file.")
                print("  Get a free token at: https://huggingface.co/settings/tokens")
                print("  Falling back to OpenAI if available...")
                if HAS_OPENAI and os.getenv('OPENAI_API_KEY'):
                    self.api_key = os.getenv('OPENAI_API_KEY')
                    try:
                        self.client = openai.OpenAI(api_key=self.api_key)
                        self.use_openai = True
                        print(f"✓ Using OpenAI fallback: {model}")
                    except:
                        raise ValueError("No API keys available. Set HF_TOKEN or OPENAI_API_KEY.")
                else:
                    raise ValueError("No API keys available. Set HF_TOKEN (free) or OPENAI_API_KEY (paid).")
    
    def summarize_event(self, event: Dict[str, Any]) -> EventSummary:
        """
        Create a comprehensive summary of an event for LLM consumption.
        
        Args:
            event: Event dictionary
        
        Returns:
            EventSummary object
        """
        event_id = event.get('_event_id', event.get('id', 'unknown'))
        event_type = event.get('type', event.get('operation', 'unknown'))
        timestamp = event.get('timestamp', '')
        
        # Extract file path
        file_path = ''
        details = event.get('details', {})
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except:
                details = {}
        if isinstance(details, dict):
            file_path = details.get('file_path', details.get('file', ''))
        
        # Extract prompt
        prompt = ''
        if 'prompt' in event:
            prompt = str(event['prompt'])
        elif isinstance(details, dict):
            prompt = details.get('prompt', details.get('message', ''))
        
        # Extract code snippet
        code_snippet = ''
        if isinstance(details, dict):
            code_snippet = details.get('after_content', details.get('before_content', details.get('code', '')))
            if code_snippet:
                # Truncate long code snippets
                code_snippet = code_snippet[:500] + '...' if len(code_snippet) > 500 else code_snippet
        
        # Extract operation
        operation = event.get('operation', event_type)
        
        # Build context
        context_parts = []
        if file_path:
            context_parts.append(f"File: {file_path}")
        if operation and operation != event_type:
            context_parts.append(f"Operation: {operation}")
        if timestamp:
            context_parts.append(f"Time: {timestamp}")
        context = " | ".join(context_parts)
        
        return EventSummary(
            event_id=event_id,
            event_type=event_type,
            file_path=file_path,
            timestamp=timestamp,
            prompt=prompt[:200] if prompt else '',  # Truncate long prompts
            code_snippet=code_snippet,
            operation=operation,
            context=context
        )
    
    def retrieve_events(
        self,
        query: str,
        events: List[Dict[str, Any]],
        top_k: int = 20
    ) -> List[str]:
        """
        Use LLM to retrieve relevant event IDs for a query.
        
        Args:
            query: Natural language query
            events: List of event dictionaries
            top_k: Number of events to retrieve
        
        Returns:
            List of event IDs in order of relevance
        """
        if not self.client and not self.hf_token:
            raise ValueError("No API client initialized. Set HF_TOKEN or OPENAI_API_KEY.")
        
        # Summarize events
        event_summaries = []
        for event in events:
            summary = self.summarize_event(event)
            event_summaries.append(asdict(summary))
        
        # If too many events, use batching strategy
        if len(event_summaries) > self.max_events_per_query:
            return self._retrieve_with_batching(query, event_summaries, top_k)
        
        # Single batch retrieval
        return self._retrieve_single_batch(query, event_summaries, top_k)
    
    def _retrieve_single_batch(
        self,
        query: str,
        event_summaries: List[Dict],
        top_k: int
    ) -> List[str]:
        """Retrieve events from a single batch."""
        prompt = self._build_retrieval_prompt(query, event_summaries, top_k)
        
        try:
            if self.use_openai and self.client:
                # Use OpenAI API
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a precise search system for developer workflow events. Given a query, identify the most relevant events. Return only a valid JSON array of event IDs, ordered by relevance (most relevant first)."
                        },
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ],
                    temperature=0.0,
                    max_tokens=min(1000, top_k * 50)  # Rough estimate: ~50 tokens per event ID
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
                        # Use InferenceClient for better compatibility
                        messages = [
                            {"role": "system", "content": "You are a precise search system for developer workflow events. Given a query, identify the most relevant events. Return only a valid JSON array of event IDs, ordered by relevance (most relevant first)."},
                            {"role": "user", "content": formatted_prompt}
                        ]
                        response_text = self.hf_client.chat.completion(
                            messages=messages,
                            max_tokens=min(1000, top_k * 50),
                            temperature=0.0
                        )
                        content = response_text.choices[0].message.content.strip()
                    except Exception as e:
                        print(f"  Warning: InferenceClient failed, trying direct API: {e}")
                        # Fall through to direct API call
                        content = None
                else:
                    content = None
                
                # Fallback to direct API calls
                if content is None:
                    headers = {
                        "Authorization": f"Bearer {self.hf_token}",
                        "Content-Type": "application/json"
                    }
                    
                    # Try router endpoint first
                    api_url = getattr(self, 'hf_api_url', f"https://router.huggingface.co/models/{self.model}")
                    
                    payload = {
                        "inputs": formatted_prompt,
                        "parameters": {
                            "temperature": 0.0,
                            "max_new_tokens": min(1000, top_k * 50),
                            "return_full_text": False,
                            "top_p": 0.9,
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
                                return []
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
                                    raise ValueError("Hugging Face API endpoints have changed. Please install 'huggingface_hub' and use InferenceClient: pip install huggingface_hub")
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
                lines = content.split("\n")
                # Remove first line (```json or ```)
                content = "\n".join(lines[1:])
                # Remove last line (```)
                if content.endswith("```"):
                    content = content[:-3]
                content = content.strip()
            
            # Parse JSON
            try:
                event_ids = json.loads(content)
                if not isinstance(event_ids, list):
                    raise ValueError("Response is not a list")
                return event_ids[:top_k]  # Ensure we don't exceed top_k
            except json.JSONDecodeError as e:
                print(f"Warning: Could not parse JSON response: {e}")
                print(f"Response: {content[:200]}")
                # Try to extract event IDs manually
                return self._extract_event_ids_from_text(content, event_summaries, top_k)
                
        except Exception as e:
            print(f"Error in LLM retrieval: {e}")
            raise
    
    def _retrieve_with_batching(
        self,
        query: str,
        event_summaries: List[Dict],
        top_k: int
    ) -> List[str]:
        """
        Retrieve events using batching when there are too many events.
        
        Strategy:
        1. Split events into batches
        2. Retrieve top events from each batch
        3. Merge and re-rank final results
        """
        n_batches = (len(event_summaries) + self.batch_size - 1) // self.batch_size
        batch_results = []
        
        print(f"Processing {len(event_summaries)} events in {n_batches} batches...")
        
        for i in range(0, len(event_summaries), self.batch_size):
            batch = event_summaries[i:i + self.batch_size]
            batch_num = i // self.batch_size + 1
            
            try:
                # Retrieve top events from this batch
                batch_top_k = min(top_k, len(batch))
                batch_event_ids = self._retrieve_single_batch(query, batch, batch_top_k)
                batch_results.extend(batch_event_ids)
            except Exception as e:
                print(f"Warning: Error processing batch {batch_num}: {e}")
                continue
        
        # If we have results from multiple batches, re-rank the top candidates
        if len(batch_results) > top_k:
            # Re-rank by asking LLM to select top K from merged results
            merged_summaries = [
                s for s in event_summaries
                if s['event_id'] in batch_results
            ]
            return self._retrieve_single_batch(query, merged_summaries, top_k)
        
        return batch_results[:top_k]
    
    def _build_retrieval_prompt(
        self,
        query: str,
        event_summaries: List[Dict],
        top_k: int
    ) -> str:
        """Build the prompt for LLM retrieval."""
        events_text = json.dumps(event_summaries, indent=2)
        
        prompt = f"""You are a search system for developer workflow events. Given a query, identify the most relevant events.

Query: {query}

Available events ({len(event_summaries)} total):
{events_text}

Instructions:
1. Analyze the query and identify which events are most relevant
2. Consider: event type, file paths, prompts, code snippets, timestamps
3. Return a JSON array of event IDs in order of relevance (most relevant first)
4. Return at most {top_k} event IDs
5. Only include events that are clearly relevant to the query

Return format (JSON array only, no markdown, no explanations):
["event_id_1", "event_id_2", ...]
"""
        return prompt

    def _retrieve_via_openrouter(self, prompt: str, top_k: int) -> str:
        """Call OpenRouter chat completions for LLM retrieval."""
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
                {
                    "role": "system",
                    "content": "You are a precise search system. Return only valid JSON arrays of event IDs."
                },
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
    
    def _format_hf_prompt(self, prompt: str) -> str:
        """Format prompt for Hugging Face chat models."""
        model_lower = self.model.lower()
        
        if "llama" in model_lower or "meta" in model_lower:
            # Llama format
            return f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are a precise search system for developer workflow events. Given a query, identify the most relevant events. Return only a valid JSON array of event IDs, ordered by relevance (most relevant first).<|eot_id|><|start_header_id|>user<|end_header_id|>

{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

"""
        elif "mistral" in model_lower:
            # Mistral format
            return f"""<s>[INST] You are a precise search system for developer workflow events. Given a query, identify the most relevant events. Return only a valid JSON array of event IDs, ordered by relevance (most relevant first).

{prompt} [/INST]"""
        elif "phi" in model_lower:
            # Phi format
            return f"""<|system|>
You are a precise search system for developer workflow events. Given a query, identify the most relevant events. Return only a valid JSON array of event IDs, ordered by relevance (most relevant first).<|end|>
<|user|>
{prompt}<|end|>
<|assistant|>
"""
        else:
            # Generic format
            return f"""System: You are a precise search system for developer workflow events. Given a query, identify the most relevant events. Return only a valid JSON array of event IDs, ordered by relevance (most relevant first).

User: {prompt}

Assistant:"""
    
    def _extract_event_ids_from_text(
        self,
        text: str,
        event_summaries: List[Dict],
        top_k: int
    ) -> List[str]:
        """Fallback: try to extract event IDs from text response."""
        valid_ids = {s['event_id'] for s in event_summaries}
        found_ids = []
        
        # Look for event IDs in the text
        for event_id in valid_ids:
            if event_id in text:
                found_ids.append(event_id)
        
        return found_ids[:top_k]


def load_events_from_traces(traces_file: Path) -> List[Dict]:
    """Load all events from traces file."""
    events = []
    with open(traces_file, 'r') as f:
        for line_num, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                trace = json.loads(line)
                trace_events = trace.get('events', [])
                for event_idx, event in enumerate(trace_events):
                    event['_event_id'] = f"trace_{line_num}_event_{event_idx}"
                    event['_trace_idx'] = line_num - 1
                    event['_event_idx'] = event_idx
                    events.append(event)
            except json.JSONDecodeError as e:
                print(f"Warning: Could not parse line {line_num}: {e}")
                continue
    
    return events


def main():
    parser = argparse.ArgumentParser(description='LLM-as-Judge Event Retriever')
    parser.add_argument('--queries', type=Path, required=True, help='JSON file with queries')
    parser.add_argument('--traces', type=Path, required=True, help='JSONL file with traces')
    parser.add_argument('--output', type=Path, required=True, help='Output JSON file for results')
    parser.add_argument('--model', type=str, default='meta-llama/Llama-3.2-3B-Instruct', 
                       help='Model to use. Free defaults: meta-llama/Llama-3.2-3B-Instruct, mistralai/Mistral-7B-Instruct-v0.2. Paid: gpt-4, gpt-3.5-turbo')
    parser.add_argument('--top-k', type=int, default=20, help='Number of events to retrieve per query')
    parser.add_argument('--max-events', type=int, default=200, help='Max events per query (for batching)')
    parser.add_argument('--api-key', type=str, help='API key (HF_TOKEN for Hugging Face, OPENAI_API_KEY for OpenAI)')
    parser.add_argument('--use-openai', action='store_true', help='Force use OpenAI instead of Hugging Face')
    
    args = parser.parse_args()
    
    # Load queries
    print(f"Loading queries from {args.queries}...")
    with open(args.queries, 'r') as f:
        queries = json.load(f)
    print(f"Loaded {len(queries)} queries")
    
    # Load events
    print(f"Loading events from {args.traces}...")
    events = load_events_from_traces(args.traces)
    print(f"Loaded {len(events)} events")
    
    # Initialize retriever
    print(f"Initializing LLM retriever (model: {args.model})...")
    retriever = LLMJudgeRetriever(
        api_key=args.api_key,
        model=args.model,
        max_events_per_query=args.max_events,
        use_openai=args.use_openai
    )
    
    # Process queries
    print(f"\nProcessing {len(queries)} queries...")
    results = []
    
    for query in tqdm(queries, desc="Retrieving events"):
        query_id = query.get('id', 'unknown')
        query_text = query.get('text', '')
        
        try:
            event_ids = retriever.retrieve_events(
                query_text,
                events,
                top_k=args.top_k
            )
            
            result = LLMRetrievalResult(
                query_id=query_id,
                query_text=query_text,
                retrieved_event_ids=event_ids,
                n_total_events=len(events),
                n_retrieved=len(event_ids),
                model=args.model
            )
            results.append(asdict(result))
            
        except Exception as e:
            print(f"\nError processing query {query_id}: {e}")
            result = LLMRetrievalResult(
                query_id=query_id,
                query_text=query_text,
                retrieved_event_ids=[],
                n_total_events=len(events),
                n_retrieved=0,
                model=args.model,
                error=str(e)
            )
            results.append(asdict(result))
    
    # Save results
    print(f"\nSaving results to {args.output}...")
    with open(args.output, 'w') as f:
        json.dump({
            'model': args.model,
            'n_queries': len(queries),
            'n_events': len(events),
            'results': results
        }, f, indent=2)
    
    print(f"Done! Processed {len(queries)} queries, saved results to {args.output}")


if __name__ == '__main__':
    main()

