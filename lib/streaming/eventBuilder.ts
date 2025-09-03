import { Event } from '@/state/eventChatStore';
import { Segment, ReasoningPart } from '@/lib/types/events';
import { generateEventId, ToolCallId } from '@/lib/types/branded';

export interface EventBuilderOptions {
  placeholderEventId: string; // assistant placeholder id
  baseEvent?: Event; // optional seed (role, metadata)
  onUpdate?: (draft: Event) => void;
  onFinalize?: (finalEvent: Event) => void;
}

/**
 * Builds a canonical Event incrementally from streaming updates.
 * Keeps segments ordered; emits updates and finalization callbacks.
 */
export class EventBuilder {
  private draft: Event;
  private hasAnyNonReasoning = false;
  private textBuffer = '';
  private textFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  // Track the index of the current ephemeral step (reasoning/tool), if any
  private currentStepIndex: number | null = null;

  constructor(private opts: EventBuilderOptions) {
    const base: Event = opts.baseEvent || {
      id: opts.placeholderEventId,
      role: 'assistant',
      segments: [],
      ts: Date.now(),
    } as Event;
    // Clone incoming segments defensively (avoid mutating frozen/shared objects)
    const clonedSegments = (base.segments || []).map(s => ({ ...(s as any) }));
    this.draft = { ...base, id: opts.placeholderEventId, segments: clonedSegments };
    // no debug logs in production
  }

  getDraft(): Event { return { ...this.draft, segments: this.draft.segments.map(s => ({ ...(s as any) })) }; }

  private emitUpdate() { this.opts.onUpdate?.(this.getDraft()); }

  appendTextDelta(text: string) {
    if (this.disposed) return;
    if (!text) return;
    // no debug logs
    this.textBuffer += text;
    if (!this.textFlushTimer) {
      this.textFlushTimer = setTimeout(() => {
        this.flushTextBuffer();
      }, 25);
    }
  }

  private flushTextBuffer() {
    if (this.disposed) {
      // Ensure timer is cleared if called after disposal
      this.textFlushTimer && clearTimeout(this.textFlushTimer);
      this.textFlushTimer = null;
      this.textBuffer = '';
      return;
    }
    if (!this.textBuffer) {
      this.textFlushTimer && clearTimeout(this.textFlushTimer);
      this.textFlushTimer = null;
      return;
    }
    const delta = this.textBuffer;
    this.textBuffer = '';
    this.textFlushTimer && clearTimeout(this.textFlushTimer);
    this.textFlushTimer = null;
    // no debug logs
    const idx = this.draft.segments.findIndex(s => s.type === 'text');
    if (idx === -1) {
      this.draft.segments = [...this.draft.segments, { type: 'text', text: delta } as Segment];
    } else {
      const current = this.draft.segments[idx] as Extract<Segment, { type: 'text' }>;
      const updated: Extract<Segment, { type: 'text' }> = { ...current, text: (current.text || '') + delta };
      this.draft.segments = [
        ...this.draft.segments.slice(0, idx),
        updated,
        ...this.draft.segments.slice(idx + 1)
      ];
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
  }

  startToolCall(id: ToolCallId, name: string) {
    const now = Date.now();
    const idx = this.draft.segments.findIndex(s => s.type === 'tool_call' && s.id === id);
    if (idx === -1) {
      this.draft.segments.push({ type: 'tool_call', id, name, args: {}, started_at: now } as any);
      this.currentStepIndex = this.draft.segments.length - 1;
    } else {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'tool_call' }>;
      const updated: Extract<Segment, { type: 'tool_call' }> = { ...seg, started_at: seg.started_at || now } as any;
      this.draft.segments[idx] = updated;
      this.currentStepIndex = idx;
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
  }

  finalizeToolArgs(id: ToolCallId, args: object | undefined) {
    const segIndex = this.draft.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === id);
    if (segIndex >= 0 && args && typeof args === 'object') {
      const seg = this.draft.segments[segIndex] as Extract<Segment, { type: 'tool_call' }>;
      const updated: Extract<Segment, { type: 'tool_call' }> = { ...seg, args };
      this.draft.segments = [
        ...this.draft.segments.slice(0, segIndex),
        updated,
        ...this.draft.segments.slice(segIndex + 1)
      ];
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
  }

  completeTool(id: ToolCallId, output?: object, error?: string) {
    // Mark tool_call completed_at where possible
    const idx = this.draft.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === id);
    if (idx >= 0) {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'tool_call' }>;
      const updated: Extract<Segment, { type: 'tool_call' }> = { ...seg, completed_at: Date.now() } as any;
      this.draft.segments[idx] = updated;
    }
    // Append a tool_result segment for completeness; renderer associates it
    this.draft.segments.push({ type: 'tool_result', id, output: output || {}, error, started_at: undefined, completed_at: Date.now() } as any);
    // Clear current step index if this was the current step
    if (this.currentStepIndex === idx) this.currentStepIndex = null;
    this.emitUpdate();
  }

  upsertReasoningPart(part: ReasoningPart) {
    // Find or create reasoning segment (single segment per event)
    const idx = this.draft.segments.findIndex(s => s.type === 'reasoning');
    if (idx === -1) {
      const now = Date.now();
      const newSeg: Extract<Segment, { type: 'reasoning' }> = {
        type: 'reasoning',
        id: `reasoning-${this.draft.id}`,
        output_index: 0,
        sequence_number: part.sequence_number || 0,
        parts: [part],
        streaming: !this.hasAnyNonReasoning,
        streaming_part_index: part.summary_index,
        started_at: now,
      } as any;
      this.draft.segments = [...this.draft.segments, newSeg];
      this.currentStepIndex = this.draft.segments.length - 1;
    } else {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'reasoning' }>;
      const parts = Array.isArray(seg.parts) ? [...seg.parts] : [];
      const existingIndex = parts.findIndex(p => p.summary_index === part.summary_index);
      if (existingIndex >= 0) {
        const prev = parts[existingIndex];
        const merged: ReasoningPart = {
          ...prev,
          text: (prev.text || '') + (part.text || ''),
          is_complete: part.is_complete ?? prev.is_complete,
          sequence_number: part.sequence_number ?? prev.sequence_number,
          // Preserve original created_at
          created_at: prev.created_at,
        };
        parts[existingIndex] = merged;
      } else {
        parts.push(part);
      }
      parts.sort((a, b) => a.summary_index - b.summary_index);
      const updated: Extract<Segment, { type: 'reasoning' }> = {
        ...seg,
        parts,
        streaming: !this.hasAnyNonReasoning,
        streaming_part_index: part.summary_index,
        started_at: (seg as any).started_at || Date.now(),
      } as any;
      this.draft.segments = [
        ...this.draft.segments.slice(0, idx),
        updated,
        ...this.draft.segments.slice(idx + 1)
      ];
      this.currentStepIndex = idx;
    }
    this.emitUpdate();
  }

  private markReasoningInactive() {
    const idx = this.draft.segments.findIndex(s => s.type === 'reasoning');
    if (idx >= 0) {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'reasoning' }>;
      const updated: Extract<Segment, { type: 'reasoning' }> = { ...seg, streaming: false } as any;
      this.draft.segments = [
        ...this.draft.segments.slice(0, idx),
        updated,
        ...this.draft.segments.slice(idx + 1)
      ];
    }
  }

  // Public method to mark reasoning complete (used by handler-to-builder link via segment events)
  completeReasoning() {
    const idx = this.draft.segments.findIndex(s => s.type === 'reasoning');
    if (idx >= 0) {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'reasoning' }>;
      const updated: Extract<Segment, { type: 'reasoning' }> = { ...seg, streaming: false, completed_at: (seg as any).completed_at || Date.now() } as any;
      this.draft.segments[idx] = updated;
      if (this.currentStepIndex === idx) this.currentStepIndex = null;
      this.emitUpdate();
    }
  }

  finalizeCurrentEvent(finalEvent?: Event) {
    // Ensure any pending text is flushed before finalizing
    this.flushTextBuffer();
    // no debug logs
    const result = finalEvent ? finalEvent : this.getDraft();
    this.opts.onFinalize?.(result);
  }

  // Public helpers for lifecycle control
  flush() {
    this.flushTextBuffer();
  }

  dispose() {
    if (this.textFlushTimer) {
      clearTimeout(this.textFlushTimer);
      this.textFlushTimer = null;
    }
    this.textBuffer = '';
    this.disposed = true;
    // no debug logs
  }
}
