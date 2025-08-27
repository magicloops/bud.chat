'use client';

import { useState, useCallback, useRef } from 'react';
import { Event, createTextEvent, EventLog } from '@/lib/types/events';
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';
import { streamingBus } from '@/lib/streaming/streamingBus';

interface UseEventChatOptions {
  workspaceId: string
  budId?: string
  model?: string
  onConversationCreated?: (conversationId: string) => void
  onError?: (error: string) => void
}

interface ChatState {
  events: Event[]
  isStreaming: boolean
  streamingEventId: string | null
  error: string | null
}

export function useEventChat({
  workspaceId,
  budId,
  model = 'gpt-4o',
  onConversationCreated,
  onError
}: UseEventChatOptions) {
  const [state, setState] = useState<ChatState>({
    events: [],
    isStreaming: false,
    streamingEventId: null,
    error: null
  });
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const eventBuilderRef = useRef<EventStreamBuilder | null>(null);
  // Buffer reasoning deltas per item_id and part index without store updates
  const reasoningBufferRef = useRef<Map<string, Map<number, { text: string; seq: number }>>>(new Map());
  // Buffer MCP tool calls until completion
  const toolBufferRef = useRef<Map<string, { name?: string; display_name?: string; server_label?: string; args?: object; output?: object; error?: string }>>(new Map());

  const updateState = useCallback((updates: Partial<ChatState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const addEvent = useCallback((event: Event) => {
    setState(prev => ({
      ...prev,
      events: [...prev.events, event]
    }));
  }, []);

  const updateStreamingEvent = useCallback((eventId: string, event: Event) => {
    setState(prev => ({
      ...prev,
      events: prev.events.map(e => e.id === eventId ? event : e),
      streamingEventId: eventId
    }));
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!workspaceId || state.isStreaming) return;

    // Clear any previous error
    updateState({ error: null });

    // Create user event
    const userEvent = createTextEvent('user', content);
    addEvent(userEvent);

    // Set up streaming state
    updateState({ isStreaming: true, streamingEventId: null });
    
    // Create assistant event for streaming and event builder up-front
    const assistantEvent = createTextEvent('assistant', '');
    addEvent(assistantEvent);
    updateState({ streamingEventId: assistantEvent.id });
    const eventBuilder = new EventStreamBuilder('assistant');
    eventBuilderRef.current = eventBuilder;

    try {
      // Prepare events for API
      const currentEvents = [...state.events, userEvent];
      const eventLog = new EventLog(currentEvents);
      
      // Convert events to legacy message format for API compatibility
      const messages = currentEvents.map(event => {
        if (event.role === 'system') {
          return {
            role: 'system',
            content: event.segments.find(s => s.type === 'text')?.text || ''
          };
        } else if (event.role === 'user') {
          return {
            role: 'user',
            content: event.segments.find(s => s.type === 'text')?.text || ''
          };
        } else if (event.role === 'assistant') {
          const textContent = event.segments
            .filter(s => s.type === 'text')
            .map(s => s.text)
            .join('');
          
          const toolCalls = event.segments
            .filter(s => s.type === 'tool_call')
            .map(s => ({
              id: s.id,
              type: 'function',
              function: {
                name: s.name,
                arguments: JSON.stringify(s.args)
              }
            }));
          
          return {
            role: 'assistant',
            content: textContent,
            json_meta: toolCalls.length > 0 ? { tool_calls: toolCalls } : undefined
          };
        }
        return null;
      }).filter(Boolean);

      // Set up abort controller
      abortControllerRef.current = new AbortController();

      // Make API call to unified chat endpoint
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'new',
          messages,
          workspaceId,
          budId,
          model
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Start streaming session (ephemeral UI-only)
      const { streamingSessionManager } = await import('@/lib/streaming/StreamingSessionManager');
      streamingSessionManager.start({
        streamId: crypto.randomUUID(),
        conversationId: 'temp',
        assistantEventId: assistantEvent.id,
      });

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let conversationId: string | null = null;
      
      // Assistant event already created above

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case 'conversationCreated':
                  conversationId = data.conversationId;
                  if (conversationId) {
                    onConversationCreated?.(conversationId);
                  }
                  break;
                  
                case 'token':
                  // Route to session manager (overlay/text buffer), keep builder for final
                  streamingSessionManager.apply({ type: 'text_token', content: data.content });
                  eventBuilder.addTextChunk(data.content);
                  updateStreamingEvent(assistantEvent.id, eventBuilder.getCurrentEvent());
                  break;
                  
                case 'tool_start': {
                  streamingSessionManager.apply(data);
                  // Overlay only; buffer meta
                  if (data.tool_id && data.tool_name) {
                    streamingBus.startTool(assistantEvent.id, data.tool_id, data.tool_name, { display_name: data.display_name, server_label: data.server_label });
                    const prev = toolBufferRef.current.get(data.tool_id) || {};
                    toolBufferRef.current.set(data.tool_id, { ...prev, name: data.tool_name, display_name: data.display_name, server_label: data.server_label });
                  }
                  break;
                }
                  
                case 'tool_finalized': {
                  streamingSessionManager.apply(data);
                  // Capture finalized args; overlay update
                  if (data.tool_id) {
                    streamingBus.finalizeTool(assistantEvent.id, data.tool_id, data.arguments || (data.args ? JSON.stringify(data.args) : undefined));
                    const prev = toolBufferRef.current.get(data.tool_id) || {};
                    let args: object | undefined = prev.args;
                    try {
                      if (data.arguments) {
                        args = JSON.parse(data.arguments);
                      } else if (data.args && typeof data.args === 'object') {
                        args = data.args as object;
                      }
                    } catch {
                      args = undefined;
                    }
                    toolBufferRef.current.set(data.tool_id, { ...prev, args });
                  }
                  break;
                }
                case 'tool_result': {
                  // optional: can apply overlay later if needed
                  // Capture result in buffer; overlay status remains
                  if (data.tool_id) {
                    const prev = toolBufferRef.current.get(data.tool_id) || {};
                    const output = typeof data.output === 'object' && data.output !== null ? data.output as object : { result: String(data.output) };
                    toolBufferRef.current.set(data.tool_id, { ...prev, output, error: data.error });
                  }
                  break;
                }
                case 'tool_complete': {
                  streamingSessionManager.apply(data);
                  // Final event will include tool call + result
                  break;
                }

                case 'complete':
                  // Rely on message_final for commit
                  break;

                case 'message_final': {
                  // Prefer canonical final event from server if provided
                  const final = (data as any).event as Event | undefined;
                  if (final) {
                    updateStreamingEvent(assistantEvent.id, final);
                    updateState({ isStreaming: false, streamingEventId: null });
                    streamingSessionManager.complete();
                  }
                  break;
                }

                case 'error':
                  throw new Error(data.error);

                // Reasoning streaming (unified segments)
                case 'reasoning_start':
                  // Initialize buffer; no store updates
                  if (data.item_id) {
                    if (!reasoningBufferRef.current.has(data.item_id)) {
                      reasoningBufferRef.current.set(data.item_id, new Map());
                    }
                  }
                  break;
                case 'reasoning_summary_part_added': {
                  streamingSessionManager.apply(data);
                  // Create part entry; no store update
                  const itemId = data.item_id;
                  if (!itemId || data.summary_index === undefined) break;
                  const map = reasoningBufferRef.current.get(itemId) || new Map();
                  map.set(data.summary_index, { text: data.part?.text || '', seq: data.sequence_number ?? 0 });
                  reasoningBufferRef.current.set(itemId, map);
                  break;
                }
                case 'reasoning_summary_text_delta':
                case 'reasoning_summary_delta': {
                  streamingSessionManager.apply(data);
                  // Append to overlay only; don't update store
                  const text = typeof data.delta === 'string' ? data.delta : data.delta?.text || '';
                  if (text) streamingBus.appendReasoning(assistantEvent.id, text);
                  // Also update buffer for the part
                  const itemId = data.item_id;
                  if (itemId !== undefined && data.summary_index !== undefined) {
                    const map = reasoningBufferRef.current.get(itemId) || new Map();
                    const prev = map.get(data.summary_index) || { text: '', seq: data.sequence_number ?? 0 };
                    map.set(data.summary_index, { text: prev.text + text, seq: data.sequence_number ?? prev.seq });
                    reasoningBufferRef.current.set(itemId, map);
                  }
                  break;
                }
                case 'reasoning_summary_part_done': {
                  // Overlay only; final canonical reasoning comes via message_final
                  streamingSessionManager.apply({ type: 'reasoning_summary_done', item_id: data.item_id });
                  break;
                }
                case 'reasoning_summary_done':
                case 'reasoning_complete': {
                  streamingSessionManager.apply(data);
                  // Finalize: mark no longer streaming; optional clean-up of buffer
                  if (data.item_id) {
                    eventBuilder.upsertReasoningSegment({ id: data.item_id, streaming_part_index: undefined });
                    updateStreamingEvent(assistantEvent.id, eventBuilder.getCurrentEvent());
                    // Do not clear overlay here; stream handler should clear on complete
                  }
                  break;
                }
              }
            } catch (e) {
              console.error('Error parsing stream data:', e);
            }
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      updateState({ 
        error: errorMessage, 
        isStreaming: false, 
        streamingEventId: null 
      });
      onError?.(errorMessage);
    } finally {
      abortControllerRef.current = null;
      eventBuilderRef.current = null;
    }
  }, [workspaceId, budId, model, state.events, state.isStreaming, updateState, addEvent, updateStreamingEvent, onConversationCreated, onError]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    if (eventBuilderRef.current) {
      const finalEvent = eventBuilderRef.current.finalize();
      if (state.streamingEventId) {
        updateStreamingEvent(state.streamingEventId, finalEvent);
      }
      eventBuilderRef.current = null;
    }
    
    updateState({ 
      isStreaming: false, 
      streamingEventId: null 
    });
  }, [state.streamingEventId, updateState, updateStreamingEvent]);

  const clearEvents = useCallback(() => {
    setState({
      events: [],
      isStreaming: false,
      streamingEventId: null,
      error: null
    });
  }, []);

  const addSystemMessage = useCallback((content: string) => {
    const systemEvent = createTextEvent('system', content);
    addEvent(systemEvent);
  }, [addEvent]);

  const retry = useCallback(() => {
    if (state.events.length > 0) {
      const lastUserEvent = [...state.events].reverse().find(e => e.role === 'user');
      if (lastUserEvent) {
        const lastUserMessage = lastUserEvent.segments.find(s => s.type === 'text')?.text;
        if (lastUserMessage) {
          // Remove the last assistant response if any
          const eventsWithoutLastAssistant = state.events.filter((event, index) => {
            if (event.role === 'assistant') {
              // Keep assistant events that are not the last one
              const laterEvents = state.events.slice(index + 1);
              return laterEvents.some(e => e.role === 'user');
            }
            return true;
          });
          
          setState(prev => ({
            ...prev,
            events: eventsWithoutLastAssistant,
            error: null
          }));
          
          // Resend the last user message
          sendMessage(lastUserMessage);
        }
      }
    }
  }, [state.events, sendMessage]);

  return {
    // State
    events: state.events,
    isStreaming: state.isStreaming,
    streamingEventId: state.streamingEventId,
    error: state.error,
    
    // Actions
    sendMessage,
    stopStreaming,
    clearEvents,
    addSystemMessage,
    retry
  };
}
