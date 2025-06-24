import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

// Simple, clean types - no complex mappings
export interface Message {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
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
}

export const useSimpleChatStore = create<SimpleChatStore>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        // Initial state
        conversations: {},
        workspaceConversations: {},
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