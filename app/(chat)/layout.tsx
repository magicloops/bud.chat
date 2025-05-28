"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation" 
import ChatSidebar from "@/components/chat-sidebar"
import SettingsPanel from "@/components/settings-panel"
import { ModelProvider } from "@/contexts/model-context"
import { ChatLayoutProvider } from "@/contexts/chat-layout-context"
import { Database } from "@/lib/types/database"

type Workspace = Database['public']['Tables']['workspace']['Row']
type Conversation = Database['public']['Tables']['conversation']['Row']

interface ChatLayoutProps {
  children: React.ReactNode
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState('')
  const router = useRouter()
  const pathname = usePathname()

  // Listen for URL changes from history API
  useEffect(() => {
    setCurrentPath(pathname)
    
    const handleUrlChange = () => {
      setCurrentPath(window.location.pathname)
    }
    
    window.addEventListener('popstate', handleUrlChange)
    
    return () => {
      window.removeEventListener('popstate', handleUrlChange)
    }
  }, [pathname])

  const handleConversationSelect = (conversation: Conversation, workspace: Workspace) => {
    // Navigate to the selected conversation
    router.push(`/${conversation.id}`)
  }

  const handleConversationChange = (conversationId: string, workspaceId: string, title?: string, messages?: any[]) => {
    // Navigate to the new conversation
    router.push(`/${conversationId}`)
  }

  // Get current conversation ID from current path (includes history API changes)
  const getCurrentConversationId = () => {
    const pathToUse = currentPath || pathname
    const pathParts = pathToUse.split('/').filter(Boolean)
    return pathParts[0] === 'new' ? undefined : pathParts[0]
  }

  return (
    <ModelProvider>
      <div className="flex h-screen w-full bg-background overflow-hidden">
        
        {/* Left Sidebar - Persists across navigation */}
        <div
          className={`transition-all duration-300 ease-in-out ${
            leftSidebarOpen ? "w-60 min-w-0 opacity-100" : "w-0 opacity-0"
          } overflow-hidden`}
        >
          <div className={`w-full h-full ${!leftSidebarOpen && "invisible"}`}>
            <ChatSidebar 
              selectedConversationId={getCurrentConversationId()}
              onConversationSelect={handleConversationSelect}
              onConversationUpdate={() => {}} // Real-time updates handled in the hook
              onConversationChange={handleConversationChange}
            />
          </div>
        </div>

        {/* Main Content Area - Changes based on route */}
        <div className="flex-1 flex flex-col border-l border-r min-w-0">
          <ChatLayoutProvider value={{
            toggleLeftSidebar: () => setLeftSidebarOpen(!leftSidebarOpen),
            toggleRightSidebar: () => setRightSidebarOpen(!rightSidebarOpen),
            leftSidebarOpen,
            rightSidebarOpen
          }}>
            {children}
          </ChatLayoutProvider>
        </div>

        {/* Right Sidebar - Also persists */}
        <div
          className={`transition-all duration-300 ease-in-out ${
            rightSidebarOpen ? "w-80 min-w-0 opacity-100" : "w-0 opacity-0"
          } overflow-hidden`}
        >
          <div className={`w-full h-full ${!rightSidebarOpen && "invisible"}`}>
            <SettingsPanel />
          </div>
        </div>
      </div>
    </ModelProvider>
  )
}