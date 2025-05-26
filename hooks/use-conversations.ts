import { useState, useEffect } from 'react'
import { Database } from '@/lib/types/database'

type Conversation = Database['public']['Tables']['conversation']['Row']

export function useConversations(workspaceId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setConversations([])
      setLoading(false)
      return
    }

    fetchConversations()
  }, [workspaceId])

  const fetchConversations = async () => {
    if (!workspaceId) return

    try {
      setLoading(true)
      const response = await fetch(`/api/conversations?workspace_id=${workspaceId}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch conversations')
      }
      
      const data = await response.json()
      setConversations(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const createConversation = async (title?: string, systemPrompt?: string) => {
    if (!workspaceId) throw new Error('No workspace selected')

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workspaceId, 
          title: title || 'New Conversation',
          systemPrompt 
        })
      })

      if (!response.ok) {
        throw new Error('Failed to create conversation')
      }

      const newConversation = await response.json()
      setConversations(prev => [newConversation, ...prev])
      return newConversation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation')
      throw err
    }
  }

  const deleteConversation = async (conversationId: string) => {
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Failed to delete conversation')
      }

      setConversations(prev => prev.filter(c => c.id !== conversationId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation')
      throw err
    }
  }

  return {
    conversations,
    loading,
    error,
    createConversation,
    deleteConversation,
    refetch: fetchConversations
  }
}