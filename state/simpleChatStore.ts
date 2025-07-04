import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

// Simple, clean types - no complex mappings
export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  created_at: string
  updated_at: string
  order_key: string
  json_meta?: Record<string, any>
}

export interface ConversationMeta {
  id: string
  title?: string
  workspace_id: string
  source_bud_id?: string // Renamed from bud_id  
  assistant_name?: string // Custom assistant name (NULL = use bud default)
  assistant_avatar?: string // Custom assistant avatar (NULL = use bud default)
  model_config_overrides?: Record<string, any> // Model configuration overrides as JSON
  created_at: string
}

export interface Conversation {
  id: string
  messages: Message[]
  isStreaming: boolean
  streamingMessageId?: string
  meta: ConversationMeta
}

interface SimpleChatStore {
  // Core data - only real conversations (no temp IDs, no registry)
  conversations: Record<string, Conversation>
  
  // Workspace conversation management for sidebar
  workspaceConversations: Record<string, string[]> // workspaceId -> conversationIds[]
  
  // Realtime subscriptions
  realtimeChannels: Record<string, RealtimeChannel> // workspaceId -> channel
  
  // UI state
  ui: {
    selectedWorkspace: string | null
  }
  
  // Actions - simple and direct
  setConversation: (id: string, conversation: Conversation) => void
  updateConversation: (id: string, updates: Partial<Conversation>) => void
  
  // Message actions
  addMessage: (conversationId: string, message: Message) => void
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void
  
  // Streaming actions
  startStreaming: (conversationId: string, messageId: string) => void
  appendToStreamingMessage: (conversationId: string, content: string) => void
  finishStreaming: (conversationId: string, finalContent: string) => void
  
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

export const useSimpleChatStore = create<SimpleChatStore>()(
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
          state.conversations[id] = conversation
        }),
        
        updateConversation: (id, updates) => set((state) => {
          if (state.conversations[id]) {
            Object.assign(state.conversations[id], updates)
          }
        }),
        
        // Message actions
        addMessage: (conversationId, message) => set((state) => {
          const conversation = state.conversations[conversationId]
          if (conversation) {
            conversation.messages.push(message)
          }
        }),
        
        updateMessage: (conversationId, messageId, updates) => set((state) => {
          const conversation = state.conversations[conversationId]
          if (conversation) {
            const messageIndex = conversation.messages.findIndex(m => m.id === messageId)
            if (messageIndex >= 0) {
              Object.assign(conversation.messages[messageIndex], updates)
            }
          }
        }),
        
        // Streaming actions
        startStreaming: (conversationId, messageId) => set((state) => {
          const conversation = state.conversations[conversationId]
          if (conversation) {
            conversation.isStreaming = true
            conversation.streamingMessageId = messageId
          }
        }),
        
        appendToStreamingMessage: (conversationId, content) => set((state) => {
          const conversation = state.conversations[conversationId]
          if (conversation && conversation.streamingMessageId) {
            const message = conversation.messages.find(m => m.id === conversation.streamingMessageId)
            if (message) {
              message.content += content
              message.updated_at = new Date().toISOString()
            }
          }
        }),
        
        finishStreaming: (conversationId, finalContent) => set((state) => {
          const conversation = state.conversations[conversationId]
          if (conversation && conversation.streamingMessageId) {
            const message = conversation.messages.find(m => m.id === conversation.streamingMessageId)
            if (message) {
              message.content = finalContent
              message.updated_at = new Date().toISOString()
            }
            conversation.isStreaming = false
            conversation.streamingMessageId = undefined
          }
        }),
        
        // Workspace actions
        addConversationToWorkspace: (workspaceId, conversationId) => set((state) => {
          if (!state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = []
          }
          if (!state.workspaceConversations[workspaceId].includes(conversationId)) {
            state.workspaceConversations[workspaceId].push(conversationId)
          }
        }),
        
        removeConversationFromWorkspace: (workspaceId, conversationId) => set((state) => {
          if (state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId]
              .filter(id => id !== conversationId)
          }
        }),
        
        setWorkspaceConversations: (workspaceId, conversationIds) => set((state) => {
          state.workspaceConversations[workspaceId] = conversationIds
        }),

        // UI actions
        setSelectedWorkspace: (workspaceId) => set((state) => {
          state.ui.selectedWorkspace = workspaceId
        }),

        // Realtime actions
        subscribeToWorkspace: (workspaceId) => {
          const state = get()
          
          // Don't subscribe if already subscribed
          if (state.realtimeChannels[workspaceId]) {
            return
          }

          const supabase = createClient()
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
                console.log('📡 Conversation update:', payload)
                
                if (payload.eventType === 'UPDATE') {
                  const updatedConversation = payload.new as any
                  console.log('📝 Updating conversation:', updatedConversation.id, 'title:', updatedConversation.title)
                  
                  set((state) => {
                    if (state.conversations[updatedConversation.id]) {
                      // Update existing conversation
                      const currentTitle = state.conversations[updatedConversation.id].meta.title
                      state.conversations[updatedConversation.id].meta = {
                        ...state.conversations[updatedConversation.id].meta,
                        title: updatedConversation.title,
                        assistant_name: updatedConversation.assistant_name,
                        assistant_avatar: updatedConversation.assistant_avatar,
                        model_config_overrides: updatedConversation.model_config_overrides,
                      }
                      console.log('✅ Conversation updated in store:', currentTitle, '→', updatedConversation.title)
                      console.log('🔍 Store state after update:', Object.keys(state.conversations).length, 'conversations')
                    } else {
                      console.log('⚠️ Conversation not found in store, queuing update:', updatedConversation.id)
                      
                      // Conversation not in store yet - retry after a delay
                      setTimeout(() => {
                        console.log('🔄 Retrying conversation update:', updatedConversation.id)
                        const currentState = get()
                        if (currentState.conversations[updatedConversation.id]) {
                          set((retryState) => {
                            retryState.conversations[updatedConversation.id].meta = {
                              ...retryState.conversations[updatedConversation.id].meta,
                              title: updatedConversation.title,
                              assistant_name: updatedConversation.assistant_name,
                              assistant_avatar: updatedConversation.assistant_avatar,
                              model_config_overrides: updatedConversation.model_config_overrides,
                            }
                            console.log('✅ Delayed update successful:', updatedConversation.title)
                          })
                        } else {
                          console.log('❌ Conversation still not found after retry:', updatedConversation.id)
                        }
                      }, 1000) // 1 second delay
                    }
                  })
                } else if (payload.eventType === 'INSERT') {
                  const newConversation = payload.new as any
                  
                  set((state) => {
                    // Add to workspace conversations if not already there
                    if (!state.workspaceConversations[workspaceId]) {
                      state.workspaceConversations[workspaceId] = []
                    }
                    if (!state.workspaceConversations[workspaceId].includes(newConversation.id)) {
                      state.workspaceConversations[workspaceId].unshift(newConversation.id)
                    }
                  })
                } else if (payload.eventType === 'DELETE') {
                  const deletedConversation = payload.old as any
                  
                  set((state) => {
                    // Remove from conversations and workspace
                    delete state.conversations[deletedConversation.id]
                    if (state.workspaceConversations[workspaceId]) {
                      state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId].filter(
                        id => id !== deletedConversation.id
                      )
                    }
                  })
                }
              }
            )
            .subscribe()

          set((state) => {
            state.realtimeChannels[workspaceId] = channel
          })
        },

        unsubscribeFromWorkspace: (workspaceId) => {
          const state = get()
          const channel = state.realtimeChannels[workspaceId]
          
          if (channel) {
            channel.unsubscribe()
            set((state) => {
              delete state.realtimeChannels[workspaceId]
            })
          }
        },

        cleanup: () => {
          const state = get()
          
          // Unsubscribe from all channels
          Object.values(state.realtimeChannels).forEach(channel => {
            channel.unsubscribe()
          })
          
          set((state) => {
            state.realtimeChannels = {}
          })
        },
      })),
      {
        name: 'simple-chat-store',
        partialize: (state) => ({
          ui: {
            selectedWorkspace: state.ui.selectedWorkspace,
          },
          // Don't persist conversations - they'll be loaded from server as needed
        }),
      }
    )
  )
)

// Simple hooks - no complex registry lookups
export const useConversation = (conversationId: string) =>
  useSimpleChatStore((state) => state.conversations[conversationId])

export const useConversations = () =>
  useSimpleChatStore((state) => state.conversations)

export const useIsStreaming = (conversationId: string) =>
  useSimpleChatStore((state) => state.conversations[conversationId]?.isStreaming || false)

export const useSelectedWorkspace = () =>
  useSimpleChatStore((state) => state.ui.selectedWorkspace)

// Action hooks
export const useSetConversation = () => useSimpleChatStore((state) => state.setConversation)
export const useAddMessage = () => useSimpleChatStore((state) => state.addMessage)
export const useStartStreaming = () => useSimpleChatStore((state) => state.startStreaming)
export const useAppendToStreamingMessage = () => useSimpleChatStore((state) => state.appendToStreamingMessage)
export const useFinishStreaming = () => useSimpleChatStore((state) => state.finishStreaming)
export const useSetSelectedWorkspace = () => useSimpleChatStore((state) => state.setSelectedWorkspace)

// Workspace conversation management hooks
export const useWorkspaceConversations = (workspaceId: string) => 
  useSimpleChatStore((state) => state.workspaceConversations[workspaceId])

export const useAddConversationToWorkspace = () => 
  useSimpleChatStore((state) => state.addConversationToWorkspace)

export const useRemoveConversationFromWorkspace = () => 
  useSimpleChatStore((state) => state.removeConversationFromWorkspace)

export const useSetWorkspaceConversations = () => 
  useSimpleChatStore((state) => state.setWorkspaceConversations)

// Realtime hooks
export const useSubscribeToWorkspace = () => 
  useSimpleChatStore((state) => state.subscribeToWorkspace)

export const useUnsubscribeFromWorkspace = () => 
  useSimpleChatStore((state) => state.unsubscribeFromWorkspace)

export const useCleanup = () => 
  useSimpleChatStore((state) => state.cleanup)