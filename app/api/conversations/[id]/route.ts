import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

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