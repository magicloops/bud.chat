"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth/auth-provider"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { AuthModal } from "@/components/auth/auth-modal"
import ChatArea from "@/components/chat-area"
import { useChatLayout } from "@/contexts/chat-layout-context"
import { useChatState } from "@/hooks/use-chat-state"
import { Loader2 } from "lucide-react"
import { Database } from "@/lib/types/database"
import { createClient } from "@/lib/supabase/client"
import useSWR from 'swr'

type Conversation = Database['public']['Tables']['conversation']['Row']

// SWR fetcher function
const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

interface ConversationPageProps {
  params: Promise<{ conversationId: string }>
}

export default function ConversationPage({ params }: ConversationPageProps) {
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [optimisticMessages, setOptimisticMessages] = useState<any[]>([])
  const [conversationId, setConversationId] = useState<string>('')
  const [actualConversationId, setActualConversationId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  
  const { user, loading } = useAuth()
  const { selectedWorkspace } = useWorkspaceContext()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toggleLeftSidebar, toggleRightSidebar, leftSidebarOpen, rightSidebarOpen } = useChatLayout()
  
  // Stabilize optimisticMessages to prevent unnecessary re-renders
  const stableOptimisticMessages = useMemo(() => optimisticMessages, [JSON.stringify(optimisticMessages)])
  
  // Sync messages back to page state when they're updated
  const handleMessagesUpdate = useCallback((updatedMessages: any[]) => {
    setOptimisticMessages(updatedMessages)
  }, [])
  
  // Stable chat state management
  const chatState = useChatState({
    conversationId: actualConversationId === 'new' ? undefined : actualConversationId,
    optimisticMessages: stableOptimisticMessages,
    workspaceId: selectedWorkspace?.id,
    onMessagesUpdate: handleMessagesUpdate
  })
  
  
  // SWR for conversation data - only fetch for existing conversations (not temp forks)
  const shouldFetch = conversationId && conversationId !== 'new' && !conversationId.startsWith('temp-fork-')
  const swrKey = shouldFetch ? `/api/conversations/${conversationId}?include_messages=true` : null
  const { data: conversationData, error: conversationError, isLoading: swrLoading } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // Cache for 1 minute
  })
  

  // Load conversation ID from params
  useEffect(() => {
    const loadParams = async () => {
      const resolvedParams = await params
      const newConversationId = resolvedParams.conversationId
      
      setConversationId(newConversationId)
      setActualConversationId(newConversationId)
      
      // Always reset state when going to 'new' to ensure fresh start
      if (newConversationId === 'new') {
        console.log('Resetting state for new conversation')
        setSelectedConversation(null)
        // Reset optimistic messages to just the greeting
        setOptimisticMessages([
          {
            id: `greeting-${Date.now()}`,
            role: 'assistant',
            content: 'Hello! How can I assist you today?',
            created_at: new Date().toISOString(),
            metadata: { isGreeting: true }
          }
        ])
      }
    }
    loadParams()
  }, [params])

  // Single unified effect to handle all conversation loading
  useEffect(() => {
    if (!conversationId || !user) {
      setIsLoading(false)
      return
    }

    // Handle new conversation setup - only if truly new (not forked/temp)
    if (conversationId === 'new' && actualConversationId === 'new') {
      const setupNewConversation = async () => {
        try {
          // Use workspace from context
          if (selectedWorkspace) {
            console.log('📁 Setting up new conversation with workspace:', selectedWorkspace.name, 'ID:', selectedWorkspace.id)
            setSelectedConversation({
              id: 'new',
              title: 'New Chat',
              workspace_id: selectedWorkspace.id,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              metadata: {}
            })
            setOptimisticMessages([
              {
                id: 'greeting-message',
                role: 'assistant',
                content: 'Hello! How can I assist you today?',
                created_at: new Date().toISOString(),
                metadata: { isGreeting: true }
              }
            ])
          }
        } catch (error) {
          console.error('Error setting up new conversation:', error)
        } finally {
          setIsLoading(false)
        }
      }
      setupNewConversation()
      return
    }

    // Handle existing conversations with SWR data

    if (conversationData && !conversationError) {
      console.log('🔄 SWR DATA OVERRIDE CHECK - Server:', conversationData.messages?.length || 0, 'Local:', optimisticMessages.length)
      
      // Don't override optimistic messages if we're in a temp/forked conversation
      if (actualConversationId && actualConversationId.startsWith('temp-')) {
        return
      }
      
      // Don't override if we have more recent local messages (during streaming/optimistic updates)
      if (optimisticMessages.length > (conversationData.messages?.length || 0)) {
        console.log('🛡️ PRESERVING LOCAL MESSAGES - Local:', optimisticMessages.length, 'Server:', conversationData.messages?.length || 0)
        // Still update conversation metadata but preserve messages
        const loadedConversation: Conversation = {
          id: conversationData.id,
          title: conversationData.title,
          metadata: conversationData.metadata,
          created_at: conversationData.created_at,
          updated_at: conversationData.updated_at,
          workspace_id: conversationData.workspace?.id
        }
        setSelectedConversation(loadedConversation)
        setIsLoading(false)
        return
      }
      
      
      const loadedConversation: Conversation = {
        id: conversationData.id,
        title: conversationData.title,
        metadata: conversationData.metadata,
        created_at: conversationData.created_at,
        updated_at: conversationData.updated_at,
        workspace_id: conversationData.workspace?.id
      }

      const workspace: Workspace = {
        id: conversationData.workspace?.id,
        name: 'Default Workspace',
        owner_id: conversationData.workspace?.owner_id || user?.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      setSelectedConversation(loadedConversation)
      console.log('🚨 SWR OVERRIDING LOCAL MESSAGES - Was:', optimisticMessages.length, 'Now:', conversationData.messages?.length || 0)
      setOptimisticMessages(conversationData.messages || [])
      setIsLoading(false)
    } else if (conversationError) {
      console.error('SWR error:', conversationError)
      setIsLoading(false)
      router.push('/')
    } else if (swrLoading && !conversationData) {
      // Only show loading if we don't have cached data
      console.log('⏳ SWR loading without cached data')
      setIsLoading(true)
    } else if (!swrLoading && !conversationData) {
      // SWR finished loading but no data - this shouldn't happen for valid conversations
      console.log('🚫 No data after SWR completed')
      setIsLoading(false)
    }
  }, [conversationId, user, conversationData, conversationError, swrLoading, router, searchParams])

  // Real-time subscription for current conversation updates (title changes, metadata, etc.)
  useEffect(() => {
    if (!actualConversationId || actualConversationId === 'new' || !user) return

    console.log('🔔 Setting up real-time subscription for conversation:', actualConversationId)
    const supabase = createClient()
    
    const channel = supabase
      .channel(`conversation-updates-${actualConversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation',
          filter: `id=eq.${actualConversationId}`
        },
        (payload) => {
          console.log('🔄 Real-time conversation update received:', {
            id: payload.new.id,
            title: payload.new.title,
            metadata: payload.new.metadata,
            updated_at: payload.new.updated_at
          })
          const updatedConversation = payload.new as Conversation
          
          // Update the selected conversation with new data (including title and metadata)
          setSelectedConversation(prevConversation => {
            if (!prevConversation || prevConversation.id !== updatedConversation.id) {
              return updatedConversation
            }
            
            // Merge the updates to preserve any local state
            return {
              ...prevConversation,
              ...updatedConversation
            }
          })
          
          console.log('✅ Updated local conversation data with title:', updatedConversation.title)
        }
      )
      .subscribe()

    return () => {
      console.log('🔔 Cleaning up real-time subscription for conversation:', actualConversationId)
      supabase.removeChannel(channel)
    }
  }, [actualConversationId, user]) // Use actualConversationId to track the real conversation ID

  const handleConversationSelect = (conversation: Conversation, workspace: Workspace) => {
    // Navigate to the conversation URL
    router.push(`/${conversation.id}`)
  }

  // Callback to update selected conversation when it changes in real-time
  const updateSelectedConversation = (updatedConversation: Conversation) => {
    if (selectedConversation && selectedConversation.id === updatedConversation.id) {
      setSelectedConversation(updatedConversation)
    }
    
    // If this is updating a temp conversation with the real one, navigate to the real conversation
    if (selectedConversation?.id.startsWith('temp-') && updatedConversation.id !== selectedConversation.id) {
      router.push(`/${updatedConversation.id}`)
    }
  }

  const handleConversationChange = (newConversationId: string, workspaceId: string, title?: string, messages?: any[], metadata?: any) => {
    console.log('🔄 CONVERSATION CHANGE:', conversationId, '->', newConversationId, 'Local messages:', optimisticMessages.length)
    
    // Only update conversationId for real conversation IDs (not temp ones)
    if (!newConversationId.startsWith('temp-')) {
      setConversationId(newConversationId)
    }
    setActualConversationId(newConversationId)
    
    // If messages are provided (e.g., from branching), use them immediately
    if (messages) {
      console.log('📨 Using provided messages for conversation change:', messages.length)
      setOptimisticMessages(messages)
    } else {
      // Only clear messages when switching to a completely different conversation
      // Don't clear when transitioning from 'new' to real ID (same conversation)
      const isTransitionFromNew = conversationId === 'new' || !conversationId
      const isSwitchingConversations = !newConversationId.startsWith('temp-') && 
                                       newConversationId !== 'new' && 
                                       newConversationId !== conversationId && 
                                       !isTransitionFromNew
      
      if (isSwitchingConversations) {
        console.log('📭 Switching to different conversation - clearing optimistic messages')
        setOptimisticMessages([])
      } else {
        console.log('📭 No messages provided but preserving existing state (transition or same conversation)')
      }
    }
    
    // Always create a temporary conversation object for the UI when conversation changes
    const tempConversation = {
      id: newConversationId,
      title: title || 'New Chat',
      workspace_id: workspaceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: metadata || selectedConversation?.metadata || {}
    }
    setSelectedConversation(tempConversation)
    
    // Update URL silently using history API
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `/${newConversationId}`)
    }
  }

  const handleStreamingComplete = () => {
    // No longer needed - URL is updated immediately when conversation is created
    console.log('Streaming completed')
  }

  // Only show loading if we don't have any messages and are actually loading data
  const shouldShowLoading = (loading || isLoading) && optimisticMessages.length === 0
  
  if (shouldShowLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <AuthModal />
  }

  console.log('🎯 Rendering ChatArea with workspace ID:', selectedWorkspace?.id, 'workspace name:', selectedWorkspace?.name)
  
  return (
    <ChatArea
      toggleLeftSidebar={toggleLeftSidebar}
      toggleRightSidebar={toggleRightSidebar}
      leftSidebarOpen={leftSidebarOpen}
      rightSidebarOpen={rightSidebarOpen}
      currentConversationId={actualConversationId === 'new' ? undefined : actualConversationId}
      currentWorkspaceId={selectedWorkspace?.id}
      conversationTitle={selectedConversation?.title || "New Chat"}
      conversationMetadata={selectedConversation?.metadata}
      chatState={chatState}
      onConversationChange={handleConversationChange}
      onConversationUpdate={updateSelectedConversation}
      onStreamingComplete={handleStreamingComplete}
      isLoadingConversation={isLoading}
    />
  )
}