import { createClient } from '@/lib/supabase/server'
import { Database } from '@/lib/types/database'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import { generateKeyBetween } from 'fractional-indexing'

type Message = Database['public']['Tables']['messages']['Row']

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

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

    // Verify user has access to this conversation through workspace membership
    const { data: conversation, error: convError } = await supabase
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

    if (convError || !conversation) {
      return new Response('Conversation not found', { status: 404 })
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
      .eq('conversation_id', conversationId)
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
    const nextUserOrderKey = generateKeyBetween(lastOrderKey, null)
    const nextAssistantOrderKey = generateKeyBetween(nextUserOrderKey, null)

    // Insert user message
    const { data: userMessageRecord, error: userMsgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        order_key: nextUserOrderKey,
        role: 'user',
        content: userMessage,
        json_meta: {}
      })
      .select()
      .single()

    if (userMsgError) {
      console.error('Error saving user message:', userMsgError)
      return new Response('Error saving user message', { status: 500 })
    }

    // Create a stream for the response
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // First, send the user message ID so frontend can update its local state
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'userMessage',
            messageId: userMessageRecord.id,
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
              conversation_id: conversationId,
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