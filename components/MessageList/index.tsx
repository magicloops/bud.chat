'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MessageItem } from '@/components/MessageList/MessageItem'
import { 
  Message, 
  useConversation, 
  useIsStreaming,
  useSimpleChatStore,
  Conversation,
  ConversationMeta
} from '@/state/simpleChatStore'
import { cn } from '@/lib/utils'

interface MessageListProps {
  // For local state (new conversations)
  messages?: Message[]
  conversation?: Conversation | null // For providing optimistic conversation context
  
  // For server state (existing conversations)
  conversationId?: string
  
  className?: string
  autoScroll?: boolean
}

export function MessageList({ 
  messages,
  conversation: providedConversation,
  conversationId,
  className,
  autoScroll = true 
}: MessageListProps) {
  // Get messages from store if conversationId provided, otherwise use direct messages
  const storeConversation = useConversation(conversationId || '')
  const conversation = providedConversation || storeConversation
  const displayMessages = messages || conversation?.messages || []
  const isStreaming = useIsStreaming(conversationId || '')
  
  // Store action refs - stable references to prevent re-renders
  const setConversationRef = useRef(useSimpleChatStore.getState().setConversation)
  const addConversationToWorkspaceRef = useRef(useSimpleChatStore.getState().addConversationToWorkspace)
  const removeConversationFromWorkspaceRef = useRef(useSimpleChatStore.getState().removeConversationFromWorkspace)
  
  // Update refs when store changes (but this shouldn't cause re-renders)
  useEffect(() => {
    setConversationRef.current = useSimpleChatStore.getState().setConversation
    addConversationToWorkspaceRef.current = useSimpleChatStore.getState().addConversationToWorkspace
    removeConversationFromWorkspaceRef.current = useSimpleChatStore.getState().removeConversationFromWorkspace
  })
  
  // Get specific conversation only when needed to avoid re-renders
  const getCurrentConversation = useCallback(() => {
    if (!conversationId) return null
    return useSimpleChatStore.getState().conversations[conversationId] || null
  }, [conversationId])
  
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const lastMessageCountRef = useRef(0)

  // Auto-scroll to bottom when new messages arrive or content updates
  const scrollToBottom = useCallback((force = false) => {
    if (!autoScroll || (!force && isUserScrollingRef.current)) return
    
    const scrollElement = scrollRef.current
    if (scrollElement) {
      // Use requestAnimationFrame to ensure scroll happens after DOM updates
      requestAnimationFrame(() => {
        if (scrollElement) {
          scrollElement.scrollTop = scrollElement.scrollHeight
        }
      })
    }
  }, [autoScroll])

  // Track user scrolling to prevent auto-scroll when user is reading history
  const handleScroll = useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const { scrollTop, scrollHeight, clientHeight } = scrollElement
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100 // Increased threshold for better UX
    
    isUserScrollingRef.current = !isAtBottom
  }, [])

  // Auto-scroll when new messages arrive
  useEffect(() => {
    const messageCount = displayMessages.length
    if (messageCount > lastMessageCountRef.current) {
      scrollToBottom()
    }
    lastMessageCountRef.current = messageCount
  }, [displayMessages.length, scrollToBottom])

  // Auto-scroll on content changes during streaming (immediate, not throttled)
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom()
    }
  }, [displayMessages, isStreaming, scrollToBottom])

  // Force scroll to bottom on initial load
  useEffect(() => {
    if (displayMessages.length > 0) {
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

  const handleMessageBranch = useCallback(async (messageId: string) => {
    if (!conversationId) return
    
    // 1. Get current conversation from store
    const currentConversation = getCurrentConversation()
    if (!currentConversation) return
    
    // 2. Find branch point and create truncated message list
    const branchIndex = currentConversation.messages.findIndex(m => m.id === messageId)
    if (branchIndex === -1) return
    
    const branchedMessages = currentConversation.messages.slice(0, branchIndex + 1)
    
    // 3. Find the corresponding message in the database by position (more reliable than ID)
    // We'll use the order_key of the message at the branch position
    const branchMessage = currentConversation.messages[branchIndex]
    const branchPosition = branchIndex // 0-based position in conversation
    
    // 4. Create optimistic new conversation
    const tempConversationId = `temp-branch-${Date.now()}`
    const branchedConversation: Conversation = {
      id: tempConversationId,
      messages: branchedMessages,
      isStreaming: false,
      meta: {
        id: tempConversationId,
        title: `🌱 ${currentConversation.meta.title || 'Branched Chat'}`,
        workspace_id: currentConversation.meta.workspace_id,
        source_bud_id: currentConversation.meta.source_bud_id,
        created_at: new Date().toISOString()
      }
    }
    
    // 5. Add to store optimistically
    setConversationRef.current(tempConversationId, branchedConversation)
    addConversationToWorkspaceRef.current(currentConversation.meta.workspace_id, tempConversationId)
    
    // 6. Navigate immediately for responsive UX
    router.push(`/chat/${tempConversationId}`)
    
    try {
      // 7. API call to create real conversation using position instead of ID
      const response = await fetch(`/api/conversations/${conversationId}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchPosition: branchPosition,
          branchMessage: {
            role: branchMessage.role,
            content: branchMessage.content.substring(0, 100), // First 100 chars for identification
            order_key: branchMessage.order_key
          },
          title: branchedConversation.meta.title
        })
      })
      
      if (!response.ok) throw new Error('Branching failed')
      
      const result = await response.json()
      const { branchedConversation: realConvData, insertedMessages } = result
      
      // 8. Replace optimistic conversation with real one
      const realConversation: Conversation = {
        id: realConvData.id,
        messages: insertedMessages.map((msg: any) => ({
          id: msg.id,
          conversation_id: msg.conversation_id,
          role: msg.role,
          content: msg.content,
          created_at: msg.created_at,
          updated_at: msg.updated_at,
          order_key: msg.order_key,
          json_meta: msg.json_meta || {}
        })),
        isStreaming: false,
        meta: {
          id: realConvData.id,
          title: realConvData.title,
          workspace_id: realConvData.workspace_id,
          source_bud_id: realConvData.source_bud_id,
          created_at: realConvData.created_at
        }
      }
      
      // 9. Update store with real conversation
      setConversationRef.current(realConvData.id, realConversation)
      removeConversationFromWorkspaceRef.current(currentConversation.meta.workspace_id, tempConversationId)
      addConversationToWorkspaceRef.current(realConvData.workspace_id, realConvData.id)
      
      // 10. Update URL to real conversation ID
      router.replace(`/chat/${realConvData.id}`)
      
    } catch (error) {
      console.error('Branch creation failed:', error)
      
      // 11. Rollback optimistic updates on error
      removeConversationFromWorkspaceRef.current(currentConversation.meta.workspace_id, tempConversationId)
      // Navigate back to original conversation
      router.replace(`/chat/${conversationId}`)
      
      // TODO: Show error toast notification
    }
  }, [conversationId, getCurrentConversation, router])

  if (displayMessages.length === 0) {
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
        "h-full overflow-y-auto overflow-x-hidden",
        className
      )}
      onScroll={handleScroll}
    >
      <div className="space-y-4 p-4 pb-6">
        {displayMessages.map((message, index) => (
          <MessageItem
            key={message.id} // Use stable message ID as key
            message={message}
            conversation={conversation}
            index={index}
            isLast={index === displayMessages.length - 1}
            onEdit={handleMessageEdit}
            onDelete={handleMessageDelete}
            onBranch={handleMessageBranch}
          />
        ))}
      </div>
    </div>
  )
}