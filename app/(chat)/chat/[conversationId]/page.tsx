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
  ConversationMeta,
  Event
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
    enabled: !isNewConversation && !isTempConversation && !!conversationId && !existingConversation,
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
        // Use the effective identity computed by the server, with fallbacks
        assistant_name: conversationData.effective_assistant_name || 'Assistant',
        assistant_avatar: conversationData.effective_assistant_avatar || '🤖',
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
            assistant_name: budConfig?.name || 'Assistant',
            assistant_avatar: budConfig?.avatar || '🤖',
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
  
  // Local streaming state for new conversations
  const [streamingEvents, setStreamingEvents] = useState<Event[] | null>(null);
  const [isLocalStreaming, setIsLocalStreaming] = useState(false);
  
  // Clear streaming events when store conversation is ready (for seamless transitions)
  useEffect(() => {
    if (!isNewConversation && existingConversation && existingConversation.events.length > 0 && streamingEvents) {
      setStreamingEvents(null);
      setIsLocalStreaming(false);
    }
  }, [isNewConversation, existingConversation, streamingEvents]);

  // Message handler for new conversations
  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace || !isNewConversation) return;

    const currentConversation = useEventChatStore.getState().conversations[tempConversationId];
    const currentEvents = currentConversation?.events || [];
    
    const userEvent = createUserEvent(content);
    const assistantPlaceholder = createAssistantPlaceholder();
    const newEvents = [...currentEvents, userEvent, assistantPlaceholder];
    
    // Set local streaming state instead of updating store immediately
    setStreamingEvents(newEvents);
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

      const eventHandler = new FrontendEventHandler(
        tempConversationId,
        useEventChatStore,
        { debug: true }
      );
      
      // Set up local state updater for streaming and track final events
      let finalStreamingEvents: Event[] = newEvents; // Track events outside React state
      
      eventHandler.setLocalStateUpdater((updater) => {
        setStreamingEvents(prevEvents => {
          if (!prevEvents) return prevEvents;
          const updated = updater(prevEvents);
          finalStreamingEvents = updated; // Keep sync'd copy for transition
          return updated;
        });
      }, assistantPlaceholder);
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

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
              } else if (data.type === 'complete') {
                setIsLocalStreaming(false);
                
                
                if (realConversationId && finalStreamingEvents) {
                  // Create final conversation with completed streaming events
                  const tempConv = store.conversations[tempConversationId];
                  if (tempConv) {
                    const realConv = {
                      ...tempConv,
                      id: realConversationId,
                      events: finalStreamingEvents, // Use final streaming events
                      isStreaming: false,
                      streamingEventId: undefined,
                      meta: { ...tempConv.meta, id: realConversationId }
                    };
                    
                    store.setConversation(realConversationId, realConv);
                    store.removeConversation(tempConversationId);
                    store.removeConversationFromWorkspace(selectedWorkspace, tempConversationId);
                    
                    // Update URL using Next.js router - this will trigger pathname updates
                    router.replace(`/chat/${realConversationId}`);
                    
                    // Update the current conversation ID for this component
                    setCurrentConversationId(realConversationId);
                    
                    // Clear local streaming state since store now has the data
                    setStreamingEvents(null);
                    setIsLocalStreaming(false);
                  } else {
                    console.error('No temp conversation found for transition');
                  }
                } else {
                  console.error('🚨 ERROR CONDITION:', {
                    realConversationId: realConversationId,
                    finalStreamingEvents: finalStreamingEvents,
                    finalStreamingEventsCount: finalStreamingEvents?.length,
                    dataType: data.type,
                    dataKeys: Object.keys(data)
                  });
                  console.error('Missing realConversationId or finalStreamingEvents');
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
      setStreamingEvents(null);
    }
  }, [selectedWorkspace, isNewConversation, tempConversationId, addConversationToWorkspace, bud?.id, router]);

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
  if (!isNewConversation && !isTempConversation && !existingConversation && !conversationData && !streamingEvents && isLoading) {
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
  const shouldUseStreamingEvents = streamingEvents && streamingEvents.length > 0;
  
  return (
    <EventStream
      conversationId={isNewConversation ? undefined : workingConversationId}
      events={shouldUseStreamingEvents ? streamingEvents : isNewConversation && existingConversation?.events ? existingConversation.events : undefined}
      onSendMessage={isNewConversation ? handleSendMessage : undefined}
      placeholder={placeholder}
      budData={bud || undefined}
      isStreaming={shouldUseStreamingEvents ? isLocalStreaming : undefined}
    />
  );

}
