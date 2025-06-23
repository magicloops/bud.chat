'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MessageItem } from '@/components/MessageList/MessageItem'
import { Message, useConversation, useIsStreaming } from '@/state/simpleChatStore'
import { cn } from '@/lib/utils'

interface MessageListProps {
  // For local state (new conversations)
  messages?: Message[]
  
  // For server state (existing conversations)
  conversationId?: string
  
  className?: string
  autoScroll?: boolean
}

export function MessageList({ 
  messages,
  conversationId,
  className,
  autoScroll = true 
}: MessageListProps) {
  // Get messages from store if conversationId provided, otherwise use direct messages
  const conversation = useConversation(conversationId || '')
  const displayMessages = messages || conversation?.messages || []
  const isStreaming = useIsStreaming(conversationId || '')
  
  
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

  const handleMessageBranch = useCallback((messageId: string) => {
    // TODO: Implement message branching
    console.log('Branch message:', messageId)
  }, [])

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