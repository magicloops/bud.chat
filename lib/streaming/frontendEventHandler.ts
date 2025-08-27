import { Event, useEventChatStore } from '@/state/eventChatStore';
import { streamingBus } from '@/lib/streaming/streamingBus';
import { ReasoningData, Segment } from '@/lib/types/events';
// EventConversation, ReasoningPart currently unused
import { ReasoningEventLogger } from '@/lib/reasoning/eventLogger';
import { ProgressState, ActivityType } from '@/lib/types/progress';
import { ToolCallId } from '@/lib/types/branded';
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
    | 'finalize_only' | 'message_final';
  
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
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              await this.handleStreamEvent(data);
            } catch (e) {
              if (this.options.debug) {
                console.error('Error parsing stream data:', e);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
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
      case 'message_final':
        // Final, canonical assistant event from server
        if (data.event && this.options.onMessageFinal) {
          try {
            this.options.onMessageFinal(data.event as Event);
          } catch (e) {
            if (this.options.debug) console.error('onMessageFinal error:', e);
          }
        }
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
    if (!this.assistantPlaceholder || !data.content) return;
    streamingBus.append(this.assistantPlaceholder.id, data.content);
  }

  /**
   * Handle tool start events
   */
  private async handleToolStartEvent(data: StreamEvent): Promise<void> {
    if (!this.assistantPlaceholder || !data.tool_id || !data.tool_name) return;
    streamingBus.startTool(this.assistantPlaceholder.id, data.tool_id, data.tool_name, {
      display_name: data.display_name,
      server_label: data.server_label
    });
  }

  /**
   * Handle tool finalized events
   */
  private async handleToolFinalizedEvent(data: StreamEvent): Promise<void> {
    if (!this.assistantPlaceholder || !data.tool_id) return;
    streamingBus.finalizeTool(this.assistantPlaceholder.id, data.tool_id, data.arguments || (data.args ? JSON.stringify(data.args) : undefined));
  }

  /**
   * Handle tool result events
   */
  private async handleToolResultEvent(_data: StreamEvent): Promise<void> {
    // Overlay-only; final event contains results
  }

  /**
   * Handle tool complete events
   */
  private async handleToolCompleteEvent(data: StreamEvent): Promise<void> {
    if (!this.assistantPlaceholder || !data.tool_id) return;
    streamingBus.completeTool(this.assistantPlaceholder.id, data.tool_id, { error: data.error });
  }

  /**
   * MCP EVENT HANDLERS
   */

  /**
   * Handle MCP tool start events
   */
  private async handleMCPToolStartEvent(_data: StreamEvent): Promise<void> {
    // Overlay handled via generic tool handlers above or separate flows
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
    // Overlay handled via generic tool handlers above
  }

  /**
   * Handle MCP tool complete events
   */
  private async handleMCPToolCompleteEvent(_data: StreamEvent): Promise<void> {
    // Overlay handled via generic tool handlers above
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
    // Container handles error rollback
  }

  /**
   * REASONING EVENT HANDLERS
   */

  private async handleReasoningSummaryPartAdded(data: StreamEvent): Promise<void> {
    const { item_id, output_index, summary_index, part, sequence_number } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    
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

    // Overlay: start a new reasoning part for the active assistant placeholder
    if (this.assistantPlaceholder) {
      streamingBus.startReasoningPart(this.assistantPlaceholder.id, summary_index, {
        sequence_number: sequence_number,
        created_at: Date.now()
      });
      if (part?.text) {
        streamingBus.appendReasoningPart(this.assistantPlaceholder.id, summary_index, part.text, { sequence_number });
      }
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
    
    
    // Stream to overlay bus per-part keyed by (eventId, summary_index)
    if (this.assistantPlaceholder) {
      const overlayDelta = typeof delta === 'string' 
        ? delta 
        : (delta && typeof delta === 'object' && 'text' in delta ? (delta as { text: string }).text : '');
      if (overlayDelta) {
        streamingBus.appendReasoningPart(this.assistantPlaceholder.id, summary_index!, overlayDelta, { sequence_number });
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

    // Overlay: mark complete for the streaming UI
    if (this.assistantPlaceholder) {
      streamingBus.completeReasoningPart(this.assistantPlaceholder.id, summary_index);
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
    // Finalize overlay text for this event
    if (this.assistantPlaceholder && reasoningData.combined_text) {
      streamingBus.appendReasoning(this.assistantPlaceholder.id, '\\n' + reasoningData.combined_text);
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
    // Finalize overlay text for this event
    if (this.assistantPlaceholder && reasoningData.combined_text) {
      streamingBus.appendReasoning(this.assistantPlaceholder.id, '\\n' + reasoningData.combined_text);
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


  /**
   * LOCAL STATE UPDATES (kept minimal; overlays only)
   */

  private updateLocalStateToken(data: StreamEvent): void {
    if (!this.assistantPlaceholder || !data.content) return;
    // Route tokens to external streaming bus to avoid parent re-renders
    streamingBus.append(this.assistantPlaceholder.id, data.content);
  }

  private updateLocalStateToolStart(data: StreamEvent): void {
    if (!this.assistantPlaceholder || !data.tool_id || !data.tool_name) return;
    streamingBus.startTool(this.assistantPlaceholder.id, data.tool_id, data.tool_name, {
      display_name: data.display_name,
      server_label: data.server_label
    });
  }

  private updateLocalStateToolFinalized(data: StreamEvent): void {
    if (!this.assistantPlaceholder || !data.tool_id) return;
    streamingBus.finalizeTool(this.assistantPlaceholder.id, data.tool_id, data.arguments || (data.args ? JSON.stringify(data.args) : undefined));
  }

  private updateLocalStateToolResult(data: StreamEvent): void {
    // Do not add standalone tool events during streaming; overlay only
  }

  private updateLocalStateToolComplete(_data: StreamEvent): void {
    // No new placeholders and no store churn; overlay remains until completed
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

  // Removed MCP local update helpers; overlays handle visibility

  /**
   * STORE STATE UPDATES — removed for streaming phase (message_final only)
   */

  // Removed store token/tool update helpers

  private updateStoreStateToolFinalized(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id || !data.args) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation || !conversation.streamingEventId) return;
    const updatedEvents = conversation.events.map(event =>
      event.id === conversation.streamingEventId
        ? {
            ...event,
            segments: event.segments.map(segment => {
              if (segment.type === 'tool_call' && segment.id === data.tool_id) {
                return { ...segment, args: data.args! } as Extract<Segment, { type: 'tool_call' }>;
              }
              return segment;
            }),
            ts: Date.now()
          }
        : event
    );
    store.setConversation(this.conversationId, { ...conversation, events: updatedEvents });
  }

  private updateStoreStateToolResult(data: StreamEvent): void {
    if (!this.conversationId || !this.storeInstance || !data.tool_id) return;
    const store = this.storeInstance.getState();
    const conversation = store.conversations[this.conversationId];
    if (!conversation || !conversation.streamingEventId) return;
    const updatedEvents = conversation.events.map(event =>
      event.id === conversation.streamingEventId
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

  private updateStoreStateMCPToolStart(_data: StreamEvent): void {
    // No-op: we do not mutate store mid-stream for tool starts; overlays handle visibility
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

    // Update UI state only via local overlay; no store writes during streaming
    this.updateLocalStateProgress();
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

  private updateStoreStateProgress(): void { /* no-op */ }

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
    if (!this.assistantPlaceholder || !data.item_id) return;
    streamingBus.startTool(this.assistantPlaceholder.id, data.item_id, toolDisplayName);
  }

  /**
   * Handle built-in tool status update for local state
   */
  private updateLocalStateBuiltInToolStatus(data: StreamEvent, status: string): void {
    // Status reflected in overlay badge via completeTool/finalizeTool transitions; no-op here
  }

  /**
   * Handle built-in tool complete for local state
   */
  private updateLocalStateBuiltInToolComplete(data: StreamEvent, toolType: string): void {
    if (!this.assistantPlaceholder || !data.item_id) return;
    streamingBus.completeTool(this.assistantPlaceholder.id, data.item_id);
  }

  /**
   * Handle code delta streaming for local state
   */
  private updateLocalStateCodeDelta(data: StreamEvent): void {
    if (!this.assistantPlaceholder || !data.item_id || typeof data.delta !== 'string') return;
    streamingBus.appendCode(data.item_id, data.delta);
  }

  /**
   * Handle code done for local state
   */
  private updateLocalStateCodeDone(data: StreamEvent): void {
    if (!data.item_id) return;
    streamingBus.setCode(data.item_id, data.code || '');
  }

  /**
   * Handle built-in tool start for store state
   */
  private updateStoreStateBuiltInToolStart(data: StreamEvent, toolType: string, toolDisplayName: string): void {
    return;
  }

  /**
   * Handle built-in tool status update for store state
   */
  private updateStoreStateBuiltInToolStatus(data: StreamEvent, status: 'in_progress' | 'searching' | 'completed' | 'failed' | 'interpreting'): void {
    return;
  }

  /**
   * Handle built-in tool complete for store state
   */
  private updateStoreStateBuiltInToolComplete(data: StreamEvent, _toolType: string): void {
    return;
  }

  /**
   * Handle code delta streaming for store state
   */
  private updateStoreStateCodeDelta(data: StreamEvent): void {
    return;
  }

  /**
   * Handle code done for store state
   */
  private updateStoreStateCodeDone(data: StreamEvent): void {
    return;
  }

  /**
   * Check if we're using local state
   */
  private isLocalState(): boolean {
    return !!this.localStateUpdater && !!this.assistantPlaceholder && this.useLocalStreaming;
  }
}
