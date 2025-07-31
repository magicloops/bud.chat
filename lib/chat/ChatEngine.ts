// Shared Chat Engine - consolidates common logic between chat routes
// Handles provider detection, streaming, tool execution, and event management

import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';
import { StreamingEventBuilder } from '@/lib/eventMessageHelpers';
import { ChatStreamHandler } from '@/lib/streaming/chatStreamHandler';
import { MCPToolExecutor } from '@/lib/tools/mcpToolExecutor';
import { EventLog, createTextEvent, createToolResultEvent, Event, ReasoningPart } from '@/lib/types/events';
import { eventsToAnthropicMessages } from '@/lib/providers/anthropic';
import { eventsToOpenAIMessages } from '@/lib/providers/openai';
import { processResponsesAPIStream } from '@/lib/providers/openaiResponses';
import { getApiModelName, isClaudeModel, isReasoningModel, supportsReasoningEffort } from '@/lib/modelMapping';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface ChatEngineConfig {
  // Event management
  eventLoader?: (conversationId: string) => Promise<Event[]>;
  eventSaver?: (event: Event, conversationId: string) => Promise<void>;
  batchEventSaver?: (events: Event[], conversationId: string) => Promise<void>;
  
  // Conversation management  
  conversationCreator?: (events: Event[], workspaceId: string, budId?: string) => Promise<string>;
  titleGenerator?: (conversationId: string, events: Event[]) => Promise<void>;
  
  // Streaming configuration
  streamingMode: 'individual' | 'batch'; // How to save events during streaming
}

export interface ChatRequest {
  messages?: Event[];
  message?: string;
  workspaceId: string;
  budId?: string;
  model: string;
  conversationId?: string;
}

export interface ValidatedChatRequest {
  user: User; // User from Supabase auth
  workspaceId: string;
  messages: Event[];
  model: string;
  budId?: string;
}

export class ChatEngine {
  constructor(
    private config: ChatEngineConfig,
    private supabase: SupabaseClient,
    private openai: OpenAI,
    private anthropic: Anthropic
  ) {}

  async processChat(request: ChatRequest): Promise<ReadableStream> {
    console.log('🚀 ChatEngine.processChat called');
    
    // Validate request and get authenticated user
    const validatedRequest = await this.validateChatRequest(request);
    
    // Determine provider and API type based on model
    const provider = this.detectProvider(validatedRequest.model);
    const apiModelName = getApiModelName(validatedRequest.model);
    
    console.log(`🔄 Using ${provider} provider for model: ${validatedRequest.model} → ${apiModelName}`);

    // Create streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          await this.handleStreaming(
            validatedRequest,
            provider,
            apiModelName,
            controller,
            encoder,
            request.conversationId
          );
        } catch (error) {
          console.error('❌ ChatEngine streaming error:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            error: errorMessage
          })}\n\n`));
          controller.close();
        }
      }
    });

    return stream;
  }

  /**
   * Update assistant event in database with current segments and response metadata
   * Used for incremental persistence during streaming
   */
  private async updateAssistantEventInDatabase(
    eventBuilder: StreamingEventBuilder, 
    conversationId: string, 
    assistantEventId: string
  ): Promise<void> {
    const currentSegments = eventBuilder.getSegments();
    const responseMetadata = eventBuilder.getResponseMetadata();
    
    console.log('💾 [CHATENGINE] Incremental database update:', {
      conversation_id: conversationId,
      assistant_event_id: assistantEventId,
      segments_count: currentSegments.length,
      response_metadata: responseMetadata,
      segments_preview: currentSegments.map(s => ({ 
        type: s.type, 
        ...(s.type === 'tool_call' ? { id: s.id, name: s.name } : {}),
        ...(s.type === 'reasoning' ? { id: s.id, parts_count: s.parts.length } : {})
      }))
    });
    
    const { data, error } = await this.supabase
      .from('events')
      .update({
        segments: currentSegments, // JSONB column - pass actual JSON
        response_metadata: responseMetadata, // JSONB column - pass actual JSON
        ts: Date.now() // Update timestamp to reflect latest update
      })
      .eq('conversation_id', conversationId)
      .eq('id', assistantEventId)
      .select();
      
    if (error) {
      console.error('❌ [CHATENGINE] Failed incremental database update:', {
        error: error,
        error_message: error?.message,
        conversation_id: conversationId,
        assistant_event_id: assistantEventId,
        segments_count: currentSegments.length
      });
    } else {
      console.log('✅ [CHATENGINE] Incremental database update successful:', {
        updated_rows: data?.length || 0,
        conversation_id: conversationId,
        assistant_event_id: assistantEventId,
        segments_count: currentSegments.length
      });
    }
  }

  private async validateChatRequest(request: ChatRequest): Promise<ValidatedChatRequest> {
    // Get the authenticated user
    const { data: { user }, error: authError } = await this.supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Validate required fields
    if (!request.workspaceId) {
      throw new Error('Workspace ID is required');
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await this.supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', request.workspaceId)
      .eq('user_id', user.id)
      .single();

    if (membershipError || !membership) {
      throw new Error('Workspace not found or access denied');
    }

    // Convert messages or message to events
    let messages: Event[] = [];
    
    if (request.messages && Array.isArray(request.messages)) {
      // New chat route - messages are already events
      if (request.messages.length === 0) {
        throw new Error('Messages are required');
      }
      messages = request.messages;
    } else if (request.message && typeof request.message === 'string') {
      // Existing chat route - single message string
      // Load existing events if we have conversationId
      if (request.conversationId && this.config.eventLoader) {
        // For existing conversations, the user message is already saved to database
        // by the API route, so just load all existing events (including the new one)
        const existingEvents = await this.config.eventLoader(request.conversationId);
        messages = existingEvents;
      } else {
        // For new conversations or conversations without eventLoader, create the message
        messages = [createTextEvent('user', request.message)];
      }
    } else {
      throw new Error('Either messages array or message string is required');
    }

    return {
      user,
      workspaceId: request.workspaceId,
      messages,
      model: request.model || 'gpt-4o',
      budId: request.budId
    };
  }

  private detectProvider(model: string): 'anthropic' | 'openai' | 'openai-responses' {
    const isClaudeModelDetected = isClaudeModel(model);
    const isReasoningModelDetected = isReasoningModel(model);
    
    if (isClaudeModelDetected) {
      return 'anthropic';
    } else if (isReasoningModelDetected) {
      return 'openai-responses';
    } else {
      return 'openai';
    }
  }

  private async handleStreaming(
    validatedRequest: ValidatedChatRequest,
    provider: 'anthropic' | 'openai' | 'openai-responses',
    apiModelName: string,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
    conversationId?: string
  ): Promise<void> {
    const eventLog = new EventLog(validatedRequest.messages);
    // Use enhanced StreamingEventBuilder for unified segments model support
    const placeholderAssistantEvent = { 
      id: crypto.randomUUID(), 
      role: 'assistant' as const, 
      segments: [], 
      ts: Date.now() 
    };
    const eventBuilder = new StreamingEventBuilder(placeholderAssistantEvent);
    let createdConversationId: string | null = null;
    let eventFinalized = false;
    
    // Add the assistant event to eventLog FIRST so it appears before any tool results
    eventLog.addEvent(placeholderAssistantEvent);
    console.log('🌐 [CHATENGINE] ✅ Created assistant event placeholder:', { 
      id: placeholderAssistantEvent.id, 
      role: placeholderAssistantEvent.role 
    });
    
    // Reasoning data collection for OpenAI Responses API
    const reasoningCollector = new Map<string, { 
      item_id: string; 
      output_index: number; 
      parts: Record<number, ReasoningPart>; 
      combined_text?: string;
    }>();
    
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
        
        // For OpenAI Responses API, tool calls are handled by OpenAI - skip our execution
        if (provider === 'openai-responses') {
          console.log(`🔧 Found ${pendingToolCalls.length} pending tool calls, but OpenAI Responses API handles execution - skipping our execution`);
          
          // If this is not the first iteration, it means we already processed a response
          // and there are still unresolved tools, which shouldn't happen with remote MCP
          if (iteration > 1) {
            console.warn('🚨 [CHATENGINE] Found unresolved tools in iteration > 1 for OpenAI Responses API - this should not happen with remote MCP. Breaking conversation loop.');
            shouldContinue = false;
            break;
          }
          
          // For first iteration, this is expected - OpenAI will handle the tools
          // and include results in the response. Don't continue the loop.
          console.log('🌐 [CHATENGINE] First iteration with pending tools - OpenAI will handle these during streaming');
        } else {
          // For regular OpenAI and Anthropic, we execute tools ourselves
          console.log(`🔧 Executing ${pendingToolCalls.length} pending tool calls`);
          
          // Execute all pending tool calls
          const toolResults = await this.executeMCPToolCalls(
            pendingToolCalls,
            validatedRequest.workspaceId,
            validatedRequest.budId
          );
          
          // Add tool results to event log
          for (const result of toolResults) {
            const toolResultEvent = createToolResultEvent(result.id, result.output);
            eventLog.addEvent(toolResultEvent);
            
            // Save tool result if in individual mode
            if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
              await this.config.eventSaver(toolResultEvent, conversationId);
            }
            
            // Stream tool result to user
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: "tool_result",
              tool_id: result.id,
              output: result.output,
              error: result.error || null
            })}\n\n`));
            
            // Stream tool completion to user
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: "tool_complete",
              tool_id: result.id,
              content: result.error ? "❌ Tool failed" : "✅ Tool completed"
            })}\n\n`));
          }
          
          // Continue to next iteration to get follow-up response
          continue;
        }
      }
      
      // No pending tool calls, get next response from LLM
      const events = eventLog.getEvents();
      
      if (provider === 'anthropic') {
        await this.handleAnthropicStream(
          events, apiModelName, validatedRequest, eventBuilder, eventLog, 
          controller, conversationId
        );
      } else if (provider === 'openai') {
        await this.handleOpenAIStream(
          events, apiModelName, validatedRequest, eventBuilder, eventLog, 
          controller, conversationId
        );
      } else if (provider === 'openai-responses') {
        await this.handleOpenAIResponsesStream(
          events, apiModelName, validatedRequest, eventBuilder, eventLog, 
          controller, reasoningCollector, eventFinalized, conversationId
        );
        eventFinalized = true; // OpenAI Responses handles finalization internally
      }
      
      // Check if we have tool calls to execute in the final event
      const finalEvent = eventLog.getLastEvent();
      const toolCallSegments = finalEvent?.segments.filter(s => s.type === 'tool_call') || [];
      
      console.log('🔍 [CHATENGINE] Checking final event for tool calls:', {
        event_id: finalEvent?.id,
        event_role: finalEvent?.role,
        total_segments: finalEvent?.segments.length || 0,
        tool_call_segments: toolCallSegments.length,
        segment_types: finalEvent?.segments.map(s => s.type) || [],
        iteration: iteration,
        provider: provider
      });
      
      // For OpenAI Responses API, if we just processed MCP tools, check if any tools are still unresolved
      if (provider === 'openai-responses' && iteration === 1) {
        const stillUnresolved = eventLog.getUnresolvedToolCalls();
        console.log('🔍 [CHATENGINE] Post-streaming tool resolution check:', {
          still_unresolved_count: stillUnresolved.length,
          tool_call_segments_in_final_event: toolCallSegments.length
        });
        
        // If no unresolved tool calls after first iteration, we're done
        if (stillUnresolved.length === 0) {
          console.log('✅ [CHATENGINE] All tools resolved after OpenAI Responses API streaming - conversation complete');
          shouldContinue = false;
        }
      }
      
      // If no tool calls in the final event, we're done
      if (toolCallSegments.length === 0) {
        console.log('✅ [CHATENGINE] No tool calls in final event - conversation complete');
        shouldContinue = false;
      }
      
      // Reset builder for next iteration
      eventBuilder.reset('assistant');
      eventFinalized = false; // Reset finalization flag for next iteration
    }
    
    // Create conversation in background (only if not an existing conversation)
    if (!conversationId && this.config.conversationCreator) {
      const allEvents = eventLog.getEvents();
      createdConversationId = await this.config.conversationCreator(
        allEvents,
        validatedRequest.workspaceId,
        validatedRequest.budId
      );
      
      // Send conversation created event BEFORE complete event
      console.log('📤 Sending conversationCreated event:', { conversationId: createdConversationId });
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        type: "conversationCreated",
        conversationId: createdConversationId
      })}\n\n`));
      console.log('✅ conversationCreated event sent successfully');
    }
    
    // Send completion event
    console.log('📤 Sending complete event to frontend');
    const finalContent = eventLog.getEvents()
      .filter(e => e.role === 'assistant')
      .flatMap(e => e.segments)
      .filter(s => s.type === 'text')
      .map(s => s.text)
      .join('');
    
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
      type: "complete",
      content: finalContent
    })}\n\n`));
    console.log('✅ Complete event sent to frontend');
    
    controller.close();
  }

  private async executeMCPToolCalls(
    toolCalls: Array<{ id: string; name: string; args: object }>,
    workspaceId: string,
    budId?: string
  ): Promise<Array<{ id: string; output: object; error?: string }>> {
    const toolExecutor = new MCPToolExecutor({ debug: true });
    return await toolExecutor.executeToolCalls(toolCalls, workspaceId, budId);
  }

  private async handleAnthropicStream(
    events: Event[],
    apiModelName: string,
    validatedRequest: ValidatedChatRequest,
    eventBuilder: EventStreamBuilder,
    eventLog: EventLog,
    controller: ReadableStreamDefaultController,
    conversationId?: string
  ): Promise<void> {
    const { messages: anthropicMessages, system } = eventsToAnthropicMessages(events);
    
    // Get available tools if budId is provided
    let tools: Anthropic.Tool[] = [];
    if (validatedRequest.budId) {
      tools = await this.getAnthropicTools(validatedRequest.budId, validatedRequest.workspaceId);
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
    
    console.log('🔄 Sending request to Anthropic:', JSON.stringify(request, null, 2));
    
    const stream = await this.anthropic.messages.stream(request);
    
    console.log('📡 Anthropic stream created, starting to process...');
    
    // Use unified ChatStreamHandler
    const streamHandler = new ChatStreamHandler(
      eventBuilder,
      eventLog,
      controller,
      { debug: true, conversationId }
    );
    
    await streamHandler.handleAnthropicStream(stream);
    
    // Save the finalized event to database if in individual mode
    if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
      const finalEvent = eventLog.getLastEvent();
      if (finalEvent) {
        await this.config.eventSaver(finalEvent, conversationId);
      }
    }
  }

  private async handleOpenAIStream(
    events: Event[],
    apiModelName: string,
    validatedRequest: ValidatedChatRequest,
    eventBuilder: EventStreamBuilder,
    eventLog: EventLog,
    controller: ReadableStreamDefaultController,
    conversationId?: string
  ): Promise<void> {
    const openaiMessages = eventsToOpenAIMessages(events);
    
    // Get available tools if budId is provided
    let tools: OpenAI.ChatCompletionTool[] = [];
    if (validatedRequest.budId) {
      tools = await this.getOpenAITools(validatedRequest.budId, validatedRequest.workspaceId);
    }
    
    const request = {
      model: apiModelName,
      messages: openaiMessages,
      temperature: 0.7,
      stream: true,
      ...(tools.length > 0 && { tools })
    };
    
    console.log('🔄 Sending request to OpenAI:', JSON.stringify(request, null, 2));
    
    const stream = await this.openai.chat.completions.create(request) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    
    console.log('📡 OpenAI stream created, starting to process...');
    
    // Use unified ChatStreamHandler
    const streamHandler = new ChatStreamHandler(
      eventBuilder,
      eventLog,
      controller,
      { debug: true, conversationId }
    );
    
    await streamHandler.handleOpenAIStream(stream);
    
    // Save the finalized event to database if in individual mode
    if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
      const finalEvent = eventLog.getLastEvent();
      if (finalEvent) {
        await this.config.eventSaver(finalEvent, conversationId);
      }
    }
  }

  private async handleOpenAIResponsesStream(
    events: Event[],
    apiModelName: string,
    validatedRequest: ValidatedChatRequest,
    eventBuilder: EventStreamBuilder,
    eventLog: EventLog,
    controller: ReadableStreamDefaultController,
    reasoningCollector: Map<string, { 
      item_id: string; 
      output_index: number; 
      parts: Record<number, ReasoningPart>; 
      combined_text?: string;
    }>,
    eventFinalized: boolean,
    conversationId?: string
  ): Promise<void> {
    const openaiMessages = eventsToOpenAIMessages(events);
    
    // Get available tools if budId is provided
    const responsesApiTools: OpenAI.Responses.Tool[] = [];
    if (validatedRequest.budId) {
      // Check if this model supports foundation model-managed MCP
      const supportsFoundationMCP = this.supportsFoundationModelMCP(validatedRequest.model);
      console.log(`🔍 Model ${validatedRequest.model} supports foundation MCP: ${supportsFoundationMCP}`);
      
      if (supportsFoundationMCP) {
        // For models that support foundation MCP (like o-series), use MCP server configs
        // This includes both explicit remote_servers and application-managed servers converted to MCP
        const remoteMCPTools = await this.getRemoteMCPTools(validatedRequest.budId, validatedRequest.workspaceId);
        console.log(`🔧 Found ${remoteMCPTools.length} remote MCP tools:`, remoteMCPTools.map(t => t.server_label));
        
        // Add MCP tools with validation
        if (remoteMCPTools.length > 0) {
          console.log('🔧 [DEBUG] Adding MCP tools to request:', remoteMCPTools);
          // Validate each MCP tool before adding
          for (const tool of remoteMCPTools) {
            try {
              new URL(tool.server_url); // Validate URL format
              console.log('✅ MCP tool URL is valid:', tool.server_label, tool.server_url);
              responsesApiTools.push(tool);
            } catch (urlError) {
              console.error('❌ Invalid MCP tool URL:', tool.server_label, tool.server_url, urlError);
            }
          }
        }
      } else {
        // For other models, use application-managed servers as function calls
        const localMCPTools = await this.getOpenAITools(validatedRequest.budId, validatedRequest.workspaceId);
        const localFunctionTools = localMCPTools.map(tool => ({
          type: 'function' as const,
          name: tool.function.name,
          description: tool.function.description || '',
          parameters: tool.function.parameters || {},
          strict: false
        }));
        responsesApiTools.push(...localFunctionTools);
        
        // Also add any explicit remote MCP servers
        const remoteMCPTools = await this.getRemoteMCPTools(validatedRequest.budId, validatedRequest.workspaceId);
        responsesApiTools.push(...remoteMCPTools);
      }
    }
    
    // Determine reasoning effort based on model and bud config
    let reasoningEffort: 'low' | 'medium' | 'high' | undefined;
    if (supportsReasoningEffort(validatedRequest.model)) {
      reasoningEffort = await this.getReasoningEffort(validatedRequest.budId);
    }
    
    // Convert ChatCompletionMessageParam[] to ResponseInputItem[] format
    const responsesInputItems: OpenAI.Responses.ResponseInputItem[] = this.convertToResponsesInputItems(openaiMessages);
    
    const responsesRequest = {
      model: apiModelName,
      input: responsesInputItems,  // Use proper ResponseInputItem[] array format
      stream: true as const,
      ...(responsesApiTools.length > 0 && { tools: responsesApiTools }),  // Include tools if available
      reasoning: { 
        effort: reasoningEffort || 'medium',
        summary: 'auto' as const  // Enable reasoning summaries
      }
    };
    
    console.log('🔄 Sending request to OpenAI Responses API:');
    console.log('Model:', responsesRequest.model);
    console.log('Tools count:', responsesApiTools.length);
    console.log('Tools config:', JSON.stringify(responsesApiTools, null, 2));
    console.log('Full request:', JSON.stringify(responsesRequest, null, 2));
    
    const stream = await this.openai.responses.create(responsesRequest);
    
    console.log('📡 OpenAI Responses API stream created, starting to process...');
    
    // Create placeholder assistant event BEFORE streaming starts to ensure correct database ordering
    const placeholderAssistant = createTextEvent('assistant', '');
    let assistantEventId = placeholderAssistant.id;
    let assistantEventCreated = false;
    
    // Save placeholder to database immediately (gets correct fractional index before tool results)
    if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
      await this.config.eventSaver(placeholderAssistant, conversationId);
      assistantEventCreated = true;
      console.log('✅ Created placeholder assistant event in database:', { id: assistantEventId });
    }
    
    // Process the Responses API stream with reasoning events
    const responsesStream = processResponsesAPIStream(stream);
    const encoder = new TextEncoder();
    
    // Function call data collection for OpenAI Responses API (local to this method)
    const functionCallCollector = new Map<string, {
      item_id: string;
      output_index: number;
      name: string;
      accumulated_args: string;
      is_complete: boolean;
    }>();
    
    // MCP call data collection for OpenAI Responses API
    const mcpCallCollector = new Map<string, {
      item_id: string;
      output_index: number;
      sequence_number: number;
      name: string;
      server_label: string;
      display_name?: string;
      server_type?: string;
      accumulated_args: string;
      is_complete: boolean;
    }>();
    
    // MCP tool mapping to store actual tool names from mcp_list_tools
    const mcpToolNameMapping = new Map<string, string>(); // tool_id -> tool_name
    
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
      } else if (event.type === 'tool_start') {
        // Initialize function call tracking
        const { tool_id, tool_name } = event as { tool_id: string; tool_name: string };
        functionCallCollector.set(tool_id, {
          item_id: tool_id,
          output_index: 0, // Will be updated if available
          name: tool_name,
          accumulated_args: '',
          is_complete: false
        });
        console.log('🔧 Started tracking function call:', { tool_id, tool_name });
      } else if (event.type === 'tool_arguments_delta') {
        // Accumulate function call arguments
        const { tool_id, delta } = event as { tool_id: string; delta: string };
        const funcCall = functionCallCollector.get(tool_id);
        if (funcCall) {
          funcCall.accumulated_args += delta;
          console.log('🔧 Accumulated function args delta:', { tool_id, delta_length: delta.length, total_length: funcCall.accumulated_args.length });
        }
      } else if (event.type === 'tool_finalized') {
        // Function call arguments are complete - add to event builder
        const { tool_id, args } = event as { tool_id: string; args: object };
        const funcCall = functionCallCollector.get(tool_id);
        if (funcCall) {
          funcCall.is_complete = true;
          // Add tool call segment to event builder
          eventBuilder.addToolCall(tool_id, funcCall.name, args);
          console.log('✅ Finalized function call:', { tool_id, tool_name: funcCall.name, args });
        }
      } else if (event.type === 'tool_complete') {
        // Function call execution complete (cleanup)
        const { tool_id } = event as { tool_id: string };
        console.log('🎯 Function call completed:', { tool_id });
        // Keep in collector for potential debugging, but mark as done
      } else if (event.type === 'mcp_tool_start') {
        // Initialize MCP call tracking
        const { tool_id, tool_name, server_label, display_name, server_type, output_index, sequence_number } = event as { 
          tool_id: string; 
          tool_name: string; 
          server_label: string;
          display_name?: string;
          server_type?: string;
          output_index?: number;
          sequence_number?: number;
        };
        
        // Try to get the real tool name from our mapping, fallback to the provided name
        const actualToolName = mcpToolNameMapping.get(tool_id) || tool_name;
        console.log('🌐 [CHATENGINE] ✅ MCP TOOL START EVENT RECEIVED:', { 
          tool_id, 
          provided_name: tool_name, 
          actual_name: actualToolName,
          server_label,
          display_name,
          server_type
        });
        
        mcpCallCollector.set(tool_id, {
          item_id: tool_id,
          output_index: output_index || 0,
          sequence_number: sequence_number || 0,
          name: actualToolName,
          server_label: server_label,
          display_name: display_name,
          server_type: server_type,
          accumulated_args: '',
          is_complete: false
        });
        console.log('🌐 [CHATENGINE] MCP call added to collector. Current collector size:', mcpCallCollector.size);
      } else if (event.type === 'mcp_tool_arguments_delta') {
        // Accumulate MCP call arguments
        const { tool_id, delta } = event as { tool_id: string; delta: string };
        console.log('🌐 [CHATENGINE] MCP ARGS DELTA RECEIVED:', { tool_id, delta_length: delta.length });
        const mcpCall = mcpCallCollector.get(tool_id);
        if (mcpCall) {
          mcpCall.accumulated_args += delta;
          console.log('🌐 [CHATENGINE] MCP args accumulated. Total length:', mcpCall.accumulated_args.length);
        } else {
          console.error('🚨 [CHATENGINE] MCP call not found in collector for delta event:', { tool_id, collector_keys: Array.from(mcpCallCollector.keys()) });
        }
      } else if (event.type === 'mcp_tool_finalized') {
        // MCP call arguments are complete - add to event builder with incremental database update
        const { tool_id, args } = event as { tool_id: string; args: object };
        console.log('🌐 [CHATENGINE] ✅ MCP TOOL FINALIZED EVENT RECEIVED:', { tool_id, args });
        const mcpCall = mcpCallCollector.get(tool_id);
        if (mcpCall) {
          mcpCall.is_complete = true;
          
          // Add MCP tool call segment to event builder with metadata and sequence info
          console.log('🌐 [CHATENGINE] Adding MCP tool call to eventBuilder:', { 
            tool_id, 
            tool_name: mcpCall.name, 
            server_label: mcpCall.server_label,
            display_name: mcpCall.display_name,
            server_type: mcpCall.server_type,
            output_index: mcpCall.output_index
          });
          
          if (eventBuilder instanceof StreamingEventBuilder) {
            eventBuilder.addToolCall(tool_id, mcpCall.name, args, {
              server_label: mcpCall.server_label,
              display_name: mcpCall.display_name,
              server_type: mcpCall.server_type,
              output_index: mcpCall.output_index,
              sequence_number: mcpCall.sequence_number || 0
            });
            
            // Immediately update database with the new tool call segment
            if (this.config.streamingMode === 'individual' && conversationId && assistantEventCreated) {
              console.log('🔧 [CHATENGINE] Updating database with tool call segment...');
              await this.updateAssistantEventInDatabase(eventBuilder, conversationId, assistantEventId);
            }
          } else {
            // Fallback for legacy EventStreamBuilder
            eventBuilder.addToolCall(tool_id, mcpCall.name, args, {
              server_label: mcpCall.server_label,
              display_name: mcpCall.display_name,
              server_type: mcpCall.server_type
            });
            console.log('🔧 [CHATENGINE] Using legacy EventStreamBuilder - no incremental DB update');
          }
          
          console.log('🌐 [CHATENGINE] ✅ MCP tool call added to event builder successfully');
        } else {
          console.error('🚨 [CHATENGINE] MCP call not found in collector for finalized event:', { tool_id, collector_keys: Array.from(mcpCallCollector.keys()) });
        }
      } else if (event.type === 'mcp_tool_complete') {
        // MCP call execution complete (cleanup)
        const { tool_id, output, error } = event as { tool_id: string; output: string | null; error: string | null };
        console.log('🎯 MCP call completed:', { tool_id, has_output: !!output, has_error: !!error });
        
        // For remote MCP tools, create tool result events with the actual output from OpenAI
        // This is needed so future conversation iterations can reference the tool results
        const toolResult = {
          id: tool_id,
          output: output || { result: "Tool executed by OpenAI - results included in response text" },
          error: error || undefined
        };
        
        const toolResultEvent = createToolResultEvent(toolResult.id, toolResult.output);
        eventLog.addEvent(toolResultEvent);
        console.log('🌐 [CHATENGINE] ✅ Created tool result event for MCP tool:', { 
          tool_id, 
          has_output: !!output,
          output_preview: typeof output === 'string' ? output.substring(0, 100) + '...' : output,
          has_error: !!error 
        });
        
        // Stream MCP tool result to frontend
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "tool_result",
          tool_id: tool_id,
          output: toolResult.output,
          error: toolResult.error || null
        })}\n\n`));
        
        // Stream MCP tool completion to frontend
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "tool_complete",
          tool_id: tool_id,
          content: toolResult.error ? "❌ MCP Tool failed" : "✅ MCP Tool completed"
        })}\n\n`));
        
        console.log('🌐 [CHATENGINE] ✅ Streamed MCP tool result to frontend');
        
        // Save tool result if in individual mode
        if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
          await this.config.eventSaver(toolResultEvent, conversationId);
        }
      } else if (event.type === 'mcp_list_tools') {
        // MCP server tools discovered - extract tool names for better display
        const { server_label, tools } = event as { server_label: string; tools: unknown[] };
        console.log('🔍 MCP tools discovered:', { server_label, tool_count: tools.length, tools });
        
        // Extract tool names from the tools array for later use
        if (tools && Array.isArray(tools)) {
          for (const tool of tools) {
            if (tool && typeof tool === 'object') {
              const toolObj = tool as { name?: string; id?: string; [key: string]: unknown };
              if (toolObj.name && toolObj.id) {
                mcpToolNameMapping.set(toolObj.id, toolObj.name);
                console.log('🔍 Mapped MCP tool:', { id: toolObj.id, name: toolObj.name });
              }
            }
          }
        }
      } else if (event.type === 'mcp_approval_request') {
        // MCP tool approval requested (for future implementation)
        const { approval_request_id, tool_name, server_label } = event as { 
          approval_request_id: string; 
          tool_name: string; 
          server_label: string 
        };
        console.log('⚠️ MCP approval requested:', { approval_request_id, tool_name, server_label });
        // For now, we log this - future implementation could pause and request user approval
      } else if (event.type === 'reasoning_start') {
        // Start of a new reasoning segment
        const { item_id, output_index, sequence_number } = event as { 
          item_id: string; 
          output_index: number; 
          sequence_number: number;
        };
        console.log('🧠 [CHATENGINE] ✅ REASONING SEGMENT STARTED:', { 
          item_id, 
          output_index, 
          sequence_number 
        });
        
        // Initialize reasoning collector entry for legacy compatibility
        if (!reasoningCollector.has(item_id)) {
          reasoningCollector.set(item_id, {
            item_id,
            output_index,
            parts: {}
          });
        }
        
        // Add streaming reasoning segment to event builder for immediate UI feedback
        if (eventBuilder instanceof StreamingEventBuilder) {
          eventBuilder.addReasoningSegment(
            item_id,
            output_index,
            sequence_number,
            [], // Empty parts initially
            {
              streaming: true // Mark as streaming for frontend
            }
          );
          
          // Note: Database will be updated when reasoning segment is finalized
        }
      } else if (event.type === 'reasoning_complete') {
        // Complete reasoning segment - add to event builder and update database
        const { item_id, output_index, sequence_number, parts, combined_text } = event as { 
          item_id: string; 
          output_index: number; 
          sequence_number: number;
          parts: Array<{
            summary_index: number;
            type: 'summary_text';
            text: string;
            sequence_number: number;
            is_complete: boolean;
            created_at: number;
          }>;
          combined_text?: string;
        };
        
        console.log('🧠 [CHATENGINE] ✅ REASONING SEGMENT COMPLETED:', { 
          item_id, 
          output_index, 
          sequence_number, 
          parts_count: parts.length,
          has_combined_text: !!combined_text
        });
        
        // Add reasoning segment to event builder with incremental database updates
        if (eventBuilder instanceof StreamingEventBuilder) {
          eventBuilder.addReasoningSegment(
            item_id,
            output_index,
            sequence_number,
            parts,
            {
              combined_text,
              streaming: false
            }
          );
          
          // Immediately update database with the new reasoning segment
          if (this.config.streamingMode === 'individual' && conversationId && assistantEventCreated) {
            console.log('🧠 [CHATENGINE] Updating database with reasoning segment...');
            await this.updateAssistantEventInDatabase(eventBuilder, conversationId, assistantEventId);
          }
        } else {
          // Fallback for legacy EventStreamBuilder
          console.warn('🧠 [CHATENGINE] Using legacy EventStreamBuilder - reasoning segments not supported');
        }
        
        // Update reasoning collector for legacy compatibility
        const reasoningData = reasoningCollector.get(item_id);
        if (reasoningData) {
          for (const part of parts) {
            reasoningData.parts[part.summary_index] = part;
          }
          reasoningData.combined_text = combined_text;
        }
      } else if (event.type === 'reasoning_summary_part_added') {
        // Handle reasoning part being added during streaming
        const { item_id, summary_index, part, output_index, sequence_number } = event as {
          item_id: string;
          summary_index: number;
          part: { type: string; text: string };
          output_index: number;
          sequence_number: number;
        };
        
        console.log('🧠 [CHATENGINE] ✅ REASONING PART ADDED:', { 
          item_id, 
          summary_index, 
          part_text_length: part.text.length 
        });
        
        // Update reasoning segment with new part
        if (eventBuilder instanceof StreamingEventBuilder) {
          // Get existing reasoning segment to update it
          const currentSegments = eventBuilder.getSegments();
          const reasoningSegment = currentSegments.find(s => 
            s.type === 'reasoning' && s.id === item_id
          );
          
          if (reasoningSegment && reasoningSegment.type === 'reasoning') {
            // Add the new part
            const newPart = {
              summary_index,
              type: part.type as 'summary_text',
              text: part.text,
              sequence_number,
              is_complete: false,
              created_at: Date.now()
            };
            
            const updatedParts = [...reasoningSegment.parts, newPart];
            
            // Update the reasoning segment
            eventBuilder.addReasoningSegment(
              item_id,
              output_index,
              sequence_number,
              updatedParts,
              {
                streaming: true // Still streaming
              }
            );
            
            // Note: Database will be updated when reasoning segment is finalized
          }
        }
      } else if (event.type === 'reasoning_summary_text_delta') {
        // Handle reasoning text streaming in real-time
        const { item_id, delta, summary_index, output_index, sequence_number } = event as {
          item_id: string;
          delta: string;
          summary_index: number;
          output_index: number;
          sequence_number: number;
        };
        
        console.log('🧠 [CHATENGINE] ✅ REASONING TEXT DELTA:', { 
          item_id, 
          summary_index,
          delta_length: delta.length 
        });
        
        // Update reasoning segment with streaming text
        if (eventBuilder instanceof StreamingEventBuilder) {
          const currentSegments = eventBuilder.getSegments();
          const reasoningSegment = currentSegments.find(s => 
            s.type === 'reasoning' && s.id === item_id
          );
          
          if (reasoningSegment && reasoningSegment.type === 'reasoning') {
            // Find the part being updated and append delta text
            const updatedParts = reasoningSegment.parts.map(part => 
              part.summary_index === summary_index 
                ? { ...part, text: part.text + delta }
                : part
            );
            
            // If part doesn't exist yet, create it
            if (!updatedParts.some(p => p.summary_index === summary_index)) {
              updatedParts.push({
                summary_index,
                type: 'summary_text' as const,
                text: delta,
                sequence_number,
                is_complete: false,
                created_at: Date.now()
              });
            }
            
            // Update the reasoning segment
            eventBuilder.addReasoningSegment(
              item_id,
              output_index,
              sequence_number,
              updatedParts,
              {
                streaming: true // Still streaming
              }
            );
            
            // Note: Database will be updated when reasoning segment is finalized
          }
        }
      } else if (event.type.includes('reasoning_summary')) {
        // Handle legacy reasoning events for backward compatibility
        const { item_id } = event as { item_id?: string };
        if (item_id) {
          if (!reasoningCollector.has(item_id)) {
            reasoningCollector.set(item_id, {
              item_id,
              output_index: (event as { output_index?: number }).output_index || 0,
              parts: {}
            });
          }
          
          const reasoningData = reasoningCollector.get(item_id);
          if (!reasoningData) continue;
          
          // Handle specific legacy reasoning events
          if (event.type === 'reasoning_summary_text_done') {
            const { summary_index, text } = event as { summary_index?: number; text?: string };
            if (summary_index !== undefined) {
              reasoningData.parts[summary_index] = {
                summary_index,
                type: 'summary_text' as const,
                text: text || '',
                sequence_number: (event as { sequence_number?: number }).sequence_number || 0,
                is_complete: true,
                created_at: Date.now()
              };
            }
          } else if (event.type === 'reasoning_summary_done') {
            // Finalize reasoning - just set the combined text, no is_streaming needed
            const { text } = event as { text?: string };
            reasoningData.combined_text = text || Object.values(reasoningData.parts)
              .sort((a, b) => {
                const aIndex = (a as { summary_index?: number }).summary_index || 0;
                const bIndex = (b as { summary_index?: number }).summary_index || 0;
                return aIndex - bIndex;
              })
              .map((part) => (part as { text?: string }).text || '')
              .join('\n\n');
          }
        }
      } else if (event.type !== 'finalize_only') {
        // Catch-all for any events we're not handling in ChatEngine
        console.log('🔍🔍🔍 UNHANDLED EVENT IN CHATENGINE 🔍🔍🔍');
        console.log('Event Type:', event.type);
        console.log('Event Data:', JSON.stringify(event, null, 2));
        console.log('Note: This event made it through the transformer but is not being processed in ChatEngine');
        console.log('🔍🔍🔍 END UNHANDLED CHATENGINE EVENT 🔍🔍🔍');
      } else if (event.type === 'finalize_only' && !eventFinalized) {
        console.log('🌐 [CHATENGINE] Finalizing event builder...');
        
        // Handle enhanced StreamingEventBuilder vs legacy EventStreamBuilder
        if (eventBuilder instanceof StreamingEventBuilder) {
          // Enhanced finalization with response metadata
          eventBuilder.updateResponseMetadata({
            completion_status: 'complete',
            total_output_items: Array.from(mcpCallCollector.size + reasoningCollector.size)
          });
          
          const builtEvent = eventBuilder.finalize();
          if (builtEvent) {
            console.log('🌐 [CHATENGINE] ✅ Enhanced event finalized:', {
              segments_count: builtEvent.segments.length,
              has_response_metadata: !!builtEvent.response_metadata,
              completion_status: builtEvent.response_metadata?.completion_status
            });
            console.log('🌐 [CHATENGINE] Event segments:', builtEvent.segments.map(s => ({ type: s.type, ...(s.type === 'tool_call' ? { id: s.id, name: s.name, server_label: s.server_label } : {}), ...(s.type === 'reasoning' ? { id: s.id, parts_count: s.parts.length } : {}) })));
            eventLog.updateEvent(builtEvent);
            
            // Final database update with enhanced event model 
            if (this.config.streamingMode === 'individual' && conversationId && assistantEventCreated) {
              console.log('🌐 [CHATENGINE] Final database update with enhanced model...');
              await this.updateAssistantEventInDatabase(eventBuilder, conversationId, assistantEventId);
            }
          } else {
            console.warn('🚨 [CHATENGINE] Enhanced event builder returned null/undefined event');
          }
        } else {
          // Legacy EventStreamBuilder handling
          const reasoningEntries = Array.from(reasoningCollector.values());
          if (reasoningEntries.length > 0) {
            // Use the first (and typically only) reasoning data
            const reasoningData = reasoningEntries[0];
            eventBuilder.setReasoningData(reasoningData);
          }
          
          const builtEvent = eventBuilder.finalize();
          if (builtEvent) {
            console.log('🌐 [CHATENGINE] ✅ Legacy event finalized with segments:', builtEvent.segments.length);
            console.log('🌐 [CHATENGINE] Event segments:', builtEvent.segments.map(s => ({ type: s.type, ...(s.type === 'tool_call' ? { id: s.id, name: s.name, server_label: s.server_label } : {}) })));
            eventLog.updateEvent(builtEvent);
            
            // Legacy database update
            if (this.config.streamingMode === 'individual' && conversationId && assistantEventCreated) {
              console.log('🌐 [CHATENGINE] Updating placeholder assistant event in database (legacy)...');
              
              const { data, error } = await this.supabase
                .from('events')
                .update({ 
                  segments: builtEvent.segments, // JSONB column - pass actual JSON, not stringified
                  reasoning: builtEvent.reasoning || null, // JSONB column - pass actual JSON, not stringified
                  ts: builtEvent.ts // Update timestamp to reflect final event time
                })
                .eq('conversation_id', conversationId)
                .eq('id', assistantEventId)
                .select();
                
              if (error) {
                console.error('❌ [CHATENGINE] Failed to update assistant event in database:', {
                  error: error,
                  error_message: error?.message,
                  conversation_id: conversationId,
                  assistant_event_id: assistantEventId
                });
              } else {
                console.log('✅ [CHATENGINE] Updated placeholder assistant event in database:', {
                  updated_rows: data?.length || 0,
                  conversation_id: conversationId,
                  assistant_event_id: assistantEventId
                });
              }
            } else if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId && !assistantEventCreated) {
              // Fallback: if placeholder wasn't created, use old method
              console.log('🌐 [CHATENGINE] Saving event to database (fallback)...');
              await this.config.eventSaver(builtEvent, conversationId);
            }
          } else {
            console.warn('🚨 [CHATENGINE] Legacy event builder returned null/undefined event');
          }
        }
        
        eventFinalized = true; // Mark as finalized to prevent duplicates
      }
    }
  }

  private async getAnthropicTools(budId: string, workspaceId: string): Promise<Anthropic.Tool[]> {
    try {
      const { data: bud } = await this.supabase
        .from('buds')
        .select('*, mcp_config')
        .eq('id', budId)
        .single();
      
      if (!bud?.mcp_config?.servers?.length) return [];
      
      const { data: servers } = await this.supabase
        .from('mcp_servers')
        .select('*')
        .in('id', bud.mcp_config.servers)
        .eq('workspace_id', workspaceId);
      
      if (!servers?.length) return [];
      
      // Connect to get tools
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      
      const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
      const mcpClient = new Client({
        name: "bud-chat-tools-client",
        version: "1.0.0"
      }, { capabilities: { tools: {} } });
      
      await mcpClient.connect(transport);
      const { tools: mcpTools } = await mcpClient.listTools();
      
      const tools = mcpTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      }));
      
      await mcpClient.close();
      return tools;
    } catch (error) {
      console.warn('Failed to get Anthropic tools:', error);
      return [];
    }
  }

  private async getOpenAITools(budId: string, workspaceId: string): Promise<OpenAI.ChatCompletionTool[]> {
    try {
      const { data: bud } = await this.supabase
        .from('buds')
        .select('*, mcp_config')
        .eq('id', budId)
        .single();
      
      if (!bud?.mcp_config?.servers?.length) return [];
      
      const { data: servers } = await this.supabase
        .from('mcp_servers')
        .select('*')
        .in('id', bud.mcp_config.servers)
        .eq('workspace_id', workspaceId);
      
      if (!servers?.length) return [];
      
      // Connect to get tools
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      
      const transport = new StreamableHTTPClientTransport(new URL(servers[0].endpoint));
      const mcpClient = new Client({
        name: "bud-chat-tools-client",
        version: "1.0.0"
      }, { capabilities: { tools: {} } });
      
      await mcpClient.connect(transport);
      const { tools: mcpTools } = await mcpClient.listTools();
      
      // Convert to OpenAI tool format
      const tools = mcpTools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }));
      
      await mcpClient.close();
      return tools;
    } catch (error) {
      console.warn('Failed to get OpenAI tools:', error);
      return [];
    }
  }

  private supportsFoundationModelMCP(model: string): boolean {
    // Models that support foundation model-managed MCP (native MCP integration)
    const foundationMCPModels = [
      'o1', 'o1-preview', 'o1-mini', 
      'o3', 'o3-mini', 'o4-mini',
      // Add other models that support native MCP as they become available
    ];
    
    return foundationMCPModels.some(supportedModel => 
      model.includes(supportedModel) || model.startsWith(supportedModel)
    );
  }

  private async getRemoteMCPTools(budId: string, workspaceId?: string): Promise<OpenAI.Responses.Tool.Mcp[]> {
    try {
      const mcpTools: OpenAI.Responses.Tool.Mcp[] = [];
      
      // Get bud MCP configuration
      const { data: bud } = await this.supabase
        .from('buds')
        .select('mcp_config')
        .eq('id', budId)
        .single();
      
      const mcpConfig = bud?.mcp_config as { 
        remote_servers?: Array<{
          server_label: string;
          server_url: string;
          require_approval: 'never' | 'always' | {
            never?: { tool_names: string[] };
            always?: { tool_names: string[] };
          };
          allowed_tools?: string[];
          headers?: Record<string, string>;
        }>;
        servers?: string[];
      };
      
      // 1. Add explicit remote MCP servers
      const remoteMCPServers = mcpConfig?.remote_servers || [];
      for (const server of remoteMCPServers) {
        mcpTools.push({
          type: 'mcp' as const,
          server_label: server.server_label,
          server_url: server.server_url,
          require_approval: server.require_approval || 'never',
          ...(server.allowed_tools && { allowed_tools: server.allowed_tools }),
          ...(server.headers && { headers: server.headers })
        });
      }
      
      // 2. Convert application-managed MCP servers to foundation model-managed
      if (workspaceId && mcpConfig?.servers) {
        const { data: applicationServers } = await this.supabase
          .from('mcp_servers')
          .select('*')
          .eq('workspace_id', workspaceId)
          .in('id', mcpConfig.servers);
        
        console.log('🌐 [CHATENGINE] Application servers to convert:', applicationServers?.length || 0);
        
        for (const server of applicationServers || []) {
          // Convert application-managed server to foundation model-managed MCP config
          if (server.endpoint) {
            const mcpTool = {
              type: 'mcp' as const,
              server_label: server.name.toLowerCase().replace(/\s+/g, '_'),
              server_url: server.endpoint,
              require_approval: 'never', // Default for converted servers
            };
            console.log('🌐 [CHATENGINE] Converting application server to MCP tool:', mcpTool);
            mcpTools.push(mcpTool);
          }
        }
      }
      
      console.log('🌐 [CHATENGINE] Final MCP tools config:', mcpTools);
      return mcpTools;
    } catch (error) {
      console.warn('Failed to get remote MCP tools:', error);
      return [];
    }
  }

  private async getReasoningEffort(budId?: string): Promise<'low' | 'medium' | 'high'> {
    if (!budId) return 'medium';
    
    try {
      const { data: bud } = await this.supabase
        .from('buds')
        .select('default_json')
        .eq('id', budId)
        .single();
      
      const budConfig = bud?.default_json as { reasoning_effort?: 'low' | 'medium' | 'high' };
      return budConfig?.reasoning_effort || 'medium';
    } catch (error) {
      console.warn('Failed to get bud reasoning effort:', error);
      return 'medium';
    }
  }

  /**
   * Convert ChatCompletionMessageParam[] to ResponseInputItem[] format for Responses API
   */
  private convertToResponsesInputItems(
    openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
  ): OpenAI.Responses.ResponseInputItem[] {
    const inputItems: OpenAI.Responses.ResponseInputItem[] = [];
    
    for (const message of openaiMessages) {
      // Handle different message types
      if (message.role === 'system') {
        // System messages become EasyInputMessage with system role
        inputItems.push({
          type: 'message',
          role: 'system',
          content: typeof message.content === 'string' ? message.content : 
                   Array.isArray(message.content) ? this.convertContentArray(message.content) : 
                   String(message.content)
        });
      } else if (message.role === 'user') {
        // User messages become EasyInputMessage with user role
        inputItems.push({
          type: 'message',
          role: 'user',
          content: typeof message.content === 'string' ? message.content :
                   Array.isArray(message.content) ? this.convertContentArray(message.content) :
                   String(message.content)
        });
      } else if (message.role === 'assistant') {
        // Assistant messages become EasyInputMessage with assistant role
        // Tool calls are handled separately in the Responses API
        const content = typeof message.content === 'string' ? message.content : 
                       message.content && Array.isArray(message.content) ? this.convertContentArray(message.content) :
                       String(message.content || '');
                       
        if (content) {
          inputItems.push({
            type: 'message',
            role: 'assistant',
            content: content
          });
        }
        
        // Note: Tool calls from assistant messages are not converted here
        // In the Responses API, tool calls would be separate input items
        // but they're typically generated by the model, not provided as input
      } else if (message.role === 'tool') {
        // Tool result messages need special handling
        // In Responses API, these would typically be tool outputs
        // For now, we'll convert them to user messages with clear labeling
        const toolMessage = message as OpenAI.Chat.Completions.ChatCompletionToolMessageParam;
        inputItems.push({
          type: 'message',
          role: 'user',
          content: `Tool result (${toolMessage.tool_call_id}): ${toolMessage.content}`
        });
      }
      // Skip 'function' role messages as they're deprecated
    }
    
    return inputItems;
  }

  /**
   * Convert content array from Chat Completions to Responses API format
   */
  private convertContentArray(content: unknown[]): string {
    // For now, extract text content from mixed content arrays
    // This is a simplified conversion - in a full implementation,
    // you'd want to preserve images, audio, etc. in the proper format
    return content
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          return String(item.text);
        }
        if (item && typeof item === 'object' && 'type' in item && (item as { type: string; text?: string }).type === 'text') {
          return String((item as { type: string; text?: string }).text || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
}