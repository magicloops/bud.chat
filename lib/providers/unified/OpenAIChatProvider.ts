// OpenAI Chat Completions API Provider
import OpenAI from 'openai';
import { OpenAIBaseProvider } from './OpenAIBaseProvider';
import { 
  UnifiedChatRequest, 
  UnifiedChatResponse, 
  StreamEvent,
  ProviderFeature,
  UnifiedTool,
  ValidationResult 
} from './types';
import { 
  Event, 
  EventLog,
  ToolCall,
  Segment,
} from '@budchat/events';
import { generateToolCallId, generateEventId, ToolCallId } from '@/lib/types/branded';

export class OpenAIChatProvider extends OpenAIBaseProvider {
  name = 'openai-chat' as const;
  provider = 'openai' as const;
  
  supportsFeature(feature: ProviderFeature): boolean {
    const chatFeatures = [
      ProviderFeature.TOOL_CALLING,
      ProviderFeature.TEMPERATURE,
      ProviderFeature.STREAMING,
    ];
    
    return super.supportsFeature(feature) || chatFeatures.includes(feature);
  }
  
  protected validateProviderSpecific(_config: Partial<UnifiedChatRequest>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Add any OpenAI Chat-specific validations here
    
    return { valid: errors.length === 0, errors, warnings };
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return {
      [ProviderFeature.TOOL_CALLING]: true,
      [ProviderFeature.TEMPERATURE]: true,
      [ProviderFeature.STREAMING]: true,
      [ProviderFeature.SYSTEM_MESSAGE]: true,
    };
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const messages = this.convertEventsToMessages(request.events);
      
      const completion = await this.client.chat.completions.create({
        model: this.getModelName(request.model),
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        tool_choice: request.toolChoice
      });
      
      const choice = completion.choices[0];
      if (!choice.message) {
        throw new Error('No message in response');
      }
      
      const event = this.convertMessageToEvent(choice.message);
      
      return {
        event,
        usage: completion.usage ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens
        } : undefined
      };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    try {
      const messages = this.convertEventsToMessages(request.events);
      
      const stream = await this.client.chat.completions.create({
        model: this.getModelName(request.model),
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        tool_choice: request.toolChoice,
        stream: true
      });
      
      const currentEvent: Event = {
        id: generateEventId(),
        role: 'assistant',
        segments: [],
        ts: Date.now(),
        response_metadata: {
          model: request.model
        }
      };
      
      let hasStarted = false;
      const toolCalls: Map<number, ToolCall> = new Map();
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        
        if (!hasStarted) {
          yield {
            type: 'event',
            data: { event: currentEvent }
          };
          hasStarted = true;
        }
        
        // Handle text content
        if (delta.content) {
          let textSegment = currentEvent.segments.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
          if (!textSegment) {
            textSegment = { type: 'text', text: '' };
            currentEvent.segments.push(textSegment);
          }
          textSegment.text += delta.content;
          
          yield {
            type: 'segment',
            data: {
              segment: { type: 'text', text: delta.content },
              segmentIndex: currentEvent.segments.indexOf(textSegment)
            }
          };
        }
        
        // Handle tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index!;
            
            if (!toolCalls.has(index)) {
              const toolCallId = (toolCallDelta.id || generateToolCallId()) as ToolCallId;
              const toolCall: ToolCall = {
                id: toolCallId,
                name: toolCallDelta.function?.name || '',
                args: {}
              };
              toolCalls.set(index, toolCall);
              
              const segment: Segment = {
                type: 'tool_call',
                id: toolCallId,
                name: toolCall.name,
                args: toolCall.args
              };
              currentEvent.segments.push(segment);
              
              yield {
                type: 'segment',
                data: {
                  segment: segment,
                  segmentIndex: currentEvent.segments.length - 1
                }
              };
            }
            
            const toolCall = toolCalls.get(index)!;
            
            if (toolCallDelta.function?.name) {
              toolCall.name = toolCallDelta.function.name;
              
              // Also update the segment's name
              const segmentIndex = currentEvent.segments.findIndex(
                s => s.type === 'tool_call' && s.id === toolCall.id
              );
              if (segmentIndex >= 0) {
                const segment = currentEvent.segments[segmentIndex];
                if (segment.type === 'tool_call') {
                  segment.name = toolCall.name;
                }
              }
            }
            
            if (toolCallDelta.function?.arguments) {
              // Store raw accumulator separately to avoid overwriting it
              if (!toolCall._rawArgs) {
                toolCall._rawArgs = '';
              }
              toolCall._rawArgs += toolCallDelta.function.arguments;
              
              
              // Try to parse accumulated arguments
              try {
                const parsed = JSON.parse(toolCall._rawArgs);
                toolCall.args = parsed;
                
                
                // Update the segment in currentEvent
                const segmentIndex = currentEvent.segments.findIndex(
                  s => s.type === 'tool_call' && s.id === toolCall.id
                );
                if (segmentIndex >= 0) {
                  const segment = currentEvent.segments[segmentIndex];
                  if (segment.type === 'tool_call') {
                    segment.args = parsed;
                    
                    // Yield updated segment with args
                    yield {
                      type: 'segment',
                      data: {
                        segment: segment,
                        segmentIndex: segmentIndex
                      }
                    };
                  }
                }
              } catch {
                // Not yet valid JSON, continue accumulating
              }
            }
          }
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
  
  private convertEventsToMessages(events: Event[]): OpenAI.ChatCompletionMessageParam[] {
    const eventLog = new EventLog(events);
    return eventLog.toProviderMessages('openai') as OpenAI.ChatCompletionMessageParam[];
  }
  
  private convertTools(tools: UnifiedTool[]): OpenAI.ChatCompletionTool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || {}
      }
    }));
  }
  
  private convertMessageToEvent(message: OpenAI.ChatCompletionMessage): Event {
    const segments: Event['segments'] = [];
    
    if (message.content) {
      segments.push({ type: 'text', text: message.content });
    }
    
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);
          segments.push({
            type: 'tool_call',
            id: toolCall.id as ToolCallId,
            name: toolCall.function.name,
            args
          });
        } catch (e) {
          console.error('Failed to parse tool call arguments:', e);
        }
      }
    }
    
    return {
      id: generateEventId(),
      role: message.role as Event['role'],
      segments,
      ts: Date.now()
    };
  }
}
