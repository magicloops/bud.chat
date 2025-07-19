// Event-based existing conversation chat API - unified with chat-new
// Uses the same event-based system, streaming, and provider logic

import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';
import { EventLog, createTextEvent, createToolResultEvent } from '@/lib/types/events';
import { saveEvent, getConversationEvents } from '@/lib/db/events';
import { eventsToAnthropicMessages, extractPendingToolCalls } from '@/lib/providers/anthropic';
import { eventsToOpenAIMessages } from '@/lib/providers/openai';
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

// Helper function to execute MCP tool calls (shared with chat-new)
async function executeMCPToolCalls(
  toolCalls: Array<{ id: string; name: string; args: object }>,
  workspaceId: string,
  budId?: string
): Promise<Array<{ id: string; output: object; error?: string }>> {
  const results = [];
  
  if (!budId) {
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
      name: 'bud-chat-client',
      version: '1.0.0'
    }, {
      capabilities: { tools: {} }
    });
    
    await mcpClient.connect(transport);
    
    // Execute each tool call
    for (const toolCall of toolCalls) {
      try {
        console.log('🔧 Executing tool call:', {
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
          argsType: typeof toolCall.args
        });
        
        const result = await mcpClient.callTool({
          name: toolCall.name,
          arguments: toolCall.args || {}
        });
        
        // Process result content
        let output = result.content;
        if (Array.isArray(output)) {
          output = output.map(block => 
            block.type === 'text' ? block.text : JSON.stringify(block)
          ).join('\n');
        }
        
        // Truncate very large tool results
        const MAX_TOOL_RESULT_LENGTH = 50000;
        if (typeof output === 'string' && output.length > MAX_TOOL_RESULT_LENGTH) {
          console.log('⚠️ Tool result too large, truncating from', output.length, 'to', MAX_TOOL_RESULT_LENGTH);
          output = output.substring(0, MAX_TOOL_RESULT_LENGTH) + '\n\n[Content truncated due to length...]';
        }
        
        results.push({
          id: toolCall.id,
          output: { content: output }
        });
      } catch (toolError) {
        console.error('❌ Tool execution failed:', toolError);
        results.push({
          id: toolCall.id,
          output: { error: toolError.message },
          error: toolError.message
        });
      }
    }
    
    await mcpClient.close();
    
  } catch (error) {
    console.error('❌ MCP execution failed:', error);
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: error.message },
      error: error.message
    }));
  }
  
  return results;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  console.log('💬 Event-based existing conversation chat API called');
  
  try {
    const supabase = await createClient();
    const resolvedParams = await params;
    const conversationId = resolvedParams.conversationId;
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const body = await request.json();
    const { 
      message, 
      workspaceId
    } = body;

    console.log('📥 Request data:', { 
      conversationId, 
      message: message?.substring(0, 50) + '...', 
      workspaceId
    });

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return new Response('Message is required', { status: 400 });
    }
    if (!workspaceId) {
      return new Response('Workspace ID is required', { status: 400 });
    }

    // Verify conversation exists and user has access
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, workspace_id, source_bud_id, model_config_overrides')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return new Response('Conversation not found', { status: 404 });
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', conversation.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      return new Response('Workspace not found or access denied', { status: 404 });
    }

    console.log('✅ User has access to conversation:', conversationId);

    // Determine model from conversation -> bud -> default
    let model = 'gpt-4o'; // Default fallback
    
    // 1. Check if conversation has model override
    if (conversation.model_config_overrides?.model) {
      model = conversation.model_config_overrides.model;
      console.log('🎯 Using conversation model override:', model);
    } else if (conversation.source_bud_id) {
      // 2. Check bud's default model
      const { data: bud } = await supabase
        .from('buds')
        .select('default_json')
        .eq('id', conversation.source_bud_id)
        .single();
        
      if (bud?.default_json?.model) {
        model = bud.default_json.model;
        console.log('🎯 Using bud model:', model);
      } else {
        console.log('🎯 Using default model:', model);
      }
    } else {
      console.log('🎯 Using default model (no bud):', model);
    }

    // Load existing events from database
    const existingEvents = await getConversationEvents(conversationId);
    console.log('📚 Loaded existing events:', existingEvents.length);

    // Create event log with existing events + new user message
    const eventLog = new EventLog(existingEvents);
    const userEvent = createTextEvent('user', message);
    eventLog.addEvent(userEvent);

    // Save user event to database
    await saveEvent(userEvent, { conversationId });
    console.log('💾 User event saved to database');

    // Determine provider based on model
    const isClaudeModelDetected = isClaudeModel(model);
    const provider = isClaudeModelDetected ? 'anthropic' : 'openai';
    const apiModelName = getApiModelName(model);
    
    console.log(`🔄 Using ${provider} provider for model: ${model} → ${apiModelName}`);

    // Create streaming response - same structure as chat-new
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventBuilder = new EventStreamBuilder('assistant');
          
          // Main conversation loop - handles tool calls automatically
          let maxIterations = 10;
          let iteration = 0;
          let shouldContinue = true;
          
          while (iteration < maxIterations && shouldContinue) {
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
                conversation.source_bud_id
              );
              
              // Add tool results to event log
              for (const result of toolResults) {
                const toolResultEvent = createToolResultEvent(result.id, result.output);
                eventLog.addEvent(toolResultEvent);
                
                // Save tool result to database
                await saveEvent(toolResultEvent, { conversationId });
                
                // Stream tool result to user
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_result',
                  tool_id: result.id,
                  output: result.output,
                  error: result.error || null
                })}\n\n`));
                
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
              const { messages: anthropicMessages, system } = eventsToAnthropicMessages(events);
              
              // Get available tools if budId is provided
              let tools = [];
              if (conversation.source_bud_id) {
                try {
                  const { data: bud } = await supabase
                    .from('buds')
                    .select('*, mcp_config')
                    .eq('id', conversation.source_bud_id)
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
                messages: anthropicMessages,
                stream: true,
                ...(system && { system }),
                ...(tools.length > 0 && { tools })
              };
              
              const stream = await anthropic.messages.stream(request);
              
              for await (const event of stream) {
                switch (event.type) {
                  case 'message_start':
                    eventBuilder.reset('assistant');
                    break;
                    
                  case 'content_block_start':
                    if (event.content_block?.type === 'tool_use') {
                      if (event.content_block.id && event.content_block.name) {
                        // Start streaming tool call (don't finalize yet)
                        eventBuilder.startToolCall(event.content_block.id, event.content_block.name);
                        
                        // Stream tool call start
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: 'tool_start',
                          tool_id: event.content_block.id,
                          tool_name: event.content_block.name,
                          content: `🔧 *Using tool: ${event.content_block.name}*\n`
                        })}\n\n`));
                      }
                    }
                    break;
                    
                  case 'content_block_delta':
                    if (event.delta?.type === 'text_delta' && event.delta.text) {
                      eventBuilder.addTextChunk(event.delta.text);
                      
                      // Stream text content
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'token',
                        content: event.delta.text
                      })}\n\n`));
                    } else if (event.delta?.type === 'input_json_delta' && event.index !== undefined) {
                      // Handle tool call argument accumulation
                      const toolCallId = eventBuilder.getToolCallIdAtIndex(event.index);
                      if (toolCallId && event.delta.partial_json) {
                        eventBuilder.addToolCallArguments(toolCallId, event.delta.partial_json);
                      }
                    }
                    break;
                    
                  case 'content_block_stop':
                    // Complete any streaming tool calls
                    if (event.index !== undefined) {
                      const toolCallId = eventBuilder.getToolCallIdAtIndex(event.index);
                      if (toolCallId) {
                        eventBuilder.completeToolCall(toolCallId);
                      }
                    }
                    break;
                    
                  case 'message_stop':
                    const finalEvent = eventBuilder.finalize();
                    eventLog.addEvent(finalEvent);
                    
                    // Save assistant event to database
                    await saveEvent(finalEvent, { conversationId });
                    
                    // Stream finalized tool calls with complete arguments
                    const toolCallSegments = finalEvent.segments.filter(s => s.type === 'tool_call');
                    for (const toolCall of toolCallSegments) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'tool_finalized',
                        tool_id: toolCall.id,
                        tool_name: toolCall.name,
                        args: toolCall.args
                      })}\n\n`));
                    }
                    
                    // If no tool calls, we're done
                    if (finalEvent.segments.every(s => s.type !== 'tool_call')) {
                      shouldContinue = false;
                    }
                    break;
                }
              }
              
            } else {
              // Use OpenAI (same logic as chat-new)
              const openaiMessages = eventsToOpenAIMessages(events);
              
              const stream = await openai.chat.completions.create({
                model: apiModelName,
                messages: openaiMessages,
                temperature: 0.7,
                stream: true
              });
              
              for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                const content = delta?.content;
                
                if (content) {
                  eventBuilder.addTextChunk(content);
                  
                  // Stream text content
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: 'token',
                    content: content
                  })}\n\n`));
                }
                
                if (chunk.choices[0]?.finish_reason) {
                  const finalEvent = eventBuilder.finalize();
                  eventLog.addEvent(finalEvent);
                  
                  // Save assistant event to database
                  await saveEvent(finalEvent, { conversationId });
                  
                  // If no tool calls, we're done
                  if (finalEvent.segments.every(s => s.type !== 'tool_call')) {
                    shouldContinue = false;
                  }
                  break;
                }
              }
            }
            
            // Reset builder for next iteration
            eventBuilder.reset('assistant');
          }
          
          // Send completion event
          const finalContent = eventLog.getEvents()
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
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: error?.message || error?.toString() || 'Unknown error'
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