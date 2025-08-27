type Callback = () => void;

interface SessionState {
  active: boolean;
  streamId: string | null;
  conversationId: string | null;
  assistantEventId: string | null;
  firstTokenReceived: boolean;
}

import { streamingBus } from '@/lib/streaming/streamingBus';
import type { StreamEvent } from '@/lib/streaming/frontendEventHandler';

class StreamingSessionManager {
  private state: SessionState = {
    active: false,
    streamId: null,
    conversationId: null,
    assistantEventId: null,
    firstTokenReceived: false,
  };
  private subs = new Set<Callback>();

  subscribe(cb: Callback): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  private emit() {
    for (const cb of this.subs) cb();
  }

  getState(): SessionState {
    return this.state;
  }

  start(params: { streamId?: string; conversationId: string; assistantEventId: string }): void {
    this.state = {
      active: true,
      streamId: params.streamId || crypto.randomUUID(),
      conversationId: params.conversationId,
      assistantEventId: params.assistantEventId,
      firstTokenReceived: false,
    };
    this.emit();
  }

  apply(payload: StreamEvent): void {
    if (!this.state.active || !this.state.assistantEventId) return;
    const eventId = this.state.assistantEventId;

    switch (payload.type) {
      case 'token':
      case 'text_token':
        if (payload.content) {
          streamingBus.append(eventId, payload.content);
          if (!this.state.firstTokenReceived) {
            this.state.firstTokenReceived = true;
            this.emit();
          }
        }
        break;
      // Reasoning overlay
      case 'reasoning_summary_part_added': {
        if (typeof payload.summary_index === 'number') {
          streamingBus.startReasoningPart(eventId, payload.summary_index, { sequence_number: payload.sequence_number, created_at: Date.now() });
          const initial = payload.part?.text;
          if (initial) streamingBus.appendReasoningPart(eventId, payload.summary_index, initial, { sequence_number: payload.sequence_number });
        }
        break;
      }
      case 'reasoning_summary_text_delta':
      case 'reasoning_summary_delta': {
        if (typeof payload.summary_index === 'number') {
          const text = typeof payload.delta === 'string' ? payload.delta : payload.delta?.text || '';
          if (text) streamingBus.appendReasoningPart(eventId, payload.summary_index, text, { sequence_number: payload.sequence_number });
        }
        break;
      }
      case 'reasoning_summary_part_done': {
        if (typeof payload.summary_index === 'number') {
          streamingBus.completeReasoningPart(eventId, payload.summary_index);
        }
        break;
      }
      case 'reasoning_summary_done':
      case 'reasoning_complete':
        // no special handling required for overlay
        break;
      // MCP/tool overlays
      case 'tool_start':
        if (payload.tool_id && payload.tool_name) {
          streamingBus.startTool(eventId, payload.tool_id, payload.tool_name, {
            display_name: payload.display_name,
            server_label: payload.server_label,
          });
        }
        break;
      case 'tool_finalized':
        if (payload.tool_id) {
          streamingBus.finalizeTool(eventId, payload.tool_id, payload.arguments || (payload.args ? JSON.stringify(payload.args) : undefined));
        }
        break;
      case 'tool_result':
        // optional: could capture into overlay later
        break;
      case 'tool_complete':
        if (payload.tool_id) {
          streamingBus.completeTool(eventId, payload.tool_id, { error: payload.error });
        }
        break;
      // Built-in tool overlays
      case 'web_search_call_in_progress':
        if (payload.item_id) streamingBus.startTool(eventId, payload.item_id, 'Web Search');
        break;
      case 'web_search_call_completed':
        if (payload.item_id) streamingBus.completeTool(eventId, payload.item_id);
        break;
      case 'code_interpreter_call_in_progress':
        if (payload.item_id) streamingBus.startTool(eventId, payload.item_id, 'Code Interpreter');
        break;
      case 'code_interpreter_call_interpreting':
        // show as running
        break;
      case 'code_interpreter_call_completed':
        if (payload.item_id) streamingBus.completeTool(eventId, payload.item_id);
        break;
      case 'code_interpreter_call_code_delta':
        if (payload.item_id && typeof payload.delta === 'string') {
          streamingBus.appendCode(payload.item_id, payload.delta);
        }
        break;
      case 'code_interpreter_call_code_done':
        if (payload.item_id) streamingBus.setCode(payload.item_id, payload.code || '');
        break;
    }
  }

  complete(): void {
    if (!this.state.active || !this.state.assistantEventId) {
      this.reset();
      return;
    }
    const eventId = this.state.assistantEventId;
    streamingBus.clear(eventId);
    streamingBus.clearReasoning(eventId);
    streamingBus.clearReasoningParts(eventId);
    streamingBus.clearTools(eventId);
    this.reset();
  }

  private reset(): void {
    this.state = {
      active: false,
      streamId: null,
      conversationId: null,
      assistantEventId: null,
      firstTokenReceived: false,
    };
    this.emit();
  }
}

export const streamingSessionManager = new StreamingSessionManager();
