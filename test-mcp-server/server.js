#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Simple sandbox for JavaScript evaluation
function createSandbox() {
  // Create a limited context for eval
  const sandbox = {
    console: {
      log: (...args) => args.join(' '),
      error: (...args) => 'Error: ' + args.join(' '),
      warn: (...args) => 'Warning: ' + args.join(' '),
      info: (...args) => 'Info: ' + args.join(' ')
    },
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    // Add some utility functions
    sum: (arr) => arr.reduce((a, b) => a + b, 0),
    avg: (arr) => arr.reduce((a, b) => a + b, 0) / arr.length,
    max: (arr) => Math.max(...arr),
    min: (arr) => Math.min(...arr)
  };
  
  return sandbox;
}

function safeEval(code, sandbox) {
  try {
    // Create a function with the sandbox as context
    const func = new Function(...Object.keys(sandbox), `
      "use strict";
      // Prevent access to global objects
      const global = undefined;
      const globalThis = undefined;
      const window = undefined;
      const process = undefined;
      const require = undefined;
      const module = undefined;
      const exports = undefined;
      
      // Execute the code
      return (function() {
        ${code}
      })();
    `);
    
    const result = func(...Object.values(sandbox));
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Create the server
const server = new Server(
  {
    name: 'javascript-eval-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// List available tools
server.listTools = async () => {
  return {
    tools: [
      {
        name: 'eval_javascript',
        description: 'Execute JavaScript code in a sandboxed environment. Supports basic JavaScript operations, Math, Date, JSON, and utility functions like sum(), avg(), max(), min().',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript code to execute'
            }
          },
          required: ['code']
        }
      },
      {
        name: 'calculate',
        description: 'Perform mathematical calculations using JavaScript expressions',
        inputSchema: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Mathematical expression to evaluate (e.g., "2 + 2 * 3")'
            }
          },
          required: ['expression']
        }
      },
      {
        name: 'array_operations',
        description: 'Perform operations on arrays of numbers',
        inputSchema: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['sum', 'average', 'max', 'min', 'sort'],
              description: 'Operation to perform on the array'
            },
            numbers: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of numbers to operate on'
            }
          },
          required: ['operation', 'numbers']
        }
      }
    ]
  };
};

// Handle tool calls
server.callTool = async (request) => {
  const { name, arguments: args } = request.params;
  
  console.error(`🔧 Tool called: ${name} with args:`, JSON.stringify(args));
  
  try {
    switch (name) {
      case 'eval_javascript': {
        const { code } = args;
        if (!code || typeof code !== 'string') {
          throw new Error('Code parameter is required and must be a string');
        }
        
        const sandbox = createSandbox();
        const result = safeEval(code, sandbox);
        
        if (result.success) {
          const output = result.result !== undefined ? String(result.result) : 'undefined';
          return {
            content: [
              {
                type: 'text',
                text: `JavaScript executed successfully:\n\`\`\`\n${code}\n\`\`\`\n\n**Result:** ${output}`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `JavaScript execution failed:\n\`\`\`\n${code}\n\`\`\`\n\n**Error:** ${result.error}`
              }
            ]
          };
        }
      }
      
      case 'calculate': {
        const { expression } = args;
        if (!expression || typeof expression !== 'string') {
          throw new Error('Expression parameter is required and must be a string');
        }
        
        const sandbox = createSandbox();
        const result = safeEval(`return ${expression}`, sandbox);
        
        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: `**Expression:** ${expression}\n**Result:** ${result.result}`
              }
            ]
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `**Expression:** ${expression}\n**Error:** ${result.error}`
              }
            ]
          };
        }
      }
      
      case 'array_operations': {
        const { operation, numbers } = args;
        if (!operation || !numbers || !Array.isArray(numbers)) {
          throw new Error('Operation and numbers array are required');
        }
        
        let result;
        switch (operation) {
          case 'sum':
            result = numbers.reduce((a, b) => a + b, 0);
            break;
          case 'average':
            result = numbers.reduce((a, b) => a + b, 0) / numbers.length;
            break;
          case 'max':
            result = Math.max(...numbers);
            break;
          case 'min':
            result = Math.min(...numbers);
            break;
          case 'sort':
            result = [...numbers].sort((a, b) => a - b);
            break;
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `**Operation:** ${operation}\n**Input:** [${numbers.join(', ')}]\n**Result:** ${Array.isArray(result) ? `[${result.join(', ')}]` : result}`
            }
          ]
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`❌ Tool execution error:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `Error executing tool ${name}: ${error.message}`
        }
      ]
    };
  }
};

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 JavaScript Eval MCP Server started');
}

main().catch((error) => {
  console.error('❌ Server failed to start:', error);
  process.exit(1);
});