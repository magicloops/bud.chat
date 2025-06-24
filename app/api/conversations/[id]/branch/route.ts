import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  console.log('🌿 Branch route hit!')
  try {
    const { id: originalConversationId } = await params
    console.log('🌿 Original conversation ID:', originalConversationId)
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    console.log('🌿 Auth check:', { user: !!user, authError: !!authError })
    if (authError || !user) {
      console.log('🌿 Returning 401 Unauthorized')
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    console.log('🌿 Request body:', body)
    const { branchPosition, branchMessage, title } = body

    if (typeof branchPosition !== 'number' || branchPosition < 0) {
      console.log('🌿 Missing or invalid branchPosition')
      return new Response('branchPosition is required and must be a non-negative number', { status: 400 })
    }
    console.log('🌿 Branch from position:', branchPosition)

    // Validate branch message for additional verification (optional but helpful)
    if (!branchMessage || !branchMessage.role) {
      console.log('🌿 Missing branchMessage verification data')
      return new Response('branchMessage verification data is required', { status: 400 })
    }

    // Get original conversation and verify access
    console.log('🌿 Fetching original conversation...')
    
    // First check if conversation exists at all
    const { data: convCheck, error: checkError } = await supabase
      .from('conversations')
      .select('id, workspace_id')
      .eq('id', originalConversationId)
    
    console.log('🌿 Conversation check:', { 
      count: convCheck?.length, 
      checkError: checkError?.message,
      conversationId: originalConversationId 
    })
    
    const { data: originalConversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        *,
        workspace:workspace_id (
          id,
          workspace_members!workspace_members_workspace_id_fkey (
            user_id,
            role
          )
        )
      `)
      .eq('id', originalConversationId)
      .maybeSingle()
    
    console.log('🌿 Original conversation result:', { 
      found: !!originalConversation, 
      error: !!convError,
      convError: convError?.message 
    })

    if (convError || !originalConversation) {
      console.log('🌿 Conversation not found:', {
        convError: !!convError,
        originalConversation: !!originalConversation,
        convErrorMessage: convError?.message
      })
      return new Response('Conversation not found', { status: 404 })
    }

    // Check if user is a member of the workspace
    const isMember = originalConversation.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      console.log('🌿 Access denied - not a workspace member:', {
        userId: user.id,
        workspaceId: originalConversation.workspace?.id,
        members: originalConversation.workspace?.workspace_members?.map((m: any) => m.user_id)
      })
      return new Response('Access denied', { status: 403 })
    }

    // Create new conversation for the branch
    console.log('🌿 Creating new conversation...')
    const { data: newConversation, error: newConvError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: originalConversation.workspace_id,
        title: title || `🌱 ${originalConversation.title}`,
        metadata: originalConversation.metadata || {}
      })
      .select()
      .single()

    if (newConvError) {
      console.log('🌿 Error creating new conversation:', newConvError)
      return new Response('Error creating branched conversation', { status: 500 })
    }
    
    console.log('🌿 New conversation created:', newConversation.id)

    // Get all messages for the conversation (no sorting needed)
    console.log('🌿 Fetching messages...')
    const { data: allMessages, error: msgsError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', originalConversationId)

    if (msgsError) {
      console.log('🌿 Error fetching messages:', msgsError)
      return new Response('Error fetching messages to copy', { status: 500 })
    }
    
    console.log('🌿 Messages fetched:', allMessages?.length || 0)

    // Sort messages by order_key to get proper sequence
    const sortedMessages = allMessages.sort((a, b) => a.order_key.localeCompare(b.order_key))
    
    // Validate that branchPosition is within bounds
    if (branchPosition >= sortedMessages.length) {
      console.error('🌿 Branch position out of bounds:', {
        branchPosition,
        totalMessages: sortedMessages.length,
        maxValidPosition: sortedMessages.length - 1
      })
      return new Response('Branch position is out of bounds', { status: 400 })
    }
    
    // Get the message at the specified position
    const branchMessageFromDB = sortedMessages[branchPosition]
    console.log('🌿 Branch message at position', branchPosition, ':', {
      id: branchMessageFromDB.id,
      role: branchMessageFromDB.role,
      content_preview: branchMessageFromDB.content.substring(0, 50)
    })
    
    // Optional verification: check if the message matches what the frontend expects
    if (branchMessage.role !== branchMessageFromDB.role) {
      console.warn('🌿 Role mismatch at branch position:', {
        expected: branchMessage.role,
        actual: branchMessageFromDB.role,
        position: branchPosition
      })
      // Continue anyway - the position is authoritative
    }

    // Get messages up to and including the branch point
    const relevantMessages = sortedMessages.slice(0, branchPosition + 1)
    
    console.log('Branch operation details:', {
      originalConversationId,
      branchPosition,
      branchMessageId: branchMessageFromDB.id,
      totalMessages: allMessages.length,
      branchMessageRole: branchMessageFromDB.role,
      chainLength: relevantMessages.length
    })
    
    console.log('Messages to copy (ordered by order_key):', {
      messagesToCopy: relevantMessages.length,
      messageChain: relevantMessages.map(m => ({ id: m.id, role: m.role, order_key: m.order_key }))
    })

    // Initialize insertedMessages for return value
    let insertedMessages = []

    // Copy messages to new conversation, preserving the parent-child chain structure
    if (relevantMessages.length > 0) {
      const messagesToInsert = relevantMessages.map((msg, index) => ({
        conversation_id: newConversation.id,
        order_key: msg.order_key, // Keep original order keys for proper sequencing
        role: msg.role,
        content: msg.content,
        json_meta: msg.json_meta || {}
      }))

      const { data: insertedMessagesResult, error: insertError } = await supabase
        .from('messages')
        .insert(messagesToInsert)
        .select()

      insertedMessages = insertedMessagesResult || []

      if (insertError) {
        console.error('Error inserting branched messages:', insertError)
        // Clean up the conversation if message copying fails
        await supabase
          .from('conversations')
          .delete()
          .eq('id', newConversation.id)
        
        return new Response('Error copying messages to branched conversation', { status: 500 })
      }

      console.log('🌿 Messages copied successfully, order preserved by order_key')
    }

    const response = {
      branchedConversation: newConversation,
      originalConversation: originalConversationId,
      messagesCopied: relevantMessages.length,
      branchPosition: branchPosition, // The position that was branched from
      branchMessageId: branchMessageFromDB.id, // The actual DB message ID that was branched from
      totalMessages: allMessages?.length || 0,
      insertedMessages: insertedMessages // Return the new messages with their IDs
    }
    console.log('🌿 Returning success response:', { messagesCopied: response.messagesCopied, newConvId: response.branchedConversation.id })
    return Response.json(response)
  } catch (error) {
    console.error('🌿 Branch conversation error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
