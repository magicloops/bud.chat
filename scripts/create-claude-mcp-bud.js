#!/usr/bin/env node

// Create a test bud with Claude model and MCP configuration
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load environment variables
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const createClaudeMCPBud = async () => {
  console.log('🔧 Creating Claude MCP test bud...')

  try {
    // Get the workspace ID (assuming we're using the first workspace)
    const { data: workspaces, error: workspaceError } = await supabase
      .from('workspaces')
      .select('id')
      .limit(1)

    if (workspaceError || !workspaces || workspaces.length === 0) {
      console.error('❌ Could not find a workspace')
      return
    }

    const workspaceId = workspaces[0].id

    // Get the user ID (assuming we're using the first user)
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .limit(1)

    if (userError || !users || users.length === 0) {
      console.error('❌ Could not find a user')
      return
    }

    const userId = users[0].id

    // Get the DeepWiki MCP server ID
    const { data: mcpServers, error: mcpError } = await supabase
      .from('mcp_servers')
      .select('id')
      .eq('name', 'DeepWiki')
      .eq('workspace_id', workspaceId)
      .single()

    if (mcpError || !mcpServers) {
      console.error('❌ Could not find DeepWiki MCP server')
      return
    }

    const mcpServerId = mcpServers.id

    // Create the Claude MCP bud
    const claudeBud = {
      name: 'Claude MCP Test',
      workspace_id: workspaceId,
      owner_user_id: userId,
      description: 'Test bud for Claude with MCP integration',
      instructions: 'You are a helpful assistant with access to research tools. Use the available tools to provide comprehensive answers.',
      default_json: {
        name: 'Claude Research Assistant',
        avatar: '🔍',
        model: 'claude-3-5-sonnet-20241022', // Use Claude 3.5 Sonnet
        temperature: 0.7,
        max_tokens: 4000,
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
      },
      mcp_config: {
        servers: [mcpServerId]
      }
    }

    const { data: bud, error: budError } = await supabase
      .from('buds')
      .insert(claudeBud)
      .select()
      .single()

    if (budError) {
      console.error('❌ Error creating Claude MCP bud:', budError)
      return
    }

    console.log('✅ Claude MCP bud created successfully!')
    console.log('📋 Bud details:')
    console.log(`  - ID: ${bud.id}`)
    console.log(`  - Name: ${bud.name}`)
    console.log(`  - Model: ${bud.default_json.model}`)
    console.log(`  - MCP Servers: ${bud.mcp_config.servers.length}`)
    console.log(`  - Test URL: http://localhost:3000/new?bud=${bud.id}`)

  } catch (error) {
    console.error('❌ Error creating Claude MCP bud:', error)
  }
}

createClaudeMCPBud()