// Model mapping from friendly names to actual API model identifiers
// This allows us to use simple model names in the UI while maintaining
// flexibility to update to newer model versions without changing user configs

export interface BuiltInTool {
  type: 'web_search_preview' | 'code_interpreter';
  name: string;
  description: string;
  settings?: {
    search_context_size?: 'low' | 'medium' | 'high';
    container?: string;
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
  apiName: string;
  provider: 'openai' | 'anthropic';
  displayName: string;
  description?: string;
}

export const MODEL_MAPPING: Record<string, ModelInfo> = {
  'gpt-5': { apiName: 'gpt-5', provider: 'openai', displayName: 'GPT-5', description: 'Hybrid model with reasoning capabilities' },
  'gpt-5-mini': { apiName: 'gpt-5-mini', provider: 'openai', displayName: 'GPT-5 Mini', description: 'Efficient hybrid model with reasoning' },
  'gpt-5-nano': { apiName: 'gpt-5-nano', provider: 'openai', displayName: 'GPT-5 Nano', description: 'Ultra-efficient hybrid model' },
  'o3': { apiName: 'o3', provider: 'openai', displayName: 'OpenAI o3', description: 'Advanced reasoning model' },
  'o3-mini': { apiName: 'o3-mini', provider: 'openai', displayName: 'OpenAI o3-mini', description: 'Efficient reasoning model' },
  'o4-mini': { apiName: 'o4-mini', provider: 'openai', displayName: 'OpenAI o4-mini', description: 'Latest efficient reasoning model' },
  'o1': { apiName: 'o1', provider: 'openai', displayName: 'OpenAI o1', description: 'Original reasoning model' },
  'o1-mini': { apiName: 'o1-mini', provider: 'openai', displayName: 'OpenAI o1-mini', description: 'Efficient version of o1' },
  'gpt-4o': { apiName: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
  'gpt-4o-mini': { apiName: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o Mini' },
  'gpt-4-turbo': { apiName: 'gpt-4-turbo', provider: 'openai', displayName: 'GPT-4 Turbo' },
  'gpt-4': { apiName: 'gpt-4', provider: 'openai', displayName: 'GPT-4' },
  'gpt-3.5-turbo': { apiName: 'gpt-3.5-turbo', provider: 'openai', displayName: 'GPT-3.5 Turbo' },
  'claude-3-5-sonnet': { apiName: 'claude-3-5-sonnet-20241022', provider: 'anthropic', displayName: 'Claude 3.5 Sonnet' },
  'claude-3-5-haiku': { apiName: 'claude-3-5-haiku-20241022', provider: 'anthropic', displayName: 'Claude 3.5 Haiku' },
  'claude-3-opus': { apiName: 'claude-3-opus-20240229', provider: 'anthropic', displayName: 'Claude 3 Opus' },
  'claude-3-sonnet': { apiName: 'claude-3-sonnet-20240229', provider: 'anthropic', displayName: 'Claude 3 Sonnet' },
  'claude-3-haiku': { apiName: 'claude-3-haiku-20240307', provider: 'anthropic', displayName: 'Claude 3 Haiku' },
};

export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-5': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['detailed'] }, verbosity_capabilities: { supports_verbosity: true, available_verbosity_levels: ['low','medium','high'] } },
  'gpt-5-mini': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['detailed'] }, verbosity_capabilities: { supports_verbosity: true, available_verbosity_levels: ['low','medium','high'] } },
  'gpt-5-nano': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['detailed'] }, verbosity_capabilities: { supports_verbosity: true, available_verbosity_levels: ['low','medium','high'] } },
  'o3': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['auto','concise','detailed'] } },
  'o3-mini': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['auto','concise','detailed'] } },
  'o4-mini': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['auto','concise','detailed'] } },
  'o1': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['auto','concise','detailed'] } },
  'o1-mini': { supports_builtin_tools: true, available_builtin_tools: [{ type: 'web_search_preview', name: 'Web Search', description: 'Search the web for current information and recent developments' }], uses_responses_api: true, reasoning_capabilities: { supports_reasoning: true, supports_reasoning_effort: true, available_reasoning_efforts: ['low','medium','high'], supports_reasoning_summary: true, available_summary_types: ['auto','concise','detailed'] } },
  'gpt-4o': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'gpt-4o-mini': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'gpt-4-turbo': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'gpt-4': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'gpt-3.5-turbo': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'claude-3-5-sonnet': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'claude-3-5-haiku': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'claude-3-opus': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'claude-3-sonnet': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
  'claude-3-haiku': { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false },
};

export function getModelProvider(friendlyName: string): 'openai' | 'anthropic' {
  const info = MODEL_MAPPING[friendlyName];
  if (!info) throw new Error(`Unknown model: ${friendlyName}`);
  return info.provider;
}
export function getApiModelName(friendlyName: string): string { return MODEL_MAPPING[friendlyName]?.apiName || friendlyName; }
export function isReasoningModel(friendlyName: string): boolean { return ['o1','o1-mini','o3','o3-mini','o4-mini','gpt-5','gpt-5-mini','gpt-5-nano'].includes(friendlyName); }

export function getModelsForUI(): Array<{value: string, label: string, provider: string}> {
  const entries = Object.entries(MODEL_MAPPING);
  return entries.map(([value, info]) => ({ value, label: info.displayName || value, provider: info.provider }));
}
export function getDefaultModel(): string {
  const preferred = process.env.NEXT_PUBLIC_DEFAULT_MODEL;
  if (preferred && MODEL_MAPPING[preferred]) return preferred;
  return 'gpt-4o';
}

export function getModelCapabilities(friendlyName: string): ModelCapabilities {
  const capabilities = MODEL_CAPABILITIES[friendlyName];
  if (!capabilities) {
    return { supports_builtin_tools: false, available_builtin_tools: [], uses_responses_api: false };
  }
  return capabilities;
}
export function getAvailableBuiltInTools(friendlyName: string): BuiltInTool[] { return getModelCapabilities(friendlyName).available_builtin_tools; }
export function supportsBuiltInTools(friendlyName: string): boolean { return getModelCapabilities(friendlyName).supports_builtin_tools; }
export function usesResponsesAPI(friendlyName: string): boolean { return getModelCapabilities(friendlyName).uses_responses_api; }
// Temperature is not supported on Responses API models
export function supportsTemperature(friendlyName: string): boolean { return !usesResponsesAPI(friendlyName); }
export function getBuiltInTool(friendlyName: string, toolType: 'web_search_preview' | 'code_interpreter'): BuiltInTool | null { return getAvailableBuiltInTools(friendlyName).find(tool => tool.type === toolType) || null; }
export function supportsReasoning(friendlyName: string): boolean { return !!getModelCapabilities(friendlyName).reasoning_capabilities?.supports_reasoning; }
export function supportsReasoningEffort(friendlyName: string): boolean { return !!getModelCapabilities(friendlyName).reasoning_capabilities?.supports_reasoning_effort; }
export function supportsReasoningSummary(friendlyName: string): boolean { return !!getModelCapabilities(friendlyName).reasoning_capabilities?.supports_reasoning_summary; }
export function supportsVerbosity(friendlyName: string): boolean { return !!getModelCapabilities(friendlyName).verbosity_capabilities?.supports_verbosity; }
export function getAvailableReasoningEfforts(friendlyName: string, hasBuiltInTools?: boolean): ('minimal' | 'low' | 'medium' | 'high')[] {
  const base = getModelCapabilities(friendlyName).reasoning_capabilities?.available_reasoning_efforts || [];
  if (friendlyName.startsWith('gpt-5') && !hasBuiltInTools) return ['minimal', ...base];
  return base;
}
export function getAvailableReasoningSummaryTypes(friendlyName: string): ('auto' | 'concise' | 'detailed')[] { return getModelCapabilities(friendlyName).reasoning_capabilities?.available_summary_types || []; }
export function getAvailableVerbosityLevels(friendlyName: string): ('low' | 'medium' | 'high')[] { return getModelCapabilities(friendlyName).verbosity_capabilities?.available_verbosity_levels || []; }
