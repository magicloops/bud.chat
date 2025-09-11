// OpenAI Responses API utility functions for o-series reasoning models
// Standalone copy adapted to avoid frontend-specific types at package level.

const RESPONSES_DEBUG = process.env.RESPONSES_DEBUG === 'true';

export function transformOpenAIReasoningEvent(openaiEvent: unknown): any | any[] | null {
  if (!openaiEvent || typeof openaiEvent !== 'object') return null;
  const event = openaiEvent as Record<string, unknown>;
  if (!event.type || typeof event.type !== 'string') return null;

  const handledEventTypes = new Set([
    'response.created', 'response.in_progress', 'response.completed',
    'response.content_part.added', 'response.content_part.done',
    'response.output_text.delta', 'response.output_text.done', 'response.output_text.annotation.added',
    'response.output_item.added', 'response.output_item.done',
    'response.function_call_arguments.delta', 'response.function_call_arguments.done',
    'response.function_call.start', 'response.function_call.arguments.delta', 'response.function_call.done',
    'response.mcp_list_tools', 'response.mcp_list_tools.in_progress', 'response.mcp_list_tools.completed', 'response.mcp_list_tools.failed',
    'response.mcp_call_arguments.delta', 'response.mcp_call_arguments.done', 'response.mcp_call.in_progress', 'response.mcp_call.completed', 'response.mcp_call.failed',
    'response.mcp_approval_request',
    'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done',
    'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done',
    'response.reasoning_summary.delta', 'response.reasoning_summary.done',
    'response.web_search_call.in_progress', 'response.web_search_call.searching', 'response.web_search_call.completed',
    'response.code_interpreter_call.in_progress', 'response.code_interpreter_call.interpreting', 'response.code_interpreter_call.completed',
    'response.code_interpreter_call_code.delta', 'response.code_interpreter_call_code.done'
  ]);

  const isHandled = handledEventTypes.has(event.type);
  if (!isHandled && RESPONSES_DEBUG && (event.type.includes('mcp') || event.type.includes('output_item') || event.type.includes('response.'))) {
    // eslint-disable-next-line no-console
    console.log('🚨 [UNHANDLED] OpenAI Responses API EVENT:', { type: event.type, keys: Object.keys(event), event });
  }

  if ((event.type === 'response.output_item.added' || event.type === 'response.output_item.done') && (event as {item?: {type?: string}}).item?.type === 'reasoning') {
    const item = (event as {item?: unknown}).item as Record<string, unknown>;
    const hasUnexpectedStructure = !item.summary && !item.content;
    if (hasUnexpectedStructure && RESPONSES_DEBUG) {
      // eslint-disable-next-line no-console
      console.log('🧠 [REASONING] UNEXPECTED STRUCTURE:', { event_type: event.type, all_item_keys: Object.keys(item || {}), raw_item_json: JSON.stringify(item, null, 2) });
    }
  }

  switch (event.type) {

    case 'response.completed':
      return { type: 'response.completed', response: event.response as unknown, sequence_number: event.sequence_number as number };
    case 'response.output_item.added': {
      const item = (event as { item?: any }).item;
      if (item && item.type === 'message') {
        return { type: 'message_start', item_id: item.id as string, output_index: (event as any).output_index as number, sequence_number: (event as any).sequence_number as number };
      }
      // Pass through for non-message items (e.g., reasoning, mcp_call)
      return { type: 'response.output_item.added', item, output_index: (event as any).output_index as number, sequence_number: (event as any).sequence_number as number };
    }
    case 'response.content_part.added': {
      const part = (event as { part?: any }).part;
      if (part && part.type === 'output_text') {
        return {
          type: 'text_start',
          item_id: (event as any).item_id as string,
          output_index: (event as any).output_index as number,
          sequence_number: (event as any).sequence_number as number,
          content: typeof part.text === 'string' ? part.text : ''
        } as any;
      }
      return null;
    }

    case 'response.created':
      return { type: 'response.created', response: event.response as unknown, sequence_number: event.sequence_number as number };
    case 'response.in_progress':
      return { type: 'response.in_progress', response: event.response as unknown, sequence_number: event.sequence_number as number };
    case 'response.mcp_list_tools.in_progress':
      return { type: 'progress_update', activity: 'mcp_tool_listing', server_label: (event as {server_label?: string}).server_label, sequence_number: event.sequence_number as number };
    case 'response.mcp_list_tools.completed':
      return { type: 'mcp_list_tools', tools: (event as {tools?: unknown[]}).tools, sequence_number: event.sequence_number as number };
    case 'response.mcp_list_tools.failed':
      return { type: 'error', error: String((event as {error?: unknown}).error || 'MCP list tools failed') };
    case 'response.mcp_call.in_progress':
      return { type: 'mcp_call_in_progress', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.mcp_call.completed':
      return { type: 'mcp_call_completed', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.mcp_call.failed':
      return { type: 'mcp_call_failed', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.mcp_call_arguments.delta':
      return { type: 'mcp_tool_arguments_delta', tool_id: event.tool_id as string, arguments: event.delta as string, item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.mcp_call_arguments.done':
      return { type: 'mcp_tool_finalized', tool_id: event.tool_id as string, arguments: event.arguments as string, item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.reasoning_summary_part.added':
      return { type: 'reasoning_summary_part_added', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number, part: (event as any).part };
    case 'response.reasoning_summary_part.done':
      return { type: 'reasoning_summary_part_done', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number, part: (event as any).part };
    case 'response.reasoning_summary_text.delta':
      return { type: 'reasoning_summary_text_delta', item_id: event.item_id as string, delta: (event as any).delta, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.reasoning_summary_text.done':
      return { type: 'reasoning_summary_text_done', item_id: event.item_id as string, text: (event as any).text, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.reasoning_summary.delta':
      return { type: 'reasoning_summary_delta', item_id: event.item_id as string, delta: (event as any).delta, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.reasoning_summary.done':
      return { type: 'reasoning_summary_done', item_id: event.item_id as string, summary: (event as any).summary, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.output_item.added':
      return { type: 'response.output_item.added', item: (event as any).item, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.output_item.done':
      return { type: 'response.output_item.done', item: (event as any).item, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.output_text.delta':
      return { type: 'token', content: (event as any).delta, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.output_text.done':
      return { type: 'text_done', content: (event as any).text, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.output_text.annotation.added':
      return { type: 'response.output_text.annotation.added', annotation: (event as any).annotation, output_index: event.output_index as number, sequence_number: event.sequence_number as number };

    case 'response.web_search_call.in_progress':
      return { type: 'web_search_call_in_progress', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.web_search_call.searching':
      return { type: 'web_search_call_searching', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.web_search_call.completed':
      return { type: 'web_search_call_completed', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };

    case 'response.code_interpreter_call.in_progress':
      return { type: 'code_interpreter_call_in_progress', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.code_interpreter_call.interpreting':
      return { type: 'code_interpreter_call_interpreting', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.code_interpreter_call.completed':
      return { type: 'code_interpreter_call_completed', item_id: event.item_id as string, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.code_interpreter_call_code.delta':
      return { type: 'code_interpreter_call_code_delta', item_id: event.item_id as string, delta: (event as any).delta, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    case 'response.code_interpreter_call_code.done':
      return { type: 'code_interpreter_call_code_done', item_id: event.item_id as string, code: (event as any).code, output_index: event.output_index as number, sequence_number: event.sequence_number as number };
    default:
      if (RESPONSES_DEBUG) {
        console.log('🚨🚨🚨 UNHANDLED OpenAI Responses API EVENT 🚨🚨🚨');
        console.log('Event Type:', event.type);
        console.log('All Keys:', Object.keys(event));
        console.log('Full Event:', JSON.stringify(event, null, 2));
        console.log('Timestamp:', new Date().toISOString());
      }
      if (event.type.includes('mcp') || event.type.includes('tool') || event.type.includes('call')) {
        console.log('🔥 Potential MCP event:', event.type);
      }
      return null;
  }
}

export async function* processResponsesAPIStream(
  stream: AsyncIterable<unknown>
): AsyncGenerator<any, void, unknown> {
  try {
    for await (const event of stream) {
      try {
        if (RESPONSES_DEBUG) {
          console.log('🔍 [DEBUG] Raw OpenAI Event:', JSON.stringify(event, null, 2));
        }
        const transformedEvent = transformOpenAIReasoningEvent(event);
        if (transformedEvent) {
          if (RESPONSES_DEBUG) {
            console.log('🔄 [DEBUG] Transformed Event:', JSON.stringify(transformedEvent, null, 2));
          }
          if (Array.isArray(transformedEvent)) {
            for (const singleEvent of transformedEvent) yield singleEvent as any;
          } else {
            yield transformedEvent as any;
          }
        }
      } catch (_e) {
        console.error('Error transforming individual event:', _e, 'Event:', event);
        continue;
      }
    }
  } catch (error) {
    console.error('Error processing OpenAI Responses API stream:', error);
    console.error('Error details:', { message: error instanceof Error ? error.message : 'Unknown error', stack: error instanceof Error ? error.stack : undefined, error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.toLowerCase().includes('mcp') || errorMessage.includes('server_error')) {
      yield { type: 'error', error: 'MCP server error: ' + errorMessage + '. The AI will continue without MCP tools.' } as any;
    } else {
      yield { type: 'error', error: errorMessage } as any;
    }
  }
}
