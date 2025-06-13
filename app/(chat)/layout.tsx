'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth/auth-provider'
import { AuthModal } from '@/components/auth/auth-modal'
import { Sidebar } from '@/components/Sidebar'
import SettingsPanel from '@/components/settings-panel'
import { Button } from '@/components/ui/button'
import { PanelLeft, PanelRight } from 'lucide-react'
import { Loader2 } from 'lucide-react'

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, loading } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)

  // Load sidebar state from localStorage on mount
  useEffect(() => {
    const savedSidebarOpen = localStorage.getItem('sidebarOpen')
    if (savedSidebarOpen !== null) {
      setSidebarOpen(savedSidebarOpen === 'true')
    }
    const savedSettingsPanelOpen = localStorage.getItem('settingsPanelOpen')
    if (savedSettingsPanelOpen !== null) {
      setSettingsPanelOpen(savedSettingsPanelOpen === 'true')
    }

    // Listen for settings panel toggle events
    const handleToggleSettingsPanel = (event: CustomEvent) => {
      setSettingsPanelOpen(event.detail.open)
    }
    
    window.addEventListener('toggleSettingsPanel', handleToggleSettingsPanel as EventListener)
    
    return () => {
      window.removeEventListener('toggleSettingsPanel', handleToggleSettingsPanel as EventListener)
    }
  }, [])

  const handleSidebarToggle = (open: boolean) => {
    setSidebarOpen(open)
    localStorage.setItem('sidebarOpen', String(open))
  }

  const handleSettingsPanelToggle = (open: boolean) => {
    setSettingsPanelOpen(open)
    localStorage.setItem('settingsPanelOpen', String(open))
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

      {/* Toggle Buttons - Always Visible */}
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

      {!settingsPanelOpen && (
        <div className="absolute top-4 right-4 z-50">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleSettingsPanelToggle(true)}
            className="h-8 w-8 bg-background/80 backdrop-blur-sm border hover:bg-accent"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col border-l min-w-0">
        {children}
      </div>

      {/* Right Settings Panel */}
      <div className={`
        transition-[width] ease-out h-full
        ${settingsPanelOpen ? 'w-80' : 'w-0'}
        overflow-hidden
      `}>
        <div className={`
          transition-opacity ease-out h-full
          ${settingsPanelOpen ? 'opacity-100' : 'opacity-0'}
          w-80
        `}>
          <SettingsPanel onClose={() => handleSettingsPanelToggle(false)} />
        </div>
      </div>
    </div>
  )
}