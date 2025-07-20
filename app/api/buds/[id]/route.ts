import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { BudConfig } from '@/lib/types';

export interface UpdateBudRequest {
  name?: string
  config?: Partial<BudConfig>
}

// GET /api/buds/[id] - Get a specific bud
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: budId } = await params;

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the bud with workspace access check
    const { data: bud, error: budError } = await supabase
      .from('buds')
      .select(`
        *,
        workspaces!inner(id)
      `)
      .eq('id', budId)
      .single();

    if (budError || !bud) {
      return NextResponse.json(
        { error: 'Bud not found' },
        { status: 404 }
      );
    }

    // Check if user has access to the workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', bud.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    return NextResponse.json({ bud });
  } catch (error) {
    console.error('GET /api/buds/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PUT /api/buds/[id] - Update a bud
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: budId } = await params;
    const body: UpdateBudRequest = await request.json();

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the existing bud to check permissions
    const { data: existingBud, error: fetchError } = await supabase
      .from('buds')
      .select('*, workspaces!inner(id)')
      .eq('id', budId)
      .single();

    if (fetchError || !existingBud) {
      return NextResponse.json(
        { error: 'Bud not found' },
        { status: 404 }
      );
    }

    // Check if user is the owner or has admin access to workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', existingBud.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Only owner or admin can edit
    if (existingBud.owner_user_id !== user.id && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only the owner or workspace admin can edit this bud' },
        { status: 403 }
      );
    }

    // Prepare update data
    const updateData: any = {};
    
    if (body.name) {
      updateData.name = body.name;
    }
    
    if (body.config) {
      // Extract MCP config from the update
      const fullConfig = body.config as BudConfig;
      const { mcpConfig, ...budConfig } = fullConfig;
      
      // Merge with existing config (excluding MCP config)
      const currentConfig = existingBud.default_json as BudConfig;
      updateData.default_json = { ...currentConfig, ...budConfig };
      
      // Update MCP config separately if provided
      if (mcpConfig !== undefined) {
        updateData.mcp_config = mcpConfig;
      }
    }

    // Update the bud
    const { data: updatedBud, error: updateError } = await supabase
      .from('buds')
      .update(updateData)
      .eq('id', budId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating bud:', updateError);
      return NextResponse.json(
        { error: 'Failed to update bud' },
        { status: 500 }
      );
    }

    return NextResponse.json({ bud: updatedBud });
  } catch (error) {
    console.error('PUT /api/buds/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/buds/[id] - Delete a bud
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { id: budId } = await params;

    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get the existing bud to check permissions
    const { data: existingBud, error: fetchError } = await supabase
      .from('buds')
      .select('*, workspaces!inner(id)')
      .eq('id', budId)
      .single();

    if (fetchError || !existingBud) {
      return NextResponse.json(
        { error: 'Bud not found' },
        { status: 404 }
      );
    }

    // Check if user is the owner or has admin access to workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', existingBud.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Only owner or admin can delete
    if (existingBud.owner_user_id !== user.id && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only the owner or workspace admin can delete this bud' },
        { status: 403 }
      );
    }

    // Delete the bud
    const { error: deleteError } = await supabase
      .from('buds')
      .delete()
      .eq('id', budId);

    if (deleteError) {
      console.error('Error deleting bud:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete bud' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/buds/[id] error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}