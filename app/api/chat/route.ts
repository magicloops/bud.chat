// Unified Chat API - Consolidates all chat endpoints using new abstractions
import { createClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';
import { ProviderFactory, UnifiedChatRequest, UnifiedTool } from '@budchat/providers';
import { StreamingFormat } from '@budchat/events';
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
} from '@budchat/events';
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
} from '@budchat/events';
import { Bud, Database } from '@/lib/types';
import { generateKeyBetween } from 'fractional-indexing';
import { loadConversationEvents as repoLoadConversationEvents, saveEvents as repoSaveEvents, createConversation as repoCreateConversation, getPostgrestErrorCode as repoGetPostgrestErrorCode, updateToolSegmentTiming as repoUpdateToolSegmentTiming, updateReasoningSegmentTiming as repoUpdateReasoningSegmentTiming, getLastOrderKey as repoGetLastOrderKey } from '@budchat/data';
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
const loadConversationEvents = repoLoadConversationEvents as (supabase: Awaited<ReturnType<typeof createClient>>, conversationId: ConversationId) => Promise<Event[]>;

// Internal helper: safely extract Postgrest error code without using `any`.
const getPostgrestErrorCode = repoGetPostgrestErrorCode;

// Helper to save events
const saveEvents = repoSaveEvents as (supabase: Awaited<ReturnType<typeof createClient>>, events: Event[], conversationId: ConversationId, previousOrderKey?: string | null) => Promise<string | null>;

// Helper to create a new conversation
const createConversation = repoCreateConversation as (supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: WorkspaceId, budId?: BudId) => Promise<{ conversationId: ConversationId; bud?: Bud }>;

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
  // debug logs removed
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
    // debug logs removed

    const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
    const mcpClient = new Client({
      name: 'bud-chat-client',
      version: '1.0.0'
    }, { capabilities: { tools: {} } });
    
    await mcpClient.connect(transport);
    
    const results: Array<{ id: ToolCallId; output: object; error?: string }> = [];
    for (const toolCall of toolCalls) {
      // debug logs removed
      
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
        // debug logs removed
      } catch (toolError) {
        const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
        results.push({
          id: toolCall.id,
          output: { error: errorMessage },
          error: errorMessage
        });
        // debug logs removed
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
      // Incremental persistence for new chats: persist initial messages immediately
      try {
        currentOrderKey = await saveEvents(
          supabase,
          eventLog.getEvents(),
          conversationId,
          currentOrderKey
        );
      } catch (error) {
        console.error('🔴 [Chat API] Error saving initial events for new conversation:', error);
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
      
      // Get the last order key from the repository
      const lastOrderKey = await repoGetLastOrderKey(supabase, conversationId);
      
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
    // Identify providers that self-assemble text into currentEvent during streaming
    // to avoid double-assembling in the route.
    const providerName = (provider as any)?.name as string | undefined;
    const isSelfAssemblingProvider = providerName === 'openai-responses' || providerName === 'openai-chat';
    const streamingFormat = new StreamingFormat();
    
    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Track closed state to avoid enqueueing after close
          let isClosed = false;
          // Track last appended text sequence to avoid duplicate appends at same position
          let lastTextSeq: number | null = null;
          // Debug: gated logging helpers and counters for assistant text assembly
          // Silence verbose token assembly logs in production
          const isTextDbg = () => false;
          const dbgText = (..._args: unknown[]) => {};
          let textRecvBySeq: Map<number, number> = new Map();
          let textRecvTotal = 0;
          let textAppendsMade = 0;
          // Track tool timing across local execution phases
          const toolStartTimes = new Map<string, { eventId: string; started_at: number }>();
          const recordToolStart = (toolId: string, eventId: string, startedAt?: number) => {
            const now = Date.now();
            const started_at = startedAt || now;
            if (!toolStartTimes.has(toolId)) {
              toolStartTimes.set(toolId, { eventId, started_at });
            }
            return started_at;
          };
          const markToolCompletedInDB = async (toolId: string, completedAt?: number) => {
            try {
              const entry = toolStartTimes.get(toolId);
              // Fallback: find event containing this tool_call from the in-memory log
              let eventId = entry?.eventId;
              if (!eventId) {
                const containing = eventLog.getEvents().find(e => e.role === 'assistant' && e.segments.some(s => s.type === 'tool_call' && (s as any).id === toolId));
                eventId = containing?.id || undefined;
              }
              if (!eventId) return;
              const nowTs = completedAt || Date.now();
              const startedAt = entry?.started_at;
              await repoUpdateToolSegmentTiming(supabase, eventId, toolId, startedAt, nowTs);
            } catch (e) {
              console.warn('⚠️ [Chat API] Failed to persist tool timing:', { toolId, error: (e as Error)?.message });
            }
          };
          const markReasoningCompletedInDB = async (eventId: string, reasoningId: string, startedAt?: number, completedAt?: number) => {
            try {
              const nowTs = completedAt || Date.now();
              await repoUpdateReasoningSegmentTiming(supabase, eventId, reasoningId, startedAt, nowTs);
            } catch (e) {
              console.warn('⚠️ [Chat API] Failed to persist reasoning timing:', { eventId, reasoningId, error: (e as Error)?.message });
            }
          };
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
          
          const maxIterations = 30; // Increased to support longer multi-tool sequences
          let iteration = 0;
          const allNewEvents: Event[] = [];
          
          while (iteration < maxIterations) {
            iteration++;
            console.log('🔁 [Chat API] Iteration start', { iteration, maxIterations });
            try {
              const debugUnresolvedAtTop = eventLog.getUnresolvedToolCalls();
              console.log(`🔎 [Chat API] Iteration ${iteration}/${maxIterations} — unresolved tool calls at top:`, debugUnresolvedAtTop.map(c => c.id));
            } catch {}
            
            // Check for pending tool calls
            const pendingToolCalls = eventLog.getUnresolvedToolCalls();
            if (pendingToolCalls.length > 0) {
              console.log('🔧 [Chat API] Executing pending tool calls:', pendingToolCalls.map(tc => ({ id: tc.id, name: tc.name })));
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
                console.log('✅ [Chat API] Added tool_result event to EventLog:', { tool_id: result.id, hasError: !!result.error });
                
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
                // Persist timing by marking the originating assistant segment completed
                try { await markToolCompletedInDB(String(result.id)); } catch {}
              }
              console.log('💾 [Chat API] Tool results prepared; count:', toolResultEvents.length);
              
              // Incrementally save tool results (both new and continue modes)
              currentOrderKey = await saveEvents(supabase, toolResultEvents, conversationId, currentOrderKey);
              
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
            try {
              const unresolvedPreCall = eventLog.getUnresolvedToolCalls();
              console.log('📤 [Chat API] Preparing provider call — unresolved before call:', unresolvedPreCall.map(c => c.id));
              if (provider.name === 'Anthropic') {
                const { EventLog: EventLogClass } = await import('@budchat/events');
                const ev = new EventLogClass(chatRequest.events);
                // Summarize the final few Anthropic messages
                const msgs = (ev as any).toProviderMessages('anthropic') as any[];
                const take = Math.min(6, msgs.length);
                const summary = msgs.slice(msgs.length - take).map((m, idx) => ({
                  idx: msgs.length - take + idx,
                  role: m.role,
                  blocks: Array.isArray(m.content) ? m.content.map((b: any) => b.type) : [],
                  tool_use_ids: Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'tool_use').map((b: any) => b.id) : [],
                  tool_result_ids: Array.isArray(m.content) ? m.content.filter((b: any) => b.type === 'tool_result').map((b: any) => b.tool_use_id) : []
                }));
                console.log('🧾 [Chat API] Anthropic message summary (tail):', summary);
              }
            } catch (e) {
              console.warn('⚠️ [Chat API] Failed to build debug summary for provider messages:', e);
            }
            
            
            // Stream the response
            let currentEvent: Event | null = null;
            let hasToolCalls = false;
            const startedTools = new Set<string>(); // Track which tools we've already started
            let breakProviderStreamForTools = false; // When true, exit provider stream to execute tools
            
            // Helpers to keep the server-side currentEvent in sync for message_final
            const upsertReasoningPart = (ev: Event | null, itemId: string, partIndex: number, textDelta?: string, opts?: { sequence_number?: number; complete?: boolean }) => {
              if (!ev || !itemId || partIndex === undefined || partIndex === null) return;
              // find or create reasoning segment
              let idx = ev.segments.findIndex(s => s.type === 'reasoning' && (s as any).id === itemId);
              if (idx === -1) {
                const seg: any = { type: 'reasoning', id: itemId, output_index: 0, sequence_number: opts?.sequence_number ?? 0, parts: [], streaming: true, started_at: Date.now() };
                ev.segments.push(seg);
                idx = ev.segments.length - 1;
              }
              const seg = ev.segments[idx] as any;
              const parts: any[] = Array.isArray(seg.parts) ? seg.parts : (seg.parts = []);
              const pIdx = parts.findIndex(p => p.summary_index === partIndex);
              if (pIdx === -1) {
                parts.push({ summary_index: partIndex, type: 'summary_text', text: textDelta || '', sequence_number: opts?.sequence_number ?? 0, is_complete: !!opts?.complete, created_at: Date.now() });
              } else {
                const prev = parts[pIdx];
                const nextText = textDelta ? (prev.text || '') + textDelta : prev.text || '';
                parts[pIdx] = { ...prev, text: nextText, is_complete: opts?.complete ?? prev.is_complete, sequence_number: opts?.sequence_number ?? prev.sequence_number };
              }
              // keep parts sorted
              parts.sort((a, b) => a.summary_index - b.summary_index);
            };

            for await (const streamEvent of provider.stream(chatRequest)) {
              // Cast to any to handle extended event types from OpenAI Responses API
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const extendedEvent = streamEvent as any;
              // Lightweight debug for terminal and start events
              if (extendedEvent?.type === 'event') console.log('🟢 [Chat API] event received from provider');
              if (extendedEvent?.type === 'done') console.log('🛑 [Chat API] done received from provider');
              switch (extendedEvent.type) {
                case 'event':
                  if (extendedEvent.data?.event) {
                    // If we already had a currentEvent streaming, signal its completion before starting a new one
                    if (currentEvent) {
                      try {
                        sendSSE(
                          streamingFormat.formatSSE(
                            streamingFormat.eventComplete(currentEvent)
                          )
                        );
                      } catch (e) {
                        console.warn('⚠️ [Chat API] Failed to emit prior event_complete:', e);
                      }
                    }
                    currentEvent = extendedEvent.data.event;
                    // Reset text sequence guard and counters for new assistant event
                    lastTextSeq = null;
                    textRecvBySeq = new Map();
                    textRecvTotal = 0;
                    textAppendsMade = 0;
                    try {
                      const existing = currentEvent?.segments?.find((s: any) => s.type === 'text') as any;
                      const existingLen = existing ? (existing.text || '').length : 0;
                      dbgText('start_turn', { eventId: currentEvent?.id, existingLen });
                    } catch {}
                    if (currentEvent) {
                      eventLog.addEvent(currentEvent);
                      allNewEvents.push(currentEvent);
                      hasToolCalls = currentEvent.segments.some(s => s.type === 'tool_call');
                      // Always emit event_start for each new assistant event (each turn)
                      sendSSE(streamingFormat.formatSSE(streamingFormat.eventStart(currentEvent)));
                      
                      // Process segments from the event
                      for (const segment of currentEvent.segments) {
                        if (segment.type === 'tool_call') {
                          // Ensure started_at is present and record mapping for later completion
                          try {
                            const startedAt = (segment as any).started_at || Date.now();
                            (segment as any).started_at = startedAt;
                            recordToolStart(String(segment.id), currentEvent.id, startedAt);
                          } catch {}
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
                          sendSSE(streamingFormat.formatSSE(streamingFormat.segmentUpdate(segment, currentEvent.segments.indexOf(segment), currentEvent.id)));
                        }
                      }
                    }
                  }
                  break;
                  
                case 'segment':
                  if (extendedEvent.data?.segment) {
                    const segment = extendedEvent.data.segment;
                    
                    if (segment.type === 'text' && segment.text) {
                      // Log receipt before any append decision
                      try {
                        const seq0 = (extendedEvent.data?.segment?.sequence_number as number | undefined);
                        const existing0 = currentEvent?.segments?.find((s: any) => s.type === 'text') as any;
                        const existingLen0 = existing0 ? (existing0.text || '').length : 0;
                        if (typeof seq0 === 'number') {
                          const prev = textRecvBySeq.get(seq0) || 0;
                          textRecvBySeq.set(seq0, prev + 1);
                          if (prev >= 1) dbgText('dup_recv', { seq: seq0 });
                        }
                        textRecvTotal += 1;
                        dbgText('recv', { seq: seq0, deltaLen: String(segment.text).length, existingLen: existingLen0 });
                      } catch {}
                      // Keep currentEvent text in sync only for providers that don't self-assemble
                      // OpenAI Responses provider already mutates currentEvent with token deltas.
                      if (!isSelfAssemblingProvider && currentEvent) {
                        const seq = (extendedEvent.data?.segment?.sequence_number as number | undefined) ?? undefined;
                        const delta = String(segment.text);
                        const shouldAppend = (typeof seq === 'number') ? (lastTextSeq == null || seq > lastTextSeq) : true;
                        const existing = currentEvent.segments.find(s => s.type === 'text') as any;
                        const beforeLen = existing ? (existing.text || '').length : 0;
                        if (shouldAppend) {
                          if (existing) existing.text = (existing.text || '') + delta;
                          else currentEvent.segments.push({ type: 'text', text: delta } as any);
                          if (typeof seq === 'number') lastTextSeq = seq;
                          textAppendsMade += 1;
                          const afterLen = existing ? (existing.text || '').length : ((currentEvent.segments.find(s => s.type === 'text') as any)?.text || '').length;
                          // Debug append action
                          dbgText('append', { seq, deltaLen: delta.length, beforeLen, afterLen });
                        } else {
                          // Debug skip action
                          dbgText('skip_duplicate', { seq, deltaLen: delta.length, lastTextSeq });
                        }
                      }
                      send({
                        type: 'token',
                        content: segment.text,
                        hideProgress: true
                      });
                      sendSSE(streamingFormat.formatSSE(streamingFormat.segmentUpdate(segment, 0, currentEvent?.id)));
                    } else if (segment.type === 'tool_call') {
                      // Upsert tool_call into currentEvent for final commit
                      if (currentEvent) {
                        const idx = currentEvent.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === (segment as any).id);
                        if (idx === -1) currentEvent.segments.push(segment);
                        else currentEvent.segments[idx] = { ...(currentEvent.segments[idx] as any), ...(segment as any) } as any;
                      }
                      hasToolCalls = true;
                      // debug logs removed
                      
                      
                      // Check if this is a partial tool call (during streaming) or complete
                      const hasCompleteArgs = segment.args && Object.keys(segment.args).length > 0;
                      
                      if (!hasCompleteArgs) {
                        // Tool just started - emit tool_start
                        // Record started_at for timing (persisted later)
                        const startedAt = recordToolStart(String(segment.id), currentEvent?.id || '');
                        segment.started_at = segment.started_at || startedAt;
                        send({
                          type: 'tool_start',
                          tool_id: segment.id,
                          tool_name: segment.name,
                          content: `🔧 *Using tool: ${segment.name}*\n`,
                          hideProgress: true
                        });
                      } else {
                        // Tool is complete - emit both start and finalized
                        // Ensure started_at is recorded
                        const startedAt = recordToolStart(String(segment.id), currentEvent?.id || '');
                        segment.started_at = segment.started_at || startedAt;
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
                        sendSSE(streamingFormat.formatSSE(streamingFormat.segmentUpdate(segment, 0, currentEvent?.id)));
                      }
                    } else if (segment.type === 'reasoning') {
                      // Signal reasoning segment start (for UI overlay gating)
                      send({
                        type: 'reasoning_start',
                        item_id: segment.id,
                        output_index: segment.output_index,
                        sequence_number: segment.sequence_number
                      });
                      // Ensure currentEvent contains a reasoning segment
                      upsertReasoningPart(currentEvent, (segment as any).id, (segment as any).parts?.[0]?.summary_index ?? 0, (segment as any).parts?.[0]?.text || '', { sequence_number: (segment as any).sequence_number });

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
                  
                case 'reasoning_start': {
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'reasoning_start',
                      item_id: d.item_id,
                      output_index: d.output_index,
                      sequence_number: d.sequence_number,
                    });
                  }
                  break; }
                case 'reasoning_summary_part_added': {
                  // Handle reasoning part added events (Responses utils emit fields at root)
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'reasoning_summary_part_added',
                      item_id: d.item_id,
                      summary_index: d.summary_index,
                      part: d.part,
                      sequence_number: d.sequence_number
                    });
                    // Bridge: also emit a reasoning segment update to unify frontend handling
                    try {
                      const reasoningSeg = {
                        type: 'reasoning' as const,
                        id: d.item_id,
                        output_index: d.output_index ?? 0,
                        sequence_number: d.sequence_number ?? 0,
                        parts: [{
                          summary_index: d.summary_index,
                          type: 'summary_text' as const,
                          text: (d.part && d.part.text) || '',
                          sequence_number: d.sequence_number ?? 0,
                          is_complete: false,
                          created_at: Date.now()
                        }]
                      };
                      sendSSE(streamingFormat.formatSSE(streamingFormat.segmentUpdate(reasoningSeg as any, 0, currentEvent?.id)));
                    } catch {}
                    // Update currentEvent so final message contains reasoning
                    if (currentEvent && typeof d.summary_index === 'number') {
                      upsertReasoningPart(currentEvent, d.item_id as string, d.summary_index as number, (d.part && d.part.text) || '', { sequence_number: d.sequence_number });
                    }
                  }
                  break; }
                  
                case 'reasoning_summary_text_delta': {
                  // Handle reasoning text delta events (Responses utils emit fields at root)
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'reasoning_summary_text_delta',
                      item_id: d.item_id,
                      summary_index: d.summary_index,
                      delta: d.delta,
                      sequence_number: d.sequence_number
                    });
                    // Bridge: also emit a reasoning segment delta update for unified frontend handling
                    try {
                      const reasoningSeg = {
                        type: 'reasoning' as const,
                        id: d.item_id,
                        output_index: d.output_index ?? 0,
                        sequence_number: d.sequence_number ?? 0,
                        parts: [{
                          summary_index: d.summary_index,
                          type: 'summary_text' as const,
                          text: typeof d.delta === 'string' ? d.delta : (d.delta?.text || ''),
                          sequence_number: d.sequence_number ?? 0,
                          is_complete: false,
                          created_at: Date.now()
                        }]
                      };
                      sendSSE(streamingFormat.formatSSE(streamingFormat.segmentUpdate(reasoningSeg as any, 0, currentEvent?.id)));
                    } catch {}
                    // Update currentEvent so final message contains up-to-date reasoning
                    if (currentEvent && typeof d.summary_index === 'number') {
                      const deltaText = typeof d.delta === 'string' ? d.delta : (d.delta?.text || '');
                      upsertReasoningPart(currentEvent, d.item_id as string, d.summary_index as number, deltaText, { sequence_number: d.sequence_number });
                    }
                  }
                  break; }
                  
                case 'reasoning_summary_part_done': {
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'reasoning_summary_part_done',
                      item_id: d.item_id,
                      summary_index: d.summary_index,
                      sequence_number: d.sequence_number
                    });
                    if (currentEvent && typeof d.summary_index === 'number') {
                      upsertReasoningPart(currentEvent, d.item_id as string, d.summary_index as number, undefined, { sequence_number: d.sequence_number, complete: true });
                    }
                  }
                  break; }
                  
                case 'reasoning_complete': {
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'reasoning_complete',
                      item_id: d.item_id,
                      parts: d.parts,
                      combined_text: d.combined_text,
                      output_index: d.output_index,
                      sequence_number: d.sequence_number
                    });
                    // Mark reasoning segment completed for latency tracking
                    try {
                      if (currentEvent) {
                        const seg = currentEvent.segments.find(s => s.type === 'reasoning' && (s as any).id === d.item_id) as any;
                        if (seg) {
                          const startedAt = seg.started_at || Date.now();
                          seg.completed_at = seg.completed_at || Date.now();
                          // Best-effort persistence
                          markReasoningCompletedInDB(currentEvent.id, String(d.item_id), startedAt, seg.completed_at).catch(() => {});
                        }
                      }
                    } catch {}
                  }
                  break; }
                  
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
                  // Handle MCP tool complete events (embed results into the existing tool_call segment)
                  if (extendedEvent.data) {
                    const toolId = String(extendedEvent.data.tool_id);
                    const out = extendedEvent.data.output;
                    const err = extendedEvent.data.error;
                    // Update the current assistant event's tool_call segment
                    if (currentEvent) {
                      try {
                        const idx = currentEvent.segments.findIndex(s => s.type === 'tool_call' && (s as any).id === toolId);
                        if (idx >= 0) {
                          const seg = currentEvent.segments[idx] as any;
                          seg.output = out ?? seg.output ?? {};
                          if (err != null) seg.error = String(err);
                          seg.completed_at = seg.completed_at || Date.now();
                          currentEvent.segments[idx] = seg;
                        }
                      } catch {}
                    }
                    // Emit tool_result + tool_complete for the front-end stream
                    send({ type: 'tool_result', tool_id: toolId, output: out, error: err });
                    send({ type: 'tool_complete', tool_id: toolId, content: err ? '❌ Tool failed' : '✅ Tool completed' });
                    // Also forward the mcp_tool_complete event
                    send({ type: 'mcp_tool_complete', tool_id: toolId, output: out, error: err, sequence_number: extendedEvent.data.sequence_number, output_index: extendedEvent.data.output_index });
                    // Persist completion timing for analytics (best-effort)
                    markToolCompletedInDB(toolId).catch(() => {});
                  }
                  break;
                  
                case 'progress_update': {
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'progress_update',
                      activity: d.activity,
                      server_label: d.server_label,
                      sequence_number: d.sequence_number
                    });
                  }
                  break; }
                  
                case 'web_search_call_in_progress':
                case 'web_search_call_searching':
                case 'web_search_call_completed':
                  
                case 'progress_hide': {
                  const d = extendedEvent.data ?? extendedEvent;
                  if (d) {
                    send({
                      type: 'progress_hide',
                      sequence_number: d.sequence_number
                    });
                  }
                  break; }

                case 'mcp_list_tools': {
                  // Forward MCP list tools info (optional informational UI)
                  const d = extendedEvent.data ?? extendedEvent;
                  send({ type: 'mcp_list_tools', tools: d.tools, server_label: d.server_label, sequence_number: d.sequence_number });
                  break; }
                  
                case 'error':
                  throw new Error(extendedEvent.data?.error || 'Stream error');
                  
                case 'done':
                  console.log('🔚 [Chat API] Processing done event from provider');

                  // 1) Persist any pending events first
                  if (currentEvent) {
                    try {
                      const txt = (currentEvent.segments.find(s => s.type === 'text') as any)?.text || '';
                      dbgText('summary_done', { recv: textRecvTotal, uniqueSeqs: textRecvBySeq.size, appends: textAppendsMade, finalLen: txt.length });
                    } catch {}
                    // Deduplicate tool_call segments by id while preserving first occurrence order
                    try {
                      const seen = new Map<string, number>();
                      const merged: typeof currentEvent.segments = [];
                      for (const seg of currentEvent.segments) {
                        if ((seg as any).type === 'tool_call') {
                          const id = String((seg as any).id);
                          if (seen.has(id)) {
                            const idx = seen.get(id)!;
                            const prev: any = merged[idx];
                            merged[idx] = { ...prev, ...(seg as any), args: ((): any => {
                              const a = (seg as any).args ?? prev.args;
                              if (typeof a === 'string') { try { return JSON.parse(a); } catch { return a; } }
                              return a ?? {};
                            })() } as any;
                            continue;
                          } else {
                            seen.set(id, merged.length);
                          }
                        }
                        merged.push(seg as any);
                      }
                      currentEvent.segments = merged;
                    } catch {}
                    console.log('🔚 [Chat API] Saving events for existing conversation...');
                    const saveStartTime = Date.now();
                    try {
                      currentOrderKey = await saveEvents(supabase, [currentEvent], conversationId, currentOrderKey);
                      // For brand new conversations, kick off title generation after the first assistant event is saved
                      if (isNewConversation) {
                        generateConversationTitleInBackground(
                          conversationId,
                          eventLog.getEvents(),
                          supabase
                        ).catch(console.error);
                      }
                    } catch (error) {
                      console.error('🔴 [Chat API] Error saving existing conversation events:', error);
                    }
                  }

                  // 2) Decide whether to close stream now or continue for tool execution
                  const unresolved = eventLog.getUnresolvedToolCalls();
                  if (unresolved.length > 0) {
                    // We have tool calls to execute locally (MCP or otherwise).
                    // Do NOT send done or close the stream yet. Break provider stream
                    // so the outer loop can execute tools and re-invoke the model.
                    if (currentEvent) {
                      try {
                        // Signal to the frontend that the current assistant event is complete
                        sendSSE(
                          streamingFormat.formatSSE(
                            streamingFormat.eventComplete(currentEvent)
                          )
                        );
                      } catch (e) {
                        console.warn('⚠️ [Chat API] Failed to emit event_complete before tools:', e);
                      }
                      // Clear currentEvent for the next turn
                      currentEvent = null;
                    }
                    console.log('🔄 [Chat API] Unresolved tool calls detected:', unresolved.length, '— continuing to tool execution phase');
                    // Ensure we have capacity for the follow-up tool execution iteration.
                    // The outer loop increments iteration at the start of each pass; if we are at
                    // maxIterations now, the next pass would be skipped. Decrement here so the
                    // next pass still runs and executes pending tools.
                    iteration = Math.max(0, iteration - 1);
                    breakProviderStreamForTools = true;
                    break;
                  }

                  // No unresolved tool calls — emit final event and finalize the stream
                  if (currentEvent) {
                    try {
                      send({ type: 'message_final', event: currentEvent });
                    } catch (e) {
                      console.warn('⚠️ [Chat API] Failed to emit message_final:', e);
                    }
                  }
                  
                  sendSSE(streamingFormat.formatSSE(streamingFormat.done()));
                  console.log('🔚 [Chat API] Sent complete event to frontend');

                  controller.close();
                  isClosed = true;

                  // Exit the stream processing entirely
                  iteration = maxIterations; // Ensure outer loop stops
                  console.log('🔚 [Chat API] Done event processed, exiting stream processing');
                  return;
                  break;
              }
              // After handling this stream event, check if we need to exit provider stream to run tools
              if (breakProviderStreamForTools) {
                break;
              }
            }
            // Fallback: if provider stream ended without emitting 'done' and we are not
            // breaking for local tool execution, finalize the stream here to prevent
            // repeated iterations and a hanging client.
            if (!breakProviderStreamForTools) {
              console.log('⚠️ [Chat API] Provider stream ended without done; fallback finalize', { hasCurrentEvent: !!currentEvent });
              try {
                if (currentEvent) {
                  // Deduplicate tool_call segments before fallback save
                  try {
                    const seen = new Map<string, number>();
                    const merged: typeof currentEvent.segments = [];
                    for (const seg of currentEvent.segments) {
                      if ((seg as any).type === 'tool_call') {
                        const id = String((seg as any).id);
                        if (seen.has(id)) {
                          const idx = seen.get(id)!;
                          const prev: any = merged[idx];
                          merged[idx] = { ...prev, ...(seg as any), args: ((): any => {
                            const a = (seg as any).args ?? prev.args;
                            if (typeof a === 'string') { try { return JSON.parse(a); } catch { return a; } }
                            return a ?? {};
                          })() } as any;
                          continue;
                        } else {
                          seen.set(id, merged.length);
                        }
                      }
                      merged.push(seg as any);
                    }
                    currentEvent.segments = merged;
                  } catch {}
                  // Persist the final assistant event before emitting to client
                  try {
                    currentOrderKey = await saveEvents(supabase, [currentEvent], conversationId, currentOrderKey);
                  } catch (e) {
                    console.warn('⚠️ [Chat API] Failed to save currentEvent in fallback finalize:', e);
                  }
                  // Emit final event
                  send({ type: 'message_final', event: currentEvent });
                }
                // Emit unified done and close
                sendSSE(streamingFormat.formatSSE(streamingFormat.done()));
                console.log('🔚 [Chat API] Provider stream ended without done — sent fallback complete');
              } catch {}
              controller.close();
              isClosed = true;
              iteration = maxIterations; // stop outer loop
              return;
            }
          }
          
          // Note: Final completion and done events are handled in the 'done' case above
          // No further sends are needed here.
        } catch (error) {
          console.error('Stream processing error:', error);
          
          // Send error in unified SSE format (encode directly here to avoid helper scope issues)
          try {
            controller.enqueue(encoder.encode(
              streamingFormat.formatSSE(
                streamingFormat.error(error instanceof Error ? error : new Error(String(error)))
              )
            ));
          } catch {}
          controller.close();
          // Mark closed so later accidental sends are ignored
          // (provider streams may continue emitting briefly). We already closed the controller.
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
