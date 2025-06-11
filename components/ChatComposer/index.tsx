'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send, Square } from 'lucide-react'
import { 
  useUIState, 
  useCurrentChat, 
  useCreateOptimisticChat,
  useUpdateMessage,
  useUpdateChatMeta,
  useChatGetter,
  useChatStore
} from '@/state/chatStore'
import { createChat } from '@/lib/actions'
import { useStreaming } from '@/hooks/useStreaming'
import { useModel } from '@/contexts/model-context'
import { ConversationId, WorkspaceId } from '@/lib/types'

interface ChatComposerProps {
  conversationId?: ConversationId
  workspaceId: WorkspaceId
  className?: string
  placeholder?: string
  onMessageSent?: (messageId: string) => void
  onConversationIdChange?: (newId: ConversationId) => void
}

export function ChatComposer({
  conversationId,
  workspaceId,
  className,
  placeholder = "Type your message...",
  onMessageSent,
  onConversationIdChange,
}: ChatComposerProps) {
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const router = useRouter()
  
  const createOptimisticChat = useCreateOptimisticChat()
  const updateMessage = useUpdateMessage()
  const updateChatMeta = useUpdateChatMeta()
  const getChat = useChatGetter()
  const uiState = useUIState()
  const currentChat = useCurrentChat()
  const isStreaming = currentChat?.streaming || false
  const { selectedModel } = useModel()
  
  const { connect, disconnect } = useStreaming({
    chatId: conversationId || '',
    onComplete: (messageId, content) => {
      console.log('Streaming completed:', { messageId, content: content.substring(0, 50) + '...' })
      
      // Update URL after streaming completes if this was a new conversation
      if (conversationId === 'new') {
        // Find the real conversation ID from all chats (since it was migrated)
        const allChats = useChatStore.getState().chats
        console.log('Looking for real conversation in chats:', Object.keys(allChats))
        
        // Debug each chat to see why our search isn't working
        Object.values(allChats).forEach(chat => {
          console.log('Chat debug:', {
            id: chat.meta.id,
            workspaceId: chat.meta.workspace_id,
            isOptimistic: chat.meta.isOptimistic,
            createdAt: chat.meta.created_at,
            isRecent: new Date(chat.meta.created_at).getTime() > Date.now() - 60000
          })
        })
        
        // Simplify search - just find the most recent non-'new' conversation
        // Since we just created it, it should be the newest one
        const realConversation = Object.values(allChats)
          .filter(chat => chat.meta.id !== 'new')
          .sort((a, b) => new Date(b.meta.created_at).getTime() - new Date(a.meta.created_at).getTime())
          [0] // Get the most recent one
        
        console.log('Found real conversation:', realConversation?.meta.id, realConversation?.meta)
        
        if (realConversation) {
          console.log('Updating conversation ID after streaming completion:', realConversation.meta.id)
          
          // Debug: Check messages in both conversations before cleanup
          const allChats = useChatStore.getState().chats
          const debugInfo = {
            newChat: {
              exists: !!allChats['new'],
              messageCount: allChats['new']?.messages.length,
              messages: allChats['new']?.messages,
              byId: allChats['new']?.byId ? Object.keys(allChats['new'].byId) : []
            },
            realChat: {
              exists: !!allChats[realConversation.meta.id],
              messageCount: allChats[realConversation.meta.id]?.messages.length,
              messages: allChats[realConversation.meta.id]?.messages,
              byId: allChats[realConversation.meta.id]?.byId ? Object.keys(allChats[realConversation.meta.id].byId) : []
            }
          }
          console.log('Messages before cleanup:', debugInfo)
          
          // Sync the final messages from 'new' to the real conversation
          const syncConversationMessages = useChatStore.getState().syncConversationMessages
          syncConversationMessages('new', realConversation.meta.id)
          
          // Update the parent component's conversation ID
          onConversationIdChange?.(realConversation.meta.id)
          
          // Update URL silently
          window.history.replaceState(null, '', `/${realConversation.meta.id}`)
          
          // Wait a bit before cleaning up to ensure component has switched
          setTimeout(() => {
            const removeChat = useChatStore.getState().removeChat
            removeChat('new')
            console.log('Cleaned up temp chat')
          }, 100)
        } else {
          console.log('No real conversation found for URL update')
        }
      }
    },
    onError: (error) => {
      console.error('Streaming error:', error)
    },
    onConversationCreated: (newConversationId) => {
      console.log('Conversation created, will update URL after streaming completes:', newConversationId)
      // Don't update URL immediately - wait for streaming to complete
    }
  })

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    
    if (!input.trim() || isSubmitting || isStreaming) return
    
    const messageContent = input.trim()
    setInput('')
    setIsSubmitting(true)
    
    try {
      let actualConversationId = conversationId
      
      // If no conversation ID, we need to create a new conversation first
      if (!actualConversationId) {
        const { chatId, userMessageId } = createOptimisticChat({
          workspaceId,
          initialMessage: messageContent,
        })
        
        actualConversationId = chatId
        
        if (!actualConversationId) {
          throw new Error('Failed to create conversation')
        }
        
        // Create the conversation on the server
        const result = await createChat({
          workspaceId,
          initialMessage: messageContent,
        })
        
        if (!result.success) {
          throw new Error(result.error || 'Failed to create conversation')
        }
        
        // Migrate the optimistic conversation to the real ID
        const migrateConversation = useChatStore.getState().migrateConversation
        migrateConversation(actualConversationId, result.data!.conversationId, {
          id: result.data!.conversationId,
          isOptimistic: false,
        })
        
        // Use the real conversation ID for streaming
        actualConversationId = result.data!.conversationId
        
        // Update URL to the real conversation ID
        router.replace(`/${actualConversationId}`)
      }
      
      // For both new and existing conversations, use the new streaming API
      // This will create messages and start streaming in one call
      connect(actualConversationId, messageContent, selectedModel, workspaceId)
      
      onMessageSent?.(actualConversationId)
    } catch (error) {
      console.error('Error sending message:', error)
      // TODO: Show error toast
    } finally {
      setIsSubmitting(false)
    }
  }, [
    input, 
    conversationId, 
    workspaceId, 
    isSubmitting, 
    isStreaming, 
    createOptimisticChat,
    updateMessage,
    updateChatMeta,
    getChat,
    uiState.selectedConversation, 
    connect,
    selectedModel,
    onMessageSent
  ])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleStop = useCallback(() => {
    disconnect()
  }, [disconnect])

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    }
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    adjustTextareaHeight()
  }, [adjustTextareaHeight])

  const canSubmit = input.trim() && !isSubmitting && !isStreaming

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex items-end gap-2 p-4 border-t bg-background">
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className="min-h-[40px] max-h-[120px] resize-none pr-12"
            disabled={isSubmitting}
          />
        </div>
        
        <div className="flex gap-1">
          {isStreaming && (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={handleStop}
              className="h-10 w-10"
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          
          <Button
            type="submit"
            size="icon"
            disabled={!canSubmit}
            className="h-10 w-10"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  )
}