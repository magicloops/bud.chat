"use client"

import { useState, useEffect, useRef } from "react"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MoreHorizontal, Sparkles, Leaf, PanelLeftClose, PanelRightClose, Copy, GitBranch, Edit, User, Bot, Loader2 } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useRealtimeMessages } from "@/hooks/use-realtime"
import { useChatStream } from "@/hooks/use-chat-stream"
import { Database } from "@/lib/types/database"
import { useToast } from "@/hooks/use-toast"
import { useModel } from "@/contexts/model-context"
import { useAuth } from "@/lib/auth/auth-provider"
import { createClient } from "@/lib/supabase/client"
import MarkdownRenderer from "./markdown-renderer"

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
  optimisticMessages?: any[]
  onConversationChange?: (conversationId: string, workspaceId: string, title?: string, optimisticMessages?: any[]) => void
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
  optimisticMessages,
  onConversationChange,
  onConversationUpdate,
  onStreamingComplete,
  isLoadingConversation = false,
}: ChatAreaProps) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<any[]>([])
  const [isStreaming, setIsStreaming] = useState(false)

  const [streamingMessage, setStreamingMessage] = useState<any | null>(null)
  const [assistantName, setAssistantName] = useState<string>(
    conversationMetadata?.assistantName || 'Assistant'
  )
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()
  const { selectedModel } = useModel()
  const { user } = useAuth()
  
  // Update assistant name when conversation metadata changes
  useEffect(() => {
    setAssistantName(conversationMetadata?.assistantName || 'Assistant')
  }, [conversationMetadata])
  
  // Simplified message loading - only use optimistic messages or clear
  useEffect(() => {
    console.log('💬 ChatArea effect:', { 
      currentConversationId, 
      optimisticMessagesLength: optimisticMessages?.length,
      isLoadingConversation
    })
    
    // Use optimistic messages if provided
    if (optimisticMessages && optimisticMessages.length > 0) {
      console.log('✅ Using optimistic messages:', optimisticMessages.length)
      setMessages(optimisticMessages)
      
      // Auto-focus input when conversation loads
      requestAnimationFrame(() => {
        setTimeout(() => {
          console.log('🎯 Attempting to focus input after conversation load:', inputRef.current)
          if (inputRef.current) {
            inputRef.current.focus()
            console.log('✅ Input focused after conversation load')
          }
        }, 100)
      })
      return
    }
    
    // Clear messages if no conversation or still loading
    if (!currentConversationId || isLoadingConversation) {
      if (!currentConversationId) {
        console.log('🧹 Clearing messages - no conversation')
        setMessages([])
      }
      return
    }
    
    // If we reach here with a conversation ID but no optimistic messages,
    // just wait - the parent will provide them when SWR loads
  }, [currentConversationId, optimisticMessages, isLoadingConversation])
  
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
    setIsStreaming(true)

    // Add user message immediately to UI
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
      created_at: new Date().toISOString(),
    }

    setMessages(prev => [...prev, userMessage])

    // Create streaming assistant message
    const assistantMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      metadata: { model: selectedModel },
      created_at: new Date().toISOString(),
    }

    setStreamingMessage(assistantMessage)

    try {
      // If no conversation exists, create one first
      let conversationId = currentConversationId
      if (!conversationId) {
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
        
        // Notify parent about the new conversation (don't pass messages to avoid overwriting current state)
        if (onConversationChange) {
          onConversationChange(conversationId, currentWorkspaceId, 'New Chat')
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
              
              if (data.type === 'token' && data.content) {
                fullContent += data.content
                setStreamingMessage(prev => prev ? {
                  ...prev,
                  content: fullContent
                } : null)
              } else if (data.type === 'complete') {
                // Stream is complete, add final message to messages array
                const finalAssistantMessage = {
                  ...assistantMessage,
                  content: fullContent,
                  id: data.messageId || assistantMessage.id
                }
                
                setMessages(prev => [...prev, finalAssistantMessage])
                setStreamingMessage(null)
                
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
      setStreamingMessage(null)
    } finally {
      setIsStreaming(false)
      
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

  const copyMessageToClipboard = (content: string) => {
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
  }

  const handleBranchConversation = async (fromMessageId: string) => {
    if (!currentConversationId) return
    
    try {
      const forkMessage = messages.find(m => m.id === fromMessageId)
      if (!forkMessage) {
        console.error('Fork message not found:', fromMessageId)
        return
      }

      // Find the index of the fork message to copy messages up to that point
      const forkIndex = messages.findIndex(m => m.id === fromMessageId)
      const messagesToCopy = messages.slice(0, forkIndex + 1)
      
      if (messagesToCopy.length === 0) {
        console.error('No messages to copy for fork')
        return
      }
      
      // Optimistic: Switch immediately with copied messages and temp IDs
      const tempConversationId = `temp-fork-${Date.now()}`
      const optimisticTitle = `🌱 ${conversationTitle}`
      
      // Create optimistic messages with temporary IDs but preserve original timestamps
      const optimisticMessages = messagesToCopy.map((msg, index) => ({
        ...msg,
        id: `temp-${tempConversationId}-${index}`,
        convo_id: tempConversationId,
        path: (index + 1).toString(),
        // Keep original timestamps
        created_at: msg.created_at,
        updated_at: msg.updated_at
      }))
      
      // Immediately switch to optimistic conversation
      if (onConversationChange && currentWorkspaceId) {
        onConversationChange(tempConversationId, currentWorkspaceId, optimisticTitle, optimisticMessages)
      }


      toast({
        title: "Conversation branched",
        description: `Creating new conversation with ${messagesToCopy.length} messages...`,
      })

      // Make API call in background to create real conversation
      const response = await fetch(`/api/conversations/${currentConversationId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forkFromMessageId: fromMessageId,
          title: optimisticTitle
        })
      })

      if (response.ok) {
        const result = await response.json()
        
        
        // Update with real conversation ID and data, preserving the messages
        if (onConversationChange && currentWorkspaceId) {
          onConversationChange(result.forkedConversation.id, currentWorkspaceId, result.forkedConversation.title, optimisticMessages)
        }
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to branch conversation",
        variant: "destructive",
      })
    }
  }

  const formatMessageDuration = (currentMessage: any, index: number) => {
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
  }

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
        <>
          {messages.map((message, index) => (
              <div key={message.id} className={`mb-6 group ${index === 0 ? "pt-4" : ""}`}>
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
            ))}
            
            {/* Streaming Message */}
            {streamingMessage && (
              <div className="mb-6 group">
                <div className="flex items-start gap-3">
                  <Avatar className="h-8 w-8">
                    <Bot className="h-5 w-5 text-green-500" />
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
                      {isStreaming && !streamingMessage?.content && (
                        <span className="animate-bounce animate-pulse text-muted-foreground/60">|</span>
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
            )}
          </>
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
