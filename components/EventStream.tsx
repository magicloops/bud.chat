'use client';

import { useState, memo } from 'react';
import { EventList } from '@/components/EventList';
import { EventComposer } from '@/components/EventComposer';
import { Event, useConversation, useEventChatStore, Conversation } from '@/state/eventChatStore';
import { Bud } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getDefaultModel } from '@/lib/modelMapping';
import { createUserEvent, createAssistantPlaceholder } from '@/lib/eventMessageHelpers';
import { useBud } from '@/state/budStore';
import { FrontendEventHandler } from '@/lib/streaming/frontendEventHandler';

interface EventStreamProps {
  // For local state (new conversations)
  events?: Event[]
  isStreaming?: boolean
  onSendMessage?: (content: string) => void | Promise<void>
  placeholder?: string
  budData?: Bud // Bud data for optimistic assistant identity
  cachedConversation?: Conversation // Full conversation for cached data
  
  // For server state (existing conversations) 
  conversationId?: string
  
  className?: string
}

const EventStreamComponent = function EventStream({ 
  events, 
  isStreaming = false,
  cachedConversation: _cachedConversation, 
  onSendMessage,
  placeholder = 'Type your message...',
  budData,
  conversationId,
  className 
}: EventStreamProps) {
  const DEBUG_STREAM = process.env.NEXT_PUBLIC_STREAM_DEBUG === 'true';
  const isNewConversation = !conversationId && events !== undefined;
  const conversation = useConversation(conversationId || '');
  
  
  // Streaming flag for existing conversations (leaf components render tokens)
  const [isLocalStreaming, setIsLocalStreaming] = useState(false);
  
  // Load current bud data if conversation has a source_bud_id
  const currentBudData = useBud(conversation?.meta?.source_bud_id || '');
  
  // Create optimistic conversation for bud identity in new conversations
  const streamingEventId = isNewConversation && events && isStreaming
    ? (() => {
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].role === 'assistant') return events[i].id;
        }
        return undefined;
      })()
    : undefined;

  const localConversation = isNewConversation && events ? {
    id: 'temp',
    events: events || [],
    isStreaming: !!isStreaming,
    streamingEventId: streamingEventId,
    meta: {
      id: 'temp',
      title: 'New Chat',
      workspace_id: 'temp',
      source_bud_id: budData?.id,
      // Don't set assistant name/avatar - let the UI derive from bud config
      created_at: new Date().toISOString()
    }
  } : null;

  // Debug: register a long task PerformanceObserver once per page
  if (typeof window !== 'undefined' && DEBUG_STREAM && !(window as any).__stream_longtask_observer) {
    try {
      (window as any).__stream_longtask_observer = true;
      if ('PerformanceObserver' in window) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obs = new (window as any).PerformanceObserver((list: PerformanceObserverEntryList) => {
          for (const entry of list.getEntries()) {
            // eslint-disable-next-line no-console
            console.log('[STREAM][perf] longtask', { dur: Math.round(entry.duration), ts: Date.now() });
          }
        });
        // @ts-ignore: longtask type
        obs.observe({ type: 'longtask', buffered: true });
      }
    } catch {}
  }
  
  const _handleEventSent = (_eventId: string) => {
    // For server-state conversations, the store handles updates
    // For local-state conversations, the parent component handles updates
  };

  const handleSendMessage = async (content: string) => {
    if (!conversationId || !conversation) return;
    
    // Add optimistic UI updates
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    if (DEBUG_STREAM) {
      console.log('[STREAM][existing] Creating optimistic pair', {
        conversationId,
        userEventId: userEvent.id,
        assistantId: assistantPlaceholder.id,
        prevCount: conversation.events.length,
        nextCount: conversation.events.length + 2,
      });
    }
    
    
    // Add events optimistically to store
    const store = useEventChatStore.getState();
    const updatedConversation = {
      ...conversation,
      events: [...conversation.events, userEvent, assistantPlaceholder],
      isStreaming: true,
      streamingEventId: assistantPlaceholder.id
    };
    
    
    store.setConversation(conversationId, updatedConversation);
    
    // Use unified frontend event handler for existing conversations
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          mode: 'continue',
          conversationId,
          message: content,
          workspaceId: conversation.meta.workspace_id
          // Let the API determine the model from conversation config -> bud config -> default
        })
      });
      
      // Create unified event handler for existing conversations
      // Provide conversationId + store so completed steps persist to the event
      const eventHandler = new FrontendEventHandler(
        conversationId,
        useEventChatStore,
        { debug: true }
      );
      // Provide placeholder so handler can route streaming overlays (tokens still via bus)
      eventHandler.setLocalStateUpdater(() => {}, assistantPlaceholder, { useLocalStreaming: false });
      
      // Streaming flag only; leaf components handle token rendering
      
      // Set streaming flag only; rendering uses leaf streaming component
      setIsLocalStreaming(true);
      
      // No local state updater needed for tokens; FrontendEventHandler routes tokens to streaming bus
      
      // Process streaming response with unified handler
      await eventHandler.processStreamingResponse(response);
      
      // After streaming completes, update store with final events including buffered text
      if (DEBUG_STREAM) {
        console.log('[STREAM][existing] Completing stream', {
          conversationId,
          streamingEventId: assistantPlaceholder.id,
          currentEventCount: conversation.events.length,
        });
      }
      const bus = (await import('@/lib/streaming/streamingBus')).streamingBus;
      const appended = bus.get(assistantPlaceholder.id);
      // Important: read the latest conversation from the store (not the stale closure)
      const latestStore = useEventChatStore.getState();
      const latestConv = latestStore.conversations[conversationId];
      const mergedEvents = latestConv ? [...latestConv.events] : [...conversation.events];
      const idx = mergedEvents.findIndex(e => e.id === assistantPlaceholder.id);
      if (DEBUG_STREAM) {
        console.log('[STREAM][existing] Merge details', {
          assistantId: assistantPlaceholder.id,
          appendedLength: appended?.length || 0,
          foundEventIndex: mergedEvents.findIndex(e => e.id === assistantPlaceholder.id),
        });
      }
      if (idx >= 0) {
        const ev = mergedEvents[idx];
        const segIdx = ev.segments.findIndex(s => s.type === 'text');
        if (DEBUG_STREAM) {
          const prevTextLen = segIdx >= 0 && ev.segments[segIdx].type === 'text' ? (ev.segments[segIdx] as { type: 'text'; text: string }).text.length : -1;
          console.log('[STREAM][existing] Merge indices', { segIdx, prevTextLen });
        }
        if (segIdx >= 0 && ev.segments[segIdx].type === 'text') {
          const seg = ev.segments[segIdx];
          const newSeg = { ...seg, text: (seg.text || '') + appended };
          const newSegments = [...ev.segments];
          newSegments[segIdx] = newSeg;
          mergedEvents[idx] = { ...ev, segments: newSegments };
          if (DEBUG_STREAM) {
            console.log('[STREAM][existing] Merge applied', { newTextLen: (newSeg.text || '').length });
          }
        }
      }

      // After streaming completes, update store with final events
      const finalConv = {
        ...(latestConv || conversation),
        events: mergedEvents,
        isStreaming: false,
        streamingEventId: undefined
      };
      if (DEBUG_STREAM) {
        console.log('[STREAM][existing] Setting conversation with merged events', {
          eventCount: mergedEvents.length,
          lastTwoRoles: mergedEvents.slice(-2).map(e => e.role),
        });
      }
      store.setConversation(conversationId, finalConv);

      // Now clear the buses for this event so overlays disappear after final text is present
      bus.clear(assistantPlaceholder.id);
      bus.clearReasoning(assistantPlaceholder.id);
      
      // Clear local streaming state
      setIsLocalStreaming(false);
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Clear local streaming state on error
      setIsLocalStreaming(false);
      
      // Remove optimistic updates on error
      const errorStore = useEventChatStore.getState();
      const errorConv = errorStore.conversations[conversationId];
      if (errorConv) {
        errorStore.setConversation(conversationId, {
          ...errorConv,
          events: errorConv.events.slice(0, -2), // Remove user + assistant events
          isStreaming: false,
          streamingEventId: undefined
        });
      }
      throw error;
    }
  };

  // No periodic flush; leaf components subscribe to streaming bus

  const title = isNewConversation 
    ? 'New Conversation' 
    : conversation?.meta?.title || 'Chat';
  
  // Get model from conversation -> current bud -> default (same hierarchy as backend)
  const model = conversation?.meta.model_config_overrides?.model ||
                (budData?.default_json && typeof budData.default_json === 'object' && 'model' in budData.default_json ? (budData.default_json as { model?: string }).model : null) ||
                // For existing conversations, use current bud data from store
                (currentBudData?.default_json && typeof currentBudData.default_json === 'object' && 'model' in currentBudData.default_json ? (currentBudData.default_json as { model?: string }).model : null) ||
                getDefaultModel();
  
  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 py-3 relative">
          {/* Left spacer for sidebar toggle button */}
          <div className="w-12"></div>
          
          {/* Centered title and model */}
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
            <h1 className="text-sm font-medium truncate max-w-xs">{title}</h1>
            <span className="text-xs text-muted-foreground whitespace-nowrap">• {typeof model === 'string' ? model : 'Unknown'}</span>
          </div>
          
          {/* Status indicators and space for settings toggle */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground w-12 justify-end">
            {(isStreaming || isLocalStreaming) && (
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs">•••</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Events */}
      <div className="flex-1 min-h-0 h-full overflow-hidden">
        {events ? (
          // Local state - render events directly (new conversations)
          <EventList 
            events={events}
            conversation={localConversation}
            autoScroll={true}
            className="h-full"
            isStreaming={isStreaming}
          />
        ) : conversationId ? (
          // Server state - fetch from store (existing conversations not streaming)
          <EventList 
            conversationId={conversationId}
            autoScroll={true}
            className="h-full"
          />
        ) : (
          // Welcome state
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground max-w-md">
              <h2 className="text-xl font-semibold mb-2">Welcome to bud.chat</h2>
              <p className="mb-4">
                Start a conversation by typing a message below. 
                You can branch conversations at any point to explore different directions.
              </p>
              <div className="text-sm text-muted-foreground/80">
                <p>✨ Type your message and press Enter to begin</p>
                <p>🌿 Branch conversations to explore ideas</p>
                <p>💬 Messages are saved automatically</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex-shrink-0">
        {onSendMessage ? (
          // Local state composer - use EventComposer for consistency
          <EventComposer
            conversation={localConversation || { 
              id: 'temp', 
              events: events || [], 
              isStreaming: false,
              meta: {
                id: 'temp',
                title: 'New Chat',
                workspace_id: 'temp',
                assistant_name: budData?.default_json?.name || 'Assistant',
                assistant_avatar: budData?.default_json?.avatar || '🤖',
                created_at: new Date().toISOString()
              }
            }}
            placeholder={placeholder}
            onSendMessage={onSendMessage}
            disabled={isStreaming}
          />
        ) : conversationId && conversation ? (
          // Server state composer
          <EventComposer
            conversation={conversation}
            placeholder={placeholder}
            onSendMessage={handleSendMessage}
          />
        ) : null}
      </div>
    </div>
  );
};

// Memoize EventStream to prevent unnecessary re-renders
export const EventStream = memo(EventStreamComponent);

export default EventStream;
