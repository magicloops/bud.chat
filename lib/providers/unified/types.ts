// Unified types for provider abstraction layer
import { Event, Segment } from '@budchat/events';
import { MCPBudConfig, BuiltInToolsConfig, ReasoningConfig, TextGenerationConfig } from '@/lib/types';

export interface UnifiedChatRequest {
  events: Event[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  mcpConfig?: MCPBudConfig;
  builtInToolsConfig?: BuiltInToolsConfig;
  conversationId?: string;
  workspaceId?: string;
  budId?: string;
  // Tool definitions for the request
  tools?: UnifiedTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  // Reasoning and verbosity configuration
  reasoningConfig?: ReasoningConfig;
  textGenerationConfig?: TextGenerationConfig;
  // Legacy support - deprecated but still used by existing code
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface UnifiedChatResponse {
  event: Event;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
}

export interface StreamEvent {
  type: 'event' | 'segment' | 'error' | 'done';
  data?: {
    event?: Event;
    segment?: Segment;
    segmentIndex?: number;
    error?: string;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

export interface LLMProvider {
  // Core methods
  chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse>;
  stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent>;
  
  // Validation and configuration
  validateConfig(config: Partial<UnifiedChatRequest>): ValidationResult;
  supportsFeature(feature: ProviderFeature): boolean;
  
  // Provider info
  readonly name: string;
  readonly provider: 'openai' | 'anthropic';
}

export enum ProviderFeature {
  TEMPERATURE = 'temperature',
  REASONING = 'reasoning',
  TOOL_CALLING = 'tool_calling',
  REASONING_EFFORT = 'reasoning_effort',
  SYSTEM_MESSAGE = 'system_message',
  STREAMING = 'streaming',
  VISION = 'vision'
}

// Tool-related types for unified handling
export interface UnifiedTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>; // MCP tools use inputSchema
  serverId?: string;
  serverType?: 'local' | 'remote';
}

export interface UnifiedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  serverId?: string;
}

export interface UnifiedToolResult {
  id: string;
  result: unknown;
  error?: string;
}
