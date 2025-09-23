import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';
import { formatJsonPython, prependIndentPython, mergeWarnings } from './utils';

const ANTHROPIC_IMPORTS = ['import os', 'import anthropic'];

export function generateAnthropicSdk(
  transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  const warnings: string[] = [];

  if (transcript.provider !== 'anthropic-messages') {
    warnings.push(`Expected Anthropic transcript, received ${transcript.provider}.`);
  }

  const lines: string[] = [];
  lines.push(...ANTHROPIC_IMPORTS);
  lines.push('');
  lines.push('client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])');
  lines.push('');
  lines.push('def run():');

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    lines.push(prependIndentPython(`# Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`, 1));
    lines.push(
      prependIndentPython(
        `response_${stepNumber} = client.messages.create(${formatJsonPython(step.request, 2)})`,
        1,
      ),
    );
    lines.push(prependIndentPython(`print("assistant ${stepNumber}:", response_${stepNumber})`, 1));
    if (step.warnings && step.warnings.length > 0) {
      step.warnings.forEach((warning) => warnings.push(`[Step ${stepNumber}] ${warning}`));
    }
    if (index < transcript.steps.length - 1) {
      lines.push('');
    }
  });

  if (transcript.steps.length === 0) {
    lines.push(prependIndentPython('# No assistant turns found in the transcript.', 1));
  }

  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    run()');

  const combinedWarnings = mergeWarnings(transcript.warnings, warnings);

  return {
    label: 'Anthropic Messages (Python SDK)',
    language: 'python',
    code: lines.join('\n'),
    warnings: combinedWarnings,
  };
}
