// MCP Streaming Handler for Tool Calls
import OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MCPClientManager } from './mcpClientManager';
import { 
  saveToolCallMessage, 
  saveToolResultMessage, 
  generateOrderKeysForToolSequence,
  formatToolResultForDisplay 
} from './messageHelpers';
import { parseToolName } from './helpers';

export interface StreamingContext {
  conversationId: string
  supabase: SupabaseClient
  mcpClient: MCPClientManager | null
  encoder: TextEncoder
  controller: ReadableStreamDefaultController<Uint8Array>
  lastOrderKey: string | null
}

export interface ToolCallState {
  toolCalls: Map<string, OpenAI.Chat.Completions.ChatCompletionMessageToolCall>
  pendingToolCalls: Set<string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolResults: Map<string, any> // MCP tool results can be any type
}

export class MCPStreamingHandler {
  private toolCallState: ToolCallState = {
    toolCalls: new Map(),
    pendingToolCalls: new Set(),
    toolResults: new Map()
  };

  constructor(private context: StreamingContext) {}

  async handleStreamChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk): Promise<void> {
    const delta = chunk.choices[0]?.delta;
    
    if (delta?.tool_calls) {
      await this.handleToolCallChunk(delta.tool_calls);
    } else if (delta?.content) {
      await this.handleContentChunk(delta.content);
    }
  }

  private async handleToolCallChunk(toolCallsChunk: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[]): Promise<void> {
    for (const toolCallDelta of toolCallsChunk) {
      if (toolCallDelta.index === undefined) continue;

      const index = toolCallDelta.index;
      const toolCallId = toolCallDelta.id;

      // Initialize or update tool call
      if (toolCallId && !this.toolCallState.toolCalls.has(toolCallId)) {
        this.toolCallState.toolCalls.set(toolCallId, {
          id: toolCallId,
          type: 'function',
          function: {
            name: toolCallDelta.function?.name || '',
            arguments: toolCallDelta.function?.arguments || ''
          }
        });
      } else if (toolCallId && this.toolCallState.toolCalls.has(toolCallId)) {
        const existingCall = this.toolCallState.toolCalls.get(toolCallId)!;
        if (toolCallDelta.function?.name) {
          existingCall.function.name += toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
          existingCall.function.arguments += toolCallDelta.function.arguments;
        }
      }

      // Send partial tool call update to client
      this.sendToClient({
        type: 'tool_call_delta',
        tool_call_id: toolCallId,
        function_name: toolCallDelta.function?.name,
        arguments_delta: toolCallDelta.function?.arguments
      });
    }
  }

  private async handleContentChunk(content: string): Promise<void> {
    // Regular content streaming
    this.sendToClient({
      type: 'content',
      content
    });
  }

  async finishToolCalls(): Promise<void> {
    if (this.toolCallState.toolCalls.size === 0) {
      return;
    }

    console.log(`🔧 Processing ${this.toolCallState.toolCalls.size} tool calls`);

    // Convert Map to Array and save assistant message with tool calls
    const toolCallsArray = Array.from(this.toolCallState.toolCalls.values());
    
    // Generate order keys for the tool call sequence
    const orderKeys = generateOrderKeysForToolSequence(
      this.context.lastOrderKey,
      toolCallsArray.length
    );

    // Save assistant message with tool calls
    await saveToolCallMessage(
      this.context.supabase,
      this.context.conversationId,
      {
        role: 'assistant',
        content: '', // Tool calls typically have empty content
        tool_calls: toolCallsArray
      },
      orderKeys.assistantOrderKey
    );

    // Execute tool calls and save results
    if (this.context.mcpClient) {
      await this.executeToolCalls(toolCallsArray, orderKeys.toolResultOrderKeys);
    } else {
      // No MCP client available - send error for each tool call
      for (let i = 0; i < toolCallsArray.length; i++) {
        const toolCall = toolCallsArray[i];
        const orderKey = orderKeys.toolResultOrderKeys[i];
        
        await saveToolResultMessage(
          this.context.supabase,
          this.context.conversationId,
          {
            role: 'tool',
            content: 'Error: MCP client not available for tool execution',
            tool_call_id: toolCall.id,
            name: toolCall.function.name
          },
          orderKey
        );
      }
    }

    // Continue with assistant response after tool calls
    this.sendToClient({
      type: 'tool_calls_complete',
      tool_call_count: toolCallsArray.length
    });
  }

  private async executeToolCalls(
    toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[],
    orderKeys: string[]
  ): Promise<void> {
    const promises = toolCalls.map(async (toolCall, index) => {
      this.toolCallState.pendingToolCalls.add(toolCall.id);
      
      try {
        console.log(`🔧 Executing tool: ${toolCall.function.name}`);
        
        // Notify client that tool execution started
        this.sendToClient({
          type: 'tool_execution_start',
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name
        });

        // Execute the tool call
        const result = await this.context.mcpClient!.executeTool({
          id: toolCall.id,
          type: 'function',
          function: toolCall.function
        });

        const orderKey = orderKeys[index];
        let resultContent: string;
        let mcpServerId: string | undefined;

        if (result.error) {
          resultContent = `Error: ${result.error}`;
          console.error(`❌ Tool execution failed: ${result.error}`);
        } else {
          resultContent = formatToolResultForDisplay(
            result.result,
            result.tool_name,
            result.error
          );
          mcpServerId = result.metadata?.server_id;
          console.log(`✅ Tool execution completed: ${result.tool_name}`);
        }

        // Save tool result message
        await saveToolResultMessage(
          this.context.supabase,
          this.context.conversationId,
          {
            role: 'tool',
            content: resultContent,
            tool_call_id: toolCall.id,
            name: toolCall.function.name
          },
          orderKey,
          mcpServerId
        );

        // Store result for potential follow-up
        this.toolCallState.toolResults.set(toolCall.id, result.result);

        // Notify client of tool completion
        this.sendToClient({
          type: 'tool_execution_complete',
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          success: !result.error,
          result: resultContent
        });

      } catch (error) {
        console.error(`❌ Tool execution error for ${toolCall.function.name}:`, error);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        const orderKey = orderKeys[index];

        // Save error as tool result
        await saveToolResultMessage(
          this.context.supabase,
          this.context.conversationId,
          {
            role: 'tool',
            content: `Error: ${errorMessage}`,
            tool_call_id: toolCall.id,
            name: toolCall.function.name
          },
          orderKey
        );

        this.sendToClient({
          type: 'tool_execution_error',
          tool_call_id: toolCall.id,
          tool_name: toolCall.function.name,
          error: errorMessage
        });
      } finally {
        this.toolCallState.pendingToolCalls.delete(toolCall.id);
      }
    });

    // Wait for all tool calls to complete
    await Promise.all(promises);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sendToClient(data: any): void { // SSE message data can be any shape
    try {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      this.context.controller.enqueue(this.context.encoder.encode(message));
    } catch (error) {
      console.error('Failed to send message to client:', error);
    }
  }

  hasActiveCalls(): boolean {
    return this.toolCallState.pendingToolCalls.size > 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getToolResults(): Map<string, any> { // MCP tool results can be any type
    return this.toolCallState.toolResults;
  }

  reset(): void {
    this.toolCallState = {
      toolCalls: new Map(),
      pendingToolCalls: new Set(),
      toolResults: new Map()
    };
  }
}