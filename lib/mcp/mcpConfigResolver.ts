// MCP Configuration Resolver - Merges Bud configs with conversation overrides
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MCPServerConfig,
  MCPBudConfig,
  MCPConversationOverrides,
  ResolvedMCPConfig,
  MCPServer,
  MCPTool
} from './types';

export class MCPConfigResolver {
  constructor(private supabase: SupabaseClient) {}

  static async create(): Promise<MCPConfigResolver> {
    const supabase = await createClient();
    return new MCPConfigResolver(supabase);
  }

  async resolveConfig(
    conversationId: string,
    workspaceId: string
  ): Promise<ResolvedMCPConfig> {
    console.log(`🔧 Resolving MCP config for conversation ${conversationId} in workspace ${workspaceId}`);

    // Get conversation with source bud and overrides
    const { data: conversation, error: convError } = await this.supabase
      .from('conversations')
      .select('source_bud_id, mcp_config_overrides')
      .eq('id', conversationId)
      .single();

    if (convError) {
      console.error('Failed to fetch conversation:', convError);
      return this.getEmptyConfig();
    }

    let budMCPConfig: MCPBudConfig = {};

    // Get bud MCP config if exists
    if (conversation?.source_bud_id) {
      const { data: bud, error: budError } = await this.supabase
        .from('buds')
        .select('mcp_config')
        .eq('id', conversation.source_bud_id)
        .single();

      if (budError) {
        console.warn('Failed to fetch bud MCP config:', budError);
      } else {
        budMCPConfig = bud?.mcp_config || {};
      }
    }

    // Merge bud config with conversation overrides
    const mergedConfig = this.mergeConfigs(
      budMCPConfig,
      conversation?.mcp_config_overrides || {}
    );

    console.log('Merged MCP config:', mergedConfig);

    // Resolve server configurations
    const serverIds = this.getServerIds(mergedConfig);
    if (serverIds.length === 0) {
      console.log('No MCP servers configured');
      return this.getEmptyConfig();
    }

    const { data: servers, error: serversError } = await this.supabase
      .from('mcp_servers')
      .select(`
        *,
        mcp_tools (*)
      `)
      .in('id', serverIds)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (serversError) {
      console.error('Failed to fetch MCP servers:', serversError);
      return this.getEmptyConfig();
    }

    if (!servers || servers.length === 0) {
      console.log('No active MCP servers found');
      return this.getEmptyConfig();
    }

    const serverConfigs = servers.map(server => this.mapServerConfig(server));
    const availableTools = this.resolveAvailableTools(servers, mergedConfig);

    const resolvedConfig: ResolvedMCPConfig = {
      servers: serverConfigs,
      available_tools: availableTools,
      tool_choice: mergedConfig.tool_choice || 'auto'
    };

    console.log('✅ Resolved MCP config:', {
      serverCount: resolvedConfig.servers.length,
      toolCount: resolvedConfig.available_tools.length,
      toolChoice: resolvedConfig.tool_choice
    });

    return resolvedConfig;
  }

  async resolveConfigForBud(
    budId: string,
    workspaceId: string
  ): Promise<ResolvedMCPConfig> {
    console.log(`🔧 Resolving MCP config for bud ${budId} in workspace ${workspaceId}`);

    // Get bud MCP config
    const { data: bud, error: budError } = await this.supabase
      .from('buds')
      .select('mcp_config')
      .eq('id', budId)
      .single();

    if (budError) {
      console.error('Failed to fetch bud:', budError);
      return this.getEmptyConfig();
    }

    const budMCPConfig: MCPBudConfig = bud?.mcp_config || {};
    const serverIds = this.getServerIds(budMCPConfig);

    if (serverIds.length === 0) {
      return this.getEmptyConfig();
    }

    const { data: servers, error: serversError } = await this.supabase
      .from('mcp_servers')
      .select(`
        *,
        mcp_tools (*)
      `)
      .in('id', serverIds)
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    if (serversError || !servers) {
      console.error('Failed to fetch MCP servers:', serversError);
      return this.getEmptyConfig();
    }

    const serverConfigs = servers.map(server => this.mapServerConfig(server));
    const availableTools = this.resolveAvailableTools(servers, budMCPConfig);

    return {
      servers: serverConfigs,
      available_tools: availableTools,
      tool_choice: budMCPConfig.tool_choice || 'auto'
    };
  }

  private mergeConfigs(
    budConfig: MCPBudConfig,
    overrides: MCPConversationOverrides
  ): MCPBudConfig & MCPConversationOverrides {
    const mergedServers = [
      ...(budConfig.servers || []),
      ...(overrides.additional_servers || [])
    ];
    
    // Remove duplicates
    const uniqueServers = [...new Set(mergedServers)];

    const mergedDisabledTools = [
      ...(budConfig.disabled_tools || []),
      ...(overrides.disabled_tools || [])
    ];

    return {
      servers: uniqueServers,
      available_tools: budConfig.available_tools,
      disabled_tools: mergedDisabledTools,
      tool_choice: overrides.tool_choice || budConfig.tool_choice || 'auto',
      additional_servers: overrides.additional_servers
    };
  }

  private getServerIds(config: MCPBudConfig | (MCPBudConfig & MCPConversationOverrides)): string[] {
    return config.servers || [];
  }

  private mapServerConfig(server: MCPServer & { mcp_tools: MCPTool[] }): MCPServerConfig {
    return {
      id: server.id,
      name: server.name,
      endpoint: server.endpoint,
      transport_type: server.transport_type,
      auth_config: server.auth_config,
      connection_config: server.connection_config,
      available_tools: server.mcp_tools?.filter(t => t.is_enabled).map(t => t.name) || [],
      metadata: {
        ...server.metadata,
        tools: server.mcp_tools?.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters_schema
        })) || []
      }
    };
  }

  private resolveAvailableTools(
    servers: (MCPServer & { mcp_tools: MCPTool[] })[],
    config: MCPBudConfig | (MCPBudConfig & MCPConversationOverrides)
  ): string[] {
    // Get all tools from all servers
    const allTools: string[] = [];
    
    for (const server of servers) {
      for (const tool of server.mcp_tools) {
        if (tool.is_enabled) {
          const toolId = `${server.id}.${tool.name}`;
          allTools.push(toolId);
        }
      }
    }

    // Filter by available_tools if specified
    let availableTools = allTools;
    if (config.available_tools && config.available_tools.length > 0) {
      availableTools = allTools.filter(toolId => {
        const [serverId, toolName] = toolId.split('.', 2);
        return config.available_tools!.includes(toolId) || 
               config.available_tools!.includes(toolName);
      });
    }

    // Remove disabled tools
    const disabledTools = config.disabled_tools || [];
    availableTools = availableTools.filter(toolId => {
      const [serverId, toolName] = toolId.split('.', 2);
      return !disabledTools.includes(toolId) && !disabledTools.includes(toolName);
    });

    return availableTools;
  }

  private getEmptyConfig(): ResolvedMCPConfig {
    return {
      servers: [],
      available_tools: [],
      tool_choice: 'none'
    };
  }
}

// Convenience function for quick resolution
export async function resolveMCPConfig(
  conversationId: string,
  workspaceId: string
): Promise<ResolvedMCPConfig> {
  const resolver = await MCPConfigResolver.create();
  return resolver.resolveConfig(conversationId, workspaceId);
}

export async function resolveMCPConfigForBud(
  budId: string,
  workspaceId: string
): Promise<ResolvedMCPConfig> {
  const resolver = await MCPConfigResolver.create();
  return resolver.resolveConfigForBud(budId, workspaceId);
}