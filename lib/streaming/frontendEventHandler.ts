import { Event, useEventChatStore } from '@/state/eventChatStore';
import { ReasoningData, Segment } from '@/lib/types/events';
// EventConversation, ReasoningPart currently unused
import { ReasoningEventLogger } from '@/lib/reasoning/eventLogger';

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
    } = {}
  ) {}

  // For local state updates (optimistic flow)
  private localStateUpdater: LocalStateUpdater | null = null;
  private assistantPlaceholder: Event | null = null;
  
  // Reasoning data tracking
  private currentReasoningData: Map<string, ReasoningData> = new Map();

  /**
   * Set local state updater for optimistic flows
   */
  setLocalStateUpdater(updater: LocalStateUpdater, placeholder: Event): void {
    this.localStateUpdater = updater;
    this.assistantPlaceholder = placeholder;
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
        break;
      case 'tool_start':
        await this.handleToolStartEvent(data);
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
    }
  }

  /**
   * Handle token events (text streaming)
   */
  private async handleTokenEvent(data: StreamEvent): Promise<void> {
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
    console.log('🌐 [FRONTEND-HANDLER] ✅ MCP TOOL START EVENT RECEIVED:', { 
      tool_id: data.tool_id, 
      tool_name: data.tool_name, 
      server_label: data.server_label,
      isLocalState: this.isLocalState()
    });
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
    console.log('🔍 MCP tools discovered:', { server_label, tool_count: (tools as unknown[])?.length || 0 });
    // This is informational only - no UI updates needed
  }

  /**
   * Handle MCP approval request events (future implementation)
   */
  private async handleMCPApprovalRequestEvent(data: StreamEvent): Promise<void> {
    const { approval_request_id, tool_name, server_label } = data;
    console.log('⚠️ MCP approval requested:', { approval_request_id, tool_name, server_label });
    // Future implementation: show approval dialog to user
    // For now, just log the event
  }

  /**
   * Handle complete events
   */
  private async handleCompleteEvent(data: StreamEvent): Promise<void> {
    if (this.isLocalState()) {
      this.updateLocalStateComplete(data);
    } else {
      this.updateStoreStateComplete(data);
    }
  }

  /**
   * Handle error events
   */
  private async handleErrorEvent(data: StreamEvent): Promise<void> {
    console.error('❌ Stream error:', data.error);

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
  }

  private async handleReasoningSummaryTextDelta(data: StreamEvent): Promise<void> {
    const { item_id, delta, summary_index, sequence_number } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id || !delta || summary_index === undefined) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData) return;
    
    // Find the reasoning part to update by index
    let reasoningPart = reasoningData.parts[summary_index];
    if (!reasoningPart) {
      // Create part if it doesn't exist (defensive programming)
      reasoningPart = {
        summary_index,
        type: 'summary_text',
        text: '',
        sequence_number: sequence_number || 0,
        is_complete: false,
        created_at: Date.now()
      };
      reasoningData.parts[summary_index] = reasoningPart;
    }
    
    // Append delta text
    const deltaText = typeof delta === 'string' ? delta : delta.text || '';
    reasoningPart.text += deltaText;
    
    // Update streaming state
    reasoningData.streaming_part_index = summary_index;
    
    
    // Update UI state
    this.updateReasoningInState(item_id, reasoningData);
  }

  private async handleReasoningSummaryPartDone(data: StreamEvent): Promise<void> {
    const { item_id, summary_index } = data;
    
    // Log event for debugging and validation
    ReasoningEventLogger.logEvent(data);
    
    if (!item_id || summary_index === undefined) return;
    
    const reasoningData = this.currentReasoningData.get(item_id);
    if (!reasoningData || !reasoningData.parts[summary_index]) return;
    
    // Mark this specific part as complete
    reasoningData.parts[summary_index].is_complete = true;
    
    
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
    
    // Mark all parts as complete
    Object.values(reasoningData.parts).forEach(part => {
      part.is_complete = true;
    });
    
    // Update UI state - reasoning is now complete with combined_text
    this.updateReasoningInState(item_id, reasoningData, true);
    
    // Clean up after completion
    this.currentReasoningData.delete(item_id);
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
      this.updateLocalStateReasoning(item_id, reasoningData, isComplete);
    } else {
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

    // Find the assistant event being streamed
    const streamingEventId = conversation.streamingEventId;
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

  /**
   * Helper method to update reasoning segments in the segments array
   */
  private updateReasoningSegments(segments: Segment[], item_id: string, reasoningData: ReasoningData): Segment[] {
    // Convert ReasoningData to reasoning segment format
    const reasoningSegment = {
      type: 'reasoning' as const,
      id: item_id,
      output_index: reasoningData.output_index,
      sequence_number: 0, // Will be set by the backend when finalized
      parts: Object.values(reasoningData.parts),
      combined_text: reasoningData.combined_text,
      effort_level: reasoningData.effort_level,
      reasoning_tokens: reasoningData.reasoning_tokens,
      streaming: reasoningData.streaming_part_index !== undefined
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
   * Check if we're in local state mode (optimistic flow)
   */
  private isLocalState(): boolean {
    return this.localStateUpdater !== null;
  }

  /**
   * LOCAL STATE UPDATES (for optimistic /chat/new flow)
   */

  private updateLocalStateToken(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.content) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(s => 
                s.type === 'text' ? { ...s, text: s.text + data.content } : s
              )
              // Don't update ts on every token to prevent infinite re-renders
            }
          : event
      );
    });
  }

  private updateLocalStateToolStart(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.tool_name) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: [
                ...event.segments,
                {
                  type: 'tool_call' as const,
                  id: data.tool_id!,
                  name: data.tool_name!,
                  args: {}
                }
              ],
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateToolFinalized(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.args) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => 
                segment.type === 'tool_call' && segment.id === data.tool_id
                  ? { ...segment, args: data.args! }
                  : segment
              ),
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateToolResult(data: StreamEvent): void {
    if (!this.localStateUpdater || !data.tool_id || !data.output) return;

    const toolResultEvent: Event = {
      id: crypto.randomUUID(),
      role: 'tool',
      segments: [{
        type: 'tool_result',
        id: data.tool_id,
        output: typeof data.output === 'object' && data.output !== null ? data.output : { result: data.output }
      }],
      ts: Date.now()
    };

    this.localStateUpdater(events => [...events, toolResultEvent]);
  }

  private updateLocalStateToolComplete(_data: StreamEvent): void {
    // Create a new assistant placeholder for the next streaming response
    if (!this.localStateUpdater) return;
    
    const newAssistantPlaceholder: Event = {
      id: crypto.randomUUID(),
      role: 'assistant',
      segments: [{ type: 'text', text: '' }],
      ts: Date.now()
    };
    
    this.localStateUpdater(events => {
      return [...events, newAssistantPlaceholder];
    });
    
    // Update the assistant placeholder reference for future token updates
    this.assistantPlaceholder = newAssistantPlaceholder;
  }

  private updateLocalStateComplete(_data: StreamEvent): void {
    // Mark streaming as complete in local state
    // This is typically handled by the parent component
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
    console.log('🌐 [FRONTEND-HANDLER] Updating local state for MCP tool start:', { 
      tool_id: data.tool_id, 
      tool_name: data.tool_name,
      has_updater: !!this.localStateUpdater,
      has_placeholder: !!this.assistantPlaceholder
    });
    
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.tool_name) {
      console.error('🚨 [FRONTEND-HANDLER] Missing required data for MCP tool start update:', {
        has_updater: !!this.localStateUpdater,
        has_placeholder: !!this.assistantPlaceholder,
        has_tool_id: !!data.tool_id,
        has_tool_name: !!data.tool_name
      });
      return;
    }

    this.localStateUpdater(events => {
      console.log('🌐 [FRONTEND-HANDLER] Adding MCP tool call segment to event:', {
        placeholder_id: this.assistantPlaceholder!.id,
        current_segments: events.find(e => e.id === this.assistantPlaceholder!.id)?.segments.length
      });
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: [
                ...event.segments,
                {
                  type: 'tool_call' as const,
                  id: data.tool_id!,
                  name: data.tool_name!,
                  args: {},
                  // Add MCP-specific metadata if available
                  server_label: data.server_label
                }
              ],
              ts: Date.now()
            }
          : event
      );
    });
    console.log('🌐 [FRONTEND-HANDLER] ✅ MCP tool call segment added to local state');
  }

  private updateLocalStateMCPToolFinalized(data: StreamEvent): void {
    if (!this.localStateUpdater || !this.assistantPlaceholder || !data.tool_id || !data.args) return;

    this.localStateUpdater(events => {
      return events.map(event => 
        event.id === this.assistantPlaceholder!.id
          ? {
              ...event,
              segments: event.segments.map(segment => 
                segment.type === 'tool_call' && segment.id === data.tool_id
                  ? { ...segment, args: data.args! }
                  : segment
              ),
              ts: Date.now()
            }
          : event
      );
    });
  }

  private updateLocalStateMCPToolComplete(_data: StreamEvent): void {
    // For remote MCP tools, the results are included in the text response by OpenAI
    // No separate tool result events are needed
    // This is mainly for cleanup and state tracking
  }

  /**
   * STORE STATE UPDATES (for existing /chat/[id] flow)
   * NOTE: During streaming, we keep updates LOCAL and only update store on completion
   */

  private updateStoreStateToken(data: StreamEvent): void {
    // For store mode, only update when we have a local state updater (means we're tracking locally)
    if (this.localStateUpdater && this.assistantPlaceholder) {
      this.updateLocalStateToken(data);
    }
    // If no local state updater, we don't update the store during streaming (prevents infinite loops)
  }

  private updateStoreStateToolStart(data: StreamEvent): void {
    // Delegate to local state updater which will update the store optimistically
    if (this.localStateUpdater && this.assistantPlaceholder) {
      this.updateLocalStateToolStart(data);
    }
  }

  private updateStoreStateToolFinalized(data: StreamEvent): void {
    // Delegate to local state updater which will update the store optimistically
    if (this.localStateUpdater && this.assistantPlaceholder) {
      this.updateLocalStateToolFinalized(data);
    }
  }

  private updateStoreStateToolResult(data: StreamEvent): void {
    // Delegate to local state updater which will update the store optimistically
    if (this.localStateUpdater) {
      this.updateLocalStateToolResult(data);
    }
  }

  private updateStoreStateToolComplete(data: StreamEvent): void {
    // Delegate to local state updater which will create a new assistant placeholder
    if (this.localStateUpdater) {
      this.updateLocalStateToolComplete(data);
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
    // Delegate to local state updater which will update the store optimistically
    if (this.localStateUpdater && this.assistantPlaceholder) {
      this.updateLocalStateMCPToolStart(data);
    }
  }

  private updateStoreStateMCPToolFinalized(data: StreamEvent): void {
    // Delegate to local state updater which will update the store optimistically
    if (this.localStateUpdater && this.assistantPlaceholder) {
      this.updateLocalStateMCPToolFinalized(data);
    }
  }

  private updateStoreStateMCPToolComplete(data: StreamEvent): void {
    // Delegate to local state updater for MCP tool completion
    if (this.localStateUpdater) {
      this.updateLocalStateMCPToolComplete(data);
    }
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
}