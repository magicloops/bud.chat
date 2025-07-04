// MCP Server Management API
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 })
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single()

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    // Get MCP servers for the workspace
    const { data: servers, error: serversError } = await supabase
      .from('mcp_servers')
      .select(`
        *,
        mcp_tools (
          id,
          name,
          description,
          parameters_schema,
          is_enabled,
          created_at
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })

    if (serversError) {
      console.error('Error fetching MCP servers:', serversError)
      return NextResponse.json({ error: 'Failed to fetch MCP servers' }, { status: 500 })
    }

    return NextResponse.json({ data: servers || [] })
  } catch (error) {
    console.error('MCP servers API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      workspaceId,
      name,
      endpoint,
      transport_type = 'http',
      auth_config,
      connection_config,
      metadata
    } = body

    // Validate required fields
    if (!workspaceId || !name || !endpoint) {
      return NextResponse.json({ 
        error: 'Missing required fields: workspaceId, name, endpoint' 
      }, { status: 400 })
    }

    // Validate transport type
    if (!['http', 'stdio', 'websocket'].includes(transport_type)) {
      return NextResponse.json({ 
        error: 'Invalid transport_type. Must be one of: http, stdio, websocket' 
      }, { status: 400 })
    }

    // Verify user has access to the workspace
    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single()

    if (membershipError || !membership) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    // Check for duplicate server name in workspace
    const { data: existingServer } = await supabase
      .from('mcp_servers')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .single()

    if (existingServer) {
      return NextResponse.json({ 
        error: 'A server with this name already exists in the workspace' 
      }, { status: 409 })
    }

    // Create the MCP server
    const { data: server, error: serverError } = await supabase
      .from('mcp_servers')
      .insert({
        workspace_id: workspaceId,
        name,
        endpoint,
        transport_type,
        auth_config,
        connection_config,
        metadata,
        is_active: true
      })
      .select()
      .single()

    if (serverError) {
      console.error('Error creating MCP server:', serverError)
      return NextResponse.json({ error: 'Failed to create MCP server' }, { status: 500 })
    }

    return NextResponse.json({ data: server }, { status: 201 })
  } catch (error) {
    console.error('MCP server creation error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}