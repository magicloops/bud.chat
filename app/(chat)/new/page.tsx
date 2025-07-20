'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EventStream } from '@/components/EventStream';
import { 
  Event,
  useSelectedWorkspace,
  useSetConversation,
  useAddConversationToWorkspace,
  useEventChatStore,
  ConversationMeta
} from '@/state/eventChatStore';
import { 
  createGreetingEvent, 
  createUserEvent, 
  createAssistantPlaceholder,
  createSystemEvents
} from '@/lib/eventMessageHelpers';
import { 
  createBudInitialEvents,
  budManager
} from '@/lib/budHelpers';
import { Bud } from '@/lib/types';
import { useBud } from '@/state/budStore';
import { FrontendEventHandler } from '@/lib/streaming/frontendEventHandler';
import { OptimisticStateManager } from '@/lib/optimistic/stateTransition';

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
  const [tempConversationId, setTempConversationId] = useState<string | null>(null);

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
          } catch {
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

    
    // 1. Create temporary conversation ID and store immediately
    const tempId = crypto.randomUUID();
    setTempConversationId(tempId);
    
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    
    const newEvents = [...events, userEvent, assistantPlaceholder];
    
    // Store in Zustand with temporary ID immediately
    const store = useEventChatStore.getState();
    const budConfig = bud?.default_json as any;
    
    const tempConversationMeta: ConversationMeta = {
      id: tempId,
      title: 'New Chat',
      workspace_id: selectedWorkspace,
      source_bud_id: bud?.id,
      assistant_name: budConfig?.name || 'Assistant',
      assistant_avatar: budConfig?.avatar || '🤖',
      model_config_overrides: undefined,
      created_at: new Date().toISOString()
    };
    
    const tempConversation = {
      id: tempId,
      events: newEvents,
      isStreaming: true,
      streamingEventId: assistantPlaceholder.id,
      meta: tempConversationMeta
    };
    
    store.setConversation(tempId, tempConversation);
    addConversationToWorkspace(selectedWorkspace, tempId);
    setIsStreaming(true);

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

      // 3. Use unified frontend event handler for optimistic state
      let conversationId: string | null = null;
      let hasTransitioned = false;
      
      // Create event handler for store state management
      const eventHandler = new FrontendEventHandler(
        tempId, // Use temporary conversation ID
        useEventChatStore, // Use store instance
        { debug: true }
      );
      
      // Set assistant placeholder for fallback targeting
      eventHandler.setLocalStateUpdater(null, assistantPlaceholder);
      
      // Create optimistic state manager for seamless transitions
      const stateManager = new OptimisticStateManager({ debug: true, preserveStreamingState: true });
      
      // Process streaming response with custom handling for conversation creation
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'conversationCreated') {
                conversationId = data.conversationId;
                console.log('💾 Conversation created:', conversationId);
                
                // Manually add to sidebar as fallback
                if (selectedWorkspace && conversationId) {
                  console.log('➕ Adding conversation to workspace sidebar:', conversationId);
                  
                  const conversationMeta: ConversationMeta = {
                    id: conversationId,
                    title: 'New Chat',
                    workspace_id: selectedWorkspace,
                    source_bud_id: bud?.id,
                    assistant_name: (bud?.default_json as any)?.name,
                    assistant_avatar: (bud?.default_json as any)?.avatar,
                    model_config_overrides: undefined,
                    mcp_config_overrides: undefined,
                    created_at: new Date().toISOString()
                  };
                  
                  addConversationToWorkspace(selectedWorkspace, conversationId);
                }
              } else if (data.type === 'debug') {
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
              } else if (data.type === 'complete') {
                console.log('🏁 Complete event received', { conversationId, tempConversationId, tempId, hasTransitioned });
                setIsStreaming(false);
                
                // CRITICAL: Seamless transition using temporary conversation ID
                if (conversationId && tempId && !hasTransitioned) {
                  hasTransitioned = true;
                  console.log('🔄 Seamless transition: renaming temp conversation', {
                    from: tempId,
                    to: conversationId
                  });
                  
                  const store = useEventChatStore.getState();
                  const tempConversation = store.conversations[tempId];
                  
                  if (tempConversation) {
                    // Update the conversation with real ID and final state
                    const updatedConversation = {
                      ...tempConversation,
                      id: conversationId,
                      isStreaming: false,
                      streamingEventId: undefined,
                      meta: {
                        ...tempConversation.meta,
                        id: conversationId
                      }
                    };
                    
                    // Set conversation with real ID
                    store.setConversation(conversationId, updatedConversation);
                    
                    // Remove temporary conversation
                    store.removeConversation(tempId);
                    
                    // Update workspace conversation list
                    store.removeConversationFromWorkspace(selectedWorkspace, tempId);
                    store.addConversationToWorkspace(selectedWorkspace, conversationId);
                  }
                  
                  // 5. Navigate - same conversation object, just different ID
                  router.push(`/chat/${conversationId}`);
                }
              } else {
                // Handle all other streaming events with unified handler
                await eventHandler.handleStreamEvent(data);
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
      // TODO: Show error to user
    }
  }, [events, selectedWorkspace, addConversationToWorkspace, router, bud]);

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
      conversationId={tempConversationId || undefined}
      events={tempConversationId ? undefined : events}
      onSendMessage={handleSendMessage}
      placeholder={placeholder}
      budData={bud}
    />
  );
}