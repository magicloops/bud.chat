// OpenAI Responses API Provider (for reasoning models)
import { OpenAIBaseProvider } from './OpenAIBaseProvider';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent,
  ProviderFeature,
  ValidationResult 
} from './types';
import { 
  Event, 
  // EventLog, // Not currently used
  ReasoningPart,
  Segment
} from '@/lib/types/events';
import { generateEventId, ToolCallId, generateToolCallId } from '@/lib/types/branded';
import { processResponsesAPIStream } from './utils/openaiResponsesUtils';

// Extended stream event for custom event types
interface ExtendedStreamEvent {
  type: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// Type definitions for OpenAI Responses API
interface ResponsesCreateParams {
  model: string;
  input: ResponsesInputItem[];
  max_output_tokens: number;
  reasoning?: {
    effort: 'low' | 'medium' | 'high';
    summary: 'auto' | 'none';
  };
  tools?: ResponsesMCPTool[];
}

interface ResponsesInputItem {
  id?: string;
  type: 'message' | 'text' | 'mcp_call' | 'reasoning';
  role?: 'user' | 'assistant' | 'system';
  content?: string | Array<{ type: string; text: string }>;
  text?: string;
  name?: string;
  output?: string;
  error?: string;
  summary?: Array<{ type: string; text: string }>;
}

interface ResponsesMCPTool {
  type: 'mcp';
  server_label: string;
  server_url: string;
  require_approval: 'never' | 'always' | { never?: { tool_names: string[] }; always?: { tool_names: string[] } };
  allowed_tools?: string[];
  headers?: Record<string, string>;
}

export class OpenAIResponsesProvider extends OpenAIBaseProvider {
  name = 'openai-responses' as const;
  provider = 'openai' as const;
  
  supportsFeature(feature: ProviderFeature): boolean {
    const responsesFeatures = [
      ProviderFeature.REASONING,
      ProviderFeature.REASONING_EFFORT,
      ProviderFeature.TOOL_CALLING,
    ];
    
    return super.supportsFeature(feature) || responsesFeatures.includes(feature);
  }
  
  protected validateProviderSpecific(_config: Partial<UnifiedChatRequest>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Add any OpenAI Responses-specific validations here
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return {
      [ProviderFeature.REASONING]: true,
      [ProviderFeature.REASONING_EFFORT]: true,
      [ProviderFeature.TOOL_CALLING]: true,
      [ProviderFeature.STREAMING]: true,
    };
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const inputItems = this.convertEventsToInputItems(request.events);
      
      const params: ResponsesCreateParams = {
        model: this.getModelName(request.model),
        input: inputItems,
        max_output_tokens: request.maxTokens || 8000,
      };
      
      // Add remote MCP tools if configured
      if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
        params.tools = request.mcpConfig.remote_servers.map(server => ({
          type: 'mcp' as const,
          server_label: server.server_label,
          server_url: server.server_url,
          require_approval: server.require_approval || 'never', // Default to 'never' to allow tool execution
          allowed_tools: server.allowed_tools,
          headers: server.headers
        }));
      }
      
      // Add reasoning configuration
      params.reasoning = {
        effort: request.reasoningEffort || 'medium',
        summary: 'auto'
      };
      
      // Use the OpenAI SDK's responses API
      // Note: The SDK types may not be fully aligned with our custom types
      const response = await this.client.responses.create(params as Parameters<typeof this.client.responses.create>[0]);
      
      // Convert response output to Event
      const event = this.convertResponseToEvent(response);
      
      // Check if response has usage data (non-streaming response)
      const usage = 'usage' in response && response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens
      } : undefined;
      
      return {
        event,
        usage
      };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    try {
      const inputItems = this.convertEventsToInputItems(request.events);
      
      console.log('📋 [Responses API] Input items:', inputItems.map((item, idx) => ({
        index: idx,
        type: item.type,
        id: item.id,
        ...(item.type === 'message' ? { role: item.role, contentLength: item.content?.length } : {}),
        ...(item.type === 'reasoning' ? { summaryCount: item.summary?.length } : {}),
        ...(item.type === 'mcp_call' ? { name: item.name, hasOutput: !!item.output } : {})
      })));
      
      
      const params: ResponsesCreateParams & { stream: true } = {
        model: this.getModelName(request.model),
        input: inputItems,
        max_output_tokens: request.maxTokens || 8000,
        stream: true,
      };
      
      // Add remote MCP tools if configured
      if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
        params.tools = request.mcpConfig.remote_servers.map(server => ({
          type: 'mcp' as const,
          server_label: server.server_label,
          server_url: server.server_url,
          require_approval: server.require_approval || 'never', // Default to 'never' to allow tool execution
          allowed_tools: server.allowed_tools,
          headers: server.headers
        }));
      }
      
      // Add reasoning configuration
      params.reasoning = {
        effort: request.reasoningEffort || 'medium',
        summary: 'auto'
      };
      
      console.log('📤 [Responses API] Sending request with params:', JSON.stringify(params, null, 2));
      
      // Use the OpenAI SDK's responses API with streaming
      // Note: The SDK types may not be fully aligned with our custom types
      const streamResponse = await this.client.responses.create(params as Parameters<typeof this.client.responses.create>[0]);

      // Process the stream using our utils
      // When stream: true is passed, the response is a Stream object that implements AsyncIterable
      const processedStream = processResponsesAPIStream(streamResponse as AsyncIterable<unknown>);
      
      const currentEvent: Event = {
        id: generateEventId(),
        role: 'assistant',
        segments: [],
        ts: Date.now()
      };
      
      let hasStarted = false;
      
      // Track the current message ID for text segments
      let currentMessageId: string | undefined;
      
      // Transform the processed stream to our unified format
      for await (const streamEvent of processedStream as AsyncGenerator<ExtendedStreamEvent>) {
        // Log unhandled events
        const handledTypes = [
          'token', 'text_start', 'message_start', 'reasoning_start', 'reasoning_summary_text_delta', 
          'reasoning_summary_delta', 'reasoning_summary_text_done',
          'reasoning_summary_done', 'reasoning_summary_part_added', 
          'reasoning_summary_part_done', 'reasoning_complete',
          'mcp_tool_start', 'mcp_tool_finalized',
          'mcp_tool_complete', 'mcp_tool_arguments_delta', 'mcp_list_tools',
          'mcp_call_in_progress', 'mcp_call_completed', 'mcp_call_failed',
          'mcp_list_tools_in_progress', 'mcp_list_tools_completed', 'mcp_list_tools_failed',
          'error', 'complete', 'finalize_only', 'progress_update', 'progress_hide'
        ];
        
        if (!handledTypes.includes(streamEvent.type)) {
          console.log('⚠️ [Responses Provider] Unhandled stream event:', {
            type: streamEvent.type,
            data: streamEvent
          });
        }
        
        if (!hasStarted) {
          yield {
            type: 'event',
            data: { event: currentEvent }
          };
          hasStarted = true;
        }
        
        switch (streamEvent.type) {
          case 'message_start':
            // Capture the message ID for the text content that follows
            currentMessageId = streamEvent.item_id as string;
            console.log('💬 [Responses Provider] Message started with ID:', currentMessageId);
            break;
            
          case 'text_start':
            // Create a text segment with the proper ID (fallback for legacy format)
            const textSegmentWithId: Segment = {
              type: 'text',
              id: streamEvent.item_id as string,
              text: streamEvent.content as string || '',
              sequence_number: streamEvent.sequence_number as number | undefined,
              output_index: streamEvent.output_index as number | undefined
            };
            currentEvent.segments.push(textSegmentWithId);
            
            // Yield initial text if present
            if (streamEvent.content) {
              yield {
                type: 'segment',
                data: {
                  segment: { type: 'text', text: streamEvent.content as string },
                  segmentIndex: currentEvent.segments.length - 1
                }
              };
            }
            break;
            
          case 'token':
            if (streamEvent.content && typeof streamEvent.content === 'string') {
              // Find existing text segment or create one with the message ID
              let textSegment = currentEvent.segments.find(s => s.type === 'text') as { type: 'text'; text: string; id?: string } | undefined;
              if (!textSegment) {
                // Create text segment with the message ID we captured
                textSegment = { 
                  type: 'text', 
                  text: '',
                  id: currentMessageId // Use the message ID from message_start event
                };
                currentEvent.segments.push(textSegment);
              }
              textSegment.text += streamEvent.content;
              
              yield {
                type: 'segment',
                data: {
                  segment: { type: 'text', text: streamEvent.content },
                  segmentIndex: currentEvent.segments.indexOf(textSegment)
                }
              };
            }
            break;
            
          case 'reasoning_start':
            // Create a reasoning segment
            const reasoningSegment = {
              type: 'reasoning' as const,
              id: typeof streamEvent.item_id === 'string' ? streamEvent.item_id : crypto.randomUUID(),
              output_index: typeof streamEvent.output_index === 'number' ? streamEvent.output_index : 0,
              sequence_number: typeof streamEvent.sequence_number === 'number' ? streamEvent.sequence_number : 0,
              parts: [],
              streaming: true // Mark as streaming
            };
            currentEvent.segments.push(reasoningSegment);
            
            yield {
              type: 'segment',
              data: {
                segment: reasoningSegment,
                segmentIndex: currentEvent.segments.length - 1
              }
            };
            break;
            
          case 'reasoning_summary_part_added':
            // Handle when a new reasoning summary part is added
            const reasoningIdxForAdd = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIdxForAdd >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const reasoningSegForAdd = currentEvent.segments[reasoningIdxForAdd] as any;
              
              // Extract initial text from the part if available
              const partData = (streamEvent.part || {}) as { type?: string; text?: string };
              const newPart = {
                summary_index: typeof streamEvent.summary_index === 'number' ? streamEvent.summary_index : 0,
                type: (partData.type || 'summary_text') as 'summary_text',
                text: typeof partData.text === 'string' ? partData.text : '',
                sequence_number: typeof streamEvent.sequence_number === 'number' ? streamEvent.sequence_number : 0,
                is_complete: false,
                created_at: Date.now()
              };
              reasoningSegForAdd.parts.push(newPart);
              
              // Yield as a generic event that the route handler will process
              yield {
                type: 'reasoning_summary_part_added',
                data: {
                  item_id: streamEvent.item_id,
                  summary_index: streamEvent.summary_index,
                  part: partData,
                  sequence_number: streamEvent.sequence_number
                }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
            }
            break;
            
          case 'reasoning_summary_text_delta':
          case 'reasoning_summary_delta':
            // Find the reasoning segment and update it
            const reasoningIndex = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIndex >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const reasoningSeg = currentEvent.segments[reasoningIndex] as any;
              
              const summaryIdx = typeof streamEvent.summary_index === 'number' ? streamEvent.summary_index : 0;
              const textContent = typeof streamEvent.delta === 'string' ? streamEvent.delta : '';
              
              // Find or create the part
              let part = reasoningSeg.parts.find((p: ReasoningPart) => p.summary_index === summaryIdx);
              if (!part) {
                part = {
                  summary_index: summaryIdx,
                  type: 'summary_text',
                  text: '',
                  sequence_number: typeof streamEvent.sequence_number === 'number' ? streamEvent.sequence_number : 0,
                  is_complete: false,
                  created_at: Date.now()
                };
                reasoningSeg.parts.push(part);
              }
              
              part.text += textContent;
              
              // Yield as a generic event that the route handler will process
              yield {
                type: 'reasoning_summary_text_delta',
                data: {
                  item_id: streamEvent.item_id,
                  summary_index: summaryIdx,
                  delta: textContent,
                  sequence_number: streamEvent.sequence_number
                }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
            }
            break;
            
          case 'reasoning_summary_text_done':
          case 'reasoning_summary_done':
          case 'reasoning_summary_part_done':
            // Mark the reasoning part as complete
            const reasoningIdxDone = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIdxDone >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const reasoningSegDone = currentEvent.segments[reasoningIdxDone] as any;
              const summaryIdxDone = typeof streamEvent.summary_index === 'number' ? streamEvent.summary_index : 0;
              const partIdxDone = reasoningSegDone.parts.findIndex(
                (p: ReasoningPart) => p.summary_index === summaryIdxDone
              );
              if (partIdxDone >= 0) {
                reasoningSegDone.parts[partIdxDone].is_complete = true;
                if (typeof streamEvent.text === 'string') {
                  reasoningSegDone.parts[partIdxDone].text = streamEvent.text;
                }
              }
              
              // Yield the proper event type
              if (streamEvent.type === 'reasoning_summary_part_done') {
                yield {
                  type: 'reasoning_summary_part_done',
                  data: {
                    item_id: streamEvent.item_id,
                    summary_index: summaryIdxDone,
                    sequence_number: streamEvent.sequence_number
                  }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any;
              }
            }
            break;
            
          case 'reasoning_complete':
            // Mark the entire reasoning segment as complete
            const reasoningIdxComplete = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIdxComplete >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const reasoningSegComplete = currentEvent.segments[reasoningIdxComplete] as any;
              reasoningSegComplete.streaming = false;
              
              // If we have combined text, update the segment
              if (typeof streamEvent.combined_text === 'string') {
                reasoningSegComplete.combined_text = streamEvent.combined_text;
              }
              
              // Yield the reasoning complete event
              yield {
                type: 'reasoning_complete',
                data: {
                  item_id: streamEvent.item_id,
                  parts: reasoningSegComplete.parts,
                  combined_text: streamEvent.combined_text,
                  output_index: streamEvent.output_index,
                  sequence_number: streamEvent.sequence_number
                }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
            }
            break;
            
          case 'mcp_tool_start':
            // For MCP tools, use the tool ID from the stream directly
            const mcpToolId = (streamEvent.tool_id || generateToolCallId()) as ToolCallId;
            const mcpToolSegment: Segment = {
              type: 'tool_call',
              id: mcpToolId, // Use the MCP tool ID directly
              name: typeof streamEvent.tool_name === 'string' ? streamEvent.tool_name : 'unknown',
              args: {},
              sequence_number: typeof streamEvent.sequence_number === 'number' ? streamEvent.sequence_number : undefined,
              output_index: typeof streamEvent.output_index === 'number' ? streamEvent.output_index : undefined,
              server_label: typeof streamEvent.server_label === 'string' ? streamEvent.server_label : undefined,
              display_name: typeof streamEvent.display_name === 'string' ? streamEvent.display_name : 
                           (typeof streamEvent.tool_name === 'string' ? streamEvent.tool_name : undefined),
              server_type: typeof streamEvent.server_type === 'string' ? streamEvent.server_type : 'remote_mcp'
            };
            // No need to map since we're using the original ID
            currentEvent.segments.push(mcpToolSegment);
            
            // Yield the proper MCP tool start event for frontend
            yield {
              type: 'mcp_tool_start',
              data: {
                tool_id: mcpToolId,
                tool_name: streamEvent.tool_name,
                server_label: streamEvent.server_label,
                display_name: streamEvent.display_name || streamEvent.tool_name,
                server_type: streamEvent.server_type || 'remote_mcp',
                output_index: streamEvent.output_index,
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;
            
          case 'mcp_tool_finalized':
            // Update the MCP tool segment with final args
            const mcpToolIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (mcpToolIndex >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (currentEvent.segments[mcpToolIndex] as any).args = streamEvent.args || {};
              
              // Yield the MCP tool finalized event
              yield {
                type: 'mcp_tool_finalized',
                data: {
                  tool_id: streamEvent.tool_id,
                  args: streamEvent.args
                }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
            }
            break;
            
          case 'mcp_tool_complete':
            // For Responses API, update the existing tool_call segment with the output
            const toolCallIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (toolCallIndex >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const toolCallSegment = currentEvent.segments[toolCallIndex] as any;
              toolCallSegment.output = streamEvent.output || {};
              if (streamEvent.error) {
                toolCallSegment.error = streamEvent.error;
              }
            }
            
            // Yield the MCP tool complete event
            yield {
              type: 'mcp_tool_complete',
              data: {
                tool_id: streamEvent.tool_id,
                output: streamEvent.output,
                error: streamEvent.error,
                sequence_number: streamEvent.sequence_number,
                output_index: streamEvent.output_index
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;
            
          case 'error':
            yield {
              type: 'error',
              data: { error: typeof streamEvent.error === 'string' ? streamEvent.error : 'Unknown error' }
            };
            return;
            
          case 'mcp_tool_arguments_delta':
            // Update tool arguments incrementally
            const toolIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (toolIndex >= 0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const toolSegment = currentEvent.segments[toolIndex] as any;
              if (!toolSegment.args._raw) {
                toolSegment.args._raw = '';
              }
              toolSegment.args._raw += streamEvent.delta;
              
              // Yield the MCP tool arguments delta event
              yield {
                type: 'mcp_tool_arguments_delta',
                data: {
                  tool_id: streamEvent.tool_id,
                  delta: streamEvent.delta
                }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any;
            }
            break;
            
          case 'mcp_list_tools':
          case 'mcp_list_tools_in_progress':
          case 'mcp_list_tools_completed':
          case 'mcp_list_tools_failed':
            // Just informational, tools are listed
            break;
            
          case 'mcp_call_in_progress':
          case 'mcp_call_completed':
          case 'mcp_call_failed':
            // MCP call lifecycle events
            break;
            
          case 'progress_update':
            // Pass through progress updates to frontend
            yield {
              type: 'progress_update',
              data: {
                activity: streamEvent.activity,
                server_label: streamEvent.server_label,
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;
            
          case 'progress_hide':
            // Pass through progress hide events to frontend
            yield {
              type: 'progress_hide',
              data: {
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;
            
          case 'complete':
            // Log what we've collected in currentEvent before finishing
            console.log('🔍 [Responses Provider] Final currentEvent structure:', {
              id: currentEvent.id,
              role: currentEvent.role,
              segments_count: currentEvent.segments.length,
              segments: currentEvent.segments.map((seg, idx) => ({
                index: idx,
                type: seg.type,
                ...(seg.type === 'text' ? { 
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  id: (seg as any).id,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  text_length: (seg as any).text?.length,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  text_preview: (seg as any).text?.substring(0, 50) + '...'
                } : {}),
                ...(seg.type === 'reasoning' ? {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  id: (seg as any).id,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  parts_count: (seg as any).parts?.length
                } : {})
              }))
            });
            
            yield { type: 'done' };
            return;
            
          case 'finalize_only':
            // Just finalize without sending done
            break;
        }
      }
      
      yield { type: 'done' };
      
    } catch (error) {
      console.error('🔴 [Responses Provider] Stream error:', error);
      const appError = this.handleProviderError(error);
      yield {
        type: 'error',
        data: { error: appError.message }
      };
    }
  }
  
  private convertEventsToInputItems(events: Event[]): ResponsesInputItem[] {
    const items: ResponsesInputItem[] = [];
    let messageIndex = 0;
    
    for (const event of events) {
      if (event.role === 'system' || event.role === 'user') {
        // Convert to message input with msg_ prefix
        items.push({
          id: `msg_${messageIndex++}`,
          type: 'message',
          role: event.role,
          content: event.segments
            .filter(seg => seg.type === 'text')
            .map(seg => ({ 
              type: 'input_text',
              text: (seg as { type: 'text'; text: string }).text 
            }))
        });
      } else if (event.role === 'assistant') {
        // Process reasoning FIRST (it comes before the output)
        const reasoningSegments = event.segments.filter(seg => seg.type === 'reasoning');
        const textSegments = event.segments.filter(seg => seg.type === 'text');
        const toolCallSegments = event.segments.filter(seg => seg.type === 'tool_call');
        
        // Add reasoning segments that have valid output following them
        for (const segment of reasoningSegments) {
          // Convert reasoning parts to summary array
          const summary = segment.parts?.map(part => ({
            type: part.type,
            text: part.text
          })) || [];
          
          const hasContent = summary.some(s => s.text && s.text.trim().length > 0);
          
          // Check what follows this reasoning in the original segments array
          const reasoningIndex = event.segments.indexOf(segment);
          const nextSegment = event.segments[reasoningIndex + 1];
          const hasFollowingOutput = nextSegment && (nextSegment.type === 'text' || nextSegment.type === 'tool_call');
          
          // Only include reasoning if it has content and valid output follows
          if (hasContent && hasFollowingOutput) {
            items.push({
              id: segment.id,
              type: 'reasoning',
              summary: summary
            });
          } else if (!hasFollowingOutput) {
            console.log('🚫 [Responses API] Filtering out orphaned reasoning segment:', {
              id: segment.id,
              hasContent,
              hasFollowingOutput
            });
          }
        }
        
        // Then add the assistant message with text content
        if (textSegments.length > 0) {
          // Use the text segment's ID if available, otherwise generate one
          const textSegment = textSegments[0];
          const messageId = textSegment.id || `msg_${messageIndex++}`;
          
          items.push({
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: textSegments.map(seg => ({ 
              type: 'output_text',
              text: (seg as { type: 'text'; text: string }).text 
            }))
          });
        }
        
        // Process tool calls (reasoning before them is already handled above)
        for (let i = 0; i < toolCallSegments.length; i++) {
          const segment = toolCallSegments[i];
          
          // Add the tool call
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mcpCall: any = {
            id: segment.id,
            type: 'mcp_call',
            name: segment.name,
            arguments: JSON.stringify(segment.args),
            server_label: segment.server_label || 'default'
          };
          
          // If this tool call has output (for Responses API), include it
          if (segment.output !== undefined) {
            mcpCall.output = typeof segment.output === 'string' 
              ? segment.output 
              : JSON.stringify(segment.output);
          }
          if (segment.error) {
            mcpCall.error = segment.error;
          }
          
          items.push(mcpCall);
        }
      } else if (event.role === 'tool') {
        // Convert tool results to mcp_call items with output
        const toolResult = event.segments[0];
        if (toolResult.type === 'tool_result') {
          items.push({
            id: toolResult.id,
            type: 'mcp_call',
            output: typeof toolResult.output === 'string' 
              ? toolResult.output 
              : JSON.stringify(toolResult.output),
            error: toolResult.error
          });
        }
      }
    }
    
    return items;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertResponseToEvent(response: any): Event {
    const segments: Event['segments'] = [];
    
    // Extract text content
    if (response.output) {
      for (const output of response.output) {
        if (output.type === 'text' && output.content) {
          segments.push({ type: 'text', text: output.content });
        } else if (output.type === 'mcp_call') {
          segments.push({
            type: 'tool_call',
            id: (output.id || crypto.randomUUID()) as ToolCallId,
            name: output.name,
            args: output.arguments ? JSON.parse(output.arguments) : {},
            server_label: output.server_label
          });
        }
      }
    }
    
    // Add reasoning if present
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
          created_at: Date.now()
        }]
      });
    }
    
    return {
      id: response.id,
      role: 'assistant',
      segments,
      ts: Date.now()
    };
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getItemPreview(item: any): string {
    if (item.type === 'message' && item.content?.[0]?.text) {
      return item.content[0].text.substring(0, 100) + '...';
    }
    if (item.type === 'mcp_call') {
      return `${item.name}(${item.arguments?.substring(0, 50)}...)`;
    }
    return '';
  }

  // Make a request to the OpenAI Responses API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Helper method to handle SDK errors
  private handleSDKError(error: unknown): never {
    if (error instanceof Error) {
      console.error('OpenAI SDK error:', error.message);
      throw new Error(`OpenAI Responses API error: ${error.message}`);
    }
    throw error;
  }
}