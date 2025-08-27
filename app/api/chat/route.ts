// Unified Chat API - Consolidates all chat endpoints using new abstractions
import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { ProviderFactory, UnifiedChatRequest, UnifiedTool } from '@/lib/providers/unified';
import { StreamingFormat } from '@/lib/events';
// import { EventConverter } from '@/lib/events'; // Not currently used
import { AppError, ErrorCode, handleApiError } from '@/lib/errors';
import { 
  EventLog, 
  createTextEvent, 
  createToolResultEvent,
  // createMixedEvent, // Not currently used
  Event,
  DatabaseEvent,
  ToolCall
} from '@/lib/types/events';
import { 
  WorkspaceId, 
  BudId, // Used in getToolsForBud function 
  ConversationId,
  toWorkspaceId,
  toBudIdOrNull,
  toConversationIdOrNull,
  generateConversationId,
  // generateEventId, // Not currently used
  ToolCallId
} from '@/lib/types/branded';
import { Bud, Database } from '@/lib/types';
import { generateKeyBetween } from 'fractional-indexing';
import { generateConversationTitleInBackground } from '@/lib/chat/shared';

// Request types
interface ChatRequestBase {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
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

type ChatRequest = NewChatRequest | ContinueChatRequest;

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
): Promise<{ conversation: Database['public']['Tables']['conversations']['Row'] & { workspace: Database['public']['Tables']['workspaces']['Row'] }; workspaceId: WorkspaceId }> {
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
  
  return orderKey ?? null;
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
): Promise<{ tools: UnifiedTool[]; mcpAvailable: boolean }> {
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
          arguments: toolCall.args as Record<string, unknown>
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
          eventLog.addEvent(message as unknown as Event);
        } else {
          // Traditional message format
          
          if (message.role === 'system' || message.role === 'user') {
            eventLog.addEvent(createTextEvent(message.role, message.content));
          } else if (message.role === 'assistant' && message.content) {
            eventLog.addEvent(createTextEvent('assistant', message.content));
          }
        }
      }
      
      
    } else if (mode === 'continue') {
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
      const modelOverrides = conversation.model_config_overrides as { model?: string } | null;
      if (modelOverrides?.model) {
        model = modelOverrides.model;
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
    let tools: UnifiedTool[] = [];
    if (budId) {
      const { tools: budTools } = await getToolsForBud(supabase, budId, workspaceId);
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
          // Track closed state to avoid enqueueing after close
          let isClosed = false;
          const send = (obj: unknown) => {
            if (isClosed) return;
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            } catch {
              isClosed = true;
            }
          };
          const sendSSE = (s: string) => {
            if (isClosed) return;
            try {
              controller.enqueue(encoder.encode(s));
            } catch {
              isClosed = true;
            }
          };
          // Send conversation created event for new conversations
          if (isNewConversation && conversationId) {
            send({ type: 'conversationCreated', conversationId });
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
                send({
                  type: 'tool_result',
                  tool_id: result.id,
                  output: result.output,
                  error: result.error || null
                });
                // Stream tool completion
                send({
                  type: 'tool_complete',
                  tool_id: result.id,
                  content: result.error ? '❌ Tool failed' : '✅ Tool completed'
                });
              }
              
              // Save tool results if not a new conversation
              if (!isNewConversation) {
                currentOrderKey = await saveEvents(supabase, toolResultEvents, conversationId, currentOrderKey);
              }
              
              continue;
            }
            
            // Get MCP config and built-in tools config if bud is configured
            let mcpConfig = undefined;
            let builtInToolsConfig = undefined;
            let reasoningConfig = undefined;
            let textGenerationConfig = undefined;
            if (budId) {
              const { data: bud } = await supabase
                .from('buds')
                .select('mcp_config, builtin_tools_config, default_json')
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
              
              // Handle built-in tools config
              if (bud?.builtin_tools_config) {
                builtInToolsConfig = bud.builtin_tools_config;
              }
              
              // Handle reasoning and text generation config from default_json
              if (bud?.default_json) {
                const budConfig = bud.default_json as Partial<import('@/lib/types').BudConfig>;
                if (budConfig.reasoningConfig) {
                  reasoningConfig = budConfig.reasoningConfig;
                }
                if (budConfig.textGenerationConfig) {
                  textGenerationConfig = budConfig.textGenerationConfig;
                }
              }
            }
            
            // Apply conversation overrides (for continue mode)
            if (!isNewConversation && conversationId) {
              console.log('📋 [Chat API] Checking for conversation overrides:', { conversationId });
              // Load conversation overrides
              const { data: conversationData, error: convError } = await supabase
                .from('conversations')
                .select('builtin_tools_config_overrides, model_config_overrides')
                .eq('id', conversationId)
                .single();
              
              if (!convError && conversationData) {
                // Apply built-in tools config overrides
                if (conversationData.builtin_tools_config_overrides) {
                  const originalConfig = builtInToolsConfig;
                  builtInToolsConfig = conversationData.builtin_tools_config_overrides as import('@/lib/types').BuiltInToolsConfig; // Cast since it's JSONB
                  console.log('📋 [Chat API] Applied built-in tools conversation overrides:', {
                    original: originalConfig,
                    override: builtInToolsConfig
                  });
                }
                
                // Apply reasoning and text generation config overrides
                if (conversationData.model_config_overrides) {
                  const modelOverrides = conversationData.model_config_overrides as {
                    reasoningConfig?: import('@/lib/types').ReasoningConfig;
                    textGenerationConfig?: import('@/lib/types').TextGenerationConfig;
                  };
                  if (modelOverrides.reasoningConfig) {
                    reasoningConfig = modelOverrides.reasoningConfig;
                    console.log('📋 [Chat API] Applied reasoning config override:', reasoningConfig);
                  }
                  if (modelOverrides.textGenerationConfig) {
                    textGenerationConfig = modelOverrides.textGenerationConfig;
                    console.log('📋 [Chat API] Applied text generation config override:', textGenerationConfig);
                  }
                }
              } else {
                console.log('📋 [Chat API] No conversation overrides found:', {
                  convError,
                  hasOverrides: false
                });
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
              builtInToolsConfig,
              conversationId,
              workspaceId,
              budId,
              reasoningConfig,
              textGenerationConfig,
              reasoningEffort: body.reasoningEffort // Legacy support
            };
            
            
            // Stream the response
            let currentEvent: Event | null = null;
            let hasToolCalls = false;
            let eventStarted = false;
            const startedTools = new Set<string>(); // Track which tools we've already started
            
            for await (const streamEvent of provider.stream(chatRequest)) {
              // Cast to any to handle extended event types from OpenAI Responses API
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const extendedEvent = streamEvent as any;
              switch (extendedEvent.type) {
                case 'event':
                  if (extendedEvent.data?.event) {
                    currentEvent = extendedEvent.data.event;
                    if (currentEvent) {
                      eventLog.addEvent(currentEvent);
                      allNewEvents.push(currentEvent);
                      hasToolCalls = currentEvent.segments.some(s => s.type === 'tool_call');
                      
                      // Send event start
                      if (!eventStarted) {
                        sendSSE(
                          streamingFormat.formatSSE(
                            streamingFormat.eventStart(currentEvent)
                          )
                        );
                        eventStarted = true;
                      }
                      
                      // Process segments from the event
                      for (const segment of currentEvent.segments) {
                        if (segment.type === 'tool_call') {
                          
                          // Emit tool_start
                          send({
                            type: 'tool_start',
                            tool_id: segment.id,
                            tool_name: segment.name,
                            content: `🔧 *Using tool: ${segment.name}*\n`,
                            hideProgress: true
                          });
                          
                          // Emit tool_finalized with args
                          send({
                            type: 'tool_finalized',
                            tool_id: segment.id,
                            tool_name: segment.name,
                            args: segment.args
                          });
                        }
                      }
                    }
                  }
                  break;
                  
                case 'segment':
                  if (extendedEvent.data?.segment) {
                    const segment = extendedEvent.data.segment;
                    
                    if (segment.type === 'text' && segment.text) {
                      send({
                        type: 'token',
                        content: segment.text,
                        hideProgress: true
                      });
                    } else if (segment.type === 'tool_call') {
                      hasToolCalls = true;
                      
                      
                      // Check if this is a partial tool call (during streaming) or complete
                      const hasCompleteArgs = segment.args && Object.keys(segment.args).length > 0;
                      
                      if (!hasCompleteArgs) {
                        // Tool just started - emit tool_start
                        send({
                          type: 'tool_start',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          content: `🔧 *Using tool: ${segment.name}*\n`,
                          hideProgress: true
                        });
                      } else {
                        // Tool is complete - emit both start and finalized
                        send({
                          type: 'tool_start',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          content: `🔧 *Using tool: ${segment.name}*\n`,
                          hideProgress: true
                        });
                        
                        send({
                          type: 'tool_finalized',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          args: segment.args
                        });
                      }
                    } else if (segment.type === 'reasoning') {
                      // Signal reasoning segment start (for UI overlay gating)
                      send({
                        type: 'reasoning_start',
                        item_id: segment.id,
                        output_index: segment.output_index,
                        sequence_number: segment.sequence_number
                      });

                      // Emit standardized reasoning part events so the frontend can stream per-part
                      if (Array.isArray(segment.parts) && segment.parts.length > 0) {
                        for (const part of segment.parts) {
                          // Part added (with initial text if provided)
                          send({
                            type: 'reasoning_summary_part_added',
                            item_id: segment.id,
                            summary_index: part.summary_index,
                            part: { type: 'summary_text', text: part.text },
                            sequence_number: part.sequence_number ?? segment.sequence_number
                          });
                          // Mark part done if complete
                          if (part.is_complete) {
                            send({
                              type: 'reasoning_summary_part_done',
                              item_id: segment.id,
                              summary_index: part.summary_index,
                              sequence_number: part.sequence_number ?? segment.sequence_number
                            });
                          }
                        }
                      }
                    }
                  }
                  break;
                  
                case 'reasoning_summary_part_added':
                  // Handle reasoning part added events
                  if (extendedEvent.data) {
                    send({
                      type: 'reasoning_summary_part_added',
                      item_id: extendedEvent.data.item_id,
                      summary_index: extendedEvent.data.summary_index,
                      part: extendedEvent.data.part,
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'reasoning_summary_text_delta':
                  // Handle reasoning text delta events
                  if (extendedEvent.data) {
                    send({
                      type: 'reasoning_summary_text_delta',
                      item_id: extendedEvent.data.item_id,
                      summary_index: extendedEvent.data.summary_index,
                      delta: extendedEvent.data.delta,
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'reasoning_summary_part_done':
                  // Handle reasoning part done events
                  if (extendedEvent.data) {
                    send({
                      type: 'reasoning_summary_part_done',
                      item_id: extendedEvent.data.item_id,
                      summary_index: extendedEvent.data.summary_index,
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'reasoning_complete':
                  // Handle reasoning complete events
                  if (extendedEvent.data) {
                    send({
                      type: 'reasoning_complete',
                      item_id: extendedEvent.data.item_id,
                      parts: extendedEvent.data.parts,
                      combined_text: extendedEvent.data.combined_text,
                      output_index: extendedEvent.data.output_index,
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'mcp_tool_start':
                  // Handle MCP tool start events
                  if (extendedEvent.data) {
                    send({
                      type: 'mcp_tool_start',
                      tool_id: extendedEvent.data.tool_id,
                      tool_name: extendedEvent.data.tool_name,
                      server_label: extendedEvent.data.server_label,
                      display_name: extendedEvent.data.display_name,
                      server_type: extendedEvent.data.server_type,
                      output_index: extendedEvent.data.output_index,
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'mcp_tool_arguments_delta':
                  // Handle MCP tool arguments delta events
                  if (extendedEvent.data) {
                    send({
                      type: 'mcp_tool_arguments_delta',
                      tool_id: extendedEvent.data.tool_id,
                      delta: extendedEvent.data.delta
                    });
                  }
                  break;
                  
                case 'mcp_tool_finalized':
                  // Handle MCP tool finalized events
                  if (extendedEvent.data) {
                    send({
                      type: 'mcp_tool_finalized',
                      tool_id: extendedEvent.data.tool_id,
                      args: extendedEvent.data.args
                    });
                  }
                  break;
                  
                case 'mcp_tool_complete':
                  // Handle MCP tool complete events
                  if (extendedEvent.data) {
                    // First emit as tool_result for consistent frontend handling
                    send({
                      type: 'tool_result',
                      tool_id: extendedEvent.data.tool_id,
                      output: extendedEvent.data.output,
                      error: extendedEvent.data.error
                    });
                    
                    // Emit tool_complete to match the pattern used elsewhere
                    send({
                      type: 'tool_complete',
                      tool_id: extendedEvent.data.tool_id,
                      content: extendedEvent.data.error ? '❌ Tool failed' : '✅ Tool completed'
                    });
                    
                    // Then emit the mcp_tool_complete event for any specific handling
                    send({
                      type: 'mcp_tool_complete',
                      tool_id: extendedEvent.data.tool_id,
                      output: extendedEvent.data.output,
                      error: extendedEvent.data.error,
                      sequence_number: extendedEvent.data.sequence_number,
                      output_index: extendedEvent.data.output_index
                    });
                  }
                  break;
                  
                case 'progress_update':
                  // Handle progress update events
                  if (extendedEvent.data) {
                    send({
                      type: 'progress_update',
                      activity: extendedEvent.data.activity,
                      server_label: extendedEvent.data.server_label,
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'web_search_call_in_progress':
                case 'web_search_call_searching':
                case 'web_search_call_completed':
                case 'code_interpreter_call_in_progress':
                case 'code_interpreter_call_interpreting':
                case 'code_interpreter_call_completed':
                case 'code_interpreter_call_code_delta':
                case 'code_interpreter_call_code_done':
                  // Handle built-in tool events
                  send({
                    type: extendedEvent.type,
                    item_id: extendedEvent.data?.item_id,
                    output_index: extendedEvent.data?.output_index,
                    sequence_number: extendedEvent.data?.sequence_number,
                    delta: extendedEvent.data?.delta,
                    code: extendedEvent.data?.code
                  });
                  break;
                  
                case 'progress_hide':
                  // Handle progress hide events
                  if (extendedEvent.data) {
                    send({
                      type: 'progress_hide',
                      sequence_number: extendedEvent.data.sequence_number
                    });
                  }
                  break;
                  
                case 'error':
                  throw new Error(extendedEvent.data?.error || 'Stream error');
                  
                case 'done':
                  console.log('🔚 [Chat API] Processing done event from provider');
                  
                  // 1) Persist any pending events first
                  if (isNewConversation) {
                    console.log('🔚 [Chat API] Saving events for new conversation...');
                    const saveStartTime = Date.now();
                    try {
                      currentOrderKey = await saveEvents(supabase, eventLog.getEvents(), conversationId);
                      console.log('🔚 [Chat API] New conversation events saved in', Date.now() - saveStartTime, 'ms');
                      
                      // Generate title in background
                      generateConversationTitleInBackground(
                        conversationId,
                        eventLog.getEvents(),
                        supabase
                      ).catch(console.error);
                    } catch (error) {
                      console.error('🔴 [Chat API] Error saving new conversation events:', error);
                    }
                  } else if (currentEvent) {
                    console.log('🔚 [Chat API] Saving events for existing conversation...');
                    const saveStartTime = Date.now();
                    try {
                      await saveEvents(supabase, [currentEvent], conversationId, currentOrderKey);
                      console.log('🔚 [Chat API] Existing conversation events saved in', Date.now() - saveStartTime, 'ms');
                    } catch (error) {
                      console.error('🔴 [Chat API] Error saving existing conversation events:', error);
                    }
                  }

                  // 2) Emit message_final before complete so clients can commit canonical event
                  if (currentEvent) {
                    try {
                      if (process.env.NODE_ENV !== 'production') {
                        console.log('[API] emitting message_final to client', { eventId: currentEvent.id });
                      }
                      send({ type: 'message_final', event: currentEvent });
                    } catch (e) {
                      console.warn('⚠️ [Chat API] Failed to emit message_final:', e);
                    }
                  }

                  // 3) Emit complete event after message_final
                  if (process.env.NODE_ENV !== 'production') {
                    console.log('[API] emitting complete to client');
                  }
                  sendSSE(streamingFormat.formatSSE(streamingFormat.done()));
                  console.log('🔚 [Chat API] Sent complete event to frontend');

                  // 4) Close connection
                  controller.close();
                  isClosed = true;
                  console.log('🔚 [Chat API] Closed connection, frontend should be unblocked');
                  
                  // For Responses API, tool calls are handled internally by OpenAI
                  // so we should exit the loop after the stream completes
                  if (provider.name === 'openai-responses' || !hasToolCalls) {
                    iteration = maxIterations;
                  }
                  console.log('🔚 [Chat API] Done event processed, exiting stream processing');
                  return; // Exit the stream processing entirely
                  break;
              }
            }
          }
          
          // Send completion
          send({ type: 'conversationId', conversationId });
          
          const finalContent = allNewEvents
            .filter(e => e.role === 'assistant')
            .flatMap(e => e.segments)
            .filter(s => s.type === 'text')
            .map(s => s.type === 'text' ? s.text : '')
            .join('');
          
          // Note: Final completion and done events are now handled immediately in the 'done' case above
          // This ensures the frontend gets unblocked as soon as the provider signals completion
          
        } catch (error) {
          console.error('Stream processing error:', error);
          
          // Send error in the format the frontend expects
          send({
            type: 'error',
            error: error instanceof Error ? error.message : String(error)
          });
          controller.close();
          // Mark closed so later accidental sends are ignored
          // (provider streams may continue emitting briefly)
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _ = (isClosed = true);
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
