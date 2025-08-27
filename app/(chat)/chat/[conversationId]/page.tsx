'use client';

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { EventStream } from '@/components/EventStream';
import { Loader2 } from 'lucide-react';
import { 
  useConversation, 
  useSetConversation, 
  useSelectedWorkspace,
  useSetSelectedWorkspace,
  useAddConversationToWorkspace,
  useEventChatStore,
  Conversation,
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
import { FrontendEventHandler } from '@/lib/streaming/frontendEventHandler';

interface ChatPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ChatPage({ params }: ChatPageProps) {
  const resolvedParams = use(params);
  const initialConversationId = resolvedParams.conversationId;
  const searchParams = useSearchParams();
  const router = useRouter();
  
  
  // Track the current conversation ID (may change from 'new' to real ID during streaming)
  const [currentConversationId, setCurrentConversationId] = useState(initialConversationId);
  
  // Update conversation ID when route changes
  useEffect(() => {
    setCurrentConversationId(initialConversationId);
  }, [initialConversationId]);
  
  // Listen for instant conversation switching events
  useEffect(() => {
    const handleConversationSwitch = (event: CustomEvent) => {
      const { conversationId: newConversationId } = event.detail;
      setCurrentConversationId(newConversationId);
    };
    
    window.addEventListener('switchConversation', handleConversationSwitch as EventListener);
    
    return () => {
      window.removeEventListener('switchConversation', handleConversationSwitch as EventListener);
    };
  }, []);

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      // Extract conversation ID from current URL
      const currentPath = window.location.pathname;
      const match = currentPath.match(/\/chat\/([^\/]+)/);
      const urlConversationId = match ? match[1] : '';
      
      if (urlConversationId && urlConversationId !== currentConversationId) {
        console.log('🔙 Browser navigation detected:', currentConversationId, '→', urlConversationId);
        setCurrentConversationId(urlConversationId);
      }
    };
    
    window.addEventListener('popstate', handlePopState);
    
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [currentConversationId]);
  
  // Use current conversation ID for all logic
  const conversationId = currentConversationId;
  const isNewConversation = conversationId === 'new';
  const isTempConversation = conversationId.startsWith('temp-branch-');
  
  // State for new conversations only
  const budId = searchParams.get('bud');
  const [bud, setBud] = useState<Bud | null>(null);
  const [budLoading, setBudLoading] = useState(!!budId && isNewConversation);
  
  // Generate temporary ID for new conversations (stable)
  const tempConversationId = useMemo(() => 
    isNewConversation ? crypto.randomUUID() : conversationId, 
    [isNewConversation, conversationId]
  );
  
  const selectedWorkspace = useSelectedWorkspace();
  const setSelectedWorkspace = useSetSelectedWorkspace();
  const setConversation = useSetConversation();
  const addConversationToWorkspace = useAddConversationToWorkspace();
  
  // Use temp ID for new conversations, real ID for existing
  const workingConversationId = isNewConversation ? tempConversationId : conversationId;
  
  // Check if conversation is already in store
  const existingConversation = useConversation(workingConversationId);


  // Check if we have the conversation under the real ID (after transition)
  const realConversation = useConversation(conversationId);
  
  // Fetch conversation from server if not in store
  const { data: conversationData, isLoading, error } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const response = await fetch(`/api/conversations/${conversationId}?include_events=true`);
      if (!response.ok) {
        throw new Error(`Failed to fetch conversation: ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    },
    // Only fetch if we don't have the conversation in store under either the working ID or real ID
    enabled: !isNewConversation && !isTempConversation && !!conversationId && !existingConversation && !realConversation,
    staleTime: 5 * 60 * 1000, // 5 minutes - allow periodic refresh for title updates
    gcTime: Infinity,
  });


  // Load conversation data into store when received from server
  useEffect(() => {
    if (conversationData && (!existingConversation || existingConversation.events.length === 0)) {
      
      const conversationMeta: ConversationMeta = {
        id: conversationData.id,
        title: conversationData.title || 'Chat',
        workspace_id: conversationData.workspace_id,
        source_bud_id: conversationData.source_bud_id,
        // Only set assistant identity if explicitly provided (not derived from bud)
        assistant_name: conversationData.assistant_name || undefined,
        assistant_avatar: conversationData.assistant_avatar || undefined,
        model_config_overrides: conversationData.model_config_overrides,
        mcp_config_overrides: conversationData.mcp_config_overrides,
        created_at: conversationData.created_at
      };
      
      const conversation: Conversation = {
        id: conversationData.id,
        events: conversationData.events || [],
        isStreaming: false,
        meta: conversationMeta
      };
      
      
      setConversation(conversationData.id, conversation);
      
      // Apply bud theme if available
      if (conversationData.bud_config?.customTheme) {
        const root = document.documentElement;
        Object.entries(conversationData.bud_config.customTheme.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value as string);
        });
      }
      
      // Switch workspace if needed
      if (conversationData.workspace_id && conversationData.workspace_id !== selectedWorkspace) {
        setSelectedWorkspace(conversationData.workspace_id);
      }
    }
  }, [conversationData, existingConversation, setConversation, selectedWorkspace, setSelectedWorkspace, conversationId]);
  
  // Load bud for new conversations
  useEffect(() => {
    if (!isNewConversation) return;
    
    const loadBud = async () => {
      if (!budId) {
        // No bud specified, create default conversation in store
        const defaultEvents = [
          createGreetingEvent(),
          ...createSystemEvents()
        ];
        
        const defaultConversation = {
          id: tempConversationId,
          events: defaultEvents,
          isStreaming: false,
          meta: {
            id: tempConversationId,
            title: 'New Chat',
            workspace_id: selectedWorkspace || '',
            assistant_name: 'Assistant',
            assistant_avatar: '🤖',
            created_at: new Date().toISOString()
          }
        };
        
        setConversation(tempConversationId, defaultConversation);
        setBudLoading(false);
        return;
      }

      // Don't create any store conversation yet - let EventStream handle optimistic display
      // until bud loads completely
      try {
        setBudLoading(true);
        const loadedBud = await budManager.getBud(budId);
        setBud(loadedBud);
        
        const budEvents = createBudInitialEvents(loadedBud);
        const budConfig = loadedBud.default_json;
        
        const budConversation = {
          id: tempConversationId,
          events: budEvents,
          isStreaming: false,
          meta: {
            id: tempConversationId,
            title: 'New Chat',
            workspace_id: selectedWorkspace || '',
            source_bud_id: loadedBud.id,
            // Don't set assistant name/avatar - let the UI derive from bud config
            created_at: new Date().toISOString()
          }
        };
        
        setConversation(tempConversationId, budConversation);
        
        // Apply theme
        if (budConfig?.customTheme) {
          const root = document.documentElement;
          Object.entries(budConfig.customTheme.cssVariables).forEach(([key, value]) => {
            root.style.setProperty(key, value as string);
          });
        }
      } catch (error) {
        console.error('Failed to load bud:', error);
        // Fallback
        const fallbackEvents = [
          createGreetingEvent(),
          ...createSystemEvents()
        ];
        
        const fallbackConversation = {
          id: tempConversationId,
          events: fallbackEvents,
          isStreaming: false,
          meta: {
            id: tempConversationId,
            title: 'New Chat',
            workspace_id: selectedWorkspace || '',
            assistant_name: 'Assistant',
            assistant_avatar: '🤖',
            created_at: new Date().toISOString()
          }
        };
        
        setConversation(tempConversationId, fallbackConversation);
      } finally {
        setBudLoading(false);
      }
    };

    loadBud();
  }, [budId, isNewConversation, tempConversationId, selectedWorkspace, setConversation]);
  
  // Local streaming flag for new conversations (leaf components handle rendering)
  const [isLocalStreaming, setIsLocalStreaming] = useState(false);

  // Message handler for new conversations  
  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace || !isNewConversation) return;

    const currentConversation = useEventChatStore.getState().conversations[tempConversationId];
    const currentEvents = currentConversation?.events || [];
    
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    // debug logs removed
    
    // Set local streaming flag; rendering uses leaf streaming component
    setIsLocalStreaming(true);
    
    // Only update store with user event + placeholder (no streaming updates)
    const updatedConversation = {
      ...currentConversation!,
      events: [...currentEvents, userEvent, assistantPlaceholder],
      isStreaming: true,
      streamingEventId: assistantPlaceholder.id
    };
    
    const store = useEventChatStore.getState();
    store.setConversation(tempConversationId, updatedConversation);
    if (selectedWorkspace) {
      addConversationToWorkspace(selectedWorkspace, tempConversationId);
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'new',
          messages: [...currentEvents, userEvent],
          workspaceId: selectedWorkspace,
          budId: bud?.id,
          model: bud ? bud.default_json.model || 'gpt-4o' : 'gpt-4o'
        })
      });

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      // Track the final event emitted by the server so we can commit
      // canonical segments to the real conversation even if 'complete'
      // arrives before 'message_final'. We also gate the route swap on
      // receiving message_final (with a timeout fallback) to avoid the
      // missing "Show Reasoning" button after swap.
      let lastFinalEvent: import('@/state/eventChatStore').Event | null = null;
      let finalReceived = false;
      let resolveFinal: (() => void) | null = null;
      const waitForFinal = new Promise<void>((resolve) => { resolveFinal = resolve; });

      const eventHandler = new FrontendEventHandler(
        tempConversationId,
        useEventChatStore,
        { 
          debug: true,
          onMessageFinal: (finalEvent) => {
            // Replace the assistant placeholder in the temp conversation with the canonical final event
            const store = useEventChatStore.getState();
            const tempConv = store.conversations[tempConversationId];
            if (!tempConv) return;
            const events = [...tempConv.events];
            // Match the client-side assistant placeholder id
            const idx = events.findIndex(e => e.id === assistantPlaceholder.id);
            if (idx >= 0) {
              events[idx] = finalEvent;
            } else {
              events.push(finalEvent);
            }
            store.setConversation(tempConversationId, {
              ...tempConv,
              events,
              // keep streaming true until 'complete', but event content is now canonical
            });

            // Cache for real conversation assembly after 'complete'
            lastFinalEvent = finalEvent;
            finalReceived = true;
            if (resolveFinal) resolveFinal();
          }
        }
      );
      
      // No local state updater needed for tokens; FrontendEventHandler will write to streaming bus
      // Use local streaming mode to avoid store writes during /chat/new
      eventHandler.setLocalStateUpdater(() => {}, assistantPlaceholder, { useLocalStreaming: true });
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');
      // debug logs removed

      const decoder = new TextDecoder();
      let realConversationId: string | null = null;

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
                realConversationId = data.conversationId;
                if (selectedWorkspace && realConversationId) {
                  addConversationToWorkspace(selectedWorkspace, realConversationId);
                }
                // debug logs removed
              } else if (data.type === 'message_final') {
                await eventHandler.handleStreamEvent(data);
              } else if (data.type === 'complete') {
                // Do not end local streaming yet; keep streaming summary visible
                // until we have committed the canonical final event (or timed out).
                
                
                if (realConversationId) {
                  // Create final conversation with completed streaming events
                  const latestStore = useEventChatStore.getState();
                  const tempConv = latestStore.conversations[tempConversationId];
                  if (tempConv) {
                    // debug logs removed

                    // Wait briefly for message_final if it hasn't arrived yet
                    if (!finalReceived) {
                      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 800));
                      await Promise.race([waitForFinal, timeout]);
                    }
                    // Merge buffered streaming text from bus into the streaming event
                    const { streamingBus } = await import('@/lib/streaming/streamingBus');
                    const appended = streamingBus.get(assistantPlaceholder.id);
                    const mergedEvents = [...tempConv.events];
                    const idx = mergedEvents.findIndex(e => e.id === assistantPlaceholder.id);
                    if (idx >= 0) {
                      // If we already received message_final, ensure the canonical event is present
                      if (lastFinalEvent) {
                        mergedEvents[idx] = lastFinalEvent;
                      }
                      const ev = mergedEvents[idx];
                      const hasNonTextSegments = ev.segments.some(s => s.type !== 'text');
                      // Only merge appended streaming text if the event is still a plain text placeholder
                      if (!hasNonTextSegments && appended && appended.length > 0) {
                        const segIdx = ev.segments.findIndex(s => s.type === 'text');
                        if (segIdx >= 0) {
                          const seg = ev.segments[segIdx];
                          if (seg.type === 'text') {
                            const newSeg = { ...seg, text: (seg.text || '') + appended };
                            const newSegments = [...ev.segments];
                            newSegments[segIdx] = newSeg;
                            mergedEvents[idx] = { ...ev, segments: newSegments };
                            // debug logs removed
                          }
                        }
                      }
                    }
                    const realConv = {
                      ...tempConv,
                      id: realConversationId,
                      events: mergedEvents,
                      isStreaming: false,
                      streamingEventId: undefined,
                      meta: { 
                        ...tempConv.meta, 
                        id: realConversationId
                      }
                    };
                    
                    // debug logs removed
                    // Set real conversation first so EventStream can immediately render it
                    latestStore.setConversation(realConversationId, realConv);
                    // Clear buses for this event after final text is in store
                    streamingBus.clear(assistantPlaceholder.id);
                    streamingBus.clearReasoning(assistantPlaceholder.id);
                    
                    // Defer removal of the temp conversation until after route swap
                    // to avoid a brief empty render between temp -> real
                    setTimeout(() => {
                      const s = useEventChatStore.getState();
                      s.removeConversation(tempConversationId);
                      if (selectedWorkspace) {
                        s.removeConversationFromWorkspace(selectedWorkspace, tempConversationId);
                      }
                    }, 0);

                    // Update URL using Next.js router - this will trigger pathname updates
                    // debug logs removed
                    router.replace(`/chat/${realConversationId}`);
                    
                    // Update the current conversation ID for this component
                    setCurrentConversationId(realConversationId);
                    
                    // Clear local streaming state since store now has the data
                    setIsLocalStreaming(false);
                  } else {
                    console.error('No temp conversation found for transition');
                  }
                } else {
                  console.error('Missing realConversationId when stream completed');
                }
              } else {
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
      setIsLocalStreaming(false);
    }
  }, [selectedWorkspace, isNewConversation, tempConversationId, addConversationToWorkspace, bud, bud?.id, router]);

  // No periodic flush; leaf components subscribe to streaming bus

  // Show loading state
  if ((!isNewConversation && isLoading) || (isNewConversation && budLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Show error state (only for existing conversations, not temp conversations)
  if (!isNewConversation && !isTempConversation && error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">Conversation not found</p>
          <p className="text-sm">The conversation you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.</p>
        </div>
      </div>
    );
  }

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

  // Show loading state only if neither cached conversation nor fresh data is available
  // In cache-first approach, we always try to show something
  if (!isNewConversation && !isTempConversation && !existingConversation && !conversationData && isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Render chat interface
  const placeholder = isNewConversation && bud 
    ? `Chat with ${bud.default_json.name || 'your bud'}...`
    : isNewConversation 
    ? 'Start a new conversation...'
    : 'Type your message...';

  // Determine which data source to use
  return (
    <EventStream
      conversationId={isNewConversation ? undefined : workingConversationId}
      events={isNewConversation && existingConversation?.events ? existingConversation.events : undefined}
      onSendMessage={isNewConversation ? handleSendMessage : undefined}
      placeholder={placeholder}
      budData={bud || undefined}
      isStreaming={isNewConversation ? (isLocalStreaming || !!existingConversation?.isStreaming) : undefined}
    />
  );

}
