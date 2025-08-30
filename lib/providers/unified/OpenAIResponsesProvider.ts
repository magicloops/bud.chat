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
  include?: string[];
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high';
    summary: 'auto' | 'concise' | 'detailed';
  };
  text?: {
    verbosity: 'low' | 'medium' | 'high';
  };
  tools?: (ResponsesMCPTool | ResponsesBuiltInTool)[];
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

interface ResponsesBuiltInTool {
  type: 'web_search_preview' | 'code_interpreter';
  search_context_size?: 'low' | 'medium' | 'high';
  container?: string;
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

  private buildToolsArray(request: UnifiedChatRequest): (ResponsesMCPTool | ResponsesBuiltInTool)[] {
    const tools: (ResponsesMCPTool | ResponsesBuiltInTool)[] = [];
    
    // Add remote MCP tools if configured
    if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
      const mcpTools = request.mcpConfig.remote_servers.map(server => ({
        type: 'mcp' as const,
        server_label: server.server_label,
        server_url: server.server_url,
        require_approval: server.require_approval || 'never', // Default to 'never' to allow tool execution
        allowed_tools: server.allowed_tools,
        headers: server.headers
      }));
      tools.push(...mcpTools);
    }
    
    // Add built-in tools if configured
    if (request.builtInToolsConfig?.enabled_tools && request.builtInToolsConfig.enabled_tools.length > 0) {
      for (const toolType of request.builtInToolsConfig.enabled_tools) {
        const toolSettings = (request.builtInToolsConfig.tool_settings[toolType] as {
          search_context_size?: 'low' | 'medium' | 'high'
          container?: string
        } | undefined) || {};
        
        if (toolType === 'web_search_preview') {
          tools.push({
            type: 'web_search_preview',
            search_context_size: toolSettings.search_context_size || 'medium'
          });
        } else if (toolType === 'code_interpreter') {
          tools.push({
            type: 'code_interpreter',
            container: toolSettings.container || 'default'
          });
        }
      }
    }
    
    return tools;
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const inputItems = this.convertEventsToInputItems(request.events);
      
      const params: ResponsesCreateParams = {
        model: this.getModelName(request.model),
        input: inputItems,
        max_output_tokens: request.maxTokens || 8000,
        include: ['reasoning.encrypted_content'],
      };
      
      // Add tools (MCP and built-in)
      const tools = this.buildToolsArray(request);
      if (tools.length > 0) {
        params.tools = tools;
      }
      
      // Add reasoning configuration - prefer new reasoningConfig over legacy reasoningEffort
      let reasoningEffort = request.reasoningConfig?.effort || request.reasoningEffort || 'low';
      
      // Validate reasoning effort compatibility with built-in tools
      const hasBuiltInTools = !!(request.builtInToolsConfig?.enabled_tools && request.builtInToolsConfig.enabled_tools.length > 0);
      if (hasBuiltInTools && reasoningEffort === 'minimal') {
        console.warn('⚠️ [OpenAI Responses] Minimal reasoning effort not compatible with built-in tools, using "low" instead');
        reasoningEffort = 'low';
      }
      
      // Set appropriate summary default based on model
      const summaryDefault = request.model.startsWith('gpt-5') ? 'detailed' : 'auto';
      
      params.reasoning = {
        effort: reasoningEffort as 'minimal' | 'low' | 'medium' | 'high',
        summary: request.reasoningConfig?.summary || summaryDefault
      };
      
      // Add verbosity configuration for GPT-5 series models
      if (request.textGenerationConfig?.verbosity) {
        params.text = {
          verbosity: request.textGenerationConfig.verbosity
        };
      }
      
      // Use the OpenAI SDK's responses API
      // Note: The SDK types may not be fully aligned with our custom types
      const response = await this.client.responses.create(params as Parameters<typeof this.client.responses.create>[0]);
      
      // Log the response ID for debugging and potential manual verification
      try {
        const r = response as unknown as Record<string, unknown>;
        console.log('🔍 [OpenAI Responses] Response ID:', {
          id: r && 'id' in r ? (r as { id?: string }).id : undefined,
          status: r && 'status' in r ? (r as { status?: string }).status : undefined,
          model: r && 'model' in r ? (r as { model?: string }).model : undefined,
          created_at: r && 'created_at' in r ? (r as { created_at?: unknown }).created_at : undefined,
          store: r && 'store' in r ? (r as { store?: unknown }).store : undefined,
          reasoning_effort: (r as { reasoning?: { effort?: unknown } }).reasoning?.effort,
          output_count: Array.isArray((r as { output?: unknown[] }).output) ? ((r as { output?: unknown[] }).output as unknown[])?.length : 0
        });
      } catch {}
      
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
      
      const params: ResponsesCreateParams & { stream: true } = {
        model: this.getModelName(request.model),
        input: inputItems,
        max_output_tokens: request.maxTokens || 8000,
        stream: true,
        include: ['reasoning.encrypted_content'],
      };
      
      // Add tools (MCP and built-in)
      const tools = this.buildToolsArray(request);
      if (tools.length > 0) {
        params.tools = tools;
      }
      
      // Add reasoning configuration - prefer new reasoningConfig over legacy reasoningEffort
      let reasoningEffort = request.reasoningConfig?.effort || request.reasoningEffort || 'low';
      
      // Validate reasoning effort compatibility with built-in tools
      const hasBuiltInTools = !!(request.builtInToolsConfig?.enabled_tools && request.builtInToolsConfig.enabled_tools.length > 0);
      if (hasBuiltInTools && reasoningEffort === 'minimal') {
        console.warn('⚠️ [OpenAI Responses] Minimal reasoning effort not compatible with built-in tools, using "low" instead');
        reasoningEffort = 'low';
      }
      
      // Set appropriate summary default based on model
      const summaryDefault = request.model.startsWith('gpt-5') ? 'detailed' : 'auto';
      
      params.reasoning = {
        effort: reasoningEffort as 'minimal' | 'low' | 'medium' | 'high',
        summary: request.reasoningConfig?.summary || summaryDefault
      };
      
      // Add verbosity configuration for GPT-5 series models
      if (request.textGenerationConfig?.verbosity) {
        params.text = {
          verbosity: request.textGenerationConfig.verbosity
        };
      }
      
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
      
      // Debug: Collect all stream events to understand OpenAI's response structure
      const debugResponseData: {
        response_id?: string;
        reasoning_items: Array<{id: string; summary: unknown[]; output_index?: number; sequence_number?: number}>;
        message_items: Array<{id: string; role: string; content_preview: string}>;
        raw_events: Array<{type: string; id?: string; item_id?: string; data?: unknown}>;
        completion_events: Array<{type: string; timestamp: number; action: string}>;
      } = {
        reasoning_items: [],
        message_items: [],
        raw_events: [],
        completion_events: []
      };
      
      let streamCompleted = false;
      
      // Transform the processed stream to our unified format
      for await (const streamEvent of processedStream as AsyncGenerator<ExtendedStreamEvent>) {
        // Check for duplicate completion attempts
        if (streamCompleted) {
          console.log('⚠️ [DEBUG] Stream already completed, skipping event:', {
            type: streamEvent.type,
            timestamp: Date.now()
          });
          continue;
        }
        // Debug: Capture raw stream events
        debugResponseData.raw_events.push({
          type: streamEvent.type,
          id: streamEvent.id as string | undefined,
          item_id: streamEvent.item_id as string | undefined,
          data: streamEvent.type === 'reasoning_start' || streamEvent.type === 'message_start' ? 
            { output_index: streamEvent.output_index, sequence_number: streamEvent.sequence_number } : 
            undefined
        });
        
        
        
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
          'web_search_call_in_progress', 'web_search_call_searching', 'web_search_call_completed',
          'response.output_text.annotation.added',
          'response.created', 'response.in_progress', 'response.completed',
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
          case 'response.created':
          case 'response.in_progress':
            // Handle response lifecycle events - just capture response ID for now
            const respObj = streamEvent.response as Record<string, unknown> | undefined;
            if (respObj && 'id' in respObj && !debugResponseData.response_id) {
              debugResponseData.response_id = (respObj as { id?: string }).id;
            }
            break;
            
          case 'response.completed':
            // Handle response completion - set final metadata and complete
            console.log('🔚 [DEBUG] Processing response.completed event');
            debugResponseData.completion_events.push({
              type: 'response.completed',
              timestamp: Date.now(),
              action: 'processing'
            });
            
            const completedResponse = streamEvent.response as Record<string, unknown> | undefined;
            if (completedResponse && 'id' in completedResponse && !debugResponseData.response_id) {
              debugResponseData.response_id = (completedResponse as { id?: string }).id;
            }
            
            // Set final response metadata from completed response
            if (completedResponse) {
              const r = completedResponse as Record<string, unknown>;
              currentEvent.response_metadata = {
                ...currentEvent.response_metadata,
                openai_response_id: (r as { id?: string }).id,
                model: (r as { model?: string }).model
              };
            }
            
            streamCompleted = true;
            debugResponseData.completion_events.push({
              type: 'response.completed',
              timestamp: Date.now(),
              action: 'sending_done'
            });
            console.log('🔚 [DEBUG] Sending done event from response.completed');
            yield { type: 'done' };
            console.log('🔚 [DEBUG] Returned after done event from response.completed');
            return;
            
          case 'message_start':
            if (!hasStarted) {
              // Emit unified event at the first assistant signal so the route can send event_start
              yield { type: 'event', data: { event: currentEvent } } as unknown as StreamEvent;
              hasStarted = true;
            }
            // Capture the message ID for the text content that follows
            currentMessageId = streamEvent.item_id as string;
            
            // Debug: Track message item
            debugResponseData.message_items.push({
              id: currentMessageId,
              role: 'assistant',
              content_preview: '[message starting...]'
            });
            // console.log('💬 [Responses Provider] Message started with ID:', currentMessageId);
            break;
            
          case 'text_start':
            if (!hasStarted) {
              yield { type: 'event', data: { event: currentEvent } } as unknown as StreamEvent;
              hasStarted = true;
            }
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
            if (!hasStarted) {
              yield { type: 'event', data: { event: currentEvent } } as unknown as StreamEvent;
              hasStarted = true;
            }
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
            if (!hasStarted) {
              yield { type: 'event', data: { event: currentEvent } } as unknown as StreamEvent;
              hasStarted = true;
            }
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
            
            // Debug: Track reasoning item
            debugResponseData.reasoning_items.push({
              id: reasoningSegment.id,
              summary: [],
              output_index: reasoningSegment.output_index,
              sequence_number: reasoningSegment.sequence_number
            });
            
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
            if (!hasStarted) {
              yield { type: 'event', data: { event: currentEvent } } as unknown as StreamEvent;
              hasStarted = true;
            }
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
            
          case 'web_search_call_in_progress':
          case 'web_search_call_searching':
          case 'web_search_call_completed':
            // Pass through built-in Web Search events so the frontend can render segments
            yield {
              type: streamEvent.type,
              data: {
                item_id: streamEvent.item_id,
                output_index: streamEvent.output_index,
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;

          case 'code_interpreter_call_in_progress':
          case 'code_interpreter_call_interpreting':
          case 'code_interpreter_call_completed':
            // Pass through Code Interpreter lifecycle events
            yield {
              type: streamEvent.type,
              data: {
                item_id: streamEvent.item_id,
                output_index: streamEvent.output_index,
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;

          case 'code_interpreter_call_code_delta':
            // Pass through streaming code delta
            yield {
              type: 'code_interpreter_call_code_delta',
              data: {
                item_id: streamEvent.item_id,
                delta: streamEvent.delta,
                output_index: streamEvent.output_index,
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;

          case 'code_interpreter_call_code_done':
            // Pass through final code content
            yield {
              type: 'code_interpreter_call_code_done',
              data: {
                item_id: streamEvent.item_id,
                code: streamEvent.code,
                output_index: streamEvent.output_index,
                sequence_number: streamEvent.sequence_number
              }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
            break;
            
          case 'response.output_text.annotation.added':
            // Handle URL citations - add to the current text segment (optimized)
            const ann = (streamEvent as { annotation?: { type?: string; url: string; title?: string; start_index?: number; end_index?: number } }).annotation;
            if (ann?.type === 'url_citation') {
              // Find the text segment that contains this citation
              const textSegmentIndex = currentEvent.segments.findIndex(s => s.type === 'text');
              if (textSegmentIndex >= 0) {
                const textSegment = currentEvent.segments[textSegmentIndex] as { type: 'text'; text: string; citations?: Array<{url: string; title: string; start_index: number; end_index: number}> };
                
                // Add citations array if it doesn't exist
                if (!textSegment.citations) {
                  textSegment.citations = [];
                }
                
                // Add the citation
                textSegment.citations.push({
                  url: ann.url,
                  title: ann.title || 'Source',
                  start_index: ann.start_index || 0,
                  end_index: ann.end_index || 0
                });
                
                // Don't yield individual citation events - just batch them with the final result
                // This prevents excessive yielding that slows down the stream
              }
            }
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
            // Fallback completion event - set metadata if we haven't received response.completed
            console.log('🔚 [DEBUG] Processing complete fallback event');
            debugResponseData.completion_events.push({
              type: 'complete',
              timestamp: Date.now(),
              action: 'processing'
            });
            
            // If we don't have response metadata yet, we can't get usage info but set what we can
            if (!currentEvent.response_metadata?.openai_response_id && debugResponseData.response_id) {
              currentEvent.response_metadata = {
                ...currentEvent.response_metadata,
                openai_response_id: debugResponseData.response_id
              };
            }
            
            streamCompleted = true;
            debugResponseData.completion_events.push({
              type: 'complete',
              timestamp: Date.now(),
              action: 'sending_done'
            });
            console.log('🔚 [DEBUG] Sending done event from complete fallback');
            yield { type: 'done' };
            console.log('🔚 [DEBUG] Returned after done event from complete fallback');
            return;
            
          case 'finalize_only':
            // Just finalize without sending done
            break;
        }
        }
        
        // Stream ended without completion event - this should NOT happen
        if (!streamCompleted) {
          debugResponseData.completion_events.push({
            type: 'stream_end_fallback',
            timestamp: Date.now(),
            action: 'processing'
          });
          console.log('⚠️ [DEBUG] Stream ended without completion event - sending fallback done');
          debugResponseData.completion_events.push({
            type: 'stream_end_fallback',
            timestamp: Date.now(),
            action: 'sending_done'
          });
          yield { type: 'done' };
          console.log('🔚 [DEBUG] Sent fallback done event from stream end');
        } else {
          console.log('✅ [DEBUG] Stream ended after proper completion');
        }
        
        // Log completion event summary
        console.log('📊 [DEBUG] Completion events summary:', debugResponseData.completion_events);
      
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
    
    // Debug: Collect all reasoning segments from our stored events
    const storedReasoningSegments = events.flatMap(e => 
      e.segments
        .filter((s): s is Extract<typeof e.segments[number], { type: 'reasoning' }> => s.type === 'reasoning')
        .map((s) => ({
          id: s.id,
          partsCount: s.parts.length || 0,
          combinedText: s.combined_text || '',
          outputIndex: s.output_index,
          sequenceNumber: s.sequence_number,
          isEmpty: s.parts.length === 0 && !(s.combined_text && s.combined_text.trim())
        }))
    );
    
    
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
        // Simply flatten segments in their original order - this preserves the reasoning->output relationship
        for (const segment of event.segments) {
          if (segment.type === 'reasoning') {
            // Convert reasoning parts to summary array
            const summary = segment.parts?.map(part => ({
              type: part.type,
              text: part.text
            })) || [];
            
            // Always include reasoning segments, even if empty
            // OpenAI requires all reasoning segments that are referenced by messages
            items.push({
              id: segment.id,
              type: 'reasoning',
              summary: summary
            });
          } else if (segment.type === 'text') {
            // Add text as a message with the segment's ID if available
            const messageId = segment.id || `msg_${messageIndex++}`;
            
            items.push({
              id: messageId,
              type: 'message',
              role: 'assistant',
              content: [{ 
                type: 'output_text',
                text: segment.text
              }]
            });
          } else if (segment.type === 'tool_call') {
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
    
    const finalReasoningItems = items.filter(item => item.type === 'reasoning');
    const originalReasoningIds = storedReasoningSegments.map(s => s.id);
    const finalReasoningIds = finalReasoningItems.map(item => item.id);
    const skippedReasoningIds = originalReasoningIds.filter(id => !finalReasoningIds.includes(id));
    
    
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
