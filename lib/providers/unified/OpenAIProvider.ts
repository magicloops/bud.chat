// OpenAI provider implementation
import OpenAI from 'openai';
import { BaseProvider } from './BaseProvider';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent, 
  ValidationResult, 
  ProviderFeature 
} from './types';
import { Event, EventLog, createTextEvent, createToolCallEvent, ReasoningPart } from '@/lib/types/events';
import { getApiModelName, isReasoningModel, supportsTemperature } from '@/lib/modelMapping';

export class OpenAIProvider extends BaseProvider {
  readonly name = 'OpenAI';
  readonly provider = 'openai' as const;
  private client: OpenAI;
  
  constructor(apiKey?: string) {
    super();
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY!,
    });
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return {
      [ProviderFeature.TEMPERATURE]: true, // But not for reasoning models
      [ProviderFeature.REASONING]: true,
      [ProviderFeature.TOOL_CALLING]: true,
      [ProviderFeature.REASONING_EFFORT]: true,
      [ProviderFeature.SYSTEM_MESSAGE]: true,
      [ProviderFeature.STREAMING]: true,
      [ProviderFeature.VISION]: true
    };
  }
  
  protected validateProviderSpecific(config: Partial<UnifiedChatRequest>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Check model-specific constraints
    if (config.model && isReasoningModel(config.model)) {
      if (config.temperature !== undefined) {
        errors.push('Reasoning models do not support temperature setting');
      }
      if (config.mcpConfig?.tool_choice) {
        warnings.push('Tool choice may not work as expected with reasoning models');
      }
    }
    
    if (config.maxTokens && config.maxTokens > 128000) {
      warnings.push('Max tokens exceeds typical GPT-4 limits');
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const eventLog = new EventLog(request.events);
    const messages = eventLog.toProviderMessages('openai') as OpenAI.ChatCompletionMessageParam[];
    
    // Check if we should use Responses API for reasoning models
    if (isReasoningModel(request.model)) {
      return this.chatWithResponsesAPI(request, messages);
    }
    
    try {
      const chatParams: OpenAI.ChatCompletionCreateParams = {
        model: getApiModelName(request.model),
        messages,
        max_tokens: request.maxTokens,
      };
      
      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        chatParams.tools = request.tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || { type: 'object', properties: {} }
          }
        }));
        
        if (request.toolChoice) {
          if (request.toolChoice === 'none' || request.toolChoice === 'auto' || request.toolChoice === 'required') {
            chatParams.tool_choice = request.toolChoice;
          } else if (typeof request.toolChoice === 'object') {
            chatParams.tool_choice = request.toolChoice;
          }
        }
      }
      
      // Only add temperature if supported
      if (supportsTemperature(request.model) && request.temperature !== undefined) {
        chatParams.temperature = request.temperature;
      }
      
      const response = await this.client.chat.completions.create(chatParams);
      
      // Convert response to unified event format
      const event = this.convertOpenAIResponseToEvent(response.choices[0]);
      
      return {
        event,
        usage: {
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          totalTokens: response.usage?.total_tokens
        }
      };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    const eventLog = new EventLog(request.events);
    const messages = eventLog.toProviderMessages('openai') as OpenAI.ChatCompletionMessageParam[];
    
    console.log('🔍 [OpenAI Provider] Stream request:', {
      model: request.model,
      isReasoningModel: isReasoningModel(request.model),
      eventCount: request.events.length,
      messageCount: messages.length,
      messages: messages.map(m => ({
        role: m.role,
        contentLength: typeof m.content === 'string' ? m.content.length : 'complex',
        contentPreview: typeof m.content === 'string' ? m.content.substring(0, 100) + '...' : 'complex content'
      }))
    });
    
    // Check if we should use Responses API for reasoning models
    if (isReasoningModel(request.model)) {
      yield* this.streamWithResponsesAPI(request, messages);
      return;
    }
    
    try {
      const chatParams: OpenAI.ChatCompletionCreateParams = {
        model: getApiModelName(request.model),
        messages,
        max_tokens: request.maxTokens,
        stream: true,
      };
      
      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        chatParams.tools = request.tools.map(tool => ({
          type: 'function' as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || { type: 'object', properties: {} }
          }
        }));
        
        if (request.toolChoice) {
          if (request.toolChoice === 'none' || request.toolChoice === 'auto' || request.toolChoice === 'required') {
            chatParams.tool_choice = request.toolChoice;
          } else if (typeof request.toolChoice === 'object') {
            chatParams.tool_choice = request.toolChoice;
          }
        }
      }
      
      // Only add temperature if supported
      if (supportsTemperature(request.model) && request.temperature !== undefined) {
        chatParams.temperature = request.temperature;
      }
      
      const stream = await this.client.chat.completions.create(chatParams);
      
      let currentEvent: Event = {
        id: crypto.randomUUID(),
        role: 'assistant',
        segments: [],
        ts: Date.now()
      };
      
      let currentText = '';
      let currentToolCalls: Map<number, OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall> = new Map();
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          currentText += delta.content;
          
          yield {
            type: 'segment',
            data: {
              segment: { type: 'text', text: currentText },
              segmentIndex: 0
            }
          };
        }
        
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            if (toolCall.index !== undefined) {
              const existing = currentToolCalls.get(toolCall.index) || {
                id: '',
                type: 'function' as const,
                function: { name: '', arguments: '' }
              };
              
              if (toolCall.id) existing.id = toolCall.id;
              if (toolCall.function?.name) existing.function!.name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                existing.function!.arguments += toolCall.function.arguments;
              }
              
              currentToolCalls.set(toolCall.index, existing);
            }
          }
        }
        
        if (chunk.choices[0]?.finish_reason) {
          // Finalize the event
          if (currentText) {
            currentEvent.segments.push({ type: 'text', text: currentText });
          }
          
          // Add tool calls
          for (const [_, toolCall] of currentToolCalls) {
            if (toolCall.function?.name && toolCall.function?.arguments) {
              try {
                const args = JSON.parse(toolCall.function.arguments);
                currentEvent.segments.push({
                  type: 'tool_call',
                  id: toolCall.id!,
                  name: toolCall.function.name,
                  args
                });
              } catch (e) {
                console.error('Failed to parse tool call arguments:', e);
              }
            }
          }
          
          yield {
            type: 'event',
            data: { event: currentEvent }
          };
        }
      }
      
      yield { type: 'done' };
      
    } catch (error) {
      yield {
        type: 'error',
        data: { error: this.handleProviderError(error).message }
      };
    }
  }
  
  // Responses API implementation for reasoning models
  private async chatWithResponsesAPI(
    request: UnifiedChatRequest, 
    messages: OpenAI.ChatCompletionMessageParam[]
  ): Promise<UnifiedChatResponse> {
    try {
      // Convert messages to Responses API format
      // Filter out tool messages as they're not supported by Responses API
      const responsesMessages = messages
        .filter(msg => msg.role !== 'tool')
        .map(msg => {
          if (msg.role === 'system') {
            return { role: 'system' as const, content: msg.content as string };
          } else if (msg.role === 'user') {
            return { role: 'user' as const, content: msg.content as string };
          } else if (msg.role === 'assistant') {
            return { role: 'assistant' as const, content: msg.content as string };
          }
          return msg;
        }) as OpenAI.Responses.Message[];
      
      const params: OpenAI.Responses.CreateParams = {
        model: getApiModelName(request.model),
        input: responsesMessages,
        max_output_tokens: request.maxTokens || 8000,
      };
      
      // Add reasoning configuration for o-series models
      // This enables reasoning summaries to be streamed
      (params as any).reasoning = {
        effort: request.reasoningEffort || 'medium',
        summary: 'auto' // This enables reasoning summaries
      };
      
      const response = await this.client.responses.create(params);
      
      // Convert response to unified event format
      const segments: Event['segments'] = [];
      
      if (response.output) {
        for (const output of response.output) {
          if (output.type === 'text' && output.content) {
            segments.push({ type: 'text', text: output.content });
          } else if (output.type === 'function_call') {
            segments.push({
              type: 'tool_call',
              id: output.id || crypto.randomUUID(),
              name: output.name,
              args: output.arguments ? JSON.parse(output.arguments) : {}
            });
          }
        }
      }
      
      const event: Event = {
        id: response.id,
        role: 'assistant',
        segments,
        ts: Date.now(),
        response_metadata: {
          reasoning_content: response.reasoning_content || undefined
        }
      };
      
      return {
        event,
        usage: {
          promptTokens: response.usage?.input_tokens,
          completionTokens: response.usage?.output_tokens,
          totalTokens: response.usage?.total_tokens
        }
      };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  private async *streamWithResponsesAPI(
    request: UnifiedChatRequest,
    messages: OpenAI.ChatCompletionMessageParam[]
  ): AsyncGenerator<StreamEvent> {
    try {
      // Import the Responses API stream processor
      const { processResponsesAPIStream } = await import('@/lib/providers/openaiResponses');
      
      // Convert messages to Responses API format
      // Filter out tool messages as they're not supported by Responses API
      const responsesMessages = messages
        .filter(msg => msg.role !== 'tool')
        .map(msg => {
          if (msg.role === 'system') {
            return { role: 'system' as const, content: msg.content as string };
          } else if (msg.role === 'user') {
            return { role: 'user' as const, content: msg.content as string };
          } else if (msg.role === 'assistant') {
            return { role: 'assistant' as const, content: msg.content as string };
          }
          return msg;
        }) as OpenAI.Responses.Message[];
      
      console.log('🔍 [OpenAI Provider] Responses API input:', {
        messageCount: responsesMessages.length,
        messages: responsesMessages.map(m => ({
          role: m.role,
          contentLength: m.content.length,
          contentPreview: m.content.substring(0, 100) + '...'
        }))
      });
      
      const params: OpenAI.Responses.CreateParams = {
        model: getApiModelName(request.model),
        input: responsesMessages,
        max_output_tokens: request.maxTokens || 8000,
        stream: true,
      };
      
      // For Responses API, we need to check if we have remote MCP configuration
      // The tools should come from the bud's MCP config, not as individual tool definitions
      if (request.mcpConfig?.remote_servers && request.mcpConfig.remote_servers.length > 0) {
        console.log('🔧 [OpenAI Provider] Adding remote MCP servers to Responses API:', {
          serverCount: request.mcpConfig.remote_servers.length,
          servers: request.mcpConfig.remote_servers.map(s => ({ 
            label: s.server_label, 
            url: s.server_url,
            hasAllowedTools: !!s.allowed_tools?.length
          }))
        });
        
        (params as any).tools = request.mcpConfig.remote_servers.map(server => ({
          type: 'mcp' as const,
          server_label: server.server_label,
          server_url: server.server_url,
          require_approval: server.require_approval || 'always',
          allowed_tools: server.allowed_tools,
          headers: server.headers
        }));
      } else if (request.tools && request.tools.length > 0) {
        // For local MCP tools, we'd need to convert them differently
        // But Responses API doesn't support local MCP tools directly
        console.log('⚠️ [OpenAI Provider] Local MCP tools detected but not supported in Responses API');
      }
      
      // Add reasoning configuration for o-series models
      // This enables reasoning summaries to be streamed
      (params as any).reasoning = {
        effort: request.reasoningEffort || 'medium',
        summary: 'auto' // This enables reasoning summaries
      };
      
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
              let textSegment = currentEvent.segments.find(s => s.type === 'text');
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
            
          case 'tool_start':
            const toolSegment = {
              type: 'tool_call' as const,
              id: streamEvent.tool_id,
              name: streamEvent.tool_name,
              args: {}
            };
            currentEvent.segments.push(toolSegment);
            
            yield {
              type: 'segment',
              data: {
                segment: toolSegment,
                segmentIndex: currentEvent.segments.length - 1
              }
            };
            break;
            
          case 'tool_finalized':
            // Update the tool segment with final args
            const toolIndex = currentEvent.segments.findIndex(
              s => s.type === 'tool_call' && s.id === streamEvent.tool_id
            );
            if (toolIndex >= 0) {
              (currentEvent.segments[toolIndex] as any).args = streamEvent.args;
            }
            break;
            
          case 'mcp_tool_start':
            const mcpToolSegment = {
              type: 'tool_call' as const,
              id: streamEvent.tool_id,
              name: streamEvent.tool_name,
              args: {},
              metadata: {
                server_label: streamEvent.server_label,
                server_type: streamEvent.server_type || 'remote_mcp',
                display_name: streamEvent.display_name || streamEvent.tool_name
              }
            };
            currentEvent.segments.push(mcpToolSegment);
            
            yield {
              type: 'segment',
              data: {
                segment: mcpToolSegment,
                segmentIndex: currentEvent.segments.length - 1
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
            }
            break;
            
          case 'mcp_approval_request':
            // Handle MCP approval request - for now, log it
            console.log('🔐 [OpenAI Provider] MCP approval request:', {
              tool_name: streamEvent.tool_name,
              server_label: streamEvent.server_label,
              approval_request_id: streamEvent.approval_request_id
            });
            // In a real implementation, this would trigger a UI prompt
            // For now, we've set require_approval: 'none' to avoid this
            break;
            
          case 'reasoning_start':
            // Create a reasoning segment
            const reasoningSegment = {
              type: 'reasoning' as const,
              id: streamEvent.item_id || crypto.randomUUID(),
              output_index: streamEvent.output_index || 0,
              sequence_number: streamEvent.sequence_number || 0,
              parts: []
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
            
          case 'reasoning_content':
          case 'reasoning_summary_text_delta':
          case 'reasoning_summary_delta':
            // Find the reasoning segment and update it
            const reasoningIndex = currentEvent.segments.findIndex(
              s => s.type === 'reasoning' && s.id === streamEvent.item_id
            );
            if (reasoningIndex >= 0) {
              const reasoningSeg = currentEvent.segments[reasoningIndex] as any;
              
              // Add or update the reasoning part
              const summaryIdx = streamEvent.summary_index ?? 0;
              const textContent = streamEvent.content || streamEvent.delta || '';
              
              const part: ReasoningPart = {
                summary_index: summaryIdx,
                type: 'summary_text',
                text: textContent,
                sequence_number: streamEvent.sequence_number || 0,
                is_complete: false,
                created_at: Date.now()
              };
              
              // Find existing part or add new one
              const existingPartIndex = reasoningSeg.parts.findIndex(
                (p: ReasoningPart) => p.summary_index === summaryIdx
              );
              if (existingPartIndex >= 0) {
                reasoningSeg.parts[existingPartIndex].text += textContent;
              } else {
                reasoningSeg.parts.push(part);
              }
              
              // Yield update event for frontend
              yield {
                type: 'segment',
                data: {
                  segment: reasoningSeg,
                  segmentIndex: reasoningIndex
                }
              };
            }
            
            // Also store in metadata for backward compatibility
            if (!currentEvent.response_metadata) {
              currentEvent.response_metadata = {};
            }
            if (!currentEvent.response_metadata.reasoning_content) {
              currentEvent.response_metadata.reasoning_content = '';
            }
            currentEvent.response_metadata.reasoning_content += streamEvent.content || streamEvent.delta || '';
            break;
            
          case 'reasoning_summary_text_done':
          case 'reasoning_summary_done':
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
            }
            break;
            
          case 'error':
            yield {
              type: 'error',
              data: { error: streamEvent.error || 'Unknown error' }
            };
            return;
            
          case 'complete':
            yield { type: 'done' };
            return;
        }
      }
      
      yield { type: 'done' };
      
    } catch (error) {
      yield {
        type: 'error',
        data: { error: this.handleProviderError(error).message }
      };
    }
  }
  
  private convertOpenAIResponseToEvent(choice: OpenAI.ChatCompletion.Choice): Event {
    const segments: Event['segments'] = [];
    
    if (choice.message.content) {
      segments.push({ type: 'text', text: choice.message.content });
    }
    
    if (choice.message.tool_calls) {
      for (const toolCall of choice.message.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          segments.push({
            type: 'tool_call',
            id: toolCall.id,
            name: toolCall.function.name,
            args
          });
        } catch (e) {
          console.error('Failed to parse tool call arguments:', e);
        }
      }
    }
    
    return {
      id: crypto.randomUUID(),
      role: choice.message.role as Event['role'],
      segments,
      ts: Date.now()
    };
  }
}