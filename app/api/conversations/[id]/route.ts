import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: conversationId } = await params
    const { searchParams } = new URL(request.url)
    const includeMessages = searchParams.get('include_messages') === 'true'
    
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get conversation with workspace membership check
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        created_at,
        workspace:workspace_id (
          id,
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation) {
      return new Response('Conversation not found', { status: 404 })
    }

    // Check if user is a member of the workspace
    const isMember = conversation.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      return new Response('Access denied', { status: 403 })
    }

    // If messages are requested, fetch them too
    if (includeMessages) {
      const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('order_key', { ascending: true })

      if (messagesError) {
        console.error('Error fetching messages:', messagesError)
        return new Response('Error fetching messages', { status: 500 })
      }

      // Messages are already sorted by order_key
      return Response.json({
        ...conversation,
        messages: messages || []
      })
    }

    return Response.json(conversation)
  } catch (error) {
    console.error('Get conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return new Response('Title updates not supported in new schema', { status: 501 })
  } catch (error) {
    console.error('Update conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}

export async function DELETE(
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

    // Verify user has access through workspace membership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        workspace:workspace_id (
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation) {
      return new Response('Conversation not found', { status: 404 })
    }

    const isMember = conversation.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      return new Response('Access denied', { status: 403 })
    }

    // Delete the conversation (messages will be cascade deleted)
    const { error: deleteError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)

    if (deleteError) {
      return new Response('Error deleting conversation', { status: 500 })
    }

    return new Response('Conversation deleted successfully', { status: 200 })
  } catch (error) {
    console.error('Delete conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}