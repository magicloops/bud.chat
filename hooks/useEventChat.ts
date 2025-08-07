'use client';

import { useState, useCallback, useRef } from 'react';
import { Event, createTextEvent, EventLog } from '@/lib/types/events';
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';

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
    
    // Create event builder for assistant response
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

      // Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let conversationId: string | null = null;
      
      // Create assistant event for streaming
      const assistantEvent = createTextEvent('assistant', '');
      addEvent(assistantEvent);
      updateState({ streamingEventId: assistantEvent.id });

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
                  // Update streaming event with new text
                  eventBuilder.addTextChunk(data.content);
                  const currentEvent = eventBuilder.getCurrentEvent();
                  updateStreamingEvent(assistantEvent.id, currentEvent);
                  break;
                  
                case 'tool_start':
                  // Handle tool call start
                  eventBuilder.addToolCall(data.tool_id, data.tool_name, {});
                  const toolStartEvent = eventBuilder.getCurrentEvent();
                  updateStreamingEvent(assistantEvent.id, toolStartEvent);
                  break;
                  
                case 'tool_complete':
                  // Handle tool completion
                  eventBuilder.addTextChunk(data.content || '');
                  const toolCompleteEvent = eventBuilder.getCurrentEvent();
                  updateStreamingEvent(assistantEvent.id, toolCompleteEvent);
                  break;
                  
                case 'complete':
                  // Finalize the assistant event
                  const finalEvent = eventBuilder.finalize();
                  updateStreamingEvent(assistantEvent.id, finalEvent);
                  updateState({ 
                    isStreaming: false, 
                    streamingEventId: null 
                  });
                  break;
                  
                case 'error':
                  throw new Error(data.error);
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