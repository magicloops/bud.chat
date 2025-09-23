import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';
import { formatJsonPython, prependIndentPython, mergeWarnings } from './utils';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export function generateAnthropicHttp(
  transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  const warnings: string[] = [];

  if (transcript.provider !== 'anthropic-messages') {
    warnings.push(`Expected Anthropic transcript, received ${transcript.provider}.`);
  }

  const lines: string[] = [];
  lines.push('import os');
  lines.push('import requests');
  lines.push('');
  lines.push('ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]');
  lines.push('');
  lines.push('def run():');
  lines.push(prependIndentPython('headers = {', 1));
  lines.push(prependIndentPython('"Content-Type": "application/json",', 2));
  lines.push(prependIndentPython('"x-api-key": ANTHROPIC_API_KEY,', 2));
  lines.push(prependIndentPython('"anthropic-version": "2023-06-01",', 2));
  lines.push(prependIndentPython('}', 1));
  lines.push('');

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    lines.push(prependIndentPython(`# Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`, 1));
    lines.push(prependIndentPython(`body = ${formatJsonPython(step.request, 2)}`, 1));
    lines.push(prependIndentPython('response = requests.post(', 1));
    lines.push(prependIndentPython(`    '${ANTHROPIC_URL}',`, 1));
    lines.push(prependIndentPython('    headers=headers,', 1));
    lines.push(prependIndentPython('    json=body,', 1));
    lines.push(prependIndentPython(')', 1));
    lines.push(prependIndentPython('print(f"assistant ${stepNumber}:", response.json())', 1));
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
    label: 'Anthropic Messages (Python HTTP)',
    language: 'python',
    code: lines.join('\n'),
    warnings: combinedWarnings,
  };
}
