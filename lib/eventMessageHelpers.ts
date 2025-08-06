// Event-based message helpers for optimistic UI
// These maintain compatibility with existing patterns while using events

import { Event, createTextEvent, Segment, ReasoningPart, ResponseMetadata, createReasoningSegment, sortSegmentsBySequence } from '@/lib/types/events';
// createMixedEvent currently unused
import { EventConversation, EventConversationMeta } from '@/state/eventChatStore';
import { BudConfig } from '@/lib/types';

/**
 * Create a greeting event for new conversations
 */
export function createGreetingEvent(): Event {
  return createTextEvent('assistant', 'Hello! How can I help you today?');
}

/**
 * Create system events from a list of system messages
 */
export function createSystemEvents(systemMessages: string[] = []): Event[] {
  return systemMessages.map(message => createTextEvent('system', message));
}

/**
 * Create a user event from content
 */
export function createUserEvent(content: string): Event {
  return createTextEvent('user', content);
}

/**
 * Create an assistant placeholder event for streaming
 */
export function createAssistantPlaceholderEvent(): Event {
  // Don't show any progress indicator initially - let the stream decide
  return createTextEvent('assistant', '');
}

/**
 * Legacy compatibility - alias for createAssistantPlaceholderEvent
 */
export const createAssistantPlaceholder = createAssistantPlaceholderEvent;

/**
 * Update event conversation IDs for database persistence
 */
export function updateEventsConversationId(events: Event[], conversationId: string): Event[] {
  // Events don't have conversation_id in their structure since they're stored separately
  // This is mainly for compatibility with the existing pattern
  return events.map(event => ({
    ...event,
    // Add conversation_id as metadata if needed for debugging
    _conversationId: conversationId
  }));
}

/**
 * Create initial events for a bud configuration
 */
export function createBudInitialEvents(bud: { default_json: BudConfig }): Event[] {
  const events: Event[] = [];
  
  try {
    const budConfig = bud.default_json;
    
    // Add custom greeting if configured
    if (budConfig.greeting) {
      events.push(createTextEvent('assistant', budConfig.greeting));
    } else {
      events.push(createGreetingEvent());
    }
    
    // Add system messages from bud configuration
    if (budConfig.systemPrompt) {
      events.push(createTextEvent('system', budConfig.systemPrompt));
    }
    
    return events;
  } catch (error) {
    console.error('Error creating bud initial events:', error);
    return [createGreetingEvent()];
  }
}

/**
 * Create an event conversation with initial events
 */
export function createEventConversation(
  conversationId: string,
  workspaceId: string,
  budId?: string,
  initialEvents: Event[] = []
): EventConversation {
  const meta: EventConversationMeta = {
    id: conversationId,
    workspace_id: workspaceId,
    source_bud_id: budId,
    created_at: new Date().toISOString()
  };
  
  return {
    id: conversationId,
    events: initialEvents,
    isStreaming: false,
    meta
  };
}

/**
 * Create optimistic event conversation for seamless transition
 * This mirrors the existing createOptimisticConversation pattern
 */
export function createOptimisticEventConversation(
  conversationId: string,
  workspaceId: string,
  events: Event[],
  budId?: string,
  budData?: { default_json: BudConfig }
): EventConversation {
  const budConfig = budData?.default_json;
  
  const meta: EventConversationMeta = {
    id: conversationId,
    workspace_id: workspaceId,
    source_bud_id: budId,
    // Include resolved assistant identity from bud for optimistic display
    assistant_name: budConfig?.name || 'Assistant',
    assistant_avatar: budConfig?.avatar || '🤖',
    model_config_overrides: undefined,
    created_at: new Date().toISOString()
  };
  
  return {
    id: conversationId,
    events: updateEventsConversationId(events, conversationId),
    isStreaming: false,
    meta
  };
}

/**
 * Convert events to a format suitable for streaming API
 */
export function eventsToStreamingFormat(events: Event[]): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  
  for (const event of events) {
    if (event.role === 'system') {
      results.push({
        role: 'system',
        content: event.segments.find(s => s.type === 'text')?.text || ''
      });
    } else if (event.role === 'user') {
      results.push({
        role: 'user', 
        content: event.segments.find(s => s.type === 'text')?.text || ''
      });
    } else if (event.role === 'assistant') {
      const textContent = event.segments
        .filter(s => s.type === 'text')
        .map(s => s.text)
        .join('');
      
      const toolCalls = event.segments
        .filter(s => s.type === 'tool_call')
        .map(s => ({
          id: s.id,
          type: 'function',
          function: {
            name: s.name,
            arguments: JSON.stringify(s.args)
          }
        }));
      
      results.push({
        role: 'assistant',
        content: textContent,
        json_meta: toolCalls.length > 0 ? { tool_calls: toolCalls } : undefined
      });
    }
    // Skip unknown event roles
  }
  
  return results;
}

/**
 * Enhanced streaming event builder for unified segments model
 * Supports reasoning segments, sequence ordering, and response metadata
 */
export class StreamingEventBuilder {
  private event: Event;
  private onUpdate?: (event: Event) => void;
  private responseMetadata: ResponseMetadata = {};
  
  // Legacy compatibility: track pending tool calls for incremental building
  private pendingToolCalls: Map<string, {id: string, name: string, args: string, index: number}> = new Map();
  
  constructor(initialEvent: Event, onUpdate?: (event: Event) => void) {
    this.event = { 
      ...initialEvent,
      response_metadata: initialEvent.response_metadata || {}
    };
    this.responseMetadata = this.event.response_metadata || {};
    this.onUpdate = onUpdate;
  }
  
  addTextChunk(text: string, sequenceNumber?: number) {
    // Find or create text segment
    let textSegment = this.event.segments.find(s => s.type === 'text') as { type: 'text'; text: string } | undefined;
    if (!textSegment) {
      textSegment = { type: 'text', text: '' };
      this.event.segments.push(textSegment);
    }
    
    textSegment.text += text;
    
    // Sort segments if sequence numbers are provided
    if (sequenceNumber !== undefined) {
      this.sortSegments();
    }
    
    this.triggerUpdate();
  }
  
  addToolCall(
    id: string, 
    name: string, 
    args: object, 
    options?: {
      server_label?: string;
      display_name?: string;
      server_type?: string;
      output_index?: number;
      sequence_number?: number;
    }
  ) {
    const toolCallSegment: Segment = {
      type: 'tool_call',
      id,
      name,
      args,
      server_label: options?.server_label,
      display_name: options?.display_name,
      server_type: options?.server_type,
      output_index: options?.output_index,
      sequence_number: options?.sequence_number
    };
    
    this.event.segments.push(toolCallSegment);
    this.sortSegments();
    this.triggerUpdate();
  }
  
  addToolResult(id: string, output: object, error?: string) {
    this.event.segments.push({
      type: 'tool_result',
      id,
      output,
      error
    });
    
    this.triggerUpdate();
  }
  
  addReasoningSegment(
    id: string,
    output_index: number,
    sequence_number: number,
    parts: ReasoningPart[],
    options?: {
      combined_text?: string;
      effort_level?: 'low' | 'medium' | 'high';
      reasoning_tokens?: number;
      streaming?: boolean;
    }
  ) {
    const reasoningSegment = createReasoningSegment(
      id,
      output_index,
      sequence_number,
      parts,
      options
    );
    
    // Check if we already have a reasoning segment with this ID (for updates)
    const existingIndex = this.event.segments.findIndex(
      s => s.type === 'reasoning' && s.id === id
    );
    
    if (existingIndex >= 0) {
      // Update existing reasoning segment
      this.event.segments[existingIndex] = reasoningSegment;
    } else {
      // Add new reasoning segment
      this.event.segments.push(reasoningSegment);
    }
    
    this.sortSegments();
    this.triggerUpdate();
  }
  
  updateResponseMetadata(metadata: Partial<ResponseMetadata>) {
    this.responseMetadata = { ...this.responseMetadata, ...metadata };
    this.event.response_metadata = this.responseMetadata;
    this.triggerUpdate();
  }
  
  private sortSegments() {
    this.event.segments = sortSegmentsBySequence(this.event.segments);
  }
  
  private triggerUpdate() {
    this.event.ts = Date.now(); // Update timestamp
    this.onUpdate?.(this.event);
  }
  
  getSegments(): Segment[] {
    return [...this.event.segments];
  }
  
  getResponseMetadata(): ResponseMetadata {
    return { ...this.responseMetadata };
  }
  
  getCurrentEvent(): Event {
    return { ...this.event };
  }
  
  finalize(): Event {
    // Mark response as complete
    this.responseMetadata.completion_status = 'complete';
    this.event.response_metadata = this.responseMetadata;
    return this.getCurrentEvent();
  }
  
  // =============================================================================
  // LEGACY COMPATIBILITY METHODS
  // These methods provide backward compatibility
  // =============================================================================
  
  /**
   * Start a tool call (legacy compatibility)
   * Used for incremental tool call building
   */
  startToolCall(id: string, name: string): void {
    // Try to determine the index based on current tool calls
    const currentIndex = this.pendingToolCalls.size;
    this.pendingToolCalls.set(id, { id, name, args: '', index: currentIndex });
    
    // Add a placeholder tool call segment to show the tool is starting
    // This will be replaced when the tool call is completed
    const placeholderSegment: Segment = {
      type: 'tool_call',
      id,
      name,
      args: {}, // Empty args initially
      // Add visual indicator that this is still building
      display_name: `${name} (building...)`
    };
    
    this.event.segments.push(placeholderSegment);
    this.triggerUpdate();
  }
  
  /**
   * Start a tool call with explicit index (Anthropic compatibility)
   * Used for Anthropic streaming where content block index matters
   */
  startToolCallWithIndex(id: string, name: string, index: number): void {
    // Store with the actual Anthropic content block index
    this.pendingToolCalls.set(id, { id, name, args: '', index });
    
    // Add a placeholder tool call segment to show the tool is starting
    // This will be replaced when the tool call is completed
    const placeholderSegment: Segment = {
      type: 'tool_call',
      id,
      name,
      args: {}, // Empty args initially
      // Add visual indicator that this is still building
      display_name: `${name} (building...)`
    };
    
    this.event.segments.push(placeholderSegment);
    this.triggerUpdate();
  }
  
  /**
   * Add arguments to a pending tool call (legacy compatibility)
   * Used for streaming tool call arguments
   */
  addToolCallArguments(id: string, args: string): void {
    const pending = this.pendingToolCalls.get(id);
    if (pending) {
      pending.args += args;
      
      // Update the placeholder segment to show progress
      const segmentIndex = this.event.segments.findIndex(
        s => s.type === 'tool_call' && s.id === id
      );
      
      if (segmentIndex >= 0) {
        const segment = this.event.segments[segmentIndex];
        if (segment.type === 'tool_call') {
          // Update display name to show we're receiving arguments
          segment.display_name = `${pending.name} (receiving args...)`;
        }
      }
      
      this.triggerUpdate();
    }
  }
  
  /**
   * Complete a tool call by parsing arguments (legacy compatibility)
   * Used when tool call arguments are fully received
   */
  completeToolCall(id: string): void {
    const pending = this.pendingToolCalls.get(id);
    if (pending) {
      try {
        // Parse the accumulated arguments
        const parsedArgs = pending.args ? JSON.parse(pending.args) : {};
        
        // Find and replace the placeholder segment with the complete tool call
        const segmentIndex = this.event.segments.findIndex(
          s => s.type === 'tool_call' && s.id === id
        );
        
        if (segmentIndex >= 0) {
          // Replace placeholder with complete tool call
          this.event.segments[segmentIndex] = {
            type: 'tool_call',
            id: pending.id,
            name: pending.name,
            args: parsedArgs,
            display_name: pending.name // Remove the "building..." indicator
          };
        } else {
          // If no placeholder exists, add the complete tool call
          this.addToolCall(pending.id, pending.name, parsedArgs);
        }
        
        // Remove from pending
        this.pendingToolCalls.delete(id);
        this.triggerUpdate();
      } catch (error) {
        console.error('Failed to parse tool call arguments:', error);
        console.error('Raw arguments:', pending.args);
        
        // Still complete the tool call with raw args to avoid broken state
        const segmentIndex = this.event.segments.findIndex(
          s => s.type === 'tool_call' && s.id === id
        );
        
        if (segmentIndex >= 0) {
          const segment = this.event.segments[segmentIndex];
          if (segment.type === 'tool_call') {
            segment.args = { _raw: pending.args, _error: 'Failed to parse JSON' };
            segment.display_name = `${pending.name} (parse error)`;
          }
        }
        
        this.pendingToolCalls.delete(id);
        this.triggerUpdate();
      }
    }
  }
  
  /**
   * Get tool call ID by index (legacy compatibility)
   * Used to map streaming events to tool calls
   */
  getToolCallIdAtIndex(index: number): string | null {
    console.log('🔍 [EventBuilder] getToolCallIdAtIndex lookup:', {
      requested_index: index,
      pending_tool_calls: Array.from(this.pendingToolCalls.entries()).map(([id, pending]) => ({
        id,
        stored_index: pending.index,
        name: pending.name
      }))
    });
    
    // First check pending tool calls by index
    for (const [id, pending] of this.pendingToolCalls) {
      if (pending.index === index) {
        console.log('🔍 [EventBuilder] Found tool call by index:', { index, id, name: pending.name });
        return id;
      }
    }
    
    // Fallback: check completed tool calls in segments
    const toolCallSegments = this.event.segments
      .filter(s => s.type === 'tool_call')
      .map(s => s as Extract<Segment, { type: 'tool_call' }>);
    
    const fallbackId = toolCallSegments[index]?.id || null;
    console.log('🔍 [EventBuilder] Fallback lookup result:', { index, fallbackId });
    
    return fallbackId;
  }
  
  /**
   * Check if there are any pending tool calls
   * Useful for debugging and state management
   */
  hasPendingToolCalls(): boolean {
    return this.pendingToolCalls.size > 0;
  }
  
  /**
   * Get pending tool call information
   * Useful for debugging
   */
  getPendingToolCalls(): Array<{id: string, name: string, args: string, index: number}> {
    return Array.from(this.pendingToolCalls.values());
  }
  
  reset(role: 'assistant' | 'user' | 'system' | 'tool'): void {
    // Create a new empty event for the next iteration
    this.event = {
      id: crypto.randomUUID(),
      role,
      segments: role === 'assistant' ? [{ type: 'text', text: '' }] : [],
      ts: Date.now(),
      response_metadata: {}
    };
    this.responseMetadata = {};
    
    // Clear any pending tool calls from previous session
    this.pendingToolCalls.clear();
  }
}

/**
 * Get display content from events (for compatibility with existing UI)
 */
export function getEventDisplayContent(event: Event): string {
  return event.segments
    .filter(s => s.type === 'text')
    .map(s => s.text)
    .join('');
}

/**
 * Check if an event contains tool calls
 */
export function hasToolCalls(event: Event): boolean {
  return event.segments.some(s => s.type === 'tool_call');
}

/**
 * Get tool calls from an event
 */
export function getToolCalls(event: Event): Array<{id: string; name: string; args: object}> {
  return event.segments
    .filter(s => s.type === 'tool_call')
    .map(s => ({
      id: s.id,
      name: s.name,
      args: s.args
    }));
}

/**
 * Get tool results from an event
 */
export function getToolResults(event: Event): Array<{id: string; output: object}> {
  return event.segments
    .filter(s => s.type === 'tool_result')
    .map(s => ({
      id: s.id,
      output: s.output
    }));
}

/**
 * Extract text content from events for title generation
 */
export function extractTextForTitle(events: Event[]): string {
  return events
    .filter(e => e.role !== 'system')
    .slice(0, 4) // Use first few events
    .map(event => {
      const textContent = getEventDisplayContent(event);
      return `${event.role}: ${textContent}`;
    })
    .join('\\n');
}