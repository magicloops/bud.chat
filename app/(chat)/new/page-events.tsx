'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  useEventSelectedWorkspace, 
  useEventSetConversation,
  useEventChatStore,
  EventConversation,
  EventConversationMeta
} from '@/state/eventChatStore'
import { 
  createGreetingEvent, 
  createUserEvent, 
  createAssistantPlaceholderEvent,
  createSystemEvents,
  updateEventsConversationId,
  createBudInitialEvents,
  createOptimisticEventConversation,
  eventsToStreamingFormat,
  StreamingEventBuilder
} from '@/lib/eventMessageHelpers'
import { budManager } from '@/lib/budHelpers'
import { Bud } from '@/lib/types'
import { useBud } from '@/state/budStore'
import { Event } from '@/lib/types/events'
import EventStream from '@/components/EventStream'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'

export default function NewEventChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedWorkspace = useEventSelectedWorkspace()
  const setConversation = useEventSetConversation()
  
  const budId = searchParams.get('bud')
  
  // Get bud from store (reactive to updates) and local state for initial load
  const storeBud = useBud(budId || '')
  const [bud, setBud] = useState<Bud | null>(null)
  
  // State for events and streaming
  const [budLoading, setBudLoading] = useState(!!budId)
  const [events, setEvents] = useState<Event[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingEventId, setStreamingEventId] = useState<string | null>(null)
  const [input, setInput] = useState('')

  // Load bud if budId is provided
  useEffect(() => {
    const loadBud = async () => {
      if (!budId) {
        // No bud specified, use default events and clear any custom theme
        setEvents([
          createGreetingEvent(),
          ...createSystemEvents()
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
        
        // Initialize events with bud configuration
        const budEvents = createBudInitialEvents(loadedBud)
        setEvents(budEvents)
        
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
        // Fallback to default events
        setEvents([
          createGreetingEvent(),
          ...createSystemEvents()
        ])
      } finally {
        setBudLoading(false)
      }
    }

    loadBud()
  }, [budId])

  // Watch for bud updates from store and regenerate events
  useEffect(() => {
    if (!budId || !storeBud) return
    
    // Update local bud state
    setBud(storeBud)
    
    // Regenerate events with updated bud configuration
    const budEvents = createBudInitialEvents(storeBud)
    setEvents(budEvents)
    
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
  }, [budId, storeBud])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace) {
      console.error('No workspace selected')
      return
    }

    // 1. Optimistic UI updates (instant)
    const userEvent = createUserEvent(content)
    const assistantPlaceholder = createAssistantPlaceholderEvent()
    
    const newEvents = [...events, userEvent, assistantPlaceholder]
    setEvents(newEvents)
    setIsStreaming(true)
    setStreamingEventId(assistantPlaceholder.id)

    // Create streaming event builder
    const streamingBuilder = new StreamingEventBuilder(
      assistantPlaceholder,
      (updatedEvent) => {
        setEvents(prevEvents => 
          prevEvents.map(event => 
            event.id === assistantPlaceholder.id ? updatedEvent : event
          )
        )
      }
    )

    try {
      // 2. Start streaming immediately - no database blocking!
      console.log('📡 Starting event-based streaming request...')
      const response = await fetch('/api/chat-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: eventsToStreamingFormat(newEvents.filter(e => e.id !== assistantPlaceholder.id)), // Don't send placeholder
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
                  // Add text chunk to streaming event
                  streamingBuilder.addTextChunk(data.content)
                  break
                  
                case 'tool_start':
                  // Add tool call to streaming event
                  streamingBuilder.addToolCall(data.tool_id, data.tool_name, {})
                  break
                  
                case 'tool_complete':
                  // Add tool completion text
                  streamingBuilder.addTextChunk(data.content || '')
                  break
                  
                case 'complete':
                  setIsStreaming(false)
                  setStreamingEventId(null)
                  
                  // Finalize the streaming event
                  const finalEvent = streamingBuilder.finalize()
                  const finalEvents = newEvents.map(event => 
                    event.id === assistantPlaceholder.id ? finalEvent : event
                  )
                  setEvents(finalEvents)
                  
                  // CRITICAL: Seamless transition - maintain exact same pattern
                  if (conversationId) {
                    console.log('🔄 Transitioning to real event-based conversation:', conversationId)
                    
                    // 4. Pre-populate Zustand store with local state
                    const budConfig = bud?.default_json as any
                    // Check if conversation already exists in store (from realtime update)
                    const existingConversation = setConversation ? useEventChatStore.getState().conversations[conversationId] : null
                    
                    const conversationMeta: EventConversationMeta = {
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
                    
                    const conversation: EventConversation = {
                      id: conversationId,
                      events: updateEventsConversationId(finalEvents, conversationId),
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
                  setStreamingEventId(null)
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
      setStreamingEventId(null)
      // TODO: Show error to user
    }
  }, [events, selectedWorkspace, setConversation, router, bud])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isStreaming) {
      handleSendMessage(input.trim())
      setInput('')
    }
  }

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

  // Render event-based chat interface
  const placeholder = bud 
    ? `Chat with ${(bud.default_json as any).name || 'your bud'}...`
    : "Start a new conversation..."

  return (
    <div className="flex flex-col h-full">
      {/* Chat Messages */}
      <div className="flex-1 overflow-hidden">
        <EventStream
          events={events}
          isStreaming={isStreaming}
          streamingEventId={streamingEventId}
          className="h-full"
        />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            className="min-h-[60px] resize-none"
            disabled={isStreaming}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          <Button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="h-full"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}