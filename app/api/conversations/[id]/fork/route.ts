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
    const { forkFromMessageId, title } = body

    if (!forkFromMessageId) {
      return new Response('forkFromMessageId is required', { status: 400 })
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
        title: title || `🌱 ${originalConversation.title}`
      })
      .select()
      .single()

    if (newConvError) {
      return new Response('Error creating forked conversation', { status: 500 })
    }

    // Get all messages in chronological order
    const { data: allMessages, error: msgsError } = await supabase
      .from('message')
      .select('*')
      .eq('convo_id', originalConversationId)
      .order('created_at', { ascending: true })

    if (msgsError) {
      return new Response('Error fetching messages to copy', { status: 500 })
    }

    // Find the fork point message
    const forkMessage = allMessages?.find(msg => msg.id === forkFromMessageId)
    if (!forkMessage) {
      return new Response('Fork point message not found', { status: 404 })
    }

    // Copy all messages up to and including the fork point (chronologically)
    const forkMessageIndex = allMessages.indexOf(forkMessage)
    const relevantMessages = allMessages.slice(0, forkMessageIndex + 1)

    // Copy messages to new conversation
    if (relevantMessages.length > 0) {
      const messagesToInsert = relevantMessages.map((msg, index) => ({
        convo_id: newConversation.id,
        parent_id: null, // Will be set below
        path: (index + 1).toString(), // Sequential paths: 1, 2, 3...
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
        revision: 1, // Reset revision for new conversation
        supersedes_id: null, // Clear supersedes relationship
        token_count: msg.token_count,
        usage_ms: msg.usage_ms,
        created_by: user.id
      }))

      const { data: insertedMessages, error: insertError } = await supabase
        .from('message')
        .insert(messagesToInsert)
        .select()

      if (insertError) {
        console.error('Error inserting forked messages:', insertError)
        // Clean up the conversation if message copying fails
        await supabase
          .from('conversation')
          .delete()
          .eq('id', newConversation.id)
        
        return new Response('Error copying messages to forked conversation', { status: 500 })
      }

      // Update parent_id relationships 
      if (insertedMessages && insertedMessages.length > 1) {
        for (let i = 1; i < insertedMessages.length; i++) {
          const currentMsg = insertedMessages[i]
          const parentMsg = insertedMessages[i - 1]
          
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
      messagesCopied: relevantMessages.length,
      forkFromMessageIndex: forkMessageIndex + 1, // +1 for human-readable indexing
      totalMessages: allMessages?.length || 0
    })
  } catch (error) {
    console.error('Fork conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}