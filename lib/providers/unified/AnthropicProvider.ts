// Anthropic provider implementation
import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './BaseProvider';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent, 
  ValidationResult, 
  ProviderFeature 
} from './types';
import { Event, EventLog, createTextEvent, createToolCallEvent, createToolResultEvent, createMixedEvent } from '@/lib/types/events';
import { getApiModelName } from '@/lib/modelMapping';

export class AnthropicProvider extends BaseProvider {
  readonly name = 'Anthropic';
  readonly provider = 'anthropic' as const;
  private client: Anthropic;
  
  constructor(apiKey?: string) {
    super();
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY!,
    });
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return {
      [ProviderFeature.TEMPERATURE]: true,
      [ProviderFeature.REASONING]: false,
      [ProviderFeature.TOOL_CALLING]: true,
      [ProviderFeature.REASONING_EFFORT]: false,
      [ProviderFeature.SYSTEM_MESSAGE]: true,
      [ProviderFeature.STREAMING]: true,
      [ProviderFeature.VISION]: true
    };
  }
  
  protected validateProviderSpecific(config: Partial<UnifiedChatRequest>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    if (config.maxTokens && config.maxTokens > 200000) {
      warnings.push('Max tokens exceeds typical Claude limits');
    }
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const eventLog = new EventLog(request.events);
    const messages = eventLog.toProviderMessages('anthropic') as Anthropic.MessageParam[];
    const systemMessage = eventLog.getSystemMessage();
    
    try {
      const anthropicRequest: Anthropic.MessageCreateParams = {
        model: getApiModelName(request.model),
        messages,
        system: systemMessage || undefined,
        temperature: request.temperature,
        max_tokens: request.maxTokens || 4096,
      };
      
      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        anthropicRequest.tools = request.tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          input_schema: tool.parameters || { type: 'object', properties: {} }
        }));
        
        if (request.toolChoice) {
          if (request.toolChoice === 'required') {
            anthropicRequest.tool_choice = { type: 'any' };
          } else if (request.toolChoice === 'none') {
            anthropicRequest.tool_choice = { type: 'none' };
          } else if (typeof request.toolChoice === 'object') {
            anthropicRequest.tool_choice = { 
              type: 'tool', 
              name: request.toolChoice.function.name 
            };
          }
          // 'auto' is the default, no need to set
        }
      }
      
      const response = await this.client.messages.create(anthropicRequest);
      
      // Convert response to unified event format
      const event = this.convertAnthropicResponseToEvent(response);
      
      return {
        event,
        usage: {
          promptTokens: response.usage?.input_tokens,
          completionTokens: response.usage?.output_tokens,
          totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
      };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    const eventLog = new EventLog(request.events);
    const messages = eventLog.toProviderMessages('anthropic') as Anthropic.MessageParam[];
    const systemMessage = eventLog.getSystemMessage();
    
    try {
      const anthropicRequest: Anthropic.MessageCreateParams = {
        model: getApiModelName(request.model),
        messages,
        system: systemMessage || undefined,
        temperature: request.temperature,
        max_tokens: request.maxTokens || 4096,
        stream: true,
      };
      
      // Add tools if provided
      if (request.tools && request.tools.length > 0) {
        anthropicRequest.tools = request.tools.map(tool => ({
          name: tool.name,
          description: tool.description || '',
          input_schema: tool.parameters || { type: 'object', properties: {} }
        }));
        
        if (request.toolChoice) {
          if (request.toolChoice === 'required') {
            anthropicRequest.tool_choice = { type: 'any' };
          } else if (request.toolChoice === 'none') {
            anthropicRequest.tool_choice = { type: 'none' };
          } else if (typeof request.toolChoice === 'object') {
            anthropicRequest.tool_choice = { 
              type: 'tool', 
              name: request.toolChoice.function.name 
            };
          }
        }
      }
      
      const stream = await this.client.messages.create(anthropicRequest);
      
      let currentEvent: Event | null = null;
      let currentText = '';
      let currentToolCalls: Array<{ id: string; name: string; input: string }> = [];
      
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          currentEvent = {
            id: crypto.randomUUID(),
            role: 'assistant',
            segments: [],
            ts: Date.now()
          };
        }
        
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'text') {
            currentText = '';
          } else if (chunk.content_block.type === 'tool_use') {
            currentToolCalls.push({
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: ''
            });
          }
        }
        
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            currentText += chunk.delta.text;
            
            // Emit text segment update
            if (currentEvent) {
              yield {
                type: 'segment',
                data: {
                  segment: { type: 'text', text: currentText },
                  segmentIndex: 0 // TODO: Track actual segment index
                }
              };
            }
          } else if (chunk.delta.type === 'input_json_delta') {
            // Update tool call input
            const toolIndex = currentToolCalls.length - 1;
            if (toolIndex >= 0) {
              currentToolCalls[toolIndex].input += chunk.delta.partial_json;
            }
          }
        }
        
        if (chunk.type === 'content_block_stop') {
          if (currentEvent && chunk.index !== undefined) {
            // Finalize the segment
            if (currentText) {
              currentEvent.segments.push({ type: 'text', text: currentText });
              currentText = '';
            }
            
            // Check if we have a complete tool call
            const lastToolCall = currentToolCalls[currentToolCalls.length - 1];
            if (lastToolCall && lastToolCall.input) {
              try {
                const args = JSON.parse(lastToolCall.input);
                currentEvent.segments.push({
                  type: 'tool_call',
                  id: lastToolCall.id,
                  name: lastToolCall.name,
                  args
                });
              } catch (e) {
                console.error('Failed to parse tool call input:', e);
              }
            }
          }
        }
        
        if (chunk.type === 'message_delta' && chunk.usage) {
          // Final message with usage data
          if (currentEvent) {
            yield {
              type: 'event',
              data: { event: currentEvent }
            };
          }
        }
      }
      
      // Emit done event
      yield { type: 'done' };
      
    } catch (error) {
      yield {
        type: 'error',
        data: { error: this.handleProviderError(error).message }
      };
    }
  }
  
  private convertAnthropicResponseToEvent(response: Anthropic.Message): Event {
    const segments = response.content.map(content => {
      if (content.type === 'text') {
        return { type: 'text' as const, text: content.text };
      } else if (content.type === 'tool_use') {
        return {
          type: 'tool_call' as const,
          id: content.id,
          name: content.name,
          args: content.input as Record<string, unknown>
        };
      }
      return null;
    }).filter(Boolean) as Event['segments'];
    
    return {
      id: response.id,
      role: 'assistant',
      segments,
      ts: Date.now()
    };
  }
}