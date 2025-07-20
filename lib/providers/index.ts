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
import { eventsToAnthropicMessages, anthropicResponseToEvents } from './anthropic';
import { eventsToOpenAIMessages, openaiResponseToEvents } from './openai';

export type Provider = 'anthropic' | 'openai';

export function eventsToProviderMessages(events: Event[], provider: Provider): any[] {
  switch (provider) {
    case 'anthropic':
      return eventsToAnthropicMessages(events).messages;
    case 'openai':
      return eventsToOpenAIMessages(events);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function providerResponseToEvents(response: any, provider: Provider): Event[] {
  switch (provider) {
    case 'anthropic':
      return anthropicResponseToEvents(response);
    case 'openai':
      return openaiResponseToEvents(response);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}