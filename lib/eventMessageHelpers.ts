// Event-based message helpers for optimistic UI
// These maintain compatibility with existing patterns while using events

import { Event, createTextEvent } from '@/lib/types/events';
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
 * Create a streaming event builder for real-time updates
 */
export class StreamingEventBuilder {
  private event: Event;
  private onUpdate?: (event: Event) => void;
  
  constructor(initialEvent: Event, onUpdate?: (event: Event) => void) {
    this.event = { ...initialEvent };
    this.onUpdate = onUpdate;
  }
  
  addTextChunk(text: string) {
    // Find or create text segment
    let textSegment = this.event.segments.find(s => s.type === 'text');
    if (!textSegment) {
      textSegment = { type: 'text', text: '' };
      this.event.segments.push(textSegment);
    }
    
    if (textSegment.type === 'text') {
      textSegment.text += text;
    }
    
    this.onUpdate?.(this.event);
  }
  
  addToolCall(id: string, name: string, args: object) {
    this.event.segments.push({
      type: 'tool_call',
      id,
      name,
      args
    });
    
    this.onUpdate?.(this.event);
  }
  
  addToolResult(id: string, output: object) {
    this.event.segments.push({
      type: 'tool_result',
      id,
      output
    });
    
    this.onUpdate?.(this.event);
  }
  
  getCurrentEvent(): Event {
    return { ...this.event };
  }
  
  finalize(): Event {
    return this.getCurrentEvent();
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