// EventStreamBuilder for building events during streaming

import { Event, Segment, Role, createMixedEvent } from '@/lib/types/events';

export class EventStreamBuilder {
  private eventId: string;
  private role: Role;
  private segments: Segment[] = [];
  private currentTextSegment: { type: 'text'; text: string } | null = null;
  private pendingToolCalls: Map<string, { id: string; name: string; args: string }> = new Map();
  private ts: number;

  constructor(role: Role = 'assistant', eventId?: string) {
    this.role = role;
    this.eventId = eventId || crypto.randomUUID();
    this.ts = Date.now();
  }

  /**
   * Add text content to the current event
   */
  addTextChunk(text: string): void {
    if (!text) return;

    // Find or create text segment
    if (!this.currentTextSegment) {
      this.currentTextSegment = { type: 'text', text: '' };
      this.segments.push(this.currentTextSegment);
    }

    this.currentTextSegment.text += text;
  }

  /**
   * Add a tool call to the current event
   */
  addToolCall(id: string, name: string, args: object): void {
    // Remove from pending if it was there
    this.pendingToolCalls.delete(id);
    
    // Add completed tool call segment
    this.segments.push({
      type: 'tool_call',
      id,
      name,
      args
    });
  }

  /**
   * Start a streaming tool call (for gradual argument building)
   */
  startToolCall(id: string, name: string): void {
    this.pendingToolCalls.set(id, { id, name, args: '' });
  }

  /**
   * Add arguments to a streaming tool call
   */
  addToolCallArguments(id: string, argsChunk: string): void {
    const pendingCall = this.pendingToolCalls.get(id);
    if (pendingCall) {
      pendingCall.args += argsChunk;
    }
  }

  /**
   * Complete a streaming tool call
   */
  completeToolCall(id: string): void {
    const pendingCall = this.pendingToolCalls.get(id);
    if (pendingCall) {
      try {
        const args = JSON.parse(pendingCall.args);
        this.addToolCall(id, pendingCall.name, args);
      } catch (e) {
        console.error('Failed to parse tool call arguments:', e);
        this.addToolCall(id, pendingCall.name, {});
      }
      this.pendingToolCalls.delete(id);
    }
  }

  /**
   * Add a tool result to the current event
   */
  addToolResult(id: string, output: object): void {
    this.segments.push({
      type: 'tool_result',
      id,
      output
    });
  }

  /**
   * Get current segments (for real-time updates)
   */
  getCurrentSegments(): Segment[] {
    return [...this.segments];
  }

  /**
   * Get current event state (for real-time updates)
   */
  getCurrentEvent(): Event {
    return {
      id: this.eventId,
      role: this.role,
      segments: this.getCurrentSegments(),
      ts: this.ts
    };
  }

  /**
   * Check if the event has any content
   */
  hasContent(): boolean {
    return this.segments.length > 0 || this.pendingToolCalls.size > 0;
  }

  /**
   * Finalize the event and return it
   */
  finalize(): Event {
    // Complete any pending tool calls
    for (const [id, pendingCall] of this.pendingToolCalls.entries()) {
      this.completeToolCall(id);
    }

    // Clean up empty text segments
    this.segments = this.segments.filter(segment => {
      if (segment.type === 'text') {
        return segment.text.trim().length > 0;
      }
      return true;
    });

    return {
      id: this.eventId,
      role: this.role,
      segments: this.segments,
      ts: this.ts
    };
  }

  /**
   * Reset the builder for a new event
   */
  reset(role: Role = 'assistant', eventId?: string): void {
    this.role = role;
    this.eventId = eventId || crypto.randomUUID();
    this.segments = [];
    this.currentTextSegment = null;
    this.pendingToolCalls.clear();
    this.ts = Date.now();
  }

  /**
   * Clone the builder (for branching scenarios)
   */
  clone(): EventStreamBuilder {
    const clone = new EventStreamBuilder(this.role, this.eventId);
    clone.segments = JSON.parse(JSON.stringify(this.segments));
    clone.currentTextSegment = this.currentTextSegment ? { ...this.currentTextSegment } : null;
    clone.pendingToolCalls = new Map(this.pendingToolCalls);
    clone.ts = this.ts;
    return clone;
  }
}

/**
 * Utility class for managing multiple event builders during streaming
 */
export class StreamingEventManager {
  private builders: Map<string, EventStreamBuilder> = new Map();
  private activeBuilders: string[] = [];

  /**
   * Create a new event builder
   */
  createBuilder(role: Role = 'assistant', eventId?: string): EventStreamBuilder {
    const builder = new EventStreamBuilder(role, eventId);
    this.builders.set(builder.getCurrentEvent().id, builder);
    this.activeBuilders.push(builder.getCurrentEvent().id);
    return builder;
  }

  /**
   * Get a builder by ID
   */
  getBuilder(eventId: string): EventStreamBuilder | undefined {
    return this.builders.get(eventId);
  }

  /**
   * Get the current active builder
   */
  getCurrentBuilder(): EventStreamBuilder | undefined {
    const activeId = this.activeBuilders[this.activeBuilders.length - 1];
    return activeId ? this.builders.get(activeId) : undefined;
  }

  /**
   * Finalize a builder and remove it from active list
   */
  finalizeBuilder(eventId: string): Event | undefined {
    const builder = this.builders.get(eventId);
    if (!builder) return undefined;

    const event = builder.finalize();
    this.builders.delete(eventId);
    this.activeBuilders = this.activeBuilders.filter(id => id !== eventId);
    return event;
  }

  /**
   * Get all current events
   */
  getCurrentEvents(): Event[] {
    return Array.from(this.builders.values()).map(builder => builder.getCurrentEvent());
  }

  /**
   * Finalize all builders
   */
  finalizeAll(): Event[] {
    const events: Event[] = [];
    for (const [eventId, builder] of this.builders.entries()) {
      events.push(builder.finalize());
    }
    this.builders.clear();
    this.activeBuilders = [];
    return events;
  }

  /**
   * Clear all builders
   */
  clear(): void {
    this.builders.clear();
    this.activeBuilders = [];
  }
}