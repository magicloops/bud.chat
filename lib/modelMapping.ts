// Model mapping from friendly names to actual API model identifiers
// This allows us to use simple model names in the UI while maintaining
// flexibility to update to newer model versions without changing user configs

export interface BuiltInTool {
  type: 'web_search_preview' | 'code_interpreter';
  name: string;
  description: string;
  settings?: {
    // Tool-specific configuration options
    search_context_size?: 'low' | 'medium' | 'high';
    container?: string; // For code interpreter
  };
}

export interface ReasoningCapabilities {
  supports_reasoning: boolean;
  supports_reasoning_effort: boolean;
  available_reasoning_efforts: ('minimal' | 'low' | 'medium' | 'high')[];
  supports_reasoning_summary: boolean;
  available_summary_types: ('auto' | 'concise' | 'detailed')[];
}

export interface VerbosityCapabilities {
  supports_verbosity: boolean;
  available_verbosity_levels: ('low' | 'medium' | 'high')[];
}

export interface ModelCapabilities {
  supports_builtin_tools: boolean;
  available_builtin_tools: BuiltInTool[];
  uses_responses_api: boolean;
  reasoning_capabilities?: ReasoningCapabilities;
  verbosity_capabilities?: VerbosityCapabilities;
}

export interface ModelInfo {
  apiName: string;      // The actual API model identifier
  provider: 'openai' | 'anthropic';
  displayName: string;  // User-friendly display name
  description?: string; // Optional description
}

// Mapping of friendly model names to actual API models
export const MODEL_MAPPING: Record<string, ModelInfo> = {
  // OpenAI Models (GPT-5 Series - Hybrid Reasoning)
  'gpt-5': {
    apiName: 'gpt-5',
    provider: 'openai',
    displayName: 'GPT-5',
    description: 'Hybrid model with reasoning capabilities'
  },
  'gpt-5-mini': {
    apiName: 'gpt-5-mini',
    provider: 'openai',
    displayName: 'GPT-5 Mini',
    description: 'Efficient hybrid model with reasoning'
  },
  'gpt-5-nano': {
    apiName: 'gpt-5-nano',
    provider: 'openai',
    displayName: 'GPT-5 Nano',
    description: 'Ultra-efficient hybrid model'
  },

  // OpenAI Models (Latest - Reasoning Models)
  'o3': {
    apiName: 'o3',
    provider: 'openai',
    displayName: 'OpenAI o3',
    description: 'Advanced reasoning model'
  },
  'o3-mini': {
    apiName: 'o3-mini',
    provider: 'openai',
    displayName: 'OpenAI o3-mini',
    description: 'Efficient reasoning model'
  },
  'o4-mini': {
    apiName: 'o4-mini',
    provider: 'openai',
    displayName: 'OpenAI o4-mini',
    description: 'Latest efficient reasoning model'
  },
  'o1': {
    apiName: 'o1',
    provider: 'openai', 
    displayName: 'OpenAI o1',
    description: 'Original reasoning model'
  },
  'o1-mini': {
    apiName: 'o1-mini',
    provider: 'openai',
    displayName: 'OpenAI o1-mini',
    description: 'Efficient version of o1'
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

// Model capabilities mapping - defines which built-in tools are available per model
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // GPT-5 Series - Hybrid reasoning models with built-in tools
  'gpt-5': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'], // 'minimal' not compatible with built-in tools
      supports_reasoning_summary: true,
      available_summary_types: ['detailed'] // GPT-5 only supports 'detailed' summary
    },
    verbosity_capabilities: {
      supports_verbosity: true,
      available_verbosity_levels: ['low', 'medium', 'high']
    }
  },
  'gpt-5-mini': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'], // 'minimal' not compatible with built-in tools
      supports_reasoning_summary: true,
      available_summary_types: ['detailed'] // GPT-5 only supports 'detailed' summary
    },
    verbosity_capabilities: {
      supports_verbosity: true,
      available_verbosity_levels: ['low', 'medium', 'high']
    }
  },
  'gpt-5-nano': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'], // 'minimal' not compatible with built-in tools
      supports_reasoning_summary: true,
      available_summary_types: ['detailed'] // GPT-5 only supports 'detailed' summary
    },
    verbosity_capabilities: {
      supports_verbosity: true,
      available_verbosity_levels: ['low', 'medium', 'high']
    }
  },

  // O-series reasoning models with built-in tools
  'o3': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'],
      supports_reasoning_summary: true,
      available_summary_types: ['auto', 'concise', 'detailed']
    }
  },
  'o3-mini': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'],
      supports_reasoning_summary: true,
      available_summary_types: ['auto', 'concise', 'detailed']
    }
  },
  'o4-mini': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'],
      supports_reasoning_summary: true,
      available_summary_types: ['auto', 'concise', 'detailed']
    }
  },
  'o1': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'],
      supports_reasoning_summary: true,
      available_summary_types: ['auto', 'concise', 'detailed']
    }
  },
  'o1-mini': {
    supports_builtin_tools: true,
    available_builtin_tools: [
      {
        type: 'web_search_preview',
        name: 'Web Search',
        description: 'Search the web for current information and recent developments'
      }
    ],
    uses_responses_api: true,
    reasoning_capabilities: {
      supports_reasoning: true,
      supports_reasoning_effort: true,
      available_reasoning_efforts: ['low', 'medium', 'high'],
      supports_reasoning_summary: true,
      available_summary_types: ['auto', 'concise', 'detailed']
    }
  },

  // GPT-4 series - No built-in tools, uses ChatCompletion API
  'gpt-4o': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'gpt-4o-mini': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'gpt-4-turbo': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'gpt-4': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'gpt-3.5-turbo': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },

  // Anthropic Claude models - No built-in tools (uses their own API)
  'claude-3-5-sonnet': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'claude-3-5-haiku': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'claude-3-opus': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'claude-3-sonnet': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
  },
  'claude-3-haiku': {
    supports_builtin_tools: false,
    available_builtin_tools: [],
    uses_responses_api: false
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
 * Check if a model is a reasoning model that should use the Responses API
 * @param friendlyName - The friendly model name
 * @returns true if it's an o-series model or GPT-5 series (hybrid reasoning)
 */
export function isReasoningModel(friendlyName: string): boolean {
  const reasoningModels = ['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
  return reasoningModels.includes(friendlyName);
}


/**
 * Check if a model supports temperature parameter
 * @param friendlyName - The friendly model name
 * @returns true if the model supports temperature
 */
export function supportsTemperature(friendlyName: string): boolean {
  // O-series reasoning models don't support temperature
  return !isReasoningModel(friendlyName);
}

/**
 * Get the default model for new buds/conversations
 * @returns The default friendly model name
 */
export function getDefaultModel(): string {
  return 'gpt-4o'; // Can be changed here to update system-wide default
}

/**
 * Get model capabilities for a friendly model name
 * @param friendlyName - The friendly model name
 * @returns ModelCapabilities object with built-in tool support info
 */
export function getModelCapabilities(friendlyName: string): ModelCapabilities {
  const capabilities = MODEL_CAPABILITIES[friendlyName];
  if (!capabilities) {
    // Default to no built-in tools for unknown models
    return {
      supports_builtin_tools: false,
      available_builtin_tools: [],
      uses_responses_api: false
    };
  }
  return capabilities;
}

/**
 * Get available built-in tools for a model
 * @param friendlyName - The friendly model name
 * @returns Array of BuiltInTool objects
 */
export function getAvailableBuiltInTools(friendlyName: string): BuiltInTool[] {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.available_builtin_tools;
}

/**
 * Check if a model supports built-in tools
 * @param friendlyName - The friendly model name
 * @returns true if the model supports built-in tools
 */
export function supportsBuiltInTools(friendlyName: string): boolean {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.supports_builtin_tools;
}

/**
 * Check if a model should use the Responses API (includes built-in tool support)
 * @param friendlyName - The friendly model name
 * @returns true if the model uses Responses API
 */
export function usesResponsesAPI(friendlyName: string): boolean {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.uses_responses_api;
}

/**
 * Get built-in tool by type for a specific model
 * @param friendlyName - The friendly model name
 * @param toolType - The tool type to find
 * @returns BuiltInTool object or null if not found
 */
export function getBuiltInTool(
  friendlyName: string, 
  toolType: 'web_search_preview' | 'code_interpreter'
): BuiltInTool | null {
  const availableTools = getAvailableBuiltInTools(friendlyName);
  return availableTools.find(tool => tool.type === toolType) || null;
}

/**
 * Check if a model supports reasoning capabilities
 * @param friendlyName - The friendly model name
 * @returns true if the model supports reasoning
 */
export function supportsReasoning(friendlyName: string): boolean {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.reasoning_capabilities?.supports_reasoning || false;
}

/**
 * Check if a model supports reasoning effort configuration
 * @param friendlyName - The friendly model name
 * @returns true if the model supports reasoning effort levels
 */
export function supportsReasoningEffort(friendlyName: string): boolean {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.reasoning_capabilities?.supports_reasoning_effort || false;
}

/**
 * Check if a model supports reasoning summary configuration
 * @param friendlyName - The friendly model name
 * @returns true if the model supports reasoning summary
 */
export function supportsReasoningSummary(friendlyName: string): boolean {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.reasoning_capabilities?.supports_reasoning_summary || false;
}

/**
 * Check if a model supports verbosity configuration
 * @param friendlyName - The friendly model name
 * @returns true if the model supports verbosity levels
 */
export function supportsVerbosity(friendlyName: string): boolean {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.verbosity_capabilities?.supports_verbosity || false;
}

/**
 * Get available reasoning effort levels for a model
 * @param friendlyName - The friendly model name
 * @param hasBuiltInTools - Whether built-in tools are enabled (affects minimal reasoning compatibility)
 * @returns Array of available reasoning effort levels
 */
export function getAvailableReasoningEfforts(friendlyName: string, hasBuiltInTools?: boolean): ('minimal' | 'low' | 'medium' | 'high')[] {
  const capabilities = getModelCapabilities(friendlyName);
  const baseEfforts = capabilities.reasoning_capabilities?.available_reasoning_efforts || [];
  
  // GPT-5 models can use 'minimal' only when no built-in tools are enabled
  if (friendlyName.startsWith('gpt-5') && !hasBuiltInTools) {
    return ['minimal', ...baseEfforts];
  }
  
  return baseEfforts;
}

/**
 * Get available reasoning summary types for a model
 * @param friendlyName - The friendly model name
 * @returns Array of available summary types
 */
export function getAvailableReasoningSummaryTypes(friendlyName: string): ('auto' | 'concise' | 'detailed')[] {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.reasoning_capabilities?.available_summary_types || [];
}

/**
 * Get available verbosity levels for a model
 * @param friendlyName - The friendly model name
 * @returns Array of available verbosity levels
 */
export function getAvailableVerbosityLevels(friendlyName: string): ('low' | 'medium' | 'high')[] {
  const capabilities = getModelCapabilities(friendlyName);
  return capabilities.verbosity_capabilities?.available_verbosity_levels || [];
}