import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: originalConversationId } = await params
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { forkFromPath, title } = body

    if (!forkFromPath) {
      return new Response('forkFromPath is required', { status: 400 })
    }

    // Get original conversation and verify access
    const { data: originalConversation, error: convError } = await supabase
      .from('conversation')
      .select(`
        *,
        workspace:workspace_id (
          id,
          owner_id
        )
      `)
      .eq('id', originalConversationId)
      .single()

    if (convError || !originalConversation || originalConversation.workspace?.owner_id !== user.id) {
      return new Response('Conversation not found or access denied', { status: 404 })
    }

    // Create new conversation for the fork
    const { data: newConversation, error: newConvError } = await supabase
      .from('conversation')
      .insert({
        workspace_id: originalConversation.workspace_id,
        title: title || `${originalConversation.title} (Fork)`
      })
      .select()
      .single()

    if (newConvError) {
      return new Response('Error creating forked conversation', { status: 500 })
    }

    // Get messages to copy (ancestors and self of the fork point)
    const { data: messagesToCopy, error: msgsError } = await supabase
      .from('message')
      .select('*')
      .eq('convo_id', originalConversationId)
      .order('path')

    if (msgsError) {
      return new Response('Error fetching messages to copy', { status: 500 })
    }

    // Filter messages that should be copied (ancestors of fork point)
    const relevantMessages = messagesToCopy?.filter(msg => {
      // Copy if message path is an ancestor of or equal to the fork point
      return forkFromPath.startsWith(msg.path) || msg.path.startsWith(forkFromPath)
    }) || []

    // Copy messages to new conversation
    if (relevantMessages.length > 0) {
      const messagesToInsert = relevantMessages.map(msg => ({
        convo_id: newConversation.id,
        parent_id: null, // Will need to be updated after insert
        path: msg.path,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
        revision: msg.revision,
        supersedes_id: msg.supersedes_id,
        token_count: msg.token_count,
        usage_ms: msg.usage_ms,
        created_by: user.id
      }))

      const { error: insertError } = await supabase
        .from('message')
        .insert(messagesToInsert)

      if (insertError) {
        // Clean up the conversation if message copying fails
        await supabase
          .from('conversation')
          .delete()
          .eq('id', newConversation.id)
        
        return new Response('Error copying messages to forked conversation', { status: 500 })
      }

      // Update parent_id relationships in the new conversation
      // This is a simplified approach - in a production system you'd want to be more careful
      const { data: newMessages } = await supabase
        .from('message')
        .select('*')
        .eq('convo_id', newConversation.id)
        .order('path')

      if (newMessages) {
        for (let i = 1; i < newMessages.length; i++) {
          const currentMsg = newMessages[i]
          const parentMsg = newMessages[i - 1]
          
          await supabase
            .from('message')
            .update({ parent_id: parentMsg.id })
            .eq('id', currentMsg.id)
        }
      }
    }

    return Response.json({
      forkedConversation: newConversation,
      originalConversation: originalConversationId,
      messagesCopied: relevantMessages.length
    })
  } catch (error) {
    console.error('Fork conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}