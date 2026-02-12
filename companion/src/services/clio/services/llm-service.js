/**
 * LLM Service for Clio
 * Handles facet extraction and cluster summarization using OpenAI, OpenRouter, or Hugging Face
 */

let fetchModule;
const fetchPromise = import('node-fetch').then((mod) => {
  fetchModule = mod.default;
});

class ClioLLMService {
  constructor() {
    this.openRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
    this.openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    this.hfToken = (
      process.env.HF_TOKEN ||
      process.env.HUGGINGFACE_API_KEY ||
      process.env.HF_API_KEY ||
      ''
    ).trim();

    // Model selection - prefer Claude for summarization (as in Clio paper)
    // Fallback to cheaper/free models
    this.chatModel =
      process.env.CLIO_CHAT_MODEL ||
      process.env.OPENROUTER_CHAT_MODEL ||
      'anthropic/claude-3-haiku'; // Fast and cost-effective

    this.openRouterEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
    this.openaiEndpoint = 'https://api.openai.com/v1/chat/completions';
    this.hfEndpoint =
      process.env.HF_ENDPOINT ||
      'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct';

    // Determine which API to use (priority: OpenAI > OpenRouter > Hugging Face)
    this.useOpenAI = !!this.openaiKey;
    this.useOpenRouter = !this.useOpenAI && !!this.openRouterKey;
    this.useHuggingFace = !this.useOpenAI && !this.useOpenRouter && !!this.hfToken;

    if (this.useOpenAI) {
      console.log(`[CLIO-LLM] Using OpenAI API`);
    } else if (this.useOpenRouter) {
      console.log(`[CLIO-LLM] Using OpenRouter API with model: ${this.chatModel}`);
    } else if (this.useHuggingFace) {
      console.log(`[CLIO-LLM] Using Hugging Face API`);
    } else {
      console.warn(
        '[CLIO-LLM] No API key found - LLM features will fail. Set OPENAI_API_KEY, OPENROUTER_API_KEY, or HF_TOKEN'
      );
    }
  }

  /**
   * Extract facets from a conversation/item using LLM
   */
  async extractFacets(item, workspaceContext = null) {
    const prompt = this.buildFacetExtractionPrompt(item, workspaceContext);

    try {
      const response = await this.chatCompletion(prompt, {
        temperature: 0.3, // Lower temperature for more consistent extraction
        maxTokens: 500,
      });

      return this.parseFacetResponse(response);
    } catch (error) {
      console.warn('[CLIO-LLM] Facet extraction failed, using rule-based fallback:', error.message);
      return null; // Fallback to rule-based extraction
    }
  }

  /**
   * Generate cluster summary using LLM
   */
  async generateClusterSummary(cluster, clusterType = 'global') {
    const prompt = this.buildClusterSummaryPrompt(cluster, clusterType);

    try {
      const response = await this.chatCompletion(prompt, {
        temperature: 0.7, // Higher temperature for more creative summaries
        maxTokens: 300,
      });

      return this.parseSummaryResponse(response);
    } catch (error) {
      console.warn('[CLIO-LLM] Cluster summarization failed:', error.message);
      return {
        title: `Cluster ${cluster.id}`,
        description: 'Summary generation failed',
        summary: 'Unable to generate summary',
      };
    }
  }

  /**
   * Generate cluster title
   */
  async generateClusterTitle(cluster) {
    const prompt = this.buildTitlePrompt(cluster);

    try {
      const response = await this.chatCompletion(prompt, {
        temperature: 0.5,
        maxTokens: 50,
      });

      return this.parseTitleResponse(response);
    } catch (error) {
      console.warn('[CLIO-LLM] Title generation failed:', error.message);
      return `Cluster ${cluster.id}`;
    }
  }

  /**
   * Build facet extraction prompt
   */
  buildFacetExtractionPrompt(item, workspaceContext) {
    const itemText = this.extractItemText(item);
    const contextInfo = workspaceContext
      ? `Workspace: ${workspaceContext.repoType || 'unknown'} repository, ${workspaceContext.projectStructure || 'unstructured'} structure`
      : '';

    return `Extract structured facets from this development activity:

${itemText}

${contextInfo ? `Context: ${contextInfo}` : ''}

Extract and return a JSON object with these fields:
- topic: Main topic (e.g., "debugging", "implementation", "refactoring", "testing", "documentation")
- subtopic: More specific subtopic
- task_type: Type of task (e.g., "api_development", "ui_development", "database", "authentication", "general_development")
- language: Programming language if applicable (e.g., "python", "javascript", "typescript", "rust")
- complexity: Complexity level ("very_low", "low", "medium", "high", "very_high")
- safety_flags: Array of any safety or security concerns (empty array if none)

Return only valid JSON, no additional text.`;
  }

  /**
   * Build cluster summary prompt
   */
  buildClusterSummaryPrompt(cluster, clusterType) {
    const sampleItems = (cluster.items || [])
      .slice(0, 5)
      .map((item) => this.extractItemText(item))
      .join('\n\n---\n\n');

    const stats = cluster.workspaceDistribution
      ? `Workspaces: ${Object.keys(cluster.workspaceDistribution).length}, ` +
        `Items: ${cluster.size || cluster.items?.length || 0}`
      : `Items: ${cluster.size || cluster.items?.length || 0}`;

    return `Summarize this cluster of development activities:

${sampleItems}

Cluster statistics: ${stats}
Cluster type: ${clusterType}

Generate:
1. A concise title (3-7 words)
2. A brief description (1-2 sentences)
3. A summary paragraph explaining the common pattern

Return JSON:
{
  "title": "...",
  "description": "...",
  "summary": "..."
}`;
  }

  /**
   * Build title prompt
   */
  buildTitlePrompt(cluster) {
    const sampleItems = (cluster.items || [])
      .slice(0, 3)
      .map((item) => this.extractItemText(item))
      .join('\n\n');

    return `Generate a concise title (3-7 words) for this cluster of development activities:

${sampleItems}

Return only the title, no quotes or additional text.`;
  }

  /**
   * Extract text from item
   */
  extractItemText(item) {
    if (item.itemType === 'prompt' || item.type === 'prompt') {
      return item.text || item.prompt || item.content || '';
    }

    if (item.itemType === 'event' || item.type === 'event') {
      const details =
        typeof item.details === 'string' ? JSON.parse(item.details) : item.details || {};
      return `File: ${details.file_path || 'unknown'}\nChange: ${details.after_content || ''}`;
    }

    if (item.itemType === 'terminal' || item.type === 'terminal') {
      return `Command: ${item.command || ''}`;
    }

    return JSON.stringify(item);
  }

  /**
   * Make chat completion request with timing metadata
   * @param {string} prompt - User prompt
   * @param {Object} options - Request options
   * @param {number} [options.temperature=0.7] - Temperature
   * @param {number} [options.maxTokens=1000] - Max tokens
   * @param {string} [options.systemPrompt] - System prompt
   * @param {Function} [options.onToken] - Callback for streaming tokens
   * @returns {Promise<Object>} Response with content and timing metadata
   */
  async chatCompletion(prompt, options = {}) {
    const {
      temperature = 0.7,
      maxTokens = 1000,
      systemPrompt = 'You are a helpful assistant that analyzes software development patterns.',
      onToken = null,
    } = options;

    const requestStartTime = Date.now();
    let firstTokenTime = null;
    let responseData = null;
    let error = null;

    try {
      if (this.useOpenAI) {
        responseData = await this.chatViaOpenAI(prompt, {
          temperature,
          maxTokens,
          systemPrompt,
          onToken: onToken
            ? (token) => {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now();
                }
                onToken(token);
              }
            : null,
        });
      } else if (this.useOpenRouter) {
        responseData = await this.chatViaOpenRouter(prompt, {
          temperature,
          maxTokens,
          systemPrompt,
          onToken: onToken
            ? (token) => {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now();
                }
                onToken(token);
              }
            : null,
        });
      } else if (this.useHuggingFace) {
        responseData = await this.chatViaHuggingFace(prompt, {
          temperature,
          maxTokens,
          onToken: onToken
            ? (token) => {
                if (!firstTokenTime) {
                  firstTokenTime = Date.now();
                }
                onToken(token);
              }
            : null,
        });
      } else {
        throw new Error(
          'No LLM API available. Set OPENAI_API_KEY, OPENROUTER_API_KEY, or HF_TOKEN'
        );
      }
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const requestEndTime = Date.now();

      // Return response with timing metadata
      if (responseData && typeof responseData === 'object' && responseData.content) {
        return {
          ...responseData,
          timing: {
            requestStartTime,
            requestEndTime,
            requestDurationMs: requestEndTime - requestStartTime,
            firstTokenTime: firstTokenTime || requestEndTime,
            timeToFirstTokenMs: firstTokenTime ? firstTokenTime - requestStartTime : null,
          },
        };
      }

      // For backward compatibility, return string with timing if responseData is a string
      return {
        content: responseData || '',
        timing: {
          requestStartTime,
          requestEndTime: Date.now(),
          requestDurationMs: Date.now() - requestStartTime,
          firstTokenTime: firstTokenTime || Date.now(),
          timeToFirstTokenMs: firstTokenTime ? firstTokenTime - requestStartTime : null,
        },
        error: error ? error.message : null,
      };
    }
  }

  /**
   * Chat via OpenAI API with timing capture
   */
  async chatViaOpenAI(prompt, options) {
    await fetchPromise;
    const fetch = fetchModule;

    const requestBody = {
      model: 'gpt-4o-mini', // Cost-effective model
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    // Enable streaming if onToken callback is provided
    if (options.onToken) {
      requestBody.stream = true;
    }

    const response = await fetch(this.openaiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Extract token usage if available
    const usage = data.usage || {};

    return {
      content: data.choices[0]?.message?.content || '',
      tokens: {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0,
      },
      model: {
        name: data.model || 'gpt-4o-mini',
        provider: 'openai',
      },
    };
  }

  /**
   * Chat via OpenRouter API with timing capture
   */
  async chatViaOpenRouter(prompt, options) {
    await fetchPromise;
    const fetch = fetchModule;

    const requestBody = {
      model: this.chatModel,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    // Enable streaming if onToken callback is provided
    if (options.onToken) {
      requestBody.stream = true;
    }

    const response = await fetch(this.openRouterEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openRouterKey}`,
        'HTTP-Referer': 'https://github.com/cursor-telemetry',
        'X-Title': 'Cursor Telemetry Clio',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Extract token usage if available
    const usage = data.usage || {};

    return {
      content: data.choices[0]?.message?.content || '',
      tokens: {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0,
      },
      model: {
        name: data.model?.id || this.chatModel,
        provider: 'openrouter',
      },
    };
  }

  /**
   * Chat via Hugging Face API with timing capture
   */
  async chatViaHuggingFace(prompt, options) {
    await fetchPromise;
    const fetch = fetchModule;

    const response = await fetch(this.hfEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.hfToken}`,
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          temperature: options.temperature,
          max_new_tokens: options.maxTokens,
          return_full_text: false,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Hugging Face API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    // Hugging Face returns array of generated text
    let content = '';
    if (Array.isArray(data) && data[0]?.generated_text) {
      content = data[0].generated_text;
    } else {
      content = JSON.stringify(data);
    }

    return {
      content: content,
      tokens: {
        prompt: 0, // HF API doesn't always provide token counts
        completion: 0,
        total: 0,
      },
      model: {
        name: this.hfEndpoint.split('/').pop() || 'huggingface-model',
        provider: 'huggingface',
      },
    };
  }

  /**
   * Parse facet extraction response
   */
  parseFacetResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(response);
    } catch (error) {
      console.warn('[CLIO-LLM] Failed to parse facet response:', error.message);
      return null;
    }
  }

  /**
   * Parse summary response
   */
  parseSummaryResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return {
        title: response.split('\n')[0] || 'Cluster',
        description: response.split('\n').slice(1, 3).join(' ') || response,
        summary: response,
      };
    } catch (error) {
      return {
        title: 'Cluster',
        description: response,
        summary: response,
      };
    }
  }

  /**
   * Parse title response
   */
  parseTitleResponse(response) {
    return response.trim().replace(/^["']|["']$/g, ''); // Remove quotes
  }

  /**
   * Check if LLM service is available
   */
  isAvailable() {
    return this.useOpenAI || this.useOpenRouter || this.useHuggingFace;
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      available: this.isAvailable(),
      provider: this.useOpenAI
        ? 'openai'
        : this.useOpenRouter
          ? 'openrouter'
          : this.useHuggingFace
            ? 'huggingface'
            : 'none',
      model: this.chatModel,
      hasApiKey: !!(this.openaiKey || this.openRouterKey || this.hfToken),
    };
  }
}

module.exports = ClioLLMService;
