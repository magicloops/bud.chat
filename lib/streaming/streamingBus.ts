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

  append(id: string, delta: string) {
    const prev = this.buffers.get(id) || '';
    this.buffers.set(id, prev + delta);
    this.emit(id);
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
    return () => {
      const s = this.subs.get(id);
      if (!s) return;
      s.delete(cb);
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
    this.emitReasoning(eventId);
  }

  getReasoning(eventId: string): string {
    return this.reasoning.get(eventId) || '';
  }

  clearReasoning(eventId: string) {
    this.reasoning.delete(eventId);
    this.emitReasoning(eventId);
  }

  subscribeReasoning(eventId: string, cb: Callback): () => void {
    let set = this.reasoningSubs.get(eventId);
    if (!set) {
      set = new Set();
      this.reasoningSubs.set(eventId, set);
    }
    set.add(cb);
    return () => {
      const s = this.reasoningSubs.get(eventId);
      if (!s) return;
      s.delete(cb);
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
    return () => {
      const s = this.codeSubs.get(itemId);
      if (!s) return;
      s.delete(cb);
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
