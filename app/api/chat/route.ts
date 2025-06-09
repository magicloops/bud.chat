import { createClient } from '@/lib/supabase/server'
import { Database } from '@/lib/types/database'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import { generateKeyBetween } from 'fractional-indexing'

type Message = Database['public']['Tables']['messages']['Row']

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

// Helper function to generate a conversation title
async function generateConversationTitle(conversationId: string, supabase: any) {
  try {
    // Check if conversation already has a title
    const { data: conversation } = await supabase
      .from('conversations')
      .select('title')
      .eq('id', conversationId)
      .single()

    if (conversation?.title) {
      return // Already has a title
    }

    // Count non-system messages in the conversation
    const { data: messages, count } = await supabase
      .from('messages')
      .select('id', { count: 'exact' })
      .eq('conversation_id', conversationId)
      .neq('role', 'system')

    // Generate title after 3 messages (should be 2 user + 1 assistant minimum)
    if (!count || count < 3) {
      return // Not enough messages yet
    }

    // Get the first few messages of the conversation for context
    const { data: messageHistory } = await supabase
      .from('messages')
      .select('content, role')
      .eq('conversation_id', conversationId)
      .neq('role', 'system')
      .order('order_key', { ascending: true })
      .limit(4)

    if (!messageHistory || messageHistory.length < 2) {
      return // Not enough messages
    }

    // Create a prompt for title generation
    const conversationContext = messageHistory
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n')

    const titlePrompt = `Based on this conversation, generate a concise title (3-6 words maximum) that captures the main topic or question:

${conversationContext}

Title:`

    // Call OpenAI to generate the title
    const titleResponse = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'user',
          content: titlePrompt
        }
      ],
      max_tokens: 20,
      temperature: 0.7,
    })

    const generatedTitle = titleResponse.choices[0]?.message?.content?.trim()

    if (!generatedTitle) {
      console.error('Failed to generate title: empty response')
      return
    }

    // Clean up the title (remove quotes, limit length)
    const cleanTitle = generatedTitle
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .slice(0, 60) // Limit to 60 characters
      .trim()

    // Update the conversation with the generated title
    await supabase
      .from('conversations')
      .update({ title: cleanTitle })
      .eq('id', conversationId)

    console.log(`Generated title for conversation ${conversationId}: "${cleanTitle}"`)
  } catch (error) {
    console.error('Error generating conversation title:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { 
      conversationId, 
      message: userMessage, 
      workspaceId,
      model = 'gpt-4o'
    } = body

    // Validate required fields
    if (!conversationId || !userMessage || !workspaceId) {
      return new Response('Missing required fields', { status: 400 })
    }

    let conversation
    let actualConversationId = conversationId

    // Handle new conversation case
    if (conversationId === 'new') {
      // Verify user has access to the workspace first
      const { data: membership, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .single()

      if (membershipError || !membership) {
        return new Response('Workspace not found or access denied', { status: 404 })
      }

      // Create new conversation
      const { data: newConversation, error: createError } = await supabase
        .from('conversations')
        .insert({
          workspace_id: workspaceId
        })
        .select(`
          id,
          workspace_id,
          workspace:workspace_id (
            id,
            workspace_members!workspace_members_workspace_id_fkey (
              user_id,
              role
            )
          )
        `)
        .single()

      if (createError || !newConversation) {
        console.error('Error creating conversation:', createError)
        return new Response('Failed to create conversation', { status: 500 })
      }

      conversation = newConversation
      actualConversationId = newConversation.id
    } else {
      // Verify user has access to existing conversation through workspace membership
      const { data: existingConversation, error: convError } = await supabase
        .from('conversations')
        .select(`
          id,
          workspace_id,
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

      if (convError || !existingConversation) {
        return new Response('Conversation not found', { status: 404 })
      }

      conversation = existingConversation
    }

    // Check if user is a member of the workspace
    const isMember = conversation.workspace?.workspace_members?.some(
      (member: any) => member.user_id === user.id
    )
    if (!isMember) {
      return new Response('Access denied', { status: 403 })
    }

    // Get conversation history ordered by fractional index
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', actualConversationId)
      .order('order_key')

    if (messagesError) {
      return new Response('Error fetching conversation history', { status: 500 })
    }

    // Use all messages for conversation history
    const relevantMessages = messages || []

    // Convert to OpenAI format
    const conversationHistory = relevantMessages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }))

    // Add the new user message
    conversationHistory.push({
      role: 'user' as const,
      content: userMessage
    })

    // Generate next order keys using fractional indexing
    const lastOrderKey = messages?.length ? messages[messages.length - 1].order_key : null
    
    let nextUserOrderKey
    let nextAssistantOrderKey
    
    try {
      nextUserOrderKey = generateKeyBetween(lastOrderKey, null)
      nextAssistantOrderKey = generateKeyBetween(nextUserOrderKey, null)
    } catch (orderKeyError) {
      console.error('Order key generation failed:', orderKeyError, 'lastOrderKey:', lastOrderKey)
      // Fallback to timestamp-based keys if fractional indexing fails
      const timestamp = Date.now()
      nextUserOrderKey = `user_${timestamp}`
      nextAssistantOrderKey = `assistant_${timestamp + 1}`
    }

    // Create a stream for the response
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Save user message after stream starts (to reduce initial latency)
          const { data: userMessageRecord, error: userMsgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: actualConversationId,
              order_key: nextUserOrderKey,
              role: 'user',
              content: userMessage,
              json_meta: {}
            })
            .select()
            .single()

          if (userMsgError) {
            console.error('Error saving user message:', userMsgError)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'error',
              error: 'Failed to save user message'
            })}\n\n`))
            controller.close()
            return
          }

          // Send the user message ID and conversation ID so frontend can update its optimistic state
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'userMessage',
            messageId: userMessageRecord.id,
            conversationId: actualConversationId,
            content: userMessage
          })}\n\n`))
          
          // Call OpenAI Responses API
          const response = await openai.chat.completions.create({
            model: model,
            messages: conversationHistory,
            stream: true,
          })

          let fullContent = ''
          let tokenCount = 0

          // Stream content to client without saving to DB yet
          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullContent += content
              tokenCount++
              
              // Send chunk to client
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'token',
                content
              })}\n\n`))
            }
          }

          // Now save assistant message to DB after streaming is complete
          const { data: assistantMessageRecord, error: assistantMsgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: actualConversationId,
              order_key: nextAssistantOrderKey,
              role: 'assistant',
              content: fullContent,
              json_meta: { model: model, token_count: tokenCount }
            })
            .select()
            .single()

          if (assistantMsgError) {
            console.error('Error creating assistant message:', assistantMsgError)
            throw new Error('Failed to create assistant message')
          }


          // Send completion signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            messageId: assistantMessageRecord.id,
            content: fullContent
          })}\n\n`))
          
          // Generate conversation title asynchronously (fire-and-forget)
          generateConversationTitle(actualConversationId, supabase).catch(error => {
            console.error('Background title generation failed:', error)
          })
          
          controller.close()
        } catch (error) {
          console.error('OpenAI streaming error:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: 'Failed to generate response'
          })}\n\n`))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}