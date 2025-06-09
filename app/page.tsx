'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth/auth-provider'
import { AuthModal } from '@/components/auth/auth-modal'
import { Sidebar } from '@/components/Sidebar'
import { useSetSelectedConversation } from '@/state/chatStore'
import { Button } from '@/components/ui/button'
import { MessageSquare, Plus, PanelLeft } from 'lucide-react'
import { Loader2 } from 'lucide-react'

export default function HomePage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const setSelectedConversation = useSetSelectedConversation()
  
  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const savedSidebarOpen = localStorage.getItem('sidebarOpen')
    if (savedSidebarOpen !== null) {
      setSidebarOpen(savedSidebarOpen === 'true')
    }
  }, [])

  const handleSidebarToggle = (open: boolean) => {
    setSidebarOpen(open)
    localStorage.setItem('sidebarOpen', String(open))
  }

  const handleNewConversation = () => {
    setSelectedConversation(null)
    router.push('/new')
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
      <div className={`
        transition-[width] ease-out h-full
        ${sidebarOpen ? 'w-60' : 'w-0'}
        overflow-hidden
      `}>
        <div className={`
          transition-opacity ease-out h-full
          ${sidebarOpen ? 'opacity-100' : 'opacity-0'}
          w-60
        `}>
          <Sidebar className="h-full" onClose={() => handleSidebarToggle(false)} />
        </div>
      </div>

      {/* Left Sidebar Toggle Button - Always Visible */}
      {!sidebarOpen && (
        <div className="absolute top-4 left-4 z-50">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleSidebarToggle(true)}
            className="h-8 w-8 bg-background/80 backdrop-blur-sm border hover:bg-accent"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Main Welcome Area */}
      <div className="flex-1 flex flex-col border-l min-w-0">
        {/* Header */}
        <div className="flex items-center justify-center p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 relative">
          <span className="font-medium">Welcome to bud.chat</span>
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
