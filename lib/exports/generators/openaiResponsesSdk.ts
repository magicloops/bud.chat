import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';

export function generateOpenAIResponsesSdk(
  _transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  return {
    label: 'OpenAI Responses (TypeScript SDK)',
    language: 'typescript',
    code: `// TODO: Implement OpenAI Responses SDK generator\n`,
    warnings: ['OpenAI Responses SDK generator is not implemented yet.'],
  };
}
