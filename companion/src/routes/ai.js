/**
 * AI/OpenRouter API routes for embeddings and chat completions
 */

// Use dynamic import for node-fetch v3 (ESM)
let fetchModule;
const fetchPromise = import('node-fetch').then((mod) => {
  fetchModule = mod.default;
});

function createAIRoutes(deps) {
  const { app } = deps;

  // Clean API key extraction - accept any non-empty value from .env
  const openRouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const hfToken = (
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_API_KEY ||
    process.env.HF_API_KEY ||
    ''
  ).trim();
  const openRouterEndpoint = 'https://openrouter.ai/api/v1';

  // Use free models by default - no API key required
  // These work without authentication via OpenRouter's free tier
  // Note: Xenova models are for Transformers.js (browser), not OpenRouter
  // For OpenRouter, use models like: openai/text-embedding-3-small, intfloat/e5-small-v2
  const embeddingModel = process.env.OPENROUTER_EMBEDDING_MODEL || 'openai/text-embedding-3-small';
  // Use a valid OpenRouter chat model - fallback to rule-based if not available
  // Try free models first, but they may be rate-limited - fallback handles this gracefully
  const chatModel = process.env.OPENROUTER_CHAT_MODEL || 'google/gemini-flash-1.5:free';
  const hfModel = process.env.HF_MODEL || 'meta-llama/Meta-Llama-3.1-8B-Instruct';
  const hfEndpoint =
    process.env.HF_ENDPOINT ||
    'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-8B-Instruct';

  // Log status on startup
  if (openRouterKey && openRouterKey.length > 0) {
    console.log('[AI] ✓ OpenRouter API key found - attempting to use OpenRouter API');
    console.log(`[AI]   Embedding model: ${embeddingModel}`);
    console.log(`[AI]   Chat model: ${chatModel}`);
    console.log(`[AI]   Key length: ${openRouterKey.length} characters`);
  } else {
    console.log('[AI] ℹ OpenRouter API key not set - using free local models');
    console.log('[AI]   Free models: Transformers.js (local, no API key needed)');
  }

  if (hfToken && hfToken.length > 0) {
    console.log('[AI] ✓ Hugging Face token found - reasoning engine available');
    console.log(`[AI]   Model: ${hfModel}`);
    console.log(`[AI]   Endpoint: ${hfEndpoint}`);
    console.log(`[AI]   Token length: ${hfToken.length} characters`);
  } else {
    console.log('[AI] ℹ Hugging Face token not set - reasoning engine will use fallback');
  }

  /**
   * Generate embeddings using OpenRouter API or local models
   */
  app.post('/api/ai/embeddings', async (req, res) => {
    // If no API key, return instructions to use local Transformers.js
    if (!openRouterKey) {
      return res.status(503).json({
        success: false,
        error:
          'OpenRouter API key not configured. Use Transformers.js in browser for free embeddings, or set OPENROUTER_API_KEY in .env for server-side embeddings.',
        useLocal: true,
        suggestion: 'The frontend will automatically use Transformers.js for free embeddings',
      });
    }

    try {
      const { texts } = req.body;

      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Texts array is required and must not be empty',
        });
      }

      // Ensure fetch is loaded
      await fetchPromise;

      // OpenRouter embeddings endpoint
      const response = await fetchModule(`${openRouterEndpoint}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: embeddingModel,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenRouter embeddings error (${response.status}):`, errorText);
        return res.status(response.status).json({
          success: false,
          error: `OpenRouter API error: ${response.status} - ${errorText}`,
        });
      }

      const data = await response.json();

      // Extract embeddings from response
      const embeddings = data.data.map((item) => item.embedding);

      res.json({
        success: true,
        embeddings,
        model: embeddingModel,
      });
    } catch (error) {
      console.error('Error generating embeddings:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Generate chat completion using OpenRouter API (for cluster labels, descriptions, etc.)
   * Falls back to rule-based generation if no API key
   */
  app.post('/api/ai/chat', async (req, res) => {
    // If no API key, provide a helpful fallback response
    if (!openRouterKey) {
      const { messages } = req.body;
      const userMessage =
        messages && messages.length > 0 ? messages[messages.length - 1].content : '';

      // Simple rule-based fallback for common cases
      let fallbackResponse = 'Cluster';
      if (userMessage.toLowerCase().includes('cluster')) {
        if (userMessage.includes('test') || userMessage.includes('spec')) {
          fallbackResponse = 'Test Files';
        } else if (userMessage.includes('component') || userMessage.includes('ui')) {
          fallbackResponse = 'UI Components';
        } else if (userMessage.includes('api') || userMessage.includes('route')) {
          fallbackResponse = 'API Routes';
        } else if (userMessage.includes('util') || userMessage.includes('helper')) {
          fallbackResponse = 'Utilities';
        }
      }

      return res.json({
        success: true,
        content: fallbackResponse,
        model: 'rule-based-fallback',
        note: 'OpenRouter API key not configured. Set OPENROUTER_API_KEY in .env for AI-generated labels.',
      });
    }

    try {
      const { messages, model, temperature = 0.7, max_tokens = 200 } = req.body;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Messages array is required and must not be empty',
        });
      }

      // Ensure fetch is loaded
      await fetchPromise;

      const response = await fetchModule(`${openRouterEndpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:43917',
          'X-Title': 'Cursor Telemetry Dashboard',
        },
        body: JSON.stringify({
          model: model || chatModel,
          messages: messages,
          temperature: temperature,
          max_tokens: max_tokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`OpenRouter chat error (${response.status}):`, errorText);

        // If model is invalid, not available, or rate-limited, fallback to rule-based
        if (response.status === 400 || response.status === 404 || response.status === 429) {
          const { messages } = req.body;
          const userMessage =
            messages && messages.length > 0 ? messages[messages.length - 1].content : '';

          // Simple rule-based fallback
          let fallbackResponse = 'Cluster';
          if (userMessage.toLowerCase().includes('cluster')) {
            if (userMessage.includes('test') || userMessage.includes('spec')) {
              fallbackResponse = 'Test Files';
            } else if (userMessage.includes('component') || userMessage.includes('ui')) {
              fallbackResponse = 'UI Components';
            } else if (userMessage.includes('api') || userMessage.includes('route')) {
              fallbackResponse = 'API Routes';
            } else if (userMessage.includes('util') || userMessage.includes('helper')) {
              fallbackResponse = 'Utilities';
            }
          }

          return res.json({
            success: true,
            content: fallbackResponse,
            model: 'rule-based-fallback',
            note: `OpenRouter model unavailable (${response.status}), using fallback`,
          });
        }

        return res.status(response.status).json({
          success: false,
          error: `OpenRouter API error: ${response.status} - ${errorText}`,
        });
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      res.json({
        success: true,
        content: content,
        model: data.model || model || chatModel,
      });
    } catch (error) {
      console.error('Error generating chat completion:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Check if AI services are available
   */
  app.get('/api/ai/status', (req, res) => {
    const hasOpenRouterKey = !!openRouterKey;
    const hasHfToken = !!hfToken;

    res.json({
      success: true,
      available: hasOpenRouterKey,
      embeddingModel: embeddingModel,
      chatModel: chatModel,
      hasApiKey: hasOpenRouterKey,
      // Hugging Face Inference API status
      huggingFace: {
        available: hasHfToken,
        hasToken: hasHfToken,
        model: hfModel,
        endpoint: hfEndpoint,
        useCase: 'Advanced reasoning and temporal analysis',
      },
      // Always available via Transformers.js in browser
      localAvailable: true,
      localModel: 'Xenova/all-MiniLM-L6-v2',
      message: hasOpenRouterKey
        ? 'OpenRouter API configured - using premium models'
        : 'Using free local models (Transformers.js) - set OPENROUTER_API_KEY for better quality',
      reasoningEngine: hasHfToken
        ? `Hugging Face Inference API available (${hfModel})`
        : 'Hugging Face token not set - set HF_TOKEN in .env for reasoning engine',
    });
  });

  /**
   * Annotate a prompt segment using LLM
   */
  app.post('/api/ai/annotate-segment', async (req, res) => {
    try {
      const { segment } = req.body;

      if (!segment || !segment.prompt) {
        return res.status(400).json({
          success: false,
          error: 'Segment with prompt is required',
        });
      }

      // Build prompt for LLM
      const promptText = segment.prompt.substring(0, 500);
      const stats = segment.stats || {};
      const filePaths = segment.filePaths || [];

      const systemPrompt = `You are an AI assistant analyzing development activity segments. 
Analyze the prompt and the resulting code changes, then provide a concise summary of what was accomplished.
Focus on: what the developer asked for, what changes were made, and the overall outcome.`;

      const userPrompt = `Analyze this development segment:

**User Prompt:**
${promptText}

**Activity Summary:**
- Code changes: ${stats.codeChanges || 0}
- Characters added: ${stats.codeAdded || 0}
- Characters deleted: ${stats.codeDeleted || 0}
- Files changed: ${stats.filesChanged || 0}
- Duration: ${stats.duration || 0} minutes
- Terminal commands: ${stats.terminalCommands || 0}

${
  filePaths.length > 0
    ? `**Files Modified:**\n${filePaths
        .slice(0, 10)
        .map((f) => `- ${f}`)
        .join('\n')}`
    : ''
}

Provide a concise analysis (2-3 sentences) of what was accomplished in this segment.`;

      // Try OpenRouter first if available
      if (openRouterKey) {
        await fetchPromise;

        const response = await fetchModule(`${openRouterEndpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:43917',
            'X-Title': 'Cursor Telemetry Dashboard',
          },
          body: JSON.stringify({
            model: chatModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.7,
            max_tokens: 300,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const annotation =
            data.choices?.[0]?.message?.content || 'Unable to generate annotation.';

          return res.json({
            success: true,
            annotation: annotation,
            model: chatModel,
          });
        }
      }

      // Fallback: Generate simple annotation
      const annotation = generateFallbackAnnotation(segment);

      return res.json({
        success: true,
        annotation: annotation,
        model: 'fallback',
      });
    } catch (error) {
      console.error('[AI] Error annotating segment:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate annotation',
      });
    }
  });

  /**
   * Generate fallback annotation
   */
  function generateFallbackAnnotation(segment) {
    const { prompt, stats } = segment;
    const promptText = prompt.substring(0, 100);

    let annotation = `**Activity Summary:**\n\n`;
    annotation += `In response to "${promptText}...", `;
    annotation += `this segment involved ${stats.codeChanges || 0} code changes across ${stats.filesChanged || 0} file(s). `;

    if (stats.codeAdded > 0) {
      annotation += `${stats.codeAdded} characters were added`;
      if (stats.codeDeleted > 0) {
        annotation += ` and ${stats.codeDeleted} were deleted`;
      }
      annotation += '. ';
    }

    if (stats.terminalCommands > 0) {
      annotation += `${stats.terminalCommands} terminal command(s) were executed. `;
    }

    annotation += `The activity took approximately ${stats.duration || 0} minutes.`;

    return annotation;
  }
}

module.exports = createAIRoutes;
