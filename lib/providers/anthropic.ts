// Anthropic provider mapper for event-based messages

import { Event, Segment, EventLog, createTextEvent, createToolCallEvent, createToolResultEvent, createMixedEvent } from '@/lib/types/events';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContent[];
}

export interface AnthropicContent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContent[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamDelta {
  type: 'content_block_delta' | 'content_block_start' | 'content_block_stop' | 'message_delta' | 'message_start' | 'message_stop';
  index?: number;
  delta?: {
    type?: 'text_delta' | 'input_json_delta';
    text?: string;
    partial_json?: string;
  };
  content_block?: {
    type: 'text' | 'tool_use';
    id?: string;
    name?: string;
    input?: any;
    text?: string;
  };
}

/**
 * Convert events to Anthropic message format
 */
export function eventsToAnthropicMessages(events: Event[]): { 
  messages: AnthropicMessage[], 
  system: string 
} {
  const eventLog = new EventLog(events);
  const messages = eventLog.toProviderMessages('anthropic') as AnthropicMessage[];
  const system = eventLog.getSystemParameter();
  
  return { messages, system };
}

/**
 * Convert Anthropic response to events
 */
export function anthropicResponseToEvents(response: AnthropicResponse): Event[] {
  const events: Event[] = [];
  const segments: Segment[] = [];
  
  for (const block of response.content) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          segments.push({ type: 'text', text: block.text });
        }
        break;
      case 'tool_use':
        if (block.id && block.name) {
          segments.push({ 
            type: 'tool_call', 
            id: block.id, 
            name: block.name, 
            args: block.input || {} 
          });
        }
        break;
    }
  }
  
  if (segments.length > 0) {
    events.push(createMixedEvent('assistant', segments));
  }
  
  return events;
}

/**
 * Convert Anthropic streaming delta to event updates
 */
export function anthropicStreamDeltaToEvent(
  delta: AnthropicStreamDelta,
  currentEvent: Event | null
): { event: Event | null; isComplete: boolean } {
  switch (delta.type) {
    case 'message_start':
      // Start new assistant message
      return {
        event: createMixedEvent('assistant', []),
        isComplete: false
      };
      
    case 'content_block_start':
      if (!currentEvent) {
        currentEvent = createMixedEvent('assistant', []);
      }
      
      if (delta.content_block?.type === 'text') {
        // Start text block
        currentEvent.segments.push({ type: 'text', text: '' });
      } else if (delta.content_block?.type === 'tool_use') {
        // Start tool use block
        if (delta.content_block.id && delta.content_block.name) {
          currentEvent.segments.push({
            type: 'tool_call',
            id: delta.content_block.id,
            name: delta.content_block.name,
            args: {}
          });
        }
      }
      
      return { event: currentEvent, isComplete: false };
      
    case 'content_block_delta':
      if (!currentEvent || delta.index === undefined) {
        return { event: currentEvent, isComplete: false };
      }
      
      const segment = currentEvent.segments[delta.index];
      if (!segment) {
        return { event: currentEvent, isComplete: false };
      }
      
      if (delta.delta?.type === 'text_delta' && segment.type === 'text') {
        // Update text segment
        segment.text += delta.delta.text || '';
      } else if (delta.delta?.type === 'input_json_delta' && segment.type === 'tool_call') {
        // Update tool call args - we need to accumulate the JSON
        try {
          const partialJson = delta.delta.partial_json || '';
          console.log('🔧 Accumulating tool call JSON:', { 
            toolId: segment.id, 
            toolName: segment.name, 
            partialJson: partialJson.substring(0, 100) + (partialJson.length > 100 ? '...' : '')
          });
          // For now, we'll store the partial JSON and parse it on completion
          if (!segment.args) {
            segment.args = {};
          }
          (segment.args as any)._partial_json = ((segment.args as any)._partial_json || '') + partialJson;
        } catch (e) {
          console.error('Failed to parse tool call JSON delta:', e);
        }
      }
      
      return { event: currentEvent, isComplete: false };
      
    case 'content_block_stop':
      if (!currentEvent || delta.index === undefined) {
        return { event: currentEvent, isComplete: false };
      }
      
      const completedSegment = currentEvent.segments[delta.index];
      if (completedSegment?.type === 'tool_call') {
        // Parse the accumulated JSON
        try {
          const partialJson = (completedSegment.args as any)._partial_json;
          console.log('🔧 Finalizing tool call JSON:', { 
            toolId: completedSegment.id, 
            toolName: completedSegment.name, 
            partialJson: partialJson?.substring(0, 200) + (partialJson?.length > 200 ? '...' : ''),
            hasPartialJson: !!partialJson
          });
          if (partialJson) {
            completedSegment.args = JSON.parse(partialJson);
            console.log('✅ Parsed tool call args:', completedSegment.args);
          } else {
            console.log('⚠️ No partial JSON found for tool call');
          }
        } catch (e) {
          console.error('Failed to parse final tool call JSON:', e);
          completedSegment.args = {};
        }
      }
      
      return { event: currentEvent, isComplete: false };
      
    case 'message_stop':
      return { event: currentEvent, isComplete: true };
      
    default:
      return { event: currentEvent, isComplete: false };
  }
}

/**
 * Create tool result event from MCP response
 */
export function createToolResultFromMCPResponse(
  toolCallId: string,
  mcpResponse: any,
  error?: string
): Event {
  const output = error ? { error } : mcpResponse;
  return createToolResultEvent(toolCallId, output);
}

/**
 * Extract tool calls from events that need MCP execution
 */
export function extractPendingToolCalls(events: Event[]): Array<{
  id: string;
  name: string;
  args: object;
}> {
  const eventLog = new EventLog(events);
  return eventLog.getUnresolvedToolCalls();
}

/**
 * Convert legacy message format to events (for migration)
 */
export function legacyMessageToEvents(message: any): Event[] {
  const events: Event[] = [];
  
  if (message.role === 'system') {
    events.push(createTextEvent('system', message.content));
  } else if (message.role === 'user') {
    events.push(createTextEvent('user', message.content));
  } else if (message.role === 'assistant') {
    const segments: Segment[] = [];
    
    // Add text content
    if (message.content && typeof message.content === 'string') {
      segments.push({ type: 'text', text: message.content });
    }
    
    // Add tool calls from json_meta
    if (message.json_meta?.tool_calls) {
      for (const toolCall of message.json_meta.tool_calls) {
        segments.push({
          type: 'tool_call',
          id: toolCall.id,
          name: toolCall.function.name,
          args: JSON.parse(toolCall.function.arguments || '{}')
        });
      }
    }
    
    if (segments.length > 0) {
      events.push(createMixedEvent('assistant', segments));
    }
  } else if (message.role === 'tool' || message.json_meta?.is_tool_result) {
    // Tool result message
    const toolCallId = message.json_meta?.tool_call_id;
    if (toolCallId) {
      events.push(createToolResultEvent(toolCallId, { content: message.content }));
    }
  }
  
  return events;
}