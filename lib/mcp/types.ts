// MCP (Model Context Protocol) types and interfaces

export interface MCPServerConfig {
  id: string
  name: string
  endpoint: string
  transport_type: 'http' | 'stdio' | 'websocket'
  auth_config?: Record<string, any>
  connection_config?: Record<string, any>
  available_tools?: string[]
  metadata?: {
    name?: string
    version?: string
    description?: string
    tools?: MCPToolInfo[]
  }
}

export interface MCPToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, any>
}

export interface MCPToolCall {
  tool_name: string
  server_id: string
  parameters: Record<string, any>
}

export interface MCPToolResult {
  tool_name: string
  result: any
  error?: string
  metadata?: Record<string, any>
}

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

export interface ResolvedMCPConfig {
  servers: MCPServerConfig[]
  available_tools: string[]
  tool_choice: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } }
}

// OpenAI function calling integration types
export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, any>
  }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

// Database types
export interface MCPServer {
  id: string
  workspace_id: string
  name: string
  endpoint: string
  transport_type: 'http' | 'stdio' | 'websocket'
  auth_config?: Record<string, any>
  connection_config?: Record<string, any>
  metadata?: Record<string, any>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MCPTool {
  id: string
  server_id: string
  name: string
  description?: string
  parameters_schema?: Record<string, any>
  is_enabled: boolean
  created_at: string
}