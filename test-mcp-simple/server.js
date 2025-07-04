#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

console.error('🚀 Simple MCP Server starting...');

const server = new Server(
  {
    name: 'simple-test-server',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// Add tool handlers using the correct API
server.listTools = async () => {
  return {
    tools: [
      {
        name: 'hello',
        description: 'Say hello',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    ]
  };
};

server.callTool = async (request) => {
  const { name } = request.params;
  
  if (name === 'hello') {
    return {
      content: [
        {
          type: 'text',
          text: 'Hello from MCP server!'
        }
      ]
    };
  }
  
  throw new Error(`Unknown tool: ${name}`);
};

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('✅ Simple MCP Server ready');