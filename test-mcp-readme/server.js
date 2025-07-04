#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Create an MCP server using the README example
const server = new McpServer({
  name: "demo-server",
  version: "1.0.0"
});

// Add an addition tool (from README)
server.registerTool("add",
  {
    title: "Addition Tool",
    description: "Add two numbers",
    inputSchema: { a: z.number(), b: z.number() }
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }]
  })
);

// Add a calculator tool for more math operations
server.registerTool("calculate",
  {
    title: "Calculator",
    description: "Perform mathematical calculations",
    inputSchema: { expression: z.string() }
  },
  async ({ expression }) => {
    try {
      // Simple eval for math expressions (safe for testing)
      const result = Function(`"use strict"; return (${expression})`)();
      return {
        content: [{ type: "text", text: `${expression} = ${result}` }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);

console.error('🚀 README MCP Server started successfully');