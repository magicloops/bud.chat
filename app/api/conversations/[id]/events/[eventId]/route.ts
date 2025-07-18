import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { updateEventSegments } from '@/lib/db/events'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> }
) {
  try {
    const { id: conversationId, eventId } = await params
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get conversation details to check permissions
    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, workspace_id')
      .eq('id', conversationId)
      .single()

    if (conversationError || !conversation) {
      return new Response('Conversation not found', { status: 404 })
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', conversation.workspace_id)
      .eq('user_id', user.id)
      .single()

    if (membershipError || !membership) {
      return new Response('Access denied', { status: 403 })
    }

    // Get the event to verify it exists and belongs to this conversation
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .eq('conversation_id', conversationId)
      .single()

    if (eventError || !event) {
      return new Response('Event not found', { status: 404 })
    }

    // Parse request body
    const body = await request.json()
    const { content } = body

    if (!content || typeof content !== 'string') {
      return new Response('Content is required', { status: 400 })
    }

    // Update the event's segments with new content
    const updatedSegments = [
      {
        type: 'text',
        text: content
      }
    ]

    // Update event segments in database
    await updateEventSegments(eventId, updatedSegments)

    // Return updated event
    const updatedEvent = {
      id: event.id,
      role: event.role,
      segments: updatedSegments,
      ts: event.ts
    }

    return Response.json({
      success: true,
      event: updatedEvent
    })

  } catch (error) {
    console.error('Error updating event:', error)
    return new Response('Internal server error', { status: 500 })
  }
}