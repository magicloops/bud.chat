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
import { generateAnthropicSdkTs } from './anthropicSdkTs';
import { generateOpenAIPythonSdk } from './openaiSdkPy';

const GENERATOR_REGISTRY: Record<string, { descriptor: GeneratorDescriptor; run: TranscriptGenerator }> = {
  'openai-chat-sdk-ts': {
    descriptor: {
      id: 'openai-chat-sdk-ts',
      label: 'TypeScript SDK',
      targetProvider: 'openai-chat',
      variant: 'sdk',
      language: 'typescript',
    },
    run: generateOpenAIChatSdk,
  },
  'openai-chat-sdk-py': {
    descriptor: {
      id: 'openai-chat-sdk-py',
      label: 'Python SDK',
      targetProvider: 'openai-chat',
      variant: 'sdk',
      language: 'python',
    },
    run: generateOpenAIPythonSdk,
  },
  'openai-chat-http-ts': {
    descriptor: {
      id: 'openai-chat-http-ts',
      label: 'HTTP (TypeScript)',
      targetProvider: 'openai-chat',
      variant: 'http',
      language: 'typescript',
    },
    run: generateOpenAIChatHttp,
  },
  'openai-responses-sdk-ts': {
    descriptor: {
      id: 'openai-responses-sdk-ts',
      label: 'TypeScript SDK',
      targetProvider: 'openai-responses',
      variant: 'sdk',
      language: 'typescript',
    },
    run: generateOpenAIResponsesSdk,
  },
  'openai-responses-sdk-py': {
    descriptor: {
      id: 'openai-responses-sdk-py',
      label: 'Python SDK',
      targetProvider: 'openai-responses',
      variant: 'sdk',
      language: 'python',
    },
    run: generateOpenAIPythonSdk,
  },
  'openai-responses-http-ts': {
    descriptor: {
      id: 'openai-responses-http-ts',
      label: 'HTTP (TypeScript)',
      targetProvider: 'openai-responses',
      variant: 'http',
      language: 'typescript',
    },
    run: generateOpenAIResponsesHttp,
  },
  'anthropic-sdk-py': {
    descriptor: {
      id: 'anthropic-sdk-py',
      label: 'Python SDK',
      targetProvider: 'anthropic-messages',
      variant: 'sdk',
      language: 'python',
    },
    run: generateAnthropicSdk,
  },
  'anthropic-sdk-ts': {
    descriptor: {
      id: 'anthropic-sdk-ts',
      label: 'TypeScript SDK',
      targetProvider: 'anthropic-messages',
      variant: 'sdk',
      language: 'typescript',
    },
    run: generateAnthropicSdkTs,
  },
  'anthropic-http-py': {
    descriptor: {
      id: 'anthropic-http-py',
      label: 'HTTP (Python)',
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
