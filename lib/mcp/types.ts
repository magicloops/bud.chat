// MCP (Model Context Protocol) types and interfaces

export interface MCPServerConfig {
  id: string
  name: string
  endpoint: string
  transport_type: 'http' | 'stdio' | 'websocket'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth_config?: Record<string, any> // MCP protocol allows any JSON values for auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection_config?: Record<string, any> // MCP protocol allows any JSON values for connection
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: Record<string, any> // MCP tool schemas can be any JSON schema
}

export interface MCPToolCall {
  tool_name: string
  server_id: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: Record<string, any> // MCP tool parameters can be any JSON values
}

export interface MCPToolResult {
  tool_name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any // MCP tool results can be any type returned from external tools
  error?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> // MCP metadata can contain arbitrary tool-specific data
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters?: Record<string, any> // OpenAI function parameters can be any JSON schema
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  auth_config?: Record<string, any> // MCP auth config allows arbitrary auth parameters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connection_config?: Record<string, any> // MCP connection config allows arbitrary transport settings
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any> // MCP server metadata contains arbitrary server information
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface MCPTool {
  id: string
  server_id: string
  name: string
  description?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters_schema?: Record<string, any> // MCP tool parameter schemas can be any JSON schema
  is_enabled: boolean
  created_at: string
}