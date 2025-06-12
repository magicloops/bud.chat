import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { useMemo, useCallback } from 'react'
import { 
  ChatState, 
  UnifiedMessage, 
  ConversationId, 
  MessageId, 
  WorkspaceId,
  ChatMetadata,
  OptimisticMessage,
  SendMessageArgs,
  CreateChatArgs,
  BranchChatArgs,
  OptimisticError,
  StreamDelta,
  UIState
} from '@/lib/types'
import { generateTempId, isTempId, sortByOrderKey } from '@/lib/fractionalKey'

interface ChatStore {
  // State
  chats: Record<ConversationId, ChatState>  // Actual storage (will be renamed to conversations)
  registry: Record<ConversationId, ConversationId>  // displayId -> actualId mapping
  workspaceConversations: Record<WorkspaceId, ConversationId[]>  // workspaceId -> displayId[]
  ui: UIState
  errors: Record<MessageId, OptimisticError>
  
  
  // Actions - Chat Management
  setChat: (chatId: ConversationId, chat: ChatState) => void
  updateChatMeta: (chatId: ConversationId, meta: Partial<ChatMetadata>) => void
  removeChat: (chatId: ConversationId) => void
  
  // Actions - Message Management  
  addMessage: (chatId: ConversationId, message: UnifiedMessage) => void
  updateMessage: (chatId: ConversationId, messageId: MessageId, updates: Partial<UnifiedMessage>) => void
  removeMessage: (chatId: ConversationId, messageId: MessageId) => void
  setMessages: (chatId: ConversationId, messages: UnifiedMessage[]) => void
  
  // Actions - Optimistic Operations
  createOptimisticChat: (args: CreateChatArgs) => { chatId: ConversationId; userMessageId?: MessageId }
  sendOptimisticMessage: (args: SendMessageArgs) => { userMessageId: MessageId; assistantMessageId: MessageId }
  branchOptimisticChat: (args: BranchChatArgs) => { newChatId: ConversationId }
  
  // Actions - Streaming
  startStreaming: (chatId: ConversationId, messageId: MessageId) => void
  appendStreamDelta: (chatId: ConversationId, delta: StreamDelta) => void
  finishStreaming: (chatId: ConversationId, messageId: MessageId, finalContent: string) => void
  
  // Actions - Error Handling
  addError: (messageId: MessageId, error: string) => void
  clearError: (messageId: MessageId) => void
  rollbackOptimisticMessage: (chatId: ConversationId, messageId: MessageId) => void
  
  // Actions - UI State
  setSelectedConversation: (id: ConversationId | null) => void
  setSelectedWorkspace: (id: WorkspaceId | null) => void
  setComposerDraft: (draft: string) => void
  setComposerSubmitting: (submitting: boolean) => void
  
  // Actions - Persistence
  hydrate: (data: Partial<Pick<ChatStore, 'chats' | 'ui'>>) => void
  
  // Actions - Registry Pattern (Phase 1)
  getConversation: (displayId: ConversationId) => ChatState | undefined
  promoteConversation: (displayId: ConversationId, realId: ConversationId) => void
  clearRegistryEntry: (displayId: ConversationId) => void
  addConversationToWorkspace: (workspaceId: WorkspaceId, displayId: ConversationId) => void
  addMultipleConversationsToWorkspace: (workspaceId: WorkspaceId, displayIds: ConversationId[]) => void
  removeConversationFromWorkspace: (workspaceId: WorkspaceId, displayId: ConversationId) => void
  getWorkspaceConversations: (workspaceId: WorkspaceId) => ConversationId[]
}

export const useChatStore = create<ChatStore>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        // Initial state
        chats: {},
        registry: {},  // displayId -> actualId mapping
        workspaceConversations: {},  // workspaceId -> displayId[]
        ui: {
          selectedWorkspace: null,
          selectedConversation: null,
          composer: {
            draft: '',
            isSubmitting: false,
          },
        },
        errors: {},
        
        // Chat Management Actions
        setChat: (displayId, chat) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          state.chats[actualId] = chat
          
          // If this is the first time setting this chat with displayId, ensure registry is set
          if (displayId !== actualId) {
            state.registry[displayId] = actualId
          }
        }),
        
        updateChatMeta: (displayId, meta) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          if (state.chats[actualId]) {
            Object.assign(state.chats[actualId].meta, meta)
          }
        }),
        
        removeChat: (displayId) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          delete state.chats[actualId]
          
          // Clean up registry entry
          if (state.registry[displayId] === actualId) {
            delete state.registry[displayId]
          }
          
          if (state.ui.selectedConversation === displayId) {
            state.ui.selectedConversation = null
          }
        }),
        
        // Message Management Actions (Registry-aware)
        addMessage: (displayId, message) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          if (!state.chats[actualId]) {
            console.warn(`Attempted to add message to non-existent chat: ${displayId} (actual: ${actualId})`)
            return
          }
          
          const chat = state.chats[actualId]
          chat.byId[message.id] = message
          
          if (!chat.messages.includes(message.id)) {
            chat.messages.push(message.id)
            // Keep messages sorted by order_key
            const sortedMessages = chat.messages
              .map(id => chat.byId[id])
              .filter(Boolean)
              .sort((a, b) => a.order_key.localeCompare(b.order_key))
            chat.messages = sortedMessages.map(m => m.id)
          }
        }),
        
        updateMessage: (displayId, messageId, updates) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          if (chat?.byId[messageId]) {
            // Handle ID changes by remapping the message
            if (updates.id && updates.id !== messageId) {
              const message = chat.byId[messageId]
              Object.assign(message, updates)
              
              // Remap in byId object
              chat.byId[updates.id] = message
              delete chat.byId[messageId]
              
              // Update messages array
              const messageIndex = chat.messages.indexOf(messageId)
              if (messageIndex !== -1) {
                chat.messages[messageIndex] = updates.id
              }
            } else {
              Object.assign(chat.byId[messageId], updates)
            }
          }
        }),
        
        removeMessage: (displayId, messageId) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          if (chat) {
            delete chat.byId[messageId]
            chat.messages = chat.messages.filter(id => id !== messageId)
          }
        }),
        
        setMessages: (displayId, messages) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          if (!state.chats[actualId]) return
          
          const chat = state.chats[actualId]
          const sortedMessages = sortByOrderKey(messages)
          
          chat.messages = sortedMessages.map(m => m.id)
          chat.byId = Object.fromEntries(sortedMessages.map(m => [m.id, m]))
        }),
        
        // Optimistic Operations
        createOptimisticChat: ({ workspaceId, budId, systemPrompt, initialMessage }) => {
          const chatId = generateTempId()
          const now = new Date().toISOString()
          
          const chat: ChatState = {
            meta: {
              id: chatId,
              workspace_id: workspaceId,
              created_at: now,
              bud_id: budId,
              isOptimistic: true,
            },
            messages: [],
            byId: {},
            streaming: false,
          }
          
          let userMessageId: MessageId | undefined
          
          set((state) => {
            state.chats[chatId] = chat
            state.ui.selectedConversation = chatId
            
            // Add system message if provided
            if (systemPrompt) {
              const systemMessage: OptimisticMessage = {
                id: generateTempId(),
                conversation_id: chatId,
                order_key: 'temp-system',
                role: 'system',
                content: systemPrompt,
                json_meta: {},
                version: 1,
                created_at: now,
                updated_at: now,
                isOptimistic: true,
              }
              
              chat.messages.push(systemMessage.id)
              chat.byId[systemMessage.id] = systemMessage
            }
            
            // Add initial user message if provided
            if (initialMessage) {
              userMessageId = generateTempId()
              const userMessage: OptimisticMessage = {
                id: userMessageId,
                conversation_id: chatId,
                order_key: 'temp-user-1',
                role: 'user',
                content: initialMessage,
                json_meta: {},
                version: 1,
                created_at: now,
                updated_at: now,
                isOptimistic: true,
              }
              
              chat.messages.push(userMessage.id)
              chat.byId[userMessage.id] = userMessage
            }
          })
          
          return { chatId, userMessageId }
        },
        
        sendOptimisticMessage: ({ conversationId, content, workspaceId, model = 'gpt-4o' }) => {
          const userMessageId = generateTempId()
          const assistantMessageId = generateTempId()
          const now = new Date().toISOString()
          
          set((state) => {
            const actualId = state.registry[conversationId] || conversationId
            let chat = state.chats[actualId]
            
            // Create chat if it doesn't exist (for /new route)
            if (!chat) {
              chat = {
                meta: {
                  id: conversationId,  // Use display ID for meta
                  workspace_id: workspaceId,
                  created_at: now,
                  isOptimistic: true,
                },
                messages: [],
                byId: {},
                streaming: false,
                  }
              state.chats[actualId] = chat
              state.ui.selectedConversation = conversationId
            }
            
            const existingMessages = Object.values(chat.byId)
            const nextUserIndex = existingMessages.filter(m => m.role === 'user').length + 1
            const nextAssistantIndex = existingMessages.filter(m => m.role === 'assistant').length + 1
            
            // Add user message
            const userMessage: OptimisticMessage = {
              id: userMessageId,
              conversation_id: actualId,  // Use actual storage ID
              order_key: `temp-user-${nextUserIndex}`,
              role: 'user',
              content,
              json_meta: {},
              version: 1,
              created_at: now,
              updated_at: now,
              isOptimistic: true,
            }
            
            // Add assistant placeholder
            const assistantMessage: OptimisticMessage = {
              id: assistantMessageId,
              conversation_id: actualId,  // Use actual storage ID
              order_key: `temp-assistant-${nextAssistantIndex}`,
              role: 'assistant',
              content: '',
              json_meta: { model },
              version: 1,
              created_at: now,
              updated_at: now,
              isOptimistic: true,
              isPending: true,
            }
            
            chat.messages.push(userMessageId, assistantMessageId)
            chat.byId[userMessageId] = userMessage
            chat.byId[assistantMessageId] = assistantMessage
            chat.streaming = true
            chat.streamingMessageId = assistantMessageId
          })
          
          return { userMessageId, assistantMessageId }
        },
        
        branchOptimisticChat: ({ originalConversationId, fromMessageId, workspaceId }) => {
          const newChatId = `temp-branch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          const originalChat = get().chats[originalConversationId]
          
          if (!originalChat) {
            throw new Error(`Original chat ${originalConversationId} not found`)
          }
          
          // Get messages directly from the chat state
          const messages = originalChat.messages.map(id => originalChat.byId[id]).filter(Boolean)
          const sortedMessages = sortByOrderKey(messages)
          const fromIndex = sortedMessages.findIndex(m => m.id === fromMessageId)
          
          if (fromIndex === -1) {
            throw new Error(`Message ${fromMessageId} not found in chat`)
          }
          
          // Copy messages up to and including the fork point
          const messagesToCopy = sortedMessages.slice(0, fromIndex + 1)
          
          set((state) => {
            const newChat: ChatState = {
              meta: {
                id: newChatId,
                workspace_id: workspaceId,
                created_at: new Date().toISOString(),
                isOptimistic: true,
              },
              messages: [],
              byId: {},
              streaming: false,
              }
            
            // Copy messages with new IDs
            messagesToCopy.forEach((originalMsg, index) => {
              const newMessageId = generateTempId()
              const newMessage: OptimisticMessage = {
                ...originalMsg,
                id: newMessageId,
                conversation_id: newChatId,
                isOptimistic: true,
                // Keep same order_key for consistent ordering
              } as OptimisticMessage
              
              newChat.messages.push(newMessageId)
              newChat.byId[newMessageId] = newMessage
            })
            
            state.chats[newChatId] = newChat
            state.ui.selectedConversation = newChatId
          })
          
          return { newChatId }
        },
        
        // Streaming Actions (Registry-aware)
        startStreaming: (displayId, messageId) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          if (chat) {
            chat.streaming = true
            chat.streamingMessageId = messageId
            
            // Mark message as pending if it's optimistic
            const message = chat.byId[messageId]
            if (message && 'isOptimistic' in message) {
              message.isPending = true
            }
          }
        }),
        
        appendStreamDelta: (displayId, { id, content, finished }) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          if (chat && chat.streaming && chat.streamingMessageId === id) {
            const message = chat.byId[id]
            if (message) {
              message.content += content
              message.updated_at = new Date().toISOString()
              
              if (finished) {
                if ('isPending' in message) {
                  message.isPending = false
                }
                chat.streaming = false
                chat.streamingMessageId = undefined
              }
            }
          }
        }),
        
        finishStreaming: (displayId, messageId, finalContent) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          if (chat?.byId[messageId]) {
            const message = chat.byId[messageId]
            message.content = finalContent
            message.updated_at = new Date().toISOString()
            
            chat.streaming = false
            chat.streamingMessageId = undefined
            
            if ('isPending' in message) {
              message.isPending = false
            }
          } else {
            console.error('finishStreaming: Message not found', { displayId, actualId, messageId, availableIds: Object.keys(chat?.byId || {}) })
          }
        }),
        
        // Atomic finish streaming with ID update to prevent flicker (Registry-aware)
        finishStreamingWithIdUpdate: (displayId, tempMessageId, finalContent, realMessageId) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          
          if (chat?.byId[tempMessageId]) {
            const message = chat.byId[tempMessageId]
            
            // Update content and metadata
            message.content = finalContent
            message.updated_at = new Date().toISOString()
            message.isOptimistic = false
            
            // Update message ID atomically
            if (realMessageId !== tempMessageId) {
              // Move message to new ID
              chat.byId[realMessageId] = { ...message, id: realMessageId }
              delete chat.byId[tempMessageId]
              
              // Update messages array
              const messageIndex = chat.messages.indexOf(tempMessageId)
              if (messageIndex !== -1) {
                chat.messages[messageIndex] = realMessageId
              }
            }
            
            // Stop streaming
            chat.streaming = false
            chat.streamingMessageId = undefined
            
            if ('isPending' in message) {
              message.isPending = false
            }
          }
        }),
        
        // Create temporary chat for new conversations
        createTempChat: (tempChatId, workspaceId) => set((state) => {
          if (!state.chats[tempChatId]) {
            state.chats[tempChatId] = {
              meta: {
                id: tempChatId,
                workspace_id: workspaceId,
                created_at: new Date().toISOString(),
                isOptimistic: true,
              },
              messages: [],
              byId: {},
              streaming: false,
            }
            
            // Set as selected conversation
            state.ui.selectedConversation = tempChatId
          }
        }),
        
        // Conversation Migration Action - for moving temp conversations to real IDs
        migrateConversation: (tempChatId, realChatId, realConversationData) => set((state) => {
          const tempChat = state.chats[tempChatId]
          console.log('🔄 Migration debug:', {
            tempChatId,
            realChatId,
            tempChatExists: !!tempChat,
            tempChatMessages: tempChat ? Object.keys(tempChat.byId) : [],
            tempChatMessageCount: tempChat ? tempChat.messages.length : 0,
            isStreaming: tempChat?.streaming,
            streamingMessageId: tempChat?.streamingMessageId
          })
          
          if (tempChat) {
            // Copy the temp chat to the real conversation ID, preserving streaming state
            state.chats[realChatId] = {
              ...tempChat,
              meta: {
                ...tempChat.meta,
                id: realChatId,
                ...realConversationData,
                isOptimistic: false
              }
              // Note: streaming state is already copied by ...tempChat spread
            }
            
            console.log('🔄 Streaming state after copy:', {
              tempStreaming: tempChat.streaming,
              tempStreamingMessageId: tempChat.streamingMessageId,
              realStreaming: state.chats[realChatId].streaming,
              realStreamingMessageId: state.chats[realChatId].streamingMessageId
            })
            
            // Update all messages to have the new conversation ID
            Object.values(tempChat.byId).forEach(message => {
              if (message) {
                message.conversation_id = realChatId
              }
            })
            
            console.log('🔄 After migration:', {
              realChatExists: !!state.chats[realChatId],
              realChatMessages: state.chats[realChatId] ? Object.keys(state.chats[realChatId].byId) : [],
              realChatMessageCount: state.chats[realChatId] ? state.chats[realChatId].messages.length : 0,
              isStreaming: state.chats[realChatId]?.streaming,
              streamingMessageId: state.chats[realChatId]?.streamingMessageId
            })
            
            // Don't delete the temp chat yet - keep it until URL updates
            // This prevents the UI from losing access to the chat state
            // delete state.chats[tempChatId]
            
            // Update UI state if this was the selected conversation
            if (state.ui.selectedConversation === tempChatId) {
              state.ui.selectedConversation = realChatId
            }
          }
        }),
        
        // Sync messages from one conversation to another (for temp/real conversation sync)
        syncConversationMessages: (fromChatId, toChatId) => set((state) => {
          const fromChat = state.chats[fromChatId]
          const toChat = state.chats[toChatId]
          
          if (fromChat && toChat) {
            // Copy messages and byId from source to target
            toChat.messages = [...fromChat.messages]
            toChat.byId = { ...fromChat.byId }
            
            // Update conversation_id in all messages
            Object.values(toChat.byId).forEach(message => {
              if (message) {
                message.conversation_id = toChatId
              }
            })
            
            console.log('🔄 Synced messages from', fromChatId, 'to', toChatId, ':', toChat.messages.length, 'messages')
          }
        }),
        
        // Error Handling Actions
        addError: (messageId, error) => set((state) => {
          state.errors[messageId] = {
            messageId,
            error,
            timestamp: Date.now(),
          }
        }),
        
        clearError: (messageId) => set((state) => {
          delete state.errors[messageId]
        }),
        
        rollbackOptimisticMessage: (displayId, messageId) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          const chat = state.chats[actualId]
          if (chat) {
            delete chat.byId[messageId]
            chat.messages = chat.messages.filter(id => id !== messageId)
            
            // Clear streaming state if this was the streaming message
            if (chat.streamingMessageId === messageId) {
              chat.streaming = false
              chat.streamingMessageId = undefined
            }
          }
          
          // Clear any associated error
          delete state.errors[messageId]
        }),
        
        // UI State Actions
        setSelectedConversation: (id) => set((state) => {
          state.ui.selectedConversation = id
        }),
        
        setSelectedWorkspace: (id) => set((state) => {
          state.ui.selectedWorkspace = id
        }),
        
        setComposerDraft: (draft) => set((state) => {
          state.ui.composer.draft = draft
        }),
        
        setComposerSubmitting: (submitting) => set((state) => {
          state.ui.composer.isSubmitting = submitting
        }),
        
        // Registry Pattern Actions (Phase 1)
        getConversation: (displayId) => {
          const state = get()
          const actualId = state.registry[displayId] || displayId
          return state.chats[actualId]
        },
        
        promoteConversation: (displayId, realId) => set((state) => {
          const actualId = state.registry[displayId] || displayId
          
          // Copy conversation data to new real ID
          if (state.chats[actualId]) {
            state.chats[realId] = { 
              ...state.chats[actualId],
              meta: {
                ...state.chats[actualId].meta,
                id: realId,
                isOptimistic: false
              }
            }
            
            // Clean up old conversation data if it's different from the new one
            if (actualId !== realId) {
              delete state.chats[actualId]
            }
          }
          
          // Update registry to point displayId to realId
          state.registry[displayId] = realId
          console.log('📝 Registry updated:', { displayId, realId, isTemp: displayId.startsWith('temp-') })
          
          // If this was a /new conversation, add the real ID to workspace conversations
          if (displayId === 'new' && state.chats[realId]?.meta?.workspace_id) {
            const workspaceId = state.chats[realId].meta.workspace_id
            if (!state.workspaceConversations[workspaceId]) {
              state.workspaceConversations[workspaceId] = []
            }
            if (!state.workspaceConversations[workspaceId].includes(realId)) {
              state.workspaceConversations[workspaceId].unshift(realId)
            }
          }
        }),

        clearRegistryEntry: (displayId) => set((state) => {
          // Clear registry mapping for this display ID
          delete state.registry[displayId]
          // Also clear the chat data for this display ID to ensure fresh start
          delete state.chats[displayId]
        }),
        
        addConversationToWorkspace: (workspaceId, displayId) => set((state) => {
          if (!state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = []
          }
          if (!state.workspaceConversations[workspaceId].includes(displayId)) {
            state.workspaceConversations[workspaceId].unshift(displayId) // Add to beginning
          }
        }),
        
        // Batch version to reduce re-renders
        addMultipleConversationsToWorkspace: (workspaceId, displayIds) => set((state) => {
          if (!state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = []
          }
          const existing = new Set(state.workspaceConversations[workspaceId])
          const newIds = displayIds.filter(id => !existing.has(id))
          if (newIds.length > 0) {
            state.workspaceConversations[workspaceId] = [...newIds, ...state.workspaceConversations[workspaceId]]
          }
        }),
        
        removeConversationFromWorkspace: (workspaceId, displayId) => set((state) => {
          if (state.workspaceConversations[workspaceId]) {
            state.workspaceConversations[workspaceId] = state.workspaceConversations[workspaceId]
              .filter(id => id !== displayId)
          }
        }),
        
        getWorkspaceConversations: (workspaceId) => {
          const state = get()
          return state.workspaceConversations[workspaceId] || []
        },
        
        // Persistence Actions
        hydrate: (data) => set((state) => {
          if (data.chats) {
            Object.assign(state.chats, data.chats)
          }
          if (data.ui) {
            Object.assign(state.ui, data.ui)
          }
        }),
      })),
      {
        name: 'chat-store',
        partialize: (state) => ({
          ui: {
            selectedWorkspace: state.ui.selectedWorkspace,
            composer: {
              draft: state.ui.composer.draft,
              isSubmitting: false, // Don't persist submitting state
            },
          },
          // Don't persist chats - they'll be loaded from server
          // Don't persist errors - they're transient
        }),
      }
    )
  )
)

// Selectors for performance - components can subscribe to specific slices (Registry-aware)
export const useChat = (displayId: ConversationId) => 
  useChatStore((state) => {
    const actualId = state.registry[displayId] || displayId
    const chat = state.chats[actualId]
    
    // Debug: Log what's happening in useChat
    if (displayId.startsWith('temp-')) {
      console.log('🔍 useChat lookup for temp ID:', {
        displayId,
        actualId,
        registryHasEntry: !!state.registry[displayId],
        chatFound: !!chat,
        chatMessageCount: chat?.messages?.length || 0
      })
    }
    
    return chat
  })

export const useMessages = (displayId: ConversationId) => {
  const chat = useChatStore((state) => {
    const actualId = state.registry[displayId] || displayId
    return state.chats[actualId]
  })
  return useMemo(() => {
    if (!chat) return []
    const messages = chat.messages.map(id => chat.byId[id]).filter(Boolean)
    return sortByOrderKey(messages)
  }, [chat])
}

export const useCurrentChat = () => 
  useChatStore((state) => {
    const { selectedConversation } = state.ui
    if (!selectedConversation) return undefined
    const actualId = state.registry[selectedConversation] || selectedConversation
    return state.chats[actualId]
  })

export const useUIState = () => 
  useChatStore((state) => state.ui)


export const useChatError = (messageId: MessageId) =>
  useChatStore((state) => state.errors[messageId])

// Individual action hooks - the proper Zustand way
export const useSetSelectedConversation = () => useChatStore((state) => state.setSelectedConversation)
export const useSetSelectedWorkspace = () => useChatStore((state) => state.setSelectedWorkspace)
export const useSetComposerDraft = () => useChatStore((state) => state.setComposerDraft)
export const useSetComposerSubmitting = () => useChatStore((state) => state.setComposerSubmitting)
export const useSendOptimisticMessage = () => useChatStore((state) => state.sendOptimisticMessage)
export const useCreateOptimisticChat = () => useChatStore((state) => state.createOptimisticChat)
export const useAddMessage = () => useChatStore((state) => state.addMessage)
export const useUpdateMessage = () => useChatStore((state) => state.updateMessage)
export const useUpdateChatMeta = () => useChatStore((state) => state.updateChatMeta)
export const useRollbackOptimisticMessage = () => useChatStore((state) => state.rollbackOptimisticMessage)
export const useGetChat = (chatId: ConversationId) => useChatStore((state) => state.chats[chatId])

// For cases where you need to get a chat by dynamic ID within a component (Registry-aware)
export const useChatGetter = () => {
  const store = useChatStore()
  return useCallback((displayId: ConversationId) => {
    const actualId = store.registry[displayId] || displayId
    return store.chats[actualId]
  }, [store])
}
export const useCreateTempChat = () => useChatStore((state) => state.createTempChat)
export const useStartStreaming = () => useChatStore((state) => state.startStreaming)
export const useAppendStreamDelta = () => useChatStore((state) => state.appendStreamDelta)
export const useFinishStreaming = () => useChatStore((state) => state.finishStreaming)
export const useFinishStreamingWithIdUpdate = () => useChatStore((state) => state.finishStreamingWithIdUpdate)
export const useMigrateConversation = () => useChatStore((state) => state.migrateConversation)
export const useAddError = () => useChatStore((state) => state.addError)
export const useSetChat = () => useChatStore((state) => state.setChat)
export const useSyncConversationMessages = () => useChatStore((state) => state.syncConversationMessages)

// Registry Pattern Hooks (Phase 1)
export const useGetConversation = () => useChatStore((state) => state.getConversation)
export const usePromoteConversation = () => useChatStore((state) => state.promoteConversation)
export const useClearRegistryEntry = () => useChatStore((state) => state.clearRegistryEntry)
export const useAddConversationToWorkspace = () => useChatStore((state) => state.addConversationToWorkspace)
export const useRemoveConversationFromWorkspace = () => useChatStore((state) => state.removeConversationFromWorkspace)
export const useGetWorkspaceConversations = () => useChatStore((state) => state.getWorkspaceConversations)