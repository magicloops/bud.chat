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

    // Preload messages immediately after auth check (before streaming starts)
    const preloadStartTime = Date.now()
    console.log('📚 PERF: Preloading conversation messages...')
    
    const { data: existingMessages, error: messagesError } = await supabase
      .from('messages')
      .select('role, content, order_key')
      .eq('conversation_id', conversationId)
      .order('order_key', { ascending: true })
    
    const preloadTime = Date.now() - preloadStartTime
    
    if (messagesError) {
      console.error('❌ Error fetching messages:', messagesError)
      return new Response('Failed to fetch conversation context', { status: 500 })
    }
    
    console.log('📚 PERF: Messages preloaded in:', preloadTime, 'ms - Message count:', existingMessages?.length)
    
    // Generate order keys immediately from preloaded messages
    const keyGenStart = Date.now()
    const lastMessage = existingMessages?.[existingMessages.length - 1]
    const lastOrderKey = lastMessage?.order_key || null
    
    const userOrderKey = generateKeyBetween(lastOrderKey, null)
    const assistantOrderKey = generateKeyBetween(userOrderKey, null)
    
    console.log('🔑 PERF: Order keys generated in:', Date.now() - keyGenStart, 'ms')
    
    // Build OpenAI messages array immediately
    const buildStart = Date.now()
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
    const buildTime = Date.now() - buildStart
    console.log('📚 PERF: OpenAI messages built in:', buildTime, 'ms')

    console.log('🤖 Starting LLM streaming for existing conversation...')

    // Create the streaming response with aggressive anti-buffering
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const streamStartTime = Date.now()
          console.log('🚀 PERF: Starting LLM request for existing conversation...')
          
          // 1. Start LLM streaming immediately (messages already preloaded)
          const llmStartTime = Date.now()
          const openaiStream = await openai.chat.completions.create({
            model,
            messages: openaiMessages,
            stream: true,
          })
          const llmSetupTime = Date.now() - llmStartTime
          console.log('⚡ PERF: LLM setup completed in:', llmSetupTime, 'ms')

          // 2. Save user message in background (using pre-generated order key)
          const saveUserMessageInBackground = async () => {
            try {
              const userSaveStartTime = Date.now()
              console.log('💾 PERF: Saving user message in background...')
              
              const insertStartTime = Date.now()
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
              const insertTime = Date.now() - insertStartTime

              const totalUserSaveTime = Date.now() - userSaveStartTime

              if (userMsgError) {
                console.error('❌ Error saving user message:', userMsgError)
                throw new Error('Failed to save user message')
              }

              console.log('✅ PERF: User message saved in:', totalUserSaveTime, 'ms (insert:', insertTime, 'ms)')
              return userOrderKey
            } catch (error) {
              console.error('❌ Error saving user message:', error)
              throw error
            }
          }

          // Start user message save in parallel
          const userMessagePromise = saveUserMessageInBackground()
          let userMessageSaved = false

          // 3. Stream LLM response while database operations happen in parallel
          let fullContent = ''
          let tokenCount = 0
          let firstTokenTime: number | null = null
          let lastTokenTime = Date.now()

          for await (const chunk of openaiStream) {
            const chunkStartTime = Date.now()
            const content = chunk.choices[0]?.delta?.content || ''
            
            if (content) {
              tokenCount++
              fullContent += content
              
              // Track first token timing
              if (firstTokenTime === null) {
                firstTokenTime = Date.now()
                const timeToFirstToken = firstTokenTime - streamStartTime
                console.log('⚡ PERF: Time to first token from LLM:', timeToFirstToken, 'ms')
              }
              
              // Track inter-token timing
              const timeSinceLastToken = chunkStartTime - lastTokenTime
              if (tokenCount % 20 === 0) {
                console.log(`⚡ PERF: Token ${tokenCount} - LLM inter-token delay:`, timeSinceLastToken, 'ms')
              }
              lastTokenTime = chunkStartTime
              
              // Send token to client immediately with aggressive anti-buffering
              const encodeStart = Date.now()
              
              // Use minimal JSON and add padding to force immediate transmission
              const data = `data: {"type":"token","content":${JSON.stringify(content)}}\n\n`
              const chunk = encoder.encode(data)
              controller.enqueue(chunk)
              
              // Send a keep-alive chunk to force flush (browsers batch small chunks)
              if (tokenCount % 5 === 0) {
                controller.enqueue(encoder.encode(': keep-alive\n\n'))
              }
              
              const encodeTime = Date.now() - encodeStart
              
              if (encodeTime > 5) {
                console.log('🐌 PERF: Slow server encoding:', encodeTime, 'ms')
              }
            }

            // Check if user message save is complete (non-blocking)
            if (!userMessageSaved) {
              try {
                await Promise.race([
                  userMessagePromise,
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 0))
                ])
                userMessageSaved = true
                console.log('💾 User message save completed during streaming')
              } catch (error) {
                // User message save still in progress, continue streaming
              }
            }
          }

          // 4. Wait for user message save if still pending
          if (!userMessageSaved) {
            try {
              await userMessagePromise
              userMessageSaved = true
              console.log('💾 User message save completed after streaming')
            } catch (error) {
              console.error('❌ User message save failed:', error)
            }
          }

          // 5. Save assistant message to database (if user message was saved)
          if (userMessageSaved && fullContent) {
            try {
              const assistantSaveStartTime = Date.now()
              console.log('💾 PERF: Saving assistant message to DB...')
              
              const insertStartTime = Date.now()
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
              const insertTime = Date.now() - insertStartTime

              const totalAssistantSaveTime = Date.now() - assistantSaveStartTime

              if (assistantMsgError) {
                console.error('❌ Error saving assistant message:', assistantMsgError)
              } else {
                console.log('✅ PERF: Assistant message saved in:', totalAssistantSaveTime, 'ms (insert:', insertTime, 'ms)')
              }
            } catch (error) {
              console.error('❌ Error saving assistant message:', error)
            }
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
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      },
    })
  } catch (error) {
    console.error('❌ Existing conversation chat API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}