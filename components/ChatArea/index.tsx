'use client'

import { useEffect, useRef } from 'react'
import { MessageList } from '@/components/MessageList'
import { ChatComposer } from '@/components/ChatComposer'
import { useChat, useChatStore } from '@/state/chatStore'
import { ConversationId, WorkspaceId } from '@/lib/types'
import { cn } from '@/lib/utils'

interface ChatAreaProps {
  conversationId?: ConversationId
  workspaceId: WorkspaceId
  className?: string
}

export function ChatArea({ conversationId, workspaceId, className }: ChatAreaProps) {
  // Registry-aware selectors
  const chatMeta = useChatStore((state) => {
    const actualId = state.registry[conversationId || ''] || conversationId || ''
    return state.chats[actualId]?.meta
  })
  const isStreaming = useChatStore((state) => {
    const actualId = state.registry[conversationId || ''] || conversationId || ''
    return state.chats[actualId]?.streaming || false
  })

  // Handle new conversation case (/new route)
  const isNewConversation = !conversationId
  const displayConversationId = conversationId

  const handleMessageSent = (messageId: string) => {
    // Message sent successfully, no additional action needed
    // The store and streaming will handle the updates
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header - could add conversation title, status, etc. */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-center p-4 relative">
          {/* Centered title */}
          <div>
            <h1 className="text-lg font-semibold">
              {isNewConversation || chatMeta?.isOptimistic ? 'New Conversation' : 'Chat'}
            </h1>
          </div>
          
          {/* Status indicators - positioned absolutely to the right */}
          <div className="absolute right-4 flex items-center gap-2 text-sm text-muted-foreground">
            {isStreaming && (
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
                <span>Generating...</span>
              </div>
            )}
            {chatMeta?.isOptimistic && (
              <div className="flex items-center gap-1">
                <div className="h-2 w-2 bg-yellow-500 rounded-full animate-pulse" />
                <span>Saving...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 h-full overflow-hidden">
        {displayConversationId ? (
          <MessageList 
            conversationId={displayConversationId}
            autoScroll={true}
            className="h-full"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground max-w-md">
              <h2 className="text-xl font-semibold mb-2">Welcome to bud.chat</h2>
              <p className="mb-4">
                Start a conversation by typing a message below. 
                You can branch conversations at any point to explore different directions.
              </p>
              <div className="text-sm text-muted-foreground/80">
                <p>✨ Type your message and press Enter to begin</p>
                <p>🌿 Branch conversations to explore ideas</p>
                <p>💬 Messages are saved automatically</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0">
        <ChatComposer
          conversationId={displayConversationId}
          workspaceId={workspaceId}
          placeholder={isNewConversation ? "Start a new conversation..." : "Type your message..."}
          onMessageSent={handleMessageSent}
        />
      </div>
    </div>
  )
}