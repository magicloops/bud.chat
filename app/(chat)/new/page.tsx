'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { 
  createBudInitialMessages,
  budManager
} from '@/lib/budHelpers'
import { Bud } from '@/lib/types'

export default function NewChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedWorkspace = useSelectedWorkspace()
  const setConversation = useSetConversation()
  
  const budId = searchParams.get('bud')
  
  // State for bud and messages
  const [bud, setBud] = useState<Bud | null>(null)
  const [budLoading, setBudLoading] = useState(!!budId)
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)

  // Load bud if budId is provided
  useEffect(() => {
    const loadBud = async () => {
      if (!budId) {
        // No bud specified, use default messages
        setMessages([
          createGreetingMessage(),
          ...createSystemMessages()
        ])
        setBudLoading(false)
        return
      }

      try {
        setBudLoading(true)
        const loadedBud = await budManager.getBud(budId)
        setBud(loadedBud)
        
        // Initialize messages with bud configuration
        const budMessages = createBudInitialMessages(loadedBud)
        setMessages(budMessages)
      } catch (error) {
        console.error('Failed to load bud:', error)
        // Fallback to default messages
        setMessages([
          createGreetingMessage(),
          ...createSystemMessages()
        ])
      } finally {
        setBudLoading(false)
      }
    }

    loadBud()
  }, [budId])

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
          budId: bud?.id,
          model: bud ? (bud.default_json as any).model || 'gpt-4o' : 'gpt-4o'
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

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              
              switch (data.type) {
                case 'conversationCreated':
                  conversationId = data.conversationId
                  console.log('💾 Conversation created:', conversationId)
                  break
                  
                case 'token':
                  setMessages(prevMessages => 
                    prevMessages.map(msg => 
                      msg.id === assistantPlaceholder.id 
                        ? { ...msg, content: msg.content + data.content, updated_at: new Date().toISOString() }
                        : msg
                    )
                  )
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
                    const budConfig = bud?.default_json as any
                    const conversationMeta: ConversationMeta = {
                      id: conversationId,
                      title: 'New Chat',
                      workspace_id: selectedWorkspace,
                      source_bud_id: bud?.id,
                      // Include resolved assistant identity from bud for optimistic display
                      assistant_name: budConfig?.name || 'Assistant',
                      assistant_avatar: budConfig?.avatar || '🤖',
                      model_config_overrides: undefined,
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

  // Show loading while bud is loading
  if (budLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Loading bud...</p>
        </div>
      </div>
    )
  }

  // Render chat interface with local state
  const placeholder = bud 
    ? `Chat with ${(bud.default_json as any).name || 'your bud'}...`
    : "Start a new conversation..."

  return (
    <ChatArea
      messages={messages}
      isStreaming={isStreaming}
      onSendMessage={handleSendMessage}
      placeholder={placeholder}
      budData={bud}
    />
  )
}