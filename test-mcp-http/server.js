#!/usr/bin/env node

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// Create MCP server factory function
function createMCPServer() {
  const server = new McpServer({
    name: "http-calculator-server",
    version: "1.0.0"
  });

  // Add calculator tools
  server.registerTool("add", {
    title: "Addition Tool", 
    description: "Add two numbers",
    inputSchema: { a: z.number(), b: z.number() }
  }, async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }]
  }));

  server.registerTool("calculate", {
    title: "Calculator",
    description: "Perform mathematical calculations", 
    inputSchema: { expression: z.string() }
  }, async ({ expression }) => {
    try {
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
  });

  return server;
}

// Store transports by session ID
const transports = {};

// Add logging middleware
app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`)
  console.log('Headers:', req.headers)
  console.log('Body:', req.body)
  next()
})

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req, res) => {
  console.log('🔧 POST /mcp received')
  const sessionId = req.headers['mcp-session-id'];
  let transport;

  if (sessionId && transports[sessionId]) {
    // Reuse existing transport
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => Math.random().toString(36).substring(7),
      onsessioninitialized: (sessionId) => {
        transports[sessionId] = transport;
      }
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    const server = createMCPServer();
    await server.connect(transport);
  } else if (!sessionId && req.body.method === 'tools/list') {
    // Handle tools/list request without session (for OpenAI Responses API)
    console.log('📋 Handling tools/list request without session');
    
    try {
      const server = createMCPServer();
      // Simulate the tools/list response
      const tools = [
        {
          name: "add",
          title: "Addition Tool",
          description: "Add two numbers",
          input_schema: {
            type: "object",
            properties: {
              a: { type: "number", description: "First number" },
              b: { type: "number", description: "Second number" }
            },
            required: ["a", "b"],
            additionalProperties: false
          }
        },
        {
          name: "calculate",
          title: "Calculator",
          description: "Perform mathematical calculations",
          input_schema: {
            type: "object",
            properties: {
              expression: { type: "string", description: "Mathematical expression to evaluate" }
            },
            required: ["expression"],
            additionalProperties: false
          }
        }
      ];

      res.json({
        jsonrpc: '2.0',
        result: { tools },
        id: req.body.id
      });
      return;
    } catch (error) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error: ' + error.message
        },
        id: req.body.id
      });
      return;
    }
  } else {
    // Invalid request
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session ID provided and not a tools/list request',
      },
      id: req.body.id || null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// Handle GET requests for SSE
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid session ID');
    return;
  }
  
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// Handle DELETE requests for session termination
app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid session ID');
    return;
  }
  
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 HTTP MCP Server listening on port ${PORT}`);
});