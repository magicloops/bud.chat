import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Database } from '@/lib/types/database'

type Message = Database['public']['Tables']['message']['Row']
type Conversation = Database['public']['Tables']['conversation']['Row']

export function useRealtimeMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      setLoading(false)
      return
    }

    const supabase = createClient()

    // Fetch initial messages
    const fetchMessages = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('message')
        .select('*')
        .eq('convo_id', conversationId)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Error fetching messages:', error)
      } else {
        setMessages(data || [])
      }
      setLoading(false)
    }

    fetchMessages()

    // Set up real-time subscription
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message',
          filter: `convo_id=eq.${conversationId}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages(prev => [...prev, payload.new as Message])
          } else if (payload.eventType === 'UPDATE') {
            setMessages(prev => 
              prev.map(msg => 
                msg.id === payload.new.id ? payload.new as Message : msg
              )
            )
          } else if (payload.eventType === 'DELETE') {
            setMessages(prev => 
              prev.filter(msg => msg.id !== payload.old.id)
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  return { messages, loading }
}

export function useRealtimeConversations(workspaceId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

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
          if (payload.eventType === 'INSERT') {
            setConversations(prev => [payload.new as Conversation, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setConversations(prev => 
              prev.map(conv => 
                conv.id === payload.new.id ? payload.new as Conversation : conv
              )
            )
          } else if (payload.eventType === 'DELETE') {
            setConversations(prev => 
              prev.filter(conv => conv.id !== payload.old.id)
            )
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [workspaceId])

  return { conversations, loading }
}