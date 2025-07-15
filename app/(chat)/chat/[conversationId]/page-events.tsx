'use client'

import { use, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { 
  useEventConversation, 
  useEventSetConversation, 
  useEventSelectedWorkspace,
  useEventSetSelectedWorkspace,
  EventConversation,
  EventConversationMeta,
  legacyMessagesToEvents
} from '@/state/eventChatStore'
import EventStream from '@/components/EventStream'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { createUserEvent, createAssistantPlaceholderEvent, eventsToStreamingFormat, StreamingEventBuilder } from '@/lib/eventMessageHelpers'

interface EventChatPageProps {
  params: Promise<{ conversationId: string }>
}

export default function EventChatPage({ params }: EventChatPageProps) {
  const resolvedParams = use(params)
  const conversationId = resolvedParams.conversationId
  
  const selectedWorkspace = useEventSelectedWorkspace()
  const setSelectedWorkspace = useEventSetSelectedWorkspace()
  const setConversation = useEventSetConversation()
  
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingEventId, setStreamingEventId] = useState<string | null>(null)
  
  // Check if conversation is already in store
  const existingConversation = useEventConversation(conversationId)

  // Fetch conversation from server if not in store
  const { data: conversationData, isLoading, error } = useQuery({
    queryKey: ['event-conversation', conversationId],
    queryFn: async () => {
      // First try to fetch from events table
      const eventsResponse = await fetch(`/api/conversations/${conversationId}/events`)
      
      if (eventsResponse.ok) {
        const eventsData = await eventsResponse.json()
        if (eventsData.events && eventsData.events.length > 0) {
          // We have events - use them
          return {
            ...eventsData,
            useEvents: true
          }
        }
      }
      
      // Fallback to legacy messages
      const response = await fetch(`/api/conversations/${conversationId}?include_messages=true`)
      if (!response.ok) {
        throw new Error(`Failed to fetch conversation: ${response.status}`)
      }
      
      const data = await response.json()
      return {
        ...data,
        useEvents: false
      }
    },
    enabled: !!conversationId && !existingConversation,
    staleTime: Infinity, // Don't refetch unless manually invalidated
    gcTime: Infinity,
  })

  // Load conversation data into store when received from server
  useEffect(() => {
    if (conversationData && (!existingConversation || existingConversation.events.length === 0)) {
      const conversationMeta: EventConversationMeta = {
        id: conversationData.id,
        title: conversationData.title || 'Chat',
        workspace_id: conversationData.workspace_id,
        source_bud_id: conversationData.source_bud_id,
        // Use the effective identity computed by the server
        assistant_name: conversationData.effective_assistant_name,
        assistant_avatar: conversationData.effective_assistant_avatar,
        model_config_overrides: conversationData.model_config_overrides,
        created_at: conversationData.created_at
      }
      
      // Convert messages to events if needed
      let events = []
      if (conversationData.useEvents) {
        events = conversationData.events || []
      } else {
        // Convert legacy messages to events
        events = legacyMessagesToEvents(conversationData.messages || [])
      }
      
      const conversation: EventConversation = {
        id: conversationData.id,
        events: events,
        isStreaming: false,
        meta: conversationMeta
      }
      
      setConversation(conversationData.id, conversation)
      
      // Apply bud theme if available
      if (conversationData.bud_config?.customTheme) {
        const root = document.documentElement
        Object.entries(conversationData.bud_config.customTheme.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value as string)
        })
      }
      
      // Switch workspace if needed
      if (conversationData.workspace_id && conversationData.workspace_id !== selectedWorkspace) {
        setSelectedWorkspace(conversationData.workspace_id)
      }
    }
  }, [conversationData, existingConversation, setConversation, selectedWorkspace, setSelectedWorkspace])

  // Handle sending new messages
  const handleSendMessage = async (content: string) => {
    if (!selectedWorkspace || !existingConversation || isStreaming) return

    // Add user event
    const userEvent = createUserEvent(content)
    const assistantPlaceholder = createAssistantPlaceholderEvent()
    
    const newEvents = [...existingConversation.events, userEvent, assistantPlaceholder]
    
    // Update conversation optimistically
    setConversation(conversationId, {
      ...existingConversation,
      events: newEvents,
      isStreaming: true,
      streamingEventId: assistantPlaceholder.id
    })
    
    setIsStreaming(true)
    setStreamingEventId(assistantPlaceholder.id)

    // Create streaming event builder
    const streamingBuilder = new StreamingEventBuilder(
      assistantPlaceholder,
      (updatedEvent) => {
        setConversation(conversationId, {
          ...existingConversation,
          events: existingConversation.events.map(event => 
            event.id === assistantPlaceholder.id ? updatedEvent : event
          )
        })
      }
    )

    try {
      const response = await fetch('/api/chat-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: eventsToStreamingFormat(newEvents.filter(e => e.id !== assistantPlaceholder.id)),
          workspaceId: selectedWorkspace,
          budId: existingConversation.meta.source_bud_id,
          conversationId: conversationId // Pass existing conversation ID
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
                  
                  setConversation(conversationId, {
                    ...existingConversation,
                    events: finalEvents,
                    isStreaming: false,
                    streamingEventId: undefined
                  })
                  
                  setIsStreaming(false)
                  setStreamingEventId(null)
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
      console.error('Failed to send message:', error)
      setIsStreaming(false)
      setStreamingEventId(null)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim() && !isStreaming) {
      handleSendMessage(input.trim())
      setInput('')
    }
  }

  // Show loading state (layout handles auth)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">Conversation not found</p>
          <p className="text-sm">The conversation you're looking for doesn't exist or you don't have access to it.</p>
        </div>
      </div>
    )
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

  // Show loading state while conversation loads
  if (!existingConversation && !conversationData) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Render event-based chat interface
  return (
    <div className="flex flex-col h-full">
      {/* Chat Messages */}
      <div className="flex-1 overflow-hidden">
        <EventStream
          events={existingConversation?.events || []}
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
            placeholder="Type your message..."
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