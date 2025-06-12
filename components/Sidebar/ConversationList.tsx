'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { 
  useGetWorkspaceConversations,
  useGetConversation,
  useRemoveConversationFromWorkspace,
  useAddConversationToWorkspace,
  useSetChat,
  useChatStore
} from '@/state/chatStore'
import { usePathname } from 'next/navigation'
import { WorkspaceId, ConversationId } from '@/lib/types'
import { cn } from '@/lib/utils'
import { 
  MessageSquare, 
  MoreHorizontal, 
  Trash2, 
  GitBranch,
  Loader2
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface ConversationListProps {
  workspaceId: WorkspaceId
}

export function ConversationList({ workspaceId }: ConversationListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const getWorkspaceConversations = useGetWorkspaceConversations()
  const getConversation = useGetConversation()
  const removeConversationFromWorkspace = useRemoveConversationFromWorkspace()
  const addConversationToWorkspace = useAddConversationToWorkspace()
  const setChat = useSetChat()
  const [isLoading, setIsLoading] = useState(false)
  const realtimeSetupRef = useRef(false)
  
  // Create stable selectors that return references to stable objects
  const workspaceConversationsMap = useChatStore((state) => state.workspaceConversations)
  const chats = useChatStore((state) => state.chats)
  const registry = useChatStore((state) => state.registry)
  
  // Get the specific workspace conversations with a stable reference
  const workspaceConversations = useMemo(() => {
    return workspaceConversationsMap[workspaceId] || []
  }, [workspaceConversationsMap, workspaceId])
  
  // Use subscribed data in memoized computation
  const conversations = useMemo(() => {
    console.log('Computing conversations - workspace IDs:', workspaceConversations.length, 'chats:', Object.keys(chats).length, 'registry:', Object.keys(registry).length)
    
    const result = workspaceConversations
      .map(displayId => {
        const actualId = registry[displayId] || displayId
        const conversation = chats[actualId]
        
        if (conversation?.meta && !conversation.meta.isOptimistic) {
          return { ...conversation.meta, displayId }
        }
        return null
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    console.log('Computed conversations result:', result.length, 'conversations')
    return result
  }, [workspaceConversations, chats, registry])
  
  // Extract current conversation ID from URL
  const currentConversationId = pathname.split('/').pop()

  // Load conversations for the workspace and add them to ChatStore
  useEffect(() => {
    console.log('ConversationList useEffect triggered - workspaceId:', workspaceId)
    
    const loadConversations = async () => {
      if (!workspaceId) {
        console.log('No workspaceId provided to ConversationList')
        return
      }
      
      // Check if we already have conversations loaded for this workspace
      const existingConversations = getWorkspaceConversations(workspaceId)
      console.log('Existing conversations for workspace', workspaceId, ':', existingConversations.length)
      if (existingConversations.length > 0) {
        console.log('Conversations already exist, skipping load')
        return
      }
      
      console.log('Fetching conversations from API for workspace:', workspaceId)
      
      try {
        setIsLoading(true)
        
        const response = await fetch(`/api/conversations?workspace_id=${workspaceId}`)
        console.log('API response status:', response.status, response.statusText)
        if (response.ok) {
          const conversationsData = await response.json()
          console.log('Received conversations data:', conversationsData.length, 'conversations')
          
          // Store conversations in a more efficient way
          const conversationsToAdd: any[] = []
          const workspaceConvIds: string[] = []
          
          conversationsData.forEach((conv: any) => {
            // Check if conversation already exists
            const existingConversation = getConversation(conv.id)
            
            if (!existingConversation) {
              // Store new conversations
              conversationsToAdd.push({
                id: conv.id,
                chatState: {
                  meta: {
                    id: conv.id,
                    workspace_id: conv.workspace_id,
                    created_at: conv.created_at,
                    title: conv.title,
                    bud_id: conv.bud_id,
                  },
                  messages: [], // Messages will be loaded when conversation is opened
                  byId: {},
                  streaming: false,
                }
              })
            } else {
              // Update existing conversation metadata with server data, but preserve important state
              const existingTitle = existingConversation.meta?.title
              const serverTitle = conv.title
              const finalTitle = serverTitle || existingTitle || 'New Chat'
              
              console.log('Updating conversation', conv.id, 'existing title:', existingTitle, 'server title:', serverTitle, 'final title:', finalTitle)
              
              const updatedChatState = {
                ...existingConversation,
                meta: {
                  ...existingConversation.meta,
                  // Update with server data
                  workspace_id: conv.workspace_id,
                  created_at: conv.created_at,
                  bud_id: conv.bud_id,
                  // Use server title if it exists, otherwise keep existing
                  title: finalTitle,
                }
              }
              
              // Add to update list
              conversationsToAdd.push({
                id: conv.id,
                chatState: updatedChatState
              })
            }
            
            // Collect workspace conversation IDs
            workspaceConvIds.push(conv.id)
          })
          
          // Batch the store updates to reduce re-renders
          conversationsToAdd.forEach(({ id, chatState }) => {
            setChat(id, chatState)
          })
          
          // Use a single batch update instead of individual calls to prevent excessive re-renders
          // For now, we'll do individual calls but add a check to prevent duplicates
          const existingIds = getWorkspaceConversations(workspaceId)
          const newIds = workspaceConvIds.filter(id => !existingIds.includes(id))
          
          newIds.forEach(convId => {
            addConversationToWorkspace(workspaceId, convId)
          })
          
          console.log('Successfully processed', conversationsToAdd.length, 'new conversations, added', newIds.length, 'to workspace')
        } else {
          console.error('Failed to load conversations:', response.status, response.statusText)
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadConversations()
  }, [workspaceId])

  // Set up realtime listener for conversation updates
  useEffect(() => {
    console.log('Realtime effect triggered with workspaceId:', workspaceId)
    if (!workspaceId) {
      console.log('No workspaceId for realtime listener')
      return
    }

    console.log('Setting up realtime listener for workspace:', workspaceId)
    const supabase = createClient()
    
    // Listen for conversation updates in this workspace
    const conversationChannel = supabase
      .channel(`conversations-${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events to debug
          schema: 'public',
          table: 'conversations',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          console.log('🔄 Realtime event received:', {
            eventType: payload.eventType,
            table: payload.table,
            schema: payload.schema,
            workspaceId,
            payloadOld: payload.old,
            payloadNew: payload.new
          })
          
          if (payload.eventType === 'INSERT') {
            console.log('🆕 New conversation created via realtime:', payload.new)
          } else if (payload.eventType === 'UPDATE') {
            console.log('🔄 Conversation updated via realtime:', {
              conversationId: payload.new?.id,
              oldTitle: payload.old?.title,
              newTitle: payload.new?.title,
              oldData: payload.old,
              newData: payload.new
            })
            
            // Update the conversation in the store with new metadata
            const updatedConversation = payload.new as any
            const existingConversation = getConversation(updatedConversation.id)
            
            console.log('Store lookup for conversation:', {
              conversationId: updatedConversation.id,
              found: !!existingConversation,
              existingTitle: existingConversation?.meta?.title,
              newTitle: updatedConversation.title
            })
            
            if (existingConversation) {
              console.log('📝 Updating conversation title:', {
                from: existingConversation.meta?.title,
                to: updatedConversation.title,
                conversationId: updatedConversation.id
              })
              
              const updatedChatState = {
                ...existingConversation,
                meta: {
                  ...existingConversation.meta,
                  title: updatedConversation.title,
                  // Update other fields that might have changed
                  workspace_id: updatedConversation.workspace_id,
                  created_at: updatedConversation.created_at,
                  bud_id: updatedConversation.bud_id,
                }
              }
              
              // Update the conversation in the store
              setChat(updatedConversation.id, updatedChatState)
              console.log('✅ Conversation updated in store via realtime:', {
                conversationId: updatedConversation.id,
                newTitle: updatedConversation.title
              })
            } else {
              console.log('❌ Conversation not found in store, cannot update:', {
                conversationId: updatedConversation.id,
                availableConversations: Object.keys(chats),
                registryKeys: Object.keys(registry)
              })
            }
          } else if (payload.eventType === 'DELETE') {
            console.log('🗑️ Conversation deleted via realtime:', payload.old)
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status)
      })

    console.log('Realtime listener subscribed for workspace:', workspaceId)

    // Cleanup subscription on unmount or workspace change
    return () => {
      console.log('Cleaning up realtime listener for workspace:', workspaceId)
      supabase.removeChannel(conversationChannel)
    }
  }, [workspaceId])

  const handleConversationDelete = useCallback(async (conversationId: ConversationId, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!confirm('Are you sure you want to delete this conversation?')) {
      return
    }
    
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
      })
      
      if (response.ok) {
        removeConversationFromWorkspace(workspaceId, conversationId)
        
        // If this was the selected conversation, navigate to new
        if (currentConversationId === conversationId) {
          router.push('/new')
        }
      } else {
        console.error('Failed to delete conversation')
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }, [removeConversationFromWorkspace, workspaceId, currentConversationId, router])

  const handleConversationBranch = useCallback((conversationId: ConversationId, e: React.MouseEvent) => {
    e.stopPropagation()
    // TODO: Implement conversation branching
    console.log('Branch conversation:', conversationId)
  }, [])

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
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No conversations yet</p>
        <p className="text-xs">Start a new conversation to get started</p>
      </div>
    )
  }

  return (
    <div className="p-2 space-y-1 min-h-0 w-full max-w-full">
      {conversations.map((conversation) => {
        const isSelected = currentConversationId === conversation.displayId
        const createdAt = new Date(conversation.created_at)
        const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true })
        
        // Get title from conversation title field or use default
        const getConversationTitle = () => {
          return conversation.title || 'New Chat'
        }
        
        return (
          <Link
            key={conversation.displayId}
            href={`/${conversation.displayId}`}
            prefetch={false}
            className={cn(
              "group flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted/50 w-full max-w-full overflow-hidden block",
              isSelected && "bg-muted"
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
                      <DropdownMenuItem onClick={(e) => handleConversationBranch(conversation.displayId, e)}>
                        <GitBranch className="h-3 w-3 mr-2" />
                        Branch
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={(e) => handleConversationDelete(conversation.displayId, e)}
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
        )
      })}
    </div>
  )
}
