import { Database } from './types/database';

// Database types
export type ChatMessage = Database['public']['Tables']['messages']['Row']
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type Workspace = Database['public']['Tables']['workspaces']['Row']
export type WorkspaceMember = Database['public']['Tables']['workspace_members']['Row']
export type Bud = Database['public']['Tables']['buds']['Row']

// UI Types
export type MessageId = string
export type ConversationId = string
export type WorkspaceId = string
export type BudId = string

// Optimistic Message (before saved to DB)
export interface OptimisticMessage {
  id: MessageId // temp ID like 'temp-123'
  conversation_id: ConversationId
  order_key: string
  role: MessageRole
  content: string
  json_meta: Record<string, any> & Partial<ToolCallMetadata>
  version: number
  created_at: string
  updated_at: string
  isOptimistic: true
  isPending?: boolean // for streaming messages
}

// Unified message type
export type UnifiedMessage = ChatMessage | OptimisticMessage

// Chat State Types
export interface ChatMetadata {
  id: ConversationId
  workspace_id: WorkspaceId
  created_at: string
  bud_id?: BudId
  isOptimistic?: boolean // for temp conversations
}

export interface ChatState {
  meta: ChatMetadata
  messages: MessageId[]
  byId: Record<MessageId, UnifiedMessage>
  streaming: boolean
  streamingMessageId?: MessageId
}

// Store Actions
// Removed SendMessageArgs - handled by streaming endpoint

export interface CreateChatArgs {
  workspaceId: WorkspaceId
  budId?: BudId
  systemPrompt?: string
  initialMessage?: string
}

export interface BranchChatArgs {
  originalConversationId: ConversationId
  fromMessageId: MessageId
  workspaceId: WorkspaceId
}

// Bud types
export interface BudConfig {
  name: string
  avatar?: string
  systemPrompt: string
  model: string
  temperature?: number
  maxTokens?: number
  greeting?: string
  tools?: string[]
  customTheme?: {
    name: string
    cssVariables: Record<string, string>
  }
  mcpConfig?: MCPBudConfig
}

// MCP Configuration types
export interface MCPBudConfig {
  servers?: string[] // Array of server IDs
  available_tools?: string[] // Array of "server_id.tool_name"
  disabled_tools?: string[] // Array of "server_id.tool_name" to disable
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export interface MCPConversationOverrides {
  additional_servers?: string[] // Additional server IDs to include
  disabled_tools?: string[] // Additional tools to disable
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

// UI State
export interface UIState {
  selectedWorkspace: WorkspaceId | null
  selectedConversation: ConversationId | null
  composer: {
    draft: string
    isSubmitting: boolean
  }
}

// Error types
export interface OptimisticError {
  messageId: MessageId
  error: string
  timestamp: number
}

// Streaming types
export interface StreamDelta {
  id: MessageId
  content: string
  finished?: boolean
}

export interface StreamEvent {
  type: 'messagesCreated' | 'token' | 'complete' | 'error' | 'tool_call' | 'tool_result'
  messageId?: MessageId
  userMessage?: ChatMessage
  assistantMessage?: ChatMessage
  content?: string
  error?: string
  toolCall?: ToolCallEvent
  toolResult?: ToolResultEvent
}

// MCP Tool calling types
export interface ToolCallEvent {
  id: string
  name: string
  arguments: Record<string, any>
}

export interface ToolResultEvent {
  id: string
  name: string
  result: any
  error?: string
}

// Enhanced message role to include tool messages
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

// Tool call message metadata
export interface ToolCallMetadata {
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
  is_tool_call?: boolean
  mcp_server_id?: string
}