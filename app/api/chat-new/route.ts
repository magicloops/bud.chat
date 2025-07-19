// Event-based chat API - vendor-agnostic implementation
// Migrated from legacy message-based system to event-based system

import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder'
import { EventLog, createTextEvent, createToolResultEvent } from '@/lib/types/events'
import { saveEvent, getConversationEvents } from '@/lib/db/events'
import { eventsToAnthropicMessages, anthropicStreamDeltaToEvent, extractPendingToolCalls } from '@/lib/providers/anthropic'
import { eventsToOpenAIMessages, openaiStreamDeltaToEvent } from '@/lib/providers/openai'
import { getApiModelName, isClaudeModel } from '@/lib/modelMapping'
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
async function generateConversationTitleInBackground(conversationId: string, events: any[], supabase: any) {
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
          .map(s => s.text)
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
  events: any[],
  workspaceId: string,
  budId?: string
): Promise<{ conversationId: string; bud?: any }> {
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

// Helper function to execute MCP tool calls
async function executeMCPToolCalls(
  toolCalls: Array<{ id: string; name: string; args: object }>,
  workspaceId: string,
  budId?: string
): Promise<Array<{ id: string; output: object; error?: string }>> {
  const results = []
  
  if (!budId) {
    // No MCP configuration available
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: 'No MCP configuration available' },
      error: 'No MCP configuration available'
    }))
  }

  try {
    const supabase = await createClient()
    
    // Get bud and MCP configuration
    const { data: bud, error: budError } = await supabase
      .from('buds')
      .select('*, mcp_config')
      .eq('id', budId)
      .single()

    if (!bud || budError || !bud.mcp_config?.servers?.length) {
      throw new Error('No MCP servers configured')
    }

    // Get MCP servers
    const { data: servers, error: serversError } = await supabase
      .from('mcp_servers')
      .select('*')
      .in('id', bud.mcp_config.servers)
      .eq('workspace_id', workspaceId)

    if (!servers || serversError || servers.length === 0) {
      throw new Error('No MCP servers found')
    }

    // Connect to MCP server
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
    
    const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint))
    const mcpClient = new Client({
      name: "bud-chat-client",
      version: "1.0.0"
    }, {
      capabilities: { tools: {} }
    })
    
    await mcpClient.connect(transport)
    
    // Execute each tool call
    for (const toolCall of toolCalls) {
      try {
        const result = await mcpClient.callTool({
          name: toolCall.name,
          arguments: toolCall.args || {}
        })
        
        // Process result content
        let output = result.content
        if (Array.isArray(output)) {
          output = output.map(block => 
            block.type === 'text' ? block.text : JSON.stringify(block)
          ).join('\n')
        }
        
        // Truncate very large tool results to avoid overwhelming the LLM
        const MAX_TOOL_RESULT_LENGTH = 50000; // 50KB max
        if (typeof output === 'string' && output.length > MAX_TOOL_RESULT_LENGTH) {
          console.log('⚠️ Tool result too large, truncating from', output.length, 'to', MAX_TOOL_RESULT_LENGTH)
          output = output.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n\n[Content truncated due to length...]'
        }
        
        results.push({
          id: toolCall.id,
          output: { content: output }
        })
      } catch (toolError) {
        console.error('❌ Tool execution failed:', toolError)
        results.push({
          id: toolCall.id,
          output: { error: toolError.message },
          error: toolError.message
        })
      }
    }
    
    await mcpClient.close()
    
  } catch (error) {
    console.error('❌ MCP execution failed:', error)
    // Return error for all tool calls
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: error.message },
      error: error.message
    }))
  }
  
  return results
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
          const segments = []
          if (message.content) {
            segments.push({ type: 'text', text: message.content })
          }
          if (message.json_meta?.tool_calls) {
            for (const toolCall of message.json_meta.tool_calls) {
              segments.push({
                type: 'tool_call',
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
          let maxIterations = 10 // Prevent infinite loops
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
              let tools = []
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
              
              for await (const event of stream) {
                console.log('📨 Received Anthropic event:', event.type, event.delta?.type)
                
                switch (event.type) {
                  case 'message_start':
                    // Reset builder for new message
                    eventBuilder.reset('assistant')
                    break
                    
                  case 'content_block_start':
                    if (event.content_block?.type === 'text') {
                      // Text block started - builder is ready
                    } else if (event.content_block?.type === 'tool_use') {
                      // Tool use block started
                      if (event.content_block.id && event.content_block.name) {
                        // Start streaming tool call (don't finalize yet)
                        eventBuilder.startToolCall(event.content_block.id, event.content_block.name)
                        
                        // Stream tool call start
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: "tool_start",
                          tool_id: event.content_block.id,
                          tool_name: event.content_block.name,
                          content: `🔧 *Using tool: ${event.content_block.name}*\n`
                        })}\n\n`))
                      }
                    }
                    break
                    
                  case 'content_block_delta':
                    if (event.delta?.type === 'text_delta' && event.delta.text) {
                      // Add text chunk
                      eventBuilder.addTextChunk(event.delta.text)
                      
                      // Stream text content
                      console.log('📤 Streaming token:', event.delta.text)
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: "token",
                        content: event.delta.text
                      })}\n\n`))
                    } else if (event.delta?.type === 'input_json_delta' && event.index !== undefined) {
                      // Handle tool call argument accumulation
                      const toolCallId = eventBuilder.getToolCallIdAtIndex(event.index)
                      if (toolCallId && event.delta.partial_json) {
                        eventBuilder.addToolCallArguments(toolCallId, event.delta.partial_json)
                      }
                    }
                    break
                    
                  case 'content_block_stop':
                    // Complete any streaming tool calls
                    if (event.index !== undefined) {
                      const toolCallId = eventBuilder.getToolCallIdAtIndex(event.index)
                      if (toolCallId) {
                        eventBuilder.completeToolCall(toolCallId)
                      }
                    }
                    break
                    
                  case 'message_stop':
                    // Finalize the event
                    const finalEvent = eventBuilder.finalize()
                    eventLog.addEvent(finalEvent)
                    
                    console.log('✅ Message completed, final event:', finalEvent.segments.length, 'segments')
                    
                    // Stream finalized tool calls with complete arguments
                    const toolCallSegments = finalEvent.segments.filter(s => s.type === 'tool_call')
                    for (const toolCall of toolCallSegments) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: "tool_finalized",
                        tool_id: toolCall.id,
                        tool_name: toolCall.name,
                        args: toolCall.args
                      })}\n\n`))
                    }
                    
                    // If no tool calls, we're done
                    if (finalEvent.segments.every(s => s.type !== 'tool_call')) {
                      shouldContinue = false // Exit loop
                    }
                    break
                }
              }
              
            } else {
              // Use OpenAI
              const openaiMessages = eventsToOpenAIMessages(events)
              
              // Get available tools if budId is provided
              let tools = []
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
              
              const stream = await openai.chat.completions.create(request)
              
              console.log('📡 OpenAI stream created, starting to process...');
              
              // Track active tool calls during streaming
              const activeToolCalls = new Map<number, { id?: string; name?: string; args?: string }>()
              
              try {
                for await (const chunk of stream) {
                  console.log('📨 Received OpenAI chunk:', chunk.choices?.[0]?.finish_reason || 'streaming');
                  
                  if (!chunk.choices || chunk.choices.length === 0) {
                    console.warn('⚠️ OpenAI chunk has no choices:', chunk);
                    continue;
                  }
                  
                  for (const choice of chunk.choices) {
                  if (choice.finish_reason) {
                    console.log('🏁 OpenAI stream finished:', choice.finish_reason);
                    
                    // Finalize any pending tool calls
                    for (const [index, toolCall] of activeToolCalls.entries()) {
                      if (toolCall.id && toolCall.name && toolCall.args) {
                        try {
                          const args = JSON.parse(toolCall.args);
                          eventBuilder.addToolCall(toolCall.id, toolCall.name, args);
                          
                          // Stream finalized tool call
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: "tool_finalized",
                            tool_id: toolCall.id,
                            tool_name: toolCall.name,
                            args: args
                          })}\n\n`))
                        } catch (e) {
                          console.error('Failed to parse OpenAI tool call arguments:', e);
                          eventBuilder.addToolCall(toolCall.id, toolCall.name, {});
                        }
                      }
                    }
                    
                    // Finalize the event
                    const finalEvent = eventBuilder.finalize();
                    eventLog.addEvent(finalEvent);
                    
                    console.log('✅ OpenAI message completed, final event:', finalEvent.segments.length, 'segments');
                    
                    // If no tool calls, we're done
                    if (finalEvent.segments.every(s => s.type !== 'tool_call')) {
                      shouldContinue = false; // Exit loop
                    }
                    break;
                  }
                  
                  const delta = choice.delta;
                  
                  if (delta.role === 'assistant' && !eventBuilder.hasContent()) {
                    // Message started - builder is already reset for this iteration
                    console.log('🤖 OpenAI assistant message started');
                  }
                  
                  // Handle text content
                  if (delta.content) {
                    eventBuilder.addTextChunk(delta.content);
                    
                    // Stream text content immediately
                    console.log('📤 Streaming OpenAI token:', delta.content);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: "token",
                      content: delta.content
                    })}\n\n`))
                  }
                  
                  // Handle tool calls
                  if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                    for (const toolCallDelta of delta.tool_calls) {
                      try {
                        if (typeof toolCallDelta.index !== 'number') {
                          console.warn('⚠️ Invalid tool call index:', toolCallDelta);
                          continue;
                        }
                        
                        const index = toolCallDelta.index;
                        let toolCall = activeToolCalls.get(index);
                        
                        if (!toolCall) {
                          toolCall = {};
                          activeToolCalls.set(index, toolCall);
                        }
                        
                        if (toolCallDelta.id) {
                          toolCall.id = toolCallDelta.id;
                          console.log('🔧 OpenAI tool call started:', toolCallDelta.id);
                          
                          // Start streaming tool call
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: "tool_start",
                            tool_id: toolCallDelta.id,
                            content: `🔧 *Using tool...*\n`
                          })}\n\n`))
                        }
                        
                        if (toolCallDelta.function?.name) {
                          toolCall.name = toolCallDelta.function.name;
                          console.log('🔧 OpenAI tool call name:', toolCallDelta.function.name);
                          
                          // Update tool call with name
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: "tool_start",
                            tool_id: toolCall.id,
                            tool_name: toolCallDelta.function.name,
                            content: `🔧 *Using tool: ${toolCallDelta.function.name}*\n`
                          })}\n\n`))
                        }
                        
                        if (toolCallDelta.function?.arguments) {
                          toolCall.args = (toolCall.args || '') + toolCallDelta.function.arguments;
                          console.log('🔧 OpenAI tool call args chunk:', toolCallDelta.function.arguments.length, 'chars');
                        }
                      } catch (toolError) {
                        console.error('❌ Error processing OpenAI tool call delta:', toolError, toolCallDelta);
                        // Don't let tool call errors break the entire stream
                        continue;
                      }
                    }
                  }
                }
              }
              } catch (openaiError) {
                console.error('❌ OpenAI streaming error:', openaiError);
                
                // If we have partial content, try to finalize it
                if (eventBuilder.hasContent()) {
                  console.log('🔄 Attempting to finalize partial OpenAI content...');
                  try {
                    const partialEvent = eventBuilder.finalize();
                    eventLog.addEvent(partialEvent);
                    console.log('✅ Saved partial OpenAI content:', partialEvent.segments.length, 'segments');
                  } catch (finalizeError) {
                    console.error('❌ Failed to finalize partial content:', finalizeError);
                  }
                }
                
                // Re-throw to be caught by outer error handler
                throw openaiError;
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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            error: error?.message || error?.toString() || 'Unknown error'
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
