import { Segment } from '@budchat/events';

export type StepType = 'reasoning_part' | 'web_search' | 'code_interpreter' | 'mcp_call';

export interface StepBase {
  key: string;
  type: StepType;
  output_index: number;
  sequence_number: number;
  started_at?: number;
  completed_at?: number;
}

export interface ReasoningPartStep extends StepBase {
  type: 'reasoning_part';
  item_id: string;
  summary_index: number;
  text: string;
}

export interface WebSearchStep extends StepBase {
  type: 'web_search';
  item_id: string;
  status: 'in_progress' | 'searching' | 'completed' | 'failed';
}

export interface CodeInterpreterStep extends StepBase {
  type: 'code_interpreter';
  item_id: string;
  status: 'in_progress' | 'interpreting' | 'completed' | 'failed';
  code?: string;
}

export interface MCPCallStep extends StepBase {
  type: 'mcp_call';
  tool_id: string;
  name?: string;
  args?: object;
  output?: object;
  error?: string;
}

export type Step = ReasoningPartStep | WebSearchStep | CodeInterpreterStep | MCPCallStep;

export function hasAnyStepWorthySegments(segments: Segment[]): boolean {
  return segments.some(s =>
    s.type === 'reasoning' || s.type === 'web_search_call' || s.type === 'code_interpreter_call' || s.type === 'tool_call'
  );
}
