'use client';

import { EventList } from '@/components/EventList';
import { EventComposer } from '@/components/EventComposer';
import { Event, useConversation, useEventChatStore } from '@/state/eventChatStore';
import { cn } from '@/lib/utils';
import { getDefaultModel } from '@/lib/modelMapping';
import { createUserEvent, createAssistantPlaceholder } from '@/lib/eventMessageHelpers';
import { useBud } from '@/state/budStore';
import { FrontendEventHandler } from '@/lib/streaming/frontendEventHandler';
import { OptimisticStateManager } from '@/lib/optimistic/stateTransition';

interface EventStreamProps {
  // For local state (new conversations)
  events?: Event[]
  isStreaming?: boolean
  onSendMessage?: (content: string) => void | Promise<void>
  placeholder?: string
  budData?: any // Bud data for optimistic assistant identity
  
  // For server state (existing conversations) 
  conversationId?: string
  
  className?: string
}

export function EventStream({ 
  events, 
  isStreaming = false, 
  onSendMessage,
  placeholder = 'Type your message...',
  budData,
  conversationId,
  className 
}: EventStreamProps) {
  const isNewConversation = !conversationId && events !== undefined;
  const conversation = useConversation(conversationId || '');
  
  // Load current bud data if conversation has a source_bud_id
  const currentBudData = useBud(conversation?.meta?.source_bud_id || '');
  
  // Create optimistic conversation for bud identity in new conversations
  const optimisticConversation = isNewConversation && budData ? {
    id: 'temp',
    events: events || [],
    isStreaming: false,
    meta: {
      id: 'temp',
      title: 'New Chat',
      workspace_id: 'temp',
      source_bud_id: budData.id,
      assistant_name: budData.default_json?.name || 'Assistant',
      assistant_avatar: budData.default_json?.avatar || '🤖',
      created_at: new Date().toISOString()
    }
  } : null;
  
  const handleEventSent = (eventId: string) => {
    // For server-state conversations, the store handles updates
    // For local-state conversations, the parent component handles updates
  };

  const handleSendMessage = async (content: string) => {
    if (!conversationId || !conversation) return;
    
    // Add optimistic UI updates
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    
    console.log('🚀 [STREAM] Starting message send', {
      timestamp: Date.now(),
      conversationId: conversationId || 'new',
      localEventCount: conversation?.events.length || 0,
      content: content.substring(0, 50) + (content.length > 50 ? '...' : '')
    });
    
    console.log('🎯 Adding optimistic events:', { 
      userEvent: userEvent.id, 
      assistantPlaceholder: assistantPlaceholder.id,
      currentEvents: conversation.events.length 
    });
    
    // Add events optimistically to store
    const store = useEventChatStore.getState();
    const updatedConversation = {
      ...conversation,
      events: [...conversation.events, userEvent, assistantPlaceholder],
      isStreaming: true,
      streamingEventId: assistantPlaceholder.id
    };
    
    console.log('📝 [STREAM] Updating conversation', {
      timestamp: Date.now(),
      conversationId,
      action: 'setConversation',
      eventCount: updatedConversation.events.length,
      previousEventCount: conversation.events.length
    });
    
    store.setConversation(conversationId, updatedConversation);
    
    // Use unified frontend event handler for existing conversations
    try {
      const response = await fetch(`/api/chat/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: content,  // The existing API expects 'message', not 'content'
          workspaceId: conversation.meta.workspace_id
          // Let the API determine the model from conversation config -> bud config -> default
        })
      });
      
      // Create unified event handler for store state management
      const eventHandler = new FrontendEventHandler(
        conversationId,
        useEventChatStore,
        { debug: true }
      );
      
      // Set assistant placeholder for store updates
      eventHandler.setLocalStateUpdater(
        () => {}, // Not used for store state
        assistantPlaceholder
      );
      
      // Process streaming response with unified handler
      await eventHandler.processStreamingResponse(response);
    } catch (error) {
      console.error('Error sending message:', error);
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

  const title = isNewConversation 
    ? 'New Conversation' 
    : conversation?.meta?.title || 'Chat';
  
  // Get model from conversation -> current bud -> default (same hierarchy as backend)
  const model = conversation?.meta.model_config_overrides?.model ||
                (budData?.default_json as any)?.model ||
                // For existing conversations, use current bud data from store
                (currentBudData?.default_json as any)?.model ||
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
            <span className="text-xs text-muted-foreground whitespace-nowrap">• {model}</span>
          </div>
          
          {/* Status indicators and space for settings toggle */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground w-12 justify-end">
            {isStreaming && (
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
          // Local state - render events directly
          <EventList 
            events={events}
            conversation={optimisticConversation}
            autoScroll={true}
            className="h-full"
            isStreaming={isStreaming}
          />
        ) : conversationId ? (
          // Server state - fetch from store
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
          // Local state composer
          <LocalEventComposer
            onSendMessage={onSendMessage}
            placeholder={placeholder}
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
}

// Simple composer for local state
interface LocalEventComposerProps {
  onSendMessage: (content: string) => void | Promise<void>
  placeholder: string
  disabled?: boolean
}

function LocalEventComposer({ onSendMessage, placeholder, disabled }: LocalEventComposerProps) {
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (disabled) return;
    
    const formData = new FormData(e.currentTarget);
    const content = formData.get('message') as string;
    
    if (!content.trim()) return;
    
    try {
      await onSendMessage(content.trim());
      
      // Clear the form only if successful and form still exists
      if (e.currentTarget) {
        e.currentTarget.reset();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Don't clear form on error so user can retry
    }
  };

  return (
    <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex gap-2">
          <input
            name="message"
            type="text"
            placeholder={placeholder}
            disabled={disabled}
            className="flex-1 px-3 py-2 border border-input bg-background rounded-md text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={disabled}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

export default EventStream;