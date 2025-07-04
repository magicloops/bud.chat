// Utility functions for handling tool call messages

import type { Message } from '@/state/simpleChatStore'
import type { ToolCall } from './ToolCallMessage'

export function isToolCallMessage(message: Message): boolean {
  return message.json_meta?.is_tool_call === true || 
         (message.json_meta?.tool_calls && Array.isArray(message.json_meta.tool_calls))
}

export function isToolResultMessage(message: Message): boolean {
  return message.json_meta?.is_tool_result === true ||
         message.json_meta?.tool_call_id !== undefined
}

export function extractToolCallsFromMessage(message: Message): ToolCall[] {
  if (!isToolCallMessage(message)) {
    return []
  }
  
  return message.json_meta?.tool_calls || []
}

export function extractToolResultFromMessage(message: Message): {
  tool_call_id: string
  tool_name: string
  content: string
  mcp_server_id?: string
} | null {
  if (!isToolResultMessage(message)) {
    return null
  }

  return {
    tool_call_id: message.json_meta?.tool_call_id,
    tool_name: message.json_meta?.tool_name,
    content: message.content,
    mcp_server_id: message.json_meta?.mcp_server_id
  }
}

export function getToolCallStatus(message: Message): 'pending' | 'executing' | 'completed' | 'error' {
  if (isToolCallMessage(message)) {
    // For tool call messages, they're always completed once saved
    return 'completed'
  }
  
  if (isToolResultMessage(message)) {
    const result = extractToolResultFromMessage(message)
    if (result?.content.startsWith('Error:')) {
      return 'error'
    }
    return 'completed'
  }
  
  return 'pending'
}