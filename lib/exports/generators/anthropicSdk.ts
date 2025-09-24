import type { ProviderTranscript, ProviderCallStep, GeneratorOptions, GeneratorResult, JsonValue } from '../types';
import { formatPythonCallArguments, prependIndentPython, mergeWarnings } from './utils';

const ANTHROPIC_IMPORTS = ['import os', 'import json', 'import anthropic'];

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
  lines.push('anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")');
  lines.push('client = anthropic.Anthropic(api_key=anthropic_api_key) if anthropic_api_key else anthropic.Anthropic()');
  lines.push('');
  lines.push('def run():');

  const singleStep = transcript.steps.length === 1;

  const emitStep = (step: ProviderCallStep, index: number) => {
    const stepNumber = index + 1;
    const responseVar = singleStep ? 'response' : `response_${stepNumber}`;
    const responseDataVar = singleStep ? 'response_data' : `${responseVar}_data`;

    if (singleStep) {
      lines.push(prependIndentPython('# Replay the recorded assistant turn', 1));
    } else {
      lines.push(prependIndentPython(`# Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`, 1));
    }

    lines.push(prependIndentPython(`${responseVar} = client.messages.create(`, 1));
    const payload =
      step.request && typeof step.request === 'object'
        ? (step.request as Record<string, JsonValue>)
        : ({} as Record<string, JsonValue>);
    const argLines = formatPythonCallArguments(payload, 2);
    if (argLines.length > 0) {
      lines.push(...argLines);
    }
    lines.push(prependIndentPython(')', 1));

    lines.push(
      prependIndentPython(
        `${responseDataVar} = ${responseVar}.to_dict() if hasattr(${responseVar}, 'to_dict') else ${responseVar}`,
        1,
      ),
    );
    if (!singleStep) {
      lines.push(prependIndentPython(`print("assistant turn ${stepNumber}")`, 1));
    }
    lines.push(prependIndentPython(`print(json.dumps(${responseDataVar}, indent=2))`, 1));

    if (step.warnings && step.warnings.length > 0) {
      step.warnings.forEach((warning) => warnings.push(`[Step ${stepNumber}] ${warning}`));
    }
  };

  transcript.steps.forEach((step, index) => {
    emitStep(step, index);
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
