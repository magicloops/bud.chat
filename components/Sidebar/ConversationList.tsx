'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { 
  useConversations,
  useSetConversation,
  useConversationSummaries,
  useSetConversationSummaries,
  useWorkspaceConversations,
  useAddConversationToWorkspace,
  useRemoveConversationFromWorkspace,
  useSetWorkspaceConversations,
  useSelectedWorkspace,
  ConversationSummary,
  Conversation,
  ConversationMeta
} from '@/state/eventChatStore';
import type { Conversation as DBConversation } from '@/lib/types';
import { WorkspaceId, ConversationId } from '@/lib/types';
import { cn } from '@/lib/utils';
import { 
  MessageSquare, 
  MoreHorizontal, 
  Trash2, 
  GitBranch
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface ConversationListProps {
  workspaceId: WorkspaceId
}

export function ConversationList({ workspaceId }: ConversationListProps) {
  const router = useRouter();
  const pathname = usePathname();
  
  // Use conversation summaries for sidebar display
  const conversationSummaries = useConversationSummaries();
  const workspaceConversationIds = useWorkspaceConversations(workspaceId);
  
  // Also access full conversations for preloading
  const fullConversations = useConversations();
  
  const setConversationSummaries = useSetConversationSummaries();
  const setConversation = useSetConversation();
  const _addConversationToWorkspace = useAddConversationToWorkspace();
  const removeConversationFromWorkspace = useRemoveConversationFromWorkspace();
  const setWorkspaceConversations = useSetWorkspaceConversations();
  const _selectedWorkspace = useSelectedWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const _realtimeSetupRef = useRef(false);
  const preloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Get conversation summaries for this workspace
  const workspaceConversations = useMemo(() => {
    const conversationIds = workspaceConversationIds || [];
    
    // Remove duplicates as final safety net
    const uniqueConversationIds = [...new Set(conversationIds)];
    
    const result = uniqueConversationIds
      .map(conversationId => conversationSummaries[conversationId])
      .filter(Boolean) // Remove any undefined summaries
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); // Sort by newest first
    
    return result;
  }, [workspaceConversationIds, conversationSummaries]);
  
  // Extract current conversation ID from pathname
  const currentConversationId = useMemo(() => {
    const match = pathname.match(/\/chat\/([^\/]+)/);
    const conversationId = match ? match[1] : '';
    return conversationId;
  }, [pathname]);

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
          
          // Create minimal conversation summaries for sidebar display
          const summaries: ConversationSummary[] = [];
          const conversationIds: string[] = [];
          
          conversationsData.forEach((conv: DBConversation) => {
            const summary: ConversationSummary = {
              id: conv.id,
              title: conv.title || undefined, // Don't set default title
              workspace_id: conv.workspace_id,
              created_at: conv.created_at ?? new Date().toISOString()
            };
            
            summaries.push(summary);
            conversationIds.push(conv.id);
          });
          
          // Store summaries and workspace conversation IDs
          setConversationSummaries(summaries);
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
  
  // Preload full conversation data on hover for faster page transitions
  const handleConversationHover = useCallback((conversationId: ConversationId) => {
    // Clear any existing timeout
    if (preloadTimeoutRef.current) {
      clearTimeout(preloadTimeoutRef.current);
    }
    
    // Set up a new timeout for preloading
    preloadTimeoutRef.current = setTimeout(async () => {
      const existingFullConversation = fullConversations[conversationId];
      
      // Only preload if full conversation doesn't exist or has no events
      if (!existingFullConversation || existingFullConversation.events.length === 0) {
        try {
          const response = await fetch(`/api/conversations/${conversationId}?include_events=true`);
          if (response.ok) {
            const conversationData = await response.json();
            
            // Create full conversation with complete metadata and events
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
            
            const fullConversation: Conversation = {
              id: conversationData.id,
              events: conversationData.events || [],
              isStreaming: false,
              meta: conversationMeta
            };
            
            // Store the full conversation for instant loading when clicked
            setConversation(conversationId, fullConversation);
          }
        } catch (_error) {
          // Silently fail - this is just opportunistic preloading
        }
      }
    }, 150); // 150ms debounce
  }, [fullConversations, setConversation]);

  // Track conversation clicks and use instant state switching
  const handleConversationClick = useCallback((conversationId: ConversationId, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent default Link navigation
    
    // Direct state switching via custom event for instant navigation
    const switchEvent = new CustomEvent('switchConversation', { 
      detail: { conversationId } 
    });
    window.dispatchEvent(switchEvent);
    
    // Update URL for browser history
    router.replace(`/chat/${conversationId}`, { scroll: false });
  }, [fullConversations, router]);

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
          return conversationMeta.title || 'Untitled';
        };
        
        return (
          <Link
            key={conversationMeta.id}
            href={`/chat/${conversationMeta.id}`}
            prefetch={true}
            onMouseEnter={() => handleConversationHover(conversationMeta.id as ConversationId)}
            onClick={(e) => handleConversationClick(conversationMeta.id as ConversationId, e)}
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
                      <DropdownMenuItem onClick={(e) => handleConversationBranch(conversationMeta.id as ConversationId, e)}>
                        <GitBranch className="h-3 w-3 mr-2" />
                        Branch
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={(e) => handleConversationDelete(conversationMeta.id as ConversationId, e)}
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
