import { createClient } from '@/lib/supabase/server'
import { Database } from '@/lib/types/database'
import OpenAI from 'openai'
import { NextRequest } from 'next/server'
import { generateKeyBetween } from 'fractional-indexing'
import { createMCPClientForConversation, createMCPClientForBud } from '@/lib/mcp'
import { MCPStreamingHandler } from '@/lib/mcp/streamingHandler'

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
): Promise<{ conversationId: string, bud?: any }> {
  const supabase = await createClient()
  
  try {
    const dbStartTime = Date.now()
    console.log('💾 PERF: Creating conversation in background...', { messageCount: messages.length, workspaceId })
    
    // Fetch bud if budId is provided (parallel with conversation creation)
    let budPromise: Promise<any> | null = null
    if (budId) {
      budPromise = supabase
        .from('buds')
        .select('*')
        .eq('id', budId)
        .single()
        .then(({ data, error }) => {
          if (error) {
            console.warn('Failed to fetch bud:', error)
            return null
          }
          return data
        })
    }
    
    // Create conversation
    const convStartTime = Date.now()
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        source_bud_id: budId, // Changed from bud_id to source_bud_id
        created_at: new Date().toISOString()
      })
      .select()
      .single()
    const convCreationTime = Date.now() - convStartTime

    if (convError || !conversation) {
      console.error('❌ Error creating conversation:', convError)
      throw new Error('Failed to create conversation')
    }

    // Wait for bud fetch if it was initiated
    const bud = budPromise ? await budPromise : null

    console.log('✅ PERF: Conversation created in:', convCreationTime, 'ms -', conversation.id)

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

    const messagesStartTime = Date.now()
    const { error: messagesError } = await supabase
      .from('messages')
      .insert(messageInserts)
    const messagesCreationTime = Date.now() - messagesStartTime

    if (messagesError) {
      console.error('❌ Error creating messages:', messagesError)
      throw new Error('Failed to create messages')
    }

    console.log('✅ PERF: Messages created in:', messagesCreationTime, 'ms for conversation:', conversation.id)

    // Generate title in background (fire and forget)
    generateConversationTitleInBackground(conversation.id, messages, supabase)
      .catch(error => console.error('Background title generation failed:', error))

    const totalDbTime = Date.now() - dbStartTime
    console.log('💾 PERF: Total background DB operations completed in:', totalDbTime, 'ms')

    return { conversationId: conversation.id, bud }
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
          const streamStartTime = Date.now()
          console.log('🚀 PERF: Starting LLM request...')
          
          // 1. Get effective model configuration (will get bud from conversation creation)
          let effectiveConfig = { model, temperature: 0.7 }
          let budData: any = null

          // 2. Initialize MCP client from bud if available
          let mcpClient = null
          let availableTools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
          
          try {
            if (budId) {
              console.log('🔧 MCP: Initializing from budId:', budId)
              mcpClient = await createMCPClientForBud(budId, workspaceId)
              if (mcpClient) {
                availableTools = await mcpClient.getAvailableTools()
                console.log('🛠️ MCP: Found', availableTools.length, 'tools from bud')
              }
            } else {
              console.log('🔧 MCP: No budId provided, will initialize after conversation creation')
            }
          } catch (error) {
            console.warn('MCP initialization preparation failed:', error)
          }

          // 3. Start LLM streaming with effective configuration
          const llmStartTime = Date.now()
          const openaiStream = await openai.chat.completions.create({
            model: effectiveConfig.model,
            messages: openaiMessages,
            stream: true,
            temperature: effectiveConfig.temperature,
            max_tokens: effectiveConfig.max_tokens,
            tools: availableTools.length > 0 ? availableTools : undefined,
            tool_choice: availableTools.length > 0 ? 'auto' : undefined
          })
          const llmSetupTime = Date.now() - llmStartTime

          console.log('⚡ PERF: LLM setup completed in:', llmSetupTime, 'ms')

          // 2. Create conversation in background (don't await - parallel processing)
          let conversationCreationPromise = createConversationInBackground(messages, workspaceId, budId)
          let conversationId: string | null = null
          let conversationCreated = false

          // 3. Initialize MCP streaming handler
          let mcpStreamingHandler: MCPStreamingHandler | null = null
          let lastOrderKey: string | null = null

          // 4. Stream LLM response while database operations happen in parallel
          let fullContent = ''
          let tokenCount = 0
          let firstTokenTime: number | null = null
          let lastTokenTime = Date.now()

          for await (const chunk of openaiStream) {
            const chunkStartTime = Date.now()
            const delta = chunk.choices[0]?.delta
            const content = delta?.content || ''
            
            // Initialize MCP handler once conversation is available
            if (!mcpStreamingHandler && conversationId && conversationCreated) {
              try {
                // If we don't have an MCP client from bud, try to get one from conversation
                if (!mcpClient) {
                  mcpClient = await createMCPClientForConversation(conversationId, workspaceId)
                }
                
                if (mcpClient) {
                  mcpStreamingHandler = new MCPStreamingHandler({
                    conversationId,
                    supabase,
                    mcpClient,
                    encoder,
                    controller,
                    lastOrderKey
                  })
                  console.log('🔧 MCP streaming handler initialized')
                }
              } catch (error) {
                console.warn('Failed to initialize MCP streaming handler:', error)
              }
            }

            // Handle tool calls if MCP is available
            if (mcpStreamingHandler && (delta?.tool_calls || delta?.content)) {
              await mcpStreamingHandler.handleStreamChunk(chunk)
            }
            
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
              
              // Send token to client immediately (if not handled by MCP)
              if (!mcpStreamingHandler) {
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
            }

            // Check if conversation creation is complete (non-blocking)
            if (!conversationCreated) {
              try {
                const result = await Promise.race([
                  conversationCreationPromise,
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 0))
                ])
                conversationId = result.conversationId
                budData = result.bud
                conversationCreated = true
                
                // Update effective config if we got bud data
                if (budData && budId) {
                  try {
                    const { getEffectiveConversationConfig } = await import('@/lib/budHelpers')
                    const config = getEffectiveConversationConfig({ source_bud_id: budId }, budData)
                    effectiveConfig = {
                      model: config.model,
                      temperature: config.temperature,
                      max_tokens: config.max_tokens
                    }
                    console.log('📝 Updated effective config from bud:', effectiveConfig)
                  } catch (error) {
                    console.warn('Failed to get effective config:', error)
                  }
                }
                
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

          // 5. Process any pending tool calls
          if (mcpStreamingHandler) {
            try {
              console.log('🔧 Processing tool calls...')
              await mcpStreamingHandler.finishToolCalls()
              
              // Update lastOrderKey for subsequent message saving
              // Tool calls will have updated the conversation with new messages
              const { data: lastMessage } = await supabase
                .from('messages')
                .select('order_key')
                .eq('conversation_id', conversationId!)
                .order('order_key', { ascending: false })
                .limit(1)
                .single()
              
              lastOrderKey = lastMessage?.order_key || null
            } catch (error) {
              console.error('❌ Error processing tool calls:', error)
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                error: 'Tool execution failed'
              })}\n\n`))
            }
          }

          // 6. Wait for conversation creation if still pending
          if (!conversationCreated) {
            try {
              const result = await conversationCreationPromise
              conversationId = result.conversationId
              budData = result.bud
              conversationCreated = true
              
              // Update effective config if we got bud data
              if (budData && budId) {
                try {
                  const { getEffectiveConversationConfig } = await import('@/lib/budHelpers')
                  const config = getEffectiveConversationConfig({ source_bud_id: budId }, budData)
                  effectiveConfig = {
                    model: config.model,
                    temperature: config.temperature,
                    max_tokens: config.max_tokens
                  }
                  console.log('📝 Updated effective config from bud (post-stream):', effectiveConfig)
                } catch (error) {
                  console.warn('Failed to get effective config:', error)
                }
              }
              
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

          // 7. Save assistant message to database (if conversation was created and there's content)
          if (conversationId && fullContent) {
            try {
              const assistantSaveStartTime = Date.now()
              console.log('💾 PERF: Saving assistant message to DB...')
              
              // Use the lastOrderKey we already have, or fetch if not available
              let orderKeyTime = 0
              if (!lastOrderKey) {
                const orderKeyStartTime = Date.now()
                const { data: lastMessage } = await supabase
                  .from('messages')
                  .select('order_key')
                  .eq('conversation_id', conversationId)
                  .order('order_key', { ascending: false })
                  .limit(1)
                  .single()
                orderKeyTime = Date.now() - orderKeyStartTime
                lastOrderKey = lastMessage?.order_key || null
              }

              const assistantOrderKey = generateKeyBetween(lastOrderKey, null)

              const insertStartTime = Date.now()
              const { error: assistantMsgError } = await supabase
                .from('messages')
                .insert({
                  conversation_id: conversationId,
                  order_key: assistantOrderKey,
                  role: 'assistant',
                  content: fullContent,
                  json_meta: { model: effectiveConfig.model, token_count: tokenCount },
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
              const insertTime = Date.now() - insertStartTime

              const totalAssistantSaveTime = Date.now() - assistantSaveStartTime

              if (assistantMsgError) {
                console.error('❌ Error saving assistant message:', assistantMsgError)
              } else {
                console.log('✅ PERF: Assistant message saved in:', totalAssistantSaveTime, 'ms (order key:', orderKeyTime, 'ms, insert:', insertTime, 'ms)')
              }
            } catch (error) {
              console.error('❌ Error saving assistant message:', error)
            }
          }

          // 8. Clean up MCP resources
          if (mcpClient) {
            try {
              await mcpClient.cleanup()
              console.log('🧹 MCP client cleaned up')
            } catch (error) {
              console.warn('Failed to cleanup MCP client:', error)
            }
          }

          // 9. Send completion signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            content: fullContent,
            conversationId
          })}\n\n`))

          console.log('🏁 Streaming completed successfully')
          controller.close()
          
        } catch (error) {
          console.error('❌ Streaming error:', error)
          
          // Clean up MCP resources in case of error
          if (mcpClient) {
            try {
              await mcpClient.cleanup()
            } catch (cleanupError) {
              console.warn('Failed to cleanup MCP client after error:', cleanupError)
            }
          }
          
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
    console.error('❌ Chat API error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}