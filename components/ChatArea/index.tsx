'use client'

import { MessageList } from '@/components/MessageList'
import { ChatComposer } from '@/components/ChatComposer'
import { Message, useConversation } from '@/state/simpleChatStore'
import { cn } from '@/lib/utils'

interface ChatAreaProps {
  // For local state (new conversations)
  messages?: Message[]
  isStreaming?: boolean
  onSendMessage?: (content: string) => void | Promise<void>
  placeholder?: string
  budData?: any // Bud data for optimistic assistant identity
  
  // For server state (existing conversations) 
  conversationId?: string
  
  className?: string
}

export function ChatArea({ 
  messages, 
  isStreaming = false, 
  onSendMessage,
  placeholder = "Type your message...",
  budData,
  conversationId,
  className 
}: ChatAreaProps) {
  const isNewConversation = !conversationId && messages !== undefined
  const conversation = useConversation(conversationId || '')
  
  // Create optimistic conversation for bud identity in new conversations
  const optimisticConversation = isNewConversation && budData ? {
    id: 'temp',
    messages: messages || [],
    isStreaming: false,
    meta: {
      id: 'temp',
      title: 'New Chat',
      workspace_id: 'temp',
      source_bud_id: budData.id,
      assistant_name: budData.default_json?.name || 'Assistant',
      assistant_avatar: budData.default_json?.avatar || '🤖',
      created_at: new Date().toISOString()
    }
  } : null
  
  const handleMessageSent = (messageId: string) => {
    // For server-state conversations, the store handles updates
    // For local-state conversations, the parent component handles updates
  }

  const title = isNewConversation 
    ? 'New Conversation' 
    : conversation?.meta?.title || 'Chat'
  
  // Get model from latest message (assuming assistant messages contain model info)
  const latestAssistantMessage = conversation?.messages
    ?.filter(m => m.role === 'assistant')
    ?.slice(-1)[0]
  const model = latestAssistantMessage?.json_meta?.model || 'claude-3.5-sonnet'

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 py-3 relative">
          {/* Left spacer for sidebar toggle button */}
          <div className="w-12"></div>
          
          {/* Centered title and model */}
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
            <h1 className="text-sm font-medium truncate max-w-xs">{title}</h1>
            <span className="text-xs text-muted-foreground whitespace-nowrap">• {model}</span>
          </div>
          
          {/* Status indicators and space for settings toggle */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground w-12 justify-end">
            {isStreaming && (
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs">•••</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 h-full overflow-hidden">
        {messages ? (
          // Local state - render messages directly
          <MessageList 
            messages={messages}
            conversation={optimisticConversation}
            autoScroll={true}
            className="h-full"
          />
        ) : conversationId ? (
          // Server state - fetch from store
          <MessageList 
            conversationId={conversationId}
            autoScroll={true}
            className="h-full"
          />
        ) : (
          // Welcome state
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
        {onSendMessage ? (
          // Local state composer
          <LocalChatComposer
            onSendMessage={onSendMessage}
            placeholder={placeholder}
            disabled={isStreaming}
          />
        ) : conversationId ? (
          // Server state composer
          <ChatComposer
            conversationId={conversationId}
            placeholder={placeholder}
            onMessageSent={handleMessageSent}
          />
        ) : null}
      </div>
    </div>
  )
}

// Simple composer for local state
interface LocalChatComposerProps {
  onSendMessage: (content: string) => void | Promise<void>
  placeholder: string
  disabled?: boolean
}

function LocalChatComposer({ onSendMessage, placeholder, disabled }: LocalChatComposerProps) {
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (disabled) return
    
    const formData = new FormData(e.currentTarget)
    const content = formData.get('message') as string
    
    if (!content.trim()) return
    
    try {
      await onSendMessage(content.trim())
      
      // Clear the form only if successful and form still exists
      if (e.currentTarget) {
        e.currentTarget.reset()
      }
    } catch (error) {
      console.error('Error sending message:', error)
      // Don't clear form on error so user can retry
    }
  }

  return (
    <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex gap-2">
          <input
            name="message"
            type="text"
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 px-3 py-2 border border-input bg-background rounded-md text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={disabled}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
