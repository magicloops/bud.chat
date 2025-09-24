import type { ProviderTranscript, GeneratorOptions, GeneratorResult } from '../types';
import { formatJson, prependIndent, mergeWarnings } from './utils';

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export function generateOpenAIChatHttp(
  transcript: ProviderTranscript,
  _options?: GeneratorOptions,
): GeneratorResult {
  const warnings: string[] = [];

  if (transcript.provider !== 'openai-chat') {
    warnings.push(`Expected OpenAI Chat transcript, received ${transcript.provider}.`);
  }

  const lines: string[] = [];
  lines.push("import fetch from 'node-fetch';");
  lines.push('');
  lines.push('const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;');
  lines.push('');
  lines.push('async function run() {');
  lines.push('  const headers = {');
  lines.push("    'Content-Type': 'application/json',");
  lines.push("    Authorization: `Bearer ${OPENAI_API_KEY}`,");
  lines.push('  };');
  lines.push(`  const endpoint = '${CHAT_ENDPOINT}';`);
  lines.push('');

  const singleStep = transcript.steps.length === 1;

  transcript.steps.forEach((step, index) => {
    const stepNumber = index + 1;
    if (singleStep) {
      lines.push('  // Replay the recorded assistant turn');
    } else {
      lines.push(`  // Step ${stepNumber}: Recreate assistant turn ${step.assistantEventId}`);
    }
    lines.push('  {');
    lines.push(prependIndent('const body = ' + formatJson(step.request, 3) + ';', 2));
    lines.push('    const response = await fetch(endpoint, {');
    lines.push('      method: "POST",');
    lines.push('      headers,');
    lines.push('      body: JSON.stringify(body),');
    lines.push('    });');
    lines.push('    const json = await response.json();');
    lines.push('    if (!response.ok) {');
    lines.push('      throw new Error(`Request failed: ${response.status} ${response.statusText}`);');
    lines.push('    }');
    if (!singleStep) {
      lines.push(`    console.log('assistant turn ${stepNumber}');`);
    }
    lines.push('    console.log(JSON.stringify(json, null, 2));');
    lines.push('    // TODO: Persist tool call results between steps if needed.');
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
    label: 'OpenAI Chat (TypeScript HTTP)',
    language: 'typescript',
    code: lines.join('\n'),
    warnings: combinedWarnings,
  };
}
