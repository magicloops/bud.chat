import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Verify user has access to this conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversation')
      .select(`
        id,
        workspace_id,
        workspace:workspace_id (
          id,
          owner_id
        )
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation || conversation.workspace?.owner_id !== user.id) {
      return new Response('Conversation not found or access denied', { status: 404 })
    }

    // Get messages for this conversation
    const { data: messages, error: messagesError } = await supabase
      .from('message')
      .select('*')
      .eq('convo_id', conversationId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      return new Response('Error fetching messages', { status: 500 })
    }

    return Response.json(messages || [])
  } catch (error) {
    console.error('Get messages error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}