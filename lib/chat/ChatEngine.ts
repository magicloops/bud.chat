// Shared Chat Engine - consolidates common logic between chat routes
// Handles provider detection, streaming, tool execution, and event management

import { EventStreamBuilder } from '@/lib/streaming/eventBuilder';
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
        const existingEvents = await this.config.eventLoader(request.conversationId);
        messages = [...existingEvents, createTextEvent('user', request.message)];
      } else {
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
    const eventBuilder = new EventStreamBuilder('assistant');
    let createdConversationId: string | null = null;
    let eventFinalized = false;
    
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
      
      // Check if we have tool calls to execute
      const finalEvent = eventLog.getLastEvent();
      const toolCallSegments = finalEvent?.segments.filter(s => s.type === 'tool_call') || [];
      
      // If no tool calls, we're done
      if (toolCallSegments.length === 0) {
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
    // TODO: Implement tool support for OpenAI Responses API
    // const tools: OpenAI.ChatCompletionTool[] = [];
    // if (validatedRequest.budId) {
    //   tools = await this.getOpenAITools(validatedRequest.budId, validatedRequest.workspaceId);
    // }
    
    // Determine reasoning effort based on model and bud config
    let reasoningEffort: 'low' | 'medium' | 'high' | undefined;
    if (supportsReasoningEffort(validatedRequest.model)) {
      reasoningEffort = await this.getReasoningEffort(validatedRequest.budId);
    }
    
    // Use OpenAI Responses API for o-series models  
    const responsesRequest = {
      model: apiModelName,
      input: openaiMessages.map(msg => {
        if (typeof msg.content === 'string') {
          return msg.content;
        }
        return JSON.stringify(msg.content);
      }).join('\n'),
      stream: true as const,
      reasoning: { 
        effort: reasoningEffort || 'medium',
        summary: 'auto' as const  // Enable reasoning summaries
      }
    };
    
    console.log('🔄 Sending request to OpenAI Responses API:', JSON.stringify(responsesRequest, null, 2));
    
    const stream = await this.openai.responses.create(responsesRequest);
    
    console.log('📡 OpenAI Responses API stream created, starting to process...');
    
    // Process the Responses API stream with reasoning events
    const responsesStream = processResponsesAPIStream(stream);
    const encoder = new TextEncoder();
    
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
          
          // Handle specific reasoning events
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
          
          // Save assistant event to database if in individual mode
          if (this.config.streamingMode === 'individual' && this.config.eventSaver && conversationId) {
            await this.config.eventSaver(builtEvent, conversationId);
          }
          
          eventFinalized = true; // Mark as finalized to prevent duplicates
        }
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
}