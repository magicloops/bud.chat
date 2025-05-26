import { createClient } from '@/lib/supabase/server'
import { Database } from '@/lib/types/database'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'

type Message = Database['public']['Tables']['message']['Row']

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
      parentPath = '',
      workspaceId 
    } = body

    // Validate required fields
    if (!conversationId || !userMessage || !workspaceId) {
      return new Response('Missing required fields', { status: 400 })
    }

    // Verify user has access to this conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversation')
      .select(`
        id,
        workspace_id,
        workspace:workspace_id (
          id,
          owner_id
        )
      `)
      .eq('id', conversationId)
      .single()

    if (convError || !conversation || conversation.workspace?.owner_id !== user.id) {
      return new Response('Conversation not found or access denied', { status: 404 })
    }

    // Get conversation history up to the parent path
    const { data: messages, error: messagesError } = await supabase
      .from('message')
      .select('*')
      .eq('convo_id', conversationId)
      .order('path')

    if (messagesError) {
      return new Response('Error fetching conversation history', { status: 500 })
    }

    // Filter messages for the current branch and build conversation history
    const relevantMessages = messages?.filter(msg => {
      if (!parentPath) return true
      return msg.path.startsWith(parentPath) || parentPath.startsWith(msg.path)
    }) || []

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

    // Calculate next path for the user message
    // For new conversations, start with 1, 2, 3...
    // For existing conversations, find the highest path number and increment
    const maxPath = messages?.reduce((max, msg) => {
      const pathParts = msg.path.split('.')
      const lastPart = parseInt(pathParts[pathParts.length - 1])
      return Math.max(max, lastPart)
    }, 0) || 0
    
    const nextUserPath = (maxPath + 1).toString()
    const nextAssistantPath = (maxPath + 2).toString()

    // Find the last message to set as parent
    const lastMessage = messages?.length ? messages[messages.length - 1] : null

    // Insert user message
    const { data: userMessageRecord, error: userMsgError } = await supabase
      .from('message')
      .insert({
        convo_id: conversationId,
        parent_id: lastMessage?.id || null,
        path: nextUserPath,
        role: 'user',
        content: userMessage,
        created_by: user.id
      })
      .select()
      .single()

    if (userMsgError) {
      console.error('Error saving user message:', userMsgError)
      return new Response('Error saving user message', { status: 500 })
    }

    // We'll create the assistant message after we start getting content

    // Create a stream for the response
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Call OpenAI Responses API
          const response = await openai.chat.completions.create({
            model: 'gpt-4',
            messages: conversationHistory,
            stream: true,
          })

          let fullContent = ''
          let tokenCount = 0
          let assistantMessageRecord: any = null

          for await (const chunk of response) {
            const content = chunk.choices[0]?.delta?.content || ''
            if (content) {
              fullContent += content
              tokenCount++
              
              // Create assistant message on first content chunk
              if (!assistantMessageRecord) {
                const { data: newAssistantMessage, error: assistantError } = await supabase
                  .from('message')
                  .insert({
                    convo_id: conversationId,
                    parent_id: userMessageRecord.id,
                    path: nextAssistantPath,
                    role: 'assistant',
                    content: '',
                    created_by: user.id
                  })
                  .select()
                  .single()
                
                if (assistantError) {
                  console.error('Error creating assistant message:', assistantError)
                  throw new Error('Failed to create assistant message')
                }
                assistantMessageRecord = newAssistantMessage
              }
              
              // Send chunk to client
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'token',
                content,
                messageId: assistantMessageRecord.id
              })}\n\n`))
            }
          }

          // Update the assistant message with final content
          if (assistantMessageRecord) {
            await supabase
              .from('message')
              .update({
                content: fullContent,
                token_count: tokenCount
              })
              .eq('id', assistantMessageRecord.id)
          }

          // Record usage
          if (assistantMessageRecord) {
            await supabase
              .from('usage')
              .insert({
                user_id: user.id,
                message_id: assistantMessageRecord.id,
                model: 'gpt-4',
                prompt_tokens: tokenCount, // Approximate - OpenAI doesn't provide this in streaming
                completion_tokens: tokenCount,
                cost_cents: Math.round(tokenCount * 0.003) // Approximate cost calculation
              })

            // Send completion signal
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'complete',
              messageId: assistantMessageRecord.id,
              content: fullContent
            })}\n\n`))
          }
          
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