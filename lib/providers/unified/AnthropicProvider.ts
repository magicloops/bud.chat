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
import { Event, EventLog } from '@/lib/types/events';
import { generateEventId, ToolCallId } from '@/lib/types/branded';
// import { createTextEvent, createToolCallEvent, createToolResultEvent, createMixedEvent } from '@/lib/types/events'; // Not currently used
import { getApiModelName } from '@/lib/modelMapping';

// Type for Anthropic tool input schema that matches the SDK requirements
interface AnthropicInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

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
        anthropicRequest.tools = request.tools.map(tool => {
          // Use inputSchema if available (MCP tools), fallback to parameters
          const schema = tool.inputSchema || tool.parameters;
          return {
            name: tool.name,
            description: tool.description || '',
            input_schema: (schema && typeof schema === 'object' && 'type' in schema) 
              ? schema as AnthropicInputSchema
              : { type: 'object' as const, properties: schema || {} } as AnthropicInputSchema
          };
        });
        
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
        console.log('🔧 [AnthropicProvider] Converting tools for request:', {
          toolCount: request.tools.length,
          tools: request.tools.map(t => ({ name: t.name, hasDescription: !!t.description, hasParameters: !!t.parameters }))
        });
        
        anthropicRequest.tools = request.tools.map(tool => {
          // Use inputSchema if available (MCP tools), fallback to parameters
          const schema = tool.inputSchema || tool.parameters;
          const anthropicTool = {
            name: tool.name,
            description: tool.description || '',
            input_schema: (schema && typeof schema === 'object' && 'type' in schema) 
              ? schema 
              : { type: 'object' as const, properties: schema || {} }
          };
          console.log('🔧 [AnthropicProvider] Converted tool:', {
            original: tool,
            converted: anthropicTool
          });
          return anthropicTool as Anthropic.Tool;
        });
        
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
      const currentToolCalls: Array<{ id: string; name: string; input: string }> = [];
      
      for await (const chunk of stream) {
        if (chunk.type === 'message_start') {
          currentEvent = {
            id: generateEventId(),
            role: 'assistant',
            segments: [],
            ts: Date.now()
          };
          // Emit the event as soon as the message starts so the server can
          // send an event_start to the frontend for proper turn separation.
          yield {
            type: 'event',
            data: { event: currentEvent }
          };
        }
        
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'text') {
            currentText = '';
          } else if (chunk.content_block.type === 'tool_use') {
            console.log('🔧 [AnthropicProvider] Tool use started:', {
              id: chunk.content_block.id,
              name: chunk.content_block.name
            });
            currentToolCalls.push({
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              input: ''
            });
            // Emit a tool_call start segment immediately (no args yet)
            if (currentEvent) {
              yield {
                type: 'segment',
                data: {
                  segment: {
                    type: 'tool_call',
                    id: chunk.content_block.id as ToolCallId,
                    name: chunk.content_block.name,
                    args: {}
                  },
                  segmentIndex: 0
                }
              };
            }
          }
        }
        
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            currentText += chunk.delta.text;
            
            // Emit ONLY the delta text, not the accumulated text
            if (currentEvent && chunk.delta.text) {
              yield {
                type: 'segment',
                data: {
                  segment: { type: 'text', text: chunk.delta.text },
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
                console.log('🔧 [AnthropicProvider] Tool call completed:', {
                  id: lastToolCall.id,
                  name: lastToolCall.name,
                  args
                });
                // Only add to event segments, don't emit again
                currentEvent.segments.push({
                  type: 'tool_call',
                  id: lastToolCall.id as ToolCallId,
                  name: lastToolCall.name,
                  args
                });
                // Also yield a tool_call segment with finalized args so the
                // route can emit tool_finalized immediately for UI
                yield {
                  type: 'segment',
                  data: {
                    segment: {
                      type: 'tool_call',
                      id: lastToolCall.id as ToolCallId,
                      name: lastToolCall.name,
                      args
                    },
                    segmentIndex: 0
                  }
                };
              } catch (e) {
                console.error('Failed to parse tool call input:', e, 'Raw input:', lastToolCall.input);
              }
            }
          }
        }
        
        // Do not emit another 'event' here; we already emitted on message_start.
        // Usage accounting can be handled separately if needed.
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
      id: generateEventId(),
      role: 'assistant',
      segments,
      ts: Date.now()
    };
  }
}
