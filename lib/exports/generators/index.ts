import type {
  ProviderTranscript,
  GeneratorOptions,
  GeneratorResult,
  TranscriptGenerator,
  GeneratorDescriptor,
} from '../types';
import { generateOpenAIChatSdk } from './openaiChatSdk';
import { generateOpenAIChatHttp } from './openaiChatHttp';
import { generateOpenAIResponsesSdk } from './openaiResponsesSdk';
import { generateOpenAIResponsesHttp } from './openaiResponsesHttp';
import { generateAnthropicSdk } from './anthropicSdk';
import { generateAnthropicHttp } from './anthropicHttp';

const GENERATOR_REGISTRY: Record<string, { descriptor: GeneratorDescriptor; run: TranscriptGenerator }> = {
  'openai-chat-sdk-ts': {
    descriptor: {
      id: 'openai-chat-sdk-ts',
      label: 'OpenAI Chat (TypeScript SDK)',
      targetProvider: 'openai-chat',
      variant: 'sdk',
      language: 'typescript',
    },
    run: generateOpenAIChatSdk,
  },
  'openai-chat-http-ts': {
    descriptor: {
      id: 'openai-chat-http-ts',
      label: 'OpenAI Chat (TypeScript HTTP)',
      targetProvider: 'openai-chat',
      variant: 'http',
      language: 'typescript',
    },
    run: generateOpenAIChatHttp,
  },
  'openai-responses-sdk-ts': {
    descriptor: {
      id: 'openai-responses-sdk-ts',
      label: 'OpenAI Responses (TypeScript SDK)',
      targetProvider: 'openai-responses',
      variant: 'sdk',
      language: 'typescript',
    },
    run: generateOpenAIResponsesSdk,
  },
  'openai-responses-http-ts': {
    descriptor: {
      id: 'openai-responses-http-ts',
      label: 'OpenAI Responses (TypeScript HTTP)',
      targetProvider: 'openai-responses',
      variant: 'http',
      language: 'typescript',
    },
    run: generateOpenAIResponsesHttp,
  },
  'anthropic-sdk-py': {
    descriptor: {
      id: 'anthropic-sdk-py',
      label: 'Anthropic Messages (Python SDK)',
      targetProvider: 'anthropic-messages',
      variant: 'sdk',
      language: 'python',
    },
    run: generateAnthropicSdk,
  },
  'anthropic-http-py': {
    descriptor: {
      id: 'anthropic-http-py',
      label: 'Anthropic Messages (Python HTTP)',
      targetProvider: 'anthropic-messages',
      variant: 'http',
      language: 'python',
    },
    run: generateAnthropicHttp,
  },
};

export type GeneratorId = keyof typeof GENERATOR_REGISTRY;

export function listGenerators(): GeneratorDescriptor[] {
  return Object.values(GENERATOR_REGISTRY).map((entry) => entry.descriptor);
}

export function runGenerator(
  id: GeneratorId,
  transcript: ProviderTranscript,
  options?: GeneratorOptions,
): GeneratorResult {
  const entry = GENERATOR_REGISTRY[id];
  if (!entry) {
    throw new Error(`Unknown generator: ${id}`);
  }
  return entry.run(transcript, options);
}
