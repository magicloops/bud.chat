// Existing Chat Adapter - handles loading existing events and individual event saving
// Used by /api/chat/[conversationId]/route.ts

import { ChatEngineConfig } from './types';
import { Event } from '@/lib/types/events';
import { saveEvent, getConversationEvents } from '@/lib/db/events';

export class ExistingChatAdapter {
  static createConfig(conversationId: string): ChatEngineConfig {
    return {
      eventLoader: async () => {
        console.log('📚 Loading existing events from database...');
        const events = await getConversationEvents(conversationId);
        console.log('📚 Loaded existing events:', events.length);
        return events;
      },
      eventSaver: async (event: Event) => {
        console.log('💾 Saving individual event to database:', event.id);
        await saveEvent(event, { conversationId });
        console.log('✅ Event saved successfully');
      },
      batchEventSaver: undefined, // No batch saving needed
      conversationCreator: undefined, // Conversation already exists
      titleGenerator: undefined, // No title generation needed
      streamingMode: 'individual'
    };
  }
}