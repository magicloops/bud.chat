// Unified event conversion utilities
import { Event, Segment, EventLog, ToolCall, ToolResult } from './events';
import { ToolCallId } from './types/branded';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export type Provider = 'openai' | 'anthropic';
export type ProviderMessage = OpenAI.ChatCompletionMessageParam | Anthropic.MessageParam;

export class EventConverter {
  static toProviderFormat(events: Event[], provider: Provider): ProviderMessage[] {
    const eventLog = new EventLog(events);
    return eventLog.toProviderMessages(provider) as ProviderMessage[];
  }
  static fromProviderFormat(messages: ProviderMessage[], provider: Provider): Event[] {
    if (provider === 'anthropic') {
      return this.fromAnthropicMessages(messages as Anthropic.MessageParam[]);
    } else {
      return this.fromOpenAIMessages(messages as OpenAI.ChatCompletionMessageParam[]);
    }
  }
  static mergeSegments(segments: Segment[]): Segment[] {
    if (segments.length === 0) return segments;
    const merged: Segment[] = [];
    let currentText = '';
    for (const segment of segments) {
      if (segment.type === 'text') {
        currentText += segment.text;
      } else {
        if (currentText) { merged.push({ type: 'text', text: currentText }); currentText = ''; }
        merged.push(segment);
      }
    }
    if (currentText) merged.push({ type: 'text', text: currentText });
    return merged;
  }
  static extractSystemMessage(events: Event[]): string | null {
    const firstEvent = events[0];
    if (!firstEvent || firstEvent.role !== 'system') return null;
    const textSegments = firstEvent.segments.filter(s => s.type === 'text').map(s => (s as any).text);
    return textSegments.length > 0 ? textSegments.join('\n') : null;
  }
  static extractToolCalls(event: Event): ToolCall[] {
    return event.segments.filter(s => s.type === 'tool_call').map(s => ({ id: (s as any).id, name: (s as any).name, args: (s as any).args }));
  }
  static extractToolResults(event: Event): ToolResult[] {
    return event.segments.filter(s => s.type === 'tool_result').map(s => ({ id: (s as any).id, output: (s as any).output, error: (s as any).error }));
  }
  static findUnresolvedToolCalls(events: Event[]): ToolCall[] {
    const eventLog = new EventLog(events);
    return eventLog.getUnresolvedToolCalls();
  }
  static validateEvent(event: Event): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!event.id) errors.push('Event must have an ID');
    if (!event.role) errors.push('Event must have a role');
    if (!Array.isArray(event.segments)) errors.push('Event segments must be an array');
    if (!event.ts || typeof event.ts !== 'number') errors.push('Event must have a numeric timestamp');
    for (const segment of event.segments) {
      switch ((segment as any).type) {
        case 'text': if (typeof (segment as any).text !== 'string') errors.push('Text segment must have a text string'); break;
        case 'tool_call': if (!(segment as any).id || !(segment as any).name || typeof (segment as any).args !== 'object') errors.push('Tool call requires id, name, args'); break;
        case 'tool_result': if (!(segment as any).id || typeof (segment as any).output !== 'object') errors.push('Tool result requires id and output'); break;
        case 'reasoning': {
          const r = segment as any; if (!r.id || typeof r.output_index !== 'number' || !Array.isArray(r.parts)) errors.push('Reasoning requires id, output_index, parts');
          break;
        }
        default: errors.push(`Unknown segment type: ${(segment as any).type}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
  private static fromAnthropicMessages(messages: Anthropic.MessageParam[]): Event[] {
    const events: Event[] = [];
    for (const message of messages) {
      const segments: Segment[] = [];
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if ((content as any).type === 'text') {
            segments.push({ type: 'text', text: (content as any).text });
          } else if ((content as any).type === 'tool_use') {
            segments.push({ type: 'tool_call', id: (content as any).id as ToolCallId, name: (content as any).name, args: (content as any).input as Record<string, unknown> });
          } else if ((content as any).type === 'tool_result') {
            segments.push({ type: 'tool_result', id: (content as any).tool_use_id as ToolCallId, output: JSON.parse((content as any).content as string) });
          }
        }
      } else if (typeof (message as any).content === 'string') {
        segments.push({ type: 'text', text: (message as any).content });
      }
      if (segments.length > 0) {
        events.push({ id: crypto.randomUUID() as any, role: message.role as any, segments, ts: Date.now() });
      }
    }
    return events;
  }
  private static fromOpenAIMessages(messages: OpenAI.ChatCompletionMessageParam[]): Event[] {
    const events: Event[] = [];
    for (const message of messages) {
      const segments: Segment[] = [];
      const role = (message as any).role as any;
      if ('content' in message && (message as any).content) {
        if (typeof (message as any).content === 'string') {
          segments.push({ type: 'text', text: (message as any).content });
        } else if (Array.isArray((message as any).content)) {
          for (const part of (message as any).content) {
            if ((part as any).type === 'text') segments.push({ type: 'text', text: (part as any).text });
          }
        }
      }
      if ('tool_calls' in message && (message as any).tool_calls) {
        for (const toolCall of (message as any).tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            segments.push({ type: 'tool_call', id: toolCall.id as ToolCallId, name: toolCall.function.name, args });
          } catch (e) { console.error('Failed to parse tool call arguments:', e); }
        }
      }
      if (role === 'tool' && 'tool_call_id' in (message as any)) {
        segments.push({ type: 'tool_result', id: (message as any).tool_call_id as ToolCallId, output: JSON.parse((message as any).content as string) });
      }
      if (segments.length > 0) {
        events.push({ id: crypto.randomUUID() as any, role, segments, ts: Date.now() });
      }
    }
    return events;
  }
}

