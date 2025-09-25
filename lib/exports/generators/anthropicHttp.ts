import type { ProviderTranscript, GeneratorOptions, GeneratorResult, JsonValue } from '../types';
import { formatPythonAssignment, prependIndentPython, mergeWarnings } from './utils';

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
  lines.push('import json');
  lines.push('import requests');
  lines.push('');
  lines.push('ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")');
  lines.push('');
  lines.push('def run():');
  lines.push(prependIndentPython('if not ANTHROPIC_API_KEY:', 1));
  lines.push(prependIndentPython('raise RuntimeError("Set the ANTHROPIC_API_KEY environment variable before running this script.")', 2));
  lines.push('');
  lines.push(prependIndentPython('headers = {', 1));
  lines.push(prependIndentPython('"Content-Type": "application/json",', 2));
  lines.push(prependIndentPython('"x-api-key": ANTHROPIC_API_KEY,', 2));
  lines.push(prependIndentPython('"anthropic-version": "2023-06-01",', 2));
  lines.push(prependIndentPython('}', 1));
  lines.push('');

  const singleStep = transcript.steps.length === 1;

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    if (singleStep) {
      lines.push(prependIndentPython('# Replay the recorded assistant turn', 1));
    } else {
      lines.push(prependIndentPython(`# Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`, 1));
    }

    const bodyLines = formatPythonAssignment('body', step.request as JsonValue, 1);
    lines.push(...bodyLines);
    lines.push(prependIndentPython('response = requests.post(', 1));
    lines.push(prependIndentPython(`    '${ANTHROPIC_URL}',`, 1));
    lines.push(prependIndentPython('    headers=headers,', 1));
    lines.push(prependIndentPython('    json=body,', 1));
    lines.push(prependIndentPython(')', 1));
    lines.push(prependIndentPython('response.raise_for_status()', 1));
    lines.push(prependIndentPython('data = response.json()', 1));
    if (!singleStep) {
      lines.push(prependIndentPython(`print("assistant turn ${stepNumber}")`, 1));
    }
    lines.push(prependIndentPython('print(json.dumps(data, indent=2))', 1));
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
