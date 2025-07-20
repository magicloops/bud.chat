'use client';

import { use, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { useBud } from '@/state/budStore';
import { FrontendEventHandler } from '@/lib/streaming/frontendEventHandler';

interface ChatPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ChatPage({ params }: ChatPageProps) {
  const resolvedParams = use(params);
  const conversationId = resolvedParams.conversationId;
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Track if we've transitioned from new -> real ID to prevent re-renders
  const hasTransitionedRef = useRef(false);
  const realConversationIdRef = useRef<string | null>(null);
  
  // Check if this is a new conversation
  const isNewConversation = conversationId === 'new' && !hasTransitionedRef.current;
  
  // Use real conversation ID if we've transitioned, otherwise use URL ID
  const effectiveConversationId = realConversationIdRef.current || conversationId;
  
  // Generate temporary ID for new conversations (stable across renders)
  const tempId = useMemo(() => 
    isNewConversation ? crypto.randomUUID() : effectiveConversationId, 
    [isNewConversation, effectiveConversationId]
  );
  
  // Use tempId for new conversations, effectiveConversationId for existing
  const workingConversationId = isNewConversation ? tempId : effectiveConversationId;
  
  const selectedWorkspace = useSelectedWorkspace();
  const setSelectedWorkspace = useSetSelectedWorkspace();
  const setConversation = useSetConversation();
  const addConversationToWorkspace = useAddConversationToWorkspace();
  
  // New conversation state (only for new conversations)
  const budId = searchParams.get('bud');
  const storeBud = useBud(budId || '');
  const [bud, setBud] = useState<Bud | null>(null);
  const [budLoading, setBudLoading] = useState(!!budId && isNewConversation);
  const [events, setEvents] = useState<Event[]>([]);
  const [, setIsStreaming] = useState(false);
  
  // Check if conversation is already in store
  const existingConversation = useConversation(workingConversationId);

  // Fetch conversation from server if not in store and not a new conversation
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
    enabled: !isNewConversation && !hasTransitionedRef.current && !!conversationId && !existingConversation,
    staleTime: Infinity, // Don't refetch unless manually invalidated
    gcTime: Infinity,
  });

  // Load bud for new conversations
  useEffect(() => {
    if (!isNewConversation || hasTransitionedRef.current) return;
    
    const loadBud = async () => {
      if (!budId) {
        // No bud specified, use default events and clear any custom theme
        setEvents([
          createGreetingEvent(),
          ...createSystemEvents()
        ]);
        
        // Clear any existing custom theme
        const root = document.documentElement;
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
        const budConfig = loadedBud.default_json as Record<string, any>;
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
  }, [budId, isNewConversation, conversationId, tempId, selectedWorkspace, setConversation]);
  
  // Watch for bud updates from store and regenerate events (new conversations only)
  useEffect(() => {
    if (!isNewConversation || !budId || !storeBud || hasTransitionedRef.current) return;
    
    // Update local bud state
    setBud(storeBud);
    
    // Regenerate events with updated bud configuration
    const budEvents = createBudInitialEvents(storeBud);
    setEvents(budEvents);
    
    // Apply updated theme
    const budConfig = storeBud.default_json as Record<string, any>;
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
  }, [budId, storeBud, isNewConversation]);

  // Load conversation data into store when received from server (existing conversations only)
  useEffect(() => {
    if (isNewConversation || hasTransitionedRef.current) return;
    
    console.log('🔄 [EFFECT] Conversation loading effect triggered', {
      timestamp: Date.now(),
      conversationId,
      hasConversationData: !!conversationData,
      hasExistingConversation: !!existingConversation,
      existingEventCount: existingConversation?.events?.length || 0,
      trigger: 'dependency change'
    });
    
    if (conversationData && (!existingConversation || existingConversation.events.length === 0)) {
      
      console.log('📊 [LOAD] Loading conversation from API', {
        timestamp: Date.now(),
        conversationId,
        apiEventCount: conversationData?.events?.length || 0,
        existingEventCount: existingConversation?.events?.length || 0,
        willOverwrite: !existingConversation || existingConversation.events.length === 0
      });
      
      console.log('🔍 Loading conversation data:', {
        id: conversationData.id,
        assistant_name: conversationData.assistant_name,
        assistant_avatar: conversationData.assistant_avatar,
        effective_assistant_name: conversationData.effective_assistant_name,
        effective_assistant_avatar: conversationData.effective_assistant_avatar,
        source_bud_id: conversationData.source_bud_id
      });
      
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
  }, [conversationData, existingConversation, setConversation, selectedWorkspace, setSelectedWorkspace, isNewConversation]);
  
  // Handle sending messages (unified for both new and existing conversations)
  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedWorkspace) {
      console.error('No workspace selected');
      return;
    }

    if (isNewConversation) {
      // NEW CONVERSATION FLOW: Create temporary conversation and stream immediately
      const userEvent = createUserEvent(content);
      const assistantPlaceholder = createAssistantPlaceholder();
      
      // Get current events from store
      const currentConversation = useEventChatStore.getState().conversations[tempId];
      const currentEvents = currentConversation?.events || [];
      const newEvents = [...currentEvents, userEvent, assistantPlaceholder];
      
      // Store in Zustand with temporary ID immediately
      const store = useEventChatStore.getState();
      const budConfig = bud?.default_json as Record<string, any>;
      
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
        // Start streaming immediately
        console.log('📡 Starting streaming request...');
        const response = await fetch('/api/chat-new', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages: [...currentEvents, userEvent],
            workspaceId: selectedWorkspace,
            budId: bud?.id,
            model: bud ? (bud.default_json as Record<string, any>).model || 'gpt-4o' : 'gpt-4o'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Process streaming with unified handler
        let realConversationId: string | null = null;
        let hasTransitioned = false;
        
        const eventHandler = new FrontendEventHandler(
          tempId,
          useEventChatStore,
          { debug: true }
        );
        
        eventHandler.setLocalStateUpdater(null, assistantPlaceholder);
        
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
                  realConversationId = data.conversationId;
                  console.log('💾 Conversation created:', realConversationId);
                  
                  if (selectedWorkspace && realConversationId) {
                    const conversationMetaForWorkspace: ConversationMeta = {
                      id: realConversationId,
                      title: 'New Chat',
                      workspace_id: selectedWorkspace,
                      source_bud_id: bud?.id,
                      assistant_name: (bud?.default_json as Record<string, any>)?.name,
                      assistant_avatar: (bud?.default_json as Record<string, any>)?.avatar,
                      model_config_overrides: undefined,
                      mcp_config_overrides: undefined,
                      created_at: new Date().toISOString()
                    };
                    
                    addConversationToWorkspace(selectedWorkspace, realConversationId);
                  }
                } else if (data.type === 'debug') {
                  // Handle debug events
                  if (typeof window !== 'undefined' && localStorage.getItem('debug-mode') === 'true') {
                    const debugEvent = {
                      id: Math.random().toString(36).substr(2, 9),
                      timestamp: new Date().toISOString(),
                      type: data.debug_type,
                      data: data.data,
                      conversationId: realConversationId || 'new-conversation'
                    };
                    window.dispatchEvent(new CustomEvent('debug-event', { detail: debugEvent }));
                  }
                } else if (data.type === 'complete') {
                  console.log('🏁 Complete event received', { realConversationId, tempId, hasTransitioned });
                  setIsStreaming(false);
                  
                  // SEAMLESS TRANSITION: Update store and URL without page navigation
                  if (realConversationId && tempId && !hasTransitioned) {
                    hasTransitioned = true;
                    console.log('🔄 Seamless transition: renaming temp conversation', {
                      from: tempId,
                      to: realConversationId
                    });
                    
                    const store = useEventChatStore.getState();
                    const tempConversation = store.conversations[tempId];
                    
                    if (tempConversation) {
                      // Copy conversation to real ID (don't remove temp yet)
                      const updatedConversation = {
                        ...tempConversation,
                        id: realConversationId,
                        isStreaming: false,
                        streamingEventId: undefined,
                        meta: {
                          ...tempConversation.meta,
                          id: realConversationId
                        }
                      };
                      
                      // Set conversation with real ID
                      store.setConversation(realConversationId, updatedConversation);
                      
                      // Update workspace conversation list
                      store.addConversationToWorkspace(selectedWorkspace, realConversationId);
                      
                      // Update our working conversation ID to the real one
                      realConversationIdRef.current = realConversationId;
                      hasTransitionedRef.current = true;
                      
                      // Remove temp conversation AFTER we've switched (prevents flash)
                      setTimeout(() => {
                        const currentStore = useEventChatStore.getState();
                        currentStore.removeConversation(tempId);
                        currentStore.removeConversationFromWorkspace(selectedWorkspace, tempId);
                      }, 100);
                    }
                    
                    // NATIVE BROWSER URL UPDATE: Use History API directly
                    window.history.replaceState(
                      { ...window.history.state },
                      '',
                      `/chat/${realConversationId}`
                    );
                    
                    console.log('🎯 Seamless transition complete - URL updated via native History API');
                  }
                } else {
                  // Handle all other streaming events
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
      }
    } else {
      // EXISTING CONVERSATION FLOW: Use existing EventStream logic
      // This will be handled by the EventStream component's onSendMessage prop
      console.log('Existing conversation flow - handled by EventStream component');
    }
  }, [selectedWorkspace, addConversationToWorkspace, router, bud, isNewConversation, tempId, setConversation]);

  // Show loading state (layout handles auth)
  if ((!isNewConversation && isLoading) || (isNewConversation && budLoading)) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Show error state (only for existing conversations)
  if (!isNewConversation && error) {
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

  // Show loading state while conversation loads (existing conversations only)
  if (!isNewConversation && !existingConversation && !conversationData) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Render chat interface with unified store state (no local events)
  // Always use store state and effectiveConversationId for seamless transitions
  const placeholder = isNewConversation && bud 
    ? `Chat with ${(bud.default_json as Record<string, any>).name || 'your bud'}...`
    : isNewConversation 
    ? 'Start a new conversation...' 
    : 'Type your message...';

  return (
    <EventStream
      conversationId={workingConversationId}
      onSendMessage={isNewConversation ? handleSendMessage : undefined}
      placeholder={placeholder}
      budData={isNewConversation ? bud : undefined}
    />
  );
}