import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { createClient } from '@/lib/supabase/client';
import { Event, Role } from '@/lib/types/events';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Properly typed Supabase realtime payload
interface RealtimePayload {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: {
    id: string;
    [key: string]: unknown;
  };
  old?: {
    id: string;
    [key: string]: unknown;
  };
}

// Minimal conversation summary for sidebar display
export interface ConversationSummary {
  id: string
  title?: string
  created_at: string
  workspace_id: string
}

// Event-based conversation types (complete data for chat display)
export interface EventConversationMeta {
  id: string
  title?: string
  workspace_id: string
  source_bud_id?: string
  assistant_name?: string
  assistant_avatar?: string
  model_config_overrides?: Record<string, unknown>
  mcp_config_overrides?: Record<string, unknown>
  created_at: string
}

export interface EventConversation {
  id: string
  events: Event[]
  isStreaming: boolean
  streamingEventId?: string
  shouldCreateNewEvent?: boolean
  meta: EventConversationMeta
}

interface EventChatStore {
  // Core data - complete conversations for chat display
  conversations: Record<string, EventConversation>
  
  // Minimal summaries for sidebar display
  conversationSummaries: Record<string, ConversationSummary>
  
  // Workspace conversation management for sidebar
  workspaceConversations: Record<string, string[]> // workspaceId -> conversationIds[]
  
  // Realtime subscriptions
  realtimeChannels: Record<string, RealtimeChannel> // workspaceId -> channel
  
  // Optimistic UI state
  activeTempConversation?: string // Prevents realtime from interfering with temp conversations
  
  // UI state
  ui: {
    selectedWorkspace: string | null
  }
  
  // Conversation actions
  setConversation: (id: string, conversation: EventConversation) => void
  updateConversation: (id: string, updates: Partial<EventConversation>) => void
  removeConversation: (id: string) => void
  
  // Event actions
  addEvent: (conversationId: string, event: Event) => void
  updateEvent: (conversationId: string, eventId: string, updates: Partial<Event>) => void
  replaceEvent: (conversationId: string, eventId: string, event: Event) => void
  
  // Streaming actions
  startStreaming: (conversationId: string, eventId: string) => void
  updateStreamingEvent: (conversationId: string, event: Event) => void
  finishStreaming: (conversationId: string, finalEvent: Event) => void
  
  // Conversation summary actions
  setConversationSummary: (id: string, summary: ConversationSummary) => void
  setConversationSummaries: (summaries: ConversationSummary[]) => void
  removeConversationSummary: (id: string) => void
  
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
        conversationSummaries: {},
        workspaceConversations: {},
        realtimeChannels: {},
        activeTempConversation: undefined,
        ui: {
          selectedWorkspace: null,
        },
        
        // Conversation actions
        setConversation: (id, conversation) => set((state) => {
          state.conversations[id] = conversation;
          
          // Auto-sync: when setting a full conversation, also create/update the summary
          const summary: ConversationSummary = {
            id: conversation.id,
            title: conversation.meta.title,
            created_at: conversation.meta.created_at,
            workspace_id: conversation.meta.workspace_id
          };
          state.conversationSummaries[id] = summary;
        }),
        
        updateConversation: (id, updates) => set((state) => {
          if (state.conversations[id]) {
            state.conversations[id] = {
              ...state.conversations[id],
              ...updates
            };
            
            // Auto-sync: update summary if conversation meta changed
            if (updates.meta) {
              const conversation = state.conversations[id];
              const summary: ConversationSummary = {
                id: conversation.id,
                title: conversation.meta.title,
                created_at: conversation.meta.created_at,
                workspace_id: conversation.meta.workspace_id
              };
              state.conversationSummaries[id] = summary;
            }
          }
        }),
        
        removeConversation: (id) => set((state) => {
          delete state.conversations[id];
          // Auto-sync: also remove the summary
          delete state.conversationSummaries[id];
        }),
        
        // Conversation summary actions
        setConversationSummary: (id, summary) => set((state) => {
          state.conversationSummaries[id] = summary;
        }),
        
        setConversationSummaries: (summaries) => set((state) => {
          // Clear existing summaries and set new ones
          state.conversationSummaries = {};
          summaries.forEach(summary => {
            state.conversationSummaries[summary.id] = summary;
          });
        }),
        
        removeConversationSummary: (id) => set((state) => {
          delete state.conversationSummaries[id];
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
            // Add new conversations to the front (most recent first)
            state.workspaceConversations[workspaceId].unshift(conversationId);
          }
        }),
        
        removeConversationFromWorkspace: (workspaceId, conversationId) => set((state) => {
          if (state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId]
              .filter(id => id !== conversationId);
          }
          // Also remove the summary when conversation is removed from workspace
          delete state.conversationSummaries[conversationId];
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
                  conversationId: (payload.new && 'id' in payload.new ? payload.new.id : null) || 
                                 (payload.old && 'id' in payload.old ? payload.old.id : null),
                  currentLocalEvents: get().conversations[(payload.new && 'id' in payload.new ? payload.new.id : null) || 
                                                        (payload.old && 'id' in payload.old ? payload.old.id : null)]?.events?.length || 0
                });
                
                if (payload.eventType === 'UPDATE' && payload.new && 'id' in payload.new) {
                  const updatedConversation = payload.new;
                  const conversationId = updatedConversation.id as string;
                  const title = 'title' in updatedConversation ? String(updatedConversation.title || 'Untitled') : 'Untitled';
                  console.log('📝 Updating conversation:', conversationId, 'title:', title);
                  
                  set((state) => {
                    if (state.conversations[conversationId]) {
                      // Update existing conversation
                      const currentTitle = state.conversations[conversationId].meta.title;
                      state.conversations[conversationId].meta = {
                        ...state.conversations[conversationId].meta,
                        title: 'title' in updatedConversation ? updatedConversation.title as string : state.conversations[conversationId].meta.title,
                        assistant_name: 'assistant_name' in updatedConversation ? updatedConversation.assistant_name as string : state.conversations[conversationId].meta.assistant_name,
                        assistant_avatar: 'assistant_avatar' in updatedConversation ? updatedConversation.assistant_avatar as string : state.conversations[conversationId].meta.assistant_avatar,
                        model_config_overrides: 'model_config_overrides' in updatedConversation ? updatedConversation.model_config_overrides as Record<string, unknown> : state.conversations[conversationId].meta.model_config_overrides,
                        mcp_config_overrides: 'mcp_config_overrides' in updatedConversation ? updatedConversation.mcp_config_overrides as Record<string, unknown> : state.conversations[conversationId].meta.mcp_config_overrides,
                      };
                      
                      // Auto-sync: update conversation summary with new title
                      const updatedConversationObj = state.conversations[conversationId];
                      const summary: ConversationSummary = {
                        id: updatedConversationObj.id,
                        title: updatedConversationObj.meta.title,
                        created_at: updatedConversationObj.meta.created_at,
                        workspace_id: updatedConversationObj.meta.workspace_id
                      };
                      state.conversationSummaries[conversationId] = summary;
                      
                      console.log('✅ Conversation updated in store:', currentTitle, '→', title);
                    } else {
                      console.log('⚠️ Conversation not found in store, queuing update:', conversationId);
                      
                      // Conversation not in store yet - retry after a delay
                      setTimeout(() => {
                        console.log('🔄 Retrying conversation update:', conversationId);
                        const currentState = get();
                        if (currentState.conversations[conversationId]) {
                          set((retryState) => {
                            retryState.conversations[conversationId].meta = {
                              ...retryState.conversations[conversationId].meta,
                              title: 'title' in updatedConversation ? updatedConversation.title as string : retryState.conversations[conversationId].meta.title,
                              assistant_name: 'assistant_name' in updatedConversation ? updatedConversation.assistant_name as string : retryState.conversations[conversationId].meta.assistant_name,
                              assistant_avatar: 'assistant_avatar' in updatedConversation ? updatedConversation.assistant_avatar as string : retryState.conversations[conversationId].meta.assistant_avatar,
                              model_config_overrides: 'model_config_overrides' in updatedConversation ? updatedConversation.model_config_overrides as Record<string, unknown> : retryState.conversations[conversationId].meta.model_config_overrides,
                              mcp_config_overrides: 'mcp_config_overrides' in updatedConversation ? updatedConversation.mcp_config_overrides as Record<string, unknown> : retryState.conversations[conversationId].meta.mcp_config_overrides,
                            };
                            
                            // Auto-sync: update conversation summary with new title (delayed retry)
                            const retryUpdatedConversation = retryState.conversations[conversationId];
                            const retrySummary: ConversationSummary = {
                              id: retryUpdatedConversation.id,
                              title: retryUpdatedConversation.meta.title,
                              created_at: retryUpdatedConversation.meta.created_at,
                              workspace_id: retryUpdatedConversation.meta.workspace_id
                            };
                            retryState.conversationSummaries[conversationId] = retrySummary;
                            
                            console.log('✅ Delayed update successful:', title);
                          });
                        } else {
                          console.log('❌ Conversation still not found after retry:', conversationId);
                        }
                      }, 1000);
                    }
                  });
                } else if (payload.eventType === 'INSERT') {
                  if (!payload.new || typeof payload.new !== 'object' || !('id' in payload.new)) {
                    console.warn('INSERT payload missing new object or id');
                    return;
                  }
                  const newConversation = payload.new;
                  
                  set((state) => {
                    // Don't interfere if we have an active temp conversation
                    if (state.activeTempConversation) {
                      return;
                    }
                    
                    // 🔧 RACE CONDITION FIX: Don't overwrite existing conversations that have events
                    const conversationId = newConversation.id as string;
                    const existingConversation = state.conversations[conversationId];
                    if (existingConversation && existingConversation.events.length > 0) {
                      console.log('🔒 [REALTIME] Skipping INSERT - conversation already has events:', {
                        conversationId,
                        existingEventCount: existingConversation.events.length
                      });
                      
                      // Just update metadata without touching events
                      existingConversation.meta = {
                        ...existingConversation.meta,
                        title: 'title' in newConversation ? newConversation.title : existingConversation.meta.title,
                        assistant_name: 'assistant_name' in newConversation ? newConversation.assistant_name : existingConversation.meta.assistant_name,
                        assistant_avatar: 'assistant_avatar' in newConversation ? newConversation.assistant_avatar : existingConversation.meta.assistant_avatar,
                        model_config_overrides: 'model_config_overrides' in newConversation ? newConversation.model_config_overrides : existingConversation.meta.model_config_overrides,
                        mcp_config_overrides: 'mcp_config_overrides' in newConversation ? newConversation.mcp_config_overrides : existingConversation.meta.mcp_config_overrides,
                      };
                      
                      // Add to workspace conversations if not already there (with duplicate prevention)
                      if (!state.workspaceConversations[workspaceId]) {
                        state.workspaceConversations[workspaceId] = [];
                      }
                      const workspaceConvs = state.workspaceConversations[workspaceId];
                      if (!workspaceConvs.includes(conversationId)) {
                        // Remove any duplicates before adding (extra safety)
                        state.workspaceConversations[workspaceId] = [
                          ...workspaceConvs.filter(id => id !== conversationId),
                          conversationId
                        ];
                      }
                      return; // Exit early
                    }
                    
                    console.log('📝 [REALTIME] Creating new conversation from INSERT:', {
                      conversationId,
                      hasExistingConversation: !!existingConversation
                    });
                    
                    // Create the full conversation object with metadata
                    const conversationMeta: EventConversationMeta = {
                      id: conversationId,
                      title: 'title' in newConversation ? newConversation.title as string : undefined,
                      workspace_id: 'workspace_id' in newConversation ? newConversation.workspace_id as string : workspaceId,
                      source_bud_id: 'source_bud_id' in newConversation ? newConversation.source_bud_id as string : undefined,
                      assistant_name: 'assistant_name' in newConversation ? newConversation.assistant_name as string : undefined,
                      assistant_avatar: 'assistant_avatar' in newConversation ? newConversation.assistant_avatar as string : undefined,
                      model_config_overrides: 'model_config_overrides' in newConversation ? newConversation.model_config_overrides as Record<string, unknown> : undefined,
                      mcp_config_overrides: 'mcp_config_overrides' in newConversation ? newConversation.mcp_config_overrides as Record<string, unknown> : undefined,
                      created_at: 'created_at' in newConversation ? newConversation.created_at as string : new Date().toISOString()
                    };

                    const conversation: EventConversation = {
                      id: conversationMeta.id,
                      events: [], // Events will be loaded when conversation is opened
                      isStreaming: false,
                      meta: conversationMeta
                    };

                    // Store the full conversation
                    state.conversations[conversationMeta.id] = conversation;

                    // Add to workspace conversations if not already there (with duplicate prevention)
                    if (!state.workspaceConversations[workspaceId]) {
                      state.workspaceConversations[workspaceId] = [];
                    }
                    const workspaceConvs = state.workspaceConversations[workspaceId];
                    if (!workspaceConvs.includes(conversationMeta.id)) {
                      // Remove any duplicates before adding (extra safety)
                      state.workspaceConversations[workspaceId] = [
                        conversationMeta.id,
                        ...workspaceConvs.filter(id => id !== conversationMeta.id)
                      ];
                    }
                  });
                } else if (payload.eventType === 'DELETE') {
                  if (!payload.old || typeof payload.old !== 'object' || !('id' in payload.old)) {
                    console.warn('DELETE payload missing old object or id');
                    return;
                  }
                  const deletedConversation = payload.old;
                  
                  set((state) => {
                    // Remove from conversations and workspace
                    const deletedId = deletedConversation.id as string;
                    delete state.conversations[deletedId];
                    if (state.workspaceConversations[workspaceId]) {
                      state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId].filter(
                        id => id !== deletedId
                      );
                    }
                  });
                }
              }
            )
            .subscribe();

          set((state) => ({
            ...state,
            realtimeChannels: {
              ...state.realtimeChannels,
              [workspaceId]: channel
            }
          }));
        },

        unsubscribeFromWorkspace: (workspaceId) => {
          const state = get();
          const channel = state.realtimeChannels[workspaceId];
          
          if (channel) {
            channel.unsubscribe();
            set((state) => ({
              ...state,
              realtimeChannels: Object.fromEntries(
                Object.entries(state.realtimeChannels).filter(([key]) => key !== workspaceId)
              )
            }));
          }
        },

        cleanup: () => {
          const state = get();
          
          // Unsubscribe from all channels
          Object.values(state.realtimeChannels).forEach(channel => {
            channel.unsubscribe();
          });
          
          set((state) => ({
            ...state,
            realtimeChannels: {}
          }));
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
export function eventsToLegacyMessages(events: Event[]): unknown[] {
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
export function legacyMessagesToEvents(messages: unknown[]): Event[] {
  return messages.map(message => {
    const msg = message as {
      id: string;
      role: string;
      content?: string;
      created_at: string;
      json_meta?: {
        tool_calls?: Array<{
          id: string;
          function: {
            name: string;
            arguments: string;
          };
        }>;
      };
    }; // Type assertion for legacy message structure
    return {
      id: msg.id,
      role: msg.role as Role,
      segments: [
        ...(msg.content ? [{ type: 'text' as const, text: msg.content }] : []),
        ...(msg.json_meta?.tool_calls || []).map((toolCall: { id: string; function: { name: string; arguments: string } }) => ({
          type: 'tool_call' as const,
          id: toolCall.id,
          name: toolCall.function.name,
          args: JSON.parse(toolCall.function.arguments || '{}')
        }))
      ],
      ts: new Date(msg.created_at).getTime()
    };
  });
}

// Event-based hooks
export const useEventConversation = (conversationId: string) =>
  useEventChatStore((state) => state.conversations[conversationId]);

export const useEventConversations = (): Record<string, EventConversation> =>
  useEventChatStore((state) => state.conversations);

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

// Conversation summary hooks
export const useConversationSummary = (conversationId: string) =>
  useEventChatStore((state) => state.conversationSummaries[conversationId]);

export const useConversationSummaries = (): Record<string, ConversationSummary> =>
  useEventChatStore((state) => state.conversationSummaries);

export const useSetConversationSummary = () => 
  useEventChatStore((state) => state.setConversationSummary);

export const useSetConversationSummaries = () => 
  useEventChatStore((state) => state.setConversationSummaries);

export const useRemoveConversationSummary = () => 
  useEventChatStore((state) => state.removeConversationSummary);

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
// ConversationSummary is already exported above