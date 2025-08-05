// OpenAI Chat Completions API Provider
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
  ToolCall,
  Segment
} from '@/lib/types/events';
import { generateToolCallId } from '@/lib/types/branded';

export class OpenAIChatProvider extends OpenAIBaseProvider {
  name = 'openai-chat' as const;
  
  supportsFeature(feature: ProviderFeature): boolean {
    const chatFeatures = [
      ProviderFeature.FUNCTION_CALLING,
      ProviderFeature.TOOL_STREAMING,
      ProviderFeature.TEMPERATURE,
      ProviderFeature.MAX_TOKENS,
      ProviderFeature.TOP_P,
    ];
    
    return super.supportsFeature(feature) || chatFeatures.includes(feature);
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const messages = this.convertEventsToMessages(request.events);
      
      const completion = await this.client.chat.completions.create({
        model: this.getModelName(request.model),
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
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
        top_p: request.topP,
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        tool_choice: request.toolChoice,
        stream: true
      });
      
      let currentEvent: Event = {
        id: crypto.randomUUID(),
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
              const toolCall: ToolCall = {
                type: 'tool_call',
                id: toolCallDelta.id || generateToolCallId(),
                name: toolCallDelta.function?.name || '',
                args: {}
              };
              toolCalls.set(index, toolCall);
              currentEvent.segments.push(toolCall);
              
              yield {
                type: 'segment',
                data: {
                  segment: toolCall,
                  segmentIndex: currentEvent.segments.length - 1
                }
              };
            }
            
            const toolCall = toolCalls.get(index)!;
            
            if (toolCallDelta.function?.name) {
              toolCall.name = toolCallDelta.function.name;
            }
            
            if (toolCallDelta.function?.arguments) {
              // Accumulate arguments string
              if (!toolCall.args._raw) {
                toolCall.args._raw = '';
              }
              toolCall.args._raw += toolCallDelta.function.arguments;
              
              // Try to parse accumulated arguments
              try {
                const parsed = JSON.parse(toolCall.args._raw);
                toolCall.args = parsed;
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
    return eventLog.toOpenAIMessages();
  }
  
  private convertTools(tools: any[]): OpenAI.ChatCompletionTool[] {
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
      role: message.role as Event['role'],
      segments,
      ts: Date.now()
    };
  }
}