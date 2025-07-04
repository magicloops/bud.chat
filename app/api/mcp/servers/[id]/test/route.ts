// MCP Server Connection Testing API
import { createClient } from '@/lib/supabase/server'
import { MCPClientManager } from '@/lib/mcp'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const resolvedParams = await params
    const serverId = resolvedParams.id
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get MCP server with workspace access check
    const { data: server, error: serverError } = await supabase
      .from('mcp_servers')
      .select(`
        *,
        workspaces!inner (
          workspace_members!inner (
            user_id,
            role
          )
        )
      `)
      .eq('id', serverId)
      .eq('workspaces.workspace_members.user_id', user.id)
      .single()

    if (serverError || !server) {
      return NextResponse.json({ error: 'Server not found or access denied' }, { status: 404 })
    }

    console.log(`🧪 Testing MCP server connection: ${server.name}`)

    // Create a temporary MCP client manager for testing
    const clientManager = new MCPClientManager(server.workspace_id)
    
    try {
      // Initialize with just this server
      await clientManager.initialize([{
        id: server.id,
        name: server.name,
        endpoint: server.endpoint,
        transport_type: server.transport_type,
        auth_config: server.auth_config,
        connection_config: server.connection_config,
        metadata: server.metadata
      }])

      // Test connection and get available tools
      const connectionTest = await clientManager.testConnection(serverId)
      
      if (connectionTest.success) {
        // Update server metadata with discovered tools if available
        if (connectionTest.tools && connectionTest.tools.length > 0) {
          const updatedMetadata = {
            ...server.metadata,
            last_tested: new Date().toISOString(),
            discovered_tools: connectionTest.tools
          }

          await supabase
            .from('mcp_servers')
            .update({ 
              metadata: updatedMetadata,
              updated_at: new Date().toISOString()
            })
            .eq('id', serverId)

          // Optionally sync tools to mcp_tools table
          // This could be done here or as a separate endpoint
        }

        return NextResponse.json({
          data: {
            success: true,
            server_name: server.name,
            tools: connectionTest.tools || [],
            message: 'Connection successful'
          }
        })
      } else {
        return NextResponse.json({
          data: {
            success: false,
            server_name: server.name,
            error: connectionTest.error,
            message: 'Connection failed'
          }
        }, { status: 400 })
      }
    } finally {
      // Always clean up the test client
      await clientManager.cleanup()
    }
  } catch (error) {
    console.error('MCP server test error:', error)
    return NextResponse.json({ 
      error: 'Failed to test MCP server connection',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}