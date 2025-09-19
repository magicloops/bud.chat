import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';

export function generateAnthropicHttp(
  _transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  return {
    label: 'Anthropic Messages (Python HTTP)',
    language: 'python',
    code: `# TODO: Implement Anthropic HTTP generator\n`,
    warnings: ['Anthropic HTTP generator is not implemented yet.'],
  };
}
