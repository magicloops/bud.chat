import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { shallow } from 'zustand/shallow';
import { createClient } from '@/lib/supabase/client';
import { Event, EventLog } from '@/lib/types/events';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Event-based conversation types
export interface EventConversationMeta {
  id: string
  title?: string
  workspace_id: string
  source_bud_id?: string
  assistant_name?: string
  assistant_avatar?: string
  model_config_overrides?: Record<string, any>
  mcp_config_overrides?: Record<string, any>
  created_at: string
}

export interface EventConversation {
  id: string
  events: Event[]
  isStreaming: boolean
  streamingEventId?: string
  meta: EventConversationMeta
}

interface EventChatStore {
  // Core data - event-based conversations
  conversations: Record<string, EventConversation>
  
  // Workspace conversation management for sidebar
  workspaceConversations: Record<string, string[]> // workspaceId -> conversationIds[]
  
  // Realtime subscriptions
  realtimeChannels: Record<string, RealtimeChannel> // workspaceId -> channel
  
  // UI state
  ui: {
    selectedWorkspace: string | null
  }
  
  // Conversation actions
  setConversation: (id: string, conversation: EventConversation) => void
  updateConversation: (id: string, updates: Partial<EventConversation>) => void
  
  // Event actions
  addEvent: (conversationId: string, event: Event) => void
  updateEvent: (conversationId: string, eventId: string, updates: Partial<Event>) => void
  replaceEvent: (conversationId: string, eventId: string, event: Event) => void
  
  // Streaming actions
  startStreaming: (conversationId: string, eventId: string) => void
  updateStreamingEvent: (conversationId: string, event: Event) => void
  finishStreaming: (conversationId: string, finalEvent: Event) => void
  
  // Workspace actions
  addConversationToWorkspace: (workspaceId: string, conversationId: string) => void
  removeConversationFromWorkspace: (workspaceId: string, conversationId: string) => void
  setWorkspaceConversations: (workspaceId: string, conversationIds: string[]) => void
  
  // UI actions
  setSelectedWorkspace: (workspaceId: string | null) => void
  
  // Realtime actions
  subscribeToWorkspace: (workspaceId: string) => void
  unsubscribeFromWorkspace: (workspaceId: string) => void
  cleanup: () => void
  
}

export const useEventChatStore = create<EventChatStore>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        // Initial state
        conversations: {},
        workspaceConversations: {},
        realtimeChannels: {},
        ui: {
          selectedWorkspace: null,
        },
        
        // Conversation actions
        setConversation: (id, conversation) => set((state) => {
          console.log('🏦 [STORE] Setting conversation', {
            timestamp: Date.now(),
            conversationId: id,
            eventCount: conversation.events.length,
            previousEventCount: state.conversations[id]?.events?.length || 0,
            source: new Error().stack?.split('\n')[2]?.trim() // Capture caller
          });
          state.conversations[id] = conversation;
        }),
        
        updateConversation: (id, updates) => set((state) => {
          if (state.conversations[id]) {
            state.conversations[id] = {
              ...state.conversations[id],
              ...updates
            };
          }
        }),
        
        // Event actions
        addEvent: (conversationId, event) => set((state) => {
          const conversation = state.conversations[conversationId];
          if (conversation) {
            conversation.events.push(event);
          }
        }),
        
        updateEvent: (conversationId, eventId, updates) => set((state) => {
          const conversation = state.conversations[conversationId];
          if (conversation) {
            const eventIndex = conversation.events.findIndex(e => e.id === eventId);
            if (eventIndex >= 0) {
              Object.assign(conversation.events[eventIndex], updates);
            }
          }
        }),
        
        replaceEvent: (conversationId, eventId, event) => set((state) => {
          const conversation = state.conversations[conversationId];
          if (conversation) {
            const eventIndex = conversation.events.findIndex(e => e.id === eventId);
            if (eventIndex >= 0) {
              conversation.events[eventIndex] = event;
            }
          }
        }),
        
        // Streaming actions
        startStreaming: (conversationId, eventId) => set((state) => {
          const conversation = state.conversations[conversationId];
          if (conversation) {
            conversation.isStreaming = true;
            conversation.streamingEventId = eventId;
          }
        }),
        
        updateStreamingEvent: (conversationId, event) => set((state) => {
          const conversation = state.conversations[conversationId];
          if (conversation && conversation.streamingEventId) {
            const eventIndex = conversation.events.findIndex(e => e.id === conversation.streamingEventId);
            if (eventIndex >= 0) {
              conversation.events[eventIndex] = event;
            }
          }
        }),
        
        finishStreaming: (conversationId, finalEvent) => set((state) => {
          const conversation = state.conversations[conversationId];
          if (conversation && conversation.streamingEventId) {
            const eventIndex = conversation.events.findIndex(e => e.id === conversation.streamingEventId);
            if (eventIndex >= 0) {
              conversation.events[eventIndex] = finalEvent;
            }
            conversation.isStreaming = false;
            conversation.streamingEventId = undefined;
          }
        }),
        
        // Workspace actions
        addConversationToWorkspace: (workspaceId, conversationId) => set((state) => {
          if (!state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = [];
          }
          if (!state.workspaceConversations[workspaceId].includes(conversationId)) {
            state.workspaceConversations[workspaceId].push(conversationId);
          }
        }),
        
        removeConversationFromWorkspace: (workspaceId, conversationId) => set((state) => {
          if (state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId]
              .filter(id => id !== conversationId);
          }
        }),
        
        setWorkspaceConversations: (workspaceId, conversationIds) => set((state) => {
          state.workspaceConversations[workspaceId] = conversationIds;
        }),

        // UI actions
        setSelectedWorkspace: (workspaceId) => set((state) => {
          state.ui.selectedWorkspace = workspaceId;
        }),

        // Realtime actions
        subscribeToWorkspace: (workspaceId) => {
          const state = get();
          
          // Don't subscribe if already subscribed
          if (state.realtimeChannels[workspaceId]) {
            return;
          }

          const supabase = createClient();
          const channel = supabase
            .channel(`workspace-${workspaceId}`)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'conversations',
                filter: `workspace_id=eq.${workspaceId}`
              },
              (payload) => {
                console.log('📡 [REALTIME] Conversation update received', {
                  timestamp: Date.now(),
                  eventType: payload.eventType,
                  conversationId: payload.new?.id || payload.old?.id,
                  currentLocalEvents: get().conversations[payload.new?.id || payload.old?.id]?.events?.length || 0
                });
                
                if (payload.eventType === 'UPDATE') {
                  const updatedConversation = payload.new as any;
                  console.log('📝 Updating conversation:', updatedConversation.id, 'title:', updatedConversation.title);
                  
                  set((state) => {
                    if (state.conversations[updatedConversation.id]) {
                      // Update existing conversation
                      const currentTitle = state.conversations[updatedConversation.id].meta.title;
                      state.conversations[updatedConversation.id].meta = {
                        ...state.conversations[updatedConversation.id].meta,
                        title: updatedConversation.title,
                        assistant_name: updatedConversation.assistant_name,
                        assistant_avatar: updatedConversation.assistant_avatar,
                        model_config_overrides: updatedConversation.model_config_overrides,
                        mcp_config_overrides: updatedConversation.mcp_config_overrides,
                      };
                      console.log('✅ Conversation updated in store:', currentTitle, '→', updatedConversation.title);
                    } else {
                      console.log('⚠️ Conversation not found in store, queuing update:', updatedConversation.id);
                      
                      // Conversation not in store yet - retry after a delay
                      setTimeout(() => {
                        console.log('🔄 Retrying conversation update:', updatedConversation.id);
                        const currentState = get();
                        if (currentState.conversations[updatedConversation.id]) {
                          set((retryState) => {
                            retryState.conversations[updatedConversation.id].meta = {
                              ...retryState.conversations[updatedConversation.id].meta,
                              title: updatedConversation.title,
                              assistant_name: updatedConversation.assistant_name,
                              assistant_avatar: updatedConversation.assistant_avatar,
                              model_config_overrides: updatedConversation.model_config_overrides,
                              mcp_config_overrides: updatedConversation.mcp_config_overrides,
                            };
                            console.log('✅ Delayed update successful:', updatedConversation.title);
                          });
                        } else {
                          console.log('❌ Conversation still not found after retry:', updatedConversation.id);
                        }
                      }, 1000);
                    }
                  });
                } else if (payload.eventType === 'INSERT') {
                  const newConversation = payload.new as any;
                  
                  set((state) => {
                    // 🔧 RACE CONDITION FIX: Don't overwrite existing conversations that have events
                    const existingConversation = state.conversations[newConversation.id];
                    if (existingConversation && existingConversation.events.length > 0) {
                      console.log('🔒 [REALTIME] Skipping INSERT - conversation already has events:', {
                        conversationId: newConversation.id,
                        existingEventCount: existingConversation.events.length
                      });
                      
                      // Just update metadata without touching events
                      existingConversation.meta = {
                        ...existingConversation.meta,
                        title: newConversation.title,
                        assistant_name: newConversation.assistant_name,
                        assistant_avatar: newConversation.assistant_avatar,
                        model_config_overrides: newConversation.model_config_overrides,
                        mcp_config_overrides: newConversation.mcp_config_overrides,
                      };
                      
                      // Add to workspace conversations if not already there
                      if (!state.workspaceConversations[workspaceId]) {
                        state.workspaceConversations[workspaceId] = [];
                      }
                      if (!state.workspaceConversations[workspaceId].includes(newConversation.id)) {
                        state.workspaceConversations[workspaceId].unshift(newConversation.id);
                      }
                      return; // Exit early
                    }
                    
                    console.log('📝 [REALTIME] Creating new conversation from INSERT:', {
                      conversationId: newConversation.id,
                      hasExistingConversation: !!existingConversation
                    });
                    
                    // Create the full conversation object with metadata
                    const conversationMeta: EventConversationMeta = {
                      id: newConversation.id,
                      title: newConversation.title,
                      workspace_id: newConversation.workspace_id,
                      source_bud_id: newConversation.source_bud_id,
                      assistant_name: newConversation.assistant_name,
                      assistant_avatar: newConversation.assistant_avatar,
                      model_config_overrides: newConversation.model_config_overrides,
                      mcp_config_overrides: newConversation.mcp_config_overrides,
                      created_at: newConversation.created_at
                    };

                    const conversation: EventConversation = {
                      id: newConversation.id,
                      events: [], // Events will be loaded when conversation is opened
                      isStreaming: false,
                      meta: conversationMeta
                    };

                    // Store the full conversation
                    state.conversations[newConversation.id] = conversation;

                    // Add to workspace conversations if not already there
                    if (!state.workspaceConversations[workspaceId]) {
                      state.workspaceConversations[workspaceId] = [];
                    }
                    if (!state.workspaceConversations[workspaceId].includes(newConversation.id)) {
                      state.workspaceConversations[workspaceId].unshift(newConversation.id);
                    }
                  });
                } else if (payload.eventType === 'DELETE') {
                  const deletedConversation = payload.old as any;
                  
                  set((state) => {
                    // Remove from conversations and workspace
                    delete state.conversations[deletedConversation.id];
                    if (state.workspaceConversations[workspaceId]) {
                      state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId].filter(
                        id => id !== deletedConversation.id
                      );
                    }
                  });
                }
              }
            )
            .subscribe();

          set((state) => {
            state.realtimeChannels[workspaceId] = channel;
          });
        },

        unsubscribeFromWorkspace: (workspaceId) => {
          const state = get();
          const channel = state.realtimeChannels[workspaceId];
          
          if (channel) {
            channel.unsubscribe();
            set((state) => {
              delete state.realtimeChannels[workspaceId];
            });
          }
        },

        cleanup: () => {
          const state = get();
          
          // Unsubscribe from all channels
          Object.values(state.realtimeChannels).forEach(channel => {
            channel.unsubscribe();
          });
          
          set((state) => {
            state.realtimeChannels = {};
          });
        },

      })),
      {
        name: 'event-chat-store',
        partialize: (state) => ({
          ui: {
            selectedWorkspace: state.ui.selectedWorkspace,
          },
          // Don't persist conversations - they'll be loaded from server as needed
        }),
      }
    )
  )
);

// Helper function to convert events to legacy message format for compatibility
export function eventsToLegacyMessages(events: Event[]): any[] {
  return events.map(event => {
    const textContent = event.segments
      .filter(s => s.type === 'text')
      .map(s => s.text)
      .join('');
    
    const toolCalls = event.segments
      .filter(s => s.type === 'tool_call')
      .map(s => ({
        id: s.id,
        type: 'function',
        function: {
          name: s.name,
          arguments: JSON.stringify(s.args)
        }
      }));
    
    return {
      id: event.id,
      role: event.role,
      content: textContent,
      created_at: new Date(event.ts).toISOString(),
      updated_at: new Date(event.ts).toISOString(),
      order_key: event.ts.toString(),
      json_meta: toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
    };
  });
}

// Helper function to convert legacy messages to events for migration
export function legacyMessagesToEvents(messages: any[]): Event[] {
  return messages.map(message => ({
    id: message.id,
    role: message.role,
    segments: [
      ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
      ...(message.json_meta?.tool_calls || []).map((toolCall: any) => ({
        type: 'tool_call' as const,
        id: toolCall.id,
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments || '{}')
      }))
    ],
    ts: new Date(message.created_at).getTime()
  }));
}

// Event-based hooks
export const useEventConversation = (conversationId: string) =>
  useEventChatStore((state) => state.conversations[conversationId]);

export const useEventConversations = () =>
  useEventChatStore((state) => state.conversations, shallow);

export const useEventIsStreaming = (conversationId: string) =>
  useEventChatStore((state) => state.conversations[conversationId]?.isStreaming || false);

export const useEventSelectedWorkspace = () =>
  useEventChatStore((state) => state.ui.selectedWorkspace);

// Action hooks
export const useEventSetConversation = () => useEventChatStore((state) => state.setConversation);
export const useEventAddEvent = () => useEventChatStore((state) => state.addEvent);
export const useEventStartStreaming = () => useEventChatStore((state) => state.startStreaming);
export const useEventUpdateStreamingEvent = () => useEventChatStore((state) => state.updateStreamingEvent);
export const useEventFinishStreaming = () => useEventChatStore((state) => state.finishStreaming);
export const useEventSetSelectedWorkspace = () => useEventChatStore((state) => state.setSelectedWorkspace);

// Workspace conversation management hooks
export const useEventWorkspaceConversations = (workspaceId: string) => 
  useEventChatStore((state) => state.workspaceConversations[workspaceId]);

export const useEventAddConversationToWorkspace = () => 
  useEventChatStore((state) => state.addConversationToWorkspace);

export const useEventRemoveConversationFromWorkspace = () => 
  useEventChatStore((state) => state.removeConversationFromWorkspace);

export const useEventSetWorkspaceConversations = () => 
  useEventChatStore((state) => state.setWorkspaceConversations);

// Realtime hooks
export const useEventSubscribeToWorkspace = () => 
  useEventChatStore((state) => state.subscribeToWorkspace);

export const useEventUnsubscribeFromWorkspace = () => 
  useEventChatStore((state) => state.unsubscribeFromWorkspace);

export const useEventCleanup = () => 
  useEventChatStore((state) => state.cleanup);


// Legacy-compatible exports to match the original store naming
export const useSelectedWorkspace = useEventSelectedWorkspace;
export const useSetSelectedWorkspace = useEventSetSelectedWorkspace;
export const useConversations = useEventConversations;
export const useConversation = useEventConversation;
export const useSetConversation = useEventSetConversation;
export const useWorkspaceConversations = useEventWorkspaceConversations;
export const useAddConversationToWorkspace = useEventAddConversationToWorkspace;
export const useRemoveConversationFromWorkspace = useEventRemoveConversationFromWorkspace;
export const useSetWorkspaceConversations = useEventSetWorkspaceConversations;
export const useSubscribeToWorkspace = useEventSubscribeToWorkspace;
export const useUnsubscribeFromWorkspace = useEventUnsubscribeFromWorkspace;
export const useCleanup = useEventCleanup;

// Type exports for compatibility
export type { EventConversation as Conversation, EventConversationMeta as ConversationMeta };
export type { Event };