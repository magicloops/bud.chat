import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Database } from '@/lib/types/database'

type Conversation = Database['public']['Tables']['conversation']['Row']

export function useConversations(workspaceId: string | null, onConversationUpdate?: (conversation: Conversation) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setConversations([])
      setLoading(false)
      return
    }

    const supabase = createClient()

    // Fetch initial conversations
    const fetchConversations = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('conversation')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })

      if (error) {
        console.error('Error fetching conversations:', error)
        setError(error.message)
      } else {
        setConversations(data || [])
      }
      setLoading(false)
    }

    fetchConversations()

    // Set up real-time subscription
    const channel = supabase
      .channel(`conversations:${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation',
          filter: `workspace_id=eq.${workspaceId}`
        },
        (payload) => {
          // Batch state updates to reduce re-renders
          requestAnimationFrame(() => {
            if (payload.eventType === 'INSERT') {
              const newConversation = payload.new as Conversation
              setConversations(prev => {
                // Prevent duplicates
                if (prev.some(conv => conv.id === newConversation.id)) {
                  return prev
                }
                return [newConversation, ...prev]
              })
              onConversationUpdate?.(newConversation)
            } else if (payload.eventType === 'UPDATE') {
              const updatedConversation = payload.new as Conversation
              setConversations(prev => {
                // Check if the conversation actually changed to avoid unnecessary updates
                const existingConv = prev.find(conv => conv.id === updatedConversation.id)
                if (existingConv && existingConv.updated_at === updatedConversation.updated_at) {
                  return prev // No change, avoid re-render
                }
                
                // More efficient: update the specific conversation and move to front if newer
                const updated = prev.map(conv => 
                  conv.id === updatedConversation.id ? updatedConversation : conv
                )
                
                // Only sort if the updated conversation should be at the top
                const updatedIndex = updated.findIndex(conv => conv.id === updatedConversation.id)
                if (updatedIndex > 0) {
                  // Move to front if it's not already there and is newer
                  const [updatedItem] = updated.splice(updatedIndex, 1)
                  return [updatedItem, ...updated]
                }
                
                return updated
              })
              onConversationUpdate?.(updatedConversation)
            } else if (payload.eventType === 'DELETE') {
              setConversations(prev => 
                prev.filter(conv => conv.id !== payload.old.id)
              )
            }
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [workspaceId])

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
      // Don't manually add to state - let the real-time subscription handle it
      return newConversation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create conversation')
      throw err
    }
  }

  const deleteConversation = async (conversationId: string) => {
    try {
      // Optimistic update: remove immediately for instant feedback
      setConversations(prev => prev.filter(c => c.id !== conversationId))
      
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        // Revert optimistic update on error - refetch conversations
        if (workspaceId) {
          const supabase = createClient()
          const { data } = await supabase
            .from('conversation')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('updated_at', { ascending: false })
          
          if (data) {
            setConversations(data)
          }
        }
        throw new Error('Failed to delete conversation')
      }

      // Success - the real-time subscription will sync any differences
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
    deleteConversation
  }
}