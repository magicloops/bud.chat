type Callback = () => void;

class StreamingBus {
  private buffers = new Map<string, string>();
  private subs = new Map<string, Set<Callback>>();
  // Reasoning buffers keyed by eventId (assistant placeholder id)
  private reasoning = new Map<string, string>();
  private reasoningSubs = new Map<string, Set<Callback>>();
  // Code buffers keyed by tool item_id
  private code = new Map<string, string>();
  private codeSubs = new Map<string, Set<Callback>>();
  private DEBUG = typeof process !== 'undefined' && !!(process as any).env && (process as any).env.NEXT_PUBLIC_STREAM_DEBUG === 'true';
  // Coalesced emit scheduling for text tokens and reasoning overlays
  private pending = new Set<string>();
  private pendingReasoning = new Set<string>();
  private rafId: number | null = null;
  private scheduleEmit() {
    if (this.rafId != null) return;
    const raf = (typeof requestAnimationFrame === 'function')
      ? requestAnimationFrame
      // Fallback in environments without rAF (SSR/tests)
      : ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as typeof requestAnimationFrame);
    this.rafId = raf(() => {
      // Flush text token subscribers
      if (this.pending.size > 0) {
        this.pending.forEach((id) => this.emit(id));
        this.pending.clear();
      }
      // Flush reasoning subscribers
      if (this.pendingReasoning.size > 0) {
        this.pendingReasoning.forEach((id) => this.emitReasoning(id));
        this.pendingReasoning.clear();
      }
      this.rafId = null;
    });
  }

  append(id: string, delta: string) {
    const prev = this.buffers.get(id) || '';
    this.buffers.set(id, prev + delta);
    // Coalesce notifications to ≤ 1 per frame
    this.pending.add(id);
    this.scheduleEmit();
  }

  get(id: string): string {
    return this.buffers.get(id) || '';
  }

  clear(id: string) {
    this.buffers.delete(id);
    this.emit(id);
  }

  subscribe(id: string, cb: Callback): () => void {
    let set = this.subs.get(id);
    if (!set) {
      set = new Set();
      this.subs.set(id, set);
    }
    set.add(cb);
    if (this.DEBUG) {
      console.log('[STREAM][bus] subscribe', { id, subs: set.size });
    }
    return () => {
      const s = this.subs.get(id);
      if (!s) return;
      s.delete(cb);
      if (this.DEBUG) {
        console.log('[STREAM][bus] unsubscribe', { id, subs: s.size });
      }
      if (s.size === 0) this.subs.delete(id);
    };
  }

  private emit(id: string) {
    const set = this.subs.get(id);
    if (!set) return;
    set.forEach(fn => fn());
  }

  // Reasoning API
  appendReasoning(eventId: string, delta: string) {
    const prev = this.reasoning.get(eventId) || '';
    this.reasoning.set(eventId, prev + delta);
    this.pendingReasoning.add(eventId);
    this.scheduleEmit();
  }

  setReasoning(eventId: string, value: string) {
    this.reasoning.set(eventId, value);
    this.pendingReasoning.add(eventId);
    this.scheduleEmit();
  }

  getReasoning(eventId: string): string {
    return this.reasoning.get(eventId) || '';
  }

  clearReasoning(eventId: string) {
    this.reasoning.delete(eventId);
    this.pendingReasoning.add(eventId);
    this.scheduleEmit();
  }

  subscribeReasoning(eventId: string, cb: Callback): () => void {
    let set = this.reasoningSubs.get(eventId);
    if (!set) {
      set = new Set();
      this.reasoningSubs.set(eventId, set);
    }
    set.add(cb);
    if (this.DEBUG) {
      console.log('[STREAM][bus] subscribe_reasoning', { eventId, subs: set.size });
    }
    return () => {
      const s = this.reasoningSubs.get(eventId);
      if (!s) return;
      s.delete(cb);
      if (this.DEBUG) {
        console.log('[STREAM][bus] unsubscribe_reasoning', { eventId, subs: s.size });
      }
      if (s.size === 0) this.reasoningSubs.delete(eventId);
    };
  }

  private emitReasoning(eventId: string) {
    const set = this.reasoningSubs.get(eventId);
    if (!set) return;
    set.forEach(fn => fn());
  }

  // Code API
  appendCode(itemId: string, delta: string) {
    const prev = this.code.get(itemId) || '';
    this.code.set(itemId, prev + delta);
    this.emitCode(itemId);
  }
  setCode(itemId: string, value: string) {
    this.code.set(itemId, value);
    this.emitCode(itemId);
  }
  getCode(itemId: string): string {
    return this.code.get(itemId) || '';
  }
  clearCode(itemId: string) {
    this.code.delete(itemId);
    this.emitCode(itemId);
  }
  subscribeCode(itemId: string, cb: Callback): () => void {
    let set = this.codeSubs.get(itemId);
    if (!set) {
      set = new Set();
      this.codeSubs.set(itemId, set);
    }
    set.add(cb);
    if (this.DEBUG) {
      console.log('[STREAM][bus] subscribe_code', { itemId, subs: set.size });
    }
    return () => {
      const s = this.codeSubs.get(itemId);
      if (!s) return;
      s.delete(cb);
      if (this.DEBUG) {
        console.log('[STREAM][bus] unsubscribe_code', { itemId, subs: s.size });
      }
      if (s.size === 0) this.codeSubs.delete(itemId);
    };
  }
  private emitCode(itemId: string) {
    const set = this.codeSubs.get(itemId);
    if (!set) return;
    set.forEach(fn => fn());
  }
}

export const streamingBus = new StreamingBus();
