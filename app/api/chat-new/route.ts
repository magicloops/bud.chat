import { createClient } from '@/lib/supabase/server'
import { Database } from '@/lib/types/database'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import { generateKeyBetween } from 'fractional-indexing'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

// Helper function to generate a conversation title (async, non-blocking)
async function generateConversationTitleInBackground(conversationId: string, messages: any[], supabase: any) {
  try {
    console.log('🏷️ Generating title for conversation:', conversationId)
    
    // Only generate title if we have enough messages (user + assistant)
    if (messages.length < 2) return
    
    // Create a prompt for title generation using the conversation context
    const conversationContext = messages
      .filter(msg => msg.role !== 'system')
      .slice(0, 4) // Use first few messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\\n')

    const titlePrompt = `Based on this conversation, generate a concise title (3-6 words maximum) that captures the main topic or question:

${conversationContext}

Title:`

    // Call OpenAI to generate the title
    const titleResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Use faster model for title generation
      messages: [{ role: 'user', content: titlePrompt }],
      max_tokens: 20,
      temperature: 0.7,
    })

    const generatedTitle = titleResponse.choices[0]?.message?.content?.trim()

    if (generatedTitle) {
      const cleanTitle = generatedTitle
        .replace(/^["']|["']$/g, '') // Remove surrounding quotes
        .slice(0, 60) // Limit to 60 characters
        .trim()

      // Update the conversation with the generated title
      await supabase
        .from('conversations')
        .update({ title: cleanTitle })
        .eq('id', conversationId)

      console.log(`✅ Generated title for conversation ${conversationId}: "${cleanTitle}"`)
    }
  } catch (error) {
    console.error('❌ Error generating conversation title:', error)
  }
}

// Create conversation and messages in background (non-blocking)
async function createConversationInBackground(
  messages: any[],
  workspaceId: string,
  budId?: string
): Promise<string> {
  const supabase = await createClient()
  
  try {
    console.log('💾 Creating conversation in background...', { messageCount: messages.length, workspaceId })
    
    // Create conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        bud_id: budId,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (convError || !conversation) {
      console.error('❌ Error creating conversation:', convError)
      throw new Error('Failed to create conversation')
    }

    console.log('✅ Conversation created:', conversation.id)

    // Create messages with proper ordering
    let previousOrderKey: string | null = null
    const messageInserts = messages.map((msg, index) => {
      const orderKey = generateKeyBetween(previousOrderKey, null)
      previousOrderKey = orderKey
      
      return {
        conversation_id: conversation.id,
        order_key: orderKey,
        role: msg.role,
        content: msg.content,
        json_meta: msg.json_meta || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    })

    const { error: messagesError } = await supabase
      .from('messages')
      .insert(messageInserts)

    if (messagesError) {
      console.error('❌ Error creating messages:', messagesError)
      throw new Error('Failed to create messages')
    }

    console.log('✅ Messages created for conversation:', conversation.id)

    // Generate title in background (fire and forget)
    generateConversationTitleInBackground(conversation.id, messages, supabase)
      .catch(error => console.error('Background title generation failed:', error))

    return conversation.id
  } catch (error) {
    console.error('❌ Background conversation creation failed:', error)
    throw error
  }
}

export async function POST(request: NextRequest) {
  console.log('🚀 New streaming-first chat API called')
  
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await request.json()
    const { 
      messages, 
      workspaceId,
      budId,
      model = 'gpt-4o'
    } = body

    console.log('📥 Request data:', { 
      messageCount: messages?.length, 
      workspaceId, 
      budId, 
      model 
    })

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('Messages are required', { status: 400 })
    }
    if (!workspaceId) {
      return new Response('Workspace ID is required', { status: 400 })
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single()

    if (membershipError || !membership) {
      return new Response('Workspace not found or access denied', { status: 404 })
    }

    console.log('✅ User has access to workspace:', workspaceId)

    // Convert messages to OpenAI format
    const openaiMessages = messages.map(msg => ({
      role: msg.role as 'system' | 'user' | 'assistant',
      content: msg.content
    }))

    console.log('🤖 Starting LLM streaming...')

    // Create the streaming response
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 1. Start LLM streaming IMMEDIATELY - no database operations blocking!
          const openaiStream = await openai.chat.completions.create({
            model,
            messages: openaiMessages,
            stream: true,
          })

          console.log('⚡ LLM streaming started - time to first token should be minimal!')

          // 2. Create conversation in background (don't await - parallel processing)
          let conversationCreationPromise = createConversationInBackground(messages, workspaceId, budId)
          let conversationId: string | null = null
          let conversationCreated = false

          // 3. Stream LLM response while database operations happen in parallel
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

            // Check if conversation creation is complete (non-blocking)
            if (!conversationCreated) {
              try {
                conversationId = await Promise.race([
                  conversationCreationPromise,
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 0))
                ])
                conversationCreated = true
                
                // Send conversation ID when available
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'conversationCreated',
                  conversationId
                })}\n\n`))
                
                console.log('💾 Conversation creation completed during streaming:', conversationId)
              } catch (error) {
                // Conversation creation still in progress, continue streaming
              }
            }
          }

          // 4. Wait for conversation creation if still pending
          if (!conversationCreated) {
            try {
              conversationId = await conversationCreationPromise
              conversationCreated = true
              
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'conversationCreated',
                conversationId
              })}\n\n`))
              
              console.log('💾 Conversation creation completed after streaming:', conversationId)
            } catch (error) {
              console.error('❌ Conversation creation failed:', error)
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                error: 'Failed to save conversation'
              })}\n\n`))
            }
          }

          // 5. Save assistant message to database (if conversation was created)
          if (conversationId && fullContent) {
            try {
              // Get the last message order key to generate next one
              const { data: lastMessage } = await supabase
                .from('messages')
                .select('order_key')
                .eq('conversation_id', conversationId)
                .order('order_key', { ascending: false })
                .limit(1)
                .single()

              const assistantOrderKey = generateKeyBetween(lastMessage?.order_key || null, null)

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
          }

          // 6. Send completion signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            content: fullContent,
            conversationId
          })}\n\n`))

          console.log('🏁 Streaming completed successfully')
          controller.close()
          
        } catch (error) {
          console.error('❌ Streaming error:', error)
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
    console.error('❌ Chat API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}