// Anthropic provider implementation
import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './BaseProvider';
import { UnifiedChatRequest, UnifiedChatResponse, StreamEvent, ValidationResult, ProviderFeature } from './types';
import { Event, EventLog, generateEventId, ToolCallId } from '@budchat/events';
import { getApiModelName } from '@budchat/models';

interface AnthropicInputSchema { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; [key: string]: unknown }

export class AnthropicProvider extends BaseProvider {
  readonly name = 'Anthropic';
  readonly provider = 'anthropic' as const;
  private client: Anthropic;
  
  constructor(apiKey?: string) {
    super();
    this.client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY! });
  }
  
  protected getFeatureSupport(): Partial<Record<ProviderFeature, boolean>> {
    return { [ProviderFeature.TEMPERATURE]: true, [ProviderFeature.STREAMING]: true, [ProviderFeature.SYSTEM_MESSAGE]: true, [ProviderFeature.TOOL_CALLING]: true };
  }

  protected validateProviderSpecific(_config: Partial<UnifiedChatRequest>): ValidationResult {
    return { valid: true, errors: [], warnings: [] };
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
      } as any;
      if (request.tools && request.tools.length > 0) {
        anthropicRequest.tools = request.tools.map(tool => {
          const schema = (tool.inputSchema || tool.parameters) as any;
          return { name: tool.name, description: tool.description || '', input_schema: (schema && typeof schema === 'object' && 'type' in schema) ? schema : { type: 'object' as const, properties: schema || {} } } as Anthropic.Tool;
        });
        if (request.toolChoice) {
          if (request.toolChoice === 'required') anthropicRequest.tool_choice = { type: 'any' } as any;
          else if (request.toolChoice === 'none') anthropicRequest.tool_choice = { type: 'none' } as any;
          else if (typeof request.toolChoice === 'object') anthropicRequest.tool_choice = { type: 'tool', name: request.toolChoice.function.name } as any;
        }
      }
      const response = await this.client.messages.create(anthropicRequest);
      const segments: Event['segments'] = [];
      const content = (response as any)?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'text' && typeof c?.text === 'string') segments.push({ type: 'text', text: c.text } as any);
          if (c?.type === 'tool_use') segments.push({ type: 'tool_call', id: c.id as ToolCallId, name: c.name, args: c.input as any } as any);
        }
      }
      const event: Event = { id: generateEventId(), role: 'assistant', segments, ts: Date.now() };
      return { event, usage: (response as any).usage ? { promptTokens: (response as any).usage.input_tokens, completionTokens: (response as any).usage.output_tokens, totalTokens: ((response as any).usage.input_tokens || 0) + ((response as any).usage.output_tokens || 0) } : undefined };
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
      } as any;
      if (request.tools && request.tools.length > 0) {
        anthropicRequest.tools = request.tools.map(tool => {
          const schema = (tool.inputSchema || tool.parameters) as any;
          return { name: tool.name, description: tool.description || '', input_schema: (schema && typeof schema === 'object' && 'type' in schema) ? schema : { type: 'object' as const, properties: schema || {} } } as Anthropic.Tool;
        });
        if (request.toolChoice) {
          if (request.toolChoice === 'required') anthropicRequest.tool_choice = { type: 'any' } as any;
          else if (request.toolChoice === 'none') anthropicRequest.tool_choice = { type: 'none' } as any;
          else if (typeof request.toolChoice === 'object') anthropicRequest.tool_choice = { type: 'tool', name: request.toolChoice.function.name } as any;
        }
      }
      const stream = await this.client.messages.create(anthropicRequest);
      let currentEvent: Event | null = null;
      let currentText = '';
      const currentToolCalls: Array<{ id: string; name: string; input: string; startedAt?: number }> = [];
      for await (const chunk of stream as any) {
        if (chunk.type === 'message_start') {
          currentEvent = { id: generateEventId(), role: 'assistant', segments: [], ts: Date.now() };
          yield { type: 'event', data: { event: currentEvent } } as any;
        }
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'text') currentText = '';
          else if (chunk.content_block.type === 'tool_use') {
            currentToolCalls.push({ id: chunk.content_block.id, name: chunk.content_block.name, input: '', startedAt: Date.now() });
            if (currentEvent) yield { type: 'segment', data: { segment: { type: 'tool_call', id: chunk.content_block.id as ToolCallId, name: chunk.content_block.name, args: {}, started_at: currentToolCalls[currentToolCalls.length - 1]?.startedAt } as any, segmentIndex: 0 } } as any;
          }
        }
        if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            currentText += chunk.delta.text;
            if (currentEvent && chunk.delta.text) yield { type: 'segment', data: { segment: { type: 'text', text: chunk.delta.text } as any, segmentIndex: 0 } } as any;
          } else if (chunk.delta.type === 'input_json_delta') {
            const toolIndex = currentToolCalls.length - 1;
            if (toolIndex >= 0) currentToolCalls[toolIndex].input += chunk.delta.partial_json;
          }
        }
        if (chunk.type === 'content_block_stop') {
          if (currentEvent && chunk.index !== undefined) {
            if (currentText) { currentEvent.segments.push({ type: 'text', text: currentText } as any); currentText = ''; }
            const lastToolCall = currentToolCalls[currentToolCalls.length - 1];
            if (lastToolCall && lastToolCall.input) {
              try {
                const args = JSON.parse(lastToolCall.input);
                currentEvent.segments.push({ type: 'tool_call', id: lastToolCall.id as ToolCallId, name: lastToolCall.name, args, started_at: lastToolCall.startedAt, completed_at: Date.now() } as any);
                yield { type: 'segment', data: { segment: { type: 'tool_call', id: lastToolCall.id as ToolCallId, name: lastToolCall.name, args, started_at: lastToolCall.startedAt, completed_at: Date.now() } as any, segmentIndex: 0 } } as any;
              } catch (e) {
                console.error('Failed to parse tool call input:', e, 'Raw input:', lastToolCall.input);
              }
            }
          }
        }
      }
      yield { type: 'done' } as any;
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }
}
