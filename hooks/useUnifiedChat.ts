'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Event, createTextEvent } from '@/lib/types/events'
import { 
  useEventSelectedWorkspace, 
  useEventSetConversation,
  useEventChatStore,
  EventConversation,
  EventConversationMeta,
  eventsToLegacyMessages
} from '@/state/eventChatStore'
import { 
  useSelectedWorkspace, 
  useSetConversation,
  useSimpleChatStore,
  Conversation,
  ConversationMeta,
  Message
} from '@/state/simpleChatStore'
import { 
  createUserEvent, 
  createAssistantPlaceholderEvent,
  eventsToStreamingFormat,
  StreamingEventBuilder,
  legacyMessagesToEvents
} from '@/lib/eventMessageHelpers'
import { 
  createUserMessage, 
  createAssistantPlaceholder,
  updateMessagesConversationId
} from '@/lib/messageHelpers'

interface UseUnifiedChatOptions {
  workspaceId?: string
  budId?: string
  model?: string
  useEvents?: boolean // Flag to use event-based system
  onConversationCreated?: (conversationId: string) => void
  onError?: (error: string) => void
}

interface UnifiedChatState {
  events: Event[]
  messages: Message[]
  isStreaming: boolean
  streamingEventId: string | null
  streamingMessageId: string | null
  error: string | null
  useEvents: boolean
}

export function useUnifiedChat({
  workspaceId,
  budId,
  model = 'gpt-4o',
  useEvents = true, // Default to event-based system
  onConversationCreated,
  onError
}: UseUnifiedChatOptions) {
  const router = useRouter()
  
  // Event-based hooks
  const eventSelectedWorkspace = useEventSelectedWorkspace()
  const eventSetConversation = useEventSetConversation()
  
  // Legacy hooks
  const legacySelectedWorkspace = useSelectedWorkspace()
  const legacySetConversation = useSetConversation()
  
  // Unified state
  const [state, setState] = useState<UnifiedChatState>({
    events: [],
    messages: [],
    isStreaming: false,
    streamingEventId: null,
    streamingMessageId: null,
    error: null,
    useEvents
  })

  // Get the appropriate workspace
  const selectedWorkspace = useEvents ? eventSelectedWorkspace : legacySelectedWorkspace
  const setConversation = useEvents ? eventSetConversation : legacySetConversation

  const updateState = useCallback((updates: Partial<UnifiedChatState>) => {
    setState(prev => ({ ...prev, ...updates }))
  }, [])

  // Add event or message
  const addContent = useCallback((content: string, role: 'user' | 'assistant' | 'system') => {
    if (useEvents) {
      const event = createTextEvent(role, content)
      updateState({ events: [...state.events, event] })
    } else {
      const message: Message = {
        id: crypto.randomUUID(),
        conversation_id: '',
        role,
        content,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        order_key: Date.now().toString()
      }
      updateState({ messages: [...state.messages, message] })
    }
  }, [useEvents, state.events, state.messages, updateState])

  // Send message with unified handling
  const sendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace || state.isStreaming) return

    updateState({ error: null })

    if (useEvents) {
      // Event-based implementation
      const userEvent = createUserEvent(content)
      const assistantPlaceholder = createAssistantPlaceholderEvent()
      
      const newEvents = [...state.events, userEvent, assistantPlaceholder]
      updateState({ 
        events: newEvents,
        isStreaming: true,
        streamingEventId: assistantPlaceholder.id
      })

      const streamingBuilder = new StreamingEventBuilder(
        assistantPlaceholder,
        (updatedEvent) => {
          updateState({
            events: state.events.map(event => 
              event.id === assistantPlaceholder.id ? updatedEvent : event
            )
          })
        }
      )

      try {
        const response = await fetch('/api/chat-events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: eventsToStreamingFormat(newEvents.filter(e => e.id !== assistantPlaceholder.id)),
            workspaceId: selectedWorkspace,
            budId,
            model
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
                    onConversationCreated?.(conversationId)
                    break
                    
                  case 'token':
                    streamingBuilder.addTextChunk(data.content)
                    break
                    
                  case 'tool_start':
                    streamingBuilder.addToolCall(data.tool_id, data.tool_name, {})
                    break
                    
                  case 'tool_complete':
                    streamingBuilder.addTextChunk(data.content || '')
                    break
                    
                  case 'complete':
                    const finalEvent = streamingBuilder.finalize()
                    const finalEvents = newEvents.map(event => 
                      event.id === assistantPlaceholder.id ? finalEvent : event
                    )
                    
                    updateState({
                      events: finalEvents,
                      isStreaming: false,
                      streamingEventId: null
                    })
                    
                    // Create optimistic conversation for store
                    if (conversationId) {
                      const conversationMeta: EventConversationMeta = {
                        id: conversationId,
                        workspace_id: selectedWorkspace,
                        source_bud_id: budId,
                        created_at: new Date().toISOString()
                      }
                      
                      const conversation: EventConversation = {
                        id: conversationId,
                        events: finalEvents,
                        isStreaming: false,
                        meta: conversationMeta
                      }
                      
                      eventSetConversation(conversationId, conversation)
                      router.push(`/chat/${conversationId}`)
                    }
                    break
                    
                  case 'error':
                    throw new Error(data.error)
                }
              } catch (e) {
                console.error('Error parsing stream data:', e)
              }
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        updateState({
          error: errorMessage,
          isStreaming: false,
          streamingEventId: null
        })
        onError?.(errorMessage)
      }
    } else {
      // Legacy implementation
      const userMessage = createUserMessage(content)
      const assistantPlaceholder = createAssistantPlaceholder()
      
      const newMessages = [...state.messages, userMessage, assistantPlaceholder]
      updateState({
        messages: newMessages,
        isStreaming: true,
        streamingMessageId: assistantPlaceholder.id
      })

      try {
        const response = await fetch('/api/chat-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages.filter(m => m.role !== 'assistant' || !m.json_meta?.isStreaming),
            workspaceId: selectedWorkspace,
            budId,
            model
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
                    onConversationCreated?.(conversationId)
                    break
                    
                  case 'token':
                    updateState({
                      messages: state.messages.map(msg => 
                        msg.id === assistantPlaceholder.id 
                          ? { ...msg, content: msg.content + data.content, updated_at: new Date().toISOString() }
                          : msg
                      )
                    })
                    break
                    
                  case 'complete':
                    const finalMessages = newMessages.map(msg => 
                      msg.id === assistantPlaceholder.id 
                        ? { ...msg, content: data.content, updated_at: new Date().toISOString() }
                        : msg
                    )
                    
                    updateState({
                      messages: finalMessages,
                      isStreaming: false,
                      streamingMessageId: null
                    })
                    
                    // Create optimistic conversation for store
                    if (conversationId) {
                      const conversationMeta: ConversationMeta = {
                        id: conversationId,
                        workspace_id: selectedWorkspace,
                        source_bud_id: budId,
                        created_at: new Date().toISOString()
                      }
                      
                      const conversation: Conversation = {
                        id: conversationId,
                        messages: updateMessagesConversationId(finalMessages, conversationId),
                        isStreaming: false,
                        meta: conversationMeta
                      }
                      
                      legacySetConversation(conversationId, conversation)
                      router.push(`/chat/${conversationId}`)
                    }
                    break
                    
                  case 'error':
                    throw new Error(data.error)
                }
              } catch (e) {
                console.error('Error parsing stream data:', e)
              }
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        updateState({
          error: errorMessage,
          isStreaming: false,
          streamingMessageId: null
        })
        onError?.(errorMessage)
      }
    }
  }, [
    useEvents, 
    selectedWorkspace, 
    state.events, 
    state.messages, 
    state.isStreaming, 
    budId, 
    model, 
    updateState, 
    onConversationCreated, 
    onError,
    eventSetConversation,
    legacySetConversation,
    router
  ])

  // Convert between formats for compatibility
  const getDisplayData = useCallback(() => {
    if (useEvents) {
      return {
        events: state.events,
        messages: eventsToLegacyMessages(state.events) // For compatibility
      }
    } else {
      return {
        events: legacyMessagesToEvents(state.messages), // For compatibility
        messages: state.messages
      }
    }
  }, [useEvents, state.events, state.messages])

  const clearConversation = useCallback(() => {
    updateState({
      events: [],
      messages: [],
      isStreaming: false,
      streamingEventId: null,
      streamingMessageId: null,
      error: null
    })
  }, [updateState])

  return {
    // State
    ...state,
    selectedWorkspace,
    displayData: getDisplayData(),
    
    // Actions
    sendMessage,
    addContent,
    clearConversation,
    
    // Utilities
    isEventBased: useEvents,
    canSwitchMode: true // Could be used for A/B testing
  }
}