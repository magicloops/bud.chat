'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChatArea } from '@/components/ChatArea'
import { 
  Message, 
  useSelectedWorkspace, 
  useSetConversation,
  ConversationMeta,
  Conversation 
} from '@/state/simpleChatStore'
import { 
  createGreetingMessage, 
  createUserMessage, 
  createAssistantPlaceholder,
  createSystemMessages,
  updateMessagesConversationId
} from '@/lib/messageHelpers'

export default function NewChatPage() {
  const router = useRouter()
  const selectedWorkspace = useSelectedWorkspace()
  const setConversation = useSetConversation()
  
  // Local state only - no Zustand needed for /new route
  const [messages, setMessages] = useState<Message[]>(() => [
    createGreetingMessage(),
    ...createSystemMessages() // TODO: Based on bud config
  ])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace) {
      console.error('No workspace selected')
      return
    }

    
    // 1. Optimistic UI updates (instant)
    const userMessage = createUserMessage(content)
    const assistantPlaceholder = createAssistantPlaceholder()
    
    const newMessages = [...messages, userMessage, assistantPlaceholder]
    setMessages(newMessages)
    setIsStreaming(true)
    setStreamingMessageId(assistantPlaceholder.id)

    try {
      // 2. Start streaming immediately - no database blocking!
      console.log('📡 Starting streaming request...')
      const response = await fetch('/api/chat-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages.filter(m => m.role !== 'assistant' || !m.json_meta?.isStreaming), // Don't send placeholder
          workspaceId: selectedWorkspace,
          model: 'gpt-4o' // TODO: Make configurable
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // 3. Handle streaming response
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let conversationId: string | null = null
      let tokenCount = 0
      let streamStartTime = performance.now()
      let lastTokenTime = performance.now()

      while (true) {
        const chunkStartTime = performance.now()
        const { done, value } = await reader.read()
        if (done) break

        const parseStartTime = performance.now()
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonParseStart = performance.now()
              const data = JSON.parse(line.slice(6))
              const jsonParseTime = performance.now() - jsonParseStart
              
              if (jsonParseTime > 2) {
                console.log('🐌 PERF: Slow JSON parse:', jsonParseTime.toFixed(2), 'ms')
              }
              
              switch (data.type) {
                case 'conversationCreated':
                  conversationId = data.conversationId
                  console.log('💾 Conversation created:', conversationId)
                  break
                  
                case 'token':
                  // Performance: Track token timing
                  tokenCount++
                  const currentTime = performance.now()
                  const timeSinceStart = currentTime - streamStartTime
                  const timeSinceLastToken = currentTime - lastTokenTime
                  lastTokenTime = currentTime
                  
                  if (tokenCount === 1) {
                    console.log('⚡ PERF: Time to first token:', timeSinceStart.toFixed(2), 'ms')
                  }
                  
                  if (tokenCount % 10 === 0) {
                    console.log(`⚡ PERF: Token ${tokenCount} - Inter-token delay:`, timeSinceLastToken.toFixed(2), 'ms')
                  }
                  
                  // Performance: Time React state update
                  const reactUpdateStart = performance.now()
                  setMessages(prevMessages => 
                    prevMessages.map(msg => 
                      msg.id === assistantPlaceholder.id 
                        ? { ...msg, content: msg.content + data.content, updated_at: new Date().toISOString() }
                        : msg
                    )
                  )
                  const reactUpdateTime = performance.now() - reactUpdateStart
                  
                  if (reactUpdateTime > 5) {
                    console.log('🐌 PERF: Slow React update:', reactUpdateTime.toFixed(2), 'ms')
                  }
                  break
                  
                case 'complete':
                  setIsStreaming(false)
                  setStreamingMessageId(null)
                  
                  // Update final content
                  const finalMessages = newMessages.map(msg => 
                    msg.id === assistantPlaceholder.id 
                      ? { 
                          ...msg, 
                          content: data.content,
                          updated_at: new Date().toISOString(),
                          json_meta: { ...msg.json_meta, isStreaming: false }
                        }
                      : msg
                  )
                  setMessages(finalMessages)
                  
                  // CRITICAL: Seamless transition
                  if (conversationId) {
                    console.log('🔄 Transitioning to real conversation:', conversationId)
                    
                    // 4. Pre-populate Zustand store with local state
                    const conversationMeta: ConversationMeta = {
                      id: conversationId,
                      title: 'New Chat',
                      workspace_id: selectedWorkspace,
                      created_at: new Date().toISOString()
                    }
                    
                    const conversation: Conversation = {
                      id: conversationId,
                      messages: updateMessagesConversationId(finalMessages, conversationId),
                      isStreaming: false,
                      meta: conversationMeta
                    }
                    
                    setConversation(conversationId, conversation)
                    
                    // 5. Navigate - ChatPage will find data already in store (zero flash!)
                    router.push(`/chat/${conversationId}`)
                  }
                  break
                  
                case 'error':
                  console.error('Streaming error:', data.error)
                  setIsStreaming(false)
                  setStreamingMessageId(null)
                  break
              }
            } catch (e) {
              console.error('Error parsing stream data:', e)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to start streaming:', error)
      setIsStreaming(false)
      setStreamingMessageId(null)
      // TODO: Show error to user
    }
  }, [messages, selectedWorkspace, setConversation, router])

  // Show workspace selection prompt (layout handles auth)
  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Please select a workspace to continue</p>
        </div>
      </div>
    )
  }

  // Render chat interface with local state
  return (
    <ChatArea
      messages={messages}
      isStreaming={isStreaming}
      onSendMessage={handleSendMessage}
      placeholder="Start a new conversation..."
    />
  )
}