import { Database } from './types/database';

// Bud Configuration (actively used) - defined first for type dependency
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

// MCP Configuration types (actively used)
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

// Database types (actively used)
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type Workspace = Database['public']['Tables']['workspaces']['Row']
export type WorkspaceMember = Database['public']['Tables']['workspace_members']['Row']

// Properly typed Bud with BudConfig for default_json
export type Bud = Omit<Database['public']['Tables']['buds']['Row'], 'default_json'> & {
  default_json: BudConfig
}

// UI Types (actively used)
export type ConversationId = string
export type WorkspaceId = string
export type BudId = string

// Message Role (still used in MCP)
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

// Tool call message metadata (used in MCP)
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

// UI State (still used in workspace store)
export interface UIState {
  selectedWorkspace: WorkspaceId | null
  selectedConversation: ConversationId | null
  composer: {
    draft: string
    isSubmitting: boolean
  }
}