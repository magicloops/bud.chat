// Unified event conversion utilities
import { Event, Segment, EventLog, ToolCall, ToolResult } from '@/lib/types/events';
import { ToolCallId } from '@/lib/types/branded';
// import { generateToolCallId } from '@/lib/types/branded'; // Not currently used
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export type Provider = 'openai' | 'anthropic';
export type ProviderMessage = OpenAI.ChatCompletionMessageParam | Anthropic.MessageParam;

/**
 * Unified EventConverter for consistent format transformations
 */
export class EventConverter {
  /**
   * Convert events to provider-specific message format
   */
  static toProviderFormat(events: Event[], provider: Provider): ProviderMessage[] {
    const eventLog = new EventLog(events);
    return eventLog.toProviderMessages(provider) as ProviderMessage[];
  }
  
  /**
   * Convert provider messages back to events
   */
  static fromProviderFormat(messages: ProviderMessage[], provider: Provider): Event[] {
    if (provider === 'anthropic') {
      return this.fromAnthropicMessages(messages as Anthropic.MessageParam[]);
    } else {
      return this.fromOpenAIMessages(messages as OpenAI.ChatCompletionMessageParam[]);
    }
  }
  
  /**
   * Merge adjacent text segments for cleaner output
   */
  static mergeSegments(segments: Segment[]): Segment[] {
    if (segments.length === 0) return segments;
    
    const merged: Segment[] = [];
    let currentText = '';
    
    for (const segment of segments) {
      if (segment.type === 'text') {
        currentText += segment.text;
      } else {
        // Flush any accumulated text
        if (currentText) {
          merged.push({ type: 'text', text: currentText });
          currentText = '';
        }
        merged.push(segment);
      }
    }
    
    // Don't forget the last text segment
    if (currentText) {
      merged.push({ type: 'text', text: currentText });
    }
    
    return merged;
  }
  
  /**
   * Extract system message from events
   */
  static extractSystemMessage(events: Event[]): string | null {
    const firstEvent = events[0];
    if (!firstEvent || firstEvent.role !== 'system') return null;
    
    const textSegments = firstEvent.segments
      .filter(s => s.type === 'text')
      .map(s => (s as { type: 'text'; text: string }).text);
    
    return textSegments.length > 0 ? textSegments.join('\n') : null;
  }
  
  /**
   * Extract tool calls from an event
   */
  static extractToolCalls(event: Event): ToolCall[] {
    return event.segments
      .filter(s => s.type === 'tool_call')
      .map(s => {
        const toolCall = s as Extract<Segment, { type: 'tool_call' }>;
        return {
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args
        };
      });
  }
  
  /**
   * Extract tool results from an event
   */
  static extractToolResults(event: Event): ToolResult[] {
    return event.segments
      .filter(s => s.type === 'tool_result')
      .map(s => {
        const toolResult = s as Extract<Segment, { type: 'tool_result' }>;
        return {
          id: toolResult.id,
          output: toolResult.output,
          error: toolResult.error
        };
      });
  }
  
  /**
   * Find unresolved tool calls across all events
   */
  static findUnresolvedToolCalls(events: Event[]): ToolCall[] {
    const eventLog = new EventLog(events);
    return eventLog.getUnresolvedToolCalls();
  }
  
  /**
   * Validate event structure
   */
  static validateEvent(event: Event): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!event.id) errors.push('Event must have an ID');
    if (!event.role) errors.push('Event must have a role');
    if (!Array.isArray(event.segments)) errors.push('Event segments must be an array');
    if (!event.ts || typeof event.ts !== 'number') errors.push('Event must have a numeric timestamp');
    
    // Validate segments
    for (const segment of event.segments || []) {
      if (!segment.type) {
        errors.push('All segments must have a type');
        continue;
      }
      
      switch (segment.type) {
        case 'text':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (typeof (segment as any).text !== 'string') {
            errors.push('Text segments must have a string text property');
          }
          break;
          
        case 'tool_call':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolCall = segment as any;
          if (!toolCall.id || !toolCall.name || !toolCall.args) {
            errors.push('Tool call segments must have id, name, and args');
          }
          break;
          
        case 'tool_result':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolResult = segment as any;
          if (!toolResult.id || toolResult.output === undefined) {
            errors.push('Tool result segments must have id and output');
          }
          break;
          
        case 'reasoning':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reasoning = segment as any;
          if (!reasoning.id || typeof reasoning.output_index !== 'number' || !Array.isArray(reasoning.parts)) {
            errors.push('Reasoning segments must have id, output_index, and parts array');
          }
          break;
          
        default:
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          errors.push(`Unknown segment type: ${(segment as any).type}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  // Private conversion methods
  
  private static fromAnthropicMessages(messages: Anthropic.MessageParam[]): Event[] {
    const events: Event[] = [];
    
    for (const message of messages) {
      const segments: Segment[] = [];
      
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'text') {
            segments.push({ type: 'text', text: content.text });
          } else if (content.type === 'tool_use') {
            segments.push({
              type: 'tool_call',
              id: content.id as ToolCallId,
              name: content.name,
              args: content.input as Record<string, unknown>
            });
          } else if (content.type === 'tool_result') {
            // Tool results are usually in separate messages
            segments.push({
              type: 'tool_result',
              id: content.tool_use_id as ToolCallId,
              output: JSON.parse(content.content as string)
            });
          }
        }
      } else if (typeof message.content === 'string') {
        segments.push({ type: 'text', text: message.content });
      }
      
      if (segments.length > 0) {
        events.push({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: crypto.randomUUID() as any, // Will be replaced with generateEventId()
          role: message.role as Event['role'],
          segments,
          ts: Date.now()
        });
      }
    }
    
    return events;
  }
  
  private static fromOpenAIMessages(messages: OpenAI.ChatCompletionMessageParam[]): Event[] {
    const events: Event[] = [];
    
    for (const message of messages) {
      const segments: Segment[] = [];
      const role = message.role as Event['role'];
      
      // Handle different message types
      if ('content' in message && message.content) {
        if (typeof message.content === 'string') {
          segments.push({ type: 'text', text: message.content });
        } else if (Array.isArray(message.content)) {
          // Handle multi-modal content
          for (const part of message.content) {
            if (part.type === 'text') {
              segments.push({ type: 'text', text: part.text });
            }
            // Handle other content types as needed
          }
        }
      }
      
      // Handle tool calls (assistant messages)
      if ('tool_calls' in message && message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            segments.push({
              type: 'tool_call',
              id: toolCall.id as ToolCallId,
              name: toolCall.function.name,
              args
            });
          } catch (e) {
            console.error('Failed to parse tool call arguments:', e);
          }
        }
      }
      
      // Handle tool results (tool messages)
      if (role === 'tool' && 'tool_call_id' in message) {
        segments.push({
          type: 'tool_result',
          id: message.tool_call_id as ToolCallId,
          output: JSON.parse(message.content as string)
        });
      }
      
      if (segments.length > 0) {
        events.push({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: crypto.randomUUID() as any, // Will be replaced with generateEventId()
          role,
          segments,
          ts: Date.now()
        });
      }
    }
    
    return events;
  }
}