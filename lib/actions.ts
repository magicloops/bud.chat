'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { generateKeyBetween } from 'fractional-indexing'
import { 
  CreateChatArgs, 
  BranchChatArgs,
  ConversationId,
  MessageId,
  WorkspaceId,
  UnifiedMessage,
  Conversation
} from '@/lib/types'

// Response types for server actions
export interface ActionResponse<T = any> {
  success: boolean
  data?: T
  error?: string
}

// Removed SendMessageResponse - handled by streaming endpoint

export interface CreateChatResponse {
  conversationId: ConversationId
  userMessageId?: MessageId
  assistantMessageId?: MessageId
}

export interface BranchChatResponse {
  newConversationId: ConversationId
  messagesCopied: number
}

// Removed sendMessage - now handled by streaming endpoint

/**
 * Create a new conversation
 */
export async function createChat(args: CreateChatArgs): Promise<ActionResponse<CreateChatResponse>> {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    const { workspaceId, budId, systemPrompt, initialMessage } = args

    // Verify workspace membership
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single()

    if (!membership) {
      return { success: false, error: 'Access denied' }
    }

    // Create conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        bud_id: budId,
      })
      .select()
      .single()

    if (convError || !conversation) {
      return { success: false, error: 'Failed to create conversation' }
    }

    let userMessageId: MessageId | undefined
    let assistantMessageId: MessageId | undefined

    // Add messages if provided
    const messagesToInsert: any[] = []
    let currentOrderKey: string | undefined

    // Add system message if provided
    if (systemPrompt) {
      currentOrderKey = generateKeyBetween(null, null)
      messagesToInsert.push({
        conversation_id: conversation.id,
        order_key: currentOrderKey,
        role: 'system',
        content: systemPrompt,
        json_meta: {},
      })
    }

    // Add initial user message if provided
    if (initialMessage) {
      currentOrderKey = generateKeyBetween(currentOrderKey || null, null)
      messagesToInsert.push({
        conversation_id: conversation.id,
        order_key: currentOrderKey,
        role: 'user',
        content: initialMessage,
        json_meta: {},
      })

      // Add assistant placeholder
      currentOrderKey = generateKeyBetween(currentOrderKey, null)
      messagesToInsert.push({
        conversation_id: conversation.id,
        order_key: currentOrderKey,
        role: 'assistant',
        content: '',
        json_meta: { isPending: true },
      })
    }

    if (messagesToInsert.length > 0) {
      const { data: insertedMessages, error: msgError } = await supabase
        .from('messages')
        .insert(messagesToInsert)
        .select('id, role')

      if (msgError) {
        console.error('Error inserting messages:', msgError)
        // Don't fail the conversation creation for this
      } else if (insertedMessages) {
        userMessageId = insertedMessages.find(m => m.role === 'user')?.id
        assistantMessageId = insertedMessages.find(m => m.role === 'assistant')?.id
      }
    }

    return {
      success: true,
      data: {
        conversationId: conversation.id,
        userMessageId,
        assistantMessageId,
      }
    }
  } catch (error) {
    console.error('Error in createChat:', error)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Branch/fork a conversation from a specific message
 */
export async function branchChat(args: BranchChatArgs): Promise<ActionResponse<BranchChatResponse>> {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    const { originalConversationId, fromMessageId, workspaceId } = args

    // Verify access to original conversation
    const { data: originalConv } = await supabase
      .from('conversations')
      .select(`
        workspace:workspace_id (
          workspace_members!workspace_members_workspace_id_fkey (
            user_id
          )
        )
      `)
      .eq('id', originalConversationId)
      .single()

    const isMember = originalConv?.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      return { success: false, error: 'Access denied' }
    }

    // Get messages up to the branch point
    const { data: allMessages } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', originalConversationId)
      .order('order_key')

    if (!allMessages) {
      return { success: false, error: 'Failed to fetch messages' }
    }

    // Find the branch point and get messages up to it
    const branchIndex = allMessages.findIndex(m => m.id === fromMessageId)
    if (branchIndex === -1) {
      return { success: false, error: 'Branch point message not found' }
    }

    const messagesToCopy = allMessages.slice(0, branchIndex + 1)

    // Create new conversation
    const { data: newConversation, error: newConvError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        root_msg_id: fromMessageId, // Reference to the original message
      })
      .select()
      .single()

    if (newConvError || !newConversation) {
      return { success: false, error: 'Failed to create new conversation' }
    }

    // Copy messages to new conversation with new fractional keys
    const newMessages: any[] = []
    let lastOrderKey: string | null = null
    
    for (const msg of messagesToCopy) {
      const orderKey = generateKeyBetween(lastOrderKey, null)
      newMessages.push({
        conversation_id: newConversation.id,
        order_key: orderKey,
        role: msg.role,
        content: msg.content,
        json_meta: msg.json_meta,
      })
      lastOrderKey = orderKey
    }

    const { error: copyError } = await supabase
      .from('messages')
      .insert(newMessages)

    if (copyError) {
      // Clean up the conversation if message copying fails
      await supabase
        .from('conversations')
        .delete()
        .eq('id', newConversation.id)
      
      return { success: false, error: 'Failed to copy messages' }
    }

    return {
      success: true,
      data: {
        newConversationId: newConversation.id,
        messagesCopied: messagesToCopy.length,
      }
    }
  } catch (error) {
    console.error('Error in branchChat:', error)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Update a message (for edits)
 */
export async function updateMessage(
  conversationId: ConversationId,
  messageId: MessageId,
  content: string,
  expectedVersion: number
): Promise<ActionResponse<UnifiedMessage>> {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    // Update with optimistic concurrency control
    const { data: updatedMessage, error: updateError } = await supabase
      .from('messages')
      .update({
        content,
        version: expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', messageId)
      .eq('version', expectedVersion)
      .select()
      .single()

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return { success: false, error: 'Message was modified by another user' }
      }
      return { success: false, error: 'Failed to update message' }
    }

    if (!updatedMessage) {
      return { success: false, error: 'Message was modified by another user' }
    }

    return {
      success: true,
      data: updatedMessage as UnifiedMessage
    }
  } catch (error) {
    console.error('Error in updateMessage:', error)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Delete a message
 */
export async function deleteMessage(
  conversationId: ConversationId,
  messageId: MessageId
): Promise<ActionResponse<void>> {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    // Verify access through conversation membership
    const { data: conversation } = await supabase
      .from('conversations')
      .select(`
        workspace:workspace_id (
          workspace_members!workspace_members_workspace_id_fkey (
            user_id
          )
        )
      `)
      .eq('id', conversationId)
      .single()

    const isMember = conversation?.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      return { success: false, error: 'Access denied' }
    }

    const { error: deleteError } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)

    if (deleteError) {
      return { success: false, error: 'Failed to delete message' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in deleteMessage:', error)
    return { success: false, error: 'Internal server error' }
  }
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId: ConversationId): Promise<ActionResponse<void>> {
  try {
    const supabase = await createClient()
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' }
    }

    // Verify access
    const { data: conversation } = await supabase
      .from('conversations')
      .select(`
        workspace:workspace_id (
          workspace_members!workspace_members_workspace_id_fkey (
            user_id
          )
        )
      `)
      .eq('id', conversationId)
      .single()

    const isMember = conversation?.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      return { success: false, error: 'Access denied' }
    }

    // Delete conversation (messages will cascade)
    const { error: deleteError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', conversationId)

    if (deleteError) {
      return { success: false, error: 'Failed to delete conversation' }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in deleteConversation:', error)
    return { success: false, error: 'Internal server error' }
  }
}