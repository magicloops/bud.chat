'use client';

import { useState, useCallback } from 'react';
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
  
  // Local streaming state for existing conversations during streaming (similar to new conversations)
  const [localStreamingEvents, setLocalStreamingEvents] = useState<Event[] | null>(null);
  const [isLocalStreaming, setIsLocalStreaming] = useState(false);
  
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
      const response = await fetch(`/api/chat/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: content,  // The existing API expects 'message', not 'content'
          workspaceId: conversation.meta.workspace_id
          // Let the API determine the model from conversation config -> bud config -> default
        })
      });
      
      // Create unified event handler for existing conversations - use SAME approach as new conversations
      const eventHandler = new FrontendEventHandler(
        null, // No store updates during streaming - keep it local
        null,
        { debug: true }
      );
      
      // Track final events for store update on completion
      let finalEvents = [...conversation.events, userEvent, assistantPlaceholder];
      
      // Set local streaming state for real-time display
      setLocalStreamingEvents(finalEvents);
      setIsLocalStreaming(true);
      
      // Set up local state updater to track streaming events locally (NOT in store during streaming)
      eventHandler.setLocalStateUpdater(
        (updater) => {
          // Update local tracking of events (not the store during streaming)
          finalEvents = updater(finalEvents);
          
          // Update local streaming state for real-time UI display
          setLocalStreamingEvents([...finalEvents]);
        },
        assistantPlaceholder
      );
      
      // Process streaming response with unified handler
      await eventHandler.processStreamingResponse(response);
      
      // After streaming completes, update store with final events
      store.setConversation(conversationId, {
        ...conversation,
        events: finalEvents,
        isStreaming: false,
        streamingEventId: undefined
      });
      
      // Clear local streaming state
      setLocalStreamingEvents(null);
      setIsLocalStreaming(false);
    } catch (error) {
      console.error('Error sending message:', error);
      // Clear local streaming state on error
      setLocalStreamingEvents(null);
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
            conversation={optimisticConversation}
            autoScroll={true}
            className="h-full"
            isStreaming={isStreaming}
          />
        ) : localStreamingEvents ? (
          // Local streaming state - render streaming events directly (existing conversations during streaming)
          <EventList 
            events={localStreamingEvents}
            conversation={conversation}
            autoScroll={true}
            className="h-full"
            isStreaming={isLocalStreaming}
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