// Event-based existing conversation chat API - unified with chat-new
// Uses the same event-based system, streaming, and provider logic

import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';
import { ChatStreamHandler } from '@/lib/streaming/chatStreamHandler';
import { MCPToolExecutor } from '@/lib/tools/mcpToolExecutor';
import { EventLog, createTextEvent, createToolResultEvent } from '@/lib/types/events';
import { saveEvent, getConversationEvents } from '@/lib/db/events';
import { eventsToAnthropicMessages } from '@/lib/providers/anthropic';
import { eventsToOpenAIMessages } from '@/lib/providers/openai';
import { processResponsesAPIStream } from '@/lib/providers/openaiResponses';
import { getApiModelName, isClaudeModel, isReasoningModel, supportsReasoningEffort } from '@/lib/modelMapping';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// Helper function to execute MCP tool calls (now uses unified MCPToolExecutor)
async function executeMCPToolCalls(
  toolCalls: Array<{ id: string; name: string; args: object }>,
  workspaceId: string,
  budId?: string
): Promise<Array<{ id: string; output: object; error?: string }>> {
  const toolExecutor = new MCPToolExecutor({ debug: true });
  return await toolExecutor.executeToolCalls(toolCalls, workspaceId, budId);
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

    // Determine provider and API type based on model
    const isClaudeModelDetected = isClaudeModel(model);
    const isReasoningModelDetected = isReasoningModel(model);
    
    let provider: 'anthropic' | 'openai' | 'openai-responses';
    if (isClaudeModelDetected) {
      provider = 'anthropic';
    } else if (isReasoningModelDetected) {
      provider = 'openai-responses';
    } else {
      provider = 'openai';
    }
    
    const apiModelName = getApiModelName(model);
    
    console.log(`🔄 Using ${provider} provider for model: ${model} → ${apiModelName}`);

    // Create streaming response - same structure as chat-new
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventBuilder = new EventStreamBuilder('assistant')
          let eventFinalized = false // Track if current event has been finalized
          
          // Reasoning data collection for OpenAI Responses API
          const reasoningCollector = new Map<string, any>() // item_id -> reasoning data
          
          // Main conversation loop - handles tool calls automatically
          const maxIterations = 10;
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
              let tools: Anthropic.Tool[] = [];
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
              
              // Use unified ChatStreamHandler
              const streamHandler = new ChatStreamHandler(
                eventBuilder,
                eventLog,
                controller,
                { debug: true, conversationId }
              );
              
              await streamHandler.handleAnthropicStream(stream);
              
              // Save the finalized event to database
              const finalEvent = eventLog.getLastEvent();
              if (finalEvent) {
                await saveEvent(finalEvent, { conversationId });
              }
              
              // Check if we have tool calls to execute
              const toolCallSegments = finalEvent?.segments.filter(s => s.type === 'tool_call') || [];
              
              // If no tool calls, we're done
              if (toolCallSegments.length === 0) {
                shouldContinue = false;
              }
              
            } else if (provider === 'openai') {
              // Use OpenAI Chat Completions API
              const openaiMessages = eventsToOpenAIMessages(events);
              
              // Get available tools if budId is provided
              let tools: OpenAI.ChatCompletionTool[] = [];
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
                      
                      // Convert to OpenAI tool format
                      tools = mcpTools.map(tool => ({
                        type: 'function',
                        function: {
                          name: tool.name,
                          description: tool.description,
                          parameters: tool.inputSchema
                        }
                      }));
                      
                      await mcpClient.close();
                    }
                  }
                } catch (error) {
                  console.warn('Failed to get OpenAI tools:', error);
                }
              }
              
              const request = {
                model: apiModelName,
                messages: openaiMessages,
                temperature: 0.7,
                stream: true,
                ...(tools.length > 0 && { tools })
              };
              
              console.log('🔄 Sending request to OpenAI:', JSON.stringify(request, null, 2));
              
              const stream = await openai.chat.completions.create(request) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
              
              console.log('📡 OpenAI stream created, starting to process...');
              
              // Use unified ChatStreamHandler
              const streamHandler = new ChatStreamHandler(
                eventBuilder,
                eventLog,
                controller,
                { debug: true, conversationId }
              );
              
              await streamHandler.handleOpenAIStream(stream);
              
              // Save the finalized event to database
              const finalEvent = eventLog.getLastEvent();
              if (finalEvent) {
                await saveEvent(finalEvent, { conversationId });
              }
              
              // Check if we have tool calls to execute
              const toolCallSegments = finalEvent?.segments.filter(s => s.type === 'tool_call') || [];
              
              // If no tool calls, we're done
              if (toolCallSegments.length === 0) {
                shouldContinue = false;
              }
              
            } else if (provider === 'openai-responses') {
              // Use OpenAI Responses API for o-series reasoning models
              const openaiMessages = eventsToOpenAIMessages(events);
              
              // Get available tools if budId is provided
              let tools: OpenAI.ChatCompletionTool[] = [];
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
                      
                      // Convert to OpenAI tool format
                      tools = mcpTools.map(tool => ({
                        type: 'function',
                        function: {
                          name: tool.name,
                          description: tool.description,
                          parameters: tool.inputSchema
                        }
                      }));
                      
                      await mcpClient.close();
                    }
                  }
                } catch (error) {
                  console.warn('Failed to get OpenAI Responses API tools:', error);
                }
              }
              
              // Determine reasoning effort based on model and bud config
              let reasoningEffort: 'low' | 'medium' | 'high' | undefined;
              if (supportsReasoningEffort(model)) {
                // Check if bud has reasoning effort configured
                if (conversation.source_bud_id) {
                  try {
                    const { data: bud } = await supabase
                      .from('buds')
                      .select('default_json')
                      .eq('id', conversation.source_bud_id)
                      .single();
                    
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
              
              console.log('🔄 Sending request to OpenAI Responses API:', JSON.stringify(responsesRequest, null, 2));
              
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
                        parts: {},
                        is_streaming: true
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
                      // Finalize reasoning
                      const { text } = event as any;
                      reasoningData.combined_text = text || Object.values(reasoningData.parts)
                        .sort((a: any, b: any) => a.summary_index - b.summary_index)
                        .map((part: any) => part.text)
                        .join('\n\n');
                      // Don't store is_streaming - it's computed on frontend
                      
                      console.log('💭 Collected reasoning data for database:', {
                        item_id,
                        parts_count: Object.keys(reasoningData.parts).length,
                        combined_text_length: reasoningData.combined_text?.length
                      });
                    }
                  }
                } else if (event.type === 'finalize_only' && !eventFinalized) {
                  // Debug: Show what reasoning data we collected
                  console.log('🔍 Finalization - reasoning collector contents:', {
                    collectorSize: reasoningCollector.size,
                    collectorKeys: Array.from(reasoningCollector.keys()),
                    collectedData: Array.from(reasoningCollector.values()).map(data => ({
                      item_id: data.item_id,
                      parts_count: Object.keys(data.parts).length,
                      has_combined_text: !!data.combined_text,
                      is_streaming: data.is_streaming
                    }))
                  });
                  
                  // Attach reasoning data to event builder before finalization
                  const reasoningEntries = Array.from(reasoningCollector.values());
                  if (reasoningEntries.length > 0) {
                    // Use the first (and typically only) reasoning data
                    const reasoningData = reasoningEntries[0];
                    console.log('🔗 Attaching reasoning to event builder:', reasoningData);
                    eventBuilder.setReasoningData(reasoningData);
                  } else {
                    console.log('❌ NO REASONING DATA to attach to event builder');
                  }
                  
                  // Finalize the current event only once (from OpenAI response.completed)
                  const builtEvent = eventBuilder.finalize();
                  if (builtEvent) {
                    console.log('🏁 Finalizing event (from OpenAI response.completed):', { 
                      eventId: builtEvent.id, 
                      role: builtEvent.role,
                      hasReasoning: !!builtEvent.reasoning
                    });
                    eventLog.addEvent(builtEvent);
                    // Save assistant event to database
                    await saveEvent(builtEvent, { conversationId });
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