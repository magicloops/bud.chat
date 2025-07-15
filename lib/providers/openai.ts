// OpenAI provider mapper for event-based messages

import { Event, Segment, EventLog, createTextEvent, createToolCallEvent, createToolResultEvent, createMixedEvent } from '@/lib/types/events';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamDelta {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

/**
 * Convert events to OpenAI message format
 */
export function eventsToOpenAIMessages(events: Event[]): OpenAIMessage[] {
  const eventLog = new EventLog(events);
  return eventLog.toProviderMessages('openai') as OpenAIMessage[];
}

/**
 * Convert OpenAI response to events
 */
export function openaiResponseToEvents(response: OpenAIResponse): Event[] {
  const events: Event[] = [];
  
  for (const choice of response.choices) {
    const message = choice.message;
    const segments: Segment[] = [];
    
    // Add text content
    if (message.content) {
      segments.push({ type: 'text', text: message.content });
    }
    
    // Add tool calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
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
  }
  
  return events;
}

/**
 * Convert OpenAI streaming delta to event updates
 */
export function openaiStreamDeltaToEvent(
  delta: OpenAIStreamDelta,
  currentEvent: Event | null,
  activeToolCalls: Map<number, { id?: string; name?: string; args?: string }> = new Map()
): { event: Event | null; isComplete: boolean; toolCalls: Map<number, any> } {
  for (const choice of delta.choices) {
    if (choice.finish_reason) {
      // Message is complete
      if (currentEvent) {
        // Finalize any pending tool calls
        for (const [index, toolCall] of activeToolCalls.entries()) {
          if (toolCall.id && toolCall.name) {
            try {
              const args = JSON.parse(toolCall.args || '{}');
              currentEvent.segments.push({
                type: 'tool_call',
                id: toolCall.id,
                name: toolCall.name,
                args
              });
            } catch (e) {
              console.error('Failed to parse tool call arguments:', e);
            }
          }
        }
      }
      return { event: currentEvent, isComplete: true, toolCalls: activeToolCalls };
    }
    
    const messageDelta = choice.delta;
    
    if (messageDelta.role === 'assistant' && !currentEvent) {
      // Start new assistant message
      currentEvent = createMixedEvent('assistant', []);
    }
    
    if (!currentEvent) {
      return { event: currentEvent, isComplete: false, toolCalls: activeToolCalls };
    }
    
    // Handle text content
    if (messageDelta.content) {
      // Find or create text segment
      let textSegment = currentEvent.segments.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
      if (!textSegment) {
        textSegment = { type: 'text', text: '' };
        currentEvent.segments.push(textSegment);
      }
      textSegment.text += messageDelta.content;
    }
    
    // Handle tool calls
    if (messageDelta.tool_calls) {
      for (const toolCallDelta of messageDelta.tool_calls) {
        const index = toolCallDelta.index;
        let toolCall = activeToolCalls.get(index);
        
        if (!toolCall) {
          toolCall = {};
          activeToolCalls.set(index, toolCall);
        }
        
        if (toolCallDelta.id) {
          toolCall.id = toolCallDelta.id;
        }
        
        if (toolCallDelta.function?.name) {
          toolCall.name = toolCallDelta.function.name;
        }
        
        if (toolCallDelta.function?.arguments) {
          toolCall.args = (toolCall.args || '') + toolCallDelta.function.arguments;
        }
      }
    }
  }
  
  return { event: currentEvent, isComplete: false, toolCalls: activeToolCalls };
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

/**
 * Convert tool result to OpenAI tool message format
 */
export function toolResultToOpenAIMessage(toolCallId: string, result: any): OpenAIMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: typeof result === 'string' ? result : JSON.stringify(result)
  };
}