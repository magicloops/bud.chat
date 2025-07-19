// MCP helper functions for common operations
import { MCPClientManager } from './mcpClientManager';
import { MCPProxy, createMCPProxy } from './mcpProxy';
import { resolveMCPConfig, resolveMCPConfigForBud } from './mcpConfigResolver';

/**
 * Create and initialize an MCP client manager for a conversation
 */
export async function createMCPClientForConversation(
  conversationId: string,
  workspaceId: string
): Promise<MCPClientManager | MCPProxy | null> {
  try {
    const config = await resolveMCPConfig(conversationId, workspaceId);
    
    if (config.servers.length === 0) {
      console.log('No MCP servers configured for conversation');
      return null;
    }

    // Try using the direct client first, fall back to proxy if it fails
    try {
      const clientManager = new MCPClientManager(workspaceId);
      await clientManager.initialize(config.servers);
      return clientManager;
    } catch (clientError) {
      console.warn('⚠️ MCP direct client failed, falling back to proxy:', clientError.message);
      return await createMCPProxy(config.servers);
    }
  } catch (error) {
    console.error('Failed to create MCP client for conversation:', error);
    return null;
  }
}

/**
 * Create and initialize an MCP client manager for a bud
 */
export async function createMCPClientForBud(
  budId: string,
  workspaceId: string
): Promise<MCPClientManager | MCPProxy | null> {
  try {
    const config = await resolveMCPConfigForBud(budId, workspaceId);
    
    if (config.servers.length === 0) {
      console.log('No MCP servers configured for bud');
      return null;
    }

    // Try using the direct client first, fall back to proxy if it fails
    try {
      const clientManager = new MCPClientManager(workspaceId);
      await clientManager.initialize(config.servers);
      return clientManager;
    } catch (clientError) {
      console.warn('⚠️ MCP direct client failed, falling back to proxy:', clientError.message);
      return await createMCPProxy(config.servers);
    }
  } catch (error) {
    console.error('Failed to create MCP client for bud:', error);
    return null;
  }
}

/**
 * Format tool call results for display
 */
export function formatToolResult(result: any): string {
  if (typeof result === 'string') {
    return result;
  }
  
  if (typeof result === 'object' && result !== null) {
    // If it's an array of content blocks (MCP format)
    if (Array.isArray(result)) {
      return result.map(block => {
        if (block.type === 'text') {
          return block.text;
        }
        return JSON.stringify(block, null, 2);
      }).join('\n');
    }
    
    return JSON.stringify(result, null, 2);
  }
  
  return String(result);
}

/**
 * Extract server and tool name from a tool call name
 */
export function parseToolName(toolName: string): { serverId: string; toolName: string } | null {
  const parts = toolName.split('.', 2);
  if (parts.length !== 2) {
    return null;
  }
  
  return {
    serverId: parts[0],
    toolName: parts[1]
  };
}