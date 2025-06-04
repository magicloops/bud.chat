'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { 
  useWorkspaceConversations, 
  useWorkspaceLoading,
  useSetConversations,
  useRemoveConversation,
  useSetConversationsLoading
} from '@/state/workspaceStore'
import { useUIState, useSetSelectedConversation } from '@/state/chatStore'
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
import { formatDistanceToNow } from 'date-fns'

interface ConversationListProps {
  workspaceId: WorkspaceId
}

export function ConversationList({ workspaceId }: ConversationListProps) {
  const router = useRouter()
  const conversations = useWorkspaceConversations(workspaceId)
  const setConversations = useSetConversations()
  const removeConversation = useRemoveConversation()
  const setConversationsLoading = useSetConversationsLoading()
  const isLoading = useWorkspaceLoading(workspaceId)
  const uiState = useUIState()
  const setSelectedConversation = useSetSelectedConversation()

  // Load conversations for the workspace
  useEffect(() => {
    const loadConversations = async () => {
      if (!workspaceId) return
      
      try {
        setConversationsLoading(workspaceId, true)
        
        const response = await fetch(`/api/conversations?workspace_id=${workspaceId}`)
        if (response.ok) {
          const conversationsData = await response.json()
          setConversations(workspaceId, conversationsData)
        } else {
          console.error('Failed to load conversations:', response.statusText)
        }
      } catch (error) {
        console.error('Failed to load conversations:', error)
      } finally {
        setConversationsLoading(workspaceId, false)
      }
    }

    loadConversations()
  }, [workspaceId, setConversations, setConversationsLoading])

  const handleConversationSelect = useCallback((conversationId: ConversationId) => {
    setSelectedConversation(conversationId)
    router.push(`/${conversationId}`)
  }, [setSelectedConversation, router])

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
        removeConversation(conversationId)
        
        // If this was the selected conversation, clear selection
        if (uiState.selectedConversation === conversationId) {
          setSelectedConversation(null)
          router.push('/new')
        }
      } else {
        console.error('Failed to delete conversation')
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
    }
  }, [removeConversation, setSelectedConversation, uiState.selectedConversation, router])

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
    <div className="p-2 space-y-1">
      {conversations.map((conversation) => {
        const isSelected = uiState.selectedConversation === conversation.id
        const createdAt = new Date(conversation.created_at)
        const timeAgo = formatDistanceToNow(createdAt, { addSuffix: true })
        
        return (
          <div
            key={conversation.id}
            className={cn(
              "group flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted/50",
              isSelected && "bg-muted"
            )}
            onClick={() => handleConversationSelect(conversation.id)}
          >
            <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium truncate">
                  {/* TODO: Get conversation title from first message */}
                  Conversation
                </p>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
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
                      <DropdownMenuItem onClick={(e) => handleConversationBranch(conversation.id, e)}>
                        <GitBranch className="h-3 w-3 mr-2" />
                        Branch
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={(e) => handleConversationDelete(conversation.id, e)}
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
          </div>
        )
      })}
    </div>
  )
}