import type { ProviderTranscript, GeneratorOptions, GeneratorResult, JsonValue } from '../types';
import { formatPythonAssignment, mergeWarnings } from './utils';

interface GeneratorConfig {
  label: string;
  methodPath: string;
}

const CHAT_CONFIG: GeneratorConfig = {
  label: 'Python SDK',
  methodPath: 'chat.completions.create',
};

const RESPONSES_CONFIG: GeneratorConfig = {
  label: 'Python SDK',
  methodPath: 'responses.create',
};

export function generateOpenAIPythonSdk(
  transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  const warnings: string[] = [];

  let config: GeneratorConfig;
  if (transcript.provider === 'openai-chat') {
    config = CHAT_CONFIG;
  } else if (transcript.provider === 'openai-responses') {
    config = RESPONSES_CONFIG;
  } else {
    config = RESPONSES_CONFIG;
    warnings.push(`Python SDK export not available for provider ${transcript.provider}.`);
  }

  const lines: string[] = [];
  lines.push('import os');
  lines.push('import json');
  lines.push('from openai import OpenAI');
  lines.push('');
  lines.push('client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))');
  lines.push('');
  lines.push('def run():');

  const singleStep = transcript.steps.length === 1;

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    const responseVar = singleStep ? 'response' : `response_${stepNumber}`;

    if (singleStep) {
      lines.push('    # Replay the recorded assistant turn');
    } else {
      lines.push(`    # Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`);
    }

    const payloadLines = formatPythonAssignment('payload', step.request as JsonValue, 1);
    lines.push(...payloadLines);

    lines.push(`    ${responseVar} = client.${config.methodPath}(**payload)`);

    if (!singleStep) {
      lines.push(`    print("assistant turn ${stepNumber}")`);
    }

    lines.push(`    print(json.dumps(${responseVar}.model_dump(), indent=2))`);

    if (step.warnings && step.warnings.length > 0) {
      step.warnings.forEach((warning) => warnings.push(`[Step ${stepNumber}] ${warning}`));
    }
  });

  if (transcript.steps.length === 0) {
    lines.push('    # No assistant turns found in the transcript.');
  }

  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    run()');

  const combinedWarnings = mergeWarnings(transcript.warnings, warnings);

  return {
    label: config.label,
    language: 'python',
    code: lines.join('\n'),
    warnings: combinedWarnings,
  };
}
