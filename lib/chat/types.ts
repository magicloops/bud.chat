// Type definitions for the Chat Engine and adapters

import { Event } from '@/lib/types/events';

export interface ChatRequest {
  messages?: Event[];
  message?: string;
  workspaceId: string;
  budId?: string;
  model: string;
  conversationId?: string;
}

export interface ValidatedChatRequest {
  user: any; // User from Supabase auth
  workspaceId: string;
  messages: Event[];
  model: string;
  budId?: string;
}

export interface ChatEngineConfig {
  // Event management
  eventLoader?: (conversationId: string) => Promise<Event[]>;
  eventSaver?: (event: Event, conversationId: string) => Promise<void>;
  batchEventSaver?: (events: Event[], conversationId: string) => Promise<void>;
  
  // Conversation management  
  conversationCreator?: (events: Event[], workspaceId: string, budId?: string) => Promise<string>;
  titleGenerator?: (conversationId: string, events: Event[]) => Promise<void>;
  
  // Streaming configuration
  streamingMode: 'individual' | 'batch'; // How to save events during streaming
}