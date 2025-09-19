import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';

export function generateAnthropicSdk(
  _transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  return {
    label: 'Anthropic Messages (Python SDK)',
    language: 'python',
    code: `# TODO: Implement Anthropic SDK generator\n`,
    warnings: ['Anthropic SDK generator is not implemented yet.'],
  };
}
