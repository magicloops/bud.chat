'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { EventItem } from './EventItem'
import { 
  Event, 
  useConversation, 
  useEventChatStore,
  Conversation
} from '@/state/eventChatStore'
import { cn } from '@/lib/utils'

interface EventListProps {
  // For local state (new conversations)
  events?: Event[]
  conversation?: Conversation | null // For providing optimistic conversation context
  
  // For server state (existing conversations)
  conversationId?: string
  
  className?: string
  autoScroll?: boolean
  isStreaming?: boolean
}

export function EventList({ 
  events,
  conversation: providedConversation,
  conversationId,
  className,
  autoScroll = true,
  isStreaming = false
}: EventListProps) {
  // Get events from store if conversationId provided, otherwise use direct events
  const storeConversation = useConversation(conversationId || '')
  const conversation = providedConversation || storeConversation
  
  const displayEvents = events || conversation?.events || []
  const actualIsStreaming = isStreaming || conversation?.isStreaming || false
  
  // Store action refs - stable references to prevent re-renders
  const setConversationRef = useRef(useEventChatStore.getState().setConversation)
  const addConversationToWorkspaceRef = useRef(useEventChatStore.getState().addConversationToWorkspace)
  const removeConversationFromWorkspaceRef = useRef(useEventChatStore.getState().removeConversationFromWorkspace)
  
  // Update refs when store changes (but this shouldn't cause re-renders)
  useEffect(() => {
    setConversationRef.current = useEventChatStore.getState().setConversation
    addConversationToWorkspaceRef.current = useEventChatStore.getState().addConversationToWorkspace
    removeConversationFromWorkspaceRef.current = useEventChatStore.getState().removeConversationFromWorkspace
  })
  
  // Get specific conversation only when needed to avoid re-renders
  const getCurrentConversation = useCallback(() => {
    if (!conversationId) return null
    return useEventChatStore.getState().conversations[conversationId] || null
  }, [conversationId])
  
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false)
  const lastEventCountRef = useRef(0)

  // Auto-scroll to bottom when new events arrive or content updates
  const scrollToBottom = useCallback((force = false) => {
    if (!autoScroll || (!force && isUserScrollingRef.current)) return
    
    const scrollElement = scrollRef.current
    if (scrollElement) {
      // Use requestAnimationFrame to ensure scroll happens after DOM updates
      requestAnimationFrame(() => {
        if (scrollElement) {
          scrollElement.scrollTop = scrollElement.scrollHeight
        }
      })
    }
  }, [autoScroll])

  // Track user scrolling to prevent auto-scroll when user is reading history
  const handleScroll = useCallback(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) return

    const { scrollTop, scrollHeight, clientHeight } = scrollElement
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100 // Increased threshold for better UX
    
    isUserScrollingRef.current = !isAtBottom
  }, [])

  // Auto-scroll when new events arrive
  useEffect(() => {
    const eventCount = displayEvents.length
    if (eventCount > lastEventCountRef.current) {
      scrollToBottom()
    }
    lastEventCountRef.current = eventCount
  }, [displayEvents.length, scrollToBottom])

  // Auto-scroll on content changes during streaming (immediate, not throttled)
  useEffect(() => {
    if (actualIsStreaming) {
      scrollToBottom()
    }
  }, [displayEvents, actualIsStreaming, scrollToBottom])

  // Force scroll to bottom on initial load
  useEffect(() => {
    if (displayEvents.length > 0) {
      scrollToBottom(true)
    }
  }, [conversationId, scrollToBottom]) // Reset when conversation changes

  const handleEventEdit = useCallback((eventId: string, newContent: string) => {
    // TODO: Implement event editing
    console.log('Edit event:', eventId, newContent)
  }, [])

  const handleEventDelete = useCallback((eventId: string) => {
    // TODO: Implement event deletion
    console.log('Delete event:', eventId)
  }, [])

  const handleEventBranch = useCallback(async (eventId: string) => {
    if (!conversationId) return
    
    // 1. Get current conversation from store
    const currentConversation = getCurrentConversation()
    if (!currentConversation) return
    
    // 2. Find branch point and create truncated event list
    const branchIndex = currentConversation.events.findIndex(e => e.id === eventId)
    if (branchIndex === -1) return
    
    const branchedEvents = currentConversation.events.slice(0, branchIndex + 1)
    
    // 3. Find the corresponding event in the database by position (more reliable than ID)
    const branchEvent = currentConversation.events[branchIndex]
    const branchPosition = branchIndex // 0-based position in conversation
    
    // 4. Create optimistic new conversation
    const tempConversationId = `temp-branch-${Date.now()}`
    const branchedConversation: Conversation = {
      id: tempConversationId,
      events: branchedEvents,
      isStreaming: false,
      meta: {
        id: tempConversationId,
        title: `🌱 ${currentConversation.meta.title || 'Branched Chat'}`,
        workspace_id: currentConversation.meta.workspace_id,
        source_bud_id: currentConversation.meta.source_bud_id,
        created_at: new Date().toISOString()
      }
    }
    
    // 5. Add to store optimistically
    setConversationRef.current(tempConversationId, branchedConversation)
    addConversationToWorkspaceRef.current(currentConversation.meta.workspace_id, tempConversationId)
    
    // 6. Navigate immediately for responsive UX
    router.push(`/chat/${tempConversationId}`)
    
    try {
      // 7. API call to create real conversation using position instead of ID
      const response = await fetch(`/api/conversations/${conversationId}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchPosition: branchPosition,
          branchEvent: {
            role: branchEvent.role,
            // Get text content for identification
            content: branchEvent.segments.filter(s => s.type === 'text').map(s => s.text).join('').substring(0, 100),
            order_key: branchEvent.ts.toString()
          },
          title: branchedConversation.meta.title
        })
      })
      
      if (!response.ok) throw new Error('Branching failed')
      
      const result = await response.json()
      const { branchedConversation: realConvData, insertedEvents } = result
      
      // 8. Replace optimistic conversation with real one
      const realConversation: Conversation = {
        id: realConvData.id,
        events: insertedEvents.map((event: any) => ({
          id: event.id,
          role: event.role,
          segments: event.segments,
          ts: event.ts
        })),
        isStreaming: false,
        meta: {
          id: realConvData.id,
          title: realConvData.title,
          workspace_id: realConvData.workspace_id,
          source_bud_id: realConvData.source_bud_id,
          created_at: realConvData.created_at
        }
      }
      
      // 9. Update store with real conversation
      setConversationRef.current(realConvData.id, realConversation)
      removeConversationFromWorkspaceRef.current(currentConversation.meta.workspace_id, tempConversationId)
      addConversationToWorkspaceRef.current(realConvData.workspace_id, realConvData.id)
      
      // 10. Update URL to real conversation ID
      router.replace(`/chat/${realConvData.id}`)
      
    } catch (error) {
      console.error('Branch creation failed:', error)
      
      // 11. Rollback optimistic updates on error
      removeConversationFromWorkspaceRef.current(currentConversation.meta.workspace_id, tempConversationId)
      // Navigate back to original conversation
      router.replace(`/chat/${conversationId}`)
      
      // TODO: Show error toast notification
    }
  }, [conversationId, getCurrentConversation, router])

  if (displayEvents.length === 0) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">Start a conversation</p>
          <p className="text-sm">Send a message to begin chatting</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={scrollRef}
      className={cn(
        "h-full overflow-y-auto overflow-x-hidden @container",
        className
      )}
      onScroll={handleScroll}
    >
      <div className="space-y-4 p-4 pb-6">
        {displayEvents.map((event, index) => (
          <EventItem
            key={event.id} // Use stable event ID as key
            event={event}
            conversation={conversation}
            index={index}
            isLast={index === displayEvents.length - 1}
            isStreaming={actualIsStreaming && conversation?.streamingEventId === event.id}
            onEdit={handleEventEdit}
            onDelete={handleEventDelete}
            onBranch={handleEventBranch}
            allEvents={displayEvents}
            previousEvent={index > 0 ? displayEvents[index - 1] : undefined}
          />
        ))}
      </div>
    </div>
  )
}

export default EventList