import { Database } from './types/database';
import { ConversationId, WorkspaceId } from './types/branded';
// import { BudId, UserId } from './types/branded'; // Not currently used

// Re-export branded types for convenience
export type { ConversationId, WorkspaceId } from './types/branded';
export type { BudId, UserId } from './types/branded';

// Re-export Database type
export type { Database } from './types/database';

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
  reasoningConfig?: ReasoningConfig
  textGenerationConfig?: TextGenerationConfig
}

// Built-in Tools Configuration (for OpenAI's built-in tools)
export interface BuiltInToolsConfig {
  enabled_tools: string[] // Array of tool types: "web_search_preview", "code_interpreter"
  tool_settings: Record<string, Record<string, any>> // Tool-specific settings
}

// Reasoning Configuration (for OpenAI Responses API)
export interface ReasoningConfig {
  effort?: 'minimal' | 'low' | 'medium' | 'high'
  summary?: 'auto' | 'concise' | 'detailed'
}

// Text Generation Configuration (for GPT-5 series)
export interface TextGenerationConfig {
  verbosity?: 'low' | 'medium' | 'high'
}

// Remote MCP Configuration (for OpenAI-hosted MCP servers)
export interface RemoteMCPConfig {
  server_label: string;
  server_url: string;
  require_approval: 'never' | 'always' | {
    never?: { tool_names: string[] };
    always?: { tool_names: string[] };
  };
  allowed_tools?: string[];
  headers?: Record<string, string>;
}

// MCP Configuration types (actively used)
export interface MCPBudConfig {
  servers?: string[] // Array of local MCP server IDs
  remote_servers?: RemoteMCPConfig[] // Array of remote MCP server configs
  available_tools?: string[] // Array of "server_id.tool_name"
  disabled_tools?: string[] // Array of "server_id.tool_name" to disable
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export interface MCPConversationOverrides {
  additional_servers?: string[] // Additional server IDs to include
  disabled_tools?: string[] // Additional tools to disable
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

export interface ReasoningConversationOverrides {
  effort?: 'minimal' | 'low' | 'medium' | 'high'
  summary?: 'auto' | 'concise' | 'detailed'
}

export interface TextGenerationConversationOverrides {
  verbosity?: 'low' | 'medium' | 'high'
}

export interface BuiltInToolsConversationOverrides {
  enabled_tools?: string[] // Override enabled tools for this conversation
  tool_settings?: Record<string, Record<string, any>> // Tool-specific settings overrides
}

// Database types (actively used)
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type Workspace = Database['public']['Tables']['workspaces']['Row']
export type WorkspaceMember = Database['public']['Tables']['workspace_members']['Row']

// Properly typed Bud with BudConfig for default_json, MCPBudConfig for mcp_config, 
// and BuiltInToolsConfig for builtin_tools_config
export type Bud = Omit<
  Database['public']['Tables']['buds']['Row'], 
  'default_json' | 'mcp_config' | 'builtin_tools_config'
> & {
  default_json: BudConfig
  mcp_config: MCPBudConfig | null
  builtin_tools_config: BuiltInToolsConfig
}

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