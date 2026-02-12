/**
 * Embedding Service for Clio
 * Generates embeddings using OpenRouter or Hugging Face APIs
 */

let fetchModule;
const fetchPromise = import('node-fetch').then((mod) => {
  fetchModule = mod.default;
});

class ClioEmbeddingService {
  constructor() {
    this.openRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
    this.hfToken = (
      process.env.HF_TOKEN ||
      process.env.HUGGINGFACE_API_KEY ||
      process.env.HF_API_KEY ||
      ''
    ).trim();

    // Default to all-mpnet-base-v2 via OpenRouter (or similar)
    // This is the model recommended in the Clio paper
    this.embeddingModel =
      process.env.CLIO_EMBEDDING_MODEL ||
      process.env.OPENROUTER_EMBEDDING_MODEL ||
      'sentence-transformers/all-mpnet-base-v2';

    this.openRouterEndpoint = 'https://openrouter.ai/api/v1/embeddings';
    this.hfEndpoint =
      process.env.HF_EMBEDDING_ENDPOINT ||
      'https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-mpnet-base-v2';

    // Determine which API to use
    this.useOpenRouter = !!this.openRouterKey;
    this.useHuggingFace = !this.useOpenRouter && !!this.hfToken;

    if (this.useOpenRouter) {
      console.log(`[CLIO-EMBEDDING] Using OpenRouter API with model: ${this.embeddingModel}`);
    } else if (this.useHuggingFace) {
      console.log(`[CLIO-EMBEDDING] Using Hugging Face API with model: ${this.hfEndpoint}`);
    } else {
      console.warn(
        '[CLIO-EMBEDDING] No API key found - embeddings will fail. Set OPENROUTER_API_KEY or HF_TOKEN'
      );
    }
  }

  /**
   * Generate embeddings for a single text
   */
  async embedText(text) {
    if (!text || typeof text !== 'string') {
      throw new Error('Text must be a non-empty string');
    }

    if (this.useOpenRouter) {
      return await this.embedViaOpenRouter([text]).then((embeddings) => embeddings[0]);
    } else if (this.useHuggingFace) {
      return await this.embedViaHuggingFace([text]).then((embeddings) => embeddings[0]);
    } else {
      throw new Error('No embedding API available. Set OPENROUTER_API_KEY or HF_TOKEN');
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   */
  async embedTexts(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts must be a non-empty array');
    }

    // Filter out empty texts
    const validTexts = texts.filter((t) => t && typeof t === 'string' && t.trim().length > 0);
    if (validTexts.length === 0) {
      throw new Error('No valid texts to embed');
    }

    if (this.useOpenRouter) {
      return await this.embedViaOpenRouter(validTexts);
    } else if (this.useHuggingFace) {
      return await this.embedViaHuggingFace(validTexts);
    } else {
      throw new Error('No embedding API available. Set OPENROUTER_API_KEY or HF_TOKEN');
    }
  }

  /**
   * Generate embeddings for items (extracts text from items)
   */
  async embedItems(items) {
    const texts = items.map((item) => this.extractTextFromItem(item));
    return await this.embedTexts(texts);
  }

  /**
   * Extract text content from an item for embedding
   */
  extractTextFromItem(item) {
    // For prompts
    if (item.itemType === 'prompt' || item.type === 'prompt') {
      return item.text || item.prompt || item.content || '';
    }

    // For events (code changes)
    if (item.itemType === 'event' || item.type === 'event' || item.type === 'code_change') {
      const details =
        typeof item.details === 'string' ? JSON.parse(item.details) : item.details || {};
      const before = details.before_content || details.before_code || '';
      const after = details.after_content || details.after_code || '';
      const filePath = details.file_path || item.file_path || '';
      return `${filePath}\n${before}\n${after}`.trim();
    }

    // For terminal commands
    if (item.itemType === 'terminal' || item.type === 'terminal') {
      return item.command || '';
    }

    // Fallback: try to find any text field
    return item.text || item.content || item.description || JSON.stringify(item);
  }

  /**
   * Embed via OpenRouter API
   */
  async embedViaOpenRouter(texts) {
    await fetchPromise;
    const fetch = fetchModule;

    try {
      const response = await fetch(this.openRouterEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.openRouterKey}`,
          'HTTP-Referer': 'https://github.com/cursor-telemetry',
          'X-Title': 'Cursor Telemetry Clio',
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      // OpenRouter returns { data: [{ embedding: [...] }, ...] }
      if (data.data && Array.isArray(data.data)) {
        return data.data.map((item) => item.embedding);
      }

      // Fallback: might return embeddings directly
      if (Array.isArray(data)) {
        return data;
      }

      throw new Error('Unexpected response format from OpenRouter');
    } catch (error) {
      console.error('[CLIO-EMBEDDING] OpenRouter embedding error:', error.message);
      throw error;
    }
  }

  /**
   * Embed via Hugging Face API
   */
  async embedViaHuggingFace(texts) {
    await fetchPromise;
    const fetch = fetchModule;

    try {
      const response = await fetch(this.hfEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.hfToken}`,
        },
        body: JSON.stringify({
          inputs: texts,
          options: {
            wait_for_model: true,
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Hugging Face API error: ${response.status} ${response.statusText} - ${errorText}`
        );
      }

      const data = await response.json();

      // Hugging Face returns array of embeddings
      if (Array.isArray(data)) {
        return data;
      }

      // Might be wrapped in an object
      if (data.embeddings) {
        return data.embeddings;
      }

      throw new Error('Unexpected response format from Hugging Face');
    } catch (error) {
      console.error('[CLIO-EMBEDDING] Hugging Face embedding error:', error.message);
      throw error;
    }
  }

  /**
   * Check if embedding service is available
   */
  isAvailable() {
    return this.useOpenRouter || this.useHuggingFace;
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      available: this.isAvailable(),
      provider: this.useOpenRouter ? 'openrouter' : this.useHuggingFace ? 'huggingface' : 'none',
      model: this.embeddingModel,
      hasApiKey: !!(this.openRouterKey || this.hfToken),
    };
  }
}

module.exports = ClioEmbeddingService;
