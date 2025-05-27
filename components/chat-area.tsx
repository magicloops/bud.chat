"use client"

import { useState, useEffect, useRef } from "react"
import { Avatar } from "@/components/ui/avatar"
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
import { createClient } from "@/lib/supabase/client"

type Message = Database['public']['Tables']['message']['Row']

interface ChatAreaProps {
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
  currentConversationId?: string | null
  currentWorkspaceId?: string | null
  conversationTitle?: string
  optimisticMessages?: any[]
  onConversationChange?: (conversationId: string, workspaceId: string, title?: string, optimisticMessages?: any[]) => void
}

export default function ChatArea({
  toggleLeftSidebar,
  toggleRightSidebar,
  leftSidebarOpen,
  rightSidebarOpen,
  currentConversationId,
  currentWorkspaceId,
  conversationTitle = "New Chat",
  optimisticMessages,
  onConversationChange,
}: ChatAreaProps) {
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<any[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessage, setStreamingMessage] = useState<any | null>(null)
  const [assistantName, setAssistantName] = useState<string>('Assistant')
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const { selectedModel } = useModel()
  
  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversationId) {
      // Handle optimistic messages (for temp conversations or new conversations with greeting)
      if (optimisticMessages && optimisticMessages.length > 0) {
        setMessages(optimisticMessages)
        
        // For real conversations, still load from API but after setting optimistic messages
        if (!currentConversationId.startsWith('temp-')) {
          loadMessages()
          loadAssistantName()
        }
        return
      }
      
      // Load from API for real conversations without optimistic messages
      if (!currentConversationId.startsWith('temp-')) {
        loadMessages()
        loadAssistantName()
      }
    } else {
      setMessages([])
    }
  }, [currentConversationId, optimisticMessages])

  // Listen for message updates (assistant name changes)
  useEffect(() => {
    if (!currentConversationId || currentConversationId.startsWith('temp-')) return

    const supabase = createClient()
    const channel = supabase
      .channel(`messages:${currentConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message',
          filter: `convo_id=eq.${currentConversationId}`
        },
        (payload) => {
          console.log('Message updated via real-time:', payload.new)
          const updatedMessage = payload.new as any
          if (updatedMessage.role === 'assistant' && updatedMessage.metadata?.assistantName) {
            console.log('Updating assistant name from real-time:', updatedMessage.metadata.assistantName)
            setAssistantName(updatedMessage.metadata.assistantName)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentConversationId])

  const loadMessages = async () => {
    if (!currentConversationId || currentConversationId.startsWith('temp-')) return
    
    try {
      const response = await fetch(`/api/conversations/${currentConversationId}/messages`)
      if (response.ok) {
        const data = await response.json()
        setMessages(data)
      }
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }

  const loadAssistantName = async () => {
    if (!currentConversationId || currentConversationId.startsWith('temp-')) return
    
    try {
      console.log('Loading assistant name for:', currentConversationId)
      const response = await fetch(`/api/conversations/${currentConversationId}/messages`)
      if (response.ok) {
        const messages = await response.json()
        console.log('Loaded messages to find assistant name:', messages)
        
        // Find the first assistant message with an assistant name
        const assistantMessage = messages.find((msg: any) => 
          msg.role === 'assistant' && msg.metadata?.assistantName
        )
        
        if (assistantMessage?.metadata?.assistantName) {
          console.log('Setting assistant name to:', assistantMessage.metadata.assistantName)
          setAssistantName(assistantMessage.metadata.assistantName)
        } else {
          console.log('No assistant name found in messages, using default')
          setAssistantName('Assistant')
        }
      } else {
        console.log('Failed to load messages, status:', response.status)
      }
    } catch (error) {
      console.error('Error loading assistant name:', error)
    }
  }

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
    if (!input.trim() || !currentConversationId || !currentWorkspaceId || isStreaming) return

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
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: currentConversationId,
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
                
                // Check for assistant name update after a short delay
                setTimeout(async () => {
                  loadAssistantName()
                  // Also reload messages to get any updated metadata
                  loadMessages()
                }, 1500)
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

  if (!currentConversationId) {
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
                      <User className="h-5 w-5" />
                    ) : (
                      <Bot className="h-5 w-5 text-green-500" />
                    )}
                  </Avatar>
                  <div className="flex-1">
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
                    <div className="text-sm whitespace-pre-wrap">{message.content}</div>
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
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">{assistantName}</span>
                      {streamingMessage.metadata?.model && streamingMessage.metadata.model !== 'greeting' && (
                        <span className="text-xs text-muted-foreground/60">{streamingMessage.metadata.model}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        · {isStreaming ? 'typing...' : 'just now'}
                      </span>
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {streamingMessage.content}
                      {isStreaming && <span className="animate-pulse">|</span>}
                    </div>
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
              <User className="h-5 w-5" />
            </Avatar>
            <div className="flex-1 border rounded-md p-2 min-h-[80px] focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                placeholder="Send a message..."
                className="border-0 focus-visible:ring-0 resize-none p-0 shadow-none min-h-[60px]"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={isStreaming || !currentConversationId}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-green-100 hover:bg-green-200 text-green-700 disabled:opacity-50"
            onClick={handleSendMessage}
            disabled={!input.trim() || isStreaming || !currentConversationId}
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
