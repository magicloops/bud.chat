'use client'

import { useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConversationList } from './ConversationList'
import { WorkspaceSelector } from './WorkspaceSelector'
import { UserMenu } from './UserMenu'
import { useSelectedWorkspace, useSetSelectedWorkspace } from '@/state/simpleChatStore'
import { 
  useWorkspaces, 
  useSetWorkspaces, 
  useSetWorkspacesLoading 
} from '@/state/workspaceStore'
import { Plus, PanelLeftClose, PanelLeft, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getRandomHeaderFont } from '@/lib/fontRotation'

interface SidebarProps {
  className?: string
  onClose: () => void
}

export function Sidebar({ className, onClose }: SidebarProps) {
  const router = useRouter()
  const selectedWorkspaceId = useSelectedWorkspace()
  const setSelectedWorkspace = useSetSelectedWorkspace()
  const setWorkspaces = useSetWorkspaces()
  const setWorkspacesLoading = useSetWorkspacesLoading()
  const workspaces = useWorkspaces()
  
  const hasLoadedWorkspaces = useRef(false)
  
  // Get a random font config that stays consistent for this render
  const headerFontConfig = useMemo(() => getRandomHeaderFont(), [])

  // Load workspaces on mount
  useEffect(() => {
    if (hasLoadedWorkspaces.current) return
    const loadWorkspaces = async () => {
      try {
        setWorkspacesLoading(true)
        
        const response = await fetch('/api/workspaces')
        if (response.ok) {
          const workspacesData = await response.json()
          
          // If no workspaces exist, create a default one
          if (workspacesData.length === 0) {
            const createResponse = await fetch('/api/workspaces', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: 'My Workspace',
              }),
            })
            
            if (createResponse.ok) {
              const newWorkspace = await createResponse.json()
              setWorkspaces([newWorkspace])
              setSelectedWorkspace(newWorkspace.id)
              localStorage.setItem('lastSelectedWorkspaceId', newWorkspace.id)
            }
          } else {
            setWorkspaces(workspacesData)
            
            // Try to restore last selected workspace from localStorage
            const lastSelectedWorkspaceId = localStorage.getItem('lastSelectedWorkspaceId')
            const validWorkspaceId = lastSelectedWorkspaceId && workspacesData.find(w => w.id === lastSelectedWorkspaceId)
            
            if (validWorkspaceId) {
              // Restore the last selected workspace
              setSelectedWorkspace(lastSelectedWorkspaceId)
            } else if (workspacesData.length > 0) {
              // Fall back to first workspace and save it
              const firstWorkspaceId = workspacesData[0].id
              setSelectedWorkspace(firstWorkspaceId)
              localStorage.setItem('lastSelectedWorkspaceId', firstWorkspaceId)
            }
          }
        }
      } catch (error) {
        console.error('Failed to load workspaces:', error)
      } finally {
        setWorkspacesLoading(false)
        hasLoadedWorkspaces.current = true
      }
    }

    loadWorkspaces()
  }, []) // Only run once on mount

  const handleNewConversation = () => {
    // Navigate to new conversation route
    router.push('/new')
  }

  const handleManageBuds = () => {
    if (selectedWorkspaceId) {
      router.push(`/workspace/${selectedWorkspaceId}/buds`)
    }
  }

  const toggleSidebar = () => {
    onClose()
  }

  const selectedWorkspace = workspaces.find(w => w.id === selectedWorkspaceId)

  return (
    <div className={cn("w-60 border-r bg-muted/30 flex flex-col h-full", className)}>
      {/* Header */}
      <div className="p-4 border-b flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 
            className={headerFontConfig.className} 
            style={{ fontFamily: headerFontConfig.fontFamily }}
          >
            {headerFontConfig.text}
          </h1>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewConversation}
              className="h-8 w-8"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-8 w-8"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Workspace Selector */}
        <WorkspaceSelector />

        {/* Workspace Actions */}
        {selectedWorkspaceId && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManageBuds}
              className="w-full justify-start"
            >
              <Settings className="h-4 w-4 mr-2" />
              Manage Buds
            </Button>
          </div>
        )}
      </div>

      {/* Conversations - Constrained scroll area */}
      <div className="flex-1 min-h-0">
        {selectedWorkspaceId ? (
          <ScrollArea className="h-full w-full max-w-full">
            <ConversationList workspaceId={selectedWorkspaceId} />
          </ScrollArea>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="p-4 text-center text-muted-foreground">
              <p>Select a workspace to view conversations</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer - Always visible at bottom */}
      <div className="p-4 border-t flex-shrink-0 mt-auto">
        <UserMenu />
      </div>
    </div>
  )
}
