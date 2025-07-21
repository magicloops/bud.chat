// Provider mapper exports

// Explicit exports to avoid duplicates
export {
  eventsToAnthropicMessages,
  anthropicStreamDeltaToEvent,
  createToolResultFromMCPResponse,
  extractPendingToolCalls
} from './anthropic';

export {
  eventsToOpenAIMessages,
  openaiStreamDeltaToEvent
} from './openai';

import { Event } from '@/lib/types/events';
import { eventsToAnthropicMessages, anthropicResponseToEvents, AnthropicResponse } from './anthropic';
import { eventsToOpenAIMessages, openaiResponseToEvents, OpenAIResponse } from './openai';

export type Provider = 'anthropic' | 'openai';

export function eventsToProviderMessages(events: Event[], provider: Provider): Record<string, unknown>[] {
  switch (provider) {
    case 'anthropic':
      return eventsToAnthropicMessages(events).messages as unknown as Record<string, unknown>[];
    case 'openai':
      return eventsToOpenAIMessages(events) as unknown as Record<string, unknown>[];
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function providerResponseToEvents(response: unknown, provider: Provider): Event[] {
  switch (provider) {
    case 'anthropic':
      return anthropicResponseToEvents(response as unknown as AnthropicResponse);
    case 'openai':
      return openaiResponseToEvents(response as unknown as OpenAIResponse);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}