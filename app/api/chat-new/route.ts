// Event-based chat API - vendor-agnostic implementation
// Migrated from legacy message-based system to event-based system

import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder'
import { ChatStreamHandler } from '@/lib/streaming/chatStreamHandler'
import { MCPToolExecutor } from '@/lib/tools/mcpToolExecutor'
import { EventLog, createTextEvent, createToolResultEvent, Event } from '@/lib/types/events'
import { eventsToAnthropicMessages } from '@/lib/providers/anthropic'
import { eventsToOpenAIMessages } from '@/lib/providers/openai'
import { getApiModelName, isClaudeModel } from '@/lib/modelMapping'
import { Database } from '@/lib/types/database'
import { generateKeyBetween } from 'fractional-indexing'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// Helper function to generate a conversation title (async, non-blocking)
async function generateConversationTitleInBackground(conversationId: string, events: Event[], supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    console.log('🏷️ Generating title for conversation:', conversationId)
    
    // Only generate title if we have enough events (user + assistant)
    if (events.length < 2) return
    
    // Create a prompt for title generation using the event context
    const conversationContext = events
      .filter(event => event.role !== 'system')
      .slice(0, 4) // Use first few events
      .map(event => {
        const textContent = event.segments
          .filter(s => s.type === 'text')
          .map(s => s.type === 'text' ? s.text : '')
          .join('')
        return `${event.role}: ${textContent}`
      })
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

// Helper function to create conversation in background
async function createConversationInBackground(
  events: Event[],
  workspaceId: string,
  budId?: string
): Promise<{ conversationId: string; bud?: Database['public']['Tables']['buds']['Row'] }> {
  const supabase = await createClient()
  
  try {
    console.log('💾 Creating conversation in background...')
    
    // Fetch bud if budId is provided
    let bud = null
    if (budId) {
      const { data, error } = await supabase
        .from('buds')
        .select('*')
        .eq('id', budId)
        .single()
      
      if (data && !error) {
        bud = data
      }
    }
    
    // Create conversation with bud configuration as overrides
    // This preserves the bud's settings at conversation creation time
    const budConfig = bud?.default_json;
    const modelConfigOverrides = budConfig ? {
      model: budConfig.model,
      systemPrompt: budConfig.systemPrompt,
      temperature: budConfig.temperature,
      maxTokens: budConfig.maxTokens,
      assistantName: budConfig.name,
      avatar: budConfig.avatar
    } : undefined;
    
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        source_bud_id: budId,
        assistant_name: bud?.assistant_name || budConfig?.name || 'Assistant',
        assistant_avatar: bud?.assistant_avatar || budConfig?.avatar || '🤖',
        model_config_overrides: modelConfigOverrides,
        mcp_config_overrides: budConfig?.mcpConfig,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (convError || !conversation) {
      throw new Error('Failed to create conversation')
    }

    // Save all events to database
    const eventInserts = []
    let previousOrderKey: string | null = null
    
    for (const event of events) {
      const orderKey = generateKeyBetween(previousOrderKey, null)
      previousOrderKey = orderKey
      
      eventInserts.push({
        id: event.id,
        conversation_id: conversation.id,
        role: event.role,
        segments: event.segments,
        ts: event.ts,
        order_key: orderKey,
        created_at: new Date().toISOString()
      })
    }

    if (eventInserts.length > 0) {
      const { error: eventsError } = await supabase
        .from('events')
        .insert(eventInserts)

      if (eventsError) {
        console.error('❌ Error saving events:', eventsError)
        throw new Error('Failed to save events')
      }
    }

    console.log('✅ Conversation and events created:', conversation.id)
    
    // Generate title in background (fire and forget)
    generateConversationTitleInBackground(conversation.id, events, supabase)
      .catch(error => console.error('❌ Title generation failed:', error))

    return { conversationId: conversation.id, bud }
  } catch (error) {
    console.error('❌ Background conversation creation failed:', error)
    throw error
  }
}

// Helper function to execute MCP tool calls (now uses unified MCPToolExecutor)
async function executeMCPToolCalls(
  toolCalls: Array<{ id: string; name: string; args: object }>,
  workspaceId: string,
  budId?: string
): Promise<Array<{ id: string; output: object; error?: string }>> {
  const toolExecutor = new MCPToolExecutor({ debug: true });
  return await toolExecutor.executeToolCalls(toolCalls, workspaceId, budId);
}

export async function POST(request: NextRequest) {
  console.log('🚀 Event-based chat API called')
  
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
      model = 'gpt-4o',
      conversationId // Optional: for existing conversations
    } = body

    console.log('📥 Received messages:', messages)
    console.log('📥 Messages count:', messages?.length)
    console.log('📥 Messages details:', JSON.stringify(messages, null, 2))

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.log('❌ Messages validation failed:', { messages, isArray: Array.isArray(messages), length: messages?.length })
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

    // Convert legacy messages to events
    const eventLog = new EventLog()
    
    console.log('🔄 Converting messages to events...')
    
    // Add existing messages as events
    for (const message of messages) {
      console.log('📝 Processing message:', { role: message.role, content: message.content?.substring(0, 100) })
      
      // Handle both legacy message format (content) and event format (segments)
      if (message.segments) {
        // Event format - add directly to event log
        eventLog.addEvent(message)
      } else {
        // Legacy message format - convert to events
        if (message.role === 'system') {
          eventLog.addEvent(createTextEvent('system', message.content))
        } else if (message.role === 'user') {
          eventLog.addEvent(createTextEvent('user', message.content))
        } else if (message.role === 'assistant') {
          // Handle assistant messages with potential tool calls
          const segments: Array<{type: 'text', text: string} | {type: 'tool_call', id: string, name: string, args: object}> = []
          if (message.content) {
            segments.push({ type: 'text' as const, text: message.content })
          }
          if (message.json_meta?.tool_calls) {
            for (const toolCall of message.json_meta.tool_calls) {
              segments.push({
                type: 'tool_call' as const,
                id: toolCall.id,
                name: toolCall.function.name,
                args: JSON.parse(toolCall.function.arguments || '{}')
              })
            }
          }
          if (segments.length > 0) {
            eventLog.addEvent({
              id: crypto.randomUUID(),
              role: 'assistant',
              segments,
              ts: Date.now()
            })
          }
        }
      }
    }

    // Determine provider based on model
    const isClaudeModelDetected = isClaudeModel(model)
    const provider = isClaudeModelDetected ? 'anthropic' : 'openai'
    const apiModelName = getApiModelName(model)
    
    console.log(`🔄 Using ${provider} provider for model: ${model} → ${apiModelName}`)

    // Create streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventBuilder = new EventStreamBuilder('assistant')
          let createdConversationId: string | null = null
          
          // Main conversation loop - handles tool calls automatically
          const maxIterations = 10 // Prevent infinite loops
          let iteration = 0
          let shouldContinue = true
          
          while (iteration < maxIterations && shouldContinue) {
            iteration++
            console.log(`🔄 Conversation iteration ${iteration}`)
            
            // Check if there are pending tool calls
            const pendingToolCalls = eventLog.getUnresolvedToolCalls()
            if (pendingToolCalls.length > 0) {
              console.log(`🔧 Executing ${pendingToolCalls.length} pending tool calls`)
              
              // Execute all pending tool calls
              const toolResults = await executeMCPToolCalls(
                pendingToolCalls,
                workspaceId,
                budId
              )
              
              // Add tool results to event log
              for (const result of toolResults) {
                eventLog.addEvent(createToolResultEvent(result.id, result.output))
                
                // Stream tool result to user
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: "tool_result",
                  tool_id: result.id,
                  output: result.output,
                  error: result.error || null
                })}\n\n`))
                
                // Stream tool completion to user
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: "tool_complete",
                  tool_id: result.id,
                  content: result.error ? "❌ Tool failed" : "✅ Tool completed"
                })}\n\n`))
              }
              
              // Continue to next iteration to get follow-up response
              continue
            }
            
            // No pending tool calls, get next response from LLM
            const events = eventLog.getEvents()
            
            console.log('📋 Events in log:', events.length)
            console.log('📋 Event details:', JSON.stringify(events, null, 2))
            
            if (provider === 'anthropic') {
              // Use Anthropic
              const { messages: anthropicMessages, system } = eventsToAnthropicMessages(events)
              
              console.log('🤖 Anthropic messages:', JSON.stringify(anthropicMessages, null, 2))
              console.log('🤖 System message:', system)
              console.log('🤖 Message count:', anthropicMessages?.length)
              
              // Get available tools if budId is provided
              let tools: Anthropic.Tool[] = []
              if (budId) {
                try {
                  const { data: bud } = await supabase
                    .from('buds')
                    .select('*, mcp_config')
                    .eq('id', budId)
                    .single()
                  
                  if (bud?.mcp_config?.servers?.length) {
                    const { data: servers } = await supabase
                      .from('mcp_servers')
                      .select('*')
                      .in('id', bud.mcp_config.servers)
                      .eq('workspace_id', workspaceId)
                    
                    if (servers?.length) {
                      // Connect to get tools
                      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
                      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
                      
                      const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint))
                      const mcpClient = new Client({
                        name: "bud-chat-tools-client",
                        version: "1.0.0"
                      }, { capabilities: { tools: {} } })
                      
                      await mcpClient.connect(transport)
                      const { tools: mcpTools } = await mcpClient.listTools()
                      
                      tools = mcpTools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.inputSchema
                      }))
                      
                      await mcpClient.close()
                    }
                  }
                } catch (error) {
                  console.warn('Failed to get tools:', error)
                }
              }
              
              const request = {
                model: apiModelName,
                max_tokens: 4000,
                temperature: 0.7,
                messages: anthropicMessages,
                stream: true,
                ...(system && { system }),
                ...(tools.length > 0 && { tools })
              }
              
              console.log('🔄 Sending request to Anthropic:', JSON.stringify(request, null, 2))
              
              const stream = await anthropic.messages.stream(request)
              
              console.log('📡 Anthropic stream created, starting to process...')
              
              // Use unified ChatStreamHandler
              const streamHandler = new ChatStreamHandler(
                eventBuilder,
                eventLog,
                controller,
                { debug: true }
              );
              
              await streamHandler.handleAnthropicStream(stream);
              
              // Check if we have tool calls to execute
              const finalEvent = eventLog.getLastEvent();
              const toolCallSegments = finalEvent?.segments.filter(s => s.type === 'tool_call') || [];
              
              // If no tool calls, we're done
              if (toolCallSegments.length === 0) {
                shouldContinue = false;
              }
              
            } else {
              // Use OpenAI
              const openaiMessages = eventsToOpenAIMessages(events)
              
              // Get available tools if budId is provided
              let tools: OpenAI.ChatCompletionTool[] = []
              if (budId) {
                try {
                  const { data: bud } = await supabase
                    .from('buds')
                    .select('*, mcp_config')
                    .eq('id', budId)
                    .single()
                  
                  if (bud?.mcp_config?.servers?.length) {
                    const { data: servers } = await supabase
                      .from('mcp_servers')
                      .select('*')
                      .in('id', bud.mcp_config.servers)
                      .eq('workspace_id', workspaceId)
                    
                    if (servers?.length) {
                      // Connect to get tools
                      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
                      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
                      
                      const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint))
                      const mcpClient = new Client({
                        name: "bud-chat-tools-client",
                        version: "1.0.0"
                      }, { capabilities: { tools: {} } })
                      
                      await mcpClient.connect(transport)
                      const { tools: mcpTools } = await mcpClient.listTools()
                      
                      // Convert to OpenAI tool format
                      tools = mcpTools.map(tool => ({
                        type: 'function',
                        function: {
                          name: tool.name,
                          description: tool.description,
                          parameters: tool.inputSchema
                        }
                      }))
                      
                      await mcpClient.close()
                    }
                  }
                } catch (error) {
                  console.warn('Failed to get OpenAI tools:', error)
                }
              }
              
              const request = {
                model: apiModelName,
                messages: openaiMessages,
                temperature: 0.7,
                stream: true,
                ...(tools.length > 0 && { tools })
              }
              
              console.log('🔄 Sending request to OpenAI:', JSON.stringify(request, null, 2));
              
              const stream = await openai.chat.completions.create(request) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
              
              console.log('📡 OpenAI stream created, starting to process...');
              
              // Use unified ChatStreamHandler
              const streamHandler = new ChatStreamHandler(
                eventBuilder,
                eventLog,
                controller,
                { debug: true }
              );
              
              await streamHandler.handleOpenAIStream(stream);
              
              // Check if we have tool calls to execute
              const finalEvent = eventLog.getLastEvent();
              const toolCallSegments = finalEvent?.segments.filter(s => s.type === 'tool_call') || [];
              
              // If no tool calls, we're done
              if (toolCallSegments.length === 0) {
                shouldContinue = false;
              }
            }
            
            // Reset builder for next iteration
            eventBuilder.reset('assistant');
          }
          
          // Create conversation in background (only if not an existing conversation)
          if (!conversationId) {
            const allEvents = eventLog.getEvents()
            const conversationResult = await createConversationInBackground(
              allEvents,
              workspaceId,
              budId
            )
            
            createdConversationId = conversationResult.conversationId
            
            // Send conversation created event
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: "conversationCreated",
              conversationId: createdConversationId
            })}\n\n`))
          }
          
          // Send completion event
          const finalContent = eventLog.getEvents()
            .filter(e => e.role === 'assistant')
            .flatMap(e => e.segments)
            .filter(s => s.type === 'text')
            .map(s => s.text)
            .join('')
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "complete",
            content: finalContent
          })}\n\n`))
          
          controller.close();
          
        } catch (error) {
          console.error('❌ Streaming error:', error);
          const errorMessage = error instanceof Error ? error.message : String(error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            error: errorMessage
          })}\n\n`))
          controller.close();
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error('❌ Chat API error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
