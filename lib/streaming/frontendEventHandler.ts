import { Event, useEventChatStore, EventConversation } from '@/state/eventChatStore';

export interface StreamEvent {
  type: 'token' | 'tool_start' | 'tool_finalized' | 'tool_result' | 'tool_complete' | 'complete' | 'error';
  content?: string;
  tool_id?: string;
  tool_name?: string;
  args?: object;
  output?: object;
  error?: string;
}

export interface LocalStateUpdater {
  (updater: (events: Event[]) => Event[]): void;
}

export class FrontendEventHandler {
  constructor(
    private conversationId: string | null,
    private storeInstance: typeof useEventChatStore | null,
    private options: {
      debug?: boolean;
    } = {}
  ) {}

  // For local state updates (optimistic flow)
  private localStateUpdater: LocalStateUpdater | null = null;
  private assistantPlaceholder: Event | null = null;

  /**
   * Set local state updater for optimistic flows
   */
  setLocalStateUpdater(updater: LocalStateUpdater, placeholder: Event): void {
    this.localStateUpdater = updater;
    this.assistantPlaceholder = placeholder;
  }

  /**
   * Process streaming response with unified logic for both local and store state
   */
  async processStreamingResponse(response: Response): Promise<void> {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              await this.handleStreamEvent(data);
            } catch (e) {
              if (this.options.debug) {
                console.error('Error parsing stream data:', e);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle a single stream event with unified logic
   */
  async handleStreamEvent(data: StreamEvent): Promise<void> {
    switch (data.type) {
      case 'token':
        await this.handleTokenEvent(data);
        break;
      case 'tool_start':
        await this.handleToolStartEvent(data);
        break;
      case 'tool_finalized':
        await this.handleToolFinalizedEvent(data);
        break;
      case 'tool_result':
        await this.handleToolResultEvent(data);
        break;
      case 'tool_complete':
        await this.handleToolCompleteEvent(data);
        break;
      case 'complete':
        await this.handleCompleteEvent(data);
        break;
      case 'error':
        await this.handleErrorEvent(data);
        break;
    }
  }

  /**
   * Handle token events (text streaming)
   */
  private async handleTokenEvent(data: StreamEvent): Promise<void> {
    if (this.options.debug) {
      console.log('🔄 Received token:', data.content);
    }

    if (this.isLocalState()) {
      // Local state update for optimistic flow
      this.updateLocalStateToken(data);
    } else {
      // Store state update for existing conversations
      this.updateStoreStateToken(data);
    }
  }

  /**
   * Handle tool start events
   */
  private async handleToolStartEvent(data: StreamEvent): Promise<void> {
    if (this.options.debug) {
      console.log('🔧 Tool started:', data.tool_name, data.tool_id);
    }

    if (this.isLocalState()) {
      this.updateLocalStateToolStart(data);
    } else {
      this.updateStoreStateToolStart(data);
    }
  }

  /**
   * Handle tool finalized events
   */
  private async handleToolFinalizedEvent(data: StreamEvent): Promise<void> {
    if (this.options.debug) {
      console.log('🔧 Tool finalized:', data.tool_name, data.tool_id, data.args);
    }

    if (this.isLocalState()) {
      this.updateLocalStateToolFinalized(data);
    } else {
      this.updateStoreStateToolFinalized(data);
    }
  }

  /**
   * Handle tool result events
   */
  private async handleToolResultEvent(data: StreamEvent): Promise<void> {
    if (this.options.debug) {
      console.log('📋 Tool result received:', data.tool_id, data.output);
    }

    if (this.isLocalState()) {
      this.updateLocalStateToolResult(data);
    } else {
      this.updateStoreStateToolResult(data);
    }
  }

  /**
   * Handle tool complete events
   */
  private async handleToolCompleteEvent(data: StreamEvent): Promise<void> {
    if (this.options.debug) {
      console.log('✅ Tool completed:', data.tool_id);
    }

    if (this.isLocalState()) {
      this.updateLocalStateToolComplete(data);
    } else {
      this.updateStoreStateToolComplete(data);
    }
  }

  /**
   * Handle complete events
   */
  private async handleCompleteEvent(data: StreamEvent): Promise<void> {
    if (this.options.debug) {
      console.log('🏁 Stream completed');
    }

    if (this.isLocalState()) {
      this.updateLocalStateComplete(data);
    } else {
      this.updateStoreStateComplete(data);
    }
  }

  /**
   * Handle error events
   */
  private async handleErrorEvent(data: StreamEvent): Promise<void> {
    console.error('❌ Stream error:', data.error);

    if (this.isLocalState()) {
      this.updateLocalStateError(data);
    } else {
      this.updateStoreStateError(data);
    }
  }

  /**
   * Check if we're in local state mode (optimistic flow)
   */
  private isLocalState(): boolean {
    return this.localStateUpdater !== null;
  }

  /**
   * LOCAL STATE UPDATES (for optimistic /chat/new flow)
   */

  private updateLocalStateToken(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.content) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(s => 
                s.type === 'text' ? { ...s, text: s.text + data.content } : s
              ),
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateToolStart(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.tool_name) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: [
                ...event.segments,
                {
                  type: 'tool_call' as const,
                  id: data.tool_id!,
                  name: data.tool_name!,
                  args: {}
                }
              ],
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateToolFinalized(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.args) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => 
                segment.type === 'tool_call' && segment.id === data.tool_id
                  ? { ...segment, args: data.args! }
                  : segment
              ),
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateToolResult(data: StreamEvent): void {
    if (!this.localStateUpdater || !data.tool_id || !data.output) return;

    const toolResultEvent: Event = {
      id: crypto.randomUUID(),
      role: 'tool',
      segments: [{
        type: 'tool_result',
        id: data.tool_id,
        output: data.output
      }],
      ts: Date.now()
    };

    this.localStateUpdater(events => [...events, toolResultEvent]);
  }

  private updateLocalStateToolComplete(data: StreamEvent): void {
    // For local state, we might need to prepare for a new assistant message
    // This is handled by the calling code
  }

  private updateLocalStateComplete(data: StreamEvent): void {
    // Mark streaming as complete in local state
    // This is typically handled by the parent component
  }

  private updateLocalStateError(data: StreamEvent): void {
    // Handle error in local state - typically remove optimistic events
    if (!this.localStateUpdater) return;
    
    this.localStateUpdater(events => {
      // Remove the last 2 events (user + assistant placeholder) on error
      return events.slice(0, -2);
    });
  }

  /**
   * STORE STATE UPDATES (for existing /chat/[id] flow)
   */

  private updateStoreStateToken(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.content) {
      console.log('🚫 Token update skipped:', { hasConversationId: !!this.conversationId, hasStore: !!this.storeInstance, hasContent: !!data.content });
      return;
    }

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) {
      console.log('❌ Conversation not found for token update:', { conversationId: this.conversationId, availableIds: Object.keys(store.conversations) });
      return;
    }
    
    console.log('✅ Updating store token for:', { conversationId: this.conversationId, content: data.content });

    // Use the exact same logic as the original EventStream component
    const placeholderEvent = conversation.events.find(e => e.id === this.assistantPlaceholder?.id);
    
    // Check if we need to create a new assistant event after tool calls
    if (conversation.shouldCreateNewEvent && data.content.trim()) {
      // Create a new assistant event for the final response after tool calls
      const newAssistantEvent: Event = {
        id: crypto.randomUUID(),
        role: 'assistant',
        segments: [{ type: 'text', text: data.content }],
        ts: Date.now()
      };
      
      // Add the new assistant event at the end and update streaming ID
      store.setConversation(this.conversationId, {
        ...conversation,
        events: [...conversation.events, newAssistantEvent],
        streamingEventId: newAssistantEvent.id,
        shouldCreateNewEvent: false
      });
    } else {
      // Update the current streaming event
      const streamingId = conversation.streamingEventId || this.assistantPlaceholder?.id;
      const updatedEvents = conversation.events.map(event => 
        event.id === streamingId 
          ? { 
              ...event, 
              segments: event.segments.map(s => 
                s.type === 'text' ? { ...s, text: s.text + data.content } : s
              ),
              ts: Date.now()
            }
          : event
      );
      
      store.setConversation(this.conversationId, {
        ...conversation,
        events: updatedEvents,
        shouldCreateNewEvent: false
      });
    }
  }

  private updateStoreStateToolStart(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id || !data.tool_name) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    const streamingId = conversation.streamingEventId || this.assistantPlaceholder?.id;
    const updatedEvents = conversation.events.map(event => 
      event.id === streamingId 
        ? { 
            ...event, 
            segments: [
              ...event.segments,
              {
                type: 'tool_call' as const,
                id: data.tool_id!,
                name: data.tool_name!,
                args: {}
              }
            ],
            ts: Date.now()
          }
        : event
    );
    
    store.setConversation(this.conversationId, {
      ...conversation,
      events: updatedEvents
    });
  }

  private updateStoreStateToolFinalized(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id || !data.args) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    const streamingId = conversation.streamingEventId || this.assistantPlaceholder?.id;
    const updatedEvents = conversation.events.map(event => 
      event.id === streamingId 
        ? { 
            ...event, 
            segments: event.segments.map(segment => 
              segment.type === 'tool_call' && segment.id === data.tool_id
                ? { ...segment, args: data.args! }
                : segment
            ),
            ts: Date.now()
          }
        : event
    );
    
    store.setConversation(this.conversationId, {
      ...conversation,
      events: updatedEvents
    });
  }

  private updateStoreStateToolResult(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id || !data.output) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    const toolResultEvent: Event = {
      id: crypto.randomUUID(),
      role: 'tool',
      segments: [{
        type: 'tool_result',
        id: data.tool_id,
        output: data.output
      }],
      ts: Date.now()
    };
    
    store.setConversation(this.conversationId, {
      ...conversation,
      events: [...conversation.events, toolResultEvent]
    });
  }

  private updateStoreStateToolComplete(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    // Mark that we should create a new event on the next token
    store.setConversation(this.conversationId, {
      ...conversation,
      shouldCreateNewEvent: true
    });
  }

  private updateStoreStateComplete(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    store.setConversation(this.conversationId, {
      ...conversation,
      isStreaming: false,
      streamingEventId: undefined
    });
  }

  private updateStoreStateError(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    // Remove optimistic updates on error
    store.setConversation(this.conversationId, {
      ...conversation,
      events: conversation.events.slice(0, -2), // Remove user + assistant events
      isStreaming: false,
      streamingEventId: undefined
    });
  }
}