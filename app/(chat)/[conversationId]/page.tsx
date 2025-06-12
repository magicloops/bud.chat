'use client'

import { useEffect, useState, use, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { ChatArea } from '@/components/ChatArea'
import { useSetChat, useChat, useGetConversation, useAddConversationToWorkspace, useChatStore, useSetSelectedWorkspace, useClearRegistryEntry } from '@/state/chatStore'
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
  const conversationId = resolvedParams.conversationId  // This is now the display ID
  
  // Registry pattern: use display ID directly, registry handles storage mapping
  const setChat = useSetChat()
  const getConversation = useGetConversation()
  const addConversationToWorkspace = useAddConversationToWorkspace()
  const setSelectedWorkspace = useSetSelectedWorkspace()
  const clearRegistryEntry = useClearRegistryEntry()
  const selectedWorkspace = useChatStore((state) => state.ui.selectedWorkspace)
  const existingChat = useChat(conversationId || '')
  
  // Generate temp conversation ID immediately for /new route
  const tempIdRef = useRef<string | null>(null)
  const actualConversationId = useMemo(() => {
    if (conversationId === 'new') {
      // Generate a unique temp ID for this new conversation
      // Always generate a fresh ID when visiting /new (even if we have an old one)
      // Include session ID to ensure uniqueness across browser sessions
      const sessionId = Math.random().toString(36).substr(2, 9)
      tempIdRef.current = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${sessionId}`
      console.log('🆔 Generated fresh temp ID for /new:', tempIdRef.current)
      
      // Check if this temp ID already exists in registry (it shouldn't!)
      const currentState = useChatStore.getState()
      if (currentState.registry[tempIdRef.current]) {
        console.warn('⚠️ Fresh temp ID already exists in registry!', {
          tempId: tempIdRef.current,
          pointsTo: currentState.registry[tempIdRef.current]
        })
      }
      return tempIdRef.current
    }
    // Reset temp ID when leaving /new
    tempIdRef.current = null
    return conversationId
  }, [conversationId])

  // Get chat using the actual conversation ID (temp or real)
  const actualExistingChat = useChat(actualConversationId || '')

  // Handle /new route with immediate greeting message
  const hasCreatedGreeting = useRef(false)
  
  useEffect(() => {
    console.log('🔍 Page useEffect:', { conversationId, actualConversationId, hasCreatedGreeting: hasCreatedGreeting.current, actualExistingChat: !!actualExistingChat })
    
    if (conversationId === 'new' && selectedWorkspace && actualConversationId) {
      // Only create greeting if we don't have an existing chat and haven't created one yet
      if (!actualExistingChat && !hasCreatedGreeting.current) {
        hasCreatedGreeting.current = true
        
        console.log('🎯 Creating fresh greeting for temp conversation:', actualConversationId)
        
        // Create optimistic chat with greeting message using temp ID
        const greetingMessage = "How can I help you today?"
        const now = new Date().toISOString()
        
        const chatState = {
          meta: {
            id: actualConversationId,  // Use temp ID
            workspace_id: selectedWorkspace,
            created_at: now,
            isOptimistic: true,
          },
          messages: ['greeting-message'],
          byId: {
            'greeting-message': {
              id: 'greeting-message',
              conversation_id: actualConversationId,
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
        
        // Store conversation with temp ID
        setChat(actualConversationId, chatState)
        
        // Don't add temp conversations to workspace list - they'll be added when promoted
      }
    }
  }, [conversationId, selectedWorkspace, actualConversationId, actualExistingChat, setChat])
  
  // Reset flags when conversation changes
  useEffect(() => {
    if (conversationId !== 'new') {
      hasCreatedGreeting.current = false
    } else {
      // When visiting /new, reset greeting flag so we create a fresh greeting
      hasCreatedGreeting.current = false
    }
  }, [conversationId])

  // Simple fetch logic - fetch if we don't have the conversation, or if we have it but no messages loaded
  const shouldFetch = !!conversationId && 
                     conversationId !== 'new' && 
                     !!user && 
                     (!existingChat || (existingChat && existingChat.messages.length === 0))
  
  const { data: conversationData, isLoading: conversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      // For existing conversations, we always fetch using the display ID
      // The server will resolve this to the actual conversation
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
    if (!conversationData) return
    
    // Don't overwrite if we already have messages loaded (more than just greeting or no messages at all)
    if (existingChat && existingChat.messages.length > 1) {
      console.log('Skipping server load - have existing messages')
      return
    }
    
    // Loading conversation data from server
    
    const chatState = {
      meta: {
        // Start with server data
        id: conversationData.id,
        workspace_id: conversationData.workspace_id,
        created_at: conversationData.created_at,
        bud_id: conversationData.bud_id,
        title: conversationData.title,
        // Preserve existing metadata, but only title if server doesn't have one
        ...existingChat?.meta,
        // Always override these critical fields with server data
        id: conversationData.id,
        workspace_id: conversationData.workspace_id,
        created_at: conversationData.created_at,
        bud_id: conversationData.bud_id,
        // Use server title if it exists, otherwise keep existing title
        title: conversationData.title || existingChat?.meta?.title || 'New Chat',
      },
      messages: conversationData.messages?.map((m: any) => m.id) || [],
      byId: Object.fromEntries(
        conversationData.messages?.map((m: any) => [m.id, m]) || []
      ),
      // Preserve existing streaming state if it exists
      streaming: existingChat?.streaming || false,
      streamingMessageId: existingChat?.streamingMessageId,
    }
    
    // Store with display ID - registry will handle mapping if needed
    setChat(conversationId, chatState)
    
    // Switch workspace if this conversation belongs to a different workspace
    if (conversationData.workspace_id && conversationData.workspace_id !== selectedWorkspace) {
      console.log('Switching workspace from', selectedWorkspace, 'to', conversationData.workspace_id, 'for conversation')
      setSelectedWorkspace(conversationData.workspace_id)
      localStorage.setItem('lastSelectedWorkspaceId', conversationData.workspace_id)
    }
  }, [conversationData, existingChat, conversationId, setChat, selectedWorkspace, setSelectedWorkspace])

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
      conversationId={actualConversationId}
      workspaceId={selectedWorkspace}
    />
  )
}