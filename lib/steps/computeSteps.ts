import { Event, Segment } from '@/lib/types/events';
import { Step, ReasoningPartStep, WebSearchStep, CodeInterpreterStep, MCPCallStep } from './types';

function safeSeq(n: number | undefined): number {
  return typeof n === 'number' ? n : Number.POSITIVE_INFINITY;
}

function safeOut(n: number | undefined): number {
  return typeof n === 'number' ? n : Number.POSITIVE_INFINITY;
}

export function computeStepsForEvent(event: Event): Step[] {
  const steps: Step[] = [];

  for (const seg of event.segments) {
    switch (seg.type) {
      case 'reasoning': {
        const baseOut = safeOut(seg.output_index);
        const baseSeq = safeSeq(seg.sequence_number);
        const parts = [...(seg.parts || [])].sort((a, b) => a.summary_index - b.summary_index);
        for (const part of parts) {
          const step: ReasoningPartStep = {
            key: `${seg.id}:${part.summary_index}`,
            type: 'reasoning_part',
            item_id: seg.id,
            summary_index: part.summary_index,
            text: part.text,
            output_index: baseOut,
            sequence_number: baseSeq,
          };
          steps.push(step);
        }
        break;
      }
      case 'web_search_call': {
        const step: WebSearchStep = {
          key: `web:${seg.id}`,
          type: 'web_search',
          item_id: seg.id,
          status: seg.status,
          output_index: safeOut(seg.output_index),
          sequence_number: safeSeq(seg.sequence_number),
        };
        steps.push(step);
        break;
      }
      case 'code_interpreter_call': {
        const step: CodeInterpreterStep = {
          key: `code:${seg.id}`,
          type: 'code_interpreter',
          item_id: seg.id,
          status: seg.status,
          code: seg.code,
          output_index: safeOut(seg.output_index),
          sequence_number: safeSeq(seg.sequence_number),
        };
        steps.push(step);
        break;
      }
      case 'tool_call': {
        const step: MCPCallStep = {
          key: `mcp:${seg.id}`,
          type: 'mcp_call',
          tool_id: seg.id,
          name: seg.name,
          args: seg.args,
          output: seg.output,
          error: seg.error,
          output_index: safeOut(seg.output_index),
          sequence_number: safeSeq(seg.sequence_number),
        };
        steps.push(step);
        break;
      }
      default:
        break;
    }
  }

  steps.sort((a, b) => {
    if (a.output_index !== b.output_index) return a.output_index - b.output_index;
    if (a.sequence_number !== b.sequence_number) return a.sequence_number - b.sequence_number;
    return a.key.localeCompare(b.key);
  });

  return steps;
}
