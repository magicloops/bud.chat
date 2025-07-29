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
  
  // Log ALL events to see what we're actually receiving
  if (event.type.includes('mcp')) {
    console.log('🌐 [MCP-TRANSFORMER] RAW MCP EVENT:', { 
      type: event.type, 
      keys: Object.keys(event),
      event: event 
    });
  }
  
  

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

    // Handle tool call events - modern Responses API format
    case 'response.output_item.added':
      // Check if this is a function call or MCP call being added
      const item = event.item as { type?: string; id?: string; name?: string; server_label?: string };
      console.log('🌐 [MCP-TRANSFORMER] output_item.added:', { 
        item_type: item?.type, 
        item_id: item?.id, 
        item_name: item?.name,
        server_label: item?.server_label 
      });
      if (item?.type === 'function_call') {
        return {
          type: 'tool_start',
          tool_id: item.id as string,
          tool_name: item.name as string
        };
      } else if (item?.type === 'mcp_call') {
        console.log('🌐 [MCP-TRANSFORMER] ✅ MCP CALL DETECTED:', { 
          tool_id: item.id, 
          tool_name: item.name, 
          server_label: item.server_label 
        });
        return {
          type: 'mcp_tool_start',
          tool_id: item.id as string,
          tool_name: item.name as string,
          server_label: item.server_label as string
        };
      } else if (item?.type === 'mcp_list_tools') {
        console.log('🌐 [MCP-TRANSFORMER] MCP TOOLS LISTED:', { 
          server_label: item.server_label, 
          tool_count: (item as { tools?: unknown[] }).tools?.length 
        });
        return {
          type: 'mcp_list_tools',
          server_label: item.server_label as string,
          tools: (item as { tools?: unknown[] }).tools || []
        };
      }
      return null;

    case 'response.function_call_arguments.delta':
      return {
        type: 'tool_arguments_delta',
        tool_id: event.item_id as string,
        output_index: event.output_index as number,
        delta: event.delta as string
      };

    case 'response.function_call_arguments.done':
      return {
        type: 'tool_finalized',
        tool_id: event.item_id as string,
        output_index: event.output_index as number,
        args: JSON.parse(event.arguments as string)
      };

    // Handle MCP call events - remote MCP tools
    case 'response.mcp_call_arguments.delta':
      console.log('🌐 [MCP-TRANSFORMER] mcp_call_arguments.delta:', { 
        item_id: event.item_id, 
        delta_length: (event.delta as string)?.length 
      });
      return {
        type: 'mcp_tool_arguments_delta',
        tool_id: event.item_id as string,
        delta: event.delta as string
      };

    case 'response.mcp_call_arguments.done':
      console.log('🌐 [MCP-TRANSFORMER] mcp_call_arguments.done:', { 
        item_id: event.item_id, 
        args_length: (event.arguments as string)?.length 
      });
      return {
        type: 'mcp_tool_finalized',
        tool_id: event.item_id as string,
        args: JSON.parse(event.arguments as string)
      };

    // Handle MCP lifecycle events
    case 'response.mcp_list_tools':
      console.log('🌐 [MCP-TRANSFORMER] ✅ MCP TOOLS LIST RECEIVED:', { 
        server_label: event.server_label, 
        tools_count: (event.tools as unknown[])?.length,
        tools: event.tools
      });
      return {
        type: 'mcp_list_tools',
        server_label: event.server_label as string,
        tools: event.tools as unknown[]
      };

    case 'response.mcp_list_tools.in_progress':
      console.log('🌐 [MCP-TRANSFORMER] mcp_list_tools.in_progress:', { 
        item_id: event.item_id, 
        output_index: event.output_index 
      });
      // MCP tool listing is in progress - this is informational
      return null;

    case 'response.mcp_list_tools.completed':
      console.log('🌐 [MCP-TRANSFORMER] mcp_list_tools.completed:', { 
        item_id: event.item_id, 
        output_index: event.output_index 
      });
      // MCP tool listing completed - this is informational  
      return null;

    case 'response.mcp_list_tools.failed':
      console.log('🌐 [MCP-TRANSFORMER] mcp_list_tools.failed:', { 
        item_id: event.item_id, 
        output_index: event.output_index 
      });
      // MCP tool listing failed - this is informational
      return null;

    case 'response.mcp_call.in_progress':
      console.log('🌐 [MCP-TRANSFORMER] ✅ MCP CALL IN PROGRESS (START):', { 
        item_id: event.item_id, 
        output_index: event.output_index 
      });
      // This is the MCP equivalent of tool_start - the MCP call has begun
      return {
        type: 'mcp_tool_start',
        tool_id: event.item_id as string,
        tool_name: `mcp_tool_${(event.item_id as string).slice(-8)}`, // Generate name since OpenAI doesn't provide it
        server_label: 'remote_mcp' // We know it's a remote MCP call
      };

    case 'response.mcp_call.completed':
      console.log('🌐 [MCP-TRANSFORMER] mcp_call.completed:', { 
        item_id: event.item_id, 
        output_index: event.output_index 
      });
      return {
        type: 'mcp_tool_complete',
        tool_id: event.item_id as string,
        output: null, // MCP results are included in the text response
        error: null
      };

    case 'response.mcp_call.failed':
      console.log('🌐 [MCP-TRANSFORMER] mcp_call.failed:', { 
        item_id: event.item_id, 
        output_index: event.output_index 
      });
      return {
        type: 'mcp_tool_complete',
        tool_id: event.item_id as string,
        output: null,
        error: 'MCP call failed'
      };

    case 'response.mcp_approval_request':
      return {
        type: 'mcp_approval_request',
        approval_request_id: event.id as string,
        tool_name: event.name as string,
        server_label: event.server_label as string,
        arguments: event.arguments as string
      };

    // Handle legacy tool call events (for backwards compatibility)
    case 'response.function_call.start':
      return {
        type: 'tool_start',
        tool_id: event.call_id as string,
        tool_name: event.name as string
      };

    case 'response.function_call.arguments.delta':
      return {
        type: 'tool_arguments_delta',
        tool_id: event.call_id as string,
        delta: event.delta as string
      };

    case 'response.function_call.done':
      return {
        type: 'tool_complete',
        tool_id: event.call_id as string
      };

    // Handle output item completion for both function calls and MCP calls
    case 'response.output_item.done':
      const doneItem = event.item as { type?: string; id?: string; output?: string; error?: string };
      if (doneItem?.type === 'function_call') {
        return {
          type: 'tool_complete',
          tool_id: doneItem.id as string
        };
      } else if (doneItem?.type === 'mcp_call') {
        return {
          type: 'mcp_tool_complete',
          tool_id: doneItem.id as string,
          output: doneItem.output || undefined,
          error: doneItem.error || undefined
        };
      }
      return null;

    default:
      // Log unknown events for debugging with full details
      console.log('🚨 UNHANDLED OpenAI Responses API event:', {
        type: event.type,
        allKeys: Object.keys(event),
        fullEvent: event,
        timestamp: Date.now(),
        note: 'This event type is not being processed by our transformer'
      });
      
      // Special check for potential MCP-related events we might be missing
      if (event.type.includes('mcp') || event.type.includes('tool') || event.type.includes('call')) {
        console.log('🚨 [MCP-TRANSFORMER] POTENTIALLY MISSING MCP EVENT TYPE:', {
          type: event.type,
          item: event.item,
          tool_id: event.tool_id,
          item_id: event.item_id
        });
      }
      
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
      try {
        const transformedEvent = transformOpenAIReasoningEvent(event);
        if (transformedEvent) {
          yield transformedEvent;
        }
      } catch (eventError) {
        console.error('Error transforming individual event:', eventError, 'Event:', event);
        // Continue processing other events instead of failing the entire stream
        continue;
      }
    }
  } catch (error) {
    console.error('Error processing OpenAI Responses API stream:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      error: error
    });
    
    // Check if this is an MCP-related error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('mcp') || errorMessage.includes('MCP') || errorMessage.includes('server_error')) {
      console.error('🚨 MCP-related error detected. This might be due to MCP server configuration issues.');
      yield {
        type: 'error',
        error: 'MCP server error: ' + errorMessage + '. The AI will continue without MCP tools.'
      };
    } else {
      yield {
        type: 'error',
        error: errorMessage
      };
    }
  }
}