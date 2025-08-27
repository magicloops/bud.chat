// EventStreamBuilder for building events during streaming

import { Event, Segment, Role, ReasoningData } from '@/lib/types/events';
import { ToolCallId, EventId } from '@/lib/types/branded';
// createMixedEvent currently unused

export class EventStreamBuilder {
  private eventId: string;
  private role: Role;
  private segments: Segment[] = [];
  private currentTextSegment: { type: 'text'; text: string } | null = null;
  private pendingToolCalls: Map<string, { id: string; name: string; args: string }> = new Map();
  private ts: number;
  private reasoningData: ReasoningData | null = null;
  private reasoningSegments: Map<string, Segment> = new Map();

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
   * Add or update a reasoning segment by item_id
   */
  upsertReasoningSegment(params: {
    id: string;
    output_index?: number;
    sequence_number?: number;
    parts?: Array<{ summary_index: number; type: 'summary_text'; text: string; sequence_number: number; is_complete: boolean; created_at: number }>;
    combined_text?: string;
    effort_level?: 'low' | 'medium' | 'high';
    reasoning_tokens?: number;
    streaming_part_index?: number | undefined;
  }): void {
    const existing = this.reasoningSegments.get(params.id) as (Segment & { type: 'reasoning' }) | undefined;
    // Merge parts if provided
    let mergedParts: Array<{ summary_index: number; type: 'summary_text'; text: string; sequence_number: number; is_complete: boolean; created_at: number }> = [] as any;
    const incomingParts = (params.parts ?? []) as any[];
    const existingParts = (existing?.parts ?? []) as any[];
    if (existingParts.length > 0) mergedParts = existingParts.map(p => ({ ...p }));
    for (const p of incomingParts) {
      const idx = mergedParts.findIndex(ep => ep.summary_index === p.summary_index);
      if (idx >= 0) mergedParts[idx] = { ...mergedParts[idx], ...p };
      else mergedParts.push(p);
    }

    const next: Segment & { type: 'reasoning' } = {
      type: 'reasoning',
      id: params.id,
      output_index: params.output_index ?? existing?.output_index ?? 0,
      sequence_number: params.sequence_number ?? existing?.sequence_number ?? 0,
      parts: mergedParts,
      combined_text: params.combined_text ?? existing?.combined_text,
      effort_level: params.effort_level ?? existing?.effort_level,
      reasoning_tokens: params.reasoning_tokens ?? existing?.reasoning_tokens,
      streaming: params.streaming_part_index !== undefined,
      streaming_part_index: params.streaming_part_index
    } as any;

    this.reasoningSegments.set(params.id, next);

    // Replace or append in segments array
    const idx = this.segments.findIndex(s => s.type === 'reasoning' && (s as any).id === params.id);
    if (idx >= 0) {
      this.segments[idx] = next;
    } else {
      this.segments.push(next);
    }
  }

  /**
   * Add a tool call to the current event
   */
  addToolCall(
    id: string, 
    name: string, 
    args: object, 
    metadata?: { 
      server_label?: string; 
      display_name?: string; 
      server_type?: string; 
    }
  ): void {
    console.log('🔧 [EVENTBUILDER] Adding tool call segment:', { 
      id, 
      name, 
      args_keys: Object.keys(args),
      metadata
    });
    
    // Remove from pending if it was there
    this.pendingToolCalls.delete(id);
    
    // Add completed tool call segment
    this.segments.push({
      type: 'tool_call',
      id: id as ToolCallId,
      name,
      args,
      ...(metadata?.server_label && { server_label: metadata.server_label }),
      ...(metadata?.display_name && { display_name: metadata.display_name }),
      ...(metadata?.server_type && { server_type: metadata.server_type }),
    });
    
    console.log('🔧 [EVENTBUILDER] ✅ Tool call segment added. Total segments:', this.segments.length);
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
   * Get tool call ID at a specific index (for streaming updates)
   * The index corresponds to Anthropic's content block index, not tool call index
   */
  getToolCallIdAtIndex(index: number): string | null {
    // Count content blocks up to the given index to find the corresponding tool call
    let contentBlockIndex = 0;
    
    // Check segments first (completed content blocks)
    for (const segment of this.segments) {
      if (contentBlockIndex === index) {
        if (segment.type === 'tool_call') {
          return segment.id;
        }
        return null;
      }
      contentBlockIndex++;
    }
    
    // Check pending tool calls (current streaming content blocks)
    const pendingIds = Array.from(this.pendingToolCalls.keys());
    const pendingToolCallIndex = index - contentBlockIndex;
    
    if (pendingToolCallIndex >= 0 && pendingToolCallIndex < pendingIds.length) {
      return pendingIds[pendingToolCallIndex];
    }
    
    return null;
  }

  /**
   * Add a tool result to the current event
   */
  addToolResult(id: string, output: object): void {
    this.segments.push({
      type: 'tool_result',
      id: id as ToolCallId,
      output
    });
  }

  /**
   * Set reasoning data for the current event
   */
  setReasoningData(reasoning: ReasoningData): void {
    this.reasoningData = reasoning;
  }

  /**
   * Get current reasoning data
   */
  getReasoningData(): ReasoningData | null {
    return this.reasoningData;
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
      id: this.eventId as EventId,
      role: this.role,
      segments: this.getCurrentSegments(),
      ts: this.ts,
      ...(this.reasoningData && { reasoning: this.reasoningData })
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
    console.log('🔧 [EVENTBUILDER] Finalizing event. Current segments:', this.segments.length);
    console.log('🔧 [EVENTBUILDER] Segment types:', this.segments.map(s => ({ type: s.type, ...(s.type === 'tool_call' ? { id: s.id, name: s.name } : {}) })));
    
    // Complete any pending tool calls
    for (const [id, _pendingCall] of this.pendingToolCalls.entries()) {
      console.log('🔧 [EVENTBUILDER] Completing pending tool call:', id);
      this.completeToolCall(id);
    }

    // Clean up empty text segments
    this.segments = this.segments.filter(segment => {
      if (segment.type === 'text') {
        return segment.text.trim().length > 0;
      }
      return true;
    });

    // Ensure any reasoning segments tracked are included (already ensured in upsert)

    console.log('🔧 [EVENTBUILDER] After cleanup - Final segments:', this.segments.length);

    return {
      id: this.eventId as EventId,
      role: this.role,
      segments: this.segments,
      ts: this.ts,
      ...(this.reasoningData && { reasoning: this.reasoningData })
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
    this.reasoningData = null;
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
    clone.reasoningData = this.reasoningData ? JSON.parse(JSON.stringify(this.reasoningData)) : null;
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
    for (const [_eventId, builder] of this.builders.entries()) {
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
