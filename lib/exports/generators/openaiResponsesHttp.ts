import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';

export function generateOpenAIResponsesHttp(
  _transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  return {
    label: 'OpenAI Responses (TypeScript HTTP)',
    language: 'typescript',
    code: `// TODO: Implement OpenAI Responses HTTP generator\n`,
    warnings: ['OpenAI Responses HTTP generator is not implemented yet.'],
  };
}
