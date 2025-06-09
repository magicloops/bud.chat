'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChatArea } from '@/components/ChatArea'
import { useUIState, useSetSelectedConversation, useAddMessage, useSetChat, useChat } from '@/state/chatStore'
import { useAuth } from '@/lib/auth/auth-provider'
import { AuthModal } from '@/components/auth/auth-modal'
import { Loader2 } from 'lucide-react'
import { ConversationId } from '@/lib/types'

interface ConversationPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ConversationPage({ params }: ConversationPageProps) {
  const { user, loading: authLoading } = useAuth()
  const setSelectedConversation = useSetSelectedConversation()
  const addMessage = useAddMessage()
  const setChat = useSetChat()
  const uiState = useUIState()
  
  const [conversationId, setConversationId] = useState<string | null>(null)
  const existingChat = useChat(conversationId || '')

  // Load conversation ID from params
  useEffect(() => {
    const loadParams = async () => {
      const resolvedParams = await params
      setConversationId(resolvedParams.conversationId)
    }
    loadParams()
  }, [params])

  // Fetch conversation data
  const { data: conversationData, isLoading: conversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      if (!conversationId || conversationId === 'new') return null
      
      console.log('🔍 Fetching conversation data for:', conversationId)
      const response = await fetch(`/api/conversations/${conversationId}?include_messages=true`)
      if (!response.ok) {
        throw new Error('Failed to fetch conversation')
      }
      return response.json()
    },
    enabled: !!conversationId && 
             conversationId !== 'new' && 
             !!user && 
             !existingChat, // Only fetch if we don't have the conversation at all
    staleTime: 30000, // Don't refetch for 30 seconds
  })

  // Load conversation into store when data is available
  useEffect(() => {
    if (!conversationId) return

    console.log('🔄 Conversation page effect running:', {
      conversationId,
      hasConversationData: !!conversationData,
      existingChatExists: !!existingChat,
      isStreaming: existingChat?.streaming
    })

    // Set selected conversation
    setSelectedConversation(conversationId)

    // Load conversation data into store
    if (conversationData) {
      // Check if conversation is already in store and streaming
      const isCurrentlyStreaming = existingChat?.streaming
      
      if (isCurrentlyStreaming) {
        console.log('⚠️ Skipping conversation data load - currently streaming')
        // Don't overwrite streaming state, just update metadata
        setChat(conversationId, {
          ...existingChat,
          meta: {
            ...existingChat.meta,
            id: conversationData.id,
            workspace_id: conversationData.workspace_id,
            created_at: conversationData.created_at,
            bud_id: conversationData.bud_id,
            isOptimistic: false
          }
        })
      } else {
        console.log('📥 Loading conversation data from server')
        // Create chat state from server data
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
      }
    } else if (conversationId === 'new') {
      // For new conversations, create a default greeting
      const greetingMessage = {
        id: 'greeting-temp',
        conversation_id: 'new',
        order_key: 'a0',
        role: 'assistant' as const,
        content: 'Hello! How can I assist you today?',
        json_meta: { isGreeting: true },
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        isOptimistic: true,
      }

      // Don't create a persistent chat state for 'new' - let the composer handle it
    }
  }, [conversationId, conversationData, setSelectedConversation, setChat])

  const isLoading = authLoading || !conversationId || (conversationLoading && conversationId !== 'new')

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

  if (!uiState.selectedWorkspace) {
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
      workspaceId={uiState.selectedWorkspace}
    />
  )
}