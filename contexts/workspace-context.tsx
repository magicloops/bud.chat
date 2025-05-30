'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useWorkspaces } from '@/hooks/use-workspaces'

export interface Workspace {
  id: string
  name: string
  created_at: string
  updated_at: string
}

interface WorkspaceContextType {
  selectedWorkspace: Workspace | null
  setSelectedWorkspace: (workspace: Workspace | null) => void
  workspaces: Workspace[]
  loading: boolean
  createWorkspace: (name: string) => Promise<Workspace>
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null)
  const { workspaces, loading, createWorkspace } = useWorkspaces()

  // Initialize selected workspace from localStorage or first workspace
  useEffect(() => {
    if (workspaces.length > 0) {
      // Try to restore previously selected workspace from localStorage
      const savedWorkspaceId = localStorage.getItem('selectedWorkspaceId')
      if (savedWorkspaceId) {
        const savedWorkspace = workspaces.find(w => w.id === savedWorkspaceId)
        if (savedWorkspace) {
          setSelectedWorkspace(savedWorkspace)
          return
        }
      }
      
      // Fallback to first workspace if no saved workspace or saved workspace not found
      if (!selectedWorkspace) {
        setSelectedWorkspace(workspaces[0])
        localStorage.setItem('selectedWorkspaceId', workspaces[0].id)
      }
    }
  }, [workspaces])

  // Save to localStorage when workspace changes
  useEffect(() => {
    if (selectedWorkspace) {
      localStorage.setItem('selectedWorkspaceId', selectedWorkspace.id)
    }
  }, [selectedWorkspace])

  return (
    <WorkspaceContext.Provider 
      value={{ 
        selectedWorkspace, 
        setSelectedWorkspace, 
        workspaces, 
        loading, 
        createWorkspace 
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspaceContext() {
  const context = useContext(WorkspaceContext)
  if (context === undefined) {
    throw new Error('useWorkspaceContext must be used within a WorkspaceProvider')
  }
  return context
}