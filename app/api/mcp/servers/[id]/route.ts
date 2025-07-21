// Individual MCP Server Management API
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/types/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const resolvedParams = await params;
    const serverId = resolvedParams.id;
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get MCP server with workspace access check
    const { data: server, error: serverError } = await supabase
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
        ),
        workspaces!inner (
          workspace_members!inner (
            user_id,
            role
          )
        )
      `)
      .eq('id', serverId)
      .eq('workspaces.workspace_members.user_id', user.id)
      .single();

    if (serverError || !server) {
      return NextResponse.json({ error: 'Server not found or access denied' }, { status: 404 });
    }

    // Clean up the response (remove nested workspace data)
    const { workspaces, ...cleanServer } = server;
    
    return NextResponse.json({ data: cleanServer });
  } catch (error) {
    console.error('MCP server GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const resolvedParams = await params;
    const serverId = resolvedParams.id;
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      name,
      endpoint,
      transport_type,
      auth_config,
      connection_config,
      metadata,
      is_active
    } = body;

    // Verify user has access to the server's workspace
    const { data: server, error: serverCheckError } = await supabase
      .from('mcp_servers')
      .select(`
        workspace_id,
        workspaces!inner (
          workspace_members!inner (
            user_id,
            role
          )
        )
      `)
      .eq('id', serverId)
      .eq('workspaces.workspace_members.user_id', user.id)
      .single();

    if (serverCheckError || !server) {
      return NextResponse.json({ error: 'Server not found or access denied' }, { status: 404 });
    }

    // If name is being changed, check for duplicates
    if (name) {
      const { data: existingServer } = await supabase
        .from('mcp_servers')
        .select('id')
        .eq('workspace_id', server.workspace_id)
        .eq('name', name)
        .neq('id', serverId)
        .single();

      if (existingServer) {
        return NextResponse.json({ 
          error: 'A server with this name already exists in the workspace' 
        }, { status: 409 });
      }
    }

    // Validate transport type if provided
    if (transport_type && !['http', 'stdio', 'websocket'].includes(transport_type)) {
      return NextResponse.json({ 
        error: 'Invalid transport_type. Must be one of: http, stdio, websocket' 
      }, { status: 400 });
    }

    // Build update object with only provided fields
    const updateData: Partial<Database['public']['Tables']['mcp_servers']['Update']> = {
      updated_at: new Date().toISOString()
    };
    
    if (name !== undefined) updateData.name = name;
    if (endpoint !== undefined) updateData.endpoint = endpoint;
    if (transport_type !== undefined) updateData.transport_type = transport_type;
    if (auth_config !== undefined) updateData.auth_config = auth_config;
    if (connection_config !== undefined) updateData.connection_config = connection_config;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (is_active !== undefined) updateData.is_active = is_active;

    // Update the server
    const { data: updatedServer, error: updateError } = await supabase
      .from('mcp_servers')
      .update(updateData)
      .eq('id', serverId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating MCP server:', updateError);
      return NextResponse.json({ error: 'Failed to update MCP server' }, { status: 500 });
    }

    return NextResponse.json({ data: updatedServer });
  } catch (error) {
    console.error('MCP server PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const resolvedParams = await params;
    const serverId = resolvedParams.id;
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify user has access to the server's workspace
    const { data: server, error: serverCheckError } = await supabase
      .from('mcp_servers')
      .select(`
        workspace_id,
        workspaces!inner (
          workspace_members!inner (
            user_id,
            role
          )
        )
      `)
      .eq('id', serverId)
      .eq('workspaces.workspace_members.user_id', user.id)
      .single();

    if (serverCheckError || !server) {
      return NextResponse.json({ error: 'Server not found or access denied' }, { status: 404 });
    }

    // Delete the server (cascade will handle mcp_tools)
    const { error: deleteError } = await supabase
      .from('mcp_servers')
      .delete()
      .eq('id', serverId);

    if (deleteError) {
      console.error('Error deleting MCP server:', deleteError);
      return NextResponse.json({ error: 'Failed to delete MCP server' }, { status: 500 });
    }

    return NextResponse.json({ data: { success: true } });
  } catch (error) {
    console.error('MCP server DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}