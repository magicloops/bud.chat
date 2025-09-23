'use client';

import { useState, memo } from 'react';
import { EventList } from '@/components/EventList';
import { EventComposer } from '@/components/EventComposer';
import { Event, useConversation, useEventChatStore, Conversation } from '@/state/eventChatStore';
import { Bud } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getDefaultModel } from '@budchat/models';
import { createUserEvent, createAssistantPlaceholder } from '@/lib/eventMessageHelpers';
import { useBud } from '@/state/budStore';
import { FrontendEventHandler } from '@budchat/streaming';
import { useJsonMode } from '@/hooks/useJsonMode';
import { EventJsonMode } from '@/components/EventJsonMode';
import { Button } from '@/components/ui/button';
import { getModelProvider, isReasoningModel } from '@budchat/models';
import type { TargetProvider } from '@/lib/exports';

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
  
  const _handleEventSent = (_eventId: string) => {
    // For server-state conversations, the store handles updates
    // For local-state conversations, the parent component handles updates
  };

  const handleSendMessage = async (content: string) => {
    if (!conversationId || !conversation) return;
    
    // Add optimistic UI updates
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    // debug logs removed
    
    
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
      
      // Create unified event handler for existing conversations - use SAME approach as new conversations
      const eventHandler = new FrontendEventHandler(
        conversationId, // Enable store-backed updates for multi-turn
        useEventChatStore,
        { 
          debug: false,
          onMessageFinal: (finalEvent) => {
            // Guard: ensure assistant role on finalize (streaming is always assistant)
            const safeFinal = finalEvent.role === 'assistant' ? finalEvent : { ...finalEvent, role: 'assistant' as const };
            // Replace in place by id; remove any placeholder with a different id to avoid duplicates
            const storeNow = useEventChatStore.getState();
            const convNow = storeNow.conversations[conversationId];
            if (!convNow) return;
            const filtered = convNow.events.filter(e => e.id !== safeFinal.id && e.id !== convNow.streamingEventId);
            const eventsNow = [...filtered, safeFinal];
            storeNow.setConversation(conversationId, {
              ...convNow,
              events: eventsNow,
              isStreaming: false,
              streamingEventId: undefined
            });
          }
        }
      );
      // Provide a no-op local updater but attach the placeholder for streaming overlays
      // Seed builder with initial assistant placeholder
      const passThroughUpdater = (_updater: (events: Event[]) => Event[]) => { /* builder maintains draft; store commits on final */ };
      eventHandler.setLocalStateUpdater(passThroughUpdater, assistantPlaceholder, { useLocalStreaming: true });
      
      // Streaming flag only; leaf components handle token rendering
      
      // Set streaming flag only; rendering uses leaf streaming component
      setIsLocalStreaming(true);
      
      // No local state updater needed for tokens; FrontendEventHandler routes tokens to streaming bus
      
      // Process streaming response with unified handler
      await eventHandler.processStreamingResponse(response);
      // No merge fallback; onMessageFinal commits the event
      setIsLocalStreaming(false);
      
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

  const [jsonMode, setJsonMode] = useJsonMode();

  const resolvedConversation = events ? localConversation : conversation;
  const provider = getModelProvider(model);
  const targetProvider: TargetProvider = provider === 'anthropic'
    ? 'anthropic-messages'
    : isReasoningModel(model)
      ? 'openai-responses'
      : 'openai-chat';

  const showJsonMode = jsonMode && !!resolvedConversation;
  
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-[120px] justify-end">
            <Button
              variant={jsonMode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setJsonMode(!jsonMode)}
              disabled={!resolvedConversation}
            >
              JSON
            </Button>
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
        {showJsonMode ? (
          <EventJsonMode
            conversation={resolvedConversation!}
            model={model}
            targetProvider={targetProvider}
          />
        ) : events ? (
          <EventList
            events={events}
            conversation={localConversation}
            autoScroll={true}
            className="h-full"
            isStreaming={isStreaming}
          />
        ) : conversationId ? (
          <EventList
            conversationId={conversationId}
            autoScroll={true}
            className="h-full"
          />
        ) : (
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

      {/* Streaming message renders inline within EventList via EventItemSequential */}

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
            disabled={isLocalStreaming || !!conversation.isStreaming}
          />
        ) : null}
      </div>
    </div>
  );
};

// Memoize EventStream to prevent unnecessary re-renders
export const EventStream = memo(EventStreamComponent);

export default EventStream;
