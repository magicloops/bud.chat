import type { Event } from '@budchat/events';
import type {
  MCPBudConfig,
  BuiltInToolsConfig,
  ReasoningConfig,
  TextGenerationConfig,
} from '@/lib/types';

export type TargetProvider = 'openai-chat' | 'openai-responses' | 'anthropic-messages';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProviderCallStep {
  assistantEventId: string;
  request: JsonValue;
  response: JsonValue | null;
  streamPreview?: JsonValue[];
  warnings?: string[];
}

export interface ProviderTranscript {
  provider: TargetProvider;
  model: string;
  steps: ProviderCallStep[];
  warnings?: string[];
}

export interface TranscriptContext {
  events: Event[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  mcpConfig?: MCPBudConfig;
  builtInToolsConfig?: BuiltInToolsConfig;
  reasoningConfig?: ReasoningConfig;
  textGenerationConfig?: TextGenerationConfig;
}

export interface BuildTranscriptOptions {
  targetProvider: TargetProvider;
  context: TranscriptContext;
}

export interface GeneratorOptions {
  includeStreaming?: boolean;
  packageVersions?: Record<string, string>;
}

export interface GeneratorResult {
  label: string;
  language: 'typescript' | 'python';
  code: string;
  warnings?: string[];
}

export type TranscriptGenerator = (
  transcript: ProviderTranscript,
  options?: GeneratorOptions
) => GeneratorResult;

export interface GeneratorDescriptor {
  id: string;
  label: string;
  targetProvider: TargetProvider;
  variant: 'sdk' | 'http';
  language: 'typescript' | 'python';
}
