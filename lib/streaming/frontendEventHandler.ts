import { Event, useEventChatStore } from '@/state/eventChatStore';
import { streamingBus } from '@/lib/streaming/streamingBus';
import { ReasoningData, Segment } from '@/lib/types/events';
// EventConversation, ReasoningPart currently unused
import { ReasoningEventLogger } from '@/lib/reasoning/eventLogger';
import { ProgressState, ActivityType } from '@/lib/types/progress';
import { ToolCallId, generateEventId } from '@/lib/types/branded';
// import { getActivityFromEvent, shouldHideProgress, getServerLabelFromEvent } from '@/lib/types/progress'; // Not currently used

export interface StreamEvent {
  type: 'token' | 'tool_start' | 'tool_arguments_delta' | 'tool_finalized' | 'tool_result' | 'tool_complete' | 'complete' | 'error'
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
    | 'finalize_only';
  
  // Existing fields
  content?: string;
  tool_id?: string;
  tool_name?: string;
  args?: object;
  output?: object | string | null;
  error?: string;
  
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

const STREAM_DEBUG = typeof process !== 'undefined' && !!(process as any).env && (process as any).env.NEXT_PUBLIC_STREAM_DEBUG === 'true';
let __feh_counter = 0;

export class FrontendEventHandler {
  private instanceId = ++__feh_counter;
  private active = false;
  // Diagnostics-only: mark when a stream has completed; do not change behavior
  private finished = false;
  constructor(
    private conversationId: string | null,
    private storeInstance: typeof useEventChatStore | null,
    private options: {
      debug?: boolean;
    } = {}
  ) {}

  // For local state updates (optimistic flow)
  private localStateUpdater: LocalStateUpdater | null = null;
  private assistantPlaceholder: Event | null = null;
  private hasCreatedPostToolPlaceholder: boolean = false;
  private useLocalStreaming: boolean = false;
  
  // Reasoning data tracking
  private currentReasoningData: Map<string, ReasoningData> = new Map();
  
  // Progress state management
  private progressState: ProgressState = {
    currentActivity: null,
    isVisible: false
  };

  /**
   * Set local state updater for optimistic flows
   */
  setLocalStateUpdater(updater: LocalStateUpdater, placeholder: Event, options?: { useLocalStreaming?: boolean }): void {
    this.localStateUpdater = updater;
    this.assistantPlaceholder = placeholder;
    this.hasCreatedPostToolPlaceholder = false; // Reset flag for new stream
    this.useLocalStreaming = !!options?.useLocalStreaming;
  }

  /**
   * Process streaming response with unified logic for both local and store state
   */
  async processStreamingResponse(response: Response): Promise<void> {
    if (STREAM_DEBUG && this.options.debug) {
      console.log('[STREAM][fe] handler_start', { id: this.instanceId, ts: Date.now() });
    }
    this.active = true;
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const tReadStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const { done, value } = await reader.read();
        const tReadResolved = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (done) {
          if (STREAM_DEBUG && this.options.debug) {
            console.log('[STREAM][fe] reader_done', { id: this.instanceId, ts: Date.now() });
          }
          break;
        }

        const tDecodeStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const chunk = decoder.decode(value, { stream: true });
        const tDecodeEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const lines = chunk.split('\n');

        let parseMs = 0;
        let dispatchMs = 0;
        let tokenEvents = 0;
        let tokenChars = 0;

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const tParseStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const data = JSON.parse(line.slice(6));
            const tParseEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            parseMs += (tParseEnd - tParseStart);

            if (STREAM_DEBUG && this.options.debug) {
              // Trace non-token events lightly
              if (data?.type === 'complete') {
                console.log('[STREAM][fe] recv_complete', { id: this.instanceId, ts: Date.now() });
              } else if (data?.type && data.type !== 'token') {
                console.log('[STREAM][fe] recv_event', { id: this.instanceId, type: data.type, ts: Date.now() });
              }
            }

            if (data && data.type === 'token' && typeof data.content === 'string') {
              tokenEvents += 1;
              tokenChars += data.content.length;
            }

            const tDispatchStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            await this.handleStreamEvent(data);
            const tDispatchEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            dispatchMs += (tDispatchEnd - tDispatchStart);
          } catch (e) {
            if (this.options.debug) {
              console.error('Error parsing stream data:', e);
            }
          }
        }

        if (STREAM_DEBUG && this.options.debug) {
          const chunkBytes = value?.byteLength || 0;
          console.log('[STREAM][fe][chunk]', {
            id: this.instanceId,
            chunk_bytes: chunkBytes,
            read_wait_ms: Math.round(tReadResolved - tReadStart),
            decode_ms: Math.round(tDecodeEnd - tDecodeStart),
            lines: lines.length,
            parse_ms: Math.round(parseMs),
            dispatch_ms: Math.round(dispatchMs),
            token_events: tokenEvents,
            token_chars: tokenChars,
            ts: Date.now()
          });
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
      this.active = false;
      if (STREAM_DEBUG && this.options.debug) {
        console.log('[STREAM][fe] handler_finally', { id: this.instanceId, ts: Date.now() });
      }
    }
  }

  /**
   * Handle a single stream event with unified logic
   */
  async handleStreamEvent(data: StreamEvent): Promise<void> {
    switch (data.type) {
      case 'token':
        await this.handleTokenEvent(data);
        // Hide progress when text content starts
        if (data.hideProgress) {
          this.updateProgressState(null, false);
        }
        break;
      case 'tool_start':
        await this.handleToolStartEvent(data);
        // Hide progress when tool starts
        if (data.hideProgress) {
          this.updateProgressState(null, false);
        }
        break;
      case 'tool_finalized':
        await this.handleToolFinalizedEvent(data);
        break;
      case 'tool_result':
        await this.handleToolResultEvent(data);
        break;
      case 'tool_complete':
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
        await this.handleCompleteEvent(data);
        break;
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
    // Intentionally omit per-token logging to reduce overhead
    if (STREAM_DEBUG && this.options.debug) {
      // Log only when suspicious state is detected (late tokens or inactive handler)
      if (this.finished || !this.active) {
        const ctx = this.getDebugContext();
        console.warn('[STREAM][fe] token_after_finish_or_inactive', { ...ctx, len: data.content?.length || 0, ts: Date.now() });
      }
    }
    if (this.isLocalState()) {
      // Local state update for optimistic flow
      this.updateLocalStateToken(data);
    } else {
      // Store state update for existing conversations
      this.updateStoreStateToken(data);
    }
  }

  /**
   * Handle tool start events
   */
  private async handleToolStartEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateToolStart(data);
    } else {
      this.updateStoreStateToolStart(data);
    }
  }

  /**
   * Handle tool finalized events
   */
  private async handleToolFinalizedEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateToolFinalized(data);
    } else {
      this.updateStoreStateToolFinalized(data);
    }
  }

  /**
   * Handle tool result events
   */
  private async handleToolResultEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateToolResult(data);
    } else {
      this.updateStoreStateToolResult(data);
    }
  }

  /**
   * Handle tool complete events
   */
  private async handleToolCompleteEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateToolComplete(data);
    } else {
      this.updateStoreStateToolComplete(data);
    }
  }

  /**
   * MCP EVENT HANDLERS
   */

  /**
   * Handle MCP tool start events
   */
  private async handleMCPToolStartEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateMCPToolStart(data);
    } else {
      this.updateStoreStateMCPToolStart(data);
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
  private async handleMCPToolFinalizedEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateMCPToolFinalized(data);
    } else {
      this.updateStoreStateMCPToolFinalized(data);
    }
  }

  /**
   * Handle MCP tool complete events
   */
  private async handleMCPToolCompleteEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateMCPToolComplete(data);
    } else {
      this.updateStoreStateMCPToolComplete(data);
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
  private async handleCompleteEvent(data: StreamEvent): Promise<void> {
    // Diagnostics: mark as finished; behavior unchanged otherwise
    this.finished = true;
    if (STREAM_DEBUG && this.options.debug) {
      console.log('[STREAM][fe] handle_complete', this.getDebugContext());
    }
    if (this.isLocalState()) {
      this.updateLocalStateComplete(data);
    } else {
      this.updateStoreStateComplete(data);
    }
    // Do not clear streaming overlays here; containers handle clearing
  }

  /**
   * Handle error events
   */
  private async handleErrorEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateError(data);
    } else {
      this.updateStoreStateError(data);
    }
  }

  /**
   * REASONING EVENT HANDLERS
   */

  private async handleReasoningSummaryPartAdded(data: StreamEvent): Promise<void> {
    const { item_id, output_index, summary_index, part, sequence_number } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    
    if (!item_id || !part || summary_index === undefined) return;
    
    // Initialize or get existing reasoning data
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
    
    // Update UI state
    this.updateReasoningInState(item_id, reasoningData);

    // Reset overlay to this part's current text only (single active step)
    if (this.assistantPlaceholder) {
      const initialText = part?.text || '';
      streamingBus.setReasoning(this.assistantPlaceholder.id, initialText);
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
    if (this.options.debug && STREAM_DEBUG) {
      console.log('[STREAM][fe] reasoning_delta', { idx: summary_index, seq: sequence_number, len: typeof delta === 'string' ? delta.length : (delta as any)?.text?.length || 0, ts: Date.now(), local: this.isLocalState() });
    }
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
    
    
    // Update UI state
    this.updateReasoningInState(item_id, reasoningData);
    // Stream only the delta to prevent O(n^2) re-parsing in Markdown overlays
    if (this.assistantPlaceholder) {
      const overlayDelta = typeof delta === 'string'
        ? delta
        : (delta && typeof (delta as any).text === 'string' ? (delta as { text: string }).text : '');
      if (overlayDelta) {
        streamingBus.appendReasoning(this.assistantPlaceholder.id, overlayDelta);
      }
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
    
    
    // Update UI state
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
    // Optionally update overlay with final text of this step
    if (this.assistantPlaceholder && reasoningData.combined_text) {
      streamingBus.setReasoning(this.assistantPlaceholder.id, reasoningData.combined_text);
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
    
    // Update UI state - reasoning is now complete
    this.updateReasoningInState(item_id, reasoningData, true);
    // Optionally update overlay with final text of this step
    if (this.assistantPlaceholder && reasoningData.combined_text) {
      streamingBus.setReasoning(this.assistantPlaceholder.id, reasoningData.combined_text);
    }
    
    // Clean up after completion
    this.currentReasoningData.delete(item_id);
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
    
    // Update UI state to show empty reasoning segment that will be populated
    this.updateReasoningInState(item_id, reasoningData);
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

  private updateReasoningInState(item_id: string, reasoningData: ReasoningData, isComplete = false): void {
    if (this.isLocalState()) {
      // For /chat/new, update local state so overlays/renderers can react if needed
      this.updateLocalStateReasoning(item_id, reasoningData, isComplete);
      return;
    }
    // For store mode (/chat/[id]): avoid per-delta writes during streaming to prevent UI churn.
    // Only persist reasoning segments when the step is complete.
    if (isComplete) {
      this.updateStoreStateReasoning(item_id, reasoningData, isComplete);
    }
  }

  private updateLocalStateReasoning(item_id: string, reasoningData: ReasoningData, _isComplete: boolean): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: this.updateReasoningSegments(event.segments, item_id, reasoningData)
              // Don't update ts during reasoning streaming to prevent infinite re-renders
            }
          : event
      );
    });
  }

  private updateStoreStateReasoning(item_id: string, reasoningData: ReasoningData, _isComplete: boolean): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;
    // Find the assistant event to update; if streamingEventId is missing (e.g., 'complete' arrived first),
    // fall back to the most recent assistant event.
    const streamingEventId = conversation.streamingEventId || this.getLastAssistantEventId(conversation);
    if (!streamingEventId) return;

    const updatedEvents = conversation.events.map(event =>
      event.id === streamingEventId
        ? {
            ...event,
            segments: this.updateReasoningSegments(event.segments, item_id, reasoningData)
            // Don't update ts during reasoning streaming to prevent infinite re-renders
          }
        : event
    );

    store.setConversation(this.conversationId, {
      ...conversation,
      events: updatedEvents
    });
  }

  private getLastAssistantEventId(conversation: { events: Event[] }): string | undefined {
    for (let i = conversation.events.length - 1; i >= 0; i--) {
      if (conversation.events[i].role === 'assistant') return conversation.events[i].id;
    }
    return undefined;
  }

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


  /**
   * LOCAL STATE UPDATES (for optimistic /chat/new flow)
   */

  private updateLocalStateToken(data: StreamEvent): void {
    if (!this.assistantPlaceholder || !data.content) return;
    if (STREAM_DEBUG && this.options.debug && (this.finished || !this.active)) {
      console.warn('[STREAM][fe] append_local_after_finish_or_inactive', this.getDebugContext());
    }
    // Route tokens to external streaming bus to avoid parent re-renders
    streamingBus.append(this.assistantPlaceholder.id, data.content);
  }

  private updateLocalStateToolStart(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.tool_name) return;

    this.localStateUpdater(events => {
      return events.map(event => {
        if (event.id === this.assistantPlaceholder!.id) {
          // Check if tool already exists
          const toolExists = event.segments.some(
            s => s.type === 'tool_call' && s.id === data.tool_id
          );
          
          if (!toolExists) {
            // Only add new tool if it doesn't exist
            const newSegment = {
              type: 'tool_call' as const,
              id: data.tool_id! as ToolCallId,
              name: data.tool_name!,
              args: {}
            };
            
            return {
              ...event,
              segments: [
                ...event.segments,
                newSegment
              ],
              ts: Date.now()
            };
          }
        }
        return event;
      });
    });
  }

  private updateLocalStateToolFinalized(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.args) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => {
                if (segment.type === 'tool_call' && segment.id === data.tool_id) {
                  return { ...segment, args: data.args! };
                }
                return segment;
              }),
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateToolResult(data: StreamEvent): void {
    if (!this.localStateUpdater || !data.tool_id || !data.output) return;

    const toolResultEvent: Event = {
      id: generateEventId(),
      role: 'tool',
      segments: [{
        type: 'tool_result',
        id: data.tool_id as ToolCallId,
        output: typeof data.output === 'object' && data.output !== null ? data.output : { result: data.output }
      }],
      ts: Date.now()
    };

    this.localStateUpdater(events => [...events, toolResultEvent]);
  }

  private updateLocalStateToolComplete(_data: StreamEvent): void {
    // Create a new assistant placeholder for the next streaming response
    // But only create it once, even if there are multiple tool calls
    if (!this.localStateUpdater || this.hasCreatedPostToolPlaceholder) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[STREAM][handler] Skipping local post-tool placeholder', {
          hasUpdater: !!this.localStateUpdater,
          hasCreatedPostToolPlaceholder: this.hasCreatedPostToolPlaceholder
        });
      }
      return;
    }
    
    const newAssistantPlaceholder: Event = {
      id: generateEventId(),
      role: 'assistant',
      segments: [{ type: 'text', text: '' }],
      ts: Date.now()
    };
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('[STREAM][handler] Adding local post-tool placeholder');
    }
    this.localStateUpdater(events => {
      return [...events, newAssistantPlaceholder];
    });
    
    // Update the assistant placeholder reference for future token updates
    this.assistantPlaceholder = newAssistantPlaceholder;
    this.hasCreatedPostToolPlaceholder = true;
  }

  private updateLocalStateComplete(_data: StreamEvent): void {
    // Mark streaming as complete in local state
    // This is typically handled by the parent component
    // Reset the flag for next stream
    this.hasCreatedPostToolPlaceholder = false;
  }

  private updateLocalStateError(_data: StreamEvent): void {
    // Handle error in local state - typically remove optimistic events
    if (!this.localStateUpdater) return;
    
    this.localStateUpdater(events => {
      // Remove the last 2 events (user + assistant placeholder) on error
      return events.slice(0, -2);
    });
  }

  /**
   * MCP LOCAL STATE UPDATES
   */

  private updateLocalStateMCPToolStart(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.tool_name) {
      return;
    }

    this.localStateUpdater(events => {
      return events.map(event => {
        if (event.id === this.assistantPlaceholder!.id) {
          // Check if tool already exists
          const toolExists = event.segments.some(
            s => s.type === 'tool_call' && s.id === data.tool_id
          );
          
          if (!toolExists) {
            // Only add new tool if it doesn't exist
            return {
              ...event,
              segments: [
                ...event.segments,
                {
                  type: 'tool_call' as const,
                  id: data.tool_id! as ToolCallId,
                  name: data.tool_name!,
                  args: {},
                  // Add sequence_number and output_index for proper ordering
                  sequence_number: data.sequence_number,
                  output_index: data.output_index,
                  // Add MCP-specific fields directly
                  server_label: data.server_label,
                  server_type: data.server_type,
                  display_name: data.display_name
                }
              ],
              ts: Date.now()
            };
          }
        }
        return event;
      });
    });
  }

  private updateLocalStateMCPToolFinalized(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.args) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => {
                if (segment.type === 'tool_call' && segment.id === data.tool_id) {
                  return { ...segment, args: data.args! };
                }
                return segment;
              }),
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateMCPToolComplete(data: StreamEvent): void {
    // For Responses API, tool results are included as segments in the assistant event
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: [
                ...event.segments,
                {
                  type: 'tool_result' as const,
                  id: data.tool_id! as ToolCallId,
                  output: typeof data.output === 'object' && data.output !== null ? data.output : {},
                  error: data.error
                }
              ],
              ts: Date.now()
            }
          : event
      );
    });
  }

  /**
   * STORE STATE UPDATES (for existing /chat/[id] flow)
   * NOTE: During streaming, we keep updates LOCAL and only update store on completion
   */

  private updateStoreStateToken(data: StreamEvent): void {
    // For store mode, push tokens to the streaming bus only
    if (this.assistantPlaceholder && data.content) {
      if (STREAM_DEBUG && this.options.debug) {
        const storeCtx = this.getDebugContext();
        // Warn if store indicates streaming ended but we're still appending
        if (storeCtx.storeIsStreaming === false || storeCtx.storeStreamingEventId && storeCtx.storeStreamingEventId !== storeCtx.assistantPlaceholderId) {
          console.warn('[STREAM][fe] append_store_when_not_streaming', storeCtx);
        }
        if (this.finished || !this.active) {
          console.warn('[STREAM][fe] append_store_after_finish_or_inactive', storeCtx);
        }
      }
      streamingBus.append(this.assistantPlaceholder.id, data.content);
    }
  }

  private updateStoreStateToolStart(data: StreamEvent): void {
    // Avoid persisting tool_call on start during streaming in store mode; overlay covers progress.
    // We'll persist tool_call when finalized/complete arrives.
    return;
  }

  private updateStoreStateToolFinalized(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id || !data.args) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;
    const targetEventId = conversation.streamingEventId || this.getLastAssistantEventId(conversation);
    if (!targetEventId) return;
    const updatedEvents = conversation.events.map(event => {
      if (event.id !== targetEventId) return event;
      const hasTool = event.segments.some(s => s.type === 'tool_call' && s.id === data.tool_id);
      const newSegments = hasTool
        ? event.segments.map(segment => {
            if (segment.type === 'tool_call' && segment.id === data.tool_id) {
              return { ...segment, args: data.args! } as Extract<Segment, { type: 'tool_call' }>;
            }
            return segment;
          })
        : [
            ...event.segments,
            {
              type: 'tool_call' as const,
              id: data.tool_id as ToolCallId,
              name: data.tool_name!,
              args: data.args!,
              sequence_number: data.sequence_number,
              output_index: data.output_index,
              server_label: data.server_label,
              server_type: data.server_type,
              display_name: data.display_name
            }
          ];
      return { ...event, segments: newSegments, ts: Date.now() };
    });
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  private updateStoreStateToolResult(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;
    const targetEventId = conversation.streamingEventId || this.getLastAssistantEventId(conversation);
    if (!targetEventId) return;
    const updatedEvents = conversation.events.map(event =>
      event.id === targetEventId
        ? {
            ...event,
            segments: [
              ...event.segments,
              {
                type: 'tool_result' as const,
                id: data.tool_id as ToolCallId,
                output: typeof data.output === 'object' && data.output !== null ? data.output : {},
                error: data.error
              }
            ],
            ts: Date.now()
          }
        : event
    );
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  private updateStoreStateToolComplete(_data: StreamEvent): void {
    // For Responses API, new assistant placeholders after tools are not needed here.
    if (process.env.NODE_ENV !== 'production') {
      console.log('[STREAM][handler] Store tool complete (no new assistant placeholder)');
    }
  }

  private updateStoreStateComplete(_data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;
    
    // Mark streaming as complete
    store.setConversation(this.conversationId, {
      ...conversation,
      isStreaming: false,
      streamingEventId: undefined
    });
  }

  private updateStoreStateError(_data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance) return;

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;

    // Remove optimistic updates on error
    store.setConversation(this.conversationId, {
      ...conversation,
      events: conversation.events.slice(0, -2), // Remove user + assistant events
      isStreaming: false,
      streamingEventId: undefined
    });
  }

  /**
   * MCP STORE STATE UPDATES
   */

  private updateStoreStateMCPToolStart(data: StreamEvent): void {
    this.updateStoreStateToolStart(data);
  }

  private updateStoreStateMCPToolFinalized(data: StreamEvent): void {
    this.updateStoreStateToolFinalized(data);
  }

  private updateStoreStateMCPToolComplete(data: StreamEvent): void {
    this.updateStoreStateToolComplete(data);
  }

  /**
   * Finalize streaming by updating the store with completed events
   * This should be called by the component when streaming is complete
   */
  finalizeStreamingInStore(completedEvents: Event[]): void {
    if (!this.conversationId || !this.storeInstance) {
      return;
    }

    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) {
      return;
    }

    // Update store with final, complete events
    store.setConversation(this.conversationId, {
      ...conversation,
      events: completedEvents,
      isStreaming: false,
      streamingEventId: undefined,
      shouldCreateNewEvent: false
    });
  }

  /**
   * Diagnostics helper: capture current handler/store context for logs
   */
  private getDebugContext(): {
    instanceId: number;
    active: boolean;
    finished: boolean;
    useLocalStreaming: boolean;
    conversationId: string | null;
    assistantPlaceholderId: string | null;
    storeIsStreaming?: boolean;
    storeStreamingEventId?: string;
  } {
    let storeIsStreaming: boolean | undefined = undefined;
    let storeStreamingEventId: string | undefined = undefined;
    if (this.conversationId && this.storeInstance) {
      const s = this.storeInstance.getState();
      const conv = s.conversations[this.conversationId];
      if (conv) {
        storeIsStreaming = !!conv.isStreaming;
        storeStreamingEventId = conv.streamingEventId;
      }
    }
    return {
      instanceId: this.instanceId,
      active: this.active,
      finished: this.finished,
      useLocalStreaming: this.useLocalStreaming,
      conversationId: this.conversationId,
      assistantPlaceholderId: this.assistantPlaceholder ? this.assistantPlaceholder.id : null,
      storeIsStreaming,
      storeStreamingEventId,
    };
  }

  /**
   * BUILT-IN TOOL EVENT HANDLERS
   */

  /**
   * Handle web search in progress events
   */
  private async handleWebSearchInProgress(data: StreamEvent): Promise<void> {
    const { item_id, output_index, sequence_number } = data;
    
    if (!item_id) return;
    
    if (this.isLocalState()) {
      this.updateLocalStateBuiltInToolStart(data, 'web_search_call', 'Web Search');
    } else {
      this.updateStoreStateBuiltInToolStart(data, 'web_search_call', 'Web Search');
    }
  }

  /**
   * Handle web search searching events
   */
  private async handleWebSearchSearching(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    // Update progress state to show searching activity
    this.updateProgressState('web_search', true);
    
    if (this.isLocalState()) {
      this.updateLocalStateBuiltInToolStatus(data, 'searching');
    } else {
      this.updateStoreStateBuiltInToolStatus(data, 'searching');
    }
  }

  /**
   * Handle web search completed events
   */
  private async handleWebSearchCompleted(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    // Hide progress when search completes
    this.updateProgressState(null, false);
    
    if (this.isLocalState()) {
      this.updateLocalStateBuiltInToolComplete(data, 'web_search_call');
    } else {
      this.updateStoreStateBuiltInToolComplete(data, 'web_search_call');
    }
  }

  /**
   * Handle code interpreter in progress events
   */
  private async handleCodeInterpreterInProgress(data: StreamEvent): Promise<void> {
    const { item_id, output_index, sequence_number } = data;
    
    if (!item_id) return;
    
    if (this.isLocalState()) {
      this.updateLocalStateBuiltInToolStart(data, 'code_interpreter_call', 'Code Interpreter');
    } else {
      this.updateStoreStateBuiltInToolStart(data, 'code_interpreter_call', 'Code Interpreter');
    }
  }

  /**
   * Handle code interpreter interpreting events
   */
  private async handleCodeInterpreterInterpreting(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    // Update progress state to show interpreting activity
    this.updateProgressState('code_interpreter', true);
    
    if (this.isLocalState()) {
      this.updateLocalStateBuiltInToolStatus(data, 'interpreting');
    } else {
      this.updateStoreStateBuiltInToolStatus(data, 'interpreting');
    }
  }

  /**
   * Handle code interpreter completed events
   */
  private async handleCodeInterpreterCompleted(data: StreamEvent): Promise<void> {
    const { item_id } = data;
    
    if (!item_id) return;
    
    // Hide progress when interpretation completes
    this.updateProgressState(null, false);
    
    if (this.isLocalState()) {
      this.updateLocalStateBuiltInToolComplete(data, 'code_interpreter_call');
    } else {
      this.updateStoreStateBuiltInToolComplete(data, 'code_interpreter_call');
    }
    // Clear code overlay buffer
    if (item_id) streamingBus.clearCode(item_id);
  }

  /**
   * Handle code interpreter code delta events (streaming code)
   */
  private async handleCodeInterpreterCodeDelta(data: StreamEvent): Promise<void> {
    const { item_id, delta } = data;
    
    if (!item_id || !delta) return;
    
    if (this.isLocalState()) {
      this.updateLocalStateCodeDelta(data);
    } else {
      this.updateStoreStateCodeDelta(data);
    }
    // Stream code overlay
    if (data.item_id && data.delta && typeof data.delta === 'string') {
      streamingBus.appendCode(data.item_id, data.delta);
    }
  }

  /**
   * Handle code interpreter code done events
   */
  private async handleCodeInterpreterCodeDone(data: StreamEvent): Promise<void> {
    const { item_id, code } = data;
    
    if (!item_id) return;
    
    if (this.isLocalState()) {
      this.updateLocalStateCodeDone(data);
    } else {
      this.updateStoreStateCodeDone(data);
    }
    // Finalize code overlay
    if (data.item_id && data.code) {
      streamingBus.setCode(data.item_id, data.code);
    }
  }

  /**
   * PROGRESS STATE MANAGEMENT
   */
  
  private async handleProgressUpdate(data: StreamEvent): Promise<void> {
    if (data.activity) {
      this.updateProgressState(data.activity, true, data.server_label);
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

    // Update UI state based on current mode
    if (this.isLocalState()) {
      this.updateLocalStateProgress();
    } else {
      this.updateStoreStateProgress();
    }
  }

  private updateLocalStateProgress(): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder) return;

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

  private updateStoreStateProgress(): void {
    if (!this.storeInstance || !this.conversationId) return;

    // Update the current event with progress state
    const state = this.storeInstance.getState();
    const conversation = state.conversations[this.conversationId];
    if (!conversation || conversation.events.length === 0) return;

    // Find the last assistant event
    const lastAssistantEvent = conversation.events
      .slice()
      .reverse()
      .find(event => event.role === 'assistant');

    if (lastAssistantEvent) {
      this.storeInstance.getState().updateEvent(
        this.conversationId!,
        lastAssistantEvent.id,
        {
          progressState: { ...this.progressState }
        }
      );
    }
  }

  /**
   * Get current progress state
   */
  getProgressState(): ProgressState {
    return { ...this.progressState };
  }

  /**
   * BUILT-IN TOOL STATE UPDATES
   */

  /**
   * Handle built-in tool start for local state
   */
  private updateLocalStateBuiltInToolStart(data: StreamEvent, toolType: string, toolDisplayName: string): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.item_id) return;

    this.localStateUpdater(events => {
      return events.map(event => {
        if (event.id === this.assistantPlaceholder!.id) {
          // Check if built-in tool segment already exists
          const toolExists = event.segments.some(
            s => (s.type === 'web_search_call' || s.type === 'code_interpreter_call') && s.id === data.item_id
          );
          
          if (!toolExists) {
            // Add new built-in tool segment
            const newSegment = toolType === 'web_search_call' 
              ? {
                  type: 'web_search_call' as const,
                  id: data.item_id!,
                  output_index: data.output_index || 0,
                  sequence_number: data.sequence_number || 0,
                  status: 'in_progress' as const
                }
              : {
                  type: 'code_interpreter_call' as const,
                  id: data.item_id!,
                  output_index: data.output_index || 0,
                  sequence_number: data.sequence_number || 0,
                  status: 'in_progress' as const
                };
            
            return {
              ...event,
              segments: [
                ...event.segments,
                newSegment
              ],
              ts: Date.now()
            };
          }
        }
        return event;
      });
    });
  }

  /**
   * Handle built-in tool status update for local state
   */
  private updateLocalStateBuiltInToolStatus(data: StreamEvent, status: string): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.item_id) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => {
                if (segment.type === 'web_search_call' && segment.id === data.item_id) {
                  return { 
                    ...segment, 
                    status: status as 'in_progress' | 'searching' | 'completed' | 'failed'
                  };
                } else if (segment.type === 'code_interpreter_call' && segment.id === data.item_id) {
                  return { 
                    ...segment, 
                    status: status as 'in_progress' | 'interpreting' | 'completed' | 'failed'
                  };
                }
                return segment;
              }),
              ts: Date.now()
            }
          : event
      );
    });
  }

  /**
   * Handle built-in tool complete for local state
   */
  private updateLocalStateBuiltInToolComplete(data: StreamEvent, toolType: string): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.item_id) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => {
                if (segment.type === 'web_search_call' && segment.id === data.item_id) {
                  return { 
                    ...segment, 
                    status: 'completed' as const
                  };
                } else if (segment.type === 'code_interpreter_call' && segment.id === data.item_id) {
                  return { 
                    ...segment, 
                    status: 'completed' as const
                  };
                }
                return segment;
              }),
              ts: Date.now()
            }
          : event
      );
    });
  }

  /**
   * Handle code delta streaming for local state
   */
  private updateLocalStateCodeDelta(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.item_id || !data.delta) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => {
                if (segment.type === 'code_interpreter_call' && segment.id === data.item_id) {
                  const currentCode = segment.code || '';
                  return { 
                    ...segment, 
                    code: currentCode + data.delta
                  };
                }
                return segment;
              }),
              ts: Date.now()
            }
          : event
      );
    });
  }

  /**
   * Handle code done for local state
   */
  private updateLocalStateCodeDone(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.item_id) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => {
                if (segment.type === 'code_interpreter_call' && segment.id === data.item_id) {
                  return { 
                    ...segment, 
                    code: data.code || segment.code || ''
                  };
                }
                return segment;
              }),
              ts: Date.now()
            }
          : event
      );
    });
  }

  /**
   * Handle built-in tool start for store state
   */
  private updateStoreStateBuiltInToolStart(data: StreamEvent, toolType: string, toolDisplayName: string): void {
    if (!this.conversationId || !this.storeInstance || !data.item_id) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation || !conversation.streamingEventId) return;
    const updatedEvents = conversation.events.map(event => {
      if (event.id !== conversation.streamingEventId) return event;
      const exists = event.segments.some(
        s => (s.type === 'web_search_call' || s.type === 'code_interpreter_call') && s.id === data.item_id
      );
      if (exists) return event;
      const newSegment = toolType === 'web_search_call'
        ? { type: 'web_search_call' as const, id: data.item_id!, output_index: data.output_index || 0, sequence_number: data.sequence_number || 0, status: 'in_progress' as const }
        : { type: 'code_interpreter_call' as const, id: data.item_id!, output_index: data.output_index || 0, sequence_number: data.sequence_number || 0, status: 'in_progress' as const };
      return { ...event, segments: [...event.segments, newSegment], ts: Date.now() };
    });
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  /**
   * Handle built-in tool status update for store state
   */
  private updateStoreStateBuiltInToolStatus(data: StreamEvent, status: 'in_progress' | 'searching' | 'completed' | 'failed' | 'interpreting'): void {
    if (!this.conversationId || !this.storeInstance || !data.item_id) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation || !conversation.streamingEventId) return;
    const updatedEvents = conversation.events.map(event =>
      event.id === conversation.streamingEventId
        ? {
            ...event,
            segments: event.segments.map(segment => {
              if (segment.type === 'web_search_call' && segment.id === data.item_id) {
                return { ...segment, status } as Extract<Segment, { type: 'web_search_call' }>;
              } else if (segment.type === 'code_interpreter_call' && segment.id === data.item_id) {
                return { ...segment, status } as Extract<Segment, { type: 'code_interpreter_call' }>;
              }
              return segment;
            }),
            ts: Date.now()
          }
        : event
    );
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  /**
   * Handle built-in tool complete for store state
   */
  private updateStoreStateBuiltInToolComplete(data: StreamEvent, _toolType: string): void {
    this.updateStoreStateBuiltInToolStatus(data, 'completed');
  }

  /**
   * Handle code delta streaming for store state
   */
  private updateStoreStateCodeDelta(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.item_id || !data.delta) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;
    const targetEventId = conversation.streamingEventId || this.getLastAssistantEventId(conversation);
    if (!targetEventId) return;
    const updatedEvents = conversation.events.map(event =>
      event.id === targetEventId
        ? {
            ...event,
            segments: event.segments.map(segment => {
              if (segment.type === 'code_interpreter_call' && segment.id === data.item_id && typeof data.delta === 'string') {
                const currentCode = segment.code || '';
                return { ...segment, code: currentCode + data.delta } as Extract<Segment, { type: 'code_interpreter_call' }>;
              }
              return segment;
            }),
            ts: Date.now()
          }
        : event
    );
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  /**
   * Handle code done for store state
   */
  private updateStoreStateCodeDone(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.item_id) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation) return;
    const targetEventId = conversation.streamingEventId || this.getLastAssistantEventId(conversation);
    if (!targetEventId) return;
    const updatedEvents = conversation.events.map(event =>
      event.id === targetEventId
        ? {
            ...event,
            segments: event.segments.map(segment => {
              if (segment.type === 'code_interpreter_call' && segment.id === data.item_id) {
                return { ...segment, code: data.code || segment.code || '' } as Extract<Segment, { type: 'code_interpreter_call' }>;
              }
              return segment;
            }),
            ts: Date.now()
          }
        : event
    );
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  /**
   * Check if we're using local state
   */
  private isLocalState(): boolean {
    return !!this.localStateUpdater && !!this.assistantPlaceholder && this.useLocalStreaming;
  }
}
