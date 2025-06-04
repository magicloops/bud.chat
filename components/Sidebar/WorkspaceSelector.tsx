'use client'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useWorkspaces } from '@/state/workspaceStore'
import { useUIState, useSetSelectedWorkspace, useSetSelectedConversation } from '@/state/chatStore'
import { Building2, Plus } from 'lucide-react'

export function WorkspaceSelector() {
  const workspaces = useWorkspaces()
  const uiState = useUIState()
  const setSelectedWorkspace = useSetSelectedWorkspace()
  const setSelectedConversation = useSetSelectedConversation()

  const selectedWorkspace = workspaces.find(w => w.id === uiState.selectedWorkspace)

  const handleWorkspaceChange = (workspaceId: string) => {
    setSelectedWorkspace(workspaceId)
    // Clear selected conversation when switching workspaces
    setSelectedConversation(null)
  }

  const handleNewWorkspace = async () => {
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Workspace ${workspaces.length + 1}`,
        }),
      })

      if (response.ok) {
        const newWorkspace = await response.json()
        // Refresh workspaces - this should trigger the effect in Sidebar
        window.location.reload()
      } else {
        console.error('Failed to create workspace')
      }
    } catch (error) {
      console.error('Error creating workspace:', error)
    }
  }

  if (workspaces.length === 0) {
    return (
      <div className="text-center p-4">
        <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm text-muted-foreground mb-2">No workspaces</p>
        <Button onClick={handleNewWorkspace} size="sm">
          <Plus className="h-3 w-3 mr-1" />
          Create Workspace
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Select
        value={uiState.selectedWorkspace || undefined}
        onValueChange={handleWorkspaceChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select workspace">
            {selectedWorkspace && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span>{selectedWorkspace.name}</span>
              </div>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span>{workspace.name}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={handleNewWorkspace}
        className="w-full"
      >
        <Plus className="h-3 w-3 mr-1" />
        New Workspace
      </Button>
    </div>
  )
}