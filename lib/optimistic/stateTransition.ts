import { Event, EventConversation, useEventChatStore } from '@/state/eventChatStore';

export interface StateTransitionOptions {
  debug?: boolean;
  preserveStreamingState?: boolean;
}

export class OptimisticStateManager {
  constructor(private options: StateTransitionOptions = {}) {}

  /**
   * Transfer local events to store without re-renders
   * This is the critical method that ensures seamless /chat/new -> /chat/[id] transitions
   */
  transferToStore(
    conversationId: string,
    localEvents: Event[],
    conversationMeta: {
      title: string;
      workspace_id: string;
      source_bud_id?: string;
      assistant_name?: string;
      assistant_avatar?: string;
    }
  ): void {
    if (this.options.debug) {
      console.log('🔄 Transferring local state to store:', {
        conversationId,
        eventCount: localEvents.length,
        conversationMeta
      });
    }

    const store = useEventChatStore.getState();
    
    // Check if conversation already exists in store (edge case protection)
    const existingConversation = store.conversations[conversationId];
    if (existingConversation) {
      if (this.options.debug) {
        console.warn('⚠️ Conversation already exists in store, merging events');
      }
      
      // Merge local events with existing store events (avoiding duplicates)
      const mergedEvents = this.mergeEventsAvoidingDuplicates(
        existingConversation.events,
        localEvents
      );
      
      store.setConversation(conversationId, {
        ...existingConversation,
        events: mergedEvents
      });
      return;
    }

    // Create new conversation in store with exact structure
    const newConversation: EventConversation = {
      id: conversationId,
      events: [...localEvents], // Clone events to avoid reference issues
      isStreaming: false, // Will be updated if streaming is active
      meta: {
        id: conversationId,
        title: conversationMeta.title,
        workspace_id: conversationMeta.workspace_id,
        source_bud_id: conversationMeta.source_bud_id,
        assistant_name: conversationMeta.assistant_name,
        assistant_avatar: conversationMeta.assistant_avatar,
        created_at: new Date().toISOString()
      }
    };

    // Preserve streaming state if requested
    if (this.options.preserveStreamingState) {
      const lastEvent = localEvents[localEvents.length - 1];
      if (lastEvent && lastEvent.role === 'assistant') {
        newConversation.isStreaming = true;
        newConversation.streamingEventId = lastEvent.id;
      }
    }

    // Atomically update store state
    store.setConversation(conversationId, newConversation);
    
    if (this.options.debug) {
      console.log('✅ Successfully transferred local state to store');
    }
  }

  /**
   * Handle streaming updates during transition period
   * This ensures updates work correctly while the URL transition is happening
   */
  handleTransitionUpdates(
    conversationId: string,
    eventId: string,
    updateFunction: (events: Event[]) => Event[]
  ): void {
    const store = useEventChatStore.getState();
    const conversation = store.conversations[conversationId];
    
    if (!conversation) {
      if (this.options.debug) {
        console.warn('⚠️ Cannot handle transition update - conversation not found in store');
      }
      return;
    }

    // Apply update function to events
    const updatedEvents = updateFunction(conversation.events);
    
    // Update store with new events
    store.setConversation(conversationId, {
      ...conversation,
      events: updatedEvents,
      ts: Date.now()
    });

    if (this.options.debug) {
      console.log('🔄 Applied transition update to store');
    }
  }

  /**
   * Cleanup local state after successful transition
   */
  cleanupLocalState(localStateUpdater: (events: Event[]) => void): void {
    if (this.options.debug) {
      console.log('🧹 Cleaning up local state after transition');
    }
    
    // Clear local state
    localStateUpdater([]);
  }

  /**
   * Merge events while avoiding duplicates (by ID)
   */
  private mergeEventsAvoidingDuplicates(existingEvents: Event[], newEvents: Event[]): Event[] {
    const existingIds = new Set(existingEvents.map(e => e.id));
    const uniqueNewEvents = newEvents.filter(e => !existingIds.has(e.id));
    
    // Sort combined events by timestamp to maintain order
    return [...existingEvents, ...uniqueNewEvents].sort((a, b) => a.ts - b.ts);
  }

  /**
   * Validate event consistency between local and store state
   * Useful for debugging transition issues
   */
  validateEventConsistency(
    localEvents: Event[],
    storeEvents: Event[]
  ): {
    isConsistent: boolean;
    differences: string[];
  } {
    const differences: string[] = [];
    
    // Check event count
    if (localEvents.length !== storeEvents.length) {
      differences.push(`Event count mismatch: local(${localEvents.length}) vs store(${storeEvents.length})`);
    }
    
    // Check event IDs and content
    const minLength = Math.min(localEvents.length, storeEvents.length);
    for (let i = 0; i < minLength; i++) {
      const localEvent = localEvents[i];
      const storeEvent = storeEvents[i];
      
      if (localEvent.id !== storeEvent.id) {
        differences.push(`Event ${i} ID mismatch: local(${localEvent.id}) vs store(${storeEvent.id})`);
      }
      
      if (localEvent.role !== storeEvent.role) {
        differences.push(`Event ${i} role mismatch: local(${localEvent.role}) vs store(${storeEvent.role})`);
      }
      
      // Check segment count
      if (localEvent.segments.length !== storeEvent.segments.length) {
        differences.push(`Event ${i} segment count mismatch: local(${localEvent.segments.length}) vs store(${storeEvent.segments.length})`);
      }
    }
    
    return {
      isConsistent: differences.length === 0,
      differences
    };
  }

  /**
   * Create a conversation ID transition map for tracking URL changes
   * Useful for handling concurrent requests during transitions
   */
  private static transitionMap = new Map<string, string>(); // tempId -> realId
  
  static mapTemporaryToRealId(tempId: string, realId: string): void {
    OptimisticStateManager.transitionMap.set(tempId, realId);
    
    // Cleanup after a short delay to prevent memory leaks
    setTimeout(() => {
      OptimisticStateManager.transitionMap.delete(tempId);
    }, 30000); // 30 second cleanup
  }
  
  static getRealId(tempId: string): string {
    return OptimisticStateManager.transitionMap.get(tempId) || tempId;
  }

  /**
   * Handle error recovery during transitions
   */
  handleTransitionError(
    conversationId: string | null,
    localEvents: Event[],
    error: Error
  ): void {
    if (this.options.debug) {
      console.error('❌ Transition error:', error);
    }

    // If we have a conversation ID, try to preserve state in store
    if (conversationId) {
      const store = useEventChatStore.getState();
      const conversation = store.conversations[conversationId];
      
      if (conversation) {
        // Mark as error state but preserve events
        store.setConversation(conversationId, {
          ...conversation,
          isStreaming: false,
          streamingEventId: undefined,
          // Could add error flag here if needed
        });
      }
    }

    // For local state errors, the calling component should handle cleanup
    // by removing optimistic events or showing error states
  }

  /**
   * Check if a transition is currently in progress
   */
  static isTransitionInProgress(conversationId: string): boolean {
    // Check if this ID is in our transition map
    for (const [tempId, realId] of OptimisticStateManager.transitionMap.entries()) {
      if (realId === conversationId) {
        return true;
      }
    }
    return false;
  }
}