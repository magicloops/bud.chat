"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth/auth-provider"
import { AuthModal } from "@/components/auth/auth-modal"
import ChatArea from "@/components/chat-area"
import { useChatLayout } from "@/contexts/chat-layout-context"
import { Loader2 } from "lucide-react"
import { Database } from "@/lib/types/database"
import useSWR from 'swr'

type Workspace = Database['public']['Tables']['workspace']['Row']
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
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [optimisticMessages, setOptimisticMessages] = useState<any[]>([])
  const [conversationId, setConversationId] = useState<string>('')
  const [actualConversationId, setActualConversationId] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  
  const { user, loading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toggleLeftSidebar, toggleRightSidebar, leftSidebarOpen, rightSidebarOpen } = useChatLayout()
  
  // SWR for conversation data - only fetch for existing conversations
  const shouldFetch = conversationId && conversationId !== 'new'
  const swrKey = shouldFetch ? `/api/conversations/${conversationId}?include_messages=true` : null
  const { data: conversationData, error: conversationError, isLoading: swrLoading } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // Cache for 1 minute
  })
  
  console.log('🔍 SWR state:', { 
    conversationId, 
    shouldFetch, 
    swrKey,
    swrLoading, 
    hasData: !!conversationData,
    hasError: !!conversationError,
    currentIsLoading: isLoading
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

    // Handle new conversation setup
    if (conversationId === 'new') {
      const setupNewConversation = async () => {
        try {
          // Check if workspace ID is provided in URL
          const workspaceIdFromUrl = searchParams.get('workspace')
          
          const response = await fetch('/api/workspaces')
          if (response.ok) {
            const workspaces = await response.json()
            if (workspaces.length > 0) {
              // Use workspace from URL if provided, otherwise use first workspace
              let targetWorkspace = workspaces[0]
              if (workspaceIdFromUrl) {
                const urlWorkspace = workspaces.find(w => w.id === workspaceIdFromUrl)
                if (urlWorkspace) {
                  targetWorkspace = urlWorkspace
                }
              }
              
              console.log('📁 Setting up new conversation with workspace:', targetWorkspace.name)
              setSelectedWorkspace(targetWorkspace)
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
    console.log('🔄 SWR state:', { 
      hasData: !!conversationData, 
      hasError: !!conversationError, 
      isLoading: swrLoading,
      conversationId 
    })

    if (conversationData && !conversationError) {
      console.log('✅ Using SWR cached data:', conversationData.messages?.length || 0, 'messages')
      
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
      setSelectedWorkspace(workspace)
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

  const handleConversationChange = (newConversationId: string, workspaceId: string, title?: string, messages?: any[]) => {
    console.log('handleConversationChange called with:', newConversationId, 'current conversationId:', conversationId)
    
    // Always use hot-swap to avoid interrupting streaming or causing UI refreshes
    console.log('Hot-swapping conversation ID to:', newConversationId)
    setActualConversationId(newConversationId)
    
    // If messages are provided (e.g., from branching), use them immediately
    if (messages) {
      console.log('Using provided messages for conversation change:', messages.length)
      setOptimisticMessages(messages)
    }
    
    // Always create a temporary conversation object for the UI when conversation changes
    const tempConversation = {
      id: newConversationId,
      title: title || 'New Chat',
      workspace_id: workspaceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {}
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

  if (loading || isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <AuthModal />
  }

  return (
    <ChatArea
      key={conversationId === 'new' ? 'new-conversation' : actualConversationId}
      toggleLeftSidebar={toggleLeftSidebar}
      toggleRightSidebar={toggleRightSidebar}
      leftSidebarOpen={leftSidebarOpen}
      rightSidebarOpen={rightSidebarOpen}
      currentConversationId={actualConversationId === 'new' ? undefined : actualConversationId}
      currentWorkspaceId={selectedWorkspace?.id}
      conversationTitle={selectedConversation?.title || "New Chat"}
      conversationMetadata={selectedConversation?.metadata}
      optimisticMessages={optimisticMessages}
      onConversationChange={handleConversationChange}
      onConversationUpdate={updateSelectedConversation}
      onStreamingComplete={handleStreamingComplete}
      isLoadingConversation={isLoading}
    />
  )
}