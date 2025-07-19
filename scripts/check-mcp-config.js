#!/usr/bin/env node

// Check MCP configuration in database
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

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const checkMCPConfig = async () => {
  console.log('🔍 Checking MCP configuration...');

  try {
    // Check the test bud's MCP configuration
    const budId = 'e69d853e-6728-4f34-86cd-b3468c2ecf21';
    
    const { data: bud, error: budError } = await supabase
      .from('buds')
      .select('id, name, mcp_config')
      .eq('id', budId)
      .single();

    if (budError || !bud) {
      console.error('❌ Could not find test bud');
      return;
    }

    console.log('✅ Found bud:', bud.name);
    console.log('📋 MCP config:', JSON.stringify(bud.mcp_config, null, 2));

    // Check if there are server IDs in the config
    const mcpConfig = bud.mcp_config || {};
    if (mcpConfig.servers?.length > 0) {
      console.log('🔧 Fetching MCP server details...');
      
      const { data: servers, error: serversError } = await supabase
        .from('mcp_servers')
        .select('*')
        .in('id', mcpConfig.servers);

      if (serversError) {
        console.error('❌ Error fetching servers:', serversError);
        return;
      }

      console.log(`✅ Found ${servers.length} MCP servers:`);
      servers.forEach(server => {
        console.log(`  - ${server.name}`);
        console.log(`    URL: ${server.endpoint}`);
        console.log(`    Transport: ${server.transport_type}`);
        console.log(`    Metadata:`, JSON.stringify(server.metadata, null, 4));
      });
    } else {
      console.log('⚠️ No MCP servers configured for this bud');
    }

  } catch (error) {
    console.error('❌ Error checking MCP config:', error);
  }
};

checkMCPConfig();