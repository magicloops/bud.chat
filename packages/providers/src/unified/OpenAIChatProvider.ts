// OpenAI Chat Completions API Provider
import OpenAI from 'openai';
import { OpenAIBaseProvider } from './OpenAIBaseProvider';
import { UnifiedChatRequest, UnifiedChatResponse, StreamEvent, ProviderFeature, UnifiedTool, ValidationResult } from './types';
import { Event, ToolCall, Segment, eventsToOpenAIChatMessages, openAIChatMessageToEvent } from '@budchat/events';
import { generateToolCallId, generateEventId, ToolCallId } from '@budchat/events';

export class OpenAIChatProvider extends OpenAIBaseProvider {
  name = 'openai-chat' as const;
  provider = 'openai' as const;
  
  supportsFeature(feature: ProviderFeature): boolean {
    const chatFeatures = [ProviderFeature.TOOL_CALLING, ProviderFeature.TEMPERATURE, ProviderFeature.STREAMING];
    return super.supportsFeature(feature) || chatFeatures.includes(feature);
  }
  
  protected validateProviderSpecific(_config: Partial<UnifiedChatRequest>): ValidationResult {
    return { valid: true, errors: [], warnings: [] };
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return { [ProviderFeature.TOOL_CALLING]: true, [ProviderFeature.TEMPERATURE]: true, [ProviderFeature.STREAMING]: true, [ProviderFeature.SYSTEM_MESSAGE]: true };
  }
  
  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    try {
      const messages = eventsToOpenAIChatMessages(request.events) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      const completion = await this.client.chat.completions.create({
        model: this.getModelName(request.model),
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        tool_choice: request.toolChoice
      });
      const choice = completion.choices[0];
      if (!choice.message) throw new Error('No message in response');
      const event = openAIChatMessageToEvent(choice.message as any);
      return { event, usage: completion.usage ? { promptTokens: completion.usage.prompt_tokens, completionTokens: completion.usage.completion_tokens, totalTokens: completion.usage.total_tokens } : undefined };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
  
  async *stream(request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    try {
      const messages = eventsToOpenAIChatMessages(request.events) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];
      const stream = await this.client.chat.completions.create({
        model: this.getModelName(request.model),
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        tools: request.tools ? this.convertTools(request.tools) : undefined,
        tool_choice: request.toolChoice,
        stream: true
      });
      const currentEvent: Event = { id: generateEventId(), role: 'assistant', segments: [], ts: Date.now(), response_metadata: { model: request.model } };
      let hasStarted = false;
      const toolCalls: Map<number, ToolCall> = new Map();
      for await (const chunk of stream) {
        const delta = (chunk.choices[0] as any)?.delta;
        if (!delta) continue;
        if (!hasStarted) { yield { type: 'event', data: { event: currentEvent } }; hasStarted = true; }
        if (delta.content) {
          let textSegment = currentEvent.segments.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
          if (!textSegment) { textSegment = { type: 'text', text: '' }; currentEvent.segments.push(textSegment); }
          textSegment.text += delta.content;
          yield { type: 'segment', data: { segment: { type: 'text', text: delta.content } as any, segmentIndex: currentEvent.segments.indexOf(textSegment) } };
        }
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const index = toolCallDelta.index!;
            if (!toolCalls.has(index)) {
              const toolCallId = (toolCallDelta.id || generateToolCallId()) as ToolCallId;
              const toolCall: ToolCall = { id: toolCallId, name: toolCallDelta.function?.name || '', args: {} } as any;
              toolCalls.set(index, toolCall);
              const segment: Segment = { type: 'tool_call', id: toolCallId, name: (toolCall as any).name, args: (toolCall as any).args } as any;
              currentEvent.segments.push(segment);
              yield { type: 'segment', data: { segment, segmentIndex: currentEvent.segments.length - 1 } };
            }
            const toolCall = toolCalls.get(index)! as any;
            if (toolCallDelta.function?.name) {
              toolCall.name = toolCallDelta.function.name;
              const segmentIndex = currentEvent.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === toolCall.id);
              if (segmentIndex >= 0) { const segment = currentEvent.segments[segmentIndex] as any; if (segment.type === 'tool_call') segment.name = toolCall.name; }
            }
            if (toolCallDelta.function?.arguments) {
              if (!toolCall._rawArgs) toolCall._rawArgs = '';
              toolCall._rawArgs += toolCallDelta.function.arguments;
              try {
                const parsed = JSON.parse(toolCall._rawArgs);
                toolCall.args = parsed;
                const segmentIndex = currentEvent.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === toolCall.id);
                if (segmentIndex >= 0) {
                  const segment = currentEvent.segments[segmentIndex] as any;
                  if (segment.type === 'tool_call') {
                    segment.args = parsed;
                    yield { type: 'segment', data: { segment, segmentIndex } };
                  }
                }
              } catch {}
            }
          }
        }
      }
      // Ensure the route sees a terminal signal and can persist
      if (!hasStarted) {
        // No deltas arrived (edge case). Still emit an empty assistant event for persistence.
        yield { type: 'event', data: { event: currentEvent } } as any;
      }
      yield { type: 'done' } as any;
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }

  private convertTools(tools: UnifiedTool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters || tool.inputSchema || {} } }));
  }
}
