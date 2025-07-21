import { createClient } from '@/lib/supabase/server';
import { Database } from '@/lib/types/database';

// MCP Client interface (based on @modelcontextprotocol/sdk)
interface MCPClient {
  connect(transport: any): Promise<void>;
  close(): Promise<void>;
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<any>;
  listTools(): Promise<{ tools?: any[] }>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: object;
}

export interface ToolResult {
  id: string;
  output: object;
  error?: string;
}

export class MCPToolExecutor {
  private static readonly MAX_TOOL_RESULT_LENGTH = 50000;

  constructor(private options: {
    debug?: boolean;
  } = {}) {}

  /**
   * Execute MCP tool calls with unified error handling and result processing
   */
  async executeToolCalls(
    toolCalls: ToolCall[],
    workspaceId: string,
    budId?: string
  ): Promise<ToolResult[]> {
    if (this.options.debug) {
      console.log('🔧 Executing MCP tool calls:', {
        count: toolCalls.length,
        workspaceId,
        budId,
        toolNames: toolCalls.map(t => t.name)
      });
    }

    // Early return if no bud configuration
    if (!budId) {
      return this.createErrorResults(toolCalls, 'No MCP configuration available');
    }

    try {
      // Get MCP configuration
      const mcpConfig = await this.getMCPConfiguration(budId, workspaceId);
      if (!mcpConfig) {
        throw new Error('No MCP servers configured');
      }

      // Execute tool calls
      return await this.executeMCPCalls(toolCalls, mcpConfig);

    } catch (error) {
      console.error('❌ MCP execution failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.createErrorResults(toolCalls, errorMessage);
    }
  }

  /**
   * Get MCP configuration for a bud and workspace
   */
  private async getMCPConfiguration(budId: string, workspaceId: string): Promise<{
    servers: Database['public']['Tables']['mcp_servers']['Row'][];
    config: Record<string, unknown>;
  } | null> {
    const supabase = await createClient();
    
    // Get bud and MCP configuration
    const { data: bud, error: budError } = await supabase
      .from('buds')
      .select('*, mcp_config')
      .eq('id', budId)
      .single();

    if (!bud || budError || !bud.mcp_config?.servers?.length) {
      return null;
    }

    // Get MCP servers
    const { data: servers, error: serversError } = await supabase
      .from('mcp_servers')
      .select('*')
      .in('id', bud.mcp_config.servers)
      .eq('workspace_id', workspaceId);

    if (!servers || serversError || servers.length === 0) {
      return null;
    }

    return {
      servers,
      config: bud.mcp_config
    };
  }

  /**
   * Execute tool calls against MCP servers
   */
  private async executeMCPCalls(
    toolCalls: ToolCall[],
    mcpConfig: { servers: Database['public']['Tables']['mcp_servers']['Row'][]; config: Record<string, unknown> }
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    
    // Dynamic imports for MCP SDK
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    
    // Connect to MCP server (using first server for now)
    const server = mcpConfig.servers[0];
    const transport = new StreamableHTTPClientTransport(new URL(server.endpoint));
    const mcpClient = new Client({
      name: 'bud-chat-client',
      version: '1.0.0'
    }, {
      capabilities: { tools: {} }
    });
    
    try {
      await mcpClient.connect(transport);
      
      // Execute each tool call
      for (const toolCall of toolCalls) {
        const result = await this.executeToolCall(mcpClient, toolCall);
        results.push(result);
      }
      
    } finally {
      // Always close the connection
      try {
        await mcpClient.close();
      } catch (closeError) {
        console.warn('⚠️ Error closing MCP client:', closeError);
      }
    }
    
    return results;
  }

  /**
   * Execute a single tool call
   */
  private async executeToolCall(mcpClient: MCPClient, toolCall: ToolCall): Promise<ToolResult> {
    try {
      if (this.options.debug) {
        console.log('🔧 Executing tool call:', {
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
          argsType: typeof toolCall.args
        });
      }
      
      const result = await mcpClient.callTool({
        name: toolCall.name,
        arguments: (toolCall.args || {}) as Record<string, unknown>
      });
      
      // Process result content
      let output = result.content;
      if (Array.isArray(output)) {
        output = output.map(block => 
          block.type === 'text' ? block.text : JSON.stringify(block)
        ).join('\n');
      }
      
      // Truncate very large tool results
      if (typeof output === 'string' && output.length > MCPToolExecutor.MAX_TOOL_RESULT_LENGTH) {
        if (this.options.debug) {
          console.log('⚠️ Tool result too large, truncating from', output.length, 'to', MCPToolExecutor.MAX_TOOL_RESULT_LENGTH);
        }
        output = output.substring(0, MCPToolExecutor.MAX_TOOL_RESULT_LENGTH) + '\n\n[Content truncated due to length...]';
      }
      
      return {
        id: toolCall.id,
        output: { content: output }
      };
      
    } catch (toolError) {
      console.error('❌ Tool execution failed:', toolError);
      const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);
      
      return {
        id: toolCall.id,
        output: { error: errorMessage },
        error: errorMessage
      };
    }
  }

  /**
   * Create error results for all tool calls
   */
  private createErrorResults(toolCalls: ToolCall[], errorMessage: string): ToolResult[] {
    return toolCalls.map(call => ({
      id: call.id,
      output: { error: errorMessage },
      error: errorMessage
    }));
  }

  /**
   * Get available tools for a workspace and bud
   */
  async getAvailableTools(workspaceId: string, budId?: string): Promise<any[]> {
    if (!budId) {
      return [];
    }

    try {
      const mcpConfig = await this.getMCPConfiguration(budId, workspaceId);
      if (!mcpConfig) {
        return [];
      }

      // Dynamic imports for MCP SDK
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      
      const server = mcpConfig.servers[0];
      const transport = new StreamableHTTPClientTransport(new URL(server.endpoint));
      const mcpClient = new Client({
        name: 'bud-chat-client',
        version: '1.0.0'
      }, {
        capabilities: { tools: {} }
      });
      
      try {
        await mcpClient.connect(transport);
        const tools = await mcpClient.listTools();
        return tools.tools || [];
      } finally {
        await mcpClient.close();
      }
      
    } catch (error) {
      console.error('❌ Failed to get available tools:', error);
      return [];
    }
  }
}