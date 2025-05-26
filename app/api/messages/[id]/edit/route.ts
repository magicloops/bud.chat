import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: messageId } = await params
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { newContent } = body

    if (!newContent) {
      return new Response('newContent is required', { status: 400 })
    }

    // Get the original message and verify access
    const { data: originalMessage, error: msgError } = await supabase
      .from('message')
      .select(`
        *,
        conversation:convo_id (
          workspace_id,
          workspace:workspace_id (
            owner_id
          )
        )
      `)
      .eq('id', messageId)
      .single()

    if (msgError || !originalMessage) {
      return new Response('Message not found', { status: 404 })
    }

    if (originalMessage.conversation?.workspace?.owner_id !== user.id) {
      return new Response('Access denied', { status: 403 })
    }

    // Update the message with new content and increment revision
    const { data: updatedMessage, error: updateError } = await supabase
      .from('message')
      .update({
        content: newContent,
        revision: (originalMessage.revision || 1) + 1,
        supersedes_id: originalMessage.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select()
      .single()

    if (updateError) {
      return new Response('Error updating message', { status: 500 })
    }

    return Response.json({
      message: updatedMessage,
      originalMessage: originalMessage
    })
  } catch (error) {
    console.error('Edit message error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}