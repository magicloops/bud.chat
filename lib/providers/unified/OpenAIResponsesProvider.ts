// OpenAI Responses API Provider (for reasoning models)
import OpenAI from 'openai';
import { OpenAIBaseProvider } from './OpenAIBaseProvider';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent,
  ProviderFeature 
} from './types';
import { 
  Event, 
  EventLog,
  ReasoningPart,
  Segment
} from '@/lib/types/events';
import { generateToolCallId } from '@/lib/types/branded';

export class OpenAIResponsesProvider extends OpenAIBaseProvider {
  name = 'openai-responses' as const;
  
  supportsFeature(feature: ProviderFeature): boolean {
    const responsesFeatures = [
      ProviderFeature.REASONING,
      ProviderFeature.REASONING_EFFORT,
      ProviderFeature.MCP_TOOLS,
    ];
    
    return super.supportsFeature(feature) || responsesFeatures.includes(feature);
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const inputItems = this.convertEventsToInputItems(request.events);
      
      const params: OpenAI.Responses.CreateParams = {
        model: this.getModelName(request.model),
        input: inputItems,
        max_output_tokens: request.maxTokens || 8000,
      };
      
      // Add remote MCP tools if configured
      if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
        (params as any).tools = request.mcpConfig.remote_servers.map(server => ({
          type: 'mcp' as const,
          server_label: server.server_label,
          server_url: server.server_url,
          require_approval: server.require_approval || 'never', // Default to 'never' to allow tool execution
          allowed_tools: server.allowed_tools,
          headers: server.headers
        }));
      }
      
      // Add reasoning configuration
      (params as any).reasoning = {
        effort: request.reasoningEffort || 'medium',
        summary: 'auto'
      };
      
      const response = await this.client.responses.create(params);
      
      // Convert response output to Event
      const event = this.convertResponseToEvent(response);
      
      return {
        event,
        usage: response.usage ? {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens
        } : undefined
      };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    try {
      // Import the Responses API stream processor
      const { processResponsesAPIStream } = await import('@/lib/providers/openaiResponses');
      
      const inputItems = this.convertEventsToInputItems(request.events);
      
      console.log('📋 [Responses API] Input items:', inputItems.map((item, idx) => ({
        index: idx,
        type: item.type,
        id: item.id,
        ...(item.type === 'message' ? { role: item.role, contentLength: item.content?.length } : {}),
        ...(item.type === 'reasoning' ? { summaryCount: item.summary?.length } : {}),
        ...(item.type === 'mcp_call' ? { name: item.name, hasOutput: !!item.output } : {})
      })));
      
      
      const params: OpenAI.Responses.CreateParams = {
        model: this.getModelName(request.model),
        input: inputItems,
        max_output_tokens: request.maxTokens || 8000,
        stream: true,
      };
      
      // Add remote MCP tools if configured
      if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
        (params as any).tools = request.mcpConfig.remote_servers.map(server => ({
          type: 'mcp' as const,
          server_label: server.server_label,
          server_url: server.server_url,
          require_approval: server.require_approval || 'never', // Default to 'never' to allow tool execution
          allowed_tools: server.allowed_tools,
          headers: server.headers
        }));
      }
      
      // Add reasoning configuration
      (params as any).reasoning = {
        effort: request.reasoningEffort || 'medium',
        summary: 'auto'
      };
      
      console.log('📤 [Responses API] Sending request with params:', JSON.stringify(params, null, 2));
      
      const stream = await this.client.responses.create(params);
      
      // Process the stream using the existing processor
      const processedStream = processResponsesAPIStream(stream);
      
      let currentEvent: Event = {
        id: crypto.randomUUID(),
        role: 'assistant',
        segments: [],
        ts: Date.now()
      };
      
      let hasStarted = false;
      
      // Transform the processed stream to our unified format
      for await (const streamEvent of processedStream) {
        // Log unhandled events
        const handledTypes = [
          'token', 'reasoning_start', 'reasoning_summary_text_delta', 
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
          case 'token':
            if (streamEvent.content) {
              // Find or create text segment
              let textSegment = currentEvent.segments.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
              if (!textSegment) {
                textSegment = { type: 'text', text: '' };
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
              id: streamEvent.item_id || crypto.randomUUID(),
              output_index: streamEvent.output_index || 0,
              sequence_number: streamEvent.sequence_number || 0,
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
              const reasoningSegForAdd = currentEvent.segments[reasoningIdxForAdd] as any;
              
              // Extract initial text from the part if available
              const partData = streamEvent.part || {};
              const newPart = {
                summary_index: streamEvent.summary_index || 0,
                type: partData.type || 'summary_text',
                text: partData.text || '',
                sequence_number: streamEvent.sequence_number || 0,
                is_complete: false,
                created_at: Date.now()
              };
              reasoningSegForAdd.parts.push(newPart);
              
              // Yield the raw event
              yield {
                type: 'reasoning_summary_part_added' as any,
                data: {
                  item_id: streamEvent.item_id,
                  summary_index: streamEvent.summary_index,
                  part: partData,
                  sequence_number: streamEvent.sequence_number
                }
              };
            }
            break;
            
          case 'reasoning_summary_text_delta':
          case 'reasoning_summary_delta':
            // Find the reasoning segment and update it
            const reasoningIndex = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIndex >= 0) {
              const reasoningSeg = currentEvent.segments[reasoningIndex] as any;
              
              const summaryIdx = streamEvent.summary_index ?? 0;
              const textContent = streamEvent.delta || '';
              
              // Find or create the part
              let part = reasoningSeg.parts.find((p: ReasoningPart) => p.summary_index === summaryIdx);
              if (!part) {
                part = {
                  summary_index: summaryIdx,
                  type: 'summary_text',
                  text: '',
                  sequence_number: streamEvent.sequence_number || 0,
                  is_complete: false,
                  created_at: Date.now()
                };
                reasoningSeg.parts.push(part);
              }
              
              part.text += textContent;
              
              // Yield the raw reasoning delta event so it can be properly handled by the route
              yield {
                type: 'reasoning_summary_text_delta' as any,
                data: {
                  item_id: streamEvent.item_id,
                  summary_index: summaryIdx,
                  delta: textContent,
                  sequence_number: streamEvent.sequence_number
                }
              };
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
              const reasoningSegDone = currentEvent.segments[reasoningIdxDone] as any;
              const summaryIdxDone = streamEvent.summary_index ?? 0;
              const partIdxDone = reasoningSegDone.parts.findIndex(
                (p: ReasoningPart) => p.summary_index === summaryIdxDone
              );
              if (partIdxDone >= 0) {
                reasoningSegDone.parts[partIdxDone].is_complete = true;
                if (streamEvent.text) {
                  reasoningSegDone.parts[partIdxDone].text = streamEvent.text;
                }
              }
              
              // Yield the proper event type
              if (streamEvent.type === 'reasoning_summary_part_done') {
                yield {
                  type: 'reasoning_summary_part_done' as any,
                  data: {
                    item_id: streamEvent.item_id,
                    summary_index: summaryIdxDone,
                    sequence_number: streamEvent.sequence_number
                  }
                };
              }
            }
            break;
            
          case 'reasoning_complete':
            // Mark the entire reasoning segment as complete
            const reasoningIdxComplete = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIdxComplete >= 0) {
              const reasoningSegComplete = currentEvent.segments[reasoningIdxComplete] as any;
              reasoningSegComplete.streaming = false;
              
              // If we have combined text, update the segment
              if (streamEvent.combined_text) {
                reasoningSegComplete.combined_text = streamEvent.combined_text;
              }
              
              // Yield the reasoning complete event
              yield {
                type: 'reasoning_complete' as any,
                data: {
                  item_id: streamEvent.item_id,
                  parts: reasoningSegComplete.parts,
                  combined_text: streamEvent.combined_text,
                  output_index: streamEvent.output_index,
                  sequence_number: streamEvent.sequence_number
                }
              };
            }
            break;
            
          case 'mcp_tool_start':
            // For MCP tools, use the tool ID from the stream directly
            const mcpToolId = streamEvent.tool_id;
            const mcpToolSegment: Segment = {
              type: 'tool_call',
              id: mcpToolId, // Use the MCP tool ID directly
              name: streamEvent.tool_name,
              args: {},
              sequence_number: streamEvent.sequence_number,
              output_index: streamEvent.output_index,
              metadata: {
                server_label: streamEvent.server_label,
                server_type: streamEvent.server_type || 'remote_mcp',
                display_name: streamEvent.display_name || streamEvent.tool_name
              }
            };
            // No need to map since we're using the original ID
            currentEvent.segments.push(mcpToolSegment);
            
            // Yield the proper MCP tool start event for frontend
            yield {
              type: 'mcp_tool_start' as any,
              data: {
                tool_id: mcpToolId,
                tool_name: streamEvent.tool_name,
                server_label: streamEvent.server_label,
                display_name: streamEvent.display_name || streamEvent.tool_name,
                server_type: streamEvent.server_type || 'remote_mcp',
                output_index: streamEvent.output_index,
                sequence_number: streamEvent.sequence_number
              }
            };
            break;
            
          case 'mcp_tool_finalized':
            // Update the MCP tool segment with final args
            const mcpToolIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (mcpToolIndex >= 0) {
              (currentEvent.segments[mcpToolIndex] as any).args = streamEvent.args;
              
              // Yield the MCP tool finalized event
              yield {
                type: 'mcp_tool_finalized' as any,
                data: {
                  tool_id: streamEvent.tool_id,
                  args: streamEvent.args
                }
              };
            }
            break;
            
          case 'mcp_tool_complete':
            // For Responses API, update the existing tool_call segment with the output
            const toolCallIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (toolCallIndex >= 0) {
              const toolCallSegment = currentEvent.segments[toolCallIndex] as any;
              toolCallSegment.output = streamEvent.output || {};
              if (streamEvent.error) {
                toolCallSegment.error = streamEvent.error;
              }
            }
            
            // Yield the MCP tool complete event
            yield {
              type: 'mcp_tool_complete' as any,
              data: {
                tool_id: streamEvent.tool_id,
                output: streamEvent.output,
                error: streamEvent.error,
                sequence_number: streamEvent.sequence_number,
                output_index: streamEvent.output_index
              }
            };
            break;
            
          case 'error':
            yield {
              type: 'error',
              data: { error: streamEvent.error || 'Unknown error' }
            };
            return;
            
          case 'mcp_tool_arguments_delta':
            // Update tool arguments incrementally
            const toolIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (toolIndex >= 0) {
              const toolSegment = currentEvent.segments[toolIndex] as any;
              if (!toolSegment.args._raw) {
                toolSegment.args._raw = '';
              }
              toolSegment.args._raw += streamEvent.delta;
              
              // Yield the MCP tool arguments delta event
              yield {
                type: 'mcp_tool_arguments_delta' as any,
                data: {
                  tool_id: streamEvent.tool_id,
                  delta: streamEvent.delta
                }
              };
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
              type: 'progress_update' as any,
              data: {
                activity: streamEvent.activity,
                server_label: streamEvent.server_label,
                sequence_number: streamEvent.sequence_number
              }
            };
            break;
            
          case 'progress_hide':
            // Pass through progress hide events to frontend
            yield {
              type: 'progress_hide' as any,
              data: {
                sequence_number: streamEvent.sequence_number
              }
            };
            break;
            
          case 'complete':
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
  
  private convertEventsToInputItems(events: Event[]): any[] {
    const items: any[] = [];
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
              text: seg.text 
            }))
        });
      } else if (event.role === 'assistant') {
        // Include assistant message with text content only
        const textSegments = event.segments.filter(seg => seg.type === 'text');
        if (textSegments.length > 0) {
          items.push({
            id: `msg_${messageIndex++}`,
            type: 'message',
            role: 'assistant',
            content: textSegments.map(seg => ({ 
              type: 'output_text',
              text: seg.text 
            }))
          });
        }
        
        // Process segments in their original order
        // Build a list of items while tracking if reasoning should be kept
        const segmentItems: any[] = [];
        
        for (let i = 0; i < event.segments.length; i++) {
          const segment = event.segments[i];
          
          if (segment.type === 'reasoning') {
            // Convert reasoning parts to summary array
            const summary = segment.parts?.map(part => ({
              type: part.type,
              text: part.text
            })) || [];
            
            const hasContent = summary.some(s => s.text && s.text.trim().length > 0);
            
            // Check if the next segment is a tool call
            const nextSegment = event.segments[i + 1];
            const isFollowedByToolCall = nextSegment && nextSegment.type === 'tool_call';
            
            // Include reasoning if it has content OR is followed by a tool call
            if (hasContent || isFollowedByToolCall) {
              segmentItems.push({
                id: segment.id,
                type: 'reasoning',
                summary: summary
              });
              
              if (!hasContent && isFollowedByToolCall) {
                console.log('📌 [Responses API] Keeping empty reasoning summary before tool call:', {
                  reasoningId: segment.id,
                  nextToolId: nextSegment.id
                });
              }
            } else {
              console.log('🚫 [Responses API] Filtering out empty reasoning summary:', {
                id: segment.id,
                hasContent,
                isFollowedByToolCall
              });
            }
          } else if (segment.type === 'tool_call') {
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
            
            segmentItems.push(mcpCall);
          }
        }
        
        // Add all the items we collected
        items.push(...segmentItems);
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
            id: output.id || crypto.randomUUID(),
            name: output.name,
            args: output.arguments ? JSON.parse(output.arguments) : {},
            metadata: {
              server_label: output.server_label
            }
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
      ts: Date.now(),
      response_metadata: {
        reasoning_content: response.reasoning_content
      }
    };
  }
  
  private getItemPreview(item: any): string {
    if (item.type === 'message' && item.content?.[0]?.text) {
      return item.content[0].text.substring(0, 100) + '...';
    }
    if (item.type === 'mcp_call') {
      return `${item.name}(${item.arguments?.substring(0, 50)}...)`;
    }
    return '';
  }
}