#!/usr/bin/env node

// Update the existing test bud to use Claude model
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

const updateBudToClaude = async () => {
  console.log('🔧 Updating test bud to use Claude model...');

  try {
    // Update the existing test bud to use Claude
    const budId = '533c0ff1-557f-456a-a5cf-e4e308c7bcfe'; // Use the bud ID from the logs
    
    const { data: bud, error: budError } = await supabase
      .from('buds')
      .update({
        name: 'Claude MCP Research Assistant',
        default_json: {
          name: 'Claude Research Assistant',
          avatar: '🔍',
          model: 'claude-3-5-sonnet', // Use friendly model name, will be mapped to claude-3-5-sonnet-20241022
          temperature: 0.7,
          max_tokens: 4000,
          instructions: 'You are a helpful Claude assistant with access to research tools. Use the available tools to provide comprehensive, well-researched answers.',
          customTheme: {
            name: 'Claude Blue',
            cssVariables: {
              '--primary': '210 40% 50%',
              '--primary-foreground': '0 0% 98%',
              '--secondary': '210 40% 96%',
              '--secondary-foreground': '210 40% 12%',
              '--accent': '210 40% 90%',
              '--accent-foreground': '210 40% 12%'
            }
          }
        }
      })
      .eq('id', budId)
      .select()
      .single();

    if (budError) {
      console.error('❌ Error updating bud to Claude:', budError);
      return;
    }

    console.log('✅ Bud updated to Claude model successfully!');
    console.log('📋 Updated bud details:');
    console.log(`  - ID: ${bud.id}`);
    console.log(`  - Name: ${bud.name}`);
    console.log(`  - Model: ${bud.default_json.model}`);
    console.log(`  - Test URL: http://localhost:3000/new?bud=${bud.id}`);
    console.log('');
    console.log('🧪 Now you can test Claude MCP integration by:');
    console.log('1. Navigate to the test URL above');
    console.log('2. Ask a research question like: "What is the Model Context Protocol?"');
    console.log('3. Watch the logs for Anthropic MCP events');

  } catch (error) {
    console.error('❌ Error updating bud to Claude:', error);
  }
};

updateBudToClaude();