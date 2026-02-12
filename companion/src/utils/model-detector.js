/**
 * Model and Provider Detection Utility
 * Provides robust detection of AI model providers and types
 */

// Provider detection patterns - ordered by specificity
const PROVIDER_PATTERNS = [
  {
    provider: 'OpenAI',
    modelPatterns: [
      /^gpt-/i, // gpt-3.5-turbo, gpt-4, etc.
      /^o1-/i, // o1-preview, o1-mini
      /^o3-/i, // o3-mini
      /openai/i, // openai in name
      /^text-(embedding|ada|babbage|curie|davinci)/i, // Legacy models
    ],
    contentPatterns: [
      /gpt-\d/i, // gpt-3, gpt-4
      /openai/i,
    ],
  },
  {
    provider: 'Anthropic',
    modelPatterns: [
      /^claude/i, // claude-3-opus, claude-3-sonnet, etc.
      /anthropic/i, // anthropic in name
    ],
    contentPatterns: [/claude/i, /anthropic/i],
  },
  {
    provider: 'Google',
    modelPatterns: [
      /^gemini/i, // gemini-pro, gemini-ultra, etc.
      /^palm/i, // PaLM models
      /google.*ai/i, // google ai in name
    ],
    contentPatterns: [/gemini/i, /palm/i, /google.*ai/i],
  },
  {
    provider: 'Meta',
    modelPatterns: [
      /^llama/i, // llama-2, llama-3, etc.
      /^meta-llama/i, // meta-llama-3-8b
    ],
    contentPatterns: [/llama/i, /meta-llama/i],
  },
  {
    provider: 'Mistral',
    modelPatterns: [
      /^mistral/i, // mistral-small, mistral-large, etc.
      /^mixtral/i, // mixtral-8x7b
    ],
    contentPatterns: [/mistral/i, /mixtral/i],
  },
  {
    provider: 'Cohere',
    modelPatterns: [
      /^command/i, // command, command-light
      /^cohere/i, // cohere in name
    ],
    contentPatterns: [/cohere/i],
  },
];

/**
 * Detect provider from model name
 * @param {string} modelName - The model name to analyze
 * @returns {string|null} - Provider name or null if not detected
 */
function detectProviderFromModel(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    return null;
  }

  const normalizedModel = modelName.toLowerCase().trim();

  // Check each provider's patterns
  for (const providerConfig of PROVIDER_PATTERNS) {
    for (const pattern of providerConfig.modelPatterns) {
      if (pattern.test(normalizedModel)) {
        return providerConfig.provider;
      }
    }
  }

  return null;
}

/**
 * Detect provider from content text
 * @param {string} content - Content text to analyze
 * @returns {string|null} - Provider name or null if not detected
 */
function detectProviderFromContent(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const normalizedContent = content.toLowerCase();

  // Check each provider's content patterns
  for (const providerConfig of PROVIDER_PATTERNS) {
    for (const pattern of providerConfig.contentPatterns) {
      if (pattern.test(normalizedContent)) {
        return providerConfig.provider;
      }
    }
  }

  return null;
}

/**
 * Extract comprehensive model information from data object
 * @param {Object} data - Data object containing model information
 * @returns {Object} - Model info object with model, mode, provider, isAuto
 */
function extractModelInfo(data) {
  if (!data || typeof data !== 'object') {
    return {
      model: 'Unknown',
      mode: 'Unknown',
      provider: 'Unknown',
      isAuto: false,
    };
  }

  const modelInfo = {
    model: 'Unknown',
    mode: 'Unknown',
    provider: 'Unknown',
    isAuto: false,
  };

  // Extract model name from various possible fields
  const modelName =
    data.model ||
    data.ai_model ||
    data.assistant_model ||
    data.model_name ||
    data.modelName ||
    null;

  if (modelName) {
    modelInfo.model = String(modelName);
  }

  // Extract mode from various possible fields
  const mode =
    data.mode || data.assistant_mode || data.ai_mode || data.mode_name || data.modeName || null;

  if (mode) {
    modelInfo.mode = String(mode);
  }

  // Detect Auto mode from various indicators
  const modeLower = modelInfo.mode.toLowerCase();
  const modelLower = modelInfo.model.toLowerCase();
  const hasAutoMode =
    modeLower.includes('auto') ||
    modelLower.includes('auto') ||
    data.auto_mode === true ||
    data.is_auto === true ||
    data.isAuto === true ||
    (data.content && data.content.toLowerCase().includes('auto mode')) ||
    (data.content && data.content.toLowerCase().includes('automatic model selection'));

  if (hasAutoMode) {
    modelInfo.isAuto = true;
    modelInfo.mode = 'Auto';
  }

  // Detect provider - prioritize model name, then content, then auto mode
  if (modelInfo.model !== 'Unknown') {
    const providerFromModel = detectProviderFromModel(modelInfo.model);
    if (providerFromModel) {
      modelInfo.provider = providerFromModel;
    }
  }

  // Fallback to content detection if model name didn't yield a provider
  if (modelInfo.provider === 'Unknown' && data.content) {
    const providerFromContent = detectProviderFromContent(data.content);
    if (providerFromContent) {
      modelInfo.provider = providerFromContent;
    }
  }

  // If still unknown and auto mode, set to Auto
  if (modelInfo.provider === 'Unknown' && modelInfo.isAuto) {
    modelInfo.provider = 'Auto';
  }

  return modelInfo;
}

module.exports = {
  extractModelInfo,
  detectProviderFromModel,
  detectProviderFromContent,
  PROVIDER_PATTERNS,
};
