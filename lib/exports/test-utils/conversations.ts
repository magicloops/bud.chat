import { basicEventSequence, reasoningEventSequence } from '../../../packages/events/test-utils/basicEvents';
import type { Event } from '@budchat/events';

export const openAIChatConversation: Event[] = basicEventSequence;
export const openAIResponsesConversation: Event[] = reasoningEventSequence;
export const anthropicConversation: Event[] = basicEventSequence;
