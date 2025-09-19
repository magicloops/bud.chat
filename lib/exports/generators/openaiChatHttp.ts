import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';

export function generateOpenAIChatHttp(
  _transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  return {
    label: 'OpenAI Chat (TypeScript HTTP)',
    language: 'typescript',
    code: `// TODO: Implement OpenAI Chat HTTP generator\n`,
    warnings: ['OpenAI Chat HTTP generator is not implemented yet.'],
  };
}
