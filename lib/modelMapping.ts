// Model mapping from friendly names to actual API model identifiers
// This allows us to use simple model names in the UI while maintaining
// flexibility to update to newer model versions without changing user configs

export interface ModelInfo {
  apiName: string;      // The actual API model identifier
  provider: 'openai' | 'anthropic';
  displayName: string;  // User-friendly display name
  description?: string; // Optional description
}

// Mapping of friendly model names to actual API models
export const MODEL_MAPPING: Record<string, ModelInfo> = {
  // OpenAI Models (Latest)
  'o3': {
    apiName: 'o3',
    provider: 'openai',
    displayName: 'OpenAI o3'
  },
  'o1': {
    apiName: 'o1',
    provider: 'openai', 
    displayName: 'OpenAI o1'
  },
  'o1-mini': {
    apiName: 'o1-mini',
    provider: 'openai',
    displayName: 'OpenAI o1-mini'
  },
  
  // OpenAI Models (GPT-4 Series)
  'gpt-4o': {
    apiName: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o'
  },
  'gpt-4o-mini': {
    apiName: 'gpt-4o-mini', 
    provider: 'openai',
    displayName: 'GPT-4o Mini'
  },
  'gpt-4-turbo': {
    apiName: 'gpt-4-turbo',
    provider: 'openai',
    displayName: 'GPT-4 Turbo'
  },
  'gpt-4': {
    apiName: 'gpt-4',
    provider: 'openai',
    displayName: 'GPT-4'
  },
  'gpt-3.5-turbo': {
    apiName: 'gpt-3.5-turbo',
    provider: 'openai',
    displayName: 'GPT-3.5 Turbo'
  },
  
  // Anthropic Claude Models
  'claude-3-5-sonnet': {
    apiName: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Sonnet'
  },
  'claude-3-5-haiku': {
    apiName: 'claude-3-5-haiku-20241022',
    provider: 'anthropic', 
    displayName: 'Claude 3.5 Haiku'
  },
  'claude-3-opus': {
    apiName: 'claude-3-opus-20240229',
    provider: 'anthropic',
    displayName: 'Claude 3 Opus'
  },
  'claude-3-sonnet': {
    apiName: 'claude-3-sonnet-20240229',
    provider: 'anthropic',
    displayName: 'Claude 3 Sonnet'
  },
  'claude-3-haiku': {
    apiName: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    displayName: 'Claude 3 Haiku'
  }
};

/**
 * Get the actual API model name from a friendly model name
 * @param friendlyName - The friendly model name (e.g., 'claude-3-5-sonnet')
 * @returns The actual API model name (e.g., 'claude-3-5-sonnet-20241022')
 */
export function getApiModelName(friendlyName: string): string {
  const modelInfo = MODEL_MAPPING[friendlyName];
  if (!modelInfo) {
    console.warn(`Unknown model: ${friendlyName}, using as-is`);
    return friendlyName; // Fallback to original name if not found
  }
  return modelInfo.apiName;
}

/**
 * Get the model provider from a friendly model name
 * @param friendlyName - The friendly model name (e.g., 'claude-3-5-sonnet')
 * @returns The provider ('openai' | 'anthropic')
 */
export function getModelProvider(friendlyName: string): 'openai' | 'anthropic' {
  const modelInfo = MODEL_MAPPING[friendlyName];
  if (!modelInfo) {
    // Fallback logic based on model name patterns
    if (friendlyName.toLowerCase().includes('claude')) {
      return 'anthropic';
    }
    return 'openai'; // Default to OpenAI
  }
  return modelInfo.provider;
}

/**
 * Get model information from a friendly model name
 * @param friendlyName - The friendly model name
 * @returns ModelInfo object or null if not found
 */
export function getModelInfo(friendlyName: string): ModelInfo | null {
  return MODEL_MAPPING[friendlyName] || null;
}

/**
 * Check if a model is a Claude model (Anthropic)
 * @param friendlyName - The friendly model name
 * @returns true if it's a Claude model
 */
export function isClaudeModel(friendlyName: string): boolean {
  return getModelProvider(friendlyName) === 'anthropic';
}

/**
 * Check if a model is a GPT model (OpenAI)
 * @param friendlyName - The friendly model name
 * @returns true if it's a GPT model
 */
export function isGPTModel(friendlyName: string): boolean {
  return getModelProvider(friendlyName) === 'openai';
}

/**
 * Get all available models grouped by provider
 * @returns Object with models grouped by provider
 */
export function getAvailableModels(): Record<'openai' | 'anthropic', ModelInfo[]> {
  const result: Record<'openai' | 'anthropic', ModelInfo[]> = {
    openai: [],
    anthropic: []
  };
  
  Object.values(MODEL_MAPPING).forEach(model => {
    result[model.provider].push(model);
  });
  
  return result;
}

/**
 * Get friendly model names for a specific provider
 * @param provider - The provider to filter by
 * @returns Array of friendly model names
 */
export function getModelsByProvider(provider: 'openai' | 'anthropic'): string[] {
  return Object.keys(MODEL_MAPPING).filter(name => 
    MODEL_MAPPING[name].provider === provider
  );
}

/**
 * Get all models in a UI-friendly format for dropdowns/selects
 * @returns Array of {value, label} objects for UI components
 */
export function getModelsForUI(): Array<{value: string, label: string, provider: string}> {
  return Object.entries(MODEL_MAPPING).map(([friendlyName, modelInfo]) => ({
    value: friendlyName,
    label: modelInfo.displayName,
    provider: modelInfo.provider
  }));
}

/**
 * Get models grouped by provider for UI components
 * @returns Object with models grouped by provider for UI
 */
export function getModelsGroupedForUI() {
  const models = getModelsForUI();
  return {
    openai: models.filter(m => m.provider === 'openai'),
    anthropic: models.filter(m => m.provider === 'anthropic')
  };
}

/**
 * Get the default model for new buds/conversations
 * @returns The default friendly model name
 */
export function getDefaultModel(): string {
  return 'gpt-4o'; // Can be changed here to update system-wide default
}