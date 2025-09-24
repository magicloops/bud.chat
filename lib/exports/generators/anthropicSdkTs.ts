import type { ProviderTranscript, GeneratorOptions, GeneratorResult, JsonValue } from '../types';
import { formatJson, prependIndent, mergeWarnings } from './utils';

const IMPORT_LINE = "import Anthropic from '@anthropic-ai/sdk';";

export function generateAnthropicSdkTs(
  transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  const warnings: string[] = [];

  if (transcript.provider !== 'anthropic-messages') {
    warnings.push(`Expected Anthropic transcript, received ${transcript.provider}.`);
  }

  const lines: string[] = [];
  lines.push(IMPORT_LINE);
  lines.push('');
  lines.push('const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });');
  lines.push('');
  lines.push('async function run() {');

  const singleStep = transcript.steps.length === 1;

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    const responseVar = singleStep ? 'response' : `response${stepNumber}`;

    if (singleStep) {
      lines.push('  // Replay the recorded assistant turn');
    } else {
      lines.push(`  // Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`);
    }

    lines.push('  {');
    lines.push(prependIndent(`const ${responseVar} = await client.messages.create(`, 2));

    const payload = (step.request ?? {}) as Record<string, JsonValue>;
    const payloadLines = formatJson(payload, 2).split('\n');
    payloadLines.forEach((line) => lines.push(prependIndent(line, 3)));
    lines.push(prependIndent(');', 2));

    if (!singleStep) {
      lines.push(`    console.log('assistant turn ${stepNumber}');`);
    }
    lines.push(`    console.log(JSON.stringify(${responseVar}, null, 2));`);

    if (step.warnings && step.warnings.length > 0) {
      step.warnings.forEach((warning) => warnings.push(`[Step ${stepNumber}] ${warning}`));
    }

    lines.push('  }');
    if (index < transcript.steps.length - 1) {
      lines.push('');
    }
  });

  if (transcript.steps.length === 0) {
    lines.push('  // No assistant turns found in the transcript.');
  }

  lines.push('}');
  lines.push('');
  lines.push('run().catch((error) => {');
  lines.push('  console.error(error);');
  lines.push('  process.exit(1);');
  lines.push('});');

  const combinedWarnings = mergeWarnings(transcript.warnings, warnings);

  return {
    label: 'Anthropic Messages (TypeScript SDK)',
    language: 'typescript',
    code: lines.join('\n'),
    warnings: combinedWarnings,
  };
}
