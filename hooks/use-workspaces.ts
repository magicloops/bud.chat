import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Database } from '@/lib/types/database'
import { useAuth } from '@/lib/auth/auth-provider'

type Workspace = Database['public']['Tables']['workspace']['Row']

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { user } = useAuth()

  useEffect(() => {
    if (!user) {
      setWorkspaces([])
      setLoading(false)
      return
    }

    fetchWorkspaces()
  }, [user])

  const fetchWorkspaces = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/workspaces')
      
      if (!response.ok) {
        throw new Error('Failed to fetch workspaces')
      }
      
      const data = await response.json()
      setWorkspaces(data)
      
      // Create default workspace if none exist
      if (data.length === 0) {
        await createWorkspace('My Workspace')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const createWorkspace = async (name: string) => {
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })

      if (!response.ok) {
        throw new Error('Failed to create workspace')
      }

      const newWorkspace = await response.json()
      setWorkspaces(prev => [newWorkspace, ...prev])
      return newWorkspace
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
      throw err
    }
  }

  return {
    workspaces,
    loading,
    error,
    createWorkspace,
    refetch: fetchWorkspaces
  }
}