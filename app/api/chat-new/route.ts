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
import { createResponsesAPIRequest, processResponsesAPIStream } from '@/lib/providers/openaiResponses'
import { getApiModelName, isClaudeModel, isReasoningModel, supportsReasoningEffort } from '@/lib/modelMapping'
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
    console.log('📋 Events received for saving:', events.length)
    console.log('📋 Event IDs being saved:', events.map(e => ({ id: e.id, role: e.role })))
    
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
    const seenIds = new Set<string>();
    let previousOrderKey: string | null = null
    
    for (const event of events) {
      const orderKey = generateKeyBetween(previousOrderKey, null)
      previousOrderKey = orderKey
      
      // Check for duplicate IDs within this batch
      if (seenIds.has(event.id)) {
        console.error('🚨 DUPLICATE ID DETECTED within batch:', event.id);
      }
      seenIds.add(event.id);
      
      
      eventInserts.push({
        id: event.id,
        conversation_id: conversation.id,
        role: event.role,
        segments: event.segments,
        ts: event.ts,
        order_key: orderKey,
        reasoning: event.reasoning || null,
        created_at: new Date().toISOString()
      })
    }

    if (eventInserts.length > 0) {
      console.log('💾 About to insert events:', eventInserts.length)
      console.log('💾 Event insert details:', eventInserts.map(e => ({ id: e.id, role: e.role, order_key: e.order_key })))
      
      // Check if any of these event IDs already exist in the database
      const eventIds = eventInserts.map(e => e.id);
      const { data: existingEvents } = await supabase
        .from('events')
        .select('id')
        .in('id', eventIds);
      
      if (existingEvents && existingEvents.length > 0) {
        console.error('🚨 FOUND EXISTING EVENTS in database:', existingEvents.map(e => e.id));
        console.error('🚨 Trying to insert:', eventIds);
        console.error('🚨 Conflicts:', existingEvents.map(e => e.id));
      }
      
      const { error: eventsError } = await supabase
        .from('events')
        .insert(eventInserts)

      if (eventsError) {
        console.error('❌ Error saving events:', eventsError)
        console.error('❌ Failed event IDs:', eventInserts.map(e => e.id))
        console.error('❌ Full error details:', JSON.stringify(eventsError, null, 2))
        throw new Error('Failed to save events')
      }
      
      console.log('✅ Successfully saved events to database')
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
    
    // Add existing events (messages are now always in event format)
    for (const event of messages) {
      console.log('📝 Processing event:', { id: event.id, role: event.role, segments: event.segments?.length })
      
      // Keep original IDs for optimistic UI rendering
      eventLog.addEvent({
        id: event.id, // Keep original ID for optimistic UI updates
        role: event.role,
        segments: event.segments,
        ts: event.ts || Date.now(),
        reasoning: event.reasoning
      })
    }

    // Determine provider and API type based on model
    const isClaudeModelDetected = isClaudeModel(model)
    const isReasoningModelDetected = isReasoningModel(model)
    
    let provider: 'anthropic' | 'openai' | 'openai-responses';
    if (isClaudeModelDetected) {
      provider = 'anthropic';
    } else if (isReasoningModelDetected) {
      provider = 'openai-responses';
    } else {
      provider = 'openai';
    }
    
    const apiModelName = getApiModelName(model)
    
    console.log(`🔄 Using ${provider} provider for model: ${model} → ${apiModelName}`)

    // Create streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventBuilder = new EventStreamBuilder('assistant')
          let createdConversationId: string | null = null
          let eventFinalized = false // Track if current event has been finalized
          
          // Reasoning data collection for OpenAI Responses API
          const reasoningCollector = new Map<string, any>() // item_id -> reasoning data
          
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
              
            } else if (provider === 'openai') {
              // Use OpenAI Chat Completions API
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
              
            } else if (provider === 'openai-responses') {
              // Use OpenAI Responses API for o-series reasoning models
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
                  console.warn('Failed to get OpenAI Responses API tools:', error)
                }
              }
              
              // Determine reasoning effort based on model and bud config
              let reasoningEffort: 'low' | 'medium' | 'high' | undefined;
              if (supportsReasoningEffort(model)) {
                // Check if bud has reasoning effort configured
                if (budId) {
                  try {
                    const { data: bud } = await supabase
                      .from('buds')
                      .select('default_json')
                      .eq('id', budId)
                      .single()
                    
                    const budConfig = bud?.default_json as { reasoning_effort?: 'low' | 'medium' | 'high' };
                    reasoningEffort = budConfig?.reasoning_effort || 'medium';
                  } catch (error) {
                    console.warn('Failed to get bud reasoning effort:', error);
                    reasoningEffort = 'medium';
                  }
                } else {
                  reasoningEffort = 'medium'; // Default
                }
              }
              
              const request = createResponsesAPIRequest(openaiMessages, apiModelName, {
                temperature: 0.7,
                tools,
                reasoning_effort: reasoningEffort
              });
              
              console.log('🔄 Sending request to OpenAI Responses API:', JSON.stringify(request, null, 2));
              
              // Use OpenAI Responses API for o-series models  
              // Note: o-series models don't support temperature parameter
              const responsesRequest = {
                model: apiModelName,
                input: openaiMessages.map(msg => {
                  if (typeof msg.content === 'string') {
                    return msg.content;
                  }
                  return JSON.stringify(msg.content);
                }).join('\n'),
                stream: true as const,
                // TODO: Convert tools to Responses API format when needed
                // ...(tools.length > 0 && { tools }),
                reasoning: { 
                  effort: reasoningEffort || 'medium',
                  summary: 'auto'  // Enable reasoning summaries
                }
              };
              
              console.log('🚀 Final Responses API request:', JSON.stringify(responsesRequest, null, 2));
              
              const stream = await openai.responses.create(responsesRequest);
              
              console.log('📡 OpenAI Responses API stream created, starting to process...');
              
              // Process the Responses API stream with reasoning events
              const responsesStream = processResponsesAPIStream(stream);
              
              // Handle both reasoning and regular events
              for await (const event of responsesStream) {
                if (event.type === 'error') {
                  console.error('❌ OpenAI Responses API error:', event.error);
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                  break;
                }
                
                // Send event to frontend (but not internal-only events)
                if (event.type !== 'finalize_only') {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                }
                
                
                // Build events for database storage
                if (event.type === 'token' && event.content) {
                  eventBuilder.addTextChunk(event.content);
                } else if (event.type.includes('reasoning_summary')) {
                  // Collect reasoning events for database storage
                  const { item_id } = event as any;
                  if (item_id) {
                    if (!reasoningCollector.has(item_id)) {
                      reasoningCollector.set(item_id, {
                        item_id,
                        output_index: (event as any).output_index || 0,
                        parts: {}
                      });
                    }
                    
                    const reasoningData = reasoningCollector.get(item_id);
                    
                    // Handle specific reasoning events
                    if (event.type === 'reasoning_summary_text_done') {
                      const { summary_index, text } = event as any;
                      reasoningData.parts[summary_index] = {
                        summary_index,
                        type: 'summary_text',
                        text: text || '',
                        sequence_number: (event as any).sequence_number || 0,
                        is_complete: true,
                        created_at: Date.now()
                      };
                    } else if (event.type === 'reasoning_summary_done') {
                      // Finalize reasoning - just set the combined text, no is_streaming needed
                      const { text } = event as any;
                      reasoningData.combined_text = text || Object.values(reasoningData.parts)
                        .sort((a: any, b: any) => a.summary_index - b.summary_index)
                        .map((part: any) => part.text)
                        .join('\n\n');
                    }
                  }
                } else if (event.type === 'finalize_only' && !eventFinalized) {
                  // Attach reasoning data to event builder before finalization
                  const reasoningEntries = Array.from(reasoningCollector.values());
                  if (reasoningEntries.length > 0) {
                    // Use the first (and typically only) reasoning data
                    const reasoningData = reasoningEntries[0];
                    eventBuilder.setReasoningData(reasoningData);
                  }
                  
                  // Finalize the current event only once (from OpenAI response.completed)
                  const builtEvent = eventBuilder.finalize();
                  if (builtEvent) {
                    eventLog.addEvent(builtEvent);
                    eventFinalized = true; // Mark as finalized to prevent duplicates
                  }
                  // NOTE: This does NOT send a complete event to frontend - that happens after conversation creation
                }
              }
              
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
            eventFinalized = false; // Reset finalization flag for next iteration
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
            
            // Send conversation created event BEFORE complete event
            console.log('📤 Sending conversationCreated event:', { conversationId: createdConversationId });
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: "conversationCreated",
              conversationId: createdConversationId
            })}\n\n`))
            console.log('✅ conversationCreated event sent successfully');
          }
          
          // Send completion event AFTER conversationCreated (so frontend has realConversationId)
          console.log('📤 Sending complete event to frontend');
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
          console.log('✅ Complete event sent to frontend');
          
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
