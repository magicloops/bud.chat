// Anthropic provider implementation
import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './BaseProvider';
import { UnifiedChatRequest, UnifiedChatResponse, StreamEvent, ValidationResult, ProviderFeature } from './types';
import { Event, EventLog } from '@budchat/events';
import { generateEventId, ToolCallId } from '@budchat/events';
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

  protected validateProviderSpecific(_config: Partial<UnifiedChatRequest>): ValidationResult { return { valid: true, errors: [], warnings: [] }; }

  async chat(request: UnifiedChatRequest): Promise<UnifiedChatResponse> {
    const eventLog = new EventLog(request.events);
    const messages = eventLog.toProviderMessages('anthropic') as Anthropic.MessageParam[];
    const systemMessage = eventLog.getSystemMessage();
    try {
      const anthropicRequest: Anthropic.MessageCreateParams = {
        model: getApiModelName(request.model),
        messages: messages as any,
        max_tokens: (request.maxTokens as number | undefined) || 1024,
        temperature: request.temperature,
        system: systemMessage || undefined,
      } as any;
      const response = (await this.client.messages.create(anthropicRequest)) as unknown;
      const content = (response as any)?.content;
      const text = Array.isArray(content)
        ? content
            .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
            .map((c: any) => c.text)
            .join('\n')
        : '';
      const event: Event = { id: generateEventId(), role: 'assistant', segments: text ? [{ type: 'text', text }] as any : [], ts: Date.now() };
      return { event };
    } catch (error) {
      throw this.handleProviderError(error);
    }
  }

  async *stream(_request: UnifiedChatRequest): AsyncGenerator<StreamEvent> {
    const event: Event = { id: generateEventId(), role: 'assistant', segments: [], ts: Date.now() };
    yield { type: 'event', data: { event } } as any;
    yield { type: 'done' } as any;
  }
}
