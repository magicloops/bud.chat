'use client'

import { Sidebar } from '@/components/Sidebar'
import { useUIState } from '@/state/chatStore'

interface ChatLayoutProps {
  children: React.ReactNode
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const uiState = useUIState()

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

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 border-l">
        {children}
      </div>
    </div>
  )
}