import { Event } from '@/state/eventChatStore';
import { Segment, ReasoningPart } from '@/lib/types/events';
import { generateEventId, ToolCallId, toEventId } from '@/lib/types/branded';
import { setStreamingMeta } from './eventBuilderRegistry';

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

  // Streaming-phase helpers (builder-owned)
  private _hasTextContent = false;
  private _preText: Segment[] = [];
  private _postText: Segment[] = [];

  private updateStreamingMeta() {
    try {
      setStreamingMeta(this.draft.id, {
        hasTextContent: this._hasTextContent,
        preText: [...this._preText],
        postText: [...this._postText],
      });
    } catch {}
  }

  public hasTextContent(): boolean {
    return this._hasTextContent;
  }

  public getStreamingView(): { preText: Segment[]; text: Extract<Segment, { type: 'text' }> | null; postText: Segment[] } {
    const textSeg = (this.draft.segments.find(s => s.type === 'text') as Extract<Segment, { type: 'text' }> | undefined) || null;
    return { preText: [...this._preText], text: textSeg, postText: [...this._postText] };
  }

  constructor(private opts: EventBuilderOptions) {
    const base: Event = opts.baseEvent || {
      id: toEventId(opts.placeholderEventId),
      role: 'assistant',
      segments: [],
      ts: Date.now(),
    } as Event;
    // Clone incoming segments defensively (avoid mutating frozen/shared objects)
    const clonedSegments = (base.segments || []).map(s => ({ ...(s as any) }));
    this.draft = { ...base, id: toEventId(opts.placeholderEventId), segments: clonedSegments };
    // no debug logs in production

    // Initialize streaming buckets from existing segments (arrival order approximation)
    let seenTextContent = false;
    for (const seg of this.draft.segments as Segment[]) {
      if (seg.type === 'text') {
        const txt = (seg as any).text || '';
        if (typeof txt === 'string' && txt.trim().length > 0) {
          seenTextContent = true;
          this._hasTextContent = true;
        }
        continue;
      }
      if (!seenTextContent) this._preText.push(seg); else this._postText.push(seg);
    }
    this.updateStreamingMeta();
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
      if (delta.trim().length > 0) this._hasTextContent = true;
    } else {
      const current = this.draft.segments[idx] as Extract<Segment, { type: 'text' }>;
      const updated: Extract<Segment, { type: 'text' }> = { ...current, text: (current.text || '') + delta };
      this.draft.segments = [
        ...this.draft.segments.slice(0, idx),
        updated,
        ...this.draft.segments.slice(idx + 1)
      ];
      if (delta.trim().length > 0) this._hasTextContent = true;
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
    this.updateStreamingMeta();
  }

  startToolCall(id: ToolCallId, name: string) {
    const now = Date.now();
    const idx = this.draft.segments.findIndex(s => s.type === 'tool_call' && s.id === id);
    if (idx === -1) {
      const seg = { type: 'tool_call', id, name, args: {}, started_at: now } as any as Segment;
      this.draft.segments.push(seg);
      if (!this._hasTextContent) this._preText.push(seg); else this._postText.push(seg);
      this.currentStepIndex = this.draft.segments.length - 1;
    } else {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'tool_call' }>;
      const updated: Extract<Segment, { type: 'tool_call' }> = { ...seg, started_at: seg.started_at || now } as any;
      this.draft.segments[idx] = updated;
      // Update in buckets as well
      const upd = updated as unknown as Segment;
      const updBucket = (arr: Segment[]) => {
        const i = arr.findIndex(s => (s as any).id === id && s.type === 'tool_call'); if (i>=0) arr[i] = upd;
      };
      updBucket(this._preText); updBucket(this._postText);
      this.currentStepIndex = idx;
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
    this.updateStreamingMeta();
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
      // Update bucket
      const upd = updated as unknown as Segment;
      const updBucket = (arr: Segment[]) => { const i = arr.findIndex(s => (s as any).id === id && s.type === 'tool_call'); if (i>=0) arr[i] = upd; };
      updBucket(this._preText); updBucket(this._postText);
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
    this.updateStreamingMeta();
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
    const tr = { type: 'tool_result', id, output: output || {}, error, started_at: undefined, completed_at: Date.now() } as any as Segment;
    this.draft.segments.push(tr);
    if (!this._hasTextContent) this._preText.push(tr); else this._postText.push(tr);
    // Clear current step index if this was the current step
    if (this.currentStepIndex === idx) this.currentStepIndex = null;
    this.emitUpdate();
    this.updateStreamingMeta();
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
      if (!this._hasTextContent) this._preText.push(newSeg); else this._postText.push(newSeg);
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
      // Update bucket copy
      const upd = updated as unknown as Segment;
      const updBucket = (arr: Segment[]) => { const i = arr.findIndex(s => s.type === 'reasoning'); if (i>=0) arr[i] = upd; };
      updBucket(this._preText); updBucket(this._postText);
      this.currentStepIndex = idx;
    }
    this.emitUpdate();
    this.updateStreamingMeta();
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
