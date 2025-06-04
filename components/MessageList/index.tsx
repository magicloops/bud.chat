'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useMessages } from '@/state/chatStore'
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
    // TODO: Implement message branching
    console.log('Branch from message:', messageId)
  }, [])

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
            key={message.id}
            message={message}
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