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

    // Validate message ID format (basic validation)
    if (typeof forkFromMessageId !== 'string' || forkFromMessageId.trim() === '') {
      return new Response('Invalid forkFromMessageId format', { status: 400 })
    }

    // Prevent forking from temporary/optimistic message IDs (greeting messages are allowed)
    if (forkFromMessageId.startsWith('temp-')) {
      return new Response('Cannot fork from temporary or optimistic messages', { status: 400 })
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
        title: title || `🌱 ${originalConversation.title}`,
        metadata: originalConversation.metadata || {}
      })
      .select()
      .single()

    if (newConvError) {
      return new Response('Error creating forked conversation', { status: 500 })
    }

    // Get all messages for the conversation (no sorting needed)
    const { data: allMessages, error: msgsError } = await supabase
      .from('message')
      .select('*')
      .eq('convo_id', originalConversationId)

    if (msgsError) {
      return new Response('Error fetching messages to copy', { status: 500 })
    }

    // Find the fork point message
    const forkMessage = allMessages?.find(msg => msg.id === forkFromMessageId)
    if (!forkMessage) {
      console.error('Fork point message not found:', {
        forkFromMessageId,
        availableMessageIds: allMessages?.map(m => m.id) || [],
        totalMessages: allMessages?.length || 0
      })
      return new Response('Fork point message not found in conversation', { status: 404 })
    }

    // Build message chain from root to fork point using parent relationships
    const buildMessageChain = (messages: any[], targetMessageId: string): any[] => {
      const messageMap = new Map(messages.map(msg => [msg.id, msg]))
      const chain: any[] = []
      
      // Start from target message and walk backwards through parent chain
      let currentMessage = messageMap.get(targetMessageId)
      const visited = new Set<string>()
      
      while (currentMessage && !visited.has(currentMessage.id)) {
        visited.add(currentMessage.id)
        chain.unshift(currentMessage) // Add to beginning to build forward chain
        
        // Move to parent message
        if (currentMessage.parent_id) {
          currentMessage = messageMap.get(currentMessage.parent_id)
        } else {
          // Reached root message (parent_id is null)
          break
        }
      }
      
      return chain
    }

    const relevantMessages = buildMessageChain(allMessages, forkFromMessageId)
    
    console.log('Fork operation details:', {
      originalConversationId,
      forkFromMessageId,
      totalMessages: allMessages.length,
      forkMessageRole: forkMessage.role,
      chainLength: relevantMessages.length
    })
    
    console.log('Messages to copy (parent-child chain):', {
      messagesToCopy: relevantMessages.length,
      messageChain: relevantMessages.map(m => ({ id: m.id, role: m.role, parent_id: m.parent_id }))
    })

    // Initialize insertedMessages for return value
    let insertedMessages = []

    // Copy messages to new conversation, preserving the parent-child chain structure
    if (relevantMessages.length > 0) {
      const messagesToInsert = relevantMessages.map((msg, index) => ({
        convo_id: newConversation.id,
        parent_id: null, // Will be set after insertion to maintain chain
        path: (index + 1).toString(), // Sequential paths based on chain order
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
        revision: 1, // Reset revision for new conversation
        supersedes_id: null, // Clear supersedes relationship
        token_count: msg.token_count,
        usage_ms: msg.usage_ms,
        created_by: user.id
      }))

      const { data: insertedMessagesResult, error: insertError } = await supabase
        .from('message')
        .insert(messagesToInsert)
        .select()

      insertedMessages = insertedMessagesResult || []

      if (insertError) {
        console.error('Error inserting forked messages:', insertError)
        // Clean up the conversation if message copying fails
        await supabase
          .from('conversation')
          .delete()
          .eq('id', newConversation.id)
        
        return new Response('Error copying messages to forked conversation', { status: 500 })
      }

      // Rebuild the parent-child chain relationships in the new conversation
      if (insertedMessages && insertedMessages.length > 1) {
        console.log('🔗 Rebuilding parent-child chain for', insertedMessages.length, 'messages')
        
        for (let i = 1; i < insertedMessages.length; i++) {
          const currentMsg = insertedMessages[i]
          const parentMsg = insertedMessages[i - 1]
          
          console.log(`🔗 Setting parent: ${currentMsg.id} -> ${parentMsg.id}`)
          
          await supabase
            .from('message')
            .update({ parent_id: parentMsg.id })
            .eq('id', currentMsg.id)
        }
        
        console.log('✅ Parent-child chain rebuilt successfully')
      }
    }

    return Response.json({
      forkedConversation: newConversation,
      originalConversation: originalConversationId,
      messagesCopied: relevantMessages.length,
      forkFromMessageId: forkFromMessageId, // The message ID that was forked from
      totalMessages: allMessages?.length || 0,
      insertedMessages: insertedMessages // Return the new messages with their IDs
    })
  } catch (error) {
    console.error('Fork conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}