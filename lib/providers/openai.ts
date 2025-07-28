// OpenAI provider mapper for event-based messages

import { Event, Segment, EventLog, createTextEvent, createToolResultEvent, createMixedEvent } from '@/lib/types/events';
import type OpenAI from 'openai';
// createToolCallEvent currently unused

// Use the actual SDK types instead of custom interfaces
type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
// OpenAIToolCall currently unused

// Interface for provider messages from EventLog
interface ProviderMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
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

// Use the actual SDK stream event type
type OpenAIStreamDelta = OpenAI.Chat.Completions.ChatCompletionChunk;

/**
 * Convert events to OpenAI message format
 */
export function eventsToOpenAIMessages(events: Event[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const eventLog = new EventLog(events);
  const providerMessages = eventLog.toProviderMessages('openai');
  
  // Convert to proper SDK format
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (providerMessages as ProviderMessage[]).map((msg: ProviderMessage) => {
    return {
      role: msg.role,
      content: msg.content,
      ...(msg.tool_calls && { tool_calls: msg.tool_calls }),
      ...(msg.tool_call_id && { tool_call_id: msg.tool_call_id })
    } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  });
  
  return messages;
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
      const textContent = typeof message.content === 'string' ? message.content : 
                         Array.isArray(message.content) ? message.content.map(part => 
                           typeof part === 'string' ? part : 'text' in part ? part.text : ''
                         ).join('') : '';
      if (textContent) {
        segments.push({ type: 'text', text: textContent });
      }
    }
    
    // Add tool calls (only assistant messages have tool_calls)
    if ('tool_calls' in message && message.tool_calls) {
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
): { event: Event | null; isComplete: boolean; toolCalls: Map<number, { id?: string; name?: string; args?: string }> } {
  for (const choice of delta.choices) {
    if (choice.finish_reason) {
      // Message is complete
      if (currentEvent) {
        // Finalize any pending tool calls
        for (const [_index, toolCall] of activeToolCalls.entries()) {
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

// Removed duplicate createToolResultFromMCPResponse - use the one from anthropic.ts

// Removed duplicate extractPendingToolCalls - use the one from anthropic.ts

/**
 * Convert legacy message format to events (for migration)
 */
export function legacyMessageToEvents(message: Record<string, unknown>): Event[] {
  const events: Event[] = [];
  
  if (message.role === 'system' && typeof message.content === 'string') {
    events.push(createTextEvent('system', message.content));
  } else if (message.role === 'user' && typeof message.content === 'string') {
    events.push(createTextEvent('user', message.content));
  } else if (message.role === 'assistant') {
    const segments: Segment[] = [];
    
    // Add text content
    if (message.content && typeof message.content === 'string') {
      segments.push({ type: 'text', text: message.content });
    }
    
    // Add tool calls from json_meta
    const jsonMeta = message.json_meta as { tool_calls?: Array<{ id: string; function: { name: string; arguments?: string } }> } | null | undefined;
    if (jsonMeta?.tool_calls) {
      for (const toolCall of jsonMeta.tool_calls) {
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
  } else if (message.role === 'tool') {
    // Tool result message
    const toolJsonMeta = message.json_meta as { tool_call_id?: string; is_tool_result?: boolean } | null | undefined;
    const toolCallId = toolJsonMeta?.tool_call_id;
    if (toolCallId && typeof toolCallId === 'string') {
      events.push(createToolResultEvent(toolCallId, { content: message.content } as object));
    }
  }
  
  return events;
}

/**
 * Convert tool result to OpenAI tool message format
 */
export function toolResultToOpenAIMessage(toolCallId: string, result: unknown): OpenAIMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: typeof result === 'string' ? result : JSON.stringify(result)
  };
}