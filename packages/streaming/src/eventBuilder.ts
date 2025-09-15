import { Event, Segment, ReasoningPart, ToolCallId, toEventId } from '@budchat/events';
import { setStreamingMeta } from './eventBuilderRegistry';

export interface EventBuilderOptions {
  placeholderEventId: string;
  baseEvent?: Event;
  onUpdate?: (draft: Event) => void;
  onFinalize?: (finalEvent: Event) => void;
}

export class EventBuilder {
  private draft: Event;
  private hasAnyNonReasoning = false;
  private textBuffer = '';
  private textFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private currentStepIndex: number | null = null;

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

  public hasTextContent(): boolean { return this._hasTextContent; }

  public getStreamingView(): { preText: Segment[]; text: Extract<Segment, { type: 'text' }> | null; postText: Segment[] } {
    const textSeg = (this.draft.segments.find(s => s.type === 'text') as Extract<Segment, { type: 'text' }> | undefined) || null;
    return { preText: [...this._preText], text: textSeg, postText: [...this._postText] };
  }

  constructor(private opts: EventBuilderOptions) {
    const base: Event = opts.baseEvent || { id: toEventId(opts.placeholderEventId), role: 'assistant', segments: [], ts: Date.now() } as Event;
    const clonedSegments = (base.segments || []).map(s => ({ ...(s as any) }));
    this.draft = { ...base, id: toEventId(opts.placeholderEventId), segments: clonedSegments };

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
    if (this.disposed || !text) return;
    this.textBuffer += text;
    if (!this.textFlushTimer) {
      this.textFlushTimer = setTimeout(() => { this.flushTextBuffer(); }, 25);
    }
  }

  private flushTextBuffer() {
    if (this.disposed) { this.textFlushTimer && clearTimeout(this.textFlushTimer); this.textFlushTimer = null; this.textBuffer = ''; return; }
    if (!this.textBuffer) { this.textFlushTimer && clearTimeout(this.textFlushTimer); this.textFlushTimer = null; return; }
    const delta = this.textBuffer; this.textBuffer = ''; this.textFlushTimer && clearTimeout(this.textFlushTimer); this.textFlushTimer = null;
    const idx = this.draft.segments.findIndex(s => s.type === 'text');
    if (idx === -1) {
      this.draft.segments = [...this.draft.segments, { type: 'text', text: delta } as Segment];
      if (delta.trim().length > 0) this._hasTextContent = true;
    } else {
      const current = this.draft.segments[idx] as Extract<Segment, { type: 'text' }>;
      const updated: Extract<Segment, { type: 'text' }> = { ...current, text: (current.text || '') + delta };
      this.draft.segments = [ ...this.draft.segments.slice(0, idx), updated, ...this.draft.segments.slice(idx + 1) ];
      if (delta.trim().length > 0) this._hasTextContent = true;
    }
    this.hasAnyNonReasoning = true;
    this.markReasoningInactive();
    this.emitUpdate();
    this.updateStreamingMeta();
  }

  upsertToolCall(segment: Extract<Segment, { type: 'tool_call' }>) {
    const idx = this.draft.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === (segment as any).id);
    if (idx === -1) {
      this.draft.segments = [...this.draft.segments, segment];
      if (!this._hasTextContent) this._preText.push(segment); else this._postText.push(segment);
    } else {
      const existing = this.draft.segments[idx] as Extract<Segment, { type: 'tool_call' }>;
      const updated = { ...existing, ...segment } as Extract<Segment, { type: 'tool_call' }>;
      this.draft.segments[idx] = updated;
      const upd = updated as unknown as Segment;
      const updBucket = (arr: Segment[]) => { const i = arr.findIndex(s => s.type === 'tool_call' && (s as any).id === (segment as any).id); if (i>=0) arr[i] = upd; };
      updBucket(this._preText); updBucket(this._postText);
    }
    this.emitUpdate();
    this.updateStreamingMeta();
  }


  // Compatibility methods for existing FrontendEventHandler
  startToolCall(id: ToolCallId, name: string) {
    const existingIdx = this.draft.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === id);
    const started_at = Date.now();
    const seg = { type: 'tool_call', id, name, args: {}, started_at } as any as Extract<Segment, { type: 'tool_call' }>;
    if (existingIdx === -1) {
      this.upsertToolCall(seg);
    } else {
      this.upsertToolCall({ ...(this.draft.segments[existingIdx] as any), ...seg });
    }
  }

  finalizeToolArgs(id: ToolCallId, args: object | undefined) {
    const idx = this.draft.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === id);
    const existing = idx >= 0 ? (this.draft.segments[idx] as any) : null;
    const seg = { type: 'tool_call', id, name: existing?.name || 'tool', args: args || existing?.args || {}, started_at: existing?.started_at } as any as Extract<Segment, { type: 'tool_call' }>;
    this.upsertToolCall(seg);
  }
  completeTool(id: ToolCallId, output?: object, error?: string) {
    const idx = this.draft.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === id);
    if (idx >= 0) {
      const seg = this.draft.segments[idx] as Extract<Segment, { type: 'tool_call' }>;
      const updated: Extract<Segment, { type: 'tool_call' }> = { ...seg, completed_at: Date.now() } as any;
      this.draft.segments[idx] = updated;
    }
    const tr = { type: 'tool_result', id, output: output || {}, error, started_at: undefined, completed_at: Date.now() } as any as Segment;
    this.draft.segments.push(tr);
    if (!this._hasTextContent) this._preText.push(tr); else this._postText.push(tr);
    if (this.currentStepIndex === idx) this.currentStepIndex = null;
    this.emitUpdate();
    this.updateStreamingMeta();
  }

  upsertReasoningPart(part: ReasoningPart) {
    const idx = this.draft.segments.findIndex(s => s.type === 'reasoning');
    if (idx === -1) {
      const now = Date.now();
      const newSeg: Extract<Segment, { type: 'reasoning' }> = {
        type: 'reasoning', id: `reasoning-${this.draft.id}`, output_index: 0, sequence_number: part.sequence_number || 0,
        parts: [part], streaming: !this.hasAnyNonReasoning, streaming_part_index: part.summary_index, started_at: now,
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
        const merged: ReasoningPart = { ...prev, text: (prev.text || '') + (part.text || ''), is_complete: part.is_complete ?? prev.is_complete, sequence_number: part.sequence_number ?? prev.sequence_number, created_at: prev.created_at };
        parts[existingIndex] = merged;
      } else {
        parts.push(part);
      }
      parts.sort((a, b) => a.summary_index - b.summary_index);
      const updated: Extract<Segment, { type: 'reasoning' }> = { ...seg, parts, streaming: !this.hasAnyNonReasoning, streaming_part_index: part.summary_index, started_at: (seg as any).started_at || Date.now() } as any;
      this.draft.segments = [ ...this.draft.segments.slice(0, idx), updated, ...this.draft.segments.slice(idx + 1) ];
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
      this.draft.segments = [ ...this.draft.segments.slice(0, idx), updated, ...this.draft.segments.slice(idx + 1) ];
    }
  }

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
    this.flushTextBuffer();
    const result = finalEvent ? finalEvent : this.getDraft();
    this.opts.onFinalize?.(result);
  }

  flush() { this.flushTextBuffer(); }
  dispose() { if (this.textFlushTimer) { clearTimeout(this.textFlushTimer); this.textFlushTimer = null; } this.textBuffer = ''; this.disposed = true; }
}

