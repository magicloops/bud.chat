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
    const exists = this.draft.segments.some(s => s.type === 'tool_call' && s.id === id);
    if (!exists) {
      this.draft.segments.push({ type: 'tool_call', id, name, args: {} });
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
    // Append a tool_result segment; renderer will associate it with the tool_call
    this.draft.segments.push({ type: 'tool_result', id, output: output || {}, error });
    this.emitUpdate();
  }

  upsertReasoningPart(part: ReasoningPart) {
    // Find or create reasoning segment (single segment per event)
    const idx = this.draft.segments.findIndex(s => s.type === 'reasoning');
    if (idx === -1) {
      const newSeg: Extract<Segment, { type: 'reasoning' }> = {
        type: 'reasoning',
        id: `reasoning-${this.draft.id}`,
        output_index: 0,
        sequence_number: part.sequence_number || 0,
        parts: [part],
        streaming: !this.hasAnyNonReasoning,
        streaming_part_index: part.summary_index,
      } as any;
      this.draft.segments = [newSeg, ...this.draft.segments];
    } else {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'reasoning' }>;
      const parts = Array.isArray(seg.parts) ? [...seg.parts] : [];
      const existingIndex = parts.findIndex(p => p.summary_index === part.summary_index);
      if (existingIndex >= 0) {
        parts[existingIndex] = part;
      } else {
        parts.push(part);
      }
      parts.sort((a, b) => a.summary_index - b.summary_index);
      const updated: Extract<Segment, { type: 'reasoning' }> = {
        ...seg,
        parts,
        streaming: !this.hasAnyNonReasoning,
        streaming_part_index: part.summary_index,
      } as any;
      this.draft.segments = [
        ...this.draft.segments.slice(0, idx),
        updated,
        ...this.draft.segments.slice(idx + 1)
      ];
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
