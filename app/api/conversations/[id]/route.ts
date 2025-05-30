import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

// Sort messages by parent-child relationships for proper display order
function sortMessagesByParentChain(messages: any[]): any[] {
  if (messages.length === 0) return []
  
  try {
    const messageMap = new Map(messages.map(msg => [msg.id, msg]))
    const sorted: any[] = []
    const visited = new Set<string>()
    
    // Find root messages (parent_id is null or undefined)
    const rootMessages = messages.filter(msg => !msg.parent_id)
    
    // For each root, build the chain
    for (const root of rootMessages) {
      const chain = []
      let current = root
      const chainVisited = new Set<string>()
      
      while (current && !visited.has(current.id) && !chainVisited.has(current.id)) {
        chainVisited.add(current.id)
        visited.add(current.id)
        chain.push(current)
        
        // Find child message (message with this message as parent)
        const child = messages.find(msg => msg.parent_id === current.id)
        current = child
      }
      
      sorted.push(...chain)
    }
    
    // Add any remaining messages that weren't part of chains (preserve original order)
    const remaining = messages.filter(msg => !visited.has(msg.id))
    sorted.push(...remaining)
    
    return sorted
  } catch (error) {
    console.warn('Error in server-side message sorting, falling back to original order:', error)
    return messages
  }
}

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

    // Get conversation with workspace check for access control
    const { data: conversation, error: convError } = await supabase
      .from('conversation')
      .select(`
        id,
        title,
        metadata,
        created_at,
        updated_at,
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

    // If messages are requested, fetch them too
    if (includeMessages) {
      const { data: messages, error: messagesError } = await supabase
        .from('message')
        .select('*')
        .eq('convo_id', conversationId)
        .order('created_at', { ascending: true })

      if (messagesError) {
        console.error('Error fetching messages:', messagesError)
        return new Response('Error fetching messages', { status: 500 })
      }

      // Sort messages by parent-child relationships instead of timestamp
      const sortedMessages = sortMessagesByParentChain(messages || [])

      return Response.json({
        ...conversation,
        messages: sortedMessages
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
    const { id: conversationId } = await params
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { title } = body

    if (!title || typeof title !== 'string' || !title.trim()) {
      return new Response('Valid title is required', { status: 400 })
    }

    // Verify user owns this conversation through workspace ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversation')
      .select(`
        id,
        workspace:workspace_id (
          owner_id
        )
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation || conversation.workspace?.owner_id !== user.id) {
      return new Response('Conversation not found or access denied', { status: 404 })
    }

    // Update the conversation title
    const { data: updatedConversation, error: updateError } = await supabase
      .from('conversation')
      .update({ 
        title: title.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', conversationId)
      .select()
      .single()

    if (updateError) {
      return new Response('Error updating conversation', { status: 500 })
    }

    return Response.json(updatedConversation)
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

    // Verify user owns this conversation through workspace ownership
    const { data: conversation, error: convError } = await supabase
      .from('conversation')
      .select(`
        id,
        workspace:workspace_id (
          owner_id
        )
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation || conversation.workspace?.owner_id !== user.id) {
      return new Response('Conversation not found or access denied', { status: 404 })
    }

    // Delete the conversation (messages will be cascade deleted)
    const { error: deleteError } = await supabase
      .from('conversation')
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