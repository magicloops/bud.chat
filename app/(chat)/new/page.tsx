'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChatArea } from '@/components/ChatArea'
import { 
  Message, 
  useSelectedWorkspace, 
  useSetConversation,
  ConversationMeta,
  Conversation,
  useSimpleChatStore
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
import { useBud } from '@/state/budStore'

export default function NewChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedWorkspace = useSelectedWorkspace()
  const setConversation = useSetConversation()
  
  const budId = searchParams.get('bud')
  
  // Get bud from store (reactive to updates) and local state for initial load
  const storeBud = useBud(budId || '')
  const [bud, setBud] = useState<Bud | null>(null)
  
  // State for messages and loading
  const [budLoading, setBudLoading] = useState(!!budId)
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)

  // Load bud if budId is provided
  useEffect(() => {
    const loadBud = async () => {
      if (!budId) {
        // No bud specified, use default messages and clear any custom theme
        setMessages([
          createGreetingMessage(),
          ...createSystemMessages()
        ])
        
        // Clear any existing custom theme and reset to default
        const root = document.documentElement
        const existingTheme = localStorage.getItem('customTheme')
        if (existingTheme) {
          try {
            const theme = JSON.parse(existingTheme)
            Object.keys(theme.cssVariables).forEach(key => {
              root.style.removeProperty(key)
            })
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        // Also clear common theme variables that might be set
        const commonThemeVars = [
          '--background', '--foreground', '--card', '--card-foreground',
          '--popover', '--popover-foreground', '--primary', '--primary-foreground',
          '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
          '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
          '--border', '--input', '--ring'
        ]
        
        commonThemeVars.forEach(varName => {
          root.style.removeProperty(varName)
        })
        
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
        
        // Apply bud's theme or reset to default
        const budConfig = loadedBud.default_json as any
        const root = document.documentElement
        
        if (budConfig?.customTheme) {
          // Apply bud's custom theme
          Object.entries(budConfig.customTheme.cssVariables).forEach(([key, value]) => {
            root.style.setProperty(key, value as string)
          })
        } else {
          // Clear any existing custom theme and reset to default
          // First, try to clear any localStorage theme
          const existingTheme = localStorage.getItem('customTheme')
          if (existingTheme) {
            try {
              const theme = JSON.parse(existingTheme)
              Object.keys(theme.cssVariables).forEach(key => {
                root.style.removeProperty(key)
              })
            } catch (e) {
              // Ignore parse errors
            }
          }
          
          // Also clear common theme variables that might be set
          const commonThemeVars = [
            '--background', '--foreground', '--card', '--card-foreground',
            '--popover', '--popover-foreground', '--primary', '--primary-foreground',
            '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
            '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
            '--border', '--input', '--ring'
          ]
          
          commonThemeVars.forEach(varName => {
            root.style.removeProperty(varName)
          })
        }
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

  // Watch for bud updates from store and regenerate messages
  useEffect(() => {
    if (!budId || !storeBud) return
    
    // Update local bud state
    setBud(storeBud)
    
    // Regenerate messages with updated bud configuration
    const budMessages = createBudInitialMessages(storeBud)
    setMessages(budMessages)
    
    // Apply updated theme
    const budConfig = storeBud.default_json as any
    const root = document.documentElement
    
    // Clear existing theme first
    const commonThemeVars = [
      '--background', '--foreground', '--card', '--card-foreground',
      '--popover', '--popover-foreground', '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
      '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
      '--border', '--input', '--ring'
    ]
    
    commonThemeVars.forEach(varName => {
      root.style.removeProperty(varName)
    })
    
    if (budConfig?.customTheme) {
      // Apply bud's custom theme
      Object.entries(budConfig.customTheme.cssVariables).forEach(([key, value]) => {
        root.style.setProperty(key, value as string)
      })
    }
  }, [budId, storeBud]) // This will trigger when storeBud changes (i.e., when bud is updated)


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
                  
                case 'debug':
                  // Emit debug event for debug panel
                  if (typeof window !== 'undefined' && localStorage.getItem('debug-mode') === 'true') {
                    const debugEvent = {
                      id: Math.random().toString(36).substr(2, 9),
                      timestamp: new Date().toISOString(),
                      type: data.debug_type,
                      data: data.data,
                      conversationId: conversationId || 'new-conversation'
                    }
                    window.dispatchEvent(new CustomEvent('debug-event', { detail: debugEvent }))
                  }
                  break
                  
                case 'tool_start':
                  // Handle tool start - add the tool call to metadata and content
                  setMessages(prevMessages => 
                    prevMessages.map(msg => 
                      msg.id === assistantPlaceholder.id 
                        ? { 
                            ...msg, 
                            content: msg.content + data.content, 
                            updated_at: new Date().toISOString(),
                            json_meta: { 
                              ...msg.json_meta, 
                              tool_calls: [...(msg.json_meta?.tool_calls || []), {
                                id: data.tool_id,
                                type: 'function',
                                function: {
                                  name: data.tool_name,
                                  arguments: data.tool_arguments || '{}'
                                }
                              }]
                            }
                          }
                        : msg
                    )
                  )
                  break
                  
                case 'tool_complete':
                case 'tool_error':
                  // Handle tool completion - just add content but preserve tool calls
                  setMessages(prevMessages => 
                    prevMessages.map(msg => 
                      msg.id === assistantPlaceholder.id 
                        ? { 
                            ...msg, 
                            content: msg.content + data.content, 
                            updated_at: new Date().toISOString()
                          }
                        : msg
                    )
                  )
                  break
                  
                case 'complete':
                  setIsStreaming(false)
                  setStreamingMessageId(null)
                  
                  // Update final content while preserving tool call metadata
                  const finalMessages = newMessages.map(msg => 
                    msg.id === assistantPlaceholder.id 
                      ? { 
                          ...msg, 
                          content: data.content,
                          updated_at: new Date().toISOString(),
                          json_meta: { 
                            ...msg.json_meta, 
                            isStreaming: false,
                            // Preserve tool calls from streaming
                            toolCalls: msg.json_meta?.toolCalls || []
                          }
                        }
                      : msg
                  )
                  setMessages(finalMessages)
                  
                  // CRITICAL: Seamless transition
                  if (conversationId) {
                    console.log('🔄 Transitioning to real conversation:', conversationId)
                    
                    // 4. Pre-populate Zustand store with local state
                    const budConfig = bud?.default_json as any
                    // Check if conversation already exists in store (from realtime update)
                    const existingConversation = setConversation ? useSimpleChatStore.getState().conversations[conversationId] : null
                    
                    const conversationMeta: ConversationMeta = {
                      id: conversationId,
                      title: existingConversation?.meta.title, // No default title - let backend set it
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