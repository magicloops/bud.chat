"use client"

import { useState, useEffect, useRef, memo, useCallback, useMemo } from "react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MoreHorizontal, Sparkles, Leaf, PanelLeftClose, PanelRightClose, Copy, GitBranch, Edit, User, Bot, Loader2 } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRealtimeMessages } from "@/hooks/use-realtime"
import { useChatStream } from "@/hooks/use-chat-stream"
import { useStreamingState } from "@/hooks/use-streaming-state"
import { Database } from "@/lib/types/database"
import { useToast } from "@/hooks/use-toast"
import { useModel } from "@/contexts/model-context"
import { useAuth } from "@/lib/auth/auth-provider"
import { createClient } from "@/lib/supabase/client"
import MarkdownRenderer from "./markdown-renderer"

// Memoized component for rendering messages to prevent re-renders on input changes
// Memoized individual message component to prevent unnecessary re-renders
const MessageItem = memo(function MessageItem({
  message,
  index,
  assistantName,
  user,
  formatMessageDuration,
  copyMessageToClipboard,
  handleBranchConversation
}: {
  message: any
  index: number
  assistantName: string
  user: any
  formatMessageDuration: (message: any, index: number) => string
  copyMessageToClipboard: (content: string) => void
  handleBranchConversation: (messageId: string) => void
}) {
  return (
    <div className={`mb-6 group ${index === 0 ? "pt-4" : ""}`}>
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8">
          {message.role === 'user' ? (
            <>
              {user?.user_metadata?.avatar_url ? (
                <AvatarImage src={user.user_metadata.avatar_url} alt="User" />
              ) : null}
              <AvatarFallback>
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </>
          ) : (
            <AvatarFallback>
              <Bot className="h-5 w-5 text-green-500" />
            </AvatarFallback>
          )}
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">
              {message.role === 'user' ? 'You' : assistantName}
            </span>
            {message.role === 'assistant' && message.metadata?.model && message.metadata.model !== 'greeting' && (
              <span className="text-xs text-muted-foreground/60">{message.metadata.model}</span>
            )}
            <span className="text-xs text-muted-foreground">
              · {formatMessageDuration(message, index)}
            </span>
          </div>
          <MarkdownRenderer content={message.content} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => copyMessageToClipboard(message.content)}>
              <Copy className="mr-2 h-4 w-4" />
              <span>Copy</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleBranchConversation(message.id)}>
              <GitBranch className="mr-2 h-4 w-4" />
              <span>Branch</span>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" />
              <span>Edit</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
})

// Separate memoized component for streaming message
const StreamingMessage = memo(function StreamingMessage({
  streamingMessage,
  assistantName,
  isStreaming
}: {
  streamingMessage: any | null
  assistantName: string
  isStreaming: boolean
}) {
  if (!streamingMessage) return null
  
  return (
    <div className="mb-6 group">
      <div className="flex items-start gap-3">
        <Avatar className="h-8 w-8">
          <AvatarFallback>
            <Bot className="h-5 w-5 text-green-500" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">{assistantName}</span>
            {streamingMessage.metadata?.model && streamingMessage.metadata.model !== 'greeting' && (
              <span className="text-xs text-muted-foreground/60">{streamingMessage.metadata.model}</span>
            )}
            <span className="text-xs text-muted-foreground">
              · {isStreaming ? 'typing...' : 'just now'}
            </span>
          </div>
          <div className="relative">
            {isStreaming && !streamingMessage.content && (
              <span className="animate-bounce animate-pulse text-muted-foreground/60 text-sm ml-1">|</span>
            )}
            <MarkdownRenderer content={streamingMessage.content} />
          </div>
        </div>
        {/* Placeholder for dropdown menu to prevent layout shift */}
        <div className="h-6 w-6 opacity-0">
          {/* Hidden placeholder that matches dropdown button dimensions */}
        </div>
      </div>
    </div>
  )
})

const MessagesList = memo(function MessagesList({ 
  messages, 
  assistantName, 
  user, 
  formatMessageDuration, 
  copyMessageToClipboard, 
  handleBranchConversation
}: {
  messages: any[]
  assistantName: string
  user: any
  formatMessageDuration: (message: any, index: number) => string
  copyMessageToClipboard: (content: string) => void
  handleBranchConversation: (messageId: string) => void
}) {
  console.log('🎨 RENDERING MessagesList:', messages.length, 'messages (streaming handled separately)')
  
  return (
    <>
      {messages.map((message, index) => (
        <MessageItem
          key={message.clientId || message.id}
          message={message}
          index={index}
          assistantName={assistantName}
          user={user}
          formatMessageDuration={formatMessageDuration}
          copyMessageToClipboard={copyMessageToClipboard}
          handleBranchConversation={handleBranchConversation}
        />
      ))}
    </>
  )
})

type Message = Database['public']['Tables']['message']['Row']

interface ChatAreaProps {
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  currentConversationId?: string | null
  currentWorkspaceId?: string | null
  conversationTitle?: string
  conversationMetadata?: any
  chatState: {
    messages: any[]
    addMessage: (message: any) => void
    updateMessage: (messageId: string, updates: any) => void
    addStreamingResult: (finalMessage: any) => void
    setMessages: (messages: any[] | ((prev: any[]) => any[])) => void
  }
  onConversationChange?: (conversationId: string, workspaceId: string, title?: string, optimisticMessages?: any[], metadata?: any) => void
  onConversationUpdate?: (conversation: any) => void
  onStreamingComplete?: () => void
  isLoadingConversation?: boolean
}

export default function ChatArea({
  toggleLeftSidebar,
  toggleRightSidebar,
  leftSidebarOpen,
  rightSidebarOpen,
  currentConversationId,
  currentWorkspaceId,
  conversationTitle = "New Chat",
  conversationMetadata,
  chatState,
  onConversationChange,
  onConversationUpdate,
  onStreamingComplete,
  isLoadingConversation = false,
}: ChatAreaProps) {
  const [input, setInput] = useState("")
  
  // Use chatState for messages and local streaming state
  const { 
    messages,
    addMessage,
    updateMessage,
    addStreamingResult,
    setMessages
  } = chatState
  
  // Local streaming state
  const {
    streamingMessage,
    isStreaming,
    startStreaming,
    updateStreamingMessage,
    completeStreaming,
    cancelStreaming
  } = useStreamingState()
  const [assistantName, setAssistantName] = useState<string>(
    conversationMetadata?.assistantName || 'Assistant'
  )
  const [isForkInProgress, setIsForkInProgress] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()
  const { selectedModel } = useModel()
  const { user } = useAuth()
  
  // Update assistant name when conversation metadata changes
  useEffect(() => {
    setAssistantName(conversationMetadata?.assistantName || 'Assistant')
  }, [conversationMetadata])
  
  // Message management is now handled by useChatState hook
  
  // Auto-focus input when conversation changes (for new conversations)
  useEffect(() => {
    if (currentConversationId || currentWorkspaceId) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          console.log('🎯 Attempting to focus input after conversation change:', inputRef.current)
          if (inputRef.current) {
            inputRef.current.focus()
            console.log('✅ Input focused after conversation change')
          }
        }, 100)
      })
    }
  }, [currentConversationId, currentWorkspaceId])




  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight
      }
    }
  }, [messages, streamingMessage])

  const handleSendMessage = async () => {
    if (!input.trim() || !currentWorkspaceId || isStreaming) return

    const messageText = input.trim()
    setInput("")

    // Add user message immediately using hook
    const clientId = `client-${Date.now()}-${Math.random()}`
    const userMessage = {
      id: `user-${Date.now()}`, // Temporary optimistic ID
      clientId: clientId,
      conversationId: currentConversationId || 'new',
      role: 'user',
      content: messageText,
      created_at: new Date().toISOString(),
      isOptimistic: true
    }

    console.log('➕ Adding user message via hook. Current length:', messages.length)
    addMessage(userMessage)

    // Create streaming assistant message
    const assistantClientId = `client-${Date.now()}-${Math.random()}`
    const assistantMessage = {
      id: `assistant-${Date.now()}`, // Temporary optimistic ID
      clientId: assistantClientId,
      conversationId: currentConversationId || 'new',
      role: 'assistant',
      content: '',
      metadata: { model: selectedModel },
      created_at: new Date().toISOString(),
      isOptimistic: true
    }

    startStreaming(assistantMessage)

    try {
      // If no conversation exists, create one first
      let conversationId = currentConversationId
      if (!conversationId) {
        console.log('🏗️ Creating new conversation with workspace ID:', currentWorkspaceId)
        // Prepare initial messages (only greeting and system messages, NOT user message)
        const initialMessages = []
        
        // Add greeting message if it exists
        const greetingMessage = messages.find(m => m.metadata?.isGreeting)
        if (greetingMessage) {
          initialMessages.push({
            role: greetingMessage.role,
            content: greetingMessage.content,
            metadata: greetingMessage.metadata
          })
        }

        const createResponse = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            title: 'New Chat',
            initialMessages: initialMessages.length > 0 ? initialMessages : undefined
          })
        })
        
        if (!createResponse.ok) {
          throw new Error('Failed to create conversation')
        }
        
        const newConversation = await createResponse.json()
        conversationId = newConversation.id
        
        // Notify parent about the new conversation and pass current messages including the user message
        if (onConversationChange) {
          // Get current messages including the user message we just added
          // Note: messages might not include userMessage yet due to async state update
          const currentMessages = messages.find(m => m.id === userMessage.id) ? messages : [...messages, userMessage]
          console.log('🔄 NOTIFYING PARENT with messages:', currentMessages.length)
          console.log('🔄 User message in current messages:', currentMessages.filter(m => m.role === 'user').map(m => ({
            id: m.id,
            content: m.content.substring(0, 20),
            isOptimistic: m.isOptimistic
          })))
          onConversationChange(conversationId, currentWorkspaceId, 'New Chat', currentMessages)
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId,
          message: messageText,
          workspaceId: currentWorkspaceId,
          model: selectedModel,
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              if (data.type === 'userMessage' && data.messageId) {
                // Update the user message with the real database ID using clientId matching
                console.log('🔄 Updating user message ID from optimistic to real:', data.messageId)
                // Find and update the optimistic user message
                console.log('🔍 Looking for user message to update:', {
                  content: data.content,
                  totalMessages: messages.length,
                  userMessages: messages.filter(m => m.role === 'user').length,
                  optimisticMessages: messages.filter(m => m.isOptimistic).length
                })
                const targetMessage = messages.find(msg => 
                  msg.role === 'user' && msg.content === data.content && msg.isOptimistic
                )
                if (targetMessage) {
                  console.log('✅ Found target message:', targetMessage.id, targetMessage.isOptimistic)
                  updateMessage(targetMessage.id, {
                    id: data.messageId,
                    isOptimistic: false,
                    conversationId: currentConversationId || targetMessage.conversationId
                  })
                  console.log('📝 Updated user message ID via hook')
                } else {
                  console.log('❌ Target message not found. User messages:', 
                    messages.filter(m => m.role === 'user').map(m => ({
                      id: m.id,
                      content: m.content.substring(0, 20),
                      isOptimistic: m.isOptimistic
                    }))
                  )
                }
              } else if (data.type === 'token' && data.content) {
                fullContent += data.content
                updateStreamingMessage(fullContent)
              } else if (data.type === 'complete') {
                // Stream is complete, add final message to messages array
                const finalAssistantMessage = {
                  ...assistantMessage,
                  content: fullContent,
                  id: data.messageId || assistantMessage.id,
                  isOptimistic: false,
                  conversationId: currentConversationId || assistantMessage.conversationId
                }
                
                // Complete streaming and add final message to main chat state
                completeStreaming()
                addStreamingResult(finalAssistantMessage)
                
                // Refocus input after successful streaming
                requestAnimationFrame(() => {
                  setTimeout(() => {
                    console.log('🎯 Attempting to focus input after streaming success:', inputRef.current)
                    if (inputRef.current) {
                      inputRef.current.focus()
                      console.log('✅ Input focused after streaming success')
                    }
                  }, 100)
                })
                
                // Notify parent that streaming has completed successfully
                if (onStreamingComplete) {
                  onStreamingComplete()
                }
                
                // Real-time subscriptions will handle conversation updates automatically
                // No need for manual refresh calls
              } else if (data.type === 'error') {
                throw new Error(data.error || 'Unknown error')
              }
            } catch (err) {
              console.error('Error parsing SSE data:', err)
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      })
      cancelStreaming()
    } finally {
      // Streaming state is managed by hook
      
      // Refocus input after streaming completes
      requestAnimationFrame(() => {
        setTimeout(() => {
          console.log('🎯 Attempting to focus input after streaming cleanup:', inputRef.current)
          if (inputRef.current) {
            inputRef.current.focus()
            console.log('✅ Input focused after streaming cleanup')
          }
        }, 100)
      })
      
      // Notify parent that streaming has completed
      if (onStreamingComplete) {
        onStreamingComplete()
      }
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const copyMessageToClipboard = useCallback((content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      toast({
        title: "Copied",
        description: "Message copied to clipboard",
      })
    }).catch(() => {
      toast({
        title: "Error",
        description: "Failed to copy message",
        variant: "destructive",
      })
    })
  }, [toast])

  const handleBranchConversation = useCallback(async (fromMessageId: string) => {
    console.log('🌱 Attempting to branch from conversation:', currentConversationId)
    if (!currentConversationId) {
      console.error('No current conversation ID for branching')
      return
    }
    
    // Check if trying to branch from a temp conversation
    if (currentConversationId.startsWith('temp-')) {
      toast({
        title: "Cannot branch",
        description: "Please wait for the conversation to be saved before branching.",
        variant: "destructive",
      })
      return
    }

    // Validate messages array is stable (not empty and has expected structure)
    if (!messages || messages.length === 0) {
      toast({
        title: "Cannot branch",
        description: "No messages available to branch from. Please refresh and try again.",
        variant: "destructive",
      })
      return
    }

    // Check if streaming is in progress
    if (isStreaming) {
      toast({
        title: "Cannot branch",
        description: "Please wait for the current message to finish before branching.",
        variant: "destructive",
      })
      return
    }

    // Prevent rapid successive fork operations
    if (isForkInProgress) {
      toast({
        title: "Branch in progress",
        description: "Please wait for the current branch operation to complete.",
        variant: "destructive",
      })
      return
    }

    setIsForkInProgress(true)
    
    try {
      const forkMessage = messages.find(m => m.id === fromMessageId)
      if (!forkMessage) {
        console.error('Fork message not found locally:', fromMessageId)
        return
      }

      // Prevent forking from optimistic/temporary messages (greeting messages are allowed)
      if (forkMessage.isOptimistic || forkMessage.id.startsWith('temp-')) {
        toast({
          title: "Cannot branch",
          description: "Cannot branch from a temporary message. Please wait for the conversation to be fully saved.",
          variant: "destructive",
        })
        return
      }

      console.log('🔍 Local message IDs:', messages.map(m => ({ id: m.id, role: m.role, content: m.content.substring(0, 50) })))
      console.log('🔍 Trying to fork from message ID:', fromMessageId)

      // Build message chain using parent relationships (matching server logic)
      const buildMessageChain = (messages: any[], targetMessageId: string): any[] => {
        const messageMap = new Map(messages.map(msg => [msg.id, msg]))
        const chain: any[] = []
        
        // Start from target message and walk backwards through parent chain
        let currentMessage = messageMap.get(targetMessageId)
        const visited = new Set<string>()
        
        while (currentMessage && !visited.has(currentMessage.id)) {
          visited.add(currentMessage.id)
          chain.unshift(currentMessage) // Add to beginning to build forward chain
          
          // Move to parent message
          if (currentMessage.parent_id) {
            currentMessage = messageMap.get(currentMessage.parent_id)
          } else {
            // Reached root message (parent_id is null)
            break
          }
        }
        
        return chain
      }

      const messagesToCopy = buildMessageChain(messages, fromMessageId)
      console.log('🔍 Message chain to copy:', messagesToCopy.length, 'messages:', messagesToCopy.map(m => ({ id: m.id, role: m.role, parent_id: m.parent_id })))
      
      if (messagesToCopy.length === 0) {
        console.error('No messages to copy for fork')
        return
      }

      // Validate message array integrity
      const hasInvalidMessages = messagesToCopy.some(msg => 
        !msg.id || !msg.role || !msg.content || !msg.created_at
      )
      
      if (hasInvalidMessages) {
        console.error('Invalid messages detected in fork operation:', messagesToCopy)
        toast({
          title: "Cannot branch",
          description: "Some messages are incomplete. Please refresh and try again.",
          variant: "destructive",
        })
        return
      }

      // Validate that all messages to copy are real (non-optimistic) messages
      // Note: Greeting messages are excluded as they're static and safe to fork
      const problematicMessages = messagesToCopy.filter(msg => 
        msg.isOptimistic || msg.id.startsWith('temp-')
      )
      
      if (problematicMessages.length > 0) {
        console.error('🚫 Cannot fork - optimistic messages found:', problematicMessages.map(m => ({ 
          id: m.id, 
          role: m.role, 
          isOptimistic: m.isOptimistic,
          content: m.content.substring(0, 50) + '...'
        })))
        
        toast({
          title: "Cannot branch",
          description: `${problematicMessages.length} message(s) still being saved. Please wait before branching.`,
          variant: "destructive",
        })
        return
      }
      
      // Optimistic: Switch immediately with copied messages and temp IDs
      const tempConversationId = `temp-fork-${Date.now()}`
      const optimisticTitle = `🌱 ${conversationTitle}`
      
      console.log('🌱 Branching with title:', conversationTitle, 'from conversation:', currentConversationId)
      
      // Create optimistic messages with new conversation ID but preserve all original data
      const optimisticMessages = messagesToCopy.map((msg, index) => ({
        ...msg, // Preserve all original message data (including assistant name, metadata, etc.)
        id: `temp-${tempConversationId}-${index}`, // Temporary ID for new conversation
        clientId: msg.clientId || `fork-client-${Date.now()}-${index}`, // Preserve or create clientId
        conversationId: tempConversationId,
        isOptimistic: true
      }))
      
      // Immediately update local messages to show only the forked portion
      console.log('🔀 Immediately updating local messages to forked subset:', optimisticMessages.length, 'messages')
      setMessages(optimisticMessages)
      
      // Immediately switch to optimistic conversation
      if (onConversationChange && currentWorkspaceId) {
        onConversationChange(tempConversationId, currentWorkspaceId, optimisticTitle, optimisticMessages, conversationMetadata)
      }


      toast({
        title: "Conversation branched",
        description: `Creating new conversation with ${messagesToCopy.length} messages...`,
      })

      // First verify the conversation exists before trying to fork
      console.log('🔍 Verifying conversation exists:', currentConversationId)
      const verifyResponse = await fetch(`/api/conversations/${currentConversationId}`)
      console.log('🔍 Verify response status:', verifyResponse.status)
      
      if (!verifyResponse.ok) {
        console.error('❌ Conversation does not exist in database:', currentConversationId)
        throw new Error(`Cannot fork: conversation ${currentConversationId} not found in database`)
      }
      
      // Make API call in background to create real conversation
      console.log('🌱 Making fork API call to:', `/api/conversations/${currentConversationId}/fork`)
      const response = await fetch(`/api/conversations/${currentConversationId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forkFromMessageId: fromMessageId,
          title: optimisticTitle
        })
      })
      
      console.log('🌱 Fork API response status:', response.status)
      if (!response.ok) {
        const errorText = await response.text()
        console.error('🌱 Fork API error:', response.status, errorText)
        throw new Error(`Fork API failed: ${response.status} - ${errorText}`)
      }

      const result = await response.json()
        
        
        // Update with real conversation ID and data, using the new message IDs from server
        if (onConversationChange && currentWorkspaceId) {
          let forkedMessages
          
          if (result.insertedMessages && result.insertedMessages.length > 0) {
            // Use the inserted messages from the server response with their new IDs
            forkedMessages = result.insertedMessages.map((insertedMsg, index) => {
              // Find the corresponding original message to preserve client-side data
              const originalMsg = messagesToCopy[index]
              return {
                ...originalMsg, // Preserve original message data (content, metadata, etc.)
                ...insertedMsg, // Override with server data (new ID, convo_id, etc.)
                clientId: originalMsg?.clientId || `fork-client-${Date.now()}-${index}`,
                conversationId: result.forkedConversation.id,
                isOptimistic: false
              }
            })
            
            console.log('🔄 Using server-returned messages with new IDs:', forkedMessages.map(m => ({ id: m.id, role: m.role })))
          } else {
            // Fallback: use original messages (for backward compatibility)
            forkedMessages = messagesToCopy.map((msg, index) => ({
              ...msg,
              clientId: msg.clientId || `fork-client-${Date.now()}-${index}`,
              conversationId: result.forkedConversation.id,
              isOptimistic: false
            }))
            
            console.warn('⚠️ No insertedMessages from server, using fallback approach')
          }
          
          onConversationChange(result.forkedConversation.id, currentWorkspaceId, result.forkedConversation.title, forkedMessages, conversationMetadata)
        }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to branch conversation",
        variant: "destructive",
      })
    } finally {
      setIsForkInProgress(false)
    }
  }, [currentConversationId, currentWorkspaceId, conversationTitle, messages, onConversationChange, toast, isStreaming, isForkInProgress])

  const formatMessageDuration = useCallback((currentMessage: any, index: number) => {
    // For user messages, always show time since sent
    if (currentMessage.role === 'user') {
      const date = new Date(currentMessage.created_at)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffSecs = Math.floor(diffMs / 1000)
      const diffMins = Math.floor(diffSecs / 60)
      const diffHours = Math.floor(diffMins / 60)
      
      if (diffSecs < 60) return `${diffSecs}s ago`
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      return date.toLocaleDateString()
    }
    
    // For assistant messages, show duration from previous message
    const previousMessage = messages[index - 1]
    if (!previousMessage) {
      // If this is the first message and it's from assistant, show time since created
      const date = new Date(currentMessage.created_at)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffSecs = Math.floor(diffMs / 1000)
      const diffMins = Math.floor(diffSecs / 60)
      const diffHours = Math.floor(diffMins / 60)
      
      if (diffSecs < 60) return `${diffSecs}s ago`
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      return date.toLocaleDateString()
    }
    
    const currentTime = new Date(currentMessage.updated_at || currentMessage.created_at)
    const previousTime = new Date(previousMessage.updated_at || previousMessage.created_at)
    const diffMs = currentTime.getTime() - previousTime.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    
    if (diffSecs < 1) return '0s'
    if (diffSecs < 60) return `+${diffSecs}s`
    return `+${diffMins}m ${diffSecs % 60}s`
  }, [messages])

  // Only show "no conversation" if we don't have a conversation ID AND don't have a workspace ID
  // If we have a workspace ID but no conversation ID, we're starting a new conversation
  if (!currentConversationId && !currentWorkspaceId) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-muted-foreground">No conversation selected</h3>
          <p className="text-sm text-muted-foreground">Select a conversation from the sidebar to start chatting</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Chat Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleLeftSidebar}>
            <span className="sr-only">Toggle left sidebar</span>
            <PanelLeftClose
              className={`h-5 w-5 transition-transform duration-300 ${!leftSidebarOpen ? "rotate-180" : ""}`}
            />
          </Button>
          <span className="font-medium">{conversationTitle}</span>
          <span className="text-muted-foreground">|</span>
          <span className="text-muted-foreground">{selectedModel}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleRightSidebar}>
          <span className="sr-only">Toggle right sidebar</span>
          <PanelRightClose
            className={`h-5 w-5 transition-transform duration-300 ${!rightSidebarOpen ? "rotate-180" : ""}`}
          />
        </Button>
      </div>

      {/* Chat Messages */}
      <ScrollArea className="flex-1 px-4" ref={scrollAreaRef}>
        <MessagesList
          messages={messages}
          assistantName={assistantName}
          user={user}
          formatMessageDuration={formatMessageDuration}
          copyMessageToClipboard={copyMessageToClipboard}
          handleBranchConversation={handleBranchConversation}
        />
        <StreamingMessage
          streamingMessage={streamingMessage}
          assistantName={assistantName}
          isStreaming={isStreaming}
        />
      </ScrollArea>

      {/* Chat Input */}
      <div className="p-4 border-t">
        <div className="relative">
          <div className="flex items-start gap-3">
            <Avatar className="mt-1 h-8 w-8">
              {user?.user_metadata?.avatar_url ? (
                <AvatarImage src={user.user_metadata.avatar_url} alt="User" />
              ) : null}
              <AvatarFallback>
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 border rounded-md p-2 min-h-[80px] focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                ref={inputRef}
                placeholder="Send a message..."
                className="border-0 focus-visible:ring-0 resize-none p-0 shadow-none min-h-[60px]"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={!currentConversationId && !currentWorkspaceId}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-50"
            onClick={handleSendMessage}
            disabled={!input.trim() || isStreaming || (!currentConversationId && !currentWorkspaceId)}
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </>
  )
}
