'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { 
  useConversations,
  useSetConversation,
  useWorkspaceConversations,
  useAddConversationToWorkspace,
  useRemoveConversationFromWorkspace,
  useSetWorkspaceConversations,
  useSelectedWorkspace,
  useConversation,
  Conversation,
  ConversationMeta
} from '@/state/eventChatStore';
import { usePathname } from 'next/navigation';
import { WorkspaceId, ConversationId } from '@/lib/types';
import { cn } from '@/lib/utils';
import { 
  MessageSquare, 
  MoreHorizontal, 
  Trash2, 
  GitBranch,
  Loader2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface ConversationListProps {
  workspaceId: WorkspaceId
}

export function ConversationList({ workspaceId }: ConversationListProps) {
  const router = useRouter();
  const pathname = usePathname();
  
  const conversationsRecord = useConversations();
  const workspaceConversationIds = useWorkspaceConversations(workspaceId);
  
  const setConversation = useSetConversation();
  const addConversationToWorkspace = useAddConversationToWorkspace();
  const removeConversationFromWorkspace = useRemoveConversationFromWorkspace();
  const setWorkspaceConversations = useSetWorkspaceConversations();
  const selectedWorkspace = useSelectedWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const realtimeSetupRef = useRef(false);
  const preloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get conversations for this workspace
  const workspaceConversations = useMemo(() => {
    const conversationIds = workspaceConversationIds || [];
    
    const result = conversationIds
      .map(conversationId => conversationsRecord[conversationId])
      .filter(Boolean) // Remove any undefined conversations
      .map(conversation => conversation.meta) // Extract metadata for list display
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); // Sort by newest first
    
    // Debug logging to understand memoization
    if (process.env.NODE_ENV === 'development') {
      console.log('📝 ConversationList useMemo recalculated:', {
        workspaceId,
        conversationCount: result.length,
        conversationTitles: result.map(c => ({ id: c.id, title: c.title }))
      });
    }
    
    return result;
  }, [workspaceConversationIds, conversationsRecord]);
  
  // Extract current conversation ID from URL
  const currentConversationId = pathname.split('/').pop();

  // Load conversations for the workspace and add them to ChatStore
  useEffect(() => {
    const loadConversations = async () => {
      if (!workspaceId) {
        return;
      }
      
      // Check if we already have conversations loaded for this workspace
      const existingIds = workspaceConversationIds || [];
      if (existingIds.length > 0) {
        return;
      }
      
      try {
        setIsLoading(true);
        
        const response = await fetch(`/api/conversations?workspace_id=${workspaceId}`);
        if (response.ok) {
          const conversationsData = await response.json();
          
          // Store conversations using new simple store
          const conversationIds: string[] = [];
          
          conversationsData.forEach((conv: any) => {
            const conversationMeta: ConversationMeta = {
              id: conv.id,
              title: conv.title, // Don't set default title
              workspace_id: conv.workspace_id,
              bud_id: conv.bud_id,
              created_at: conv.created_at
            };
            
            const conversation: Conversation = {
              id: conv.id,
              events: [], // Events will be loaded when conversation is opened
              isStreaming: false,
              meta: conversationMeta
            };
            
            // Store conversation in the new store
            setConversation(conv.id, conversation);
            conversationIds.push(conv.id);
          });
          
          // Set all conversation IDs for this workspace at once
          setWorkspaceConversations(workspaceId, conversationIds);
        } else {
          console.error('Failed to load conversations:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Failed to load conversations:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadConversations();
  }, [workspaceId]);

  // Note: Realtime updates are now handled centrally in the event chat store (eventChatStore.ts)
  // This prevents duplicate subscriptions and title conflicts

  const handleConversationDelete = useCallback(async (conversationId: ConversationId, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this conversation?')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        removeConversationFromWorkspace(workspaceId, conversationId);
        
        // If this was the selected conversation, navigate to new
        if (currentConversationId === conversationId) {
          router.push('/new');
        }
      } else {
        console.error('Failed to delete conversation');
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }, [removeConversationFromWorkspace, workspaceId, currentConversationId, router]);

  const handleConversationBranch = useCallback((conversationId: ConversationId, e: React.MouseEvent) => {
    e.stopPropagation();
    // TODO: Implement conversation branching
  }, []);
  
  // Preload conversation messages on hover (debounced)
  const handleConversationHover = useCallback((conversationId: ConversationId) => {
    // Clear any existing timeout
    if (preloadTimeoutRef.current) {
      clearTimeout(preloadTimeoutRef.current);
    }
    
    // Set up a new timeout for preloading
    preloadTimeoutRef.current = setTimeout(async () => {
      const existingConversation = conversationsRecord[conversationId];
      
      // Only preload if conversation exists but has no events
      if (existingConversation && existingConversation.events.length === 0) {
        try {
          const response = await fetch(`/api/conversations/${conversationId}?include_events=true`);
          if (response.ok) {
            const conversationData = await response.json();
            
            // Update the existing conversation with events
            const updatedConversation: Conversation = {
              ...existingConversation,
              events: conversationData.events || []
            };
            
            setConversation(conversationId, updatedConversation);
          }
        } catch (error) {
          // Silently fail - this is just opportunistic preloading
        }
      }
    }, 150); // 150ms debounce
  }, [conversationsRecord, setConversation]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg animate-pulse">
            <div className="w-4 h-4 bg-muted rounded" />
            <div className="flex-1">
              <div className="w-3/4 h-4 bg-muted rounded mb-1" />
              <div className="w-1/2 h-3 bg-muted rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (workspaceConversations.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No conversations yet</p>
        <p className="text-xs">Start a new conversation to get started</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1 min-h-0 w-full max-w-full">
      {workspaceConversations.map((conversationMeta) => {
        const isSelected = currentConversationId === conversationMeta.id;
        const createdAt = new Date(conversationMeta.created_at);
        const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true });
        
        // Get title from conversation title field or use default
        const getConversationTitle = () => {
          const title = conversationMeta.title || 'Untitled';
          // Debug logging to understand title updates
          if (process.env.NODE_ENV === 'development') {
            console.log(`📝 Rendering conversation ${conversationMeta.id} with title:`, title);
          }
          return title;
        };
        
        return (
          <Link
            key={`${conversationMeta.id}-${conversationMeta.title || 'untitled'}`}
            href={`/chat/${conversationMeta.id}`}
            prefetch={false}
            onMouseEnter={() => handleConversationHover(conversationMeta.id)}
            className={cn(
              'group flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted/50 w-full max-w-full overflow-hidden block',
              isSelected && 'bg-muted'
            )}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium truncate flex-1 min-w-0">
                  {getConversationTitle()}
                </p>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => handleConversationBranch(conversationMeta.id, e)}>
                        <GitBranch className="h-3 w-3 mr-2" />
                        Branch
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={(e) => handleConversationDelete(conversationMeta.id, e)}
                        className="text-destructive"
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {timeAgo}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
