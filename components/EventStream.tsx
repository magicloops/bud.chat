'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Event } from '@/lib/types/events'
import EventMessage, { groupEventsByTurn } from './EventMessage'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface EventStreamProps {
  events: Event[]
  isStreaming?: boolean
  streamingEventId?: string | null
  onEventUpdate?: (event: Event) => void
  className?: string
}

interface StreamingEvent {
  event: Event
  isStreaming: boolean
}

const EventStream = function EventStream({
  events,
  isStreaming = false,
  streamingEventId = null,
  onEventUpdate,
  className
}: EventStreamProps) {
  const [streamingEvents, setStreamingEvents] = useState<Map<string, StreamingEvent>>(new Map())
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastEventCountRef = useRef(events.length)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (events.length > lastEventCountRef.current) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
      lastEventCountRef.current = events.length
    }
  }, [events.length])

  // Auto-scroll when streaming
  useEffect(() => {
    if (isStreaming) {
      const timer = setTimeout(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isStreaming])

  // Handle real-time event updates
  const handleEventUpdate = useCallback((updatedEvent: Event) => {
    setStreamingEvents(prev => {
      const newMap = new Map(prev)
      newMap.set(updatedEvent.id, {
        event: updatedEvent,
        isStreaming: streamingEventId === updatedEvent.id
      })
      return newMap
    })
    
    onEventUpdate?.(updatedEvent)
  }, [streamingEventId, onEventUpdate])

  // Merge streaming events with regular events
  const mergedEvents = [...events]
  
  // Add or update streaming events
  for (const [eventId, streamingEvent] of streamingEvents) {
    const existingIndex = mergedEvents.findIndex(e => e.id === eventId)
    if (existingIndex >= 0) {
      mergedEvents[existingIndex] = streamingEvent.event
    } else {
      mergedEvents.push(streamingEvent.event)
    }
  }

  // Sort events by timestamp
  mergedEvents.sort((a, b) => a.ts - b.ts)

  // Group events by conversation turns for better display
  const eventTurns = groupEventsByTurn(mergedEvents)

  return (
    <ScrollArea className={cn("h-full", className)}>
      <div className="p-4 space-y-6">
        {eventTurns.map((turn, turnIndex) => (
          <div key={turnIndex} className="space-y-4">
            {turn.map((event) => {
              const isCurrentlyStreaming = streamingEventId === event.id
              const streamingEvent = streamingEvents.get(event.id)
              
              return (
                <EventMessage
                  key={event.id}
                  event={streamingEvent?.event || event}
                  isStreaming={isCurrentlyStreaming}
                  className={cn(
                    "transition-all duration-200",
                    isCurrentlyStreaming && "bg-blue-50/30 dark:bg-blue-950/10 rounded-lg p-2"
                  )}
                />
              )
            })}
          </div>
        ))}
        
        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-4">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
            <span>Assistant is responding...</span>
          </div>
        )}
        
        {/* Scroll anchor */}
        <div ref={scrollRef} />
      </div>
    </ScrollArea>
  )
}

// Hook for handling event streaming
export function useEventStream(conversationId?: string) {
  const [events, setEvents] = useState<Event[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingEventId, setStreamingEventId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Load initial events
  useEffect(() => {
    if (!conversationId) return

    const loadEvents = async () => {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/events`)
        if (!response.ok) throw new Error('Failed to load events')
        
        const data = await response.json()
        setEvents(data.events || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load events')
      }
    }

    loadEvents()
  }, [conversationId])

  // Handle real-time updates
  useEffect(() => {
    if (!conversationId) return

    const eventSource = new EventSource(`/api/conversations/${conversationId}/events/stream`)
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        switch (data.type) {
          case 'event_created':
            setEvents(prev => [...prev, data.event])
            break
          case 'event_updated':
            setEvents(prev => prev.map(e => e.id === data.event.id ? data.event : e))
            setStreamingEventId(data.event.id)
            break
          case 'streaming_started':
            setIsStreaming(true)
            setStreamingEventId(data.eventId)
            break
          case 'streaming_stopped':
            setIsStreaming(false)
            setStreamingEventId(null)
            break
          case 'error':
            setError(data.error)
            break
        }
      } catch (err) {
        console.error('Failed to parse event stream data:', err)
      }
    }

    eventSource.onerror = () => {
      setError('Connection to event stream lost')
    }

    return () => {
      eventSource.close()
    }
  }, [conversationId])

  const addEvent = useCallback((event: Event) => {
    setEvents(prev => [...prev, event])
  }, [])

  const updateEvent = useCallback((eventId: string, updatedEvent: Event) => {
    setEvents(prev => prev.map(e => e.id === eventId ? updatedEvent : e))
  }, [])

  const clearEvents = useCallback(() => {
    setEvents([])
    setError(null)
  }, [])

  return {
    events,
    isStreaming,
    streamingEventId,
    error,
    addEvent,
    updateEvent,
    clearEvents
  }
}

export default EventStream