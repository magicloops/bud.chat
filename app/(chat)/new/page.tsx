'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EventStream } from '@/components/EventStream';
import { 
  Event,
  useSelectedWorkspace, 
  useSetConversation,
  useAddConversationToWorkspace,
  ConversationMeta,
  Conversation,
  useEventChatStore
} from '@/state/eventChatStore';
import { 
  createGreetingEvent, 
  createUserEvent, 
  createAssistantPlaceholder,
  createSystemEvents,
  updateEventsConversationId
} from '@/lib/eventMessageHelpers';
import { 
  createBudInitialEvents,
  budManager
} from '@/lib/budHelpers';
import { Bud } from '@/lib/types';
import { useBud } from '@/state/budStore';

export default function NewChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedWorkspace = useSelectedWorkspace();
  const setConversation = useSetConversation();
  const addConversationToWorkspace = useAddConversationToWorkspace();
  
  const budId = searchParams.get('bud');
  
  // Get bud from store (reactive to updates) and local state for initial load
  const storeBud = useBud(budId || '');
  const [bud, setBud] = useState<Bud | null>(null);
  
  // State for events and loading
  const [budLoading, setBudLoading] = useState(!!budId);
  const [events, setEvents] = useState<Event[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingEventId, setStreamingEventId] = useState<string | null>(null);

  // Load bud if budId is provided
  useEffect(() => {
    const loadBud = async () => {
      if (!budId) {
        // No bud specified, use default events and clear any custom theme
        setEvents([
          createGreetingEvent(),
          ...createSystemEvents()
        ]);
        
        // Clear any existing custom theme and reset to default
        const root = document.documentElement;
        const existingTheme = localStorage.getItem('customTheme');
        if (existingTheme) {
          try {
            const theme = JSON.parse(existingTheme);
            Object.keys(theme.cssVariables).forEach(key => {
              root.style.removeProperty(key);
            });
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        // Also clear common theme variables that might be set
        const commonThemeVars = [
          '--background', '--foreground', '--card', '--card-foreground',
          '--popover', '--popover-foreground', '--primary', '--primary-foreground',
          '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
          '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
          '--border', '--input', '--ring'
        ];
        
        commonThemeVars.forEach(varName => {
          root.style.removeProperty(varName);
        });
        
        setBudLoading(false);
        return;
      }

      try {
        setBudLoading(true);
        const loadedBud = await budManager.getBud(budId);
        setBud(loadedBud);
        
        // Initialize events with bud configuration
        const budEvents = createBudInitialEvents(loadedBud);
        setEvents(budEvents);
        
        // Apply bud's theme or reset to default
        const budConfig = loadedBud.default_json as any;
        const root = document.documentElement;
        
        if (budConfig?.customTheme) {
          // Apply bud's custom theme
          Object.entries(budConfig.customTheme.cssVariables).forEach(([key, value]) => {
            root.style.setProperty(key, value as string);
          });
        } else {
          // Clear any existing custom theme and reset to default
          // First, try to clear any localStorage theme
          const existingTheme = localStorage.getItem('customTheme');
          if (existingTheme) {
            try {
              const theme = JSON.parse(existingTheme);
              Object.keys(theme.cssVariables).forEach(key => {
                root.style.removeProperty(key);
              });
            } catch (e) {
              // Ignore parse errors
            }
          }
          
          // Also clear common theme variables that might be set
          const commonThemeVars = [
            '--background', '--foreground', '--card', '--card-foreground',
            '--popover', '--popover-foreground', '--primary', '--primary-foreground',
            '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
            '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
            '--border', '--input', '--ring'
          ];
          
          commonThemeVars.forEach(varName => {
            root.style.removeProperty(varName);
          });
        }
      } catch (error) {
        console.error('Failed to load bud:', error);
        // Fallback to default events
        setEvents([
          createGreetingEvent(),
          ...createSystemEvents()
        ]);
      } finally {
        setBudLoading(false);
      }
    };

    loadBud();
  }, [budId]);

  // Watch for bud updates from store and regenerate events
  useEffect(() => {
    if (!budId || !storeBud) return;
    
    // Update local bud state
    setBud(storeBud);
    
    // Regenerate events with updated bud configuration
    const budEvents = createBudInitialEvents(storeBud);
    setEvents(budEvents);
    
    // Apply updated theme
    const budConfig = storeBud.default_json as any;
    const root = document.documentElement;
    
    // Clear existing theme first
    const commonThemeVars = [
      '--background', '--foreground', '--card', '--card-foreground',
      '--popover', '--popover-foreground', '--primary', '--primary-foreground',
      '--secondary', '--secondary-foreground', '--muted', '--muted-foreground',
      '--accent', '--accent-foreground', '--destructive', '--destructive-foreground',
      '--border', '--input', '--ring'
    ];
    
    commonThemeVars.forEach(varName => {
      root.style.removeProperty(varName);
    });
    
    if (budConfig?.customTheme) {
      // Apply bud's custom theme
      Object.entries(budConfig.customTheme.cssVariables).forEach(([key, value]) => {
        root.style.setProperty(key, value as string);
      });
    }
  }, [budId, storeBud]); // This will trigger when storeBud changes (i.e., when bud is updated)


  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace) {
      console.error('No workspace selected');
      return;
    }

    
    // 1. Optimistic UI updates (instant)
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    
    const newEvents = [...events, userEvent, assistantPlaceholder];
    setEvents(newEvents);
    setIsStreaming(true);
    setStreamingEventId(assistantPlaceholder.id);

    try {
      // 2. Start streaming immediately - no database blocking!
      console.log('📡 Starting streaming request...');
      const response = await fetch('/api/chat-new', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...events, userEvent], // Send all events including system messages
          workspaceId: selectedWorkspace,
          budId: bud?.id,
          model: bud ? (bud.default_json as any).model || 'gpt-4o' : 'gpt-4o'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // 3. Handle streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let conversationId: string | null = null;

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
                  console.log('💾 Conversation created:', conversationId);
                  
                  // Manually add to sidebar as fallback (in case realtime subscription didn't work)
                  if (selectedWorkspace && conversationId) {
                    console.log('➕ Manually adding conversation to workspace sidebar:', conversationId);
                    
                    // Create a basic conversation object for the sidebar
                    const conversationMeta: ConversationMeta = {
                      id: conversationId,
                      title: 'New Chat', // Will be updated when title is generated
                      workspace_id: selectedWorkspace,
                      source_bud_id: bud?.id,
                      assistant_name: (bud?.default_json as any)?.name,
                      assistant_avatar: (bud?.default_json as any)?.avatar,
                      model_config_overrides: undefined,
                      mcp_config_overrides: undefined,
                      created_at: new Date().toISOString()
                    };
                    
                    const conversation: Conversation = {
                      id: conversationId,
                      events: events, // Use the current events
                      isStreaming: true,
                      meta: conversationMeta
                    };
                    
                    // Store the conversation and add to workspace
                    setConversation(conversationId, conversation);
                    addConversationToWorkspace(selectedWorkspace, conversationId);
                  }
                  break;
                  
                case 'token':
                  setEvents(prevEvents => 
                    prevEvents.map(event => 
                      event.id === assistantPlaceholder.id 
                        ? { 
                          ...event, 
                          segments: event.segments.map(s => 
                            s.type === 'text' ? { ...s, text: s.text + data.content } : s
                          ),
                          ts: Date.now()
                        }
                        : event
                    )
                  );
                  break;
                  
                case 'debug':
                  // Emit debug event for debug panel
                  if (typeof window !== 'undefined' && localStorage.getItem('debug-mode') === 'true') {
                    const debugEvent = {
                      id: Math.random().toString(36).substr(2, 9),
                      timestamp: new Date().toISOString(),
                      type: data.debug_type,
                      data: data.data,
                      conversationId: conversationId || 'new-conversation'
                    };
                    window.dispatchEvent(new CustomEvent('debug-event', { detail: debugEvent }));
                  }
                  break;
                  
                case 'tool_start':
                  // Handle tool start - add the tool call segment
                  setEvents(prevEvents => 
                    prevEvents.map(event => 
                      event.id === assistantPlaceholder.id 
                        ? { 
                          ...event, 
                          segments: [
                            ...event.segments.filter(s => s.type === 'text').map(s => ({ ...s, text: s.text + data.content })),
                            ...event.segments.filter(s => s.type !== 'text'),
                            {
                              type: 'tool_call',
                              id: data.tool_id,
                              name: data.tool_name,
                              args: data.tool_arguments || {}
                            }
                          ],
                          ts: Date.now()
                        }
                        : event
                    )
                  );
                  break;
                  
                case 'tool_complete':
                case 'tool_error':
                  // Handle tool completion - just add content but preserve tool calls
                  setEvents(prevEvents => 
                    prevEvents.map(event => 
                      event.id === assistantPlaceholder.id 
                        ? { 
                          ...event, 
                          segments: event.segments.map(s => 
                            s.type === 'text' ? { ...s, text: s.text + data.content } : s
                          ),
                          ts: Date.now()
                        }
                        : event
                    )
                  );
                  break;
                  
                case 'complete':
                  setIsStreaming(false);
                  setStreamingEventId(null);
                  
                  // Update final content while preserving tool call segments
                  const finalEvents = newEvents.map(event => 
                    event.id === assistantPlaceholder.id 
                      ? { 
                        ...event, 
                        segments: event.segments.map(s => 
                          s.type === 'text' ? { ...s, text: data.content } : s
                        ),
                        ts: Date.now()
                      }
                      : event
                  );
                  setEvents(finalEvents);
                  
                  // CRITICAL: Seamless transition
                  if (conversationId) {
                    console.log('🔄 Transitioning to real conversation:', conversationId);
                    
                    // 4. Pre-populate Zustand store with local state
                    const budConfig = bud?.default_json as any;
                    // Check if conversation already exists in store (from realtime update)
                    const existingConversation = useEventChatStore.getState().conversations[conversationId];
                    
                    const conversationMeta: ConversationMeta = {
                      id: conversationId,
                      title: existingConversation?.meta.title, // No default title - let backend set it
                      workspace_id: selectedWorkspace,
                      source_bud_id: bud?.id,
                      // Include resolved assistant identity from bud for optimistic display
                      assistant_name: budConfig?.name || 'Assistant',
                      assistant_avatar: budConfig?.avatar || '🤖',
                      model_config_overrides: undefined,
                      created_at: new Date().toISOString()
                    };
                    
                    const conversation: Conversation = {
                      id: conversationId,
                      events: updateEventsConversationId(finalEvents, conversationId),
                      isStreaming: false,
                      meta: conversationMeta
                    };
                    
                    setConversation(conversationId, conversation);
                    
                    // 5. Navigate - ChatPage will find data already in store (zero flash!)
                    router.push(`/chat/${conversationId}`);
                  }
                  break;
                  
                case 'error':
                  console.error('Streaming error:', data.error);
                  setIsStreaming(false);
                  setStreamingEventId(null);
                  // TODO: Show error to user
                  break;
              }
            } catch (e) {
              console.error('Error parsing stream data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to start streaming:', error);
      setIsStreaming(false);
      setStreamingEventId(null);
      // TODO: Show error to user
    }
  }, [events, selectedWorkspace, setConversation, router]);

  // Show workspace selection prompt (layout handles auth)
  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Please select a workspace to continue</p>
        </div>
      </div>
    );
  }

  // Show loading while bud is loading
  if (budLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Loading bud...</p>
        </div>
      </div>
    );
  }

  // Render chat interface with local state
  const placeholder = bud 
    ? `Chat with ${(bud.default_json as any).name || 'your bud'}...`
    : 'Start a new conversation...';

  return (
    <EventStream
      events={events}
      isStreaming={isStreaming}
      onSendMessage={handleSendMessage}
      placeholder={placeholder}
      budData={bud}
    />
  );
}