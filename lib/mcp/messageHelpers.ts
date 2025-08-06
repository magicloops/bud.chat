// MCP Tool Call Message Helpers
// import { createClient } from '@/lib/supabase/server'; // Not currently used
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateKeyBetween } from 'fractional-indexing';
import type { MessageRole, ToolCallMetadata } from '@/lib/types';

export interface ToolCallMessage {
  role: 'assistant'
  content?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface ToolResultMessage {
  role: 'tool'
  content: string
  tool_call_id: string
  name: string
}

export async function saveToolCallMessage(
  supabase: SupabaseClient,
  conversationId: string,
  message: ToolCallMessage,
  orderKey: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: any }> { // Supabase query result type
  console.log(`💾 Saving tool call message for conversation ${conversationId}`);

  const messageData = {
    conversation_id: conversationId,
    role: message.role as MessageRole,
    content: message.content || '',
    order_key: orderKey,
    json_meta: {
      tool_calls: message.tool_calls,
      is_tool_call: true,
      tool_call_count: message.tool_calls?.length || 0
    } as ToolCallMetadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const result = await supabase
    .from('messages')
    .insert(messageData)
    .select()
    .single();

  if (result.error) {
    console.error('Failed to save tool call message:', result.error);
  } else {
    console.log(`✅ Tool call message saved with ID: ${result.data?.id}`);
  }

  return result;
}

export async function saveToolResultMessage(
  supabase: SupabaseClient,
  conversationId: string,
  message: ToolResultMessage,
  orderKey: string,
  mcpServerId?: string
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: any }> { // Supabase query result type
  console.log(`💾 Saving tool result message for conversation ${conversationId}`);

  const messageData = {
    conversation_id: conversationId,
    role: message.role as MessageRole,
    content: message.content,
    order_key: orderKey,
    json_meta: {
      tool_call_id: message.tool_call_id,
      tool_name: message.name,
      is_tool_result: true,
      mcp_server_id: mcpServerId
    } as ToolCallMetadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const result = await supabase
    .from('messages')
    .insert(messageData)
    .select()
    .single();

  if (result.error) {
    console.error('Failed to save tool result message:', result.error);
  } else {
    console.log(`✅ Tool result message saved with ID: ${result.data?.id}`);
  }

  return result;
}

export async function updateMessageWithToolCalls(
  supabase: SupabaseClient,
  messageId: string,
  toolCalls: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ data: any; error: any }> { // Supabase query result type
  console.log(`🔧 Updating message ${messageId} with tool calls`);

  const result = await supabase
    .from('messages')
    .update({
      json_meta: {
        tool_calls: toolCalls,
        is_tool_call: true,
        tool_call_count: toolCalls.length
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', messageId)
    .select()
    .single();

  if (result.error) {
    console.error('Failed to update message with tool calls:', result.error);
  }

  return result;
}

export function generateOrderKeysForToolSequence(
  lastOrderKey: string | null,
  toolCallCount: number
): {
  assistantOrderKey: string
  toolResultOrderKeys: string[]
  nextAssistantOrderKey: string
} {
  // Generate order key for the assistant message with tool calls
  const assistantOrderKey = generateKeyBetween(lastOrderKey, null);
  
  // Generate order keys for each tool result
  let currentKey = assistantOrderKey;
  const toolResultOrderKeys: string[] = [];
  
  for (let i = 0; i < toolCallCount; i++) {
    const toolResultKey = generateKeyBetween(currentKey, null);
    toolResultOrderKeys.push(toolResultKey);
    currentKey = toolResultKey;
  }
  
  // Generate order key for the next assistant message (after tool results)
  const nextAssistantOrderKey = generateKeyBetween(currentKey, null);
  
  return {
    assistantOrderKey,
    toolResultOrderKeys,
    nextAssistantOrderKey
  };
}

export function formatToolCallForDisplay(toolCall: {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}): string {
  try {
    const args = JSON.parse(toolCall.function.arguments);
    return `🔧 **${toolCall.function.name}**\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
  } catch (_error) {
    return `🔧 **${toolCall.function.name}**\n\`\`\`\n${toolCall.function.arguments}\n\`\`\``;
  }
}

export function formatToolResultForDisplay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolResult: any, // MCP tool results can be any type
  toolName: string,
  error?: string
): string {
  if (error) {
    return `❌ **${toolName}** failed: ${error}`;
  }

  if (typeof toolResult === 'string') {
    return `✅ **${toolName}**:\n${toolResult}`;
  }

  if (Array.isArray(toolResult)) {
    // Handle MCP content blocks
    return `✅ **${toolName}**:\n${toolResult.map(block => {
      if (block.type === 'text') {
        return block.text;
      }
      return JSON.stringify(block, null, 2);
    }).join('\n')}`;
  }

  if (typeof toolResult === 'object' && toolResult !== null) {
    return `✅ **${toolName}**:\n\`\`\`json\n${JSON.stringify(toolResult, null, 2)}\n\`\`\``;
  }

  return `✅ **${toolName}**: ${String(toolResult)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isToolCallMessage(message: any): boolean { // Legacy message format
  return message.json_meta?.is_tool_call === true || 
         (message.json_meta?.tool_calls && Array.isArray(message.json_meta.tool_calls));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isToolResultMessage(message: any): boolean { // Legacy message format
  return message.json_meta?.is_tool_result === true ||
         message.json_meta?.tool_call_id !== undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractToolCallsFromMessage(message: any): Array<{ // Legacy message format
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}> {
  return message.json_meta?.tool_calls || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractToolResultFromMessage(message: any): { // Legacy message format
  tool_call_id: string
  tool_name: string
  content: string
  mcp_server_id?: string
} | null {
  if (!isToolResultMessage(message)) {
    return null;
  }

  return {
    tool_call_id: message.json_meta?.tool_call_id,
    tool_name: message.json_meta?.tool_name,
    content: message.content,
    mcp_server_id: message.json_meta?.mcp_server_id
  };
}