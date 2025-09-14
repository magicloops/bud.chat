import { Event, useEventChatStore } from '@/state/eventChatStore';
import { ReasoningData, Segment } from '@budchat/events';
// EventConversation, ReasoningPart currently unused
import { ReasoningEventLogger } from '@/lib/reasoning/eventLogger';
import { ProgressState, ActivityType, ToolCallId } from '@budchat/events';
// Use package client subpath to avoid cycles
import { EventBuilder, setDraft, clearDraft, getDraft, renameDraft, setOverlay, getOverlay } from '@budchat/streaming/client';
// import { getActivityFromEvent, shouldHideProgress, getServerLabelFromEvent } from '@/lib/types/progress'; // Not currently used

export interface StreamEvent {
  type: 'token' | 'text_token' | 'tool_start' | 'tool_arguments_delta' | 'tool_finalized' | 'tool_result' | 'tool_complete' | 'complete' | 'error'
    // MCP event types (remote MCP tools)
    | 'mcp_tool_start' | 'mcp_tool_arguments_delta' | 'mcp_tool_finalized' | 'mcp_tool_complete' 
    | 'mcp_list_tools' | 'mcp_approval_request'
    // New reasoning types
    | 'reasoning_summary_part_added' | 'reasoning_summary_part_done'
    | 'reasoning_summary_text_delta' | 'reasoning_summary_text_done'
    | 'reasoning_summary_delta' | 'reasoning_summary_done'
    // Unified segments reasoning events
    | 'reasoning_start' | 'reasoning_complete'
    // Built-in tool events
    | 'web_search_call_in_progress' | 'web_search_call_searching' | 'web_search_call_completed'
    | 'code_interpreter_call_in_progress' | 'code_interpreter_call_interpreting' | 'code_interpreter_call_completed'
    | 'code_interpreter_call_code_delta' | 'code_interpreter_call_code_done'
    // Progress events
    | 'progress_update' | 'progress_hide'
    // Internal-only event types
    | 'finalize_only' | 'message_final' | 'event_start' | 'event_complete' | 'segment';
  
  // Existing fields
  content?: string;
  tool_id?: string;
  tool_name?: string;
  args?: object;
  output?: object | string | null;
  error?: string;
  event?: Event; // for message_final
  
  // MCP-specific fields
  server_label?: string;
  tools?: unknown[];
  approval_request_id?: string;
  arguments?: string;
  display_name?: string; // Human-readable tool name
  server_type?: string; // Type of MCP server (local_mcp, remote_mcp)
  
  // New reasoning fields
  item_id?: string;
  output_index?: number;
  summary_index?: number;
  part?: {
    type: string;
    text: string;
  };
  delta?: string | { text: string };
  text?: string;
  sequence_number?: number;
  
  // Unified segments reasoning fields
  parts?: Array<{
    summary_index: number;
    type: 'summary_text';
    text: string;
    sequence_number: number;
    is_complete: boolean;
    created_at: number;
  }>;
  combined_text?: string;
  
  // Progress fields
  activity?: ActivityType;
  hideProgress?: boolean;
  
  // Built-in tool fields
  status?: 'in_progress' | 'searching' | 'completed' | 'failed' | 'interpreting';
  code?: string; // For code interpreter streaming code
}

export interface LocalStateUpdater {
  (updater: (events: Event[]) => Event[]): void;
}

export class FrontendEventHandler {
  constructor(
    private conversationId: string | null,
    private storeInstance: typeof useEventChatStore | null,
    private options: {
      debug?: boolean;
      onMessageFinal?: (event: Event) => void;
    } = {}
  ) {}

  // For local state updates (optimistic flow)
  private localStateUpdater: LocalStateUpdater | null = null;
  private assistantPlaceholder: Event | null = null;
  private hasCreatedPostToolPlaceholder: boolean = false;
  private useLocalStreaming: boolean = false;
  // EventBuilder instance to assemble canonical Event during streaming
  private builder: any | null = null;
  // Track whether textual answer has started for current assistant event
  private textStartedForCurrentEvent = false;
  // Track first token logged per event to limit logs
  private firstTokenLoggedFor: Set<string> = new Set();

  // Removed dynamic import helpers; using static imports for determinism
  
  // Reasoning data tracking
  private currentReasoningData: Map<string, ReasoningData> = new Map();
  
  // Progress state management
  private progressState: ProgressState = {
    currentActivity: null,
    isVisible: false
  };

  private isDbg(): boolean {
    // Front-end logs cleaned: only log when the handler is explicitly constructed with debug: true
    return !!this.options.debug;
  }

  private dbg(..._args: any[]) {
    // No-op by default; enable by constructing FrontendEventHandler with debug: true
  }

  private dbgJson(_label: string, _obj: unknown) {
    // No-op by default; enable by constructing FrontendEventHandler with debug: true
  }

  private normalizeOutput(raw: unknown): object | undefined {
    if (raw == null) return undefined;
    if (typeof raw === 'object') return raw as object;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (parsed !== null && (typeof parsed === 'object' || Array.isArray(parsed))) return parsed as object;
      } catch {}
      return { content: raw } as unknown as object;
    }
    return { content: String(raw) } as unknown as object;
  }

  /**
   * Set local state updater for optimistic flows
   */
  setLocalStateUpdater(updater: LocalStateUpdater, placeholder: Event, options?: { useLocalStreaming?: boolean }): void {
    this.localStateUpdater = updater;
    this.assistantPlaceholder = placeholder;
    this.hasCreatedPostToolPlaceholder = false; // Reset flag for new stream
    this.useLocalStreaming = !!options?.useLocalStreaming;
    try {
      this.builder = new EventBuilder({
        placeholderEventId: placeholder.id,
        baseEvent: placeholder,
        onUpdate: (draft: Event) => setDraft(placeholder.id, draft),
        onFinalize: (finalEvent: Event) => {
          clearDraft(placeholder.id);
          if (this.options.onMessageFinal) {
            try { this.options.onMessageFinal(finalEvent); } catch {}
          }
        }
      });
      this.dbg('builder_init', { placeholderId: placeholder.id, segCount: placeholder.segments?.length || 0 });
      this.textStartedForCurrentEvent = false;
      try { setOverlay(placeholder.id, { eventId: placeholder.id, kind: 'idle' }); } catch {}
    } catch (e) {
      if (this.options.debug) console.warn('[STREAM][handler] EventBuilder init failed:', e);
      this.builder = null;
    }
  }

  /**
   * Create a new EventBuilder for a given assistant placeholder
   */
  private createBuilderForPlaceholder(placeholder: Event): void {
    try {
      this.builder = new EventBuilder({
        placeholderEventId: placeholder.id,
        baseEvent: placeholder,
        onUpdate: (draft: Event) => setDraft(placeholder.id, draft),
        onFinalize: (finalEvent: Event) => {
          clearDraft(placeholder.id);
          if (this.options.onMessageFinal) {
            try { this.options.onMessageFinal(finalEvent); } catch {}
          }
        }
      });
      this.textStartedForCurrentEvent = false;
      try { setOverlay(placeholder.id, { eventId: placeholder.id, kind: 'idle' }); } catch {}
    } catch (e) {
      if (this.options.debug) console.warn('[STREAM][handler] EventBuilder init failed:', e);
      this.builder = null;
    }
  }

  /**
   * Handle a new assistant event starting mid-stream (multi-turn)
   */
  private handleEventStart(newEvent: Event): void {
    const serverId = newEvent.id;
    const placeholderId = this.assistantPlaceholder?.id;

    this.dbg('event_start', { serverId, placeholderId, hasBuilder: !!this.builder, role: newEvent.role, convId: this.conversationId });

    // no debug logs
    // First: stop old builder immediately to avoid late flush
    if (this.builder) {
      try { this.builder.flush?.(); } catch {}
      try { this.builder.dispose?.(); } catch {}
    }
    // Rename existing placeholder in store (and keep array size constant)
    if (this.conversationId && this.storeInstance) {
      const store = this.storeInstance.getState();
      const conv = store.conversations[this.conversationId];
      if (conv) {
        const streamingId = conv.streamingEventId;
        let ensuredPlaceholder: Event | null = null;
        if (placeholderId && placeholderId !== serverId && streamingId === placeholderId) {
          // Safe rename only if placeholder matches current streaming id
          const events = conv.events.map(e => e.id === placeholderId ? { ...e, id: serverId } : e);
          store.setConversation(this.conversationId, {
            ...conv,
            events,
            isStreaming: true,
            streamingEventId: serverId,
          });
          this.dbg('rename_placeholder', { from: placeholderId, to: serverId, eventsCount: events.length });
          // Also rename draft immediately to avoid polling gaps
          try { renameDraft(placeholderId, serverId); } catch {}
          // Find the renamed event to seed builder
          ensuredPlaceholder = events.find(e => e.id === serverId) || null;
        } else {
          // No valid placeholder to rename — ensure the new assistant event exists in store
          const alreadyExists = conv.events.some(e => e.id === serverId);
          if (!alreadyExists) {
            const seeded: Event = { ...newEvent, segments: (newEvent.segments || []).filter(s => s.type !== 'text') } as Event;
            const events = [...conv.events, seeded];
            store.setConversation(this.conversationId, {
              ...conv,
              events,
              isStreaming: true,
              streamingEventId: serverId,
            });
            this.dbg('insert_new_streaming_event', { eventId: serverId, eventsCount: events.length });
            ensuredPlaceholder = seeded;
          } else {
            // Update streaming flags if event is already present
            store.setConversation(this.conversationId, {
              ...conv,
              isStreaming: true,
              streamingEventId: serverId,
            });
            ensuredPlaceholder = conv.events.find(e => e.id === serverId) || null;
          }
        }
        // Use ensured placeholder for builder seeding below if present
        if (ensuredPlaceholder) {
          this.assistantPlaceholder = ensuredPlaceholder;
        }
      }
    }
    // Recreate builder bound to the server id, preserving current draft text/segments
    try {
      // Prefer draft from registry after rename (may be fresher than disposed builder)
      const baseFromStore = this.assistantPlaceholder && this.assistantPlaceholder.id === serverId ? this.assistantPlaceholder : null;
      const base: Event = baseFromStore
        ? baseFromStore
        : { ...newEvent, segments: (newEvent.segments || []).filter(s => s.type !== 'text') } as Event;
      this.assistantPlaceholder = base;
      this.createBuilderForPlaceholder(base);
      this.dbg('builder_created', { eventId: base.id, seedSegments: base.segments?.length || 0 });
      // Attempt reseed from existing draft if any (synchronous lookup)
      try {
        const prevDraft = getDraft(serverId);
        if (prevDraft) {
          const reseed = { ...prevDraft, id: serverId } as Event;
          this.assistantPlaceholder = reseed;
          this.createBuilderForPlaceholder(reseed);
          this.dbg('builder_reseeded_from_draft', { eventId: reseed.id });
        }
      } catch {}
    } catch {
      // Fallback: just switch placeholder id
      if (this.assistantPlaceholder) this.assistantPlaceholder = { ...this.assistantPlaceholder, id: serverId } as Event;
    }
  }

  /**
   * Process streaming response with unified logic for both local and store state
   */
  async processStreamingResponse(response: Response): Promise<void> {
    const streaming = await import('@budchat/streaming/client');
    await streaming.processSSE(response, {
      onAny: async (data: any) => {
        const t = (data && (data as any).type) || 'unknown';
        if (
          t === 'reasoning_start' ||
          t === 'reasoning_summary_part_added' ||
          t === 'reasoning_summary_text_delta' ||
          t === 'reasoning_summary_delta' ||
          t === 'reasoning_summary_part_done' ||
          t === 'reasoning_complete'
        ) {
          this.dbgJson('sse_in_full', data);
        } else if (t === 'segment') {
          try {
            const seg = (data as any).segment || (data as any).data?.segment;
            if (seg && seg.type === 'reasoning') {
              this.dbgJson('sse_in_reasoning_segment', data);
            }
          } catch {}
        } else if (t !== 'token') {
          this.dbg('sse_in', { type: t, keys: Object.keys(data || {}) });
        }
        await this.handleStreamEvent(data as any);
      },
    });
  }

  /**
   * Handle a single stream event with unified logic
   */
  async handleStreamEvent(data: StreamEvent): Promise<void> {
    switch (data.type) {
      case 'event_start': {
        const ev = (data as any).event || (data as any).data?.event;
        if (ev) this.handleEventStart(ev as Event);
        break;
      }
      case 'segment': {
        const seg = (data as any).segment || (data as any).data?.segment;
        if (!seg || !this.builder) break;
        // omit verbose segment_text logging to reduce noise
        if (seg.type === 'tool_call') {
          this.dbg('segment_tool_call', { id: seg.id, name: seg.name, hasArgs: !!(seg.args && Object.keys(seg.args).length) });
          if (seg.id && seg.name && (!seg.args || Object.keys(seg.args).length === 0)) {
            this.builder.startToolCall(seg.id, seg.name);
          }
          if (seg.id && seg.args && Object.keys(seg.args).length > 0) {
            this.builder.finalizeToolArgs(seg.id, seg.args);
          }
        } else if (seg.type === 'tool_result') {
          this.dbg('segment_tool_result', { id: seg.id, hasOutput: !!seg.output });
          this.builder.completeTool(seg.id, seg.output, seg.error);
        } else if (seg.type === 'reasoning') {
          if (Array.isArray(seg.parts)) {
            for (const p of seg.parts) {
              this.builder.upsertReasoningPart({
                summary_index: p.summary_index,
                type: 'summary_text',
                text: p.text,
                sequence_number: p.sequence_number || seg.sequence_number || 0,
                is_complete: !!p.is_complete,
                created_at: p.created_at || Date.now(),
              });
            }
            // Debug current draft reasoning length
            try {
              const draft = this.builder.getDraft?.();
              const reasoning = draft?.segments.find((s: any) => s.type === 'reasoning');
              const partsDbg = Array.isArray((reasoning as any)?.parts)
                ? (reasoning as any).parts.map((p: any) => ({ summary_index: p.summary_index, is_complete: !!p.is_complete, len: (p.text || '').length }))
                : [];
              this.dbg('reasoning_update_from_segment', { eventId: draft?.id, parts: partsDbg });
            } catch {}
          }
        }
        break;
      }
      case 'event_complete': {
        // Commit the current draft to store immediately (multi-turn streaming support)
        this.dbg('event_complete_begin', { hasBuilder: !!this.builder });
        if (this.builder) {
          let draft: Event | undefined = undefined;
          try { draft = this.builder.getDraft?.(); } catch {}
          try { this.builder.flush?.(); } catch {}
          try { this.builder.dispose?.(); } catch {}
          if (draft && this.conversationId && this.storeInstance) {
            const store = this.storeInstance.getState();
            const conv = store.conversations[this.conversationId];
            if (conv) {
              const filtered = conv.events.filter(e => e.id != draft!.id);
              const events = [...filtered, draft];
              store.setConversation(this.conversationId, {
                ...conv,
                events,
                isStreaming: true,
                // streamingEventId will be updated on next event_start
              });
              this.dbg('event_complete_committed', { eventId: draft.id, eventsCount: events.length });
            }
          }
          // Clear local placeholder; next event_start will set new builder/placeholder
          this.assistantPlaceholder = null;
          this.builder = null;
        }
        break;
      }
      case 'token':
        // Log only the first token per event
        try {
          const id = this.assistantPlaceholder?.id;
          if (id && !this.firstTokenLoggedFor.has(id)) {
            this.dbg('first_token', { where: 'first_token', eventId: id });
            this.firstTokenLoggedFor.add(id);
          }
        } catch {}
        await this.handleTokenEvent(data);
        // Hide progress when text content starts
        if (data.hideProgress) {
          this.updateProgressState(null, false);
        }
        break;
      case 'reasoning_summary_part_added':
        this.dbgJson('reasoning_part_added', data);
        await this.handleReasoningSummaryPartAdded(data);
        break;
      case 'reasoning_summary_text_delta':
      case 'reasoning_summary_delta':
        this.dbgJson('reasoning_text_delta', data);
        await this.handleReasoningSummaryTextDelta(data);
        break;
      case 'reasoning_summary_part_done':
        this.dbgJson('reasoning_part_done', data);
        await this.handleReasoningSummaryPartDone(data);
        break;
      case 'tool_start':
        this.dbg('tool_start', { id: data.tool_id, name: data.tool_name });
        await this.handleToolStartEvent(data);
        // Hide progress when tool starts
        if (data.hideProgress) {
          this.updateProgressState(null, false);
        }
        break;
      case 'tool_finalized':
        this.dbg('tool_finalized', { id: data.tool_id });
        await this.handleToolFinalizedEvent(data);
        break;
      case 'tool_result':
        this.dbg('tool_result', { id: data.tool_id, hasOutput: !!data.output, error: !!data.error });
        await this.handleToolResultEvent(data);
        break;
      case 'tool_complete':
        this.dbg('tool_complete', { id: data.tool_id });
        await this.handleToolCompleteEvent(data);
        break;
      case 'reasoning_summary_part_added':
        await this.handleReasoningSummaryPartAdded(data);
        break;
      case 'reasoning_summary_part_done':
        await this.handleReasoningSummaryPartDone(data);
        break;
      case 'reasoning_summary_text_delta':
        await this.handleReasoningSummaryTextDelta(data);
        break;
      case 'reasoning_summary_text_done':
        // Text done events might not need special handling beyond logging
        await this.logReasoningEvent(data);
        break;
      case 'reasoning_summary_delta':
        // Handle general reasoning summary deltas (similar to text delta)
        await this.handleReasoningSummaryTextDelta(data);
        break;
      case 'reasoning_summary_done':
        await this.handleReasoningSummaryDone(data);
        break;
      case 'reasoning_complete':
        await this.handleReasoningComplete(data);
        // Also mark complete in builder to set completed_at (ephemeral steps)
        try { this.builder?.completeReasoning?.(); } catch {}
        break;
      case 'reasoning_start':
        await this.handleReasoningStart(data);
        break;
      // MCP event handlers
      case 'mcp_tool_start':
        await this.handleMCPToolStartEvent(data);
        break;
      case 'mcp_tool_arguments_delta':
        await this.handleMCPToolArgumentsDeltaEvent(data);
        break;
      case 'mcp_tool_finalized':
        await this.handleMCPToolFinalizedEvent(data);
        break;
      case 'mcp_tool_complete':
        await this.handleMCPToolCompleteEvent(data);
        break;
      case 'mcp_list_tools':
        await this.handleMCPListToolsEvent(data);
        break;
      case 'mcp_approval_request':
        await this.handleMCPApprovalRequestEvent(data);
        break;
      case 'complete':
        this.dbg('complete');
        await this.handleCompleteEvent(data);
        break;
      case 'message_final': {
        // Final, canonical assistant event from server
        try {
          const ev: any = (data as any).event;
          const segTypes = Array.isArray(ev?.segments) ? ev.segments.map((s: any) => s.type) : [];
          this.dbg('message_final', { where: 'message_final', id: ev?.id, role: ev?.role, segTypes, hasBuilder: !!this.builder });
        } catch {
          this.dbg('message_final', { id: (data.event as any)?.id, hasBuilder: !!this.builder });
        }
        // Copy ephemeral step timings from draft into final event (so durations are preserved)
        try {
          const finalEv: any = (data as any).event;
          const draft = this.builder?.getDraft?.();
          if (finalEv && draft && Array.isArray(finalEv.segments) && Array.isArray(draft.segments)) {
            finalEv.segments = finalEv.segments.map((seg: any) => {
              if (seg.type === 'reasoning') {
                const d = draft.segments.find((s: any) => s.type === 'reasoning' && s.id === seg.id);
                return d ? { ...seg, started_at: d.started_at ?? seg.started_at, completed_at: d.completed_at ?? seg.completed_at } : seg;
              }
              if (seg.type === 'tool_call') {
                const d = draft.segments.find((s: any) => s.type === 'tool_call' && s.id === seg.id);
                return d ? { ...seg, started_at: d.started_at ?? seg.started_at, completed_at: d.completed_at ?? seg.completed_at } : seg;
              }
              if (seg.type === 'web_search_call' || seg.type === 'code_interpreter_call') {
                const d = draft.segments.find((s: any) => s.type === seg.type && s.id === seg.id);
                return d ? { ...seg, started_at: d.started_at ?? seg.started_at, completed_at: d.completed_at ?? seg.completed_at } : seg;
              }
              return seg;
            });
          }
        } catch {}
        // Ensure any in-progress reasoning is marked complete in the draft
        try { this.builder?.completeReasoning?.(); } catch {}
        if (data.event) {
          if (this.builder) {
            this.builder.finalizeCurrentEvent(data.event as Event);
          } else if (this.options.onMessageFinal) {
            try { this.options.onMessageFinal(data.event as Event); } catch (e) {
              if (this.options.debug) console.error('onMessageFinal error:', e);
            }
          }
          // Clear overlay for this event id
          const finalId = (data.event as any).id;
          if (finalId) {
            try { setOverlay(finalId, null); } catch {}
          }
        }
        break;
      }
      case 'error':
        await this.handleErrorEvent(data);
        break;
      case 'progress_update':
        await this.handleProgressUpdate(data);
        break;
      case 'progress_hide':
        await this.handleProgressHide(data);
        break;
      // Built-in tool event handlers
      case 'web_search_call_in_progress':
        await this.handleWebSearchInProgress(data);
        break;
      case 'web_search_call_searching':
        await this.handleWebSearchSearching(data);
        break;
      case 'web_search_call_completed':
        await this.handleWebSearchCompleted(data);
        break;
      case 'code_interpreter_call_in_progress':
        await this.handleCodeInterpreterInProgress(data);
        break;
      case 'code_interpreter_call_interpreting':
        await this.handleCodeInterpreterInterpreting(data);
        break;
      case 'code_interpreter_call_completed':
        await this.handleCodeInterpreterCompleted(data);
        break;
      case 'code_interpreter_call_code_delta':
        await this.handleCodeInterpreterCodeDelta(data);
        break;
      case 'code_interpreter_call_code_done':
        await this.handleCodeInterpreterCodeDone(data);
        break;
    }
  }

  /**
   * Handle token events (text streaming)
   */
  private async handleTokenEvent(data: StreamEvent): Promise<void> {
    if (!this.assistantPlaceholder || !data.content) return;

    // no debug logs
    if (this.builder) this.builder.appendTextDelta(data.content);
    // Hide overlay once textual answer begins
    try { setOverlay(this.assistantPlaceholder.id, null); } catch {}
  }

  /**
   * Handle tool start events
   */
  private async handleToolStartEvent(data: StreamEvent): Promise<void> {
    if (!this.assistantPlaceholder || !data.tool_id || !data.tool_name) return;
    if (this.options.debug) {
      console.log('[STREAM][handler] tool_start', { eventId: this.assistantPlaceholder.id, tool_id: data.tool_id, name: data.tool_name });
    }
    if (this.builder) this.builder.startToolCall(data.tool_id as ToolCallId, data.tool_name);
    // UI reads tools from EventBuilder draft
    // Overlay: show tool activity only if text has not started
    if (!this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'tool', tool: { id: String(data.tool_id), name: data.tool_name, status: 'in_progress', updatedAt: Date.now() } }); } catch {}
    }
  }

  /**
   * Handle tool finalized events
   */
  private async handleToolFinalizedEvent(data: StreamEvent): Promise<void> {
    if (!this.assistantPlaceholder || !data.tool_id) return;
    if (this.options.debug) {
      console.log('[STREAM][handler] tool_finalized', { eventId: this.assistantPlaceholder.id, tool_id: data.tool_id });
    }
    if (this.builder) {
      let parsedArgs: object | undefined;
      try {
        parsedArgs = data.args || (data.arguments ? JSON.parse(String(data.arguments)) : undefined);
      } catch {}
      this.builder.finalizeToolArgs(data.tool_id as ToolCallId, parsedArgs);
    }
    // UI reads tools from EventBuilder draft
  }

  /**
   * Handle tool result events
   */
  private async handleToolResultEvent(_data: StreamEvent): Promise<void> {
    // Upsert a transient tool-result event in store so ToolCallSegment can resolve it via allEvents
    const data = _data;
    if (!data.tool_id) return;

    const output = this.normalizeOutput(data.output as unknown);
    const err = data.error == null ? undefined : data.error; // normalize null → undefined

    if (this.conversationId && this.storeInstance) {
      const store = this.storeInstance.getState();
      const conv = store.conversations[this.conversationId];
      if (conv) {
        const syntheticId = `tool-result:${String(data.tool_id)}`;
        const toolEvent = {
          id: syntheticId,
          role: 'tool' as const,
          segments: [
            { type: 'tool_result' as const, id: data.tool_id as ToolCallId, output: output || {}, error: err }
          ],
          ts: Date.now()
        } as Event;

        const existingIndex = conv.events.findIndex(e => e.id === syntheticId);
        const nextEvents = existingIndex >= 0
          ? [
              ...conv.events.slice(0, existingIndex),
              toolEvent,
              ...conv.events.slice(existingIndex + 1)
            ]
          : [...conv.events, toolEvent];

        store.setConversation(this.conversationId, {
          ...conv,
          events: nextEvents,
          isStreaming: true,
        });
        this.dbg('tool_result_upserted_store', { syntheticId, eventsCount: nextEvents.length });
      }
    }
  }

  /**
   * Handle tool complete events
   */
  private async handleToolCompleteEvent(data: StreamEvent): Promise<void> {
    if (!data.tool_id) return;
    const output = this.normalizeOutput(data.output as unknown);
    const err = data.error == null ? undefined : data.error; // normalize null → undefined
    // Mirror tool_result handling: upsert a transient tool event
    if (this.conversationId && this.storeInstance) {
      const store = this.storeInstance.getState();
      const conv = store.conversations[this.conversationId];
      if (conv) {
        const syntheticId = `tool-result:${String(data.tool_id)}`;
        // Preserve existing non-empty output if this completion carries none
        const existingIndex = conv.events.findIndex(e => e.id === syntheticId);
        const existing = existingIndex >= 0 ? conv.events[existingIndex] : null;
        const existingSeg = existing?.segments.find(s => s.type === 'tool_result' && (s as any).id === data.tool_id) as any;
        const finalOutput = output !== undefined ? output : (existingSeg?.output !== undefined ? existingSeg.output : {});
        const finalError = err !== undefined ? err : existingSeg?.error;
        const toolEvent = {
          id: syntheticId,
          role: 'tool' as const,
          segments: [
            { type: 'tool_result' as const, id: data.tool_id as ToolCallId, output: finalOutput, error: finalError }
          ],
          ts: Date.now()
        } as Event;

        const nextEvents = existingIndex >= 0
          ? [
              ...conv.events.slice(0, existingIndex),
              toolEvent,
              ...conv.events.slice(existingIndex + 1)
            ]
          : [...conv.events, toolEvent];

        store.setConversation(this.conversationId, {
          ...conv,
          events: nextEvents,
          isStreaming: true,
        });
        this.dbg('tool_complete_upserted_store', { syntheticId, eventsCount: nextEvents.length });
      }
    }
    // Overlay: return to idle until next phase or text
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'idle' }); } catch {}
    }
  }

  /**
   * MCP EVENT HANDLERS
   */

  /**
   * Handle MCP tool start events
   */
  private async handleMCPToolStartEvent(_data: StreamEvent): Promise<void> {
    const data = _data;
    if (!data.tool_id || !data.tool_name) return;
    if (this.builder) {
      this.builder.startToolCall(data.tool_id as ToolCallId, data.tool_name);
    }
    // Overlay: show tool activity (MCP)
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'tool', tool: { id: String(data.tool_id), name: data.tool_name, status: 'in_progress', updatedAt: Date.now() } }); } catch {}
    }
  }

  /**
   * Handle MCP tool arguments delta events
   */
  private async handleMCPToolArgumentsDeltaEvent(data: StreamEvent): Promise<void> {
    // Similar to regular tool arguments delta - no immediate UI update needed
    // Arguments are accumulated in the backend and finalized in mcp_tool_finalized
  }

  /**
   * Handle MCP tool finalized events
   */
  private async handleMCPToolFinalizedEvent(_data: StreamEvent): Promise<void> {
    const data = _data;
    if (!data.tool_id) return;
    if (this.builder) {
      let parsedArgs: object | undefined = undefined;
      try {
        parsedArgs = (data as any).args || ((data as any).arguments ? JSON.parse(String((data as any).arguments)) : undefined);
      } catch {}
      this.builder.finalizeToolArgs(data.tool_id as ToolCallId, parsedArgs);
    }
  }

  /**
   * Handle MCP tool complete events
   */
  private async handleMCPToolCompleteEvent(_data: StreamEvent): Promise<void> {
    const data = _data;
    if (!data.tool_id) return;
    const output = this.normalizeOutput((data as any).output as unknown);
    const err = (data as any).error == null ? undefined : String((data as any).error);
    if (this.builder) {
      this.builder.completeTool(data.tool_id as ToolCallId, output, err);
    }
    // Overlay: return to idle until next phase or text
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'idle' }); } catch {}
    }
  }

  /**
   * Handle MCP list tools events (informational)
   */
  private async handleMCPListToolsEvent(data: StreamEvent): Promise<void> {
    const { server_label, tools } = data;
    // This is informational only - no UI updates needed
  }

  /**
   * Handle MCP approval request events (future implementation)
   */
  private async handleMCPApprovalRequestEvent(data: StreamEvent): Promise<void> {
    const { approval_request_id, tool_name, server_label } = data;
    // Future implementation: show approval dialog to user
    // For now, just log the event
  }

  /**
   * Handle complete events
   */
  private async handleCompleteEvent(_data: StreamEvent): Promise<void> {
    // No-op; message_final handles commit, container clears overlays
  }

  /**
   * Handle error events
   */
  private async handleErrorEvent(_data: StreamEvent): Promise<void> {
    try {
      // Clear overlay if present
      const id = this.assistantPlaceholder?.id;
      if (id) {
        try { setOverlay(id, null); } catch {}
        try { clearDraft(id); } catch {}
      }
      // Dispose builder and reset local placeholders
      try { this.builder?.dispose?.(); } catch {}
      this.builder = null;
      this.assistantPlaceholder = null;
      // Flip store streaming flags off to unblock UI
      if (this.conversationId && this.storeInstance) {
        const store = this.storeInstance.getState();
        const conv = store.conversations[this.conversationId];
        if (conv) {
          store.setConversation(this.conversationId, {
            ...conv,
            isStreaming: false,
            streamingEventId: undefined,
          });
        }
      }
    } catch {}
  }

  /**
   * REASONING EVENT HANDLERS
   */

  private async handleReasoningSummaryPartAdded(data: StreamEvent): Promise<void> {
    const { item_id, output_index, summary_index, part, sequence_number } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    this.dbgJson('reasoning_part_added', data);

    if (!item_id || !part || summary_index === undefined) return;
    
    // Initialize or get existing reasoning data (for final assembly only)
    let reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) {
      reasoningData = {
        item_id,
        output_index: output_index || 0,
        sequence_number: sequence_number,
        parts: {}
      };
      this.currentReasoningData.set(item_id, reasoningData);
    }
    
    // Create or update the reasoning part
    reasoningData.parts[summary_index] = {
      summary_index,
      type: part.type as 'summary_text',
      text: part.text,
      sequence_number: sequence_number || 0,
      is_complete: false,
      created_at: Date.now()
    };
    
    // Update streaming state
    reasoningData.streaming_part_index = summary_index;

    // Draft builder: ensure reasoning segment exists immediately, even when text is empty
    if (this.builder) {
      this.builder.upsertReasoningPart({
        summary_index: summary_index!,
        type: 'summary_text',
        text: part.text || '',
        sequence_number: sequence_number || 0,
        is_complete: false,
        created_at: Date.now(),
      });
    }
    // Debug summary of parts state
    try {
      const draft = this.builder?.getDraft?.();
      const reasoning = draft?.segments.find((s: any) => s.type === 'reasoning');
      const partsDbg = Array.isArray((reasoning as any)?.parts)
        ? (reasoning as any).parts.map((p: any) => ({ summary_index: p.summary_index, is_complete: !!p.is_complete, len: (p.text || '').length }))
        : [];
      this.dbg('reasoning_update', { where: 'reasoning_update', eventId: draft?.id, parts: partsDbg });
    } catch {}
    // Overlay: start a new reasoning part for the active assistant placeholder
    if (this.assistantPlaceholder) {
      // UI reads reasoning parts from EventBuilder draft
    }
  }

  private async handleReasoningSummaryTextDelta(data: StreamEvent): Promise<void> {
    const { item_id, delta, summary_index, sequence_number } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id || !delta || summary_index === undefined) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
    // Find the reasoning part to update by index
    const existingPart = reasoningData.parts[summary_index];
    const basePart = existingPart || {
      summary_index,
      type: 'summary_text' as const,
      text: '',
      sequence_number: sequence_number || 0,
      is_complete: false,
      created_at: Date.now()
    };

    // Append delta text immutably (avoid mutating possibly frozen objects)
    const deltaText = typeof delta === 'string' ? delta : delta.text || '';
    const updatedPart = {
      ...basePart,
      text: (basePart.text || '') + deltaText,
      // keep latest sequence number if provided
      sequence_number: sequence_number ?? basePart.sequence_number
    };
    reasoningData.parts[summary_index] = updatedPart;
    
    // Update streaming state
    reasoningData.streaming_part_index = summary_index;
    
    
    // Draft builder: upsert reasoning part text
    if (this.builder) {
      const overlayDelta = typeof delta === 'string' ? delta : (delta && typeof delta === 'object' && 'text' in delta ? (delta as { text: string }).text : '');
      if (overlayDelta) {
        this.builder.upsertReasoningPart({
          summary_index: summary_index!,
          type: 'summary_text',
          text: overlayDelta,
          sequence_number: sequence_number || 0,
          is_complete: false,
          created_at: Date.now(),
        });
        // noisy debug removed
      }
    }
    // UI reads reasoning parts from EventBuilder draft
    // Update ephemeral overlay reasoning text (single part streaming)
    if (this.textStartedForCurrentEvent) return; // do not update overlay after text has started
    if (this.assistantPlaceholder) {
      try {
        const cur: any = getOverlay(this.assistantPlaceholder.id);
        const incomingPart = summary_index!;
        const currentPart = cur?.reasoning?.currentPartIndex;
        const prevText = currentPart === incomingPart ? (cur?.reasoning?.text || '') : '';
        const deltaText2 = typeof data.delta === 'string' ? data.delta : (data.delta && (data.delta as any).text) || '';
        setOverlay(this.assistantPlaceholder.id, {
          eventId: this.assistantPlaceholder.id,
          kind: 'reasoning',
          reasoning: { text: prevText + deltaText2, item_id: data.item_id!, currentPartIndex: incomingPart, updatedAt: Date.now() }
        });
      } catch {}
    }
  }

  private async handleReasoningSummaryPartDone(data: StreamEvent): Promise<void> {
    const { item_id, summary_index } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id || summary_index === undefined) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData || !reasoningData.parts[summary_index]) return;
    
    // Mark this specific part as complete (immutably)
    const prevPart = reasoningData.parts[summary_index];
    reasoningData.parts[summary_index] = {
      ...prevPart,
      is_complete: true
    };

    // Draft builder: mark this part complete
    if (this.builder) {
      const existing = reasoningData.parts[summary_index];
      if (existing) {
        this.builder.upsertReasoningPart({ ...existing, is_complete: true });
      }
    }
    // Overlay: mark complete for the streaming UI
    if (this.assistantPlaceholder) {
      try {
        const cur: any = getOverlay(this.assistantPlaceholder.id);
        if (cur && cur.kind === 'reasoning') {
          setOverlay(this.assistantPlaceholder.id, { ...cur, reasoning: { ...(cur.reasoning || { text: '' }), item_id: data.item_id!, updatedAt: Date.now() } });
        }
      } catch {}
    }

    // Update UI state (for local assembly if needed)
    this.updateReasoningInState(item_id, reasoningData);
  }

  private async handleReasoningSummaryDone(data: StreamEvent): Promise<void> {
    const { item_id, text } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
    // Finalize all reasoning - combine all parts
    const sortedParts = Object.values(reasoningData.parts)
      .sort((a, b) => a.summary_index - b.summary_index);
    
    reasoningData.combined_text = text || sortedParts
      .map(part => part.text)
      .join('\n\n');
    
    // Clear streaming part index
    reasoningData.streaming_part_index = undefined;
    
    // Mark all parts as complete (immutably)
    for (const idx of Object.keys(reasoningData.parts)) {
      const i = Number(idx);
      const prev = reasoningData.parts[i];
      if (prev) {
        reasoningData.parts[i] = { ...prev, is_complete: true };
      }
    }
    
    // Update UI state - reasoning is now complete with combined_text
    this.updateReasoningInState(item_id, reasoningData, true);
    // Also push final text into the builder so overlay shows text before complete
    if (this.builder && text) {
      // Insert/update the reasoning part 0 with final text
      this.builder.upsertReasoningPart({
        summary_index: 0,
        type: 'summary_text',
        text: text,
        sequence_number: reasoningData.sequence_number || 0,
        is_complete: true,
        created_at: Date.now(),
      });
    }
    
    // Clean up after completion
    this.currentReasoningData.delete(item_id);
  }

  private async handleReasoningComplete(data: StreamEvent): Promise<void> {
    const { item_id, parts, combined_text, output_index, sequence_number } = data as {
      item_id: string;
      parts?: Array<{
        summary_index: number;
        type: 'summary_text';
        text: string;
        sequence_number: number;
        is_complete: boolean;
        created_at: number;
      }>;
      combined_text?: string;
      output_index?: number;
      sequence_number?: number;
    };
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id) return;
    
    let reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) {
      // Create new reasoning data if it doesn't exist
      reasoningData = {
        item_id,
        output_index: output_index || 0,
        sequence_number: sequence_number,
        parts: {}
      };
      this.currentReasoningData.set(item_id, reasoningData);
    }
    
    // Update with final parts if provided
    if (parts && parts.length > 0) {
      for (const part of parts) {
        reasoningData.parts[part.summary_index] = part;
      }
    }
    
    // Set the final combined text
    reasoningData.combined_text = combined_text || Object.values(reasoningData.parts)
      .sort((a, b) => a.summary_index - b.summary_index)
      .map(part => part.text)
      .join('\n');
    
    // Clear streaming state
    reasoningData.streaming_part_index = undefined;
    
    // Mark all parts as complete (immutably)
    for (const idx of Object.keys(reasoningData.parts)) {
      const i = Number(idx);
      const prev = reasoningData.parts[i];
      if (prev) {
        reasoningData.parts[i] = { ...prev, is_complete: true };
      }
    }
    
    // Update builder with final parts so streaming overlay reflects completion
    if (this.builder) {
      const finalParts = Object.values(reasoningData.parts).sort((a, b) => a.summary_index - b.summary_index);
      for (const p of finalParts) {
        this.builder.upsertReasoningPart({
          summary_index: p.summary_index,
          type: 'summary_text',
          text: p.text,
          sequence_number: p.sequence_number || 0,
          is_complete: true,
          created_at: p.created_at || Date.now(),
        });
      }
    }
    // Update UI state - reasoning is now complete
    this.updateReasoningInState(item_id, reasoningData, true);
    // UI reads reasoning from EventBuilder draft
    
    // Clean up after completion
    this.currentReasoningData.delete(item_id);

    // Overlay: keep visible as idle until next phase or text
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'idle' }); } catch {}
    }
  }

  private async handleReasoningStart(data: StreamEvent): Promise<void> {
    const { item_id, output_index, sequence_number } = data as {
      item_id: string;
      output_index?: number;
      sequence_number?: number;
    };
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id) return;
    
    // Initialize reasoning data for this item
    const reasoningData: ReasoningData = {
      item_id,
      output_index: output_index || 0,
      sequence_number: sequence_number,
      parts: {},
      streaming_part_index: 0 // Mark as streaming
    };
    
    this.currentReasoningData.set(item_id, reasoningData);
    
    // Seed a reasoning segment in the builder immediately so the overlay renders
    if (this.builder) {
      this.builder.upsertReasoningPart({
        summary_index: 0,
        type: 'summary_text',
        text: '',
        sequence_number: sequence_number || 0,
        is_complete: false,
        created_at: Date.now(),
      });
    }
    // Update UI state to show empty reasoning segment that will be populated
    this.updateReasoningInState(item_id, reasoningData);
    // Overlay: show reasoning phase (empty text initially)
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'reasoning', reasoning: { text: '', item_id, currentPartIndex: 0, updatedAt: Date.now() } }); } catch {}
    }
  }

  // Helper method for logging reasoning events that don't need special handling
  private async logReasoningEvent(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
  }

  private updateReasoningInState(item_id: string, reasoningData: ReasoningData, _isComplete = false): void {
    // Do not write to store during streaming; reasoning is committed via message_final
    if (!this.localStateUpdater || !this.assistantPlaceholder) return;
    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: this.updateReasoningSegments(event.segments, item_id, reasoningData)
            }
          : event
      );
    });
  }

  // Removed store-backed reasoning updates

  /**
   * Helper method to update reasoning segments in the segments array
   */
  private updateReasoningSegments(segments: Segment[], item_id: string, reasoningData: ReasoningData): Segment[] {
    // Convert ReasoningData to reasoning segment format
    const reasoningSegment = {
      type: 'reasoning' as const,
      id: item_id,
      output_index: reasoningData.output_index,
      sequence_number: reasoningData.sequence_number || 0,
      // Deep-copy parts to avoid freezing internal mutable references
      parts: Object.values(reasoningData.parts).map(p => ({ ...p })),
      combined_text: reasoningData.combined_text,
      effort_level: reasoningData.effort_level,
      reasoning_tokens: reasoningData.reasoning_tokens,
      streaming: reasoningData.streaming_part_index !== undefined,
      streaming_part_index: reasoningData.streaming_part_index
    };

    // Find existing reasoning segment with the same ID and update it, or add new one
    const existingIndex = segments.findIndex(s => 
      s.type === 'reasoning' && s.id === item_id
    );

    if (existingIndex >= 0) {
      // Update existing reasoning segment
      return segments.map((segment, index) => 
        index === existingIndex ? reasoningSegment : segment
      );
    } else {
      // Add new reasoning segment
      return [...segments, reasoningSegment];
    }
  }

  // Local/store mid-stream mutations removed — builder + message_final own persistence

  /**
   * BUILT-IN TOOL EVENT HANDLERS
   */

  /**
   * Handle web search in progress events
   */
  private async handleWebSearchInProgress(data: StreamEvent): Promise<void> {
    const { item_id, output_index, sequence_number } = data;
    
    if (!item_id) return;
    this.updateProgressState('web_search', true);
    // Overlay: show built-in tool activity (only before text starts)
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'built_in' }); } catch {}
    }
  }

  /**
   * Handle web search searching events
   */
  private async handleWebSearchSearching(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    this.updateProgressState('web_search', true);
  }

  /**
   * Handle web search completed events
   */
  private async handleWebSearchCompleted(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    this.updateProgressState(null, false);
    // Overlay: return to idle while waiting for next phase/text
    if (this.assistantPlaceholder) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'idle' }); } catch {}
    }
  }

  /**
   * Handle code interpreter in progress events
   */
  private async handleCodeInterpreterInProgress(data: StreamEvent): Promise<void> {
    const { item_id, output_index, sequence_number } = data;
    
    if (!item_id) return;
    this.updateProgressState('code_interpreter', true);
    // Overlay: show built-in tool activity (only before text starts)
    if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'built_in' }); } catch {}
    }
  }

  /**
   * Handle code interpreter interpreting events
   */
  private async handleCodeInterpreterInterpreting(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    this.updateProgressState('code_interpreter', true);
  }

  /**
   * Handle code interpreter completed events
   */
  private async handleCodeInterpreterCompleted(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    this.updateProgressState(null, false);
    // Overlay: return to idle while waiting for next phase/text
    if (this.assistantPlaceholder) {
      try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, kind: 'idle' }); } catch {}
    }
  }

  /**
   * Handle code interpreter code delta events (streaming code)
   */
  private async handleCodeInterpreterCodeDelta(data: StreamEvent): Promise<void> {
    const { item_id, delta } = data;
    
    if (!item_id || !delta) return; // no-op for code delta streaming in UI
  }

  /**
   * Handle code interpreter code done events
   */
  private async handleCodeInterpreterCodeDone(data: StreamEvent): Promise<void> {
    const { item_id, code } = data;
    
    if (!item_id) return; // no-op for code done in UI
  }

  /**
   * PROGRESS STATE MANAGEMENT
   */
  
  private async handleProgressUpdate(data: StreamEvent): Promise<void> {
    if (data.activity) {
      this.updateProgressState(data.activity, true, data.server_label);
      // Reflect certain progress states in the ephemeral overlay to avoid duplicate UI
      if (this.assistantPlaceholder && !this.textStartedForCurrentEvent) {
        const activity = data.activity;
        let overlayState: any = null;
        if (activity === 'mcp_tool_listing' || activity === 'mcp_tool_discovery') {
          const msg = data.server_label ? `Loading tools from ${data.server_label}...` : 'Loading tools...';
          overlayState = { kind: 'built_in', builtIn: { message: msg, updatedAt: Date.now() } };
        } else if (activity === 'function_prep' || activity === 'response_starting' || activity === 'reasoning') {
          overlayState = { kind: 'idle' };
        }
        if (overlayState) {
          try { setOverlay(this.assistantPlaceholder.id, { eventId: this.assistantPlaceholder.id, ...overlayState }); } catch {}
        }
      }
    }
  }

  private async handleProgressHide(data: StreamEvent): Promise<void> {
    this.updateProgressState(null, false);
  }

  private updateProgressState(activity: ActivityType | null, isVisible: boolean, serverLabel?: string): void {
    this.progressState = {
      currentActivity: activity,
      serverLabel: serverLabel,
      isVisible: isVisible,
      startTime: activity ? Date.now() : undefined
    };

    // Update UI state only via local overlay; no store writes during streaming
    this.updateLocalStateProgress();
  }

  private updateLocalStateProgress(): void {
    if (!this.assistantPlaceholder) return;
    // Update builder draft so leaf components reading getDraft(eventId) can render progress
    try {
      const current = getDraft(this.assistantPlaceholder!.id) || this.assistantPlaceholder!;
      const updated = { ...current, progressState: { ...this.progressState } } as Event;
      setDraft(this.assistantPlaceholder!.id, updated);
    } catch {}

    // Also update local state array if provided
    if (this.localStateUpdater) {
      this.localStateUpdater(events => {
        return events.map(event => 
          event.id === this.assistantPlaceholder!.id
            ? {
                ...event,
                progressState: { ...this.progressState }
              }
            : event
        );
      });
    }
  }

  // Removed updateStoreStateProgress and getProgressState

  // Removed built-in tool local/store helpers and isLocalState
}
