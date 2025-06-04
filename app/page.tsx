'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-provider'
import { AuthModal } from '@/components/auth/auth-modal'
import { Sidebar } from '@/components/Sidebar'
import { useUIState, useSetSelectedConversation, useSetSidebarOpen } from '@/state/chatStore'
import { Button } from '@/components/ui/button'
import { MessageSquare, Plus } from 'lucide-react'
import { Loader2 } from 'lucide-react'

export default function HomePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const uiState = useUIState()
  const setSelectedConversation = useSetSelectedConversation()
  const setSidebarOpen = useSetSidebarOpen()

  const handleNewConversation = () => {
    setSelectedConversation(null)
    router.push('/new')
  }

  const toggleSidebar = () => {
    setSidebarOpen(!uiState.sidebarOpen)
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
      {/* Sidebar */}
      <div className={`
        transition-all duration-300 ease-in-out 
        ${uiState.sidebarOpen ? 'opacity-100' : 'opacity-0 w-0'}
        overflow-hidden
      `}>
        <Sidebar className="h-full" />
      </div>

      {/* Main Welcome Area */}
      <div className="flex-1 flex flex-col border-l min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8" 
              onClick={toggleSidebar}
            >
              <MessageSquare className="h-5 w-5" />
            </Button>
            <span className="font-medium">Welcome to bud.chat</span>
          </div>
        </div>

        {/* Welcome Content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto p-8">
            <MessageSquare className="h-16 w-16 mx-auto mb-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold mb-4">Start a new conversation</h1>
            <p className="text-muted-foreground mb-8">
              Begin chatting with AI and explore ideas through branching conversations. 
              Your conversations are automatically saved and organized by workspace.
            </p>
            
            <div className="space-y-4">
              <Button onClick={handleNewConversation} className="gap-2" size="lg">
                <Plus className="h-4 w-4" />
                New Conversation
              </Button>
              
              <div className="text-sm text-muted-foreground/80">
                <p>💡 Pro tip: You can branch any conversation to explore different directions</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}