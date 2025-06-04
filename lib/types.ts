import { Database } from './types/database'

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
  role: 'user' | 'assistant' | 'system'
  content: string
  json_meta: Record<string, any>
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
  tools?: string[]
  greeting?: string
}

// UI State
export interface UIState {
  sidebarOpen: boolean
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
  type: 'messagesCreated' | 'token' | 'complete' | 'error'
  messageId?: MessageId
  userMessage?: ChatMessage
  assistantMessage?: ChatMessage
  content?: string
  error?: string
}