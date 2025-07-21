#!/usr/bin/env node

// Script to add DeepWiki MCP server to our database
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const addDeepWikiServer = async () => {
  console.log('🔧 Adding DeepWiki MCP server to database...');

  try {
    // First, let's get a workspace to add this to
    // We'll use the workspace from the logs: 84d1959d-f82b-45c5-a6a7-a0a110e198c9
    const workspaceId = '84d1959d-f82b-45c5-a6a7-a0a110e198c9';

    // Check if workspace exists
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id, name')
      .eq('id', workspaceId)
      .single();

    if (workspaceError || !workspace) {
      console.error('❌ Workspace not found:', workspaceId);
      console.error('Available workspaces:');
      
      const { data: workspaces } = await supabase
        .from('workspaces')
        .select('id, name')
        .limit(5);
      
      workspaces?.forEach(ws => {
        console.log(`  - ${ws.name} (${ws.id})`);
      });
      return;
    }

    console.log('✅ Found workspace:', workspace.name);

    // Check if DeepWiki server already exists
    const { data: existingServer } = await supabase
      .from('mcp_servers')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .eq('name', 'DeepWiki')
      .single();

    if (existingServer) {
      console.log('⚠️ DeepWiki server already exists:', existingServer.id);
      return;
    }

    // Add DeepWiki MCP server
    const deepWikiServer = {
      workspace_id: workspaceId,
      name: 'DeepWiki',
      endpoint: 'https://mcp.deepwiki.com/mcp',
      transport_type: 'http',
      metadata: {
        description: 'DeepWiki MCP server for GitHub repository analysis',
        version: '1.0.0',
        tools: ['ask_question', 'read_wiki_structure'],
        capabilities: [
          'GitHub repository analysis',
          'Code documentation search',
          'Repository structure reading'
        ],
        server_label: 'deepwiki',
        require_approval: 'never',
        official: true,
        provider: 'DeepWiki'
      }
    };

    const { data: server, error: serverError } = await supabase
      .from('mcp_servers')
      .insert(deepWikiServer)
      .select()
      .single();

    if (serverError) {
      console.error('❌ Failed to add DeepWiki server:', serverError);
      return;
    }

    console.log('✅ DeepWiki MCP server added successfully!');
    console.log('📋 Server details:');
    console.log(`  - ID: ${server.id}`);
    console.log(`  - Name: ${server.name}`);
    console.log(`  - Endpoint: ${server.endpoint}`);
    console.log(`  - Transport: ${server.transport_type}`);

    // Now let's add it to the test bud's MCP configuration
    const budId = 'e69d853e-6728-4f34-86cd-b3468c2ecf21'; // From previous logs

    const { data: bud, error: budError } = await supabase
      .from('buds')
      .select('id, name, mcp_config')
      .eq('id', budId)
      .single();

    if (budError || !bud) {
      console.warn('⚠️ Could not find test bud, skipping bud configuration');
      return;
    }

    console.log('✅ Found test bud:', bud.name);

    // Update bud's MCP configuration
    const currentMcpConfig = bud.mcp_config || {};
    const updatedMcpConfig = {
      ...currentMcpConfig,
      servers: [...(currentMcpConfig.servers || []), server.id],
      tool_choice: 'auto'
    };

    const { error: updateError } = await supabase
      .from('buds')
      .update({ mcp_config: updatedMcpConfig })
      .eq('id', budId);

    if (updateError) {
      console.error('❌ Failed to update bud MCP config:', updateError);
      return;
    }

    console.log('✅ Updated bud MCP configuration!');
    console.log('📋 Bud now has access to DeepWiki tools');

  } catch (error) {
    console.error('❌ Script failed:', error);
  }
};

addDeepWikiServer();