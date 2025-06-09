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
  chats: Record<ConversationId, ChatState>
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
}

export const useChatStore = create<ChatStore>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        // Initial state
        chats: {},
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
        setChat: (chatId, chat) => set((state) => {
          state.chats[chatId] = chat
        }),
        
        updateChatMeta: (chatId, meta) => set((state) => {
          if (state.chats[chatId]) {
            Object.assign(state.chats[chatId].meta, meta)
          }
        }),
        
        removeChat: (chatId) => set((state) => {
          delete state.chats[chatId]
          if (state.ui.selectedConversation === chatId) {
            state.ui.selectedConversation = null
          }
        }),
        
        // Message Management Actions
        addMessage: (chatId, message) => set((state) => {
          if (!state.chats[chatId]) {
            console.warn(`Attempted to add message to non-existent chat: ${chatId}`)
            return
          }
          
          const chat = state.chats[chatId]
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
        
        updateMessage: (chatId, messageId, updates) => set((state) => {
          const chat = state.chats[chatId]
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
        
        removeMessage: (chatId, messageId) => set((state) => {
          const chat = state.chats[chatId]
          if (chat) {
            delete chat.byId[messageId]
            chat.messages = chat.messages.filter(id => id !== messageId)
          }
        }),
        
        setMessages: (chatId, messages) => set((state) => {
          if (!state.chats[chatId]) return
          
          const chat = state.chats[chatId]
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
            let chat = state.chats[conversationId]
            
            // Create chat if it doesn't exist (for /new route)
            if (!chat) {
              chat = {
                meta: {
                  id: conversationId,
                  workspace_id: workspaceId,
                  created_at: now,
                  isOptimistic: true,
                },
                messages: [],
                byId: {},
                streaming: false,
                  }
              state.chats[conversationId] = chat
              state.ui.selectedConversation = conversationId
            }
            
            const existingMessages = Object.values(chat.byId)
            const nextUserIndex = existingMessages.filter(m => m.role === 'user').length + 1
            const nextAssistantIndex = existingMessages.filter(m => m.role === 'assistant').length + 1
            
            // Add user message
            const userMessage: OptimisticMessage = {
              id: userMessageId,
              conversation_id: conversationId,
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
              conversation_id: conversationId,
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
        
        // Streaming Actions
        startStreaming: (chatId, messageId) => set((state) => {
          const chat = state.chats[chatId]
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
        
        appendStreamDelta: (chatId, { id, content, finished }) => set((state) => {
          const chat = state.chats[chatId]
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
        
        finishStreaming: (chatId, messageId, finalContent) => set((state) => {
          const chat = state.chats[chatId]
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
            console.error('finishStreaming: Message not found', { chatId, messageId, availableIds: Object.keys(chat?.byId || {}) })
          }
        }),
        
        // Atomic finish streaming with ID update to prevent flicker
        finishStreamingWithIdUpdate: (chatId, tempMessageId, finalContent, realMessageId) => set((state) => {
          const chat = state.chats[chatId]
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
          } else {
            console.error('finishStreamingWithIdUpdate: Message not found', { 
              chatId, 
              tempMessageId, 
              availableIds: Object.keys(chat?.byId || {}) 
            })
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
            // Copy the temp chat to the real conversation ID
            state.chats[realChatId] = {
              ...tempChat,
              meta: {
                ...tempChat.meta,
                id: realChatId,
                ...realConversationData,
                isOptimistic: false
              }
            }
            
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
            
            // Remove the temp chat
            delete state.chats[tempChatId]
            
            // Update UI state if this was the selected conversation
            if (state.ui.selectedConversation === tempChatId) {
              state.ui.selectedConversation = realChatId
            }
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
        
        rollbackOptimisticMessage: (chatId, messageId) => set((state) => {
          const chat = state.chats[chatId]
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

// Selectors for performance - components can subscribe to specific slices
export const useChat = (chatId: ConversationId) => 
  useChatStore((state) => state.chats[chatId])

export const useMessages = (chatId: ConversationId) => {
  const chat = useChatStore((state) => state.chats[chatId])
  return useMemo(() => {
    if (!chat) return []
    const messages = chat.messages.map(id => chat.byId[id]).filter(Boolean)
    return sortByOrderKey(messages)
  }, [chat])
}

export const useCurrentChat = () => 
  useChatStore((state) => {
    const { selectedConversation } = state.ui
    return selectedConversation ? state.chats[selectedConversation] : undefined
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

// For cases where you need to get a chat by dynamic ID within a component
export const useChatGetter = () => {
  const chats = useChatStore((state) => state.chats)
  return useCallback((chatId: ConversationId) => chats[chatId], [chats])
}
export const useCreateTempChat = () => useChatStore((state) => state.createTempChat)
export const useStartStreaming = () => useChatStore((state) => state.startStreaming)
export const useAppendStreamDelta = () => useChatStore((state) => state.appendStreamDelta)
export const useFinishStreaming = () => useChatStore((state) => state.finishStreaming)
export const useFinishStreamingWithIdUpdate = () => useChatStore((state) => state.finishStreamingWithIdUpdate)
export const useMigrateConversation = () => useChatStore((state) => state.migrateConversation)
export const useAddError = () => useChatStore((state) => state.addError)
export const useSetChat = () => useChatStore((state) => state.setChat)