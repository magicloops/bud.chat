// Event-based chat API - vendor-agnostic implementation

import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';
import { EventLog, createTextEvent, createToolResultEvent } from '@/lib/types/events';
import { saveEvent, getConversationEvents } from '@/lib/db/events';
import { eventsToAnthropicMessages, anthropicStreamDeltaToEvent, extractPendingToolCalls } from '@/lib/providers/anthropic';
import { eventsToOpenAIMessages, openaiStreamDeltaToEvent } from '@/lib/providers/openai';
import { getApiModelName, isClaudeModel } from '@/lib/modelMapping';
import { generateKeyBetween } from 'fractional-indexing';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Helper function to create conversation in background
async function createConversationInBackground(
  events: any[],
  workspaceId: string,
  budId?: string
): Promise<{ conversationId: string; bud?: any }> {
  const supabase = await createClient();
  
  try {
    console.log('💾 Creating conversation in background...');
    
    // Fetch bud if budId is provided
    let bud = null;
    if (budId) {
      const { data, error } = await supabase
        .from('buds')
        .select('*')
        .eq('id', budId)
        .single();
      
      if (data && !error) {
        bud = data;
      }
    }
    
    // Create conversation
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        workspace_id: workspaceId,
        source_bud_id: budId,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (convError || !conversation) {
      throw new Error('Failed to create conversation');
    }

    // Save all events to database
    const eventInserts = [];
    let previousOrderKey: string | null = null;
    
    for (const event of events) {
      const orderKey = generateKeyBetween(previousOrderKey, null);
      previousOrderKey = orderKey;
      
      eventInserts.push({
        id: event.id,
        conversation_id: conversation.id,
        role: event.role,
        segments: event.segments,
        ts: event.ts,
        order_key: orderKey,
        created_at: new Date().toISOString()
      });
    }

    if (eventInserts.length > 0) {
      const { error: eventsError } = await supabase
        .from('events')
        .insert(eventInserts);

      if (eventsError) {
        console.error('❌ Error saving events:', eventsError);
        throw new Error('Failed to save events');
      }
    }

    console.log('✅ Conversation and events created:', conversation.id);
    return { conversationId: conversation.id, bud };
  } catch (error) {
    console.error('❌ Background conversation creation failed:', error);
    throw error;
  }
}

// Helper function to execute MCP tool calls
async function executeMCPToolCalls(
  toolCalls: Array<{ id: string; name: string; args: object }>,
  workspaceId: string,
  budId?: string
): Promise<Array<{ id: string; output: object; error?: string }>> {
  const results = [];
  
  if (!budId) {
    // No MCP configuration available
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: 'No MCP configuration available' },
      error: 'No MCP configuration available'
    }));
  }

  try {
    const supabase = await createClient();
    
    // Get bud and MCP configuration
    const { data: bud, error: budError } = await supabase
      .from('buds')
      .select('*, mcp_config')
      .eq('id', budId)
      .single();

    if (!bud || budError || !bud.mcp_config?.servers?.length) {
      throw new Error('No MCP servers configured');
    }

    // Get MCP servers
    const { data: servers, error: serversError } = await supabase
      .from('mcp_servers')
      .select('*')
      .in('id', bud.mcp_config.servers)
      .eq('workspace_id', workspaceId);

    if (!servers || serversError || servers.length === 0) {
      throw new Error('No MCP servers found');
    }

    // Connect to MCP server
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    
    const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
    const mcpClient = new Client({
      name: 'bud-chat-events-client',
      version: '1.0.0'
    }, {
      capabilities: { tools: {} }
    });
    
    await mcpClient.connect(transport);
    
    // Execute each tool call
    for (const toolCall of toolCalls) {
      try {
        const result = await mcpClient.callTool({
          name: toolCall.name,
          arguments: (toolCall.args || {}) as Record<string, unknown>
        });
        
        // Process result content
        let output = result.content;
        if (Array.isArray(output)) {
          output = output.map(block => 
            block.type === 'text' ? block.text : JSON.stringify(block)
          ).join('\n');
        }
        
        results.push({
          id: toolCall.id,
          output: { content: output }
        });
      } catch (toolError) {
        console.error('❌ Tool execution failed:', toolError);
        const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
        results.push({
          id: toolCall.id,
          output: { error: errorMessage },
          error: errorMessage
        });
      }
    }
    
    await mcpClient.close();
    
  } catch (error) {
    console.error('❌ MCP execution failed:', error);
    // Return error for all tool calls
    const errorMessage = error instanceof Error ? error.message : String(error);
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: errorMessage },
      error: errorMessage
    }));
  }
  
  return results;
}

export async function POST(request: NextRequest) {
  console.log('🚀 Event-based chat API called');
  
  try {
    const supabase = await createClient();
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const { 
      messages, 
      workspaceId,
      budId,
      model = 'gpt-4o'
    } = body;

    // Validate required fields
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('Messages are required', { status: 400 });
    }
    if (!workspaceId) {
      return new Response('Workspace ID is required', { status: 400 });
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return new Response('Workspace not found or access denied', { status: 404 });
    }

    // Convert legacy messages to events
    const eventLog = new EventLog();
    
    // Add existing messages as events
    for (const message of messages) {
      if (message.role === 'system') {
        eventLog.addEvent(createTextEvent('system', message.content));
      } else if (message.role === 'user') {
        eventLog.addEvent(createTextEvent('user', message.content));
      } else if (message.role === 'assistant') {
        // Handle assistant messages with potential tool calls
        const segments: Array<{type: 'text', text: string} | {type: 'tool_call', id: string, name: string, args: object}> = [];
        if (message.content) {
          segments.push({ type: 'text' as const, text: message.content });
        }
        if (message.json_meta?.tool_calls) {
          for (const toolCall of message.json_meta.tool_calls) {
            segments.push({
              type: 'tool_call' as const,
              id: toolCall.id,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || '{}')
            });
          }
        }
        if (segments.length > 0) {
          eventLog.addEvent({
            id: crypto.randomUUID(),
            role: 'assistant',
            segments,
            ts: Date.now()
          });
        }
      }
    }

    // Determine provider based on model
    const isClaudeModelDetected = isClaudeModel(model);
    const provider = isClaudeModelDetected ? 'anthropic' : 'openai';
    const apiModelName = getApiModelName(model);
    
    console.log(`🔄 Using ${provider} provider for model: ${model} → ${apiModelName}`);

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventBuilder = new EventStreamBuilder('assistant');
          let conversationId: string | null = null;
          
          // Main conversation loop - handles tool calls automatically
          let maxIterations = 5; // Prevent infinite loops
          let iteration = 0;
          
          while (iteration < maxIterations) {
            iteration++;
            console.log(`🔄 Conversation iteration ${iteration}`);
            
            // Check if there are pending tool calls
            const pendingToolCalls = eventLog.getUnresolvedToolCalls();
            if (pendingToolCalls.length > 0) {
              console.log(`🔧 Executing ${pendingToolCalls.length} pending tool calls`);
              
              // Execute all pending tool calls
              const toolResults = await executeMCPToolCalls(
                pendingToolCalls,
                workspaceId,
                budId
              );
              
              // Add tool results to event log
              for (const result of toolResults) {
                eventLog.addEvent(createToolResultEvent(result.id, result.output));
                
                // Stream tool completion to user
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_complete',
                  tool_id: result.id,
                  content: result.error ? '❌ Tool failed' : '✅ Tool completed'
                })}\n\n`));
              }
              
              // Continue to next iteration to get follow-up response
              continue;
            }
            
            // No pending tool calls, get next response from LLM
            const events = eventLog.getEvents();
            
            if (provider === 'anthropic') {
              // Use Anthropic
              const { messages, system } = eventsToAnthropicMessages(events);
              
              // Get available tools if budId is provided
              let tools: any[] = [];
              if (budId) {
                try {
                  const supabase = await createClient();
                  const { data: bud } = await supabase
                    .from('buds')
                    .select('*, mcp_config')
                    .eq('id', budId)
                    .single();
                  
                  if (bud?.mcp_config?.servers?.length) {
                    const { data: servers } = await supabase
                      .from('mcp_servers')
                      .select('*')
                      .in('id', bud.mcp_config.servers)
                      .eq('workspace_id', workspaceId);
                    
                    if (servers?.length) {
                      // Connect to get tools
                      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
                      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
                      
                      const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
                      const mcpClient = new Client({
                        name: 'bud-chat-tools-client',
                        version: '1.0.0'
                      }, { capabilities: { tools: {} } });
                      
                      await mcpClient.connect(transport);
                      const { tools: mcpTools } = await mcpClient.listTools();
                      
                      tools = mcpTools.map(tool => ({
                        name: tool.name,
                        description: tool.description,
                        input_schema: tool.inputSchema
                      }));
                      
                      await mcpClient.close();
                    }
                  }
                } catch (error) {
                  console.warn('Failed to get tools:', error);
                }
              }
              
              const request = {
                model: apiModelName,
                max_tokens: 4000,
                temperature: 0.7,
                messages: messages,
                stream: true,
                ...(system && { system }),
                ...(tools.length > 0 && { tools })
              };
              
              const stream = await anthropic.messages.stream(request);
              
              for await (const event of stream) {
                const { event: currentEvent, isComplete } = anthropicStreamDeltaToEvent(event, eventBuilder.getCurrentEvent());
                
                if (currentEvent) {
                  eventBuilder.reset('assistant', currentEvent.id);
                  // Update builder with current event state
                  for (const segment of currentEvent.segments) {
                    if (segment.type === 'text') {
                      eventBuilder.addTextChunk(segment.text);
                    } else if (segment.type === 'tool_call') {
                      eventBuilder.addToolCall(segment.id, segment.name, segment.args);
                      
                      // Stream tool call start
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'tool_start',
                        tool_id: segment.id,
                        tool_name: segment.name,
                        content: `🔧 *Using tool: ${segment.name}*\n`
                      })}\n\n`));
                    }
                  }
                  
                  // Stream text content
                  const textSegments = currentEvent.segments.filter(s => s.type === 'text');
                  for (const segment of textSegments) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'token',
                      content: segment.text
                    })}\n\n`));
                  }
                }
                
                if (isComplete) {
                  const finalEvent = eventBuilder.finalize();
                  eventLog.addEvent(finalEvent);
                  
                  // If no tool calls, we're done
                  if (finalEvent.segments.every(s => s.type !== 'tool_call')) {
                    iteration = maxIterations; // Exit loop
                  }
                  break;
                }
              }
              
            } else {
              // Use OpenAI
              const openaiMessages = eventsToOpenAIMessages(events);
              
              const stream = await openai.chat.completions.create({
                model: apiModelName,
                messages: openaiMessages,
                temperature: 0.7,
                stream: true
              });
              
              for await (const chunk of stream) {
                const activeToolCalls = new Map();
                const { event: currentEvent, isComplete } = openaiStreamDeltaToEvent(
                  chunk, 
                  eventBuilder.getCurrentEvent(), 
                  activeToolCalls
                );
                
                if (currentEvent) {
                  // Stream text content
                  const textSegments = currentEvent.segments.filter(s => s.type === 'text');
                  for (const segment of textSegments) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'token',
                      content: segment.text
                    })}\n\n`));
                  }
                  
                  // Stream tool calls
                  const toolCalls = currentEvent.segments.filter(s => s.type === 'tool_call');
                  for (const segment of toolCalls) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'tool_start',
                      tool_id: segment.id,
                      tool_name: segment.name,
                      content: `🔧 *Using tool: ${segment.name}*\n`
                    })}\n\n`));
                  }
                }
                
                if (isComplete) {
                  const finalEvent = eventBuilder.finalize();
                  eventLog.addEvent(finalEvent);
                  
                  // If no tool calls, we're done
                  if (finalEvent.segments.every(s => s.type !== 'tool_call')) {
                    iteration = maxIterations; // Exit loop
                  }
                  break;
                }
              }
            }
            
            // Reset builder for next iteration
            eventBuilder.reset('assistant');
          }
          
          // Create conversation in background
          const allEvents = eventLog.getEvents();
          const conversationResult = await createConversationInBackground(
            allEvents,
            workspaceId,
            budId
          );
          
          conversationId = conversationResult.conversationId;
          
          // Send conversation created event
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'conversationCreated',
            conversationId
          })}\n\n`));
          
          // Send completion event
          const finalContent = allEvents
            .filter(e => e.role === 'assistant')
            .flatMap(e => e.segments)
            .filter(s => s.type === 'text')
            .map(s => s.text)
            .join('');
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            content: finalContent
          })}\n\n`));
          
          controller.close();
          
        } catch (error) {
          console.error('❌ Streaming error:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: errorMessage
          })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('❌ Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}