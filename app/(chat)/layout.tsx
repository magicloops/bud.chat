'use client'

import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/Sidebar'
import SettingsPanel from '@/components/settings-panel'
import { Button } from '@/components/ui/button'
import { PanelLeft, PanelRight } from 'lucide-react'

interface ChatLayoutProps {
  children: React.ReactNode
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)

  // Load sidebar states from localStorage on mount
  useEffect(() => {
    const savedSidebarOpen = localStorage.getItem('sidebarOpen')
    const savedRightSidebarOpen = localStorage.getItem('rightSidebarOpen')
    
    if (savedSidebarOpen !== null) {
      setSidebarOpen(savedSidebarOpen === 'true')
    }
    if (savedRightSidebarOpen !== null) {
      setRightSidebarOpen(savedRightSidebarOpen === 'true')
    }
  }, [])

  const handleSidebarToggle = (open: boolean) => {
    setSidebarOpen(open)
    localStorage.setItem('sidebarOpen', String(open))
  }

  const handleRightSidebarToggle = (open: boolean) => {
    setRightSidebarOpen(open)
    localStorage.setItem('rightSidebarOpen', String(open))
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 border-l">
        {children}
      </div>

      {/* Right Sidebar */}
      <div className={`
        transition-[width] duration-150 ease-out h-full
        ${rightSidebarOpen ? 'w-80' : 'w-0'}
        overflow-hidden border-l
      `}>
        <div className={`
          transition-opacity duration-100 ease-out h-full
          ${rightSidebarOpen ? 'opacity-100' : 'opacity-0'}
          w-80
        `}>
          <SettingsPanel onClose={() => handleRightSidebarToggle(false)} />
        </div>
      </div>

      {/* Right Sidebar Toggle Button - Always Visible */}
      {!rightSidebarOpen && (
        <div className="absolute top-4 right-4 z-50">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleRightSidebarToggle(true)}
            className="h-8 w-8 bg-background/80 backdrop-blur-sm border hover:bg-accent"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
