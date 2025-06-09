'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useMessages, useChatStore } from '@/state/chatStore'
import { useAddConversation, useWorkspaceStore } from '@/state/workspaceStore'
import { MessageItem } from './MessageItem'
import { ConversationId } from '@/lib/types'
import { cn } from '@/lib/utils'

interface MessageListProps {
  conversationId: ConversationId
  className?: string
  autoScroll?: boolean
}

export function MessageList({ 
  conversationId, 
  className,
  autoScroll = true 
}: MessageListProps) {
  const messages = useMessages(conversationId)
  const router = useRouter()
  const addConversation = useAddConversation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const lastMessageCountRef = useRef(0)

  // Auto-scroll to bottom when new messages arrive or content updates
  const scrollToBottom = useCallback((force = false) => {
    if (!autoScroll || (!force && isUserScrollingRef.current)) return
    
    const scrollElement = scrollRef.current
    if (scrollElement) {
      requestAnimationFrame(() => {
        scrollElement.scrollTop = scrollElement.scrollHeight
      })
    }
  }, [autoScroll])

  // Track user scrolling to prevent auto-scroll when user is reading history
  const handleScroll = useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const { scrollTop, scrollHeight, clientHeight } = scrollElement
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50 // 50px threshold
    
    isUserScrollingRef.current = !isAtBottom
  }, [])

  // Auto-scroll when new messages arrive
  useEffect(() => {
    const messageCount = messages.length
    if (messageCount > lastMessageCountRef.current) {
      scrollToBottom()
    }
    lastMessageCountRef.current = messageCount
  }, [messages.length, scrollToBottom])

  // Auto-scroll when message content changes (for streaming updates)
  useEffect(() => {
    const hasStreamingMessage = messages.some(m => 
      'isPending' in m && m.isPending
    )
    if (hasStreamingMessage) {
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  // Force scroll to bottom on initial load
  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom(true)
    }
  }, [conversationId, scrollToBottom]) // Reset when conversation changes

  const handleMessageEdit = useCallback((messageId: string, newContent: string) => {
    // TODO: Implement message editing
    console.log('Edit message:', messageId, newContent)
  }, [])

  const handleMessageDelete = useCallback((messageId: string) => {
    // TODO: Implement message deletion
    console.log('Delete message:', messageId)
  }, [])

  const handleMessageBranch = useCallback((messageId: string) => {
    const branchOptimisticChat = useChatStore.getState().branchOptimisticChat
    const selectedWorkspace = useChatStore.getState().ui.selectedWorkspace
    
    if (!selectedWorkspace) {
      console.error('No workspace selected for branching')
      return
    }
    
    try {
      // Create optimistic branch with temp ID
      const { newChatId } = branchOptimisticChat({
        originalConversationId: conversationId,
        fromMessageId: messageId,
        workspaceId: selectedWorkspace
      })
      
      // Navigate to the new conversation using Next.js router
      router.push(`/${newChatId}`)
      
      // Get the original conversation title for the branch
      const originalChat = useChatStore.getState().chats[conversationId]
      
      // Try to get title from chat store first, then workspace store as fallback
      let originalTitle = originalChat?.meta?.title
      
      if (!originalTitle && selectedWorkspace) {
        const workspaceConversations = useWorkspaceStore.getState().conversations[selectedWorkspace]
        const workspaceConv = workspaceConversations?.find(c => c.id === conversationId)
        originalTitle = workspaceConv?.title
      }
      
      originalTitle = originalTitle || 'Conversation'
      const branchTitle = `🌱 ${originalTitle}`
      
      console.log('Branch title:', branchTitle)
      
      // Trigger actual branching API call in background
      console.log('Making fork request to:', `/api/conversations/${conversationId}/fork`)
      fetch(`/api/conversations/${conversationId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          forkFromMessageId: messageId,
          title: branchTitle
        })
      })
      .then(response => {
        console.log('Fork response status:', response.status)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        return response.json()
      })
      .then(data => {
        if (data.forkedConversation && data.insertedMessages) {
          // Update the temp conversation with real data from server
          const setChat = useChatStore.getState().setChat
          
          const chatState = {
            meta: {
              id: data.forkedConversation.id,
              workspace_id: data.forkedConversation.workspace_id,
              created_at: data.forkedConversation.created_at,
              title: data.forkedConversation.title,
              isOptimistic: false,
            },
            messages: data.insertedMessages.map((m: any) => m.id),
            byId: Object.fromEntries(
              data.insertedMessages.map((m: any) => [m.id, m])
            ),
            streaming: false,
          }
          
          // Replace temp chat with real one
          setChat(data.forkedConversation.id, chatState)
          
          // Add the new conversation to the workspace store so it appears in the sidebar
          addConversation({
            id: data.forkedConversation.id,
            workspace_id: data.forkedConversation.workspace_id,
            created_at: data.forkedConversation.created_at,
            title: data.forkedConversation.title,
            metadata: data.forkedConversation.metadata || {}
          })
          
          // Remove temp chat
          const removeChat = useChatStore.getState().removeChat
          removeChat(newChatId)
          
          // Update URL to real conversation ID
          router.replace(`/${data.forkedConversation.id}`)
        }
      })
      .catch(error => {
        console.error('Branch failed:', error)
        // Could add error handling here - maybe show a toast
      })
      
    } catch (error) {
      console.error('Optimistic branching failed:', error)
    }
  }, [conversationId])

  if (messages.length === 0) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">Start a conversation</p>
          <p className="text-sm">Send a message to begin chatting</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={scrollRef}
      className={cn(
        "h-full overflow-y-auto overflow-x-hidden scroll-smooth",
        className
      )}
      onScroll={handleScroll}
    >
      <div className="space-y-4 p-4 pb-6">
        {messages.map((message, index) => (
          <MessageItem
            key={`${message.conversation_id}-${index}`}
            message={message}
            index={index}
            isLast={index === messages.length - 1}
            onEdit={handleMessageEdit}
            onDelete={handleMessageDelete}
            onBranch={handleMessageBranch}
          />
        ))}
        
        {/* Show loading indicator if no messages but conversation exists */}
        {messages.length === 0 && (
          <div className="flex justify-center py-8">
            <div className="text-muted-foreground">Loading messages...</div>
          </div>
        )}
      </div>
    </div>
  )
}
