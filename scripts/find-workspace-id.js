#!/usr/bin/env node

/**
 * Script to help find workspace IDs from your database
 * 
 * Usage:
 *   node scripts/find-workspace-id.js
 */

import { createClient } from '@supabase/supabase-js';

// You'll need to set these environment variables or update them here
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log('🔍 Finding workspace IDs...\n');
  console.log('⚠️  Note: This script needs Supabase credentials to query the database.');
  console.log('   Since credentials aren\'t available, here are manual ways to find your workspace ID:\n');
  
  console.log('📋 Method 1 - Browser Dev Tools:');
  console.log('   1. Open your bud.chat app in the browser');
  console.log('   2. Open Dev Tools (F12)');
  console.log('   3. Go to Application > Local Storage');
  console.log('   4. Look for keys containing "workspace" or check the current URL\n');
  
  console.log('📋 Method 2 - Database Query:');
  console.log('   Connect to your Supabase database and run:');
  console.log('   SELECT id, name, created_at FROM workspaces ORDER BY created_at DESC;\n');
  
  console.log('📋 Method 3 - API Call:');
  console.log('   Make an authenticated request to:');
  console.log('   GET http://localhost:3000/api/workspaces\n');
  
  console.log('🔧 Then use the workspace ID with:');
  console.log('   node scripts/add-test-mcp-server.js <workspace-id>');
  
  process.exit(0);
}

async function findWorkspaces() {
  console.log('🔍 Finding workspace IDs...\n');
  
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { data: workspaces, error } = await supabase
      .from('workspaces')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    if (!workspaces || workspaces.length === 0) {
      console.log('❌ No workspaces found');
      console.log('   Create a workspace in your bud.chat app first');
      return;
    }
    
    console.log('📋 Available Workspaces:');
    console.log('─'.repeat(80));
    
    workspaces.forEach((workspace, index) => {
      console.log(`${index + 1}. ${workspace.name}`);
      console.log(`   ID: ${workspace.id}`);
      console.log(`   Created: ${new Date(workspace.created_at).toLocaleDateString()}`);
      console.log('');
    });
    
    console.log('🔧 To add the test MCP server, use:');
    console.log(`   node scripts/add-test-mcp-server.js ${workspaces[0].id}`);
    
  } catch (error) {
    console.error('❌ Error finding workspaces:', error.message);
    console.log('\n🛠️  Try the manual methods mentioned above');
  }
}

findWorkspaces();