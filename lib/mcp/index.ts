// MCP (Model Context Protocol) integration exports

export { MCPClientManager } from './mcpClientManager';
export { MCPConfigResolver, resolveMCPConfig, resolveMCPConfigForBud } from './mcpConfigResolver';
export * from './types';

// Convenience functions for common operations
export { createMCPClientForConversation, createMCPClientForBud } from './helpers';