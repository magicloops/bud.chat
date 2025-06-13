import { createClient } from '@/lib/supabase/server'
import { Database } from '@/lib/types/database'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import { generateKeyBetween } from 'fractional-indexing'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  console.log('💬 Existing conversation chat API called')
  
  try {
    const supabase = await createClient()
    const resolvedParams = await params
    const conversationId = resolvedParams.conversationId
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { 
      message, 
      workspaceId,
      model = 'gpt-4o'
    } = body

    console.log('📥 Request data:', { 
      conversationId, 
      message: message?.substring(0, 50) + '...', 
      workspaceId, 
      model 
    })

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return new Response('Message is required', { status: 400 })
    }
    if (!workspaceId) {
      return new Response('Workspace ID is required', { status: 400 })
    }

    // Verify conversation exists and user has access
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, workspace_id')
      .eq('id', conversationId)
      .single()

    if (convError || !conversation) {
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
      return new Response('Workspace not found or access denied', { status: 404 })
    }

    console.log('✅ User has access to conversation:', conversationId)

    // Get existing messages for context
    const { data: existingMessages, error: messagesError } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('order_key', { ascending: true })

    if (messagesError) {
      console.error('❌ Error fetching messages:', messagesError)
      return new Response('Failed to fetch conversation context', { status: 500 })
    }

    console.log('📚 Loaded conversation context:', { messageCount: existingMessages?.length })

    // Build OpenAI messages array
    const openaiMessages = [
      ...(existingMessages || []).map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      })),
      {
        role: 'user' as const,
        content: message
      }
    ]

    console.log('🤖 Starting LLM streaming for existing conversation...')

    // Create the streaming response
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 1. Start LLM streaming immediately
          const openaiStream = await openai.chat.completions.create({
            model,
            messages: openaiMessages,
            stream: true,
          })

          console.log('⚡ LLM streaming started for existing conversation')

          // 2. Save user message FIRST (blocking - we need this for proper ordering)
          console.log('💾 Saving user message...')
          
          // Get the last message order key for proper ordering
          const { data: lastMessage } = await supabase
            .from('messages')
            .select('order_key')
            .eq('conversation_id', conversationId)
            .order('order_key', { ascending: false })
            .limit(1)
            .single()

          const userOrderKey = generateKeyBetween(lastMessage?.order_key || null, null)

          const { error: userMsgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: conversationId,
              order_key: userOrderKey,
              role: 'user',
              content: message,
              json_meta: {},
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })

          if (userMsgError) {
            console.error('❌ Error saving user message:', userMsgError)
            throw new Error('Failed to save user message')
          }

          console.log('✅ User message saved, starting streaming')

          // 3. Stream LLM response while user message saves in parallel
          let fullContent = ''
          let tokenCount = 0

          for await (const chunk of openaiStream) {
            const content = chunk.choices[0]?.delta?.content || ''
            
            if (content) {
              fullContent += content
              tokenCount++
              
              // Send token to client immediately
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'token',
                content
              })}\n\n`))
            }
          }

          // 4. Save assistant message after streaming completes
          try {
            const assistantOrderKey = generateKeyBetween(userOrderKey, null)

            const { error: assistantMsgError } = await supabase
              .from('messages')
              .insert({
                conversation_id: conversationId,
                order_key: assistantOrderKey,
                role: 'assistant',
                content: fullContent,
                json_meta: { model, token_count: tokenCount },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })

            if (assistantMsgError) {
              console.error('❌ Error saving assistant message:', assistantMsgError)
            } else {
              console.log('✅ Assistant message saved')
            }
          } catch (error) {
            console.error('❌ Error saving assistant message:', error)
          }

          // 5. Send completion signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            content: fullContent
          })}\n\n`))

          console.log('🏁 Existing conversation streaming completed successfully')
          controller.close()
          
        } catch (error) {
          console.error('❌ Existing conversation streaming error:', error)
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
    console.error('❌ Existing conversation chat API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}