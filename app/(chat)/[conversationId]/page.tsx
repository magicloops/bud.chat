'use client'

import { useEffect, useState, use, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChatArea } from '@/components/ChatArea'
import { useSetChat, useChat, useChatStore } from '@/state/chatStore'
import { useAuth } from '@/lib/auth/auth-provider'
import { AuthModal } from '@/components/auth/auth-modal'
import { Loader2 } from 'lucide-react'
import { ConversationId } from '@/lib/types'

interface ConversationPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ConversationPage({ params }: ConversationPageProps) {
  const { user, loading: authLoading } = useAuth()
  
  // Use React 18's use() hook for synchronous params resolution
  const resolvedParams = use(params)
  const conversationId = resolvedParams.conversationId
  
  // Store selectors - NO selectedConversation management here
  const setChat = useSetChat()
  const selectedWorkspace = useChatStore((state) => state.ui.selectedWorkspace)
  const existingChat = useChat(conversationId || '')

  // Only fetch if we absolutely don't have the data
  const shouldFetch = !!conversationId && 
                     conversationId !== 'new' && 
                     !!user && 
                     !existingChat
  
  const { data: conversationData, isLoading: conversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const response = await fetch(`/api/conversations/${conversationId}?include_messages=true`)
      if (!response.ok) {
        throw new Error('Failed to fetch conversation')
      }
      return response.json()
    },
    enabled: shouldFetch,
    staleTime: Infinity,
    gcTime: Infinity,
    // Prevent refetch on window focus, reconnect, etc.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })

  // Load conversation data when available
  useEffect(() => {
    if (!conversationData || existingChat) return
    
    const chatState = {
      meta: {
        id: conversationData.id,
        workspace_id: conversationData.workspace_id,
        created_at: conversationData.created_at,
        bud_id: conversationData.bud_id,
      },
      messages: conversationData.messages?.map((m: any) => m.id) || [],
      byId: Object.fromEntries(
        conversationData.messages?.map((m: any) => [m.id, m]) || []
      ),
      streaming: false,
    }
    
    setChat(conversationId, chatState)
  }, [conversationData, existingChat, conversationId, setChat])

  const isLoading = authLoading || !conversationId || (conversationLoading && conversationId !== 'new' && !existingChat)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <AuthModal />
  }

  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Please select a workspace to continue</p>
        </div>
      </div>
    )
  }

  return (
    <ChatArea
      conversationId={conversationId === 'new' ? undefined : conversationId}
      workspaceId={selectedWorkspace}
    />
  )
}