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
  
  const { user, loading } = useAuth()

  const handleConversationSelect = (conversation: Conversation, workspace: Workspace) => {
    setSelectedConversation(conversation)
    setSelectedWorkspace(workspace)
  }

  const clearConversationSelection = () => {
    setSelectedConversation(null)
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
