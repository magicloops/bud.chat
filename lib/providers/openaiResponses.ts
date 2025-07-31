// OpenAI Responses API integration for o-series reasoning models
// Handles the transformation of reasoning events from OpenAI's Responses API

import { StreamEvent } from '@/lib/streaming/frontendEventHandler';
import OpenAI from 'openai';

/**
 * Transform OpenAI Responses API reasoning events to our internal format
 */
export function transformOpenAIReasoningEvent(openaiEvent: unknown): StreamEvent | StreamEvent[] | null {
  if (!openaiEvent || typeof openaiEvent !== 'object') return null;
  
  const event = openaiEvent as Record<string, unknown>;
  if (!event.type || typeof event.type !== 'string') return null;
  
  // Create a list of event types we already handle
  const handledEventTypes = new Set([
    // Lifecycle events
    'response.created',
    'response.in_progress',
    'response.completed',
    'response.content_part.added',
    'response.content_part.done',
    
    // Text output events
    'response.output_text.delta',
    'response.output_text.done',
    
    // Output item events
    'response.output_item.added',
    'response.output_item.done',
    
    // Function call events
    'response.function_call_arguments.delta',
    'response.function_call_arguments.done',
    'response.function_call.start',
    'response.function_call.arguments.delta',
    'response.function_call.done',
    
    // MCP events
    'response.mcp_list_tools',
    'response.mcp_list_tools.in_progress',
    'response.mcp_list_tools.completed',
    'response.mcp_list_tools.failed',
    'response.mcp_call_arguments.delta',
    'response.mcp_call_arguments.done',
    'response.mcp_call.in_progress',
    'response.mcp_call.completed',
    'response.mcp_call.failed',
    'response.mcp_approval_request',
    
    // Reasoning events
    'response.reasoning_summary_part.added',
    'response.reasoning_summary_part.done',
    'response.reasoning_summary_text.delta',
    'response.reasoning_summary_text.done',
    'response.reasoning_summary.delta',
    'response.reasoning_summary.done'
  ]);
  
  // Only log events we're not already handling
  const isHandled = handledEventTypes.has(event.type);
  if (!isHandled && (event.type.includes('mcp') || event.type.includes('output_item') || event.type.includes('response.'))) {
    console.log('🚨 [MCP-TRANSFORMER] UNHANDLED RAW EVENT:', { 
      type: event.type, 
      keys: Object.keys(event),
      event: event
    });
  }
  
  // Special detailed logging for reasoning items (only when we need to debug)
  if ((event.type === 'response.output_item.added' || event.type === 'response.output_item.done') && (event as any).item?.type === 'reasoning') {
    // Only log reasoning items if they have unexpected structure (for debugging)
    const item = (event as any).item;
    const hasUnexpectedStructure = !item.summary && !item.content;
    if (hasUnexpectedStructure) {
      console.log('🧠 [MCP-TRANSFORMER] UNEXPECTED REASONING STRUCTURE:', {
        event_type: event.type,
        all_item_keys: Object.keys(item || {}),
        raw_item_json: JSON.stringify(item, null, 2)
      });
    }
  }
  
  

  switch (event.type) {
    // Lifecycle events for progress indication
    case 'response.created':
      return {
        type: 'progress_update',
        activity: 'response_starting',
        sequence_number: event.sequence_number as number
      };

    case 'response.in_progress':
      return {
        type: 'progress_update',
        activity: 'thinking',
        sequence_number: event.sequence_number as number
      };

    // MCP progress events
    case 'response.mcp_list_tools.in_progress':
      return {
        type: 'progress_update',
        activity: 'mcp_tool_listing',
        server_label: (event as any).server_label,
        sequence_number: event.sequence_number as number
      };

    case 'response.mcp_list_tools.completed':
      return {
        type: 'progress_hide',
        sequence_number: event.sequence_number as number
      };

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

    // Handle text output events - hide progress when text starts
    case 'response.output_text.delta':
      return {
        type: 'token',
        content: event.delta as string,
        // Include progress hiding metadata
        hideProgress: true
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

    // Note: response.created and response.in_progress are handled earlier in the switch

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
      // Check if this is a function call, MCP call, or reasoning being added
      const item = event.item as { type?: string; id?: string; name?: string; server_label?: string; tools?: unknown[]; summary?: unknown[] };
      console.log('🌐 [MCP-TRANSFORMER] ✅ OUTPUT_ITEM.ADDED EVENT RECEIVED:', { 
        item_type: item?.type, 
        item_id: item?.id, 
        item_name: item?.name,
        server_label: item?.server_label,
        has_tools: !!item?.tools,
        tools_count: Array.isArray(item?.tools) ? item.tools.length : 0,
        all_keys: Object.keys(item || {}),
        full_item: item
      });
      if (item?.type === 'function_call') {
        return {
          type: 'tool_start',
          tool_id: item.id as string,
          tool_name: item.name as string
        };
      } else if (item?.type === 'mcp_call') {
        console.log('🌐 [MCP-TRANSFORMER] ✅ MCP CALL DETECTED (REAL TOOL NAME):', { 
          tool_id: item.id, 
          tool_name: item.name, 
          server_label: item.server_label 
        });
        return {
          type: 'mcp_tool_start',
          tool_id: item.id as string,
          tool_name: item.name as string, // Real tool name from OpenAI
          server_label: item.server_label as string,
          // Add sequence information for proper ordering
          output_index: event.output_index as number,
          sequence_number: event.sequence_number as number,
          // Add metadata for better frontend display
          display_name: item.name as string, // Use real tool name as display name
          server_type: 'remote_mcp'
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
      } else if (item?.type === 'reasoning') {
        const summaryData = Array.isArray(item.summary) ? item.summary : [];
        console.log('🧠 [MCP-TRANSFORMER] ✅ REASONING ITEM STARTED:', { 
          item_id: item.id,
          output_index: event.output_index,
          sequence_number: event.sequence_number,
          has_summary: !!item.summary,
          summary_length: summaryData.length,
          summary_preview: summaryData.slice(0, 2).map(part => ({
            summary_index: part?.summary_index,
            type: part?.type,
            has_text: !!part?.text,
            text_length: part?.text?.length || 0
          }))
        });
        return {
          type: 'reasoning_start',
          item_id: item.id as string,
          output_index: event.output_index as number,
          sequence_number: event.sequence_number as number,
          parts: [] // Empty initially, will be populated as parts are streamed
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
      return {
        type: 'mcp_tool_arguments_delta',
        tool_id: event.item_id as string,
        delta: event.delta as string
      };

    case 'response.mcp_call_arguments.done':
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
      // MCP tool listing is in progress - this is informational
      return null;

    case 'response.mcp_list_tools.completed':
      console.log('🌐 [MCP-TRANSFORMER] mcp_list_tools.completed:', { 
        item_id: event.item_id, 
        output_index: event.output_index,
        full_event: event // Log the full event to see if it contains tools data
      });
      // Check if this event contains the tools data
      if (event.tools && Array.isArray(event.tools)) {
        console.log('🌐 [MCP-TRANSFORMER] ✅ TOOLS FOUND IN COMPLETED EVENT:', { 
          server_label: event.server_label, 
          tools_count: event.tools.length,
          tools: event.tools
        });
        return {
          type: 'mcp_list_tools',
          server_label: event.server_label as string || 'unknown_server',
          tools: event.tools as unknown[]
        };
      }
      // MCP tool listing completed - this is informational  
      return null;

    case 'response.mcp_list_tools.failed':
      // MCP tool listing failed - this is informational
      return null;

    case 'response.mcp_call.in_progress':
      // Skip this event - MCP tool start data comes through output_item.added events with real tool names
      // Processing both creates duplicate tool call events with different names
      return null;

    case 'response.mcp_call.completed':
      // Skip this event - MCP tool outputs come through output_item.done events
      // Processing both creates duplicate tool result events
      return null;

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

    // Handle output item completion for function calls, MCP calls, and reasoning
    case 'response.output_item.done':
      const doneItem = event.item as { 
        type?: string; 
        id?: string; 
        output?: string; 
        error?: string; 
        tools?: unknown[];
        server_label?: string;
        summary?: Array<{
          summary_index: number;
          type: string;
          text: string;
          sequence_number: number;
        }>;
      };
      
      console.log('🌐 [MCP-TRANSFORMER] ✅ OUTPUT_ITEM.DONE EVENT RECEIVED:', { 
        item_type: doneItem?.type, 
        item_id: doneItem?.id,
        has_tools: !!doneItem?.tools,
        tools_count: Array.isArray(doneItem?.tools) ? doneItem.tools.length : 0,
        server_label: doneItem?.server_label,
        has_output: !!doneItem?.output,
        output_length: typeof doneItem?.output === 'string' ? doneItem.output.length : 0,
        output_preview: typeof doneItem?.output === 'string' ? doneItem.output.substring(0, 100) + '...' : doneItem?.output,
        has_error: !!doneItem?.error,
        has_summary: !!doneItem?.summary,
        summary_count: Array.isArray(doneItem?.summary) ? doneItem.summary.length : 0,
        all_keys: Object.keys(doneItem || {}),
        full_item: doneItem
      });
      
      if (doneItem?.type === 'function_call') {
        return {
          type: 'tool_complete',
          tool_id: doneItem.id as string
        };
      } else if (doneItem?.type === 'mcp_call') {
        console.log('🌐 [MCP-TRANSFORMER] ✅ MCP CALL DONE WITH OUTPUT:', { 
          tool_id: doneItem.id, 
          has_output: !!doneItem.output,
          output_length: typeof doneItem.output === 'string' ? doneItem.output.length : 0,
          has_error: !!doneItem.error
        });
        return {
          type: 'mcp_tool_complete',
          tool_id: doneItem.id as string,
          output: doneItem.output || undefined,
          error: doneItem.error || undefined
        };
      } else if (doneItem?.type === 'mcp_list_tools' && doneItem.tools) {
        // Check if this is where the MCP tools data comes from
        console.log('🌐 [MCP-TRANSFORMER] ✅ MCP TOOLS FOUND IN output_item.done:', { 
          server_label: doneItem.server_label, 
          tools_count: Array.isArray(doneItem.tools) ? doneItem.tools.length : 0,
          tools: doneItem.tools
        });
        
        // Return both mcp_list_tools event and progress_hide
        return [
          {
            type: 'mcp_list_tools',
            server_label: doneItem.server_label as string || 'unknown_server',
            tools: doneItem.tools as unknown[]
          },
          {
            type: 'progress_hide',
            sequence_number: event.sequence_number as number
          }
        ];
      } else if (doneItem?.type === 'reasoning' && doneItem.summary) {
        console.log('🧠 [MCP-TRANSFORMER] ✅ REASONING ITEM COMPLETED:', { 
          item_id: doneItem.id,
          output_index: event.output_index,
          sequence_number: event.sequence_number,
          summary_count: doneItem.summary.length,
          summary_parts: doneItem.summary.map(part => ({
            summary_index: part.summary_index,
            type: part.type,
            text_length: part.text?.length || 0
          }))
        });
        
        // Convert OpenAI reasoning parts to our format
        const reasoningParts = doneItem.summary.map(part => ({
          summary_index: part.summary_index,
          type: part.type as 'summary_text',
          text: part.text,
          sequence_number: part.sequence_number,
          is_complete: true,
          created_at: Date.now()
        }));
        
        return {
          type: 'reasoning_complete',
          item_id: doneItem.id as string,
          output_index: event.output_index as number,
          sequence_number: event.sequence_number as number,
          parts: reasoningParts,
          combined_text: reasoningParts.map(p => p.text).join('\n')
        };
      }
      return null;

    default:
      // Log unknown events for debugging with full details
      console.log('🚨🚨🚨 UNHANDLED OpenAI Responses API EVENT 🚨🚨🚨');
      console.log('Event Type:', event.type);
      console.log('All Keys:', Object.keys(event));
      console.log('Full Event:', JSON.stringify(event, null, 2));
      console.log('Timestamp:', new Date().toISOString());
      console.log('Note: This event type is not being processed by our transformer');
      console.log('🚨🚨🚨 END UNHANDLED EVENT 🚨🚨🚨');
      
      // Special check for potential MCP-related events we might be missing
      if (event.type.includes('mcp') || event.type.includes('tool') || event.type.includes('call')) {
        console.log('🔥🔥🔥 POTENTIALLY MISSING MCP EVENT TYPE 🔥🔥🔥');
        console.log('Type:', event.type);
        console.log('Item:', event.item);
        console.log('Tool ID:', event.tool_id);
        console.log('Item ID:', event.item_id);
        console.log('Tools:', event.tools);
        console.log('Server Label:', event.server_label);
        console.log('🔥🔥🔥 END MCP EVENT 🔥🔥🔥');
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
          // Handle both single events and arrays of events
          if (Array.isArray(transformedEvent)) {
            for (const singleEvent of transformedEvent) {
              yield singleEvent;
            }
          } else {
            yield transformedEvent;
          }
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