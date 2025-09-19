import { Event, Segment } from '../events';
import { ToolCallId } from '../types/branded';

export interface OpenAIResponsesInputMessagePart {
  type: string;
  text: string;
}

export interface OpenAIResponsesInputItem {
  id?: string;
  type: 'message' | 'text' | 'mcp_call' | 'reasoning';
  role?: 'system' | 'user' | 'assistant';
  content?: OpenAIResponsesInputMessagePart[];
  text?: string;
  name?: string;
  arguments?: string;
  server_label?: string;
  output?: string;
  error?: string;
  summary?: OpenAIResponsesInputMessagePart[];
}

export interface RemoteServerDescriptor {
  server_label: string;
}

export function eventsToResponsesInputItems(
  events: Event[],
  options?: { remoteServers?: RemoteServerDescriptor[] },
): OpenAIResponsesInputItem[] {
  const items: OpenAIResponsesInputItem[] = [];
  let messageIndex = 0;
  const genId = () => `msg_${messageIndex++}`;
  const defaultServer = options?.remoteServers && options.remoteServers.length > 0
    ? options.remoteServers[0].server_label
    : undefined;

  for (const event of events) {
    if (event.role === 'system' || event.role === 'user') {
      const texts = (event.segments || []).filter(
        (segment): segment is Extract<typeof segment, { type: 'text'; text: string }> => segment.type === 'text',
      );
      const content = texts.map((segment) => ({ type: 'input_text', text: segment.text || '' }));
      items.push({ id: genId(), type: 'message', role: event.role, content });
      continue;
    }

    if (event.role === 'assistant') {
      for (const segment of event.segments || []) {
        if (segment.type === 'reasoning') {
          const parts = (segment as any).parts as Array<{ text: string }> | undefined;
          const summary = parts?.map((part) => ({ type: 'summary_text', text: part.text || '' })) || [];
          items.push({ id: (segment as any).id, type: 'reasoning', summary });
        } else if (segment.type === 'text') {
          items.push({
            id: (segment as any).id || genId(),
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: segment.text || '' }],
          });
        } else if (segment.type === 'tool_call') {
          items.push({
            id: segment.id,
            type: 'mcp_call',
            name: segment.name,
            arguments: JSON.stringify(segment.args ?? {}),
            server_label: (segment as any).server_label || defaultServer,
          });
        }
      }
      continue;
    }

    if (event.role === 'tool') {
      const seg = event.segments?.[0];
      if (seg && seg.type === 'tool_result') {
        items.push({
          id: seg.id,
          type: 'mcp_call',
          output: JSON.stringify(seg.output ?? {}),
          error: seg.error ?? undefined,
        });
      }
      continue;
    }
  }

  return items;
}

export function responsesPayloadToEvent(response: any): Event {
  const segments: Segment[] = [];

  if (Array.isArray(response.output)) {
    for (const output of response.output) {
      if (output?.type === 'text' && output.content) {
        segments.push({ type: 'text', text: output.content } as Segment);
      } else if (output?.type === 'mcp_call') {
        const toolCallId = (output.id || `${response.id}_tool_${segments.length}`) as string;
        segments.push({
          type: 'tool_call',
          id: toolCallId as ToolCallId,
          name: output.name,
          args: output.arguments ? JSON.parse(output.arguments) : {},
          server_label: output.server_label,
        } as Segment);
      }
    }
  }

  if (response.reasoning_content) {
    segments.unshift({
      type: 'reasoning',
      id: response.id,
      output_index: 0,
      sequence_number: 0,
      parts: [{
        summary_index: 0,
        type: 'summary_text',
        text: response.reasoning_content,
        sequence_number: 0,
        is_complete: true,
        created_at: Date.now(),
      }],
    } as Segment);
  }

  return {
    id: response.id,
    role: 'assistant',
    segments,
    ts: Date.now(),
  } as Event;
}
