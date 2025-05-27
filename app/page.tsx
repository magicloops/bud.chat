"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth/auth-provider"
import { AuthModal } from "@/components/auth/auth-modal"
import ChatSidebar from "@/components/chat-sidebar"
import ChatArea from "@/components/chat-area"
import SettingsPanel from "@/components/settings-panel"
import { Loader2 } from "lucide-react"
import { Database } from "@/lib/types/database"

type Workspace = Database['public']['Tables']['workspace']['Row']
type Conversation = Database['public']['Tables']['conversation']['Row']

export default function ChatApp() {
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null)
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const [optimisticMessages, setOptimisticMessages] = useState<any[]>([])
  
  const { user, loading } = useAuth()

  const handleConversationSelect = (conversation: Conversation, workspace: Workspace) => {
    setSelectedConversation(conversation)
    setSelectedWorkspace(workspace)
    // Clear optimistic messages when manually selecting a conversation
    setOptimisticMessages([])
  }

  // Callback to update selected conversation when it changes in real-time
  const updateSelectedConversation = (updatedConversation: Conversation) => {
    if (selectedConversation && selectedConversation.id === updatedConversation.id) {
      setSelectedConversation(updatedConversation)
    }
    
    // If this is updating a temp conversation with the real one, clear optimistic state
    if (selectedConversation?.id.startsWith('temp-') && updatedConversation.id !== selectedConversation.id) {
      // This is the real conversation replacing the temp one
      const workspace: Workspace = {
        id: updatedConversation.workspace_id,
        name: selectedWorkspace?.name || '',
        owner_id: selectedWorkspace?.owner_id || '',
        created_at: selectedWorkspace?.created_at || new Date().toISOString(),
        updated_at: selectedWorkspace?.updated_at || new Date().toISOString()
      }
      
      setOptimisticMessages([]) // Clear optimistic messages
      handleConversationSelect(updatedConversation, workspace)
    }
  }

  const clearConversationSelection = () => {
    setSelectedConversation(null)
  }

  const handleConversationChange = (conversationId: string, workspaceId: string, title?: string, messages?: any[]) => {
    // Create conversation objects
    const newConversation: Conversation = {
      id: conversationId,
      workspace_id: workspaceId,
      title: title || 'Loading...', // Use provided title or fallback
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    const workspace: Workspace = {
      id: workspaceId,
      name: selectedWorkspace?.name || '',
      owner_id: selectedWorkspace?.owner_id || '',
      created_at: selectedWorkspace?.created_at || new Date().toISOString(),
      updated_at: selectedWorkspace?.updated_at || new Date().toISOString()
    }
    
    // Use React 18's automatic batching to update everything at once
    setOptimisticMessages(messages || [])
    setSelectedConversation(newConversation)
    setSelectedWorkspace(workspace)
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <AuthModal />
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Left Sidebar */}
      <div
        className={`transition-all duration-300 ease-in-out ${leftSidebarOpen ? "w-60 opacity-100" : "w-0 opacity-0"} overflow-hidden`}
      >
        <div className={`w-60 h-full ${!leftSidebarOpen && "invisible"}`}>
          <ChatSidebar 
            selectedConversationId={selectedConversation?.id}
            onConversationSelect={handleConversationSelect}
            onConversationUpdate={updateSelectedConversation}
          />
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col border-l border-r">
        <ChatArea
          toggleLeftSidebar={() => setLeftSidebarOpen(!leftSidebarOpen)}
          toggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
          leftSidebarOpen={leftSidebarOpen}
          rightSidebarOpen={rightSidebarOpen}
          currentConversationId={selectedConversation?.id}
          currentWorkspaceId={selectedWorkspace?.id}
          conversationTitle={selectedConversation?.title || "New Chat"}
          optimisticMessages={optimisticMessages}
          onConversationChange={handleConversationChange}
        />
      </div>

      {/* Settings Panel */}
      <div
        className={`transition-all duration-300 ease-in-out ${rightSidebarOpen ? "w-80 opacity-100" : "w-0 opacity-0"} overflow-hidden`}
      >
        <div className={`w-80 h-full ${!rightSidebarOpen && "invisible"}`}>
          <SettingsPanel />
        </div>
      </div>
    </div>
  )
}
