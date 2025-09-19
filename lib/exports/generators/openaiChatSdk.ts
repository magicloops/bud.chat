import type { ProviderTranscript, GeneratorOptions, GeneratorResult, JsonValue } from '../types';

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
      `  const response${stepNumber} = await client.chat.completions.create(${renderJson(step.request, 2)});`,
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

  return {
    label: 'OpenAI Chat (TypeScript SDK)',
    language: 'typescript',
    code: lines.join('\n'),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function renderJson(value: JsonValue, indentLevel = 0): string {
  const indent = '  '.repeat(indentLevel);

  if (value === null) {
    return 'null';
  }

  const valueType = typeof value;
  if (valueType === 'string') {
    return `'${escapeString(value as string)}'`;
  }
  if (valueType === 'number' || valueType === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const childIndent = '  '.repeat(indentLevel + 1);
    const parts = value.map((item) => `${childIndent}${renderJson(item, indentLevel + 1)}`);
    return `[
${parts.join('\n')}
${indent}]`;
  }

  const entries = Object.entries(value as Record<string, JsonValue>);
  if (entries.length === 0) return '{}';

  const childIndent = '  '.repeat(indentLevel + 1);
  const props: string[] = [];
  for (const [key, val] of entries) {
    if (val === undefined) continue;
    props.push(`${childIndent}${JSON.stringify(key)}: ${renderJson(val, indentLevel + 1)}`);
  }

  return `{
${props.join('\n')}
${indent}}`;
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
