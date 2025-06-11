'use client'

import { useEffect, useState, use, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ChatArea } from '@/components/ChatArea'
import { useSetChat, useChat, useChatStore, useCreateOptimisticChat } from '@/state/chatStore'
import { useAuth } from '@/lib/auth/auth-provider'
import { AuthModal } from '@/components/auth/auth-modal'
import { Loader2 } from 'lucide-react'
import { ConversationId } from '@/lib/types'
import { createChat } from '@/lib/actions'

interface ConversationPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ConversationPage({ params }: ConversationPageProps) {
  const { user, loading: authLoading } = useAuth()
  
  // Use React 18's use() hook for synchronous params resolution
  const resolvedParams = use(params)
  const initialConversationId = resolvedParams.conversationId
  
  // Local state for conversation ID - seeded from URL but managed internally
  const [conversationId, setConversationId] = useState(initialConversationId)
  
  console.log('ConversationPage render:', { initialConversationId, conversationId })
  
  // Store selectors - NO selectedConversation management here
  const setChat = useSetChat()
  const createOptimisticChat = useCreateOptimisticChat()
  const selectedWorkspace = useChatStore((state) => state.ui.selectedWorkspace)
  const existingChat = useChat(conversationId || '')
  
  // Handle /new route with immediate greeting message
  const hasCreatedGreeting = useRef(false)
  useEffect(() => {
    if (conversationId === 'new' && selectedWorkspace && !existingChat && !hasCreatedGreeting.current) {
      console.log('Creating optimistic /new chat with greeting message')
      hasCreatedGreeting.current = true
      
      // Create optimistic chat with greeting message
      const greetingMessage = "How can I help you today?"
      const tempChatId = 'new' // Use 'new' as the chat ID until user sends first message
      
      const now = new Date().toISOString()
      const chatState = {
        meta: {
          id: tempChatId,
          workspace_id: selectedWorkspace,
          created_at: now,
          isOptimistic: true,
        },
        messages: ['greeting-message'],
        byId: {
          'greeting-message': {
            id: 'greeting-message',
            conversation_id: tempChatId,
            order_key: 'greeting',
            role: 'assistant',
            content: greetingMessage,
            json_meta: { isGreeting: true },
            version: 1,
            created_at: now,
            updated_at: now,
            isOptimistic: true,
          }
        },
        streaming: false,
      }
      
      setChat(tempChatId, chatState)
    }
  }, [conversationId, selectedWorkspace, existingChat, setChat])
  
  // Reset greeting flag when conversation changes
  useEffect(() => {
    if (conversationId !== 'new') {
      hasCreatedGreeting.current = false
    }
  }, [conversationId])

  // Only fetch if we absolutely don't have the data AND it's not an optimistic/migrated conversation
  const shouldFetch = !!conversationId && 
                     conversationId !== 'new' && 
                     !!user && 
                     !existingChat &&
                     initialConversationId !== 'new' // Don't fetch if we started from /new (optimistic flow)
  
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
    
    // Don't overwrite if we have optimistic messages (more than just greeting)
    if (existingChat && existingChat.messages.length > 1) {
      console.log('Skipping server load - have optimistic messages')
      return
    }
    
    console.log('📄 Loading conversation from server:', {
      conversationId: conversationData.id,
      messageCount: conversationData.messages?.length || 0,
      messages: conversationData.messages?.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content?.substring(0, 50) + '...',
        order_key: m.order_key
      })) || []
    })
    
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
      // Preserve existing streaming state if it exists
      streaming: existingChat?.streaming || false,
      streamingMessageId: existingChat?.streamingMessageId,
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
      conversationId={conversationId}
      workspaceId={selectedWorkspace}
      onConversationIdChange={setConversationId}
    />
  )
}