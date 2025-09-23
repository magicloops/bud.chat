import type { JsonValue } from '../types';

const TS_INDENT = '  ';
const PY_INDENT = '    ';

export function formatJson(value: JsonValue, indentLevel = 0, indent: string = TS_INDENT): string {
  const pad = (level: number) => indent.repeat(level);

  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${pad(indentLevel + 1)}${formatJson(item, indentLevel + 1, indent)}`);
    return `[
${items.join('\n')}
${pad(indentLevel)}]`;
  }

  const entries = Object.entries(value as Record<string, JsonValue>);
  if (entries.length === 0) return '{}';
  const lines: string[] = [];
  for (const [key, val] of entries) {
    if (val === undefined) continue;
    lines.push(`${pad(indentLevel + 1)}${JSON.stringify(key)}: ${formatJson(val, indentLevel + 1, indent)}`);
  }
  return `{
${lines.join('\n')}
${pad(indentLevel)}}`;
}

export function formatJsonPython(value: JsonValue, indentLevel = 0): string {
  if (value === null) return 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const pad = (level: number) => PY_INDENT.repeat(level);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => `${pad(indentLevel + 1)}${formatJsonPython(item, indentLevel + 1)}`);
    return `[
${items.join('\n')}
${pad(indentLevel)}]`;
  }

  const entries = Object.entries(value as Record<string, JsonValue>);
  if (entries.length === 0) return '{}';
  const lines: string[] = [];
  for (const [key, val] of entries) {
    if (val === undefined) continue;
    lines.push(`${pad(indentLevel + 1)}${JSON.stringify(key)}: ${formatJsonPython(val, indentLevel + 1)}`);
  }
  return `{
${lines.join('\n')}
${pad(indentLevel)}}`;
}

export function prependIndent(code: string, indentLevel: number, indent: string = TS_INDENT): string {
  const prefix = indent.repeat(indentLevel);
  return code
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join('\n');
}

export const prependIndentPython = (code: string, indentLevel: number) => prependIndent(code, indentLevel, PY_INDENT);

export function mergeWarnings(...warningGroups: Array<string[] | undefined>): string[] | undefined {
  const combined = warningGroups.flatMap((group) => group ?? []);
  return combined.length > 0 ? Array.from(new Set(combined)) : undefined;
}
