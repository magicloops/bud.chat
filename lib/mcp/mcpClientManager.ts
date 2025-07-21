// MCP Client Manager for handling connections to MCP servers
// Use .js extensions as shown in README
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import type {
  MCPServerConfig,
  MCPToolCall,
  MCPToolResult,
  OpenAITool,
  OpenAIToolCall,
} from './types';

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private serverConfigs: Map<string, MCPServerConfig> = new Map();
  private isInitialized = false;

  constructor(private workspaceId: string) {}

  async initialize(serverConfigs: MCPServerConfig[]): Promise<void> {
    console.log(`🔧 Initializing MCP clients for workspace ${this.workspaceId}:`, 
      serverConfigs.map(s => s.name));

    // Clean up existing clients first
    await this.cleanup();

    for (const config of serverConfigs) {
      try {
        const client = await this.createMCPClient(config);
        this.clients.set(config.id, client);
        this.serverConfigs.set(config.id, config);
        console.log(`✅ MCP client initialized for ${config.name}`);
      } catch (error) {
        console.error(`❌ Failed to initialize MCP client for ${config.name}:`, error);
      }
    }

    this.isInitialized = true;
  }

  async getAvailableTools(): Promise<OpenAITool[]> {
    if (!this.isInitialized) {
      console.warn('MCP clients not initialized');
      return [];
    }

    const tools: OpenAITool[] = [];

    for (const [serverId, client] of this.clients) {
      try {
        const serverConfig = this.serverConfigs.get(serverId);
        if (!serverConfig) continue;

        // List tools from the MCP server
        const { tools: mcpTools } = await client.listTools();

        for (const tool of mcpTools) {
          // Only include tools that are in available_tools list (if specified)
          const toolId = `${serverId}.${tool.name}`;
          if (serverConfig.available_tools && 
              !serverConfig.available_tools.includes(tool.name)) {
            continue;
          }

          tools.push({
            type: 'function',
            function: {
              name: toolId, // Prefix with server ID for uniqueness
              description: tool.description || `Tool ${tool.name} from ${serverConfig.name}`,
              parameters: tool.inputSchema || {}
            }
          });
        }
      } catch (error) {
        console.error(`Failed to list tools for server ${serverId}:`, error);
      }
    }

    console.log('🛠️ Available MCP tools:', tools.map(t => t.function.name));
    return tools;
  }

  async executeTool(toolCall: OpenAIToolCall): Promise<MCPToolResult> {
    const toolName = toolCall.function.name;
    const [serverId, mcpToolName] = toolName.split('.', 2);

    if (!mcpToolName) {
      return {
        tool_name: toolName,
        result: null,
        error: `Invalid tool name format: ${toolName}. Expected format: server_id.tool_name`
      };
    }

    const client = this.clients.get(serverId);
    if (!client) {
      return {
        tool_name: toolName,
        result: null,
        error: `MCP server ${serverId} not found or not initialized`
      };
    }

    try {
      console.log(`🔧 Executing MCP tool: ${toolName}`);
      
      let parameters: Record<string, unknown> = {};
      try {
        parameters = JSON.parse(toolCall.function.arguments || '{}');
      } catch (parseError) {
        return {
          tool_name: toolName,
          result: null,
          error: `Invalid JSON in tool arguments: ${toolCall.function.arguments}`
        };
      }

      const result = await client.callTool({
        name: mcpToolName,
        arguments: parameters
      });

      console.log(`✅ MCP tool ${toolName} executed successfully`);
      
      return {
        tool_name: toolName,
        result: result.content,
        metadata: {
          server_id: serverId,
          tool_call_id: toolCall.id
        }
      };
    } catch (error) {
      console.error(`❌ MCP tool execution failed for ${toolName}:`, error);
      return {
        tool_name: toolName,
        result: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async testConnection(serverId: string): Promise<{ success: boolean; error?: string; tools?: string[] }> {
    const client = this.clients.get(serverId);
    if (!client) {
      return { success: false, error: 'Client not found' };
    }

    try {
      const { tools } = await client.listTools();
      return { 
        success: true, 
        tools: tools.map(t => t.name) 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  async cleanup(): Promise<void> {
    console.log(`🧹 Cleaning up MCP clients for workspace ${this.workspaceId}`);
    
    for (const [serverId, client] of this.clients) {
      try {
        await client.close();
        console.log(`✅ Closed MCP client for server ${serverId}`);
      } catch (error) {
        console.error(`Failed to close MCP client for server ${serverId}:`, error);
      }
    }

    this.clients.clear();
    this.serverConfigs.clear();
    this.isInitialized = false;
  }

  private async createMCPClient(config: MCPServerConfig): Promise<Client> {
    console.log(`Creating MCP client for ${config.name} (${config.transport_type})`);

    let transport;
    
    switch (config.transport_type) {
      case 'stdio':
        if (typeof config.endpoint !== 'string') {
          throw new Error('Stdio transport requires endpoint to be a command string');
        }
        // Parse command and args from endpoint
        const [command, ...args] = config.endpoint.split(' ');
        console.log('🔧 Stdio transport config:', { command, args, endpoint: config.endpoint });
        transport = new StdioClientTransport({
          command,
          args,
          env: config.connection_config?.env || process.env
        });
        break;

      case 'http':
        transport = new StreamableHTTPClientTransport(
          new URL(config.endpoint)
        );
        break;

      case 'websocket':
        transport = new WebSocketClientTransport(
          new URL(config.endpoint)
        );
        break;

      default:
        throw new Error(`Unsupported transport type: ${config.transport_type}`);
    }

    const client = new Client({
      name: `bud-chat-${this.workspaceId}`,
      version: '1.0.0'
    }, {
      capabilities: {
        tools: {}
      }
    });

    try {
      await client.connect(transport);
      console.log('🔗 MCP client connected to transport');
      
      // For HTTP transport, initialization is handled automatically by the transport
      // For stdio transport, we need to handle it manually
      if (config.transport_type === 'stdio') {
        console.log('🔄 Sending initialize request for stdio transport...');
        
        // Connect using the modern MCP SDK pattern
        await client.connect(transport);
        console.log('✅ MCP client connected successfully');
        
        console.log('✅ MCP client fully initialized and ready for tool calls');
      } else {
        console.log('✅ HTTP transport connected and initialized automatically');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ MCP initialization failed:', errorMessage);
      console.error('❌ Error details:', error);
      throw error;
    }

    return client;
  }

  get isReady(): boolean {
    return this.isInitialized && this.clients.size > 0;
  }

  get connectedServers(): string[] {
    return Array.from(this.clients.keys());
  }
}