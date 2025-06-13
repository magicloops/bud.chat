'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConversationList } from './ConversationList'
import { WorkspaceSelector } from './WorkspaceSelector'
import { UserMenu } from './UserMenu'
import { useUIState, useSetSelectedWorkspace, useSetSelectedConversation } from '@/state/chatStore'
import { 
  useWorkspaces, 
  useSetWorkspaces, 
  useSetWorkspacesLoading 
} from '@/state/workspaceStore'
import { Plus, PanelLeftClose, PanelLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'

interface SidebarProps {
  className?: string
  onClose: () => void
}

export function Sidebar({ className, onClose }: SidebarProps) {
  const router = useRouter()
  const uiState = useUIState()
  const setSelectedWorkspace = useSetSelectedWorkspace()
  const setSelectedConversation = useSetSelectedConversation()
  const setWorkspaces = useSetWorkspaces()
  const setWorkspacesLoading = useSetWorkspacesLoading()
  const workspaces = useWorkspaces()
  
  const hasLoadedWorkspaces = useRef(false)

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
    setSelectedConversation(null)
  }

  const toggleSidebar = () => {
    onClose()
  }

  const selectedWorkspace = workspaces.find(w => w.id === uiState.selectedWorkspace)

  return (
    <div className={cn("w-60 border-r bg-muted/30 flex flex-col h-full", className)}>
      {/* Header */}
      <div className="p-4 border-b flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-semibold text-lg">bud.chat</h1>
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
      </div>

      {/* Conversations - Constrained scroll area */}
      <div className="flex-1 min-h-0">
        {uiState.selectedWorkspace ? (
          <ScrollArea className="h-full w-full max-w-full">
            <ConversationList workspaceId={uiState.selectedWorkspace} />
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
