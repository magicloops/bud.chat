import type { JsonValue } from '../types';

const TS_INDENT = '  ';
const PY_INDENT = '    ';

const padTs = (level: number, indent: string) => indent.repeat(level);
const padPy = (level: number) => PY_INDENT.repeat(level);

export function formatJson(value: JsonValue, indentLevel = 0, indent: string = TS_INDENT): string {
  const json = JSON.stringify(value, null, indent) ?? 'null';
  if (indentLevel <= 0) return json;
  const prefix = padTs(indentLevel, indent);
  return json
    .split('\n')
    .map((line) => (line.length > 0 ? `${prefix}${line}` : prefix))
    .join('\n');
}

function formatPythonValueLines(value: JsonValue, indentLevel: number): string[] {
  if (value === null) return [`${padPy(indentLevel)}None`];
  if (typeof value === 'string') return [`${padPy(indentLevel)}${JSON.stringify(value)}`];
  if (typeof value === 'number') return [`${padPy(indentLevel)}${String(value)}`];
  if (typeof value === 'boolean') return [`${padPy(indentLevel)}${value ? 'True' : 'False'}`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${padPy(indentLevel)}[]`];
    const lines: string[] = [`${padPy(indentLevel)}[`];
    value.forEach((item, index) => {
      const itemLines = formatPythonValueLines(item, indentLevel + 1);
      if (itemLines.length === 0) return;
      const last = itemLines.length - 1;
      itemLines[last] = `${itemLines[last]}${index < value.length - 1 ? ',' : ''}`;
      lines.push(...itemLines);
    });
    lines.push(`${padPy(indentLevel)}]`);
    return lines;
  }

  const entries = Object.entries(value as Record<string, JsonValue>).filter(([, val]) => val !== undefined);
  if (entries.length === 0) return [`${padPy(indentLevel)}{}`];

  const lines: string[] = [`${padPy(indentLevel)}{`];
  entries.forEach(([key, val], index) => {
    const valueLines = formatPythonValueLines(val, indentLevel + 1);
    if (valueLines.length === 0) return;
    const needsComma = index < entries.length - 1;
    const [firstLine, ...rest] = valueLines;
    const firstValue = firstLine.trimStart();

    if (rest.length === 0) {
      lines.push(`${padPy(indentLevel + 1)}${JSON.stringify(key)}: ${firstValue}${needsComma ? ',' : ''}`);
    } else {
      lines.push(`${padPy(indentLevel + 1)}${JSON.stringify(key)}: ${firstValue}`);
      rest.forEach((line, idx) => {
        if (idx === rest.length - 1) {
          lines.push(`${line}${needsComma ? ',' : ''}`);
        } else {
          lines.push(line);
        }
      });
    }
  });
  lines.push(`${padPy(indentLevel)}}`);
  return lines;
}

export function formatJsonPython(value: JsonValue, indentLevel = 0): string {
  return formatPythonValueLines(value, indentLevel).join('\n');
}

export function formatPythonCallArguments(payload: Record<string, JsonValue>, indentLevel = 0): string[] {
  const entries = Object.entries(payload ?? {});
  if (entries.length === 0) return [];

  const lines: string[] = [];
  entries.forEach(([key, val]) => {
    const valueLines = formatPythonValueLines(val, indentLevel);
    if (valueLines.length === 0) return;
    const [firstLine, ...rest] = valueLines;
    if (rest.length === 0) {
      lines.push(`${padPy(indentLevel)}${key}=${firstLine.trimStart()},`);
    } else {
      lines.push(`${padPy(indentLevel)}${key}=${firstLine.trimStart()}`);
      rest.slice(0, -1).forEach((line) => lines.push(line));
      lines.push(`${rest[rest.length - 1]},`);
    }
  });
  return lines;
}

export function formatPythonAssignment(varName: string, value: JsonValue, indentLevel = 0): string[] {
  const valueLines = formatPythonValueLines(value, indentLevel);
  if (valueLines.length === 0) {
    return [`${padPy(indentLevel)}${varName} = None`];
  }
  const [firstLine, ...rest] = valueLines;
  const lines: string[] = [`${padPy(indentLevel)}${varName} = ${firstLine.trimStart()}`];
  if (rest.length > 0) {
    lines.push(...rest);
  }
  return lines;
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
