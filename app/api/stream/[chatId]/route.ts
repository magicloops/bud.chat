import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { generateKeyBetween } from 'fractional-indexing'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId: conversationId } = await params
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Get request body
    const body = await request.json()
    const { content, model = 'gpt-4o' } = body

    if (!content) {
      return new Response('Content is required', { status: 400 })
    }

    // Verify access to conversation through workspace membership
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select(`
        id,
        workspace_id,
        workspace:workspace_id!inner (
          id,
          owner_user_id,
          workspace_members!inner (
            user_id,
            role
          )
        )
      `)
      .eq('id', conversationId)
      .eq('workspace.workspace_members.user_id', user.id)
      .single()

    if (convError || !conversation) {
      console.error('Conversation access error:', convError)
      return new Response('Conversation not found or access denied', { status: 404 })
    }

    // Get existing messages to calculate order keys
    const { data: messages, error: messagesError } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('order_key')

    if (messagesError) {
      return new Response('Failed to fetch messages', { status: 500 })
    }

    // Filter out temporary keys and get the last real order key
    const realMessages = messages?.filter(m => !m.order_key.startsWith('temp-')) || []
    
    // Sort by order_key to get the actual last message
    realMessages.sort((a, b) => a.order_key.localeCompare(b.order_key))
    const lastOrderKey = realMessages.length > 0 ? realMessages[realMessages.length - 1].order_key : null
    
    console.log('All messages:', messages?.length, 'Real messages:', realMessages.length, 'Last order key:', lastOrderKey)
    console.log('All order keys:', messages?.map(m => m.order_key))

    // Generate proper order keys
    let userOrderKey: string
    let assistantOrderKey: string
    
    // Check if we're in timestamp mode (last key starts with 'z' and contains numbers)
    const isInTimestampMode = lastOrderKey && lastOrderKey.startsWith('z') && /\d/.test(lastOrderKey)
    
    if (isInTimestampMode) {
      // We're already using timestamp keys, continue with timestamp approach
      console.log('Using timestamp mode for key generation')
      const timestamp = Date.now()
      userOrderKey = `z${timestamp}a`
      assistantOrderKey = `z${timestamp}b`
      console.log('Generated timestamp keys:', { userOrderKey, assistantOrderKey })
    } else {
      // Try to use fractional indexing with proper order keys
      try {
        // Check if generated key would conflict with existing keys
        const existingKeys = new Set(messages?.map(m => m.order_key) || [])
        
        userOrderKey = generateKeyBetween(lastOrderKey, null)
        assistantOrderKey = generateKeyBetween(userOrderKey, null)
        
        console.log('Generated fractional keys:', { userOrderKey, assistantOrderKey, fromLastKey: lastOrderKey })
        
        // If there's a conflict, fall back to timestamp keys
        if (existingKeys.has(userOrderKey) || existingKeys.has(assistantOrderKey)) {
          console.warn('Key conflict detected, switching to timestamp-based keys')
          const timestamp = Date.now()
          userOrderKey = `z${timestamp}a`
          assistantOrderKey = `z${timestamp}b`
          console.log('Conflict-free timestamp keys:', { userOrderKey, assistantOrderKey })
        }
      } catch (error) {
        console.warn('Fractional key generation failed, using timestamp keys:', error)
        // Use timestamp-based keys to guarantee uniqueness
        const timestamp = Date.now()
        userOrderKey = `z${timestamp}a`
        assistantOrderKey = `z${timestamp}b`
        console.log('Fallback timestamp keys:', { userOrderKey, assistantOrderKey })
      }
    }

    // Insert both messages in a single transaction
    const { data: insertedMessages, error: insertError } = await supabase
      .from('messages')
      .insert([
        {
          conversation_id: conversationId,
          order_key: userOrderKey,
          role: 'user',
          content,
          json_meta: {},
        },
        {
          conversation_id: conversationId,
          order_key: assistantOrderKey,
          role: 'assistant',
          content: '', // Will be filled by streaming
          json_meta: { model, isPending: true },
        }
      ])
      .select('id, role')

    if (insertError || !insertedMessages || insertedMessages.length !== 2) {
      console.error('Message insertion failed:', {
        insertError,
        insertedMessagesCount: insertedMessages?.length,
        conversationId,
        userOrderKey,
        assistantOrderKey
      })
      return new Response(insertError?.message || 'Failed to create messages', { status: 500 })
    }

    const userMessage = insertedMessages.find(m => m.role === 'user')!
    const assistantMessage = insertedMessages.find(m => m.role === 'assistant')!

    // Build conversation history for AI (include the new user message)
    const conversationHistory = [
      ...realMessages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      })),
      {
        role: 'user' as const,
        content
      }
    ]

    // Create streaming response
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial confirmation with complete message data
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'messagesCreated',
            userMessage: {
              id: userMessage.id,
              conversation_id: conversationId,
              order_key: userOrderKey,
              role: 'user',
              content,
              json_meta: {},
              version: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            },
            assistantMessage: {
              id: assistantMessage.id,
              conversation_id: conversationId,
              order_key: assistantOrderKey,
              role: 'assistant',
              content: '',
              json_meta: { model, isPending: true },
              version: 1,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          })}\n\n`))

          // Start OpenAI streaming
          const response = await openai.chat.completions.create({
            model,
            messages: conversationHistory,
            stream: true,
          })

          let fullContent = ''

          // Stream tokens
          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullContent += content
              
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'token',
                messageId: assistantMessage.id,
                content
              })}\n\n`))
            }
          }

          // Update the assistant message in the database
          const { error: updateError } = await supabase
            .from('messages')
            .update({
              content: fullContent,
              json_meta: { 
                model, 
                isPending: false,
                tokenCount: fullContent.length // Rough token estimate
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', assistantMessage.id)

          if (updateError) {
            console.error('Error updating message:', updateError)
          }

          // Send completion
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            messageId: assistantMessage.id,
            content: fullContent
          })}\n\n`))

          controller.close()
        } catch (error) {
          console.error('Streaming error:', error)
          
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
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    })
  } catch (error) {
    console.error('Stream API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}