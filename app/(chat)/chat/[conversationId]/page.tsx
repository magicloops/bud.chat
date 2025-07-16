'use client'

import { use, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EventStream } from '@/components/EventStream'
import { Loader2 } from 'lucide-react'
import { 
  useConversation, 
  useSetConversation, 
  useSelectedWorkspace,
  useSetSelectedWorkspace,
  Conversation,
  ConversationMeta 
} from '@/state/eventChatStore'

interface ChatPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ChatPage({ params }: ChatPageProps) {
  const resolvedParams = use(params)
  const conversationId = resolvedParams.conversationId
  
  const selectedWorkspace = useSelectedWorkspace()
  const setSelectedWorkspace = useSetSelectedWorkspace()
  const setConversation = useSetConversation()
  
  // Check if conversation is already in store
  const existingConversation = useConversation(conversationId)

  // Fetch conversation from server if not in store
  const { data: conversationData, isLoading, error } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      const response = await fetch(`/api/conversations/${conversationId}?include_events=true`)
      if (!response.ok) {
        throw new Error(`Failed to fetch conversation: ${response.status}`)
      }
      
      const data = await response.json()
      return data
    },
    enabled: !!conversationId && !existingConversation,
    staleTime: Infinity, // Don't refetch unless manually invalidated
    gcTime: Infinity,
  })

  // Load conversation data into store when received from server
  useEffect(() => {
    if (conversationData && (!existingConversation || existingConversation.events.length === 0)) {
      const conversationMeta: ConversationMeta = {
        id: conversationData.id,
        title: conversationData.title || 'Chat',
        workspace_id: conversationData.workspace_id,
        source_bud_id: conversationData.source_bud_id,
        // Use the effective identity computed by the server
        assistant_name: conversationData.effective_assistant_name,
        assistant_avatar: conversationData.effective_assistant_avatar,
        model_config_overrides: conversationData.model_config_overrides,
        mcp_config_overrides: conversationData.mcp_config_overrides,
        created_at: conversationData.created_at
      }
      
      const conversation: Conversation = {
        id: conversationData.id,
        events: conversationData.events || [],
        isStreaming: false,
        meta: conversationMeta
      }
      
      setConversation(conversationData.id, conversation)
      
      // Apply bud theme if available
      if (conversationData.bud_config?.customTheme) {
        const root = document.documentElement
        Object.entries(conversationData.bud_config.customTheme.cssVariables).forEach(([key, value]) => {
          root.style.setProperty(key, value as string)
        })
      }
      
      // Switch workspace if needed
      if (conversationData.workspace_id && conversationData.workspace_id !== selectedWorkspace) {
        setSelectedWorkspace(conversationData.workspace_id)
      }
    }
  }, [conversationData, existingConversation, setConversation, selectedWorkspace, setSelectedWorkspace])

  // Show loading state (layout handles auth)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">Conversation not found</p>
          <p className="text-sm">The conversation you're looking for doesn't exist or you don't have access to it.</p>
        </div>
      </div>
    )
  }

  // Show workspace selection prompt (layout handles auth)
  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p>Please select a workspace to continue</p>
        </div>
      </div>
    )
  }

  // Show loading state while conversation loads
  if (!existingConversation && !conversationData) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  // Render chat interface with store state
  return (
    <EventStream
      conversationId={conversationId}
      placeholder="Type your message..."
    />
  )
}