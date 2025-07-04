#!/usr/bin/env node

/**
 * Script to add the JavaScript Eval test MCP server to your bud.chat workspace
 * 
 * Usage:
 *   node scripts/add-test-mcp-server.js <workspace-id>
 * 
 * Example:
 *   node scripts/add-test-mcp-server.js 123e4567-e89b-12d3-a456-426614174000
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Get workspace ID from command line
const workspaceId = process.argv[2];

if (!workspaceId) {
  console.error('❌ Error: Workspace ID is required');
  console.log('\nUsage:');
  console.log('  node scripts/add-test-mcp-server.js <workspace-id>');
  console.log('\nExample:');
  console.log('  node scripts/add-test-mcp-server.js 123e4567-e89b-12d3-a456-426614174000');
  console.log('\nTo find your workspace ID:');
  console.log('  1. Open your browser dev tools');
  console.log('  2. Go to Application > Local Storage');
  console.log('  3. Look for workspace-related data');
  console.log('  4. Or check the URL when you\'re in a workspace');
  process.exit(1);
}

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const serverPath = resolve(__dirname, '..', 'test-mcp-server', 'server.js');

async function addTestMCPServer() {
  console.log('🔧 Adding JavaScript Eval test MCP server...');
  console.log(`📁 Server path: ${serverPath}`);
  console.log(`🌐 API URL: ${BASE_URL}`);
  console.log(`🏢 Workspace ID: ${workspaceId}`);
  
  const serverConfig = {
    workspaceId: workspaceId,
    name: 'JavaScript Eval Test Server',
    endpoint: `node ${serverPath}`,
    transport_type: 'stdio',
    auth_config: null,
    connection_config: null,
    metadata: {
      description: 'A test MCP server that can execute JavaScript code safely',
      version: '1.0.0',
      tools: [
        'eval_javascript',
        'calculate', 
        'array_operations'
      ],
      capabilities: [
        'JavaScript execution in sandboxed environment',
        'Mathematical calculations',
        'Array operations (sum, average, min, max, sort)'
      ]
    }
  };
  
  try {
    console.log('\n📡 Making API request...');
    
    const response = await fetch(`${BASE_URL}/api/mcp/servers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(serverConfig)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      
      throw new Error(`HTTP ${response.status}: ${errorMessage}`);
    }
    
    const result = await response.json();
    
    console.log('✅ Test MCP server added successfully!');
    console.log('\n📋 Server Details:');
    console.log(`   ID: ${result.data.id}`);
    console.log(`   Name: ${result.data.name}`);
    console.log(`   Endpoint: ${result.data.endpoint}`);
    console.log(`   Transport: ${result.data.transport_type}`);
    console.log(`   Active: ${result.data.is_active}`);
    
    console.log('\n🎯 Next Steps:');
    console.log('1. Open your bud.chat app');
    console.log('2. Create or edit a Bud');
    console.log('3. Scroll to "Tool Integration" section');
    console.log('4. Select "JavaScript Eval Test Server"');
    console.log('5. Set Tool Choice to "Auto"');
    console.log('6. Save the Bud');
    console.log('7. Start a conversation and try these prompts:');
    console.log('   • "Calculate 15% of 250"');
    console.log('   • "Find the sum of [1, 2, 3, 4, 5]"');
    console.log('   • "Execute: Math.sqrt(144)"');
    
    console.log('\n🧪 Test the server connection:');
    console.log(`   curl -X POST ${BASE_URL}/api/mcp/servers/${result.data.id}/test`);
    
  } catch (error) {
    console.error('\n❌ Failed to add MCP server:');
    console.error(`   Error: ${error.message}`);
    
    if (error.message.includes('Unauthorized')) {
      console.log('\n🔐 Authentication Issue:');
      console.log('   Make sure your dev server is running with proper auth');
      console.log('   You might need to be logged in or add auth headers');
    } else if (error.message.includes('Workspace not found')) {
      console.log('\n🏢 Workspace Issue:');
      console.log('   Check that the workspace ID is correct');
      console.log('   Make sure you have access to this workspace');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.log('\n🌐 Connection Issue:');
      console.log('   Make sure your dev server is running:');
      console.log('   pnpm run dev');
    }
    
    console.log('\n🛠️  Manual Setup Alternative:');
    console.log('   You can add the server directly via SQL:');
    console.log('   INSERT INTO mcp_servers (workspace_id, name, endpoint, transport_type, metadata, is_active)');
    console.log(`   VALUES ('${workspaceId}', 'JavaScript Eval Test Server', 'node ${serverPath}', 'stdio', '${JSON.stringify(serverConfig.metadata)}', true);`);
    
    process.exit(1);
  }
}

// Check if server file exists
try {
  readFileSync(serverPath);
} catch (error) {
  console.error('❌ Test MCP server not found!');
  console.log(`   Expected: ${serverPath}`);
  console.log('\n🔧 Setup the test server first:');
  console.log('   cd test-mcp-server');
  console.log('   pnpm install');
  process.exit(1);
}

// Run the script
addTestMCPServer();