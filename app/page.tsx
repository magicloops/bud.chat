"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth/auth-provider"
import { AuthModal } from "@/components/auth/auth-modal"
import ChatSidebar from "@/components/chat-sidebar"
import { ModelProvider } from "@/contexts/model-context"
import { Loader2, MessageSquare, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Database } from "@/lib/types/database"

type Workspace = Database['public']['Tables']['workspace']['Row']
type Conversation = Database['public']['Tables']['conversation']['Row']

export default function HomePage() {
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const { user, loading } = useAuth()
  const router = useRouter()

  const handleConversationSelect = (conversation: Conversation, workspace: Workspace) => {
    // Navigate to the selected conversation
    router.push(`/${conversation.id}`)
  }

  const handleNewConversation = () => {
    // Navigate to new conversation route
    router.push('/new')
  }

  const handleConversationChange = (conversationId: string, workspaceId: string, title?: string, messages?: any[]) => {
    // Navigate to the new conversation
    router.push(`/${conversationId}`)
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
    <ModelProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        
        {/* Left Sidebar */}
        <div
          className={`transition-all duration-300 ease-in-out ${
            leftSidebarOpen ? "w-60 min-w-0 opacity-100" : "w-0 opacity-0"
          } overflow-hidden`}
        >
          <div className={`w-full h-full ${!leftSidebarOpen && "invisible"}`}>
            <ChatSidebar 
              selectedConversationId={undefined}
              onConversationSelect={handleConversationSelect}
              onConversationUpdate={() => {}}
              onConversationChange={handleConversationChange}
            />
          </div>
        </div>

        {/* Main Welcome Area */}
        <div className="flex-1 flex flex-col border-l border-r min-w-0">
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}>
                <span className="sr-only">Toggle sidebar</span>
                <MessageSquare className="h-5 w-5" />
              </Button>
              <span className="font-medium">Welcome to Bud Chat</span>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto p-8">
              <MessageSquare className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
              <h1 className="text-2xl font-semibold mb-4">Start a new conversation</h1>
              <p className="text-muted-foreground mb-8">
                Select a conversation from the sidebar or start a new one to begin chatting with AI.
              </p>
              <Button onClick={handleNewConversation} className="gap-2">
                <Plus className="h-4 w-4" />
                New Conversation
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ModelProvider>
  )
}
