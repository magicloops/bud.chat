import { Event, EventLog, Segment } from '../events';
import { ToolCallId, generateEventId, toEventId } from '../types/branded';

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

export function eventsToAnthropicMessages(events: Event[]): AnthropicMessage[] {
  const eventLog = new EventLog(events);
  return eventLog.toProviderMessages('anthropic') as AnthropicMessage[];
}

export function anthropicResponseToEvent(response: { content?: AnthropicContentBlock[]; id?: string; }): Event {
  const segments: Segment[] = [];
  const contentBlocks = Array.isArray(response.content) ? response.content : [];

  for (const block of contentBlocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      segments.push({ type: 'text', text: block.text } as Segment);
    }
    if (block.type === 'tool_use') {
      segments.push({
        type: 'tool_call',
        id: block.id as ToolCallId,
        name: block.name,
        args: block.input ?? {},
      } as Segment);
    }
    if (block.type === 'tool_result') {
      segments.push({
        type: 'tool_result',
        id: block.tool_use_id as ToolCallId,
        output: safeParse(block.content),
      } as Segment);
    }
  }

  return {
    id: response.id ? toEventId(response.id) : generateEventId(),
    role: 'assistant',
    segments,
    ts: Date.now(),
  };
}

function safeParse(value: string): Record<string, unknown> | string {
  if (typeof value !== 'string') return value as unknown as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : value;
  } catch {
    return value;
  }
}

export function eventToAnthropicContent(event: Event): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  for (const segment of event.segments || []) {
    if (segment.type === 'text') {
      blocks.push({ type: 'text', text: segment.text });
    } else if (segment.type === 'tool_call') {
      blocks.push({ type: 'tool_use', id: String(segment.id), name: segment.name, input: segment.args });
    } else if (segment.type === 'tool_result') {
      blocks.push({ type: 'tool_result', tool_use_id: String(segment.id), content: JSON.stringify(segment.output ?? {}) });
    }
  }
  return blocks;
}
