import { Event, EventLog, Segment } from '../events';
import { ToolCallId, generateEventId } from '../types/branded';

export interface OpenAIChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_calls?: OpenAIChatToolCall[];
  tool_call_id?: string;
}

export type OpenAIChatAssistantMessage = OpenAIChatMessage & { role: 'assistant' };

export function eventsToOpenAIChatMessages(events: Event[]): OpenAIChatMessage[] {
  const eventLog = new EventLog(events);
  return eventLog.toProviderMessages('openai') as OpenAIChatMessage[];
}

export function openAIChatMessageToEvent(message: OpenAIChatMessage): Event {
  const segments: Segment[] = [];

  if (message.role !== 'tool' && typeof message.content === 'string' && message.content.length > 0) {
    segments.push({ type: 'text', text: message.content } as Segment);
  }

  if (Array.isArray((message as OpenAIChatAssistantMessage).tool_calls)) {
    for (const toolCall of (message as OpenAIChatAssistantMessage).tool_calls || []) {
      segments.push({
        type: 'tool_call',
        id: toolCall.id as ToolCallId,
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments || '{}'),
      } as Segment);
    }
  }

  if (message.role === 'tool' && message.tool_call_id) {
    let parsed: unknown;
    try {
      parsed = message.content ? JSON.parse(message.content) : {};
    } catch {
      parsed = message.content ?? {};
    }
    segments.push({
      type: 'tool_result',
      id: message.tool_call_id as ToolCallId,
      output: parsed as Record<string, unknown>,
    } as Segment);
  }

  return {
    id: generateEventId(),
    role: message.role,
    segments,
    ts: Date.now(),
  };
}
