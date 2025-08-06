// Unified Chat API - Consolidates all chat endpoints using new abstractions
import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { ProviderFactory, UnifiedChatRequest } from '@/lib/providers/unified';
import { StreamingFormat, EventConverter } from '@/lib/events';
import { AppError, ErrorCode, handleApiError } from '@/lib/errors';
import { 
  EventLog, 
  createTextEvent, 
  createToolResultEvent,
  createMixedEvent,
  Event,
  DatabaseEvent,
  ToolCall
} from '@/lib/types/events';
import { 
  WorkspaceId, 
  BudId, 
  ConversationId,
  toWorkspaceId,
  toBudIdOrNull,
  toConversationIdOrNull,
  generateConversationId,
  generateEventId,
  ToolCallId
} from '@/lib/types/branded';
import { Bud } from '@/lib/types';
import { generateKeyBetween } from 'fractional-indexing';
import { generateConversationTitleInBackground } from '@/lib/chat/shared';

// Request types
interface ChatRequestBase {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface NewChatRequest extends ChatRequestBase {
  mode?: 'new';
  messages: Array<{role: string; content: string; json_meta?: Record<string, unknown>}>;
  workspaceId: string;
  budId?: string;
}

interface ContinueChatRequest extends ChatRequestBase {
  mode: 'continue';
  conversationId: string;
  message: string;
}

interface ResponsesChatRequest extends ChatRequestBase {
  mode: 'responses';
  conversationId: string;
  message: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

type ChatRequest = NewChatRequest | ContinueChatRequest | ResponsesChatRequest;

// Helper to validate workspace access
async function validateWorkspaceAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string
): Promise<WorkspaceId> {
  const { data: membership, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();

  if (error || !membership) {
    throw new AppError(
      ErrorCode.FORBIDDEN,
      'Workspace not found or access denied',
      { statusCode: 404 }
    );
  }

  return toWorkspaceId(workspaceId);
}

// Helper to validate conversation access
async function validateConversationAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  userId: string
): Promise<{ conversation: any; workspaceId: WorkspaceId }> {
  const { data: conversation, error } = await supabase
    .from('conversations')
    .select('*, workspace:workspaces!inner(*)')
    .eq('id', conversationId)
    .single();

  if (error || !conversation) {
    throw AppError.notFound('Conversation');
  }

  // Check workspace access
  const workspaceId = await validateWorkspaceAccess(
    supabase, 
    conversation.workspace_id, 
    userId
  );

  return { conversation, workspaceId };
}

// Helper to load events from a conversation
async function loadConversationEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: ConversationId
): Promise<Event[]> {
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('order_key', { ascending: true });

  if (error) {
    throw new AppError(
      ErrorCode.DB_QUERY_ERROR,
      'Failed to load conversation events',
      { originalError: error }
    );
  }

  return (events || []).map(e => ({
    id: e.id,
    role: e.role,
    segments: e.segments,
    ts: e.ts,
    response_metadata: e.response_metadata
  }));
}

// Helper to save events
async function saveEvents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  events: Event[],
  conversationId: ConversationId,
  previousOrderKey?: string | null
): Promise<string | null> {
  let orderKey = previousOrderKey;
  const eventInserts: Omit<DatabaseEvent, 'created_at'>[] = [];
  
  for (const event of events) {
    orderKey = generateKeyBetween(orderKey, null);
    
    eventInserts.push({
      id: event.id,
      conversation_id: conversationId,
      role: event.role,
      segments: event.segments,
      ts: event.ts,
      order_key: orderKey,
      response_metadata: event.response_metadata
    });
  }

  if (eventInserts.length > 0) {
    const { error } = await supabase
      .from('events')
      .insert(eventInserts);

    if (error) {
      throw new AppError(
        ErrorCode.DB_QUERY_ERROR,
        'Failed to save events',
        { originalError: error }
      );
    }
  }
  
  return orderKey;
}

// Helper to create a new conversation
async function createConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: WorkspaceId,
  budId?: BudId
): Promise<{ conversationId: ConversationId; bud?: Bud }> {
  // Fetch bud if provided
  let bud: Bud | null = null;
  if (budId) {
    const { data, error } = await supabase
      .from('buds')
      .select('*')
      .eq('id', budId)
      .single();
    
    if (data && !error) {
      bud = data as Bud;
    }
  }
  
  // Create conversation
  const conversationId = generateConversationId();
  const { error } = await supabase
    .from('conversations')
    .insert({
      id: conversationId,
      workspace_id: workspaceId,
      source_bud_id: budId || null,
      created_at: new Date().toISOString()
    });

  if (error) {
    throw new AppError(
      ErrorCode.DB_QUERY_ERROR,
      'Failed to create conversation',
      { originalError: error }
    );
  }

  return { conversationId, bud: bud || undefined };
}

// Helper to get tools for a bud
async function getToolsForBud(
  supabase: Awaited<ReturnType<typeof createClient>>,
  budId: BudId,
  workspaceId: WorkspaceId
): Promise<{ tools: any[]; mcpAvailable: boolean }> {
  try {
    const { data: bud, error } = await supabase
      .from('buds')
      .select('*, mcp_config')
      .eq('id', budId)
      .single();

    if (!bud || error || !bud.mcp_config?.servers?.length) {
      return { tools: [], mcpAvailable: false };
    }

    const { data: servers } = await supabase
      .from('mcp_servers')
      .select('*')
      .in('id', bud.mcp_config.servers)
      .eq('workspace_id', workspaceId);

    if (!servers || servers.length === 0) {
      return { tools: [], mcpAvailable: false };
    }

    // Connect to first MCP server to get tools
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    
    const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
    const mcpClient = new Client({
      name: 'bud-chat-tools-client',
      version: '1.0.0'
    }, { capabilities: { tools: {} } });
    
    await mcpClient.connect(transport);
    const { tools: mcpTools } = await mcpClient.listTools();
    await mcpClient.close();

    return {
      tools: mcpTools || [],
      mcpAvailable: true
    };
  } catch (error) {
    console.warn('Failed to get MCP tools:', error);
    return { tools: [], mcpAvailable: false };
  }
}

// Helper to execute tool calls
async function executeMCPToolCalls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  toolCalls: ToolCall[],
  workspaceId: WorkspaceId,
  budId?: BudId
): Promise<Array<{ id: ToolCallId; output: object; error?: string }>> {
  if (!budId) {
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: 'No MCP configuration available' },
      error: 'No MCP configuration available'
    }));
  }

  try {
    const { data: bud } = await supabase
      .from('buds')
      .select('*, mcp_config')
      .eq('id', budId)
      .single();

    if (!bud?.mcp_config?.servers?.length) {
      throw new AppError(ErrorCode.MCP_SERVER_ERROR, 'No MCP servers configured');
    }

    const { data: servers } = await supabase
      .from('mcp_servers')
      .select('*')
      .in('id', bud.mcp_config.servers)
      .eq('workspace_id', workspaceId);

    if (!servers || servers.length === 0) {
      throw new AppError(ErrorCode.MCP_SERVER_ERROR, 'No MCP servers found');
    }

    // Connect to MCP server
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    
    const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
    const mcpClient = new Client({
      name: 'bud-chat-client',
      version: '1.0.0'
    }, { capabilities: { tools: {} } });
    
    await mcpClient.connect(transport);
    
    const results: Array<{ id: ToolCallId; output: object; error?: string }> = [];
    for (const toolCall of toolCalls) {
      try {
        const result = await mcpClient.callTool({
          name: toolCall.name,
          arguments: toolCall.args
        });
        
        let output = result.content;
        if (Array.isArray(output)) {
          output = output.map(block => 
            block.type === 'text' ? block.text : JSON.stringify(block)
          ).join('\n');
        }
        
        // Truncate extremely large outputs to prevent context overflow
        const MAX_TOOL_OUTPUT_LENGTH = 50000; // ~12.5k tokens
        if (typeof output === 'string' && output.length > MAX_TOOL_OUTPUT_LENGTH) {
          console.warn(`⚠️ Tool output truncated from ${output.length} to ${MAX_TOOL_OUTPUT_LENGTH} characters`);
          output = output.substring(0, MAX_TOOL_OUTPUT_LENGTH) + '\n\n[... Output truncated due to length ...]';
        }
        
        results.push({
          id: toolCall.id,
          output: { content: output }
        });
      } catch (toolError) {
        const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
        results.push({
          id: toolCall.id,
          output: { error: errorMessage },
          error: errorMessage
        });
      }
    }
    
    await mcpClient.close();
    return results;
    
  } catch (error) {
    const errorMessage = error instanceof AppError ? error.message : 'MCP execution failed';
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: errorMessage },
      error: errorMessage
    }));
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Authenticate user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw AppError.unauthorized();
    }

    // Parse request
    const body = await request.json() as ChatRequest;
    const mode = body.mode || 'new';
    
    // Initialize variables
    let model: string;
    let workspaceId: WorkspaceId;
    let budId: BudId | undefined;
    let conversationId: ConversationId;
    let eventLog: EventLog;
    let isNewConversation = false;
    let currentOrderKey: string | null = null;
    
    // Handle different modes
    if (mode === 'new') {
      // Validate new chat request
      const newChatBody = body as NewChatRequest;
      if (!newChatBody.messages?.length) {
        throw AppError.validation('Messages are required');
      }
      if (!newChatBody.workspaceId) {
        throw AppError.validation('Workspace ID is required');
      }
      
      workspaceId = await validateWorkspaceAccess(supabase, newChatBody.workspaceId, user.id);
      model = newChatBody.model || 'gpt-4o';
      budId = toBudIdOrNull(newChatBody.budId) || undefined;
      
      
      // Create new conversation
      const { conversationId: newConvId } = await createConversation(
        supabase,
        workspaceId,
        budId
      );
      conversationId = newConvId;
      isNewConversation = true;
      
      // Convert messages to events
      eventLog = new EventLog();
      for (const message of newChatBody.messages) {
        // Check if message is already an Event object
        if ('segments' in message && Array.isArray(message.segments)) {
          console.log('🔍 [CHAT API] Message is already an Event:', {
            role: message.role,
            segmentCount: message.segments.length,
            segments: message.segments
          });
          eventLog.addEvent(message as Event);
        } else {
          // Traditional message format
          console.log('🔍 [CHAT API] Converting message to event:', {
            role: message.role,
            contentLength: message.content?.length,
            contentPreview: message.content?.substring(0, 100) + '...'
          });
          
          if (message.role === 'system' || message.role === 'user') {
            eventLog.addEvent(createTextEvent(message.role, message.content));
          } else if (message.role === 'assistant' && message.content) {
            eventLog.addEvent(createTextEvent('assistant', message.content));
          }
        }
      }
      
      
    } else if (mode === 'continue' || mode === 'responses') {
      // Validate continue request
      const continueBody = body as ContinueChatRequest;
      if (!continueBody.conversationId) {
        throw AppError.validation('Conversation ID is required');
      }
      if (!continueBody.message) {
        throw AppError.validation('Message is required');
      }
      
      // Validate conversation access
      const { conversation, workspaceId: wsId } = await validateConversationAccess(
        supabase,
        continueBody.conversationId,
        user.id
      );
      
      conversationId = toConversationIdOrNull(continueBody.conversationId)!;
      workspaceId = wsId;
      budId = toBudIdOrNull(conversation.source_bud_id) || undefined;
      
      // Determine model from conversation -> bud -> default
      model = 'gpt-4o'; // Default fallback
      
      // Check if conversation has model override
      if (conversation.model_config_overrides?.model) {
        model = conversation.model_config_overrides.model;
      } else if (budId) {
        // Check bud's default model
        const { data: bud } = await supabase
          .from('buds')
          .select('default_json')
          .eq('id', budId)
          .single();
          
        if (bud?.default_json?.model) {
          model = bud.default_json.model;
        }
      }
      
      // Load existing events and get the last order key
      const existingEvents = await loadConversationEvents(supabase, conversationId);
      eventLog = new EventLog(existingEvents);
      
      // Get the last order key from the database
      const { data: lastEventData } = await supabase
        .from('events')
        .select('order_key')
        .eq('conversation_id', conversationId)
        .order('order_key', { ascending: false })
        .limit(1)
        .single();
      
      const lastOrderKey = lastEventData?.order_key || null;
      
      // Add new user message
      const userEvent = createTextEvent('user', continueBody.message);
      eventLog.addEvent(userEvent);
      
      // Save user message immediately
      currentOrderKey = await saveEvents(
        supabase,
        [userEvent],
        conversationId,
        lastOrderKey
      );
      
    } else {
      throw AppError.validation('Invalid mode');
    }
    
    // Get tools if bud is configured
    let tools: any[] = [];
    if (budId) {
      const { tools: budTools, mcpAvailable } = await getToolsForBud(supabase, budId, workspaceId);
      tools = budTools;
    }
    
    // Create provider and streaming format
    const provider = ProviderFactory.create(model);
    const streamingFormat = new StreamingFormat();
    
    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send conversation created event for new conversations
          if (isNewConversation && conversationId) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'conversationCreated',
              conversationId: conversationId
            })}\n\n`));
          }
          
          const maxIterations = 5;
          let iteration = 0;
          const allNewEvents: Event[] = [];
          
          while (iteration < maxIterations) {
            iteration++;
            
            // Check for pending tool calls
            const pendingToolCalls = eventLog.getUnresolvedToolCalls();
            if (pendingToolCalls.length > 0) {
              // Execute tool calls
              const toolResults = await executeMCPToolCalls(
                supabase,
                pendingToolCalls,
                workspaceId,
                budId
              );
              
              // Create and save tool result events
              const toolResultEvents: Event[] = [];
              for (const result of toolResults) {
                const event = createToolResultEvent(result.id, result.output);
                eventLog.addEvent(event);
                toolResultEvents.push(event);
                allNewEvents.push(event);
                
                // Stream tool result
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_result',
                  tool_id: result.id,
                  output: result.output,
                  error: result.error || null
                })}\n\n`));
                
                // Stream tool completion
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_complete',
                  tool_id: result.id,
                  content: result.error ? '❌ Tool failed' : '✅ Tool completed'
                })}\n\n`));
              }
              
              // Save tool results if not a new conversation
              if (!isNewConversation) {
                currentOrderKey = await saveEvents(supabase, toolResultEvents, conversationId, currentOrderKey);
              }
              
              continue;
            }
            
            // Get MCP config if bud is configured
            let mcpConfig = undefined;
            if (budId) {
              const { data: bud } = await supabase
                .from('buds')
                .select('mcp_config')
                .eq('id', budId)
                .single();
                
              if (bud?.mcp_config) {
                // Separate local and remote servers based on transport type
                const serverIds = bud.mcp_config.servers || [];
                if (serverIds.length > 0) {
                  const { data: servers } = await supabase
                    .from('mcp_servers')
                    .select('id, name, endpoint, transport_type')
                    .in('id', serverIds)
                    .eq('workspace_id', workspaceId);
                  
                  if (servers) {
                    const localServers = servers
                      .filter(s => s.transport_type === 'stdio')
                      .map(s => s.id);
                    
                    const remoteServers = servers
                      .filter(s => s.transport_type === 'http' || s.transport_type === 'websocket')
                      .map(s => ({
                        server_label: s.name,
                        server_url: s.endpoint,
                        require_approval: 'never' as const, // 'never' to allow auto-execution
                        allowed_tools: undefined as string[] | undefined,
                        headers: undefined as Record<string, string> | undefined
                      }));
                    
                    mcpConfig = {
                      ...bud.mcp_config,
                      servers: localServers, // Only local servers in the servers array
                      remote_servers: remoteServers // Remote servers in separate array
                    };
                    
                  }
                } else {
                  mcpConfig = bud.mcp_config;
                }
              }
            }
            
            // Prepare chat request
            const chatRequest: UnifiedChatRequest = {
              events: eventLog.getEvents(),
              model,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              tools: tools.length > 0 ? tools : undefined,
              mcpConfig,
              conversationId,
              workspaceId,
              budId,
              reasoningEffort: (body as ResponsesChatRequest).reasoningEffort
            };
            
            // Stream the response
            let currentEvent: Event | null = null;
            let hasToolCalls = false;
            let eventStarted = false;
            
            for await (const streamEvent of provider.stream(chatRequest)) {
              switch (streamEvent.type) {
                case 'event':
                  if (streamEvent.data?.event) {
                    currentEvent = streamEvent.data.event;
                    eventLog.addEvent(currentEvent);
                    allNewEvents.push(currentEvent);
                    hasToolCalls = currentEvent.segments.some(s => s.type === 'tool_call');
                    
                    // Send event start
                    if (!eventStarted) {
                      controller.enqueue(encoder.encode(
                        streamingFormat.formatSSE(
                          streamingFormat.eventStart(currentEvent)
                        )
                      ));
                      eventStarted = true;
                    }
                    
                    // Process segments from the event
                    for (const segment of currentEvent.segments) {
                      if (segment.type === 'tool_call') {
                        // Emit tool_start
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: 'tool_start',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          content: `🔧 *Using tool: ${segment.name}*\n`,
                          hideProgress: true
                        })}\n\n`));
                        
                        // Emit tool_finalized with args
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: 'tool_finalized',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          args: segment.args
                        })}\n\n`));
                      }
                    }
                  }
                  break;
                  
                case 'segment':
                  if (streamEvent.data?.segment) {
                    const segment = streamEvent.data.segment;
                    
                    if (segment.type === 'text' && segment.text) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'token',
                        content: segment.text,
                        hideProgress: true
                      })}\n\n`));
                    } else if (segment.type === 'tool_call') {
                      hasToolCalls = true;
                      
                      // Check if this is a partial tool call (during streaming) or complete
                      const hasCompleteArgs = segment.args && Object.keys(segment.args).length > 0;
                      
                      if (!hasCompleteArgs) {
                        // Tool just started - emit tool_start
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: 'tool_start',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          content: `🔧 *Using tool: ${segment.name}*\n`,
                          hideProgress: true
                        })}\n\n`));
                      } else {
                        // Tool is complete - emit both start and finalized
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: 'tool_start',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          content: `🔧 *Using tool: ${segment.name}*\n`,
                          hideProgress: true
                        })}\n\n`));
                        
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                          type: 'tool_finalized',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          args: segment.args
                        })}\n\n`));
                      }
                    } else if (segment.type === 'reasoning') {
                      // Send reasoning segment
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: 'reasoning_start',
                        item_id: segment.id,
                        output_index: segment.output_index,
                        sequence_number: segment.sequence_number
                      })}\n\n`));
                      
                      // Send reasoning content if available
                      if (segment.parts && segment.parts.length > 0) {
                        for (const part of segment.parts) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                            type: 'reasoning_content',
                            item_id: segment.id,
                            content: part.text,
                            summary_index: part.summary_index
                          })}\n\n`));
                        }
                      }
                    }
                  }
                  break;
                  
                case 'reasoning_summary_part_added':
                  // Handle reasoning part added events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'reasoning_summary_part_added',
                      item_id: streamEvent.data.item_id,
                      summary_index: streamEvent.data.summary_index,
                      part: streamEvent.data.part,
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'reasoning_summary_text_delta':
                  // Handle reasoning text delta events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'reasoning_summary_text_delta',
                      item_id: streamEvent.data.item_id,
                      summary_index: streamEvent.data.summary_index,
                      delta: streamEvent.data.delta,
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'reasoning_summary_part_done':
                  // Handle reasoning part done events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'reasoning_summary_part_done',
                      item_id: streamEvent.data.item_id,
                      summary_index: streamEvent.data.summary_index,
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'reasoning_complete':
                  // Handle reasoning complete events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'reasoning_complete',
                      item_id: streamEvent.data.item_id,
                      parts: streamEvent.data.parts,
                      combined_text: streamEvent.data.combined_text,
                      output_index: streamEvent.data.output_index,
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'mcp_tool_start':
                  // Handle MCP tool start events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'mcp_tool_start',
                      tool_id: streamEvent.data.tool_id,
                      tool_name: streamEvent.data.tool_name,
                      server_label: streamEvent.data.server_label,
                      display_name: streamEvent.data.display_name,
                      server_type: streamEvent.data.server_type,
                      output_index: streamEvent.data.output_index,
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'mcp_tool_arguments_delta':
                  // Handle MCP tool arguments delta events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'mcp_tool_arguments_delta',
                      tool_id: streamEvent.data.tool_id,
                      delta: streamEvent.data.delta
                    })}\n\n`));
                  }
                  break;
                  
                case 'mcp_tool_finalized':
                  // Handle MCP tool finalized events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'mcp_tool_finalized',
                      tool_id: streamEvent.data.tool_id,
                      args: streamEvent.data.args
                    })}\n\n`));
                  }
                  break;
                  
                case 'mcp_tool_complete':
                  // Handle MCP tool complete events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'mcp_tool_complete',
                      tool_id: streamEvent.data.tool_id,
                      output: streamEvent.data.output,
                      error: streamEvent.data.error,
                      sequence_number: streamEvent.data.sequence_number,
                      output_index: streamEvent.data.output_index
                    })}\n\n`));
                  }
                  break;
                  
                case 'progress_update':
                  // Handle progress update events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'progress_update',
                      activity: streamEvent.data.activity,
                      server_label: streamEvent.data.server_label,
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'progress_hide':
                  // Handle progress hide events
                  if (streamEvent.data) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                      type: 'progress_hide',
                      sequence_number: streamEvent.data.sequence_number
                    })}\n\n`));
                  }
                  break;
                  
                case 'error':
                  throw new Error(streamEvent.data?.error || 'Stream error');
                  
                case 'done':
                  if (currentEvent && !isNewConversation) {
                    // Save the assistant response
                    currentOrderKey = await saveEvents(supabase, [currentEvent], conversationId, currentOrderKey);
                  }
                  
                  // For Responses API, tool calls are handled internally by OpenAI
                  // so we should exit the loop after the stream completes
                  if (provider.name === 'openai-responses' || !hasToolCalls) {
                    iteration = maxIterations;
                  }
                  break;
              }
            }
          }
          
          // Save all events if new conversation
          if (isNewConversation) {
            currentOrderKey = await saveEvents(supabase, eventLog.getEvents(), conversationId);
            
            // Generate title in background
            generateConversationTitleInBackground(
              conversationId,
              eventLog.getEvents(),
              supabase
            ).catch(console.error);
          }
          
          // Send completion
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'conversationId',
            conversationId
          })}\n\n`));
          
          const finalContent = allNewEvents
            .filter(e => e.role === 'assistant')
            .flatMap(e => e.segments)
            .filter(s => s.type === 'text')
            .map(s => (s as any).text)
            .join('');
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'complete',
            content: finalContent
          })}\n\n`));
          
          controller.enqueue(encoder.encode(
            streamingFormat.formatSSE(streamingFormat.done())
          ));
          
          controller.close();
          
        } catch (error) {
          console.error('Stream processing error:', error);
          
          // Send error in the format the frontend expects
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          })}\n\n`));
          
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    return handleApiError(error);
  }
}