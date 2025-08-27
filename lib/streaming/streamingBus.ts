type Callback = () => void;

class StreamingBus {
  private buffers = new Map<string, string>();
  private subs = new Map<string, Set<Callback>>();
  // Reasoning buffers (legacy, combined text per event)
  private reasoning = new Map<string, string>();
  private reasoningSubs = new Map<string, Set<Callback>>();
  // Reasoning parts per event: eventId -> summary_index -> part state
  private reasoningParts = new Map<string, Map<number, { summary_index: number; text: string; is_complete: boolean; sequence_number?: number; created_at?: number }>>();
  private reasoningPartsSubs = new Map<string, Set<Callback>>();
  // Tool call overlays keyed by assistant event id
  private tools = new Map<string, Map<string, { id: string; name: string; display_name?: string; server_label?: string; status: 'in_progress' | 'finalized' | 'completed' | 'failed'; args?: string; error?: string }>>();
  private toolsSubs = new Map<string, Set<Callback>>();
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

  // Reasoning Parts API (overlay)
  startReasoningPart(eventId: string, summaryIndex: number, meta?: { sequence_number?: number; created_at?: number }) {
    let map = this.reasoningParts.get(eventId);
    if (!map) { map = new Map(); this.reasoningParts.set(eventId, map); }
    if (!map.has(summaryIndex)) {
      map.set(summaryIndex, { summary_index: summaryIndex, text: '', is_complete: false, sequence_number: meta?.sequence_number, created_at: meta?.created_at });
    }
    this.emitReasoningParts(eventId);
  }
  appendReasoningPart(eventId: string, summaryIndex: number, delta: string, meta?: { sequence_number?: number }) {
    let map = this.reasoningParts.get(eventId);
    if (!map) { map = new Map(); this.reasoningParts.set(eventId, map); }
    const prev = map.get(summaryIndex) || { summary_index: summaryIndex, text: '', is_complete: false };
    map.set(summaryIndex, {
      ...prev,
      text: (prev.text || '') + (delta || ''),
      sequence_number: meta?.sequence_number ?? prev.sequence_number,
    });
    this.emitReasoningParts(eventId);
  }
  completeReasoningPart(eventId: string, summaryIndex: number) {
    const map = this.reasoningParts.get(eventId);
    if (!map) return;
    const prev = map.get(summaryIndex);
    if (!prev) return;
    map.set(summaryIndex, { ...prev, is_complete: true });
    this.emitReasoningParts(eventId);
  }
  clearReasoningParts(eventId: string) {
    this.reasoningParts.delete(eventId);
    this.emitReasoningParts(eventId);
  }
  getReasoningParts(eventId: string): Array<{ summary_index: number; text: string; is_complete: boolean; sequence_number?: number; created_at?: number }> {
    const map = this.reasoningParts.get(eventId);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => a.summary_index - b.summary_index);
  }
  subscribeReasoningParts(eventId: string, cb: Callback): () => void {
    let set = this.reasoningPartsSubs.get(eventId);
    if (!set) { set = new Set(); this.reasoningPartsSubs.set(eventId, set); }
    set.add(cb);
    return () => {
      const s = this.reasoningPartsSubs.get(eventId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.reasoningPartsSubs.delete(eventId);
    };
  }
  private emitReasoningParts(eventId: string) {
    const set = this.reasoningPartsSubs.get(eventId);
    if (!set) return;
    set.forEach(fn => fn());
  }

  // Tools overlay API
  startTool(eventId: string, toolId: string, name: string, opts?: { display_name?: string; server_label?: string }) {
    let map = this.tools.get(eventId);
    if (!map) { map = new Map(); this.tools.set(eventId, map); }
    map.set(toolId, { id: toolId, name, display_name: opts?.display_name, server_label: opts?.server_label, status: 'in_progress' });
    this.emitTools(eventId);
  }
  finalizeTool(eventId: string, toolId: string, argsJson?: string) {
    const map = this.tools.get(eventId);
    if (!map) return;
    const entry = map.get(toolId);
    if (!entry) return;
    entry.status = 'finalized';
    if (argsJson) entry.args = argsJson;
    this.emitTools(eventId);
  }
  completeTool(eventId: string, toolId: string, opts?: { error?: string }) {
    const map = this.tools.get(eventId);
    if (!map) return;
    const entry = map.get(toolId);
    if (!entry) return;
    entry.status = opts?.error ? 'failed' : 'completed';
    if (opts?.error) entry.error = opts.error;
    this.emitTools(eventId);
  }
  clearTools(eventId: string) {
    this.tools.delete(eventId);
    this.emitTools(eventId);
  }
  getTools(eventId: string): Array<{ id: string; name: string; display_name?: string; server_label?: string; status: 'in_progress' | 'finalized' | 'completed' | 'failed'; args?: string; error?: string }> {
    const map = this.tools.get(eventId);
    return map ? Array.from(map.values()) : [];
  }
  subscribeTools(eventId: string, cb: Callback): () => void {
    let set = this.toolsSubs.get(eventId);
    if (!set) { set = new Set(); this.toolsSubs.set(eventId, set); }
    set.add(cb);
    return () => {
      const s = this.toolsSubs.get(eventId);
      if (!s) return;
      s.delete(cb);
      if (s.size === 0) this.toolsSubs.delete(eventId);
    };
  }
  private emitTools(eventId: string) {
    const set = this.toolsSubs.get(eventId);
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
