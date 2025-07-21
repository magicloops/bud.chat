// Script to add the test MCP server to the database
// Run this after starting the dev server with: node add-test-mcp-server.js

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function addMCPServer() {
  // You'll need to replace these with actual values from your workspace
  const WORKSPACE_ID = 'YOUR_WORKSPACE_ID'; // Replace with real workspace ID
  const BASE_URL = 'http://localhost:3000'; // Adjust if your dev server runs on different port
  
  console.log('🔧 Adding test MCP server to database...');
  
  // Get the absolute path to the test server
  const serverPath = resolve(__dirname, 'test-mcp-server', 'server.js');
  
  const serverConfig = {
    workspaceId: WORKSPACE_ID,
    name: 'JavaScript Eval Test Server',
    endpoint: `node ${serverPath}`,
    transport_type: 'stdio',
    metadata: {
      description: 'A test MCP server that can execute JavaScript code safely',
      tools: [
        'eval_javascript',
        'calculate', 
        'array_operations'
      ]
    }
  };
  
  try {
    const response = await fetch(`${BASE_URL}/api/mcp/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // You'll need to add authentication headers here
        // 'Authorization': 'Bearer YOUR_TOKEN'
      },
      body: JSON.stringify(serverConfig)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    const result = await response.json();
    console.log('✅ Test MCP server added successfully:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n🎯 Next steps:');
    console.log('1. Configure a Bud to use this MCP server');
    console.log('2. Start a conversation and try asking to calculate something');
    console.log('3. Example: "Calculate 2 + 2 * 3" or "Find the sum of [1, 2, 3, 4, 5]"');
    
  } catch (error) {
    console.error('❌ Failed to add MCP server:', error.message);
    console.log('\n🔧 Manual setup instructions:');
    console.log('1. Start your dev server: pnpm run dev');
    console.log('2. Use the MCP servers API to add the server:');
    console.log('   POST /api/mcp/servers');
    console.log('   Body:', JSON.stringify(serverConfig, null, 2));
  }
}

// Check if this script is being run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  addMCPServer();
}

export { addMCPServer };