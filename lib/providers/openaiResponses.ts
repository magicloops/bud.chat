// OpenAI Responses API integration for o-series reasoning models
// Handles the transformation of reasoning events from OpenAI's Responses API

import { StreamEvent } from '@/lib/streaming/frontendEventHandler';
import OpenAI from 'openai';

/**
 * Transform OpenAI Responses API reasoning events to our internal format
 */
export function transformOpenAIReasoningEvent(openaiEvent: unknown): StreamEvent | null {
  if (!openaiEvent || typeof openaiEvent !== 'object') return null;
  
  const event = openaiEvent as Record<string, unknown>;
  if (!event.type || typeof event.type !== 'string') return null;
  
  

  switch (event.type) {
    case 'response.reasoning_summary_part.added':
      return {
        type: 'reasoning_summary_part_added',
        item_id: event.item_id as string,
        output_index: event.output_index as number,
        summary_index: event.summary_index as number,
        part: event.part as { type: string; text: string },
        sequence_number: event.sequence_number as number
      };

    case 'response.reasoning_summary_part.done':
      return {
        type: 'reasoning_summary_part_done',
        item_id: event.item_id as string,
        output_index: event.output_index as number,
        summary_index: event.summary_index as number,
        sequence_number: event.sequence_number as number
      };

    case 'response.reasoning_summary_text.delta':
      return {
        type: 'reasoning_summary_text_delta',
        item_id: event.item_id as string,
        output_index: event.output_index as number,
        summary_index: event.summary_index as number,
        delta: event.delta as string,
        sequence_number: event.sequence_number as number
      };

    case 'response.reasoning_summary_text.done':
      return {
        type: 'reasoning_summary_text_done',
        item_id: event.item_id as string,
        output_index: event.output_index as number,
        summary_index: event.summary_index as number,
        text: event.text as string,
        sequence_number: event.sequence_number as number
      };

    case 'response.reasoning_summary.delta':
      return {
        type: 'reasoning_summary_delta',
        item_id: event.item_id as string,
        output_index: event.output_index as number,
        summary_index: event.summary_index as number,
        delta: event.delta as string,
        sequence_number: event.sequence_number as number
      };

    case 'response.reasoning_summary.done':
      return {
        type: 'reasoning_summary_done',
        item_id: event.item_id as string,
        output_index: event.output_index as number,
        summary_index: event.summary_index as number,
        text: event.text as string,
        sequence_number: event.sequence_number as number
      };

    // Handle text output events
    case 'response.output_text.delta':
      return {
        type: 'token',
        content: event.delta as string
      };

    case 'response.output_text.done':
      // This indicates a text output is complete, but we continue processing
      return null; // Don't emit anything special, just continue

    case 'response.completed':
      // Response is fully complete - now we can finalize the event
      console.log('🎯 OpenAI Responses API: response.completed - finalizing event now');
      return {
        type: 'finalize_only' // Finalize event but don't send complete to frontend yet
      };

    // Handle response lifecycle events (informational only)
    case 'response.created':
    case 'response.in_progress':
    case 'response.output_item.added':
    case 'response.output_item.done':
      // These are lifecycle events, don't transform them
      return null;

    // Handle regular content events (text, tool calls, etc.) - legacy format
    case 'response.content_part.added':
      // Transform to regular token event if it's text
      const part = event.part as { type?: string; text?: string };
      if (part?.type === 'text') {
        return {
          type: 'token',
          content: part.text || ''
        };
      }
      break;

    case 'response.content_part.done':
      // Content part is done - but this is just a lifecycle event, not final completion
      console.log('📝 OpenAI Responses API: response.content_part.done - lifecycle event, ignoring');
      return null; // Just a lifecycle event, don't do anything

    default:
      // Log unknown events for debugging with full details
      console.log('🚨 UNHANDLED OpenAI Responses API event:', {
        type: event.type,
        allKeys: Object.keys(event),
        fullEvent: event,
        timestamp: Date.now(),
        note: 'This event type is not being processed by our transformer'
      });
      return null;
  }

  return null;
}

/**
 * Check if an OpenAI Responses API event is a reasoning-related event
 */
export function isReasoningEvent(eventType: string): boolean {
  const reasoningEventTypes = [
    'response.reasoning_summary_part.added',
    'response.reasoning_summary_part.done', 
    'response.reasoning_summary_text.delta',
    'response.reasoning_summary_text.done',
    'response.reasoning_summary.delta',
    'response.reasoning_summary.done'
  ];
  
  return reasoningEventTypes.includes(eventType);
}

/**
 * Create OpenAI Responses API request for o-series models
 */
export function createResponsesAPIRequest(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  model: string,
  options: {
    temperature?: number;
    max_tokens?: number;
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    reasoning_effort?: 'low' | 'medium' | 'high';
  } = {}
): unknown {
  const request: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.max_tokens && { max_completion_tokens: options.max_tokens }),
    ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
    ...(options.reasoning_effort && { reasoning_effort: options.reasoning_effort })
  };

  return request;
}

/**
 * Process OpenAI Responses API stream
 */
export async function* processResponsesAPIStream(
  stream: AsyncIterable<unknown>
): AsyncGenerator<StreamEvent, void, unknown> {
  try {
    for await (const event of stream) {
      const transformedEvent = transformOpenAIReasoningEvent(event);
      if (transformedEvent) {
        yield transformedEvent;
      }
    }
  } catch (error) {
    console.error('Error processing OpenAI Responses API stream:', error);
    yield {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}