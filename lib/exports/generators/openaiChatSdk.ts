import type { ProviderTranscript, GeneratorOptions, GeneratorResult, JsonValue } from '../types';
import { formatJson, prependIndent, mergeWarnings } from './utils';

export function generateOpenAIChatSdk(
  transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  const warnings: string[] = [];

  if (transcript.provider !== 'openai-chat') {
    warnings.push(`Expected OpenAI Chat transcript, received ${transcript.provider}.`);
  }

  const lines: string[] = [];
  lines.push("import OpenAI from 'openai';");
  lines.push('');
  lines.push('const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });');
  lines.push('');
  lines.push('async function run() {');

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    lines.push(`  // Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`);
    lines.push(
      prependIndent(
        `const response${stepNumber} = await client.chat.completions.create(${formatJson(
          step.request,
          2,
        )});`,
        1,
      ),
    );
    lines.push(`  console.log('assistant ${stepNumber}:', response${stepNumber}.choices[0].message);`);

    const responseObject = (step.response as Record<string, unknown>) ?? null;
    const choices = (responseObject?.choices as Array<Record<string, unknown>>) ?? [];
    const firstChoice = choices[0] ?? {};
    const message = (firstChoice.message as Record<string, unknown>) ?? {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];

    if (toolCalls.length > 0) {
      lines.push(
        `  // TODO: Handle tool calls from response${stepNumber}.choices[0].message.tool_calls before sending new tool results.`,
      );
    }

    if (step.warnings && step.warnings.length > 0) {
      step.warnings.forEach((warning) => warnings.push(`[Step ${stepNumber}] ${warning}`));
    }

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
    label: 'OpenAI Chat (TypeScript SDK)',
    language: 'typescript',
    code: lines.join('\n'),
    warnings: combinedWarnings,
  };
}
